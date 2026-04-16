const express = require('express');
const { requirePermission } = require('../middleware/auth');
const { logger } = require('../utils/logger');
const { getDbConnection } = require('../config/database');

const router = express.Router();

// Helper: get today's date range and month-to-date range
function getDateRanges() {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const yearStart = new Date(now.getFullYear(), 0, 1).toISOString().split('T')[0];
  return { today, monthStart, yearStart };
}

// ============================================================================
// EXECUTIVE DASHBOARD — Owner/GM strategic view
// ============================================================================
router.get('/executive', requirePermission('VIEW_DASHBOARD'), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const { today, monthStart, yearStart } = getDateRanges();

    // Today's sales + MTD + YTD revenue
    const [todayRev] = await db('sales_orders').where('orderDate', today).whereNot('status', 'cancelled').sum('totalAmount as total');
    const [mtdRev] = await db('sales_orders').whereBetween('orderDate', [monthStart, today]).whereNot('status', 'cancelled').sum('totalAmount as total');
    const [ytdRev] = await db('sales_orders').whereBetween('orderDate', [yearStart, today]).whereNot('status', 'cancelled').sum('totalAmount as total');

    // MTD COGS + P&L snapshot
    const [mtdCogs] = await db('purchase_orders').whereBetween('orderDate', [monthStart, today]).whereNot('status', 'cancelled').sum('totalAmount as total');
    const mtdGrossProfit = parseFloat(mtdRev.total || 0) - parseFloat(mtdCogs.total || 0);

    // Outstanding receivables (unpaid sales)
    const [receivables] = await db('sales_orders').whereIn('paymentStatus', ['pending', 'partial', 'overdue']).whereNot('status', 'cancelled').sum('totalAmount as total');

    // Top 5 customers by MTD revenue
    const topCustomers = await db('sales_orders as s')
      .leftJoin('customers as c', 'c.id', 's.customerId')
      .whereBetween('s.orderDate', [monthStart, today])
      .whereNot('s.status', 'cancelled')
      .select('c.id', 'c.name', db.raw('SUM(s.totalAmount) as total'), db.raw('COUNT(s.id) as orderCount'))
      .groupBy('c.id', 'c.name')
      .orderBy('total', 'desc')
      .limit(5);

    // Top 5 suppliers by MTD volume
    const topSuppliers = await db('purchase_orders as p')
      .leftJoin('suppliers as sup', 'sup.id', 'p.supplierId')
      .whereBetween('p.orderDate', [monthStart, today])
      .whereNot('p.status', 'cancelled')
      .select('sup.id', 'sup.name', db.raw('SUM(p.totalAmount) as total'), db.raw('COUNT(p.id) as orderCount'))
      .groupBy('sup.id', 'sup.name')
      .orderBy('total', 'desc')
      .limit(5);

    // Vehicle status
    let vehicleStats = { active: 0, inactive: 0, under_maintenance: 0 };
    try {
      const stats = await db('vehicles').groupBy('status').select('status', db.raw('COUNT(*) as count'));
      stats.forEach(s => { vehicleStats[s.status] = parseInt(s.count); });
    } catch (e) { /* table may not exist */ }

    // Pending WCN finalizations
    const [pendingWcn] = await db('collection_orders').where('status', 'completed').where('is_finalized', 0).count('id as count');

    // Document expiry alerts (within 30 days)
    let expiringDocs = 0;
    try {
      const future = new Date(); future.setDate(future.getDate() + 30);
      const futureStr = future.toISOString().split('T')[0];
      const [count] = await db('employee_documents').whereNotNull('expiry_date').where('expiry_date', '<=', futureStr).count('id as count');
      expiringDocs = parseInt(count.count);
    } catch (e) { /* ignore */ }

    // Revenue trend (last 6 months)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const trendFrom = sixMonthsAgo.toISOString().split('T')[0];
    const revenueTrend = await db('sales_orders')
      .whereBetween('orderDate', [trendFrom, today])
      .whereNot('status', 'cancelled')
      .select(db.raw("DATE_FORMAT(orderDate, '%Y-%m') as month"), db.raw('SUM(totalAmount) as revenue'))
      .groupBy('month')
      .orderBy('month', 'asc');

    res.json({
      success: true,
      data: {
        kpis: {
          todayRevenue: parseFloat(todayRev.total || 0),
          mtdRevenue: parseFloat(mtdRev.total || 0),
          ytdRevenue: parseFloat(ytdRev.total || 0),
          mtdCogs: parseFloat(mtdCogs.total || 0),
          mtdGrossProfit: parseFloat(mtdGrossProfit.toFixed(3)),
          outstandingReceivables: parseFloat(receivables.total || 0),
          pendingWcn: parseInt(pendingWcn.count),
          expiringDocuments: expiringDocs
        },
        topCustomers: topCustomers.map(c => ({ ...c, total: parseFloat(c.total), orderCount: parseInt(c.orderCount) })),
        topSuppliers: topSuppliers.map(s => ({ ...s, total: parseFloat(s.total), orderCount: parseInt(s.orderCount) })),
        vehicles: vehicleStats,
        revenueTrend: revenueTrend.map(r => ({ month: r.month, revenue: parseFloat(r.revenue) }))
      }
    });
  } catch (error) {
    logger.error('Executive dashboard error', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to load executive dashboard' });
  }
});

// ============================================================================
// OPERATIONS DASHBOARD — Manager view
// ============================================================================
router.get('/operations', requirePermission('VIEW_DASHBOARD'), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const { today } = getDateRanges();

    // Today's scheduled collections grouped by driver
    const todaySchedule = await db('collection_orders as co')
      .leftJoin('callouts as ca', 'ca.id', 'co.calloutId')
      .leftJoin('employees as drv', 'drv.id', 'co.driver_employee_id')
      .leftJoin('vehicles as v', 'v.id', 'co.vehicle_id')
      .where('co.scheduledDate', today)
      .select(
        'co.id', 'co.orderNumber', 'co.status', 'co.is_finalized',
        'co.driverName', 'co.vehiclePlate',
        'drv.full_name as driver_full_name',
        'v.make as vehicle_make', 'v.model as vehicle_model'
      )
      .orderBy('co.id');

    // Pending approvals count
    const [pendingWcn] = await db('collection_orders').where('status', 'completed').where('is_finalized', 0).count('id as count');
    let pendingWastage = 0;
    try {
      const [c] = await db('wastages').where('status', 'pending').count('id as count');
      pendingWastage = parseInt(c.count);
    } catch (e) {}

    let pendingExpenseSheets = 0;
    try {
      const [c] = await db('vehicle_daily_expense_sheets').where('status', 'submitted').count('id as count');
      pendingExpenseSheets = parseInt(c.count);
    } catch (e) {}

    let pendingPettyCash = 0;
    try {
      const [c] = await db('petty_cash_expenses').where('status', 'pending').count('id as count');
      pendingPettyCash = parseInt(c.count);
    } catch (e) {}

    // Vehicle status
    let vehicles = { active: 0, inactive: 0, under_maintenance: 0, total: 0 };
    try {
      const stats = await db('vehicles').groupBy('status').select('status', db.raw('COUNT(*) as count'));
      stats.forEach(s => { vehicles[s.status] = parseInt(s.count); vehicles.total += parseInt(s.count); });
    } catch (e) {}

    // Driver productivity (last 7 days)
    const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
    const weekStr = weekAgo.toISOString().split('T')[0];
    const driverProductivity = await db('collection_orders as co')
      .leftJoin('employees as drv', 'drv.id', 'co.driver_employee_id')
      .whereBetween('co.scheduledDate', [weekStr, today])
      .where('co.is_finalized', 1)
      .select(
        db.raw('COALESCE(drv.full_name, co.driverName) as driver_name'),
        db.raw('COUNT(co.id) as collections'),
        db.raw('SUM(co.totalValue) as totalValue')
      )
      .groupBy('driver_name')
      .orderBy('collections', 'desc')
      .limit(10);

    res.json({
      success: true,
      data: {
        todaySchedule,
        pendingApprovals: {
          wcn: parseInt(pendingWcn.count),
          wastage: pendingWastage,
          expenseSheets: pendingExpenseSheets,
          pettyCash: pendingPettyCash,
          total: parseInt(pendingWcn.count) + pendingWastage + pendingExpenseSheets + pendingPettyCash
        },
        vehicles,
        driverProductivity: driverProductivity.map(d => ({
          driver_name: d.driver_name,
          collections: parseInt(d.collections),
          totalValue: parseFloat(d.totalValue || 0)
        }))
      }
    });
  } catch (error) {
    logger.error('Operations dashboard error', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to load operations dashboard' });
  }
});

// ============================================================================
// ACCOUNTANT DASHBOARD — Accounts Staff view
// ============================================================================
router.get('/accountant', requirePermission('VIEW_DASHBOARD'), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const { today, monthStart } = getDateRanges();

    // Receivables aging buckets
    const unpaid = await db('sales_orders as s')
      .leftJoin('customers as c', 'c.id', 's.customerId')
      .whereIn('s.paymentStatus', ['pending', 'partial', 'overdue'])
      .whereNot('s.status', 'cancelled')
      .select('s.id', 's.orderNumber', 's.orderDate', 's.totalAmount', 's.paymentStatus', 'c.name as customerName');

    const now = new Date();
    const buckets = { current: 0, bucket_31_60: 0, bucket_61_90: 0, bucket_90_plus: 0 };
    const overdueList = [];
    unpaid.forEach(o => {
      const age = Math.floor((now - new Date(o.orderDate)) / (1000 * 60 * 60 * 24));
      const amt = parseFloat(o.totalAmount || 0);
      if (age <= 30) buckets.current += amt;
      else if (age <= 60) buckets.bucket_31_60 += amt;
      else if (age <= 90) buckets.bucket_61_90 += amt;
      else { buckets.bucket_90_plus += amt; overdueList.push({ ...o, ageDays: age }); }
    });

    // MTD VAT snapshot
    const [mtdOutputVat] = await db('sales_orders').whereBetween('orderDate', [monthStart, today]).whereNot('status', 'cancelled').sum('taxAmount as total');
    const [mtdInputVat] = await db('purchase_orders').whereBetween('orderDate', [monthStart, today]).whereNot('status', 'cancelled').sum('taxAmount as total');

    // Pending approvals (accountant-relevant)
    let pendingPettyCash = 0;
    try {
      const [c] = await db('petty_cash_expenses').where('status', 'pending').count('id as count');
      pendingPettyCash = parseInt(c.count);
    } catch (e) {}

    let pendingExpenseSheets = 0;
    try {
      const [c] = await db('vehicle_daily_expense_sheets').where('status', 'submitted').count('id as count');
      pendingExpenseSheets = parseInt(c.count);
    } catch (e) {}

    // Today's receipts & payments
    let todayReceipts = 0;
    let todayPayments = 0;
    try {
      const [rcpt] = await db('bank_transactions').where('transactionDate', today).where('transactionType', 'credit').sum('amount as total');
      todayReceipts = parseFloat(rcpt.total || 0);
      const [pmt] = await db('bank_transactions').where('transactionDate', today).where('transactionType', 'debit').sum('amount as total');
      todayPayments = parseFloat(pmt.total || 0);
    } catch (e) {}

    res.json({
      success: true,
      data: {
        receivables: {
          total: Object.values(buckets).reduce((s, v) => s + v, 0),
          buckets: {
            current: parseFloat(buckets.current.toFixed(3)),
            bucket_31_60: parseFloat(buckets.bucket_31_60.toFixed(3)),
            bucket_61_90: parseFloat(buckets.bucket_61_90.toFixed(3)),
            bucket_90_plus: parseFloat(buckets.bucket_90_plus.toFixed(3))
          },
          overdueList: overdueList.slice(0, 10)
        },
        vat: {
          mtdOutputVat: parseFloat(mtdOutputVat.total || 0),
          mtdInputVat: parseFloat(mtdInputVat.total || 0),
          mtdNetVat: parseFloat((mtdOutputVat.total || 0) - (mtdInputVat.total || 0))
        },
        pendingApprovals: {
          pettyCash: pendingPettyCash,
          expenseSheets: pendingExpenseSheets,
          total: pendingPettyCash + pendingExpenseSheets
        },
        todayCashFlow: {
          receipts: todayReceipts,
          payments: todayPayments,
          net: todayReceipts - todayPayments
        }
      }
    });
  } catch (error) {
    logger.error('Accountant dashboard error', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to load accountant dashboard' });
  }
});

// ============================================================================
// SALES DASHBOARD — Sales Staff view
// ============================================================================
router.get('/sales', requirePermission('VIEW_DASHBOARD'), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const { today, monthStart, yearStart } = getDateRanges();

    // Today's / MTD / YTD sales
    const [todaySales] = await db('sales_orders').where('orderDate', today).whereNot('status', 'cancelled').sum('totalAmount as total').count('id as count');
    const [mtdSales] = await db('sales_orders').whereBetween('orderDate', [monthStart, today]).whereNot('status', 'cancelled').sum('totalAmount as total').count('id as count');
    const [ytdSales] = await db('sales_orders').whereBetween('orderDate', [yearStart, today]).whereNot('status', 'cancelled').sum('totalAmount as total').count('id as count');

    // Pending invoices (unpaid)
    const [unpaid] = await db('sales_orders').whereIn('paymentStatus', ['pending', 'partial', 'overdue']).whereNot('status', 'cancelled').sum('totalAmount as total').count('id as count');

    // Top 5 customers YTD
    const topCustomers = await db('sales_orders as s')
      .leftJoin('customers as c', 'c.id', 's.customerId')
      .whereBetween('s.orderDate', [yearStart, today])
      .whereNot('s.status', 'cancelled')
      .select('c.id', 'c.name', db.raw('SUM(s.totalAmount) as total'), db.raw('COUNT(s.id) as orderCount'))
      .groupBy('c.id', 'c.name')
      .orderBy('total', 'desc')
      .limit(5);

    // Recent sales (last 10)
    const recentSales = await db('sales_orders as s')
      .leftJoin('customers as c', 'c.id', 's.customerId')
      .whereNot('s.status', 'cancelled')
      .select('s.id', 's.orderNumber', 's.orderDate', 's.totalAmount', 's.paymentStatus', 'c.name as customerName')
      .orderBy('s.orderDate', 'desc')
      .orderBy('s.id', 'desc')
      .limit(10);

    // Inventory availability (low stock alert)
    let lowStock = [];
    try {
      lowStock = await db('inventory as i')
        .leftJoin('materials as m', 'm.id', 'i.materialId')
        .whereRaw('i.quantity <= i.minimumStockLevel')
        .where('i.minimumStockLevel', '>', 0)
        .select('m.name', 'i.quantity', 'i.minimumStockLevel')
        .limit(10);
    } catch (e) {}

    res.json({
      success: true,
      data: {
        sales: {
          todayTotal: parseFloat(todaySales.total || 0),
          todayCount: parseInt(todaySales.count),
          mtdTotal: parseFloat(mtdSales.total || 0),
          mtdCount: parseInt(mtdSales.count),
          ytdTotal: parseFloat(ytdSales.total || 0),
          ytdCount: parseInt(ytdSales.count)
        },
        pendingInvoices: {
          total: parseFloat(unpaid.total || 0),
          count: parseInt(unpaid.count)
        },
        topCustomers: topCustomers.map(c => ({
          ...c,
          total: parseFloat(c.total),
          orderCount: parseInt(c.orderCount)
        })),
        recentSales: recentSales.map(s => ({ ...s, totalAmount: parseFloat(s.totalAmount || 0) })),
        lowStock: lowStock.map(l => ({ ...l, quantity: parseFloat(l.quantity), minimumStockLevel: parseFloat(l.minimumStockLevel) }))
      }
    });
  } catch (error) {
    logger.error('Sales dashboard error', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to load sales dashboard' });
  }
});

module.exports = router;
