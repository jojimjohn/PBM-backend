/**
 * Reports API Routes
 *
 * Provides reporting endpoints for:
 * - Purchase Cost Analysis (with collection expenses)
 * - WCN Register (collection order tracking)
 * - Collection Expenses (expense breakdown and trends)
 * - Vendor Bill Tracking (invoice status and payments)
 *
 * Each report supports:
 * - Date range filtering
 * - Pagination
 * - Sorting
 * - Export to CSV/XLSX
 */

const express = require('express');
const Joi = require('joi');
const { validate, sanitize } = require('../middleware/validation');
const { requirePermission } = require('../middleware/auth');
const { logger, auditLog } = require('../utils/logger');
const { getDbConnection } = require('../config/database');
const { buildDateRangeFilter, buildPaginationParams, formatReportResponse } = require('../utils/reportUtils');
const { exportToCsv, exportToXlsx } = require('../utils/exportUtils');

const router = express.Router();

// Apply sanitization to all routes
router.use(sanitize);

// ============================================================================
// VALIDATION SCHEMAS
// ============================================================================

// Common query parameters for all reports
// Note: .unknown(true) allows extra parameters (like 'format' for exports) to pass through
const baseReportSchema = Joi.object({
  from_date: Joi.date().iso().optional(),
  to_date: Joi.date().iso().optional(),
  supplier_id: Joi.number().integer().positive().optional(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  sort_by: Joi.string().optional(),
  sort_order: Joi.string().valid('asc', 'desc').default('desc')
}).unknown(true);

// Purchase Cost Analysis specific params
const purchaseCostSchema = baseReportSchema.keys({
  material_id: Joi.number().integer().positive().optional()
});

// WCN Register specific params
const wcnRegisterSchema = baseReportSchema.keys({
  status: Joi.string().valid('finalized', 'pending', 'all').default('all')
});

// Collection Expenses specific params
const collectionExpensesSchema = baseReportSchema.keys({
  category: Joi.string().valid(
    'fuel', 'transportation', 'loading_unloading',
    'permits_fees', 'equipment_rental', 'meals_accommodation',
    'maintenance', 'other'
  ).optional()
});

// Vendor Bills specific params
const vendorBillsSchema = baseReportSchema.keys({
  payment_status: Joi.string().valid('unpaid', 'partial', 'paid', 'overdue', 'all').default('all'),
  bill_type: Joi.string().valid('company', 'vendor', 'all').default('all')
});

// VAT Return specific params
const vatReturnSchema = baseReportSchema.keys({
  taxable_only: Joi.boolean().default(false)
});

// Receivables Aging specific params (no date range needed; always "as of today")
const receivablesAgingSchema = Joi.object({
  customer_id: Joi.number().integer().positive().optional(),
  include_paid: Joi.boolean().default(false),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(500).default(100),
  sort_by: Joi.string().optional(),
  sort_order: Joi.string().valid('asc', 'desc').default('desc')
}).unknown(true);

// Profit & Loss specific params
const profitLossSchema = baseReportSchema.keys({
  group_by: Joi.string().valid('month', 'quarter', 'year', 'none').default('month')
});

// Export params
const exportSchema = Joi.object({
  format: Joi.string().valid('csv', 'xlsx').default('csv')
}).unknown(true); // Allow other params to pass through

// ============================================================================
// REPORT 1: PURCHASE COST ANALYSIS
// ============================================================================

/**
 * GET /api/reports/purchase-cost
 *
 * Returns purchase orders with collection expense attribution
 * Shows actual cost = base cost + collection expenses
 */
router.get('/purchase-cost', requirePermission('VIEW_REPORTS'), async (req, res) => {
  try {
    const { companyId } = req.user;
    const db = getDbConnection(companyId);

    // Validate query params
    const { error, value: params } = purchaseCostSchema.validate(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        error: error.details[0].message
      });
    }

    const { from_date, to_date, supplier_id, material_id, page, limit, sort_by, sort_order } = params;
    const dateRange = buildDateRangeFilter(from_date, to_date);
    const { offset, limitValue } = buildPaginationParams(page, limit);

    // Build base query for purchase orders with expenses
    let query = db('purchase_orders as po')
      .leftJoin('suppliers as s', 'po.supplierId', 's.id')
      .leftJoin('collection_orders as co', 'po.collection_order_id', 'co.id')
      .leftJoin('collection_expenses as ce', 'co.id', 'ce.collectionOrderId')
      .select(
        'po.id',
        'po.orderNumber',
        'po.orderDate',
        'po.totalAmount as baseCost',
        'po.source_type',
        's.id as supplierId',
        's.name as supplierName',
        'co.id as collectionOrderId',
        'co.wcn_number as wcnNumber'
      )
      .select(db.raw('COALESCE(SUM(ce.amount), 0) as collectionExpenses'))
      .whereBetween('po.orderDate', [dateRange.from, dateRange.to])
      .whereIn('po.status', ['approved', 'sent', 'received', 'completed'])
      .groupBy('po.id', 'po.orderNumber', 'po.orderDate', 'po.totalAmount', 'po.source_type',
               's.id', 's.name', 'co.id', 'co.wcn_number');

    // Apply filters
    if (supplier_id) {
      query = query.where('po.supplierId', supplier_id);
    }

    // Count total for pagination
    const countQuery = db('purchase_orders as po')
      .leftJoin('suppliers as s', 'po.supplierId', 's.id')
      .whereBetween('po.orderDate', [dateRange.from, dateRange.to])
      .whereIn('po.status', ['approved', 'sent', 'received', 'completed']);

    if (supplier_id) {
      countQuery.where('po.supplierId', supplier_id);
    }

    const [{ count: totalCount }] = await countQuery.count('po.id as count');

    // Apply sorting
    const sortColumn = sort_by === 'supplier' ? 's.name' :
                       sort_by === 'baseCost' ? 'po.totalAmount' :
                       sort_by === 'date' ? 'po.orderDate' : 'po.orderDate';
    query = query.orderBy(sortColumn, sort_order);

    // Apply pagination
    query = query.offset(offset).limit(limitValue);

    // Execute query
    const records = await query;

    // Calculate derived fields
    const enrichedRecords = records.map(record => {
      const baseCost = parseFloat(record.baseCost) || 0;
      const collectionExpenses = parseFloat(record.collectionExpenses) || 0;
      const actualCost = baseCost + collectionExpenses;
      const expensePercentage = baseCost > 0 ? (collectionExpenses / baseCost * 100) : 0;

      return {
        id: record.id,
        poNumber: record.orderNumber,
        orderDate: record.orderDate,
        supplierName: record.supplierName || 'Unknown Supplier',
        supplierId: record.supplierId,
        baseCost: baseCost.toFixed(3),
        collectionExpenses: collectionExpenses.toFixed(3),
        actualCost: actualCost.toFixed(3),
        expensePercentage: expensePercentage.toFixed(2),
        wcnNumber: record.wcnNumber,
        sourceType: record.source_type
      };
    });

    // Calculate summary
    const summaryQuery = db('purchase_orders as po')
      .leftJoin('collection_orders as co', 'po.collection_order_id', 'co.id')
      .leftJoin('collection_expenses as ce', 'co.id', 'ce.collectionOrderId')
      .select(
        db.raw('SUM(po.totalAmount) as totalBaseCost'),
        db.raw('COALESCE(SUM(ce.amount), 0) as totalExpenses'),
        db.raw('COUNT(DISTINCT po.id) as recordCount')
      )
      .whereBetween('po.orderDate', [dateRange.from, dateRange.to])
      .whereIn('po.status', ['approved', 'sent', 'received', 'completed']);

    if (supplier_id) {
      summaryQuery.where('po.supplierId', supplier_id);
    }

    const [summaryResult] = await summaryQuery;

    const totalBaseCost = parseFloat(summaryResult.totalBaseCost) || 0;
    const totalExpenses = parseFloat(summaryResult.totalExpenses) || 0;
    const totalActualCost = totalBaseCost + totalExpenses;
    const averageExpensePercentage = totalBaseCost > 0 ? (totalExpenses / totalBaseCost * 100) : 0;

    const summary = {
      totalBaseCost: totalBaseCost.toFixed(3),
      totalExpenses: totalExpenses.toFixed(3),
      totalActualCost: totalActualCost.toFixed(3),
      averageExpensePercentage: averageExpensePercentage.toFixed(2),
      recordCount: parseInt(summaryResult.recordCount) || 0
    };

    res.json(formatReportResponse(enrichedRecords, summary, {
      page,
      limit: limitValue,
      total: parseInt(totalCount),
      pages: Math.ceil(totalCount / limitValue)
    }, dateRange));

  } catch (error) {
    logger.error('Purchase Cost Report Error:', error);
    res.status(500).json({ success: false, error: 'Failed to generate report' });
  }
});

/**
 * GET /api/reports/purchase-cost/export
 *
 * Export Purchase Cost Analysis to CSV or XLSX
 */
router.get('/purchase-cost/export', requirePermission('VIEW_REPORTS'), async (req, res) => {
  try {
    const { companyId } = req.user;
    const db = getDbConnection(companyId);

    const { error: exportError, value: exportParams } = exportSchema.validate(req.query);
    const { error, value: params } = purchaseCostSchema.validate(req.query);
    if (error) {
      return res.status(400).json({ success: false, error: error.details[0].message });
    }

    const { from_date, to_date, supplier_id } = params;
    const { format } = exportParams;
    const dateRange = buildDateRangeFilter(from_date, to_date);

    // Query all matching records (no pagination for export)
    const records = await db('purchase_orders as po')
      .leftJoin('suppliers as s', 'po.supplierId', 's.id')
      .leftJoin('collection_orders as co', 'po.collection_order_id', 'co.id')
      .leftJoin('collection_expenses as ce', 'co.id', 'ce.collectionOrderId')
      .select(
        'po.id',
        'po.orderNumber',
        'po.orderDate',
        'po.totalAmount as baseCost',
        's.name as supplierName',
        'co.wcn_number as wcnNumber'
      )
      .select(db.raw('COALESCE(SUM(ce.amount), 0) as collectionExpenses'))
      .whereBetween('po.orderDate', [dateRange.from, dateRange.to])
      .whereIn('po.status', ['approved', 'sent', 'received', 'completed'])
      .modify(qb => { if (supplier_id) qb.where('po.supplierId', supplier_id); })
      .groupBy('po.id', 'po.orderNumber', 'po.orderDate', 'po.totalAmount', 's.name', 'co.wcn_number')
      .orderBy('po.orderDate', 'desc');

    // Format for export
    const exportData = records.map(record => {
      const baseCost = parseFloat(record.baseCost) || 0;
      const collectionExpenses = parseFloat(record.collectionExpenses) || 0;
      const actualCost = baseCost + collectionExpenses;
      const expensePercentage = baseCost > 0 ? (collectionExpenses / baseCost * 100) : 0;

      return {
        'PO Number': record.orderNumber,
        'Order Date': record.orderDate,
        'Supplier': record.supplierName || 'Unknown',
        'Base Cost (OMR)': baseCost.toFixed(3),
        'Collection Expenses (OMR)': collectionExpenses.toFixed(3),
        'Actual Cost (OMR)': actualCost.toFixed(3),
        'Expense %': expensePercentage.toFixed(2) + '%',
        'WCN Number': record.wcnNumber || 'N/A'
      };
    });

    const filename = `Purchase_Cost_Analysis_${dateRange.from}_to_${dateRange.to}`;

    if (format === 'xlsx') {
      exportToXlsx(exportData, filename, res);
    } else {
      exportToCsv(exportData, filename, res);
    }

  } catch (error) {
    logger.error('Purchase Cost Export Error:', error);
    res.status(500).json({ success: false, error: 'Export failed' });
  }
});

// ============================================================================
// REPORT 2: WCN REGISTER
// ============================================================================

/**
 * GET /api/reports/wcn-register
 *
 * Returns list of all Waste Consignment Notes with status and linked PO info
 */
router.get('/wcn-register', requirePermission('VIEW_REPORTS'), async (req, res) => {
  try {
    const { companyId } = req.user;
    const db = getDbConnection(companyId);

    const { error, value: params } = wcnRegisterSchema.validate(req.query);
    if (error) {
      return res.status(400).json({ success: false, error: error.details[0].message });
    }

    const { from_date, to_date, supplier_id, status, page, limit, sort_by, sort_order } = params;
    const dateRange = buildDateRangeFilter(from_date, to_date);
    const { offset, limitValue } = buildPaginationParams(page, limit);

    // Build query
    let query = db('collection_orders as co')
      .leftJoin('suppliers as s', 'co.supplierId', 's.id')
      .leftJoin('contracts as ct', 'co.contractId', 'ct.id')
      .leftJoin('purchase_orders as po', 'po.collection_order_id', 'co.id')
      .select(
        'co.id',
        'co.orderNumber',
        'co.wcn_number as wcnNumber',
        'co.wcn_date as wcnDate',
        'co.scheduledDate',
        'co.status',
        'co.is_finalized as isFinalized',
        'co.finalized_at as finalizedAt',
        'co.rectification_count as rectificationCount',
        'co.rectification_notes as rectificationNotes',
        's.id as supplierId',
        's.name as supplierName',
        'ct.contractNumber',
        'po.id as purchaseOrderId',
        'po.orderNumber as poNumber',
        'po.totalAmount as poAmount'
      )
      .where(function() {
        // Filter by WCN date if finalized, otherwise by scheduled date
        this.whereBetween('co.wcn_date', [dateRange.from, dateRange.to])
            .orWhere(function() {
              this.whereNull('co.wcn_date')
                  .whereBetween('co.scheduledDate', [dateRange.from, dateRange.to]);
            });
      });

    // Apply filters
    if (supplier_id) {
      query = query.where('co.supplierId', supplier_id);
    }
    if (status === 'finalized') {
      query = query.where('co.is_finalized', true);
    } else if (status === 'pending') {
      query = query.where('co.is_finalized', false);
    }

    // Count for pagination
    const countQuery = db('collection_orders as co')
      .where(function() {
        this.whereBetween('co.wcn_date', [dateRange.from, dateRange.to])
            .orWhere(function() {
              this.whereNull('co.wcn_date')
                  .whereBetween('co.scheduledDate', [dateRange.from, dateRange.to]);
            });
      })
      .modify(qb => {
        if (supplier_id) qb.where('co.supplierId', supplier_id);
        if (status === 'finalized') qb.where('co.is_finalized', true);
        else if (status === 'pending') qb.where('co.is_finalized', false);
      });

    const [{ count: totalCount }] = await countQuery.count('co.id as count');

    // Apply sorting
    const sortColumn = sort_by === 'wcnNumber' ? 'co.wcn_number' :
                       sort_by === 'supplier' ? 's.name' :
                       'co.wcn_date';
    query = query.orderBy(sortColumn, sort_order);

    // Apply pagination
    query = query.offset(offset).limit(limitValue);

    const records = await query;

    // Get item counts for each collection order
    const collectionIds = records.map(r => r.id);
    const itemCounts = collectionIds.length > 0
      ? await db('collection_items')
          .select('collectionOrderId')
          .count('id as itemCount')
          .whereIn('collectionOrderId', collectionIds)
          .groupBy('collectionOrderId')
      : [];

    const itemCountMap = itemCounts.reduce((acc, item) => {
      acc[item.collectionOrderId] = parseInt(item.itemCount);
      return acc;
    }, {});

    // Enrich records
    const enrichedRecords = records.map(record => ({
      id: record.id,
      orderNumber: record.orderNumber,
      wcnNumber: record.wcnNumber || 'Not Generated',
      wcnDate: record.wcnDate || record.scheduledDate,
      status: record.isFinalized ? 'Finalized' : 'Pending',
      isFinalized: !!record.isFinalized,
      rectificationCount: record.rectificationCount || 0,
      rectificationNotes: record.rectificationNotes,
      supplierName: record.supplierName || 'Unknown Supplier',
      supplierId: record.supplierId,
      contractNumber: record.contractNumber,
      linkedPo: record.purchaseOrderId ? {
        id: record.purchaseOrderId,
        poNumber: record.poNumber,
        amount: parseFloat(record.poAmount || 0).toFixed(3)
      } : null,
      itemCount: itemCountMap[record.id] || 0
    }));

    // Calculate summary
    const summaryQuery = await db('collection_orders as co')
      .select(
        db.raw('COUNT(*) as totalWcns'),
        db.raw('SUM(CASE WHEN co.is_finalized = 1 THEN 1 ELSE 0 END) as finalizedCount'),
        db.raw('SUM(CASE WHEN co.is_finalized = 0 THEN 1 ELSE 0 END) as pendingCount'),
        db.raw('SUM(COALESCE(co.rectification_count, 0)) as totalRectifications')
      )
      .where(function() {
        this.whereBetween('co.wcn_date', [dateRange.from, dateRange.to])
            .orWhere(function() {
              this.whereNull('co.wcn_date')
                  .whereBetween('co.scheduledDate', [dateRange.from, dateRange.to]);
            });
      })
      .modify(qb => {
        if (supplier_id) qb.where('co.supplierId', supplier_id);
        if (status === 'finalized') qb.where('co.is_finalized', true);
        else if (status === 'pending') qb.where('co.is_finalized', false);
      })
      .first();

    const summary = {
      totalWcns: parseInt(summaryQuery.totalWcns) || 0,
      finalizedCount: parseInt(summaryQuery.finalizedCount) || 0,
      pendingCount: parseInt(summaryQuery.pendingCount) || 0,
      totalRectifications: parseInt(summaryQuery.totalRectifications) || 0
    };

    res.json(formatReportResponse(enrichedRecords, summary, {
      page,
      limit: limitValue,
      total: parseInt(totalCount),
      pages: Math.ceil(totalCount / limitValue)
    }, dateRange));

  } catch (error) {
    logger.error('WCN Register Report Error:', error);
    res.status(500).json({ success: false, error: 'Failed to generate report' });
  }
});

/**
 * GET /api/reports/wcn-register/export
 *
 * Export WCN Register to CSV or XLSX
 */
router.get('/wcn-register/export', requirePermission('VIEW_REPORTS'), async (req, res) => {
  try {
    const { companyId } = req.user;
    const db = getDbConnection(companyId);

    const { value: exportParams } = exportSchema.validate(req.query);
    const { error, value: params } = wcnRegisterSchema.validate(req.query);
    if (error) {
      return res.status(400).json({ success: false, error: error.details[0].message });
    }

    const { from_date, to_date, supplier_id, status } = params;
    const { format } = exportParams;
    const dateRange = buildDateRangeFilter(from_date, to_date);

    const records = await db('collection_orders as co')
      .leftJoin('suppliers as s', 'co.supplierId', 's.id')
      .leftJoin('purchase_orders as po', 'po.collection_order_id', 'co.id')
      .select(
        'co.orderNumber',
        'co.wcn_number as wcnNumber',
        'co.wcn_date as wcnDate',
        'co.scheduledDate',
        'co.is_finalized as isFinalized',
        'co.rectification_count as rectificationCount',
        's.name as supplierName',
        'po.orderNumber as poNumber',
        'po.totalAmount as poAmount'
      )
      .where(function() {
        this.whereBetween('co.wcn_date', [dateRange.from, dateRange.to])
            .orWhere(function() {
              this.whereNull('co.wcn_date')
                  .whereBetween('co.scheduledDate', [dateRange.from, dateRange.to]);
            });
      })
      .modify(qb => {
        if (supplier_id) qb.where('co.supplierId', supplier_id);
        if (status === 'finalized') qb.where('co.is_finalized', true);
        else if (status === 'pending') qb.where('co.is_finalized', false);
      })
      .orderBy('co.wcn_date', 'desc');

    const exportData = records.map(record => ({
      'Collection #': record.orderNumber,
      'WCN Number': record.wcnNumber || 'Not Generated',
      'WCN Date': record.wcnDate || record.scheduledDate,
      'Supplier': record.supplierName || 'Unknown',
      'Status': record.isFinalized ? 'Finalized' : 'Pending',
      'Rectifications': record.rectificationCount || 0,
      'Linked PO': record.poNumber || 'N/A',
      'PO Amount (OMR)': record.poAmount ? parseFloat(record.poAmount).toFixed(3) : 'N/A'
    }));

    const filename = `WCN_Register_${dateRange.from}_to_${dateRange.to}`;

    if (format === 'xlsx') {
      exportToXlsx(exportData, filename, res);
    } else {
      exportToCsv(exportData, filename, res);
    }

  } catch (error) {
    logger.error('WCN Register Export Error:', error);
    res.status(500).json({ success: false, error: 'Export failed' });
  }
});

// ============================================================================
// REPORT 3: COLLECTION EXPENSES
// ============================================================================

/**
 * GET /api/reports/collection-expenses
 *
 * Returns collection expense analysis with category breakdown and trends
 */
router.get('/collection-expenses', requirePermission('VIEW_REPORTS'), async (req, res) => {
  try {
    const { companyId } = req.user;
    const db = getDbConnection(companyId);

    const { error, value: params } = collectionExpensesSchema.validate(req.query);
    if (error) {
      return res.status(400).json({ success: false, error: error.details[0].message });
    }

    const { from_date, to_date, supplier_id, category, page, limit, sort_by, sort_order } = params;
    const dateRange = buildDateRangeFilter(from_date, to_date);
    const { offset, limitValue } = buildPaginationParams(page, limit);

    // Query 1: Breakdown by category
    const categoryBreakdown = await db('collection_expenses as ce')
      .join('collection_orders as co', 'ce.collectionOrderId', 'co.id')
      .leftJoin('suppliers as s', 'co.supplierId', 's.id')
      .select('ce.expenseCategory as category')
      .sum('ce.amount as total')
      .count('ce.id as count')
      .whereBetween('ce.expenseDate', [dateRange.from, dateRange.to])
      .modify(qb => { if (supplier_id) qb.where('co.supplierId', supplier_id); })
      .groupBy('ce.expenseCategory')
      .orderBy('total', 'desc');

    // Query 2: Monthly trend
    const monthlyTrend = await db('collection_expenses as ce')
      .join('collection_orders as co', 'ce.collectionOrderId', 'co.id')
      .select(db.raw("DATE_FORMAT(ce.expenseDate, '%Y-%m') as month"))
      .sum('ce.amount as total')
      .countDistinct('co.id as collections')
      .whereBetween('ce.expenseDate', [dateRange.from, dateRange.to])
      .modify(qb => { if (supplier_id) qb.where('co.supplierId', supplier_id); })
      .groupBy(db.raw("DATE_FORMAT(ce.expenseDate, '%Y-%m')"))
      .orderBy('month', 'asc');

    // Query 3: Detailed expense list
    let detailQuery = db('collection_expenses as ce')
      .join('collection_orders as co', 'ce.collectionOrderId', 'co.id')
      .leftJoin('suppliers as s', 'co.supplierId', 's.id')
      .select(
        'ce.id',
        'ce.expenseCategory as category',
        'ce.description',
        'ce.amount',
        'ce.expenseDate',
        'ce.receiptNumber',
        'co.id as collectionOrderId',
        'co.orderNumber as collectionNumber',
        'co.wcn_number as wcnNumber',
        's.name as supplierName'
      )
      .whereBetween('ce.expenseDate', [dateRange.from, dateRange.to]);

    if (supplier_id) {
      detailQuery = detailQuery.where('co.supplierId', supplier_id);
    }
    if (category) {
      detailQuery = detailQuery.where('ce.expenseCategory', category);
    }

    // Count for pagination
    const countQuery = db('collection_expenses as ce')
      .join('collection_orders as co', 'ce.collectionOrderId', 'co.id')
      .whereBetween('ce.expenseDate', [dateRange.from, dateRange.to])
      .modify(qb => {
        if (supplier_id) qb.where('co.supplierId', supplier_id);
        if (category) qb.where('ce.expenseCategory', category);
      });

    const [{ count: totalCount }] = await countQuery.count('ce.id as count');

    // Apply sorting
    const sortColumn = sort_by === 'amount' ? 'ce.amount' :
                       sort_by === 'category' ? 'ce.expenseCategory' :
                       'ce.expenseDate';
    detailQuery = detailQuery.orderBy(sortColumn, sort_order);

    // Apply pagination
    detailQuery = detailQuery.offset(offset).limit(limitValue);

    const records = await detailQuery;

    // Format records
    const enrichedRecords = records.map(record => ({
      id: record.id,
      category: record.category,
      description: record.description,
      amount: parseFloat(record.amount).toFixed(3),
      expenseDate: record.expenseDate,
      receiptNumber: record.receiptNumber,
      collectionOrderId: record.collectionOrderId,
      collectionNumber: record.collectionNumber,
      wcnNumber: record.wcnNumber || 'N/A',
      supplierName: record.supplierName || 'Unknown'
    }));

    // Calculate summary
    const summaryQuery = await db('collection_expenses as ce')
      .join('collection_orders as co', 'ce.collectionOrderId', 'co.id')
      .select(
        db.raw('SUM(ce.amount) as totalExpenses'),
        db.raw('COUNT(DISTINCT co.id) as collectionCount'),
        db.raw('COUNT(ce.id) as expenseCount')
      )
      .whereBetween('ce.expenseDate', [dateRange.from, dateRange.to])
      .modify(qb => { if (supplier_id) qb.where('co.supplierId', supplier_id); })
      .first();

    const totalExpenses = parseFloat(summaryQuery.totalExpenses) || 0;
    const collectionCount = parseInt(summaryQuery.collectionCount) || 0;
    const averagePerCollection = collectionCount > 0 ? totalExpenses / collectionCount : 0;
    const topCategory = categoryBreakdown.length > 0 ? categoryBreakdown[0].category : null;

    const summary = {
      totalExpenses: totalExpenses.toFixed(3),
      averagePerCollection: averagePerCollection.toFixed(3),
      collectionCount,
      expenseCount: parseInt(summaryQuery.expenseCount) || 0,
      topCategory
    };

    res.json({
      success: true,
      data: {
        summary,
        byCategory: categoryBreakdown.map(c => ({
          category: c.category,
          total: parseFloat(c.total).toFixed(3),
          count: parseInt(c.count)
        })),
        monthlyTrend: monthlyTrend.map(m => ({
          month: m.month,
          total: parseFloat(m.total).toFixed(3),
          collections: parseInt(m.collections)
        })),
        records: enrichedRecords,
        pagination: {
          page,
          limit: limitValue,
          total: parseInt(totalCount),
          pages: Math.ceil(totalCount / limitValue)
        },
        dateRange
      }
    });

  } catch (error) {
    logger.error('Collection Expenses Report Error:', error);
    res.status(500).json({ success: false, error: 'Failed to generate report' });
  }
});

/**
 * GET /api/reports/collection-expenses/export
 *
 * Export Collection Expenses to CSV or XLSX
 */
router.get('/collection-expenses/export', requirePermission('VIEW_REPORTS'), async (req, res) => {
  try {
    const { companyId } = req.user;
    const db = getDbConnection(companyId);

    const { value: exportParams } = exportSchema.validate(req.query);
    const { error, value: params } = collectionExpensesSchema.validate(req.query);
    if (error) {
      return res.status(400).json({ success: false, error: error.details[0].message });
    }

    const { from_date, to_date, supplier_id, category } = params;
    const { format } = exportParams;
    const dateRange = buildDateRangeFilter(from_date, to_date);

    const records = await db('collection_expenses as ce')
      .join('collection_orders as co', 'ce.collectionOrderId', 'co.id')
      .leftJoin('suppliers as s', 'co.supplierId', 's.id')
      .select(
        'ce.expenseCategory as category',
        'ce.description',
        'ce.amount',
        'ce.expenseDate',
        'ce.receiptNumber',
        'co.orderNumber as collectionNumber',
        'co.wcn_number as wcnNumber',
        's.name as supplierName'
      )
      .whereBetween('ce.expenseDate', [dateRange.from, dateRange.to])
      .modify(qb => {
        if (supplier_id) qb.where('co.supplierId', supplier_id);
        if (category) qb.where('ce.expenseCategory', category);
      })
      .orderBy('ce.expenseDate', 'desc');

    const exportData = records.map(record => ({
      'Date': record.expenseDate,
      'Category': record.category,
      'Description': record.description || '',
      'Amount (OMR)': parseFloat(record.amount).toFixed(3),
      'Receipt #': record.receiptNumber || '',
      'Collection #': record.collectionNumber,
      'WCN Number': record.wcnNumber || 'N/A',
      'Supplier': record.supplierName || 'Unknown'
    }));

    const filename = `Collection_Expenses_${dateRange.from}_to_${dateRange.to}`;

    if (format === 'xlsx') {
      exportToXlsx(exportData, filename, res);
    } else {
      exportToCsv(exportData, filename, res);
    }

  } catch (error) {
    logger.error('Collection Expenses Export Error:', error);
    res.status(500).json({ success: false, error: 'Export failed' });
  }
});

// ============================================================================
// REPORT 4: VENDOR BILL TRACKING
// ============================================================================

/**
 * GET /api/reports/vendor-bills
 *
 * Returns vendor bills with payment status and multi-PO coverage
 */
router.get('/vendor-bills', requirePermission('VIEW_REPORTS'), async (req, res) => {
  try {
    const { companyId } = req.user;
    const db = getDbConnection(companyId);

    const { error, value: params } = vendorBillsSchema.validate(req.query);
    if (error) {
      return res.status(400).json({ success: false, error: error.details[0].message });
    }

    const { from_date, to_date, supplier_id, payment_status, bill_type, page, limit, sort_by, sort_order } = params;
    const dateRange = buildDateRangeFilter(from_date, to_date);
    const { offset, limitValue } = buildPaginationParams(page, limit);

    // Build query
    let query = db('purchase_invoices as pi')
      .leftJoin('suppliers as s', 'pi.supplier_id', 's.id')
      .select(
        'pi.id',
        'pi.invoice_number as invoiceNumber',
        'pi.invoice_date as invoiceDate',
        'pi.due_date as dueDate',
        'pi.invoice_amount as invoiceAmount',
        'pi.paid_amount as paidAmount',
        'pi.balance_due as balanceDue',
        'pi.bill_type as billType',
        'pi.payment_status as paymentStatus',
        'pi.covers_purchase_orders as coversPurchaseOrders',
        'pi.notes',
        's.id as supplierId',
        's.name as supplierName',
        db.raw('DATEDIFF(CURDATE(), pi.invoice_date) as daysOutstanding')
      )
      .whereBetween('pi.invoice_date', [dateRange.from, dateRange.to]);

    // Apply filters
    if (supplier_id) {
      query = query.where('pi.supplier_id', supplier_id);
    }
    if (payment_status !== 'all') {
      query = query.where('pi.payment_status', payment_status);
    }
    if (bill_type !== 'all') {
      query = query.where('pi.bill_type', bill_type);
    }

    // Count for pagination
    const countQuery = db('purchase_invoices as pi')
      .whereBetween('pi.invoice_date', [dateRange.from, dateRange.to])
      .modify(qb => {
        if (supplier_id) qb.where('pi.supplier_id', supplier_id);
        if (payment_status !== 'all') qb.where('pi.payment_status', payment_status);
        if (bill_type !== 'all') qb.where('pi.bill_type', bill_type);
      });

    const [{ count: totalCount }] = await countQuery.count('pi.id as count');

    // Apply sorting
    const sortColumn = sort_by === 'amount' ? 'pi.invoice_amount' :
                       sort_by === 'supplier' ? 's.name' :
                       sort_by === 'daysOutstanding' ? 'daysOutstanding' :
                       'pi.invoice_date';
    query = query.orderBy(sortColumn, sort_order);

    // Apply pagination
    query = query.offset(offset).limit(limitValue);

    const records = await query;

    // Parse and enrich records
    const enrichedRecords = records.map(record => {
      // Parse covers_purchase_orders JSON
      let poCount = 0;
      let coversPOs = [];
      if (record.coversPurchaseOrders) {
        try {
          coversPOs = typeof record.coversPurchaseOrders === 'string'
            ? JSON.parse(record.coversPurchaseOrders)
            : record.coversPurchaseOrders;
          poCount = Array.isArray(coversPOs) ? coversPOs.length : 0;
        } catch (e) {
          poCount = 0;
        }
      }

      return {
        id: record.id,
        invoiceNumber: record.invoiceNumber,
        invoiceDate: record.invoiceDate,
        dueDate: record.dueDate,
        supplierName: record.supplierName || 'Unknown',
        supplierId: record.supplierId,
        invoiceAmount: parseFloat(record.invoiceAmount).toFixed(3),
        paidAmount: parseFloat(record.paidAmount || 0).toFixed(3),
        balanceDue: parseFloat(record.balanceDue || 0).toFixed(3),
        billType: record.billType,
        paymentStatus: record.paymentStatus,
        daysOutstanding: record.paymentStatus === 'paid' ? 0 : (record.daysOutstanding || 0),
        isMultiPo: poCount > 1,
        poCount: poCount,
        coversPurchaseOrders: coversPOs,
        notes: record.notes
      };
    });

    // Calculate summary
    const summaryQuery = await db('purchase_invoices as pi')
      .select(
        db.raw('SUM(pi.invoice_amount) as totalBilled'),
        db.raw('SUM(pi.paid_amount) as totalPaid'),
        db.raw('SUM(pi.balance_due) as totalOutstanding'),
        db.raw('COUNT(*) as billCount')
      )
      .whereBetween('pi.invoice_date', [dateRange.from, dateRange.to])
      .modify(qb => {
        if (supplier_id) qb.where('pi.supplier_id', supplier_id);
        if (payment_status !== 'all') qb.where('pi.payment_status', payment_status);
        if (bill_type !== 'all') qb.where('pi.bill_type', bill_type);
      })
      .first();

    // Count multi-PO bills
    const multiPoCount = enrichedRecords.filter(r => r.isMultiPo).length;

    const summary = {
      totalBilled: parseFloat(summaryQuery.totalBilled || 0).toFixed(3),
      totalPaid: parseFloat(summaryQuery.totalPaid || 0).toFixed(3),
      totalOutstanding: parseFloat(summaryQuery.totalOutstanding || 0).toFixed(3),
      billCount: parseInt(summaryQuery.billCount) || 0,
      multiPoBillCount: multiPoCount
    };

    res.json(formatReportResponse(enrichedRecords, summary, {
      page,
      limit: limitValue,
      total: parseInt(totalCount),
      pages: Math.ceil(totalCount / limitValue)
    }, dateRange));

  } catch (error) {
    logger.error('Vendor Bills Report Error:', error);
    res.status(500).json({ success: false, error: 'Failed to generate report' });
  }
});

/**
 * GET /api/reports/vendor-bills/export
 *
 * Export Vendor Bills to CSV or XLSX
 */
router.get('/vendor-bills/export', requirePermission('VIEW_REPORTS'), async (req, res) => {
  try {
    const { companyId } = req.user;
    const db = getDbConnection(companyId);

    const { value: exportParams } = exportSchema.validate(req.query);
    const { error, value: params } = vendorBillsSchema.validate(req.query);
    if (error) {
      return res.status(400).json({ success: false, error: error.details[0].message });
    }

    const { from_date, to_date, supplier_id, payment_status, bill_type } = params;
    const { format } = exportParams;
    const dateRange = buildDateRangeFilter(from_date, to_date);

    const records = await db('purchase_invoices as pi')
      .leftJoin('suppliers as s', 'pi.supplier_id', 's.id')
      .select(
        'pi.invoice_number as invoiceNumber',
        'pi.invoice_date as invoiceDate',
        'pi.due_date as dueDate',
        'pi.invoice_amount as invoiceAmount',
        'pi.paid_amount as paidAmount',
        'pi.balance_due as balanceDue',
        'pi.bill_type as billType',
        'pi.payment_status as paymentStatus',
        'pi.covers_purchase_orders as coversPurchaseOrders',
        's.name as supplierName',
        db.raw('DATEDIFF(CURDATE(), pi.invoice_date) as daysOutstanding')
      )
      .whereBetween('pi.invoice_date', [dateRange.from, dateRange.to])
      .modify(qb => {
        if (supplier_id) qb.where('pi.supplier_id', supplier_id);
        if (payment_status !== 'all') qb.where('pi.payment_status', payment_status);
        if (bill_type !== 'all') qb.where('pi.bill_type', bill_type);
      })
      .orderBy('pi.invoice_date', 'desc');

    const exportData = records.map(record => {
      let poCount = 0;
      if (record.coversPurchaseOrders) {
        try {
          const coversPOs = typeof record.coversPurchaseOrders === 'string'
            ? JSON.parse(record.coversPurchaseOrders)
            : record.coversPurchaseOrders;
          poCount = Array.isArray(coversPOs) ? coversPOs.length : 0;
        } catch (e) {}
      }

      return {
        'Invoice #': record.invoiceNumber,
        'Invoice Date': record.invoiceDate,
        'Due Date': record.dueDate || 'N/A',
        'Supplier': record.supplierName || 'Unknown',
        'Bill Type': record.billType === 'vendor' ? 'Vendor Bill' : 'Company Bill',
        'Amount (OMR)': parseFloat(record.invoiceAmount).toFixed(3),
        'Paid (OMR)': parseFloat(record.paidAmount || 0).toFixed(3),
        'Balance (OMR)': parseFloat(record.balanceDue || 0).toFixed(3),
        'Status': record.paymentStatus,
        'Days Outstanding': record.paymentStatus === 'paid' ? 0 : (record.daysOutstanding || 0),
        'PO Count': poCount,
        'Multi-PO': poCount > 1 ? 'Yes' : 'No'
      };
    });

    const filename = `Vendor_Bills_${dateRange.from}_to_${dateRange.to}`;

    if (format === 'xlsx') {
      exportToXlsx(exportData, filename, res);
    } else {
      exportToCsv(exportData, filename, res);
    }

  } catch (error) {
    logger.error('Vendor Bills Export Error:', error);
    res.status(500).json({ success: false, error: 'Export failed' });
  }
});

// ============================================================================
// REPORT 5: VAT RETURN
// ============================================================================
//
// Oman VAT filing — shows output VAT (from sales) and input VAT (from purchases)
// for a period, with net VAT payable.
// Standard Oman VAT rate: 5%
//
router.get('/vat-return', requirePermission('VIEW_REPORTS'), async (req, res) => {
  try {
    const { companyId } = req.user;
    const { error, value } = vatReturnSchema.validate(req.query);
    if (error) return res.status(400).json({ success: false, error: error.details[0].message });

    const db = getDbConnection(companyId);
    const { from, to } = buildDateRangeFilter(value.from_date, value.to_date);

    // Output VAT: from sales orders
    const salesRows = await db('sales_orders as s')
      .leftJoin('customers as c', 'c.id', 's.customerId')
      .whereBetween('s.orderDate', [from, to])
      .whereNot('s.status', 'cancelled')
      .select(
        's.id', 's.orderNumber', 's.orderDate',
        's.subtotal', 's.taxAmount as vatAmount', 's.totalAmount',
        's.paymentStatus',
        'c.id as customerId', 'c.name as customerName',
        'c.vatRegistration as customerVat', 'c.is_taxable as customerTaxable'
      )
      .orderBy('s.orderDate', 'asc');

    // Input VAT: from purchase orders
    const purchaseRows = await db('purchase_orders as p')
      .leftJoin('suppliers as sup', 'sup.id', 'p.supplierId')
      .whereBetween('p.orderDate', [from, to])
      .whereNot('p.status', 'cancelled')
      .select(
        'p.id', 'p.orderNumber', 'p.orderDate',
        'p.subtotal', 'p.taxAmount as vatAmount', 'p.totalAmount',
        'sup.id as supplierId', 'sup.name as supplierName',
        'sup.vatRegistration as supplierVat'
      )
      .orderBy('p.orderDate', 'asc');

    const outputVat = salesRows.reduce((s, r) => s + parseFloat(r.vatAmount || 0), 0);
    const outputTaxable = salesRows.reduce((s, r) => s + parseFloat(r.subtotal || 0), 0);
    const inputVat = purchaseRows.reduce((s, r) => s + parseFloat(r.vatAmount || 0), 0);
    const inputTaxable = purchaseRows.reduce((s, r) => s + parseFloat(r.subtotal || 0), 0);
    const netVatPayable = outputVat - inputVat;

    const summary = {
      period: `${from} to ${to}`,
      outputVat: parseFloat(outputVat.toFixed(3)),
      outputTaxable: parseFloat(outputTaxable.toFixed(3)),
      inputVat: parseFloat(inputVat.toFixed(3)),
      inputTaxable: parseFloat(inputTaxable.toFixed(3)),
      netVatPayable: parseFloat(netVatPayable.toFixed(3)),
      salesCount: salesRows.length,
      purchaseCount: purchaseRows.length,
      vatRate: 0.05
    };

    res.json({
      success: true,
      data: {
        summary,
        sales: salesRows,
        purchases: purchaseRows,
        dateRange: { from, to }
      }
    });
  } catch (error) {
    logger.error('VAT Return Report Error:', error);
    res.status(500).json({ success: false, error: 'Failed to generate VAT return' });
  }
});

router.get('/vat-return/export', requirePermission('VIEW_REPORTS'), async (req, res) => {
  try {
    const { companyId } = req.user;
    const db = getDbConnection(companyId);
    const { from, to } = buildDateRangeFilter(req.query.from_date, req.query.to_date);

    const sales = await db('sales_orders as s')
      .leftJoin('customers as c', 'c.id', 's.customerId')
      .whereBetween('s.orderDate', [from, to])
      .whereNot('s.status', 'cancelled')
      .select(
        's.orderNumber', 's.orderDate',
        'c.name as customerName', 'c.vatRegistration',
        's.subtotal', 's.taxAmount', 's.totalAmount'
      );

    const exportData = sales.map(s => ({
      'Invoice Number': s.orderNumber,
      'Date': s.orderDate,
      'Customer': s.customerName,
      'VAT Reg': s.vatRegistration || '',
      'Net': parseFloat(s.subtotal || 0).toFixed(3),
      'VAT (5%)': parseFloat(s.taxAmount || 0).toFixed(3),
      'Total': parseFloat(s.totalAmount || 0).toFixed(3)
    }));

    const format = req.query.format === 'xlsx' ? 'xlsx' : 'csv';
    const filename = `vat-return-${from}-to-${to}`;
    if (format === 'xlsx') exportToXlsx(exportData, filename, res);
    else exportToCsv(exportData, filename, res);
  } catch (error) {
    logger.error('VAT Return Export Error:', error);
    res.status(500).json({ success: false, error: 'Export failed' });
  }
});

// ============================================================================
// REPORT 6: RECEIVABLES AGING
// ============================================================================
//
// Unpaid sales orders bucketed by age (0-30, 31-60, 61-90, 90+).
// Per-customer totals and grand total.
//
router.get('/receivables-aging', requirePermission('VIEW_REPORTS'), async (req, res) => {
  try {
    const { companyId } = req.user;
    const { error, value } = receivablesAgingSchema.validate(req.query);
    if (error) return res.status(400).json({ success: false, error: error.details[0].message });

    const db = getDbConnection(companyId);
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    let query = db('sales_orders as s')
      .leftJoin('customers as c', 'c.id', 's.customerId')
      .whereNot('s.status', 'cancelled')
      .select(
        's.id', 's.orderNumber', 's.orderDate',
        's.totalAmount', 's.paymentStatus',
        'c.id as customerId', 'c.name as customerName',
        'c.paymentTermDays'
      );

    if (!value.include_paid) {
      query = query.whereIn('s.paymentStatus', ['pending', 'partial', 'overdue']);
    }
    if (value.customer_id) {
      query = query.where('s.customerId', value.customer_id);
    }

    const orders = await query.orderBy('s.orderDate', 'asc');

    // Compute aging buckets
    const buckets = {
      current: { label: '0-30 days', count: 0, total: 0, orders: [] },
      bucket_31_60: { label: '31-60 days', count: 0, total: 0, orders: [] },
      bucket_61_90: { label: '61-90 days', count: 0, total: 0, orders: [] },
      bucket_90_plus: { label: '90+ days', count: 0, total: 0, orders: [] }
    };

    const enriched = orders.map(o => {
      const orderDate = new Date(o.orderDate);
      const ageDays = Math.floor((today - orderDate) / (1000 * 60 * 60 * 24));
      const amount = parseFloat(o.totalAmount || 0);
      let bucket;
      if (ageDays <= 30) bucket = 'current';
      else if (ageDays <= 60) bucket = 'bucket_31_60';
      else if (ageDays <= 90) bucket = 'bucket_61_90';
      else bucket = 'bucket_90_plus';

      buckets[bucket].count += 1;
      buckets[bucket].total += amount;
      buckets[bucket].orders.push(o.id);

      return { ...o, ageDays, bucket };
    });

    // Per-customer grouping
    const byCustomer = {};
    enriched.forEach(o => {
      const key = o.customerId || 'unknown';
      if (!byCustomer[key]) {
        byCustomer[key] = {
          customerId: o.customerId,
          customerName: o.customerName || 'Unknown',
          current: 0, bucket_31_60: 0, bucket_61_90: 0, bucket_90_plus: 0,
          total: 0, orderCount: 0
        };
      }
      byCustomer[key][o.bucket] += parseFloat(o.totalAmount || 0);
      byCustomer[key].total += parseFloat(o.totalAmount || 0);
      byCustomer[key].orderCount += 1;
    });

    // Round everything
    Object.values(buckets).forEach(b => { b.total = parseFloat(b.total.toFixed(3)); });
    Object.values(byCustomer).forEach(c => {
      c.current = parseFloat(c.current.toFixed(3));
      c.bucket_31_60 = parseFloat(c.bucket_31_60.toFixed(3));
      c.bucket_61_90 = parseFloat(c.bucket_61_90.toFixed(3));
      c.bucket_90_plus = parseFloat(c.bucket_90_plus.toFixed(3));
      c.total = parseFloat(c.total.toFixed(3));
    });

    const grandTotal = enriched.reduce((s, o) => s + parseFloat(o.totalAmount || 0), 0);

    res.json({
      success: true,
      data: {
        summary: {
          asOf: todayStr,
          grandTotal: parseFloat(grandTotal.toFixed(3)),
          orderCount: enriched.length,
          buckets: Object.values(buckets).map(b => ({ label: b.label, count: b.count, total: b.total }))
        },
        byCustomer: Object.values(byCustomer).sort((a, b) => b.total - a.total),
        records: enriched
      }
    });
  } catch (error) {
    logger.error('Receivables Aging Report Error:', error);
    res.status(500).json({ success: false, error: 'Failed to generate receivables aging' });
  }
});

router.get('/receivables-aging/export', requirePermission('VIEW_REPORTS'), async (req, res) => {
  try {
    const { companyId } = req.user;
    const db = getDbConnection(companyId);
    const today = new Date();

    const orders = await db('sales_orders as s')
      .leftJoin('customers as c', 'c.id', 's.customerId')
      .whereNot('s.status', 'cancelled')
      .whereIn('s.paymentStatus', ['pending', 'partial', 'overdue'])
      .select(
        's.orderNumber', 's.orderDate',
        's.totalAmount', 's.paymentStatus',
        'c.name as customerName'
      );

    const exportData = orders.map(o => {
      const ageDays = Math.floor((today - new Date(o.orderDate)) / (1000 * 60 * 60 * 24));
      let bucket = '0-30';
      if (ageDays > 90) bucket = '90+';
      else if (ageDays > 60) bucket = '61-90';
      else if (ageDays > 30) bucket = '31-60';

      return {
        'Invoice': o.orderNumber,
        'Date': o.orderDate,
        'Customer': o.customerName,
        'Age (days)': ageDays,
        'Bucket': bucket,
        'Amount': parseFloat(o.totalAmount || 0).toFixed(3),
        'Status': o.paymentStatus
      };
    });

    const format = req.query.format === 'xlsx' ? 'xlsx' : 'csv';
    const filename = `receivables-aging-${today.toISOString().split('T')[0]}`;
    if (format === 'xlsx') exportToXlsx(exportData, filename, res);
    else exportToCsv(exportData, filename, res);
  } catch (error) {
    logger.error('Receivables Aging Export Error:', error);
    res.status(500).json({ success: false, error: 'Export failed' });
  }
});

// ============================================================================
// REPORT 7: PROFIT & LOSS
// ============================================================================
//
// Net Profit = Revenue - COGS - Operating Expenses - Wastage Cost
// Grouped by period (month/quarter/year/none)
//
router.get('/profit-loss', requirePermission('VIEW_REPORTS'), async (req, res) => {
  try {
    const { companyId } = req.user;
    const { error, value } = profitLossSchema.validate(req.query);
    if (error) return res.status(400).json({ success: false, error: error.details[0].message });

    const db = getDbConnection(companyId);
    const { from, to } = buildDateRangeFilter(value.from_date, value.to_date);

    // Revenue: sales orders (excluding cancelled)
    const [{ revenue }] = await db('sales_orders')
      .whereBetween('orderDate', [from, to])
      .whereNot('status', 'cancelled')
      .sum('totalAmount as revenue');

    // COGS: purchase orders (excluding cancelled)
    const [{ cogs }] = await db('purchase_orders')
      .whereBetween('orderDate', [from, to])
      .whereNot('status', 'cancelled')
      .sum('totalAmount as cogs');

    // Operating expenses: collection expenses (fuel, transport, etc.)
    let collectionOpEx = 0;
    try {
      const [{ sum }] = await db('collection_expenses')
        .whereBetween('expenseDate', [from, to])
        .sum('amount as sum');
      collectionOpEx = parseFloat(sum || 0);
    } catch (e) { /* table may not exist in some deployments */ }

    // Petty cash expenses (approved only)
    let pettyCashOpEx = 0;
    try {
      const [{ sum }] = await db('petty_cash_expenses')
        .whereBetween('expenseDate', [from, to])
        .where('status', 'approved')
        .sum('amount as sum');
      pettyCashOpEx = parseFloat(sum || 0);
    } catch (e) { /* ignore */ }

    // Vehicle daily expense sheets (approved only)
    let vehicleOpEx = 0;
    try {
      const [{ sum }] = await db('vehicle_daily_expense_sheets')
        .whereBetween('sheet_date', [from, to])
        .whereIn('status', ['approved', 'closed'])
        .sum('total_expenses as sum');
      vehicleOpEx = parseFloat(sum || 0);
    } catch (e) { /* ignore */ }

    // Wastage cost (approved wastages)
    let wastageCost = 0;
    try {
      const [{ sum }] = await db('wastages')
        .whereBetween('wastageDate', [from, to])
        .where('status', 'approved')
        .sum('cost as sum');
      wastageCost = parseFloat(sum || 0);
    } catch (e) { /* ignore */ }

    const revenueValue = parseFloat(revenue || 0);
    const cogsValue = parseFloat(cogs || 0);
    const totalOpEx = collectionOpEx + pettyCashOpEx + vehicleOpEx;
    const grossProfit = revenueValue - cogsValue;
    const netProfit = grossProfit - totalOpEx - wastageCost;
    const grossMargin = revenueValue > 0 ? (grossProfit / revenueValue) * 100 : 0;
    const netMargin = revenueValue > 0 ? (netProfit / revenueValue) * 100 : 0;

    // Monthly breakdown if requested
    let breakdown = [];
    if (value.group_by === 'month') {
      const monthlyRevenue = await db('sales_orders')
        .whereBetween('orderDate', [from, to])
        .whereNot('status', 'cancelled')
        .select(db.raw("DATE_FORMAT(orderDate, '%Y-%m') as period"))
        .sum('totalAmount as revenue')
        .groupBy('period');

      const monthlyCogs = await db('purchase_orders')
        .whereBetween('orderDate', [from, to])
        .whereNot('status', 'cancelled')
        .select(db.raw("DATE_FORMAT(orderDate, '%Y-%m') as period"))
        .sum('totalAmount as cogs')
        .groupBy('period');

      const periods = new Set([
        ...monthlyRevenue.map(r => r.period),
        ...monthlyCogs.map(r => r.period)
      ]);

      breakdown = [...periods].sort().map(period => {
        const rev = parseFloat(monthlyRevenue.find(r => r.period === period)?.revenue || 0);
        const cg = parseFloat(monthlyCogs.find(r => r.period === period)?.cogs || 0);
        return {
          period,
          revenue: parseFloat(rev.toFixed(3)),
          cogs: parseFloat(cg.toFixed(3)),
          grossProfit: parseFloat((rev - cg).toFixed(3))
        };
      });
    }

    res.json({
      success: true,
      data: {
        summary: {
          period: `${from} to ${to}`,
          revenue: parseFloat(revenueValue.toFixed(3)),
          cogs: parseFloat(cogsValue.toFixed(3)),
          grossProfit: parseFloat(grossProfit.toFixed(3)),
          grossMargin: parseFloat(grossMargin.toFixed(2)),
          operatingExpenses: {
            collection: parseFloat(collectionOpEx.toFixed(3)),
            pettyCash: parseFloat(pettyCashOpEx.toFixed(3)),
            vehicle: parseFloat(vehicleOpEx.toFixed(3)),
            total: parseFloat(totalOpEx.toFixed(3))
          },
          wastageCost: parseFloat(wastageCost.toFixed(3)),
          netProfit: parseFloat(netProfit.toFixed(3)),
          netMargin: parseFloat(netMargin.toFixed(2))
        },
        breakdown,
        dateRange: { from, to }
      }
    });
  } catch (error) {
    logger.error('Profit & Loss Report Error:', error);
    res.status(500).json({ success: false, error: 'Failed to generate P&L statement' });
  }
});

module.exports = router;
