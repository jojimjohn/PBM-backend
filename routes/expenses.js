const express = require('express');
const { validate, validateParams, sanitize } = require('../middleware/validation');
const { requirePermission } = require('../middleware/auth');
const { logger, auditLog } = require('../utils/logger');
const { getDbConnection } = require('../config/database');
const Joi = require('joi');

const router = express.Router();

// Apply sanitization to all routes
router.use(sanitize);

// Unified expense validation schema
const unifiedExpenseSchema = Joi.object({
  referenceId: Joi.number().integer().positive().required(),
  referenceType: Joi.string().valid('purchase_order', 'collection_order').required(),
  expenseType: Joi.string().valid('purchase', 'collection').required(),
  category: Joi.string().valid(
    // Purchase expense categories
    'transportation', 'loading_unloading', 'customs_duty', 'inspection',
    'storage', 'insurance', 'documentation',
    // Collection expense categories (additional)
    'fuel', 'permits_fees', 'equipment_rental', 'meals_accommodation', 'maintenance',
    // Common category
    'other'
  ).required(),
  description: Joi.string().trim().min(1).max(500).required(),
  amount: Joi.number().min(0.01).precision(3).required(),
  currency: Joi.string().length(3).default('OMR'),
  vendor: Joi.string().trim().max(200).allow('').optional(),
  receiptNumber: Joi.string().trim().max(100).allow('').optional(),
  receiptPhoto: Joi.string().max(500).allow('').optional(),
  paidBy: Joi.string().max(100).allow('').optional(),
  paymentMethod: Joi.string().valid('cash', 'card', 'bank_transfer', 'company_account').default('cash'),
  expenseDate: Joi.date().required(),
  notes: Joi.string().trim().max(1000).allow('').optional()
});

// Bulk expense creation schema
const bulkExpenseSchema = Joi.object({
  referenceId: Joi.number().integer().positive().required(),
  referenceType: Joi.string().valid('purchase_order', 'collection_order').required(),
  expenseType: Joi.string().valid('purchase', 'collection').required(),
  expenses: Joi.array().items(
    Joi.object({
      category: Joi.string().valid(
        // Purchase expense categories
        'transportation', 'loading_unloading', 'customs_duty', 'inspection',
        'storage', 'insurance', 'documentation',
        // Collection expense categories (additional)
        'fuel', 'permits_fees', 'equipment_rental', 'meals_accommodation', 'maintenance',
        // Common category
        'other'
      ).required(),
      description: Joi.string().trim().min(1).max(500).required(),
      amount: Joi.number().min(0.01).precision(3).required(),
      currency: Joi.string().length(3).default('OMR'),
      vendor: Joi.string().trim().max(200).allow('').optional(),
      receiptNumber: Joi.string().trim().max(100).allow('').optional(),
      receiptPhoto: Joi.string().max(500).allow('').optional(),
      paidBy: Joi.string().max(100).allow('').optional(),
      paymentMethod: Joi.string().valid('cash', 'card', 'bank_transfer', 'company_account').default('cash'),
      expenseDate: Joi.date().required(),
      notes: Joi.string().trim().max(1000).allow('').optional()
    })
  ).min(1).required(),
  totalAmount: Joi.number().min(0).precision(3).required()
});

// GET /api/expenses - List all expenses with filtering
router.get('/', requirePermission('VIEW_PURCHASE'), async (req, res) => {
  try {
    const { companyId } = req.user;
    const db = getDbConnection(companyId);
    
    const { 
      page = 1, 
      limit = 50, 
      search = '', 
      expenseType = '',
      referenceId = '',
      category = '',
      fromDate = '',
      toDate = ''
    } = req.query;

    const offset = (page - 1) * limit;
    
    let query = db('unified_expenses')
      .leftJoin('purchase_orders', function() {
        this.on('unified_expenses.referenceId', '=', 'purchase_orders.id')
            .andOn('unified_expenses.referenceType', '=', db.raw('?', ['purchase_order']));
      })
      .leftJoin('collection_orders', function() {
        this.on('unified_expenses.referenceId', '=', 'collection_orders.id')
            .andOn('unified_expenses.referenceType', '=', db.raw('?', ['collection_order']));
      })
      .leftJoin('suppliers', 'purchase_orders.supplierId', 'suppliers.id')
      .leftJoin('supplier_locations', 'collection_orders.locationId', 'supplier_locations.id')
      .select(
        'unified_expenses.*',
        'purchase_orders.orderNumber as purchaseOrderNumber',
        'collection_orders.orderNumber as collectionOrderNumber',
        'suppliers.name as supplierName',
        'supplier_locations.locationName as locationName'
      );

    // Search filter
    if (search) {
      query = query.where(function() {
        this.where('unified_expenses.description', 'like', `%${search}%`)
            .orWhere('unified_expenses.vendor', 'like', `%${search}%`)
            .orWhere('purchase_orders.orderNumber', 'like', `%${search}%`)
            .orWhere('collection_orders.orderNumber', 'like', `%${search}%`)
            .orWhere('suppliers.name', 'like', `%${search}%`)
            .orWhere('supplier_locations.locationName', 'like', `%${search}%`);
      });
    }

    // Expense type filter
    if (expenseType) {
      query = query.where('unified_expenses.expenseType', expenseType);
    }

    // Reference ID filter
    if (referenceId) {
      query = query.where('unified_expenses.referenceId', referenceId);
    }

    // Category filter
    if (category) {
      query = query.where('unified_expenses.category', category);
    }

    // Date range filter
    if (fromDate) {
      query = query.where('unified_expenses.expenseDate', '>=', fromDate);
    }
    if (toDate) {
      query = query.where('unified_expenses.expenseDate', '<=', toDate);
    }

    // Get total count for pagination
    const totalQuery = query.clone();
    const totalCount = await totalQuery.count('* as count').first();
    const total = parseInt(totalCount.count);

    // Get paginated results
    const expenses = await query
      .orderBy('unified_expenses.expenseDate', 'desc')
      .offset(offset)
      .limit(parseInt(limit));

    // Calculate summary
    const summaryQuery = db('unified_expenses')
      .select(
        db.raw('SUM(amount) as totalAmount'),
        db.raw('COUNT(*) as totalCount'),
        db.raw('AVG(amount) as averageAmount'),
        db.raw('SUM(CASE WHEN expenseType = ? THEN amount ELSE 0 END) as purchaseTotal', ['purchase']),
        db.raw('SUM(CASE WHEN expenseType = ? THEN amount ELSE 0 END) as collectionTotal', ['collection'])
      );

    if (expenseType) {
      summaryQuery.where('expenseType', expenseType);
    }
    if (referenceId) {
      summaryQuery.where('referenceId', referenceId);
    }
    
    const summary = await summaryQuery.first();

    res.json({
      success: true,
      data: expenses,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      },
      summary: {
        totalAmount: parseFloat(summary.totalAmount) || 0,
        totalCount: parseInt(summary.totalCount) || 0,
        averageAmount: parseFloat(summary.averageAmount) || 0,
        purchaseTotal: parseFloat(summary.purchaseTotal) || 0,
        collectionTotal: parseFloat(summary.collectionTotal) || 0
      }
    });

  } catch (error) {
    logger.error('Error fetching expenses', { error: error.message, stack: error.stack });
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// GET /api/expenses/:id - Get specific expense
router.get('/:id', requirePermission('VIEW_PURCHASE'), validateParams(['id']), async (req, res) => {
  try {
    const { companyId } = req.user;
    const { id } = req.params;
    const db = getDbConnection(companyId);

    const expense = await db('unified_expenses')
      .leftJoin('purchase_orders', function() {
        this.on('unified_expenses.referenceId', '=', 'purchase_orders.id')
            .andOn('unified_expenses.referenceType', '=', db.raw('?', ['purchase_order']));
      })
      .leftJoin('collection_orders', function() {
        this.on('unified_expenses.referenceId', '=', 'collection_orders.id')
            .andOn('unified_expenses.referenceType', '=', db.raw('?', ['collection_order']));
      })
      .leftJoin('suppliers', 'purchase_orders.supplierId', 'suppliers.id')
      .leftJoin('supplier_locations', 'collection_orders.locationId', 'supplier_locations.id')
      .select(
        'unified_expenses.*',
        'purchase_orders.orderNumber as purchaseOrderNumber',
        'purchase_orders.orderDate as purchaseOrderDate',
        'collection_orders.orderNumber as collectionOrderNumber',
        'collection_orders.orderDate as collectionOrderDate',
        'suppliers.name as supplierName',
        'supplier_locations.locationName as locationName'
      )
      .where('unified_expenses.id', id)
      .first();

    if (!expense) {
      return res.status(404).json({
        success: false,
        error: 'Expense not found'
      });
    }

    res.json({
      success: true,
      data: expense
    });

  } catch (error) {
    logger.error('Error fetching expense', { error: error.message, expenseId: req.params.id });
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// POST /api/expenses - Create expenses (bulk)
router.post('/', requirePermission('CREATE_PURCHASE'), validate(bulkExpenseSchema), async (req, res) => {
  const { companyId, userId } = req.user;
  const { referenceId, referenceType, expenseType, expenses, totalAmount } = req.body;
  const db = getDbConnection(companyId);

  try {
    // Start transaction
    await db.transaction(async (trx) => {
      // Verify reference exists and belongs to company
      let referenceOrder;
      let orderNumberField;
      
      if (referenceType === 'purchase_order') {
        referenceOrder = await trx('purchase_orders')
          .where({ id: referenceId })
          .first();
        orderNumberField = 'orderNumber';
      } else if (referenceType === 'collection_order') {
        referenceOrder = await trx('collection_orders')
          .where({ id: referenceId })
          .first();
        orderNumberField = 'orderNumber';
      }

      if (!referenceOrder) {
        throw new Error(`${referenceType.replace('_', ' ')} not found`);
      }

      // Create expense entries
      const expenseEntries = expenses.map(expense => ({
        ...expense,
        referenceId,
        referenceType,
        expenseType,
        createdBy: userId,
        updatedBy: userId,
        createdAt: new Date(),
        updatedAt: new Date()
      }));

      const insertedIds = await trx('unified_expenses').insert(expenseEntries);

      // Update reference order with total expense amount
      const updateData = {
        expenseAmount: totalAmount,
        updatedAt: new Date(),
        updatedBy: userId
      };

      if (referenceType === 'purchase_order') {
        updateData.trueLandedCost = referenceOrder.totalAmount + totalAmount;
        await trx('purchase_orders')
          .where({ id: referenceId })
          .update(updateData);
      } else if (referenceType === 'collection_order') {
        updateData.totalExpenses = totalAmount;
        await trx('collection_orders')
          .where({ id: referenceId })
          .update(updateData);
      }

      // Create transaction records for expenses
      const transactionEntries = expenses.map((expense, index) => ({
        transactionNumber: `EXP-${referenceOrder[orderNumberField]}-${Date.now()}-${index}`,
        transactionType: 'expense',
        referenceId: referenceId,
        referenceType: referenceType,
        amount: expense.amount,
        transactionDate: expense.expenseDate,
        description: `${expenseType === 'purchase' ? 'Purchase' : 'Collection'} Expense: ${expense.description}`,
        category: expense.category,
        createdBy: userId,
        createdAt: new Date()
      }));

      await trx('transactions').insert(transactionEntries);

      auditLog(`${expenseType.toUpperCase()}_EXPENSES_CREATED`, userId, {
        referenceId,
        referenceType,
        expenseType,
        expenseCount: expenses.length,
        totalAmount,
        orderNumber: referenceOrder[orderNumberField],
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });

      // Return created expenses
      const createdExpenses = await trx('unified_expenses')
        .whereIn('id', insertedIds)
        .leftJoin('purchase_orders', function() {
          this.on('unified_expenses.referenceId', '=', 'purchase_orders.id')
              .andOn('unified_expenses.referenceType', '=', trx.raw('?', ['purchase_order']));
        })
        .leftJoin('collection_orders', function() {
          this.on('unified_expenses.referenceId', '=', 'collection_orders.id')
              .andOn('unified_expenses.referenceType', '=', trx.raw('?', ['collection_order']));
        })
        .select(
          'unified_expenses.*',
          'purchase_orders.orderNumber as purchaseOrderNumber',
          'collection_orders.orderNumber as collectionOrderNumber'
        );

      res.status(201).json({
        success: true,
        data: createdExpenses,
        message: `${expenses.length} ${expenseType} expenses created successfully`
      });
    });

  } catch (error) {
    logger.error('Error creating expenses', { 
      error: error.message, 
      stack: error.stack,
      referenceId,
      referenceType,
      expenseType,
      companyId 
    });
    
    res.status(400).json({
      success: false,
      error: error.message || 'Failed to create expenses'
    });
  }
});

// PUT /api/expenses/:id - Update expense  
const updateExpenseSchema = Joi.object({
  category: Joi.string().valid(
    // Purchase expense categories
    'transportation', 'loading_unloading', 'customs_duty', 'inspection',
    'storage', 'insurance', 'documentation',
    // Collection expense categories (additional)
    'fuel', 'permits_fees', 'equipment_rental', 'meals_accommodation', 'maintenance',
    // Common category
    'other'
  ).required(),
  description: Joi.string().trim().min(1).max(500).required(),
  amount: Joi.number().min(0.01).precision(3).required(),
  currency: Joi.string().length(3).default('OMR'),
  vendor: Joi.string().trim().max(200).allow('').optional(),
  receiptNumber: Joi.string().trim().max(100).allow('').optional(),
  receiptPhoto: Joi.string().max(500).allow('').optional(),
  paidBy: Joi.string().max(100).allow('').optional(),
  paymentMethod: Joi.string().valid('cash', 'card', 'bank_transfer', 'company_account').default('cash'),
  expenseDate: Joi.date().required(),
  notes: Joi.string().trim().max(1000).allow('').optional()
});

router.put('/:id', requirePermission('EDIT_PURCHASE'), validateParams(['id']), validate(updateExpenseSchema), async (req, res) => {
  const { companyId, userId } = req.user;
  const { id } = req.params;
  const updateData = req.body;
  const db = getDbConnection(companyId);

  try {
    // Check if expense exists
    const existingExpense = await db('unified_expenses')
      .where({ id })
      .first();

    if (!existingExpense) {
      return res.status(404).json({
        success: false,
        error: 'Expense not found'
      });
    }

    // Update expense
    await db('unified_expenses')
      .where({ id })
      .update({
        ...updateData,
        updatedBy: userId,
        updatedAt: new Date()
      });

    // Recalculate reference order expense totals
    const totalExpenses = await db('unified_expenses')
      .where({ 
        referenceId: existingExpense.referenceId,
        referenceType: existingExpense.referenceType
      })
      .sum('amount as total')
      .first();

    const newTotalExpenses = totalExpenses.total || 0;

    if (existingExpense.referenceType === 'purchase_order') {
      const purchaseOrder = await db('purchase_orders')
        .where({ id: existingExpense.referenceId })
        .first();

      await db('purchase_orders')
        .where({ id: existingExpense.referenceId })
        .update({
          expenseAmount: newTotalExpenses,
          trueLandedCost: (purchaseOrder.totalAmount || 0) + newTotalExpenses,
          updatedAt: new Date(),
          updatedBy: userId
        });
    } else if (existingExpense.referenceType === 'collection_order') {
      await db('collection_orders')
        .where({ id: existingExpense.referenceId })
        .update({
          totalExpenses: newTotalExpenses,
          updatedAt: new Date(),
          updatedBy: userId
        });
    }

    // Get updated expense
    const updatedExpense = await db('unified_expenses')
      .leftJoin('purchase_orders', function() {
        this.on('unified_expenses.referenceId', '=', 'purchase_orders.id')
            .andOn('unified_expenses.referenceType', '=', db.raw('?', ['purchase_order']));
      })
      .leftJoin('collection_orders', function() {
        this.on('unified_expenses.referenceId', '=', 'collection_orders.id')
            .andOn('unified_expenses.referenceType', '=', db.raw('?', ['collection_order']));
      })
      .select(
        'unified_expenses.*',
        'purchase_orders.orderNumber as purchaseOrderNumber',
        'collection_orders.orderNumber as collectionOrderNumber'
      )
      .where('unified_expenses.id', id)
      .first();

    auditLog('EXPENSE_UPDATED', userId, {
      expenseId: id,
      referenceId: existingExpense.referenceId,
      referenceType: existingExpense.referenceType,
      expenseType: existingExpense.expenseType,
      changes: updateData,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: true,
      data: updatedExpense,
      message: 'Expense updated successfully'
    });

  } catch (error) {
    logger.error('Error updating expense', { 
      error: error.message, 
      expenseId: id,
      companyId 
    });
    
    res.status(400).json({
      success: false,
      error: error.message || 'Failed to update expense'
    });
  }
});

// DELETE /api/expenses/:id - Delete expense
router.delete('/:id', requirePermission('DELETE_PURCHASE'), validateParams(['id']), async (req, res) => {
  const { companyId, userId } = req.user;
  const { id } = req.params;
  const db = getDbConnection(companyId);

  try {
    // Check if expense exists
    const existingExpense = await db('unified_expenses')
      .where({ id })
      .first();

    if (!existingExpense) {
      return res.status(404).json({
        success: false,
        error: 'Expense not found'
      });
    }

    // Delete expense
    await db('unified_expenses').where({ id }).del();

    // Recalculate reference order expense totals
    const totalExpenses = await db('unified_expenses')
      .where({ 
        referenceId: existingExpense.referenceId,
        referenceType: existingExpense.referenceType
      })
      .sum('amount as total')
      .first();

    const newTotalExpenses = totalExpenses.total || 0;

    if (existingExpense.referenceType === 'purchase_order') {
      const purchaseOrder = await db('purchase_orders')
        .where({ id: existingExpense.referenceId })
        .first();

      await db('purchase_orders')
        .where({ id: existingExpense.referenceId })
        .update({
          expenseAmount: newTotalExpenses,
          trueLandedCost: (purchaseOrder.totalAmount || 0) + newTotalExpenses,
          updatedAt: new Date(),
          updatedBy: userId
        });
    } else if (existingExpense.referenceType === 'collection_order') {
      await db('collection_orders')
        .where({ id: existingExpense.referenceId })
        .update({
          totalExpenses: newTotalExpenses,
          updatedAt: new Date(),
          updatedBy: userId
        });
    }

    auditLog('EXPENSE_DELETED', userId, {
      expenseId: id,
      referenceId: existingExpense.referenceId,
      referenceType: existingExpense.referenceType,
      expenseType: existingExpense.expenseType,
      amount: existingExpense.amount,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: true,
      message: 'Expense deleted successfully'
    });

  } catch (error) {
    logger.error('Error deleting expense', { 
      error: error.message, 
      expenseId: id,
      companyId 
    });
    
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// GET /api/expenses/categories - Get all expense categories
router.get('/meta/categories', async (req, res) => {
  const categories = [
    // Purchase expense categories
    { id: 'transportation', name: 'Transportation', description: 'Vehicle transport, fuel, driver costs', applicableTo: ['purchase', 'collection'] },
    { id: 'loading_unloading', name: 'Loading/Unloading', description: 'Labor costs for loading and unloading materials', applicableTo: ['purchase', 'collection'] },
    { id: 'customs_duty', name: 'Customs & Duty', description: 'Import duties, customs clearance fees', applicableTo: ['purchase'] },
    { id: 'inspection', name: 'Inspection Fees', description: 'Quality inspection, testing fees', applicableTo: ['purchase'] },
    { id: 'storage', name: 'Storage Costs', description: 'Temporary storage, warehousing fees', applicableTo: ['purchase'] },
    { id: 'insurance', name: 'Insurance', description: 'Transport insurance, coverage premiums', applicableTo: ['purchase'] },
    { id: 'documentation', name: 'Documentation', description: 'Paperwork, permits, certificates', applicableTo: ['purchase'] },
    
    // Collection expense categories
    { id: 'fuel', name: 'Fuel Costs', description: 'Vehicle fuel for collection operations', applicableTo: ['collection'] },
    { id: 'permits_fees', name: 'Permits & Fees', description: 'Government permits and regulatory fees', applicableTo: ['collection'] },
    { id: 'equipment_rental', name: 'Equipment Rental', description: 'Rental costs for collection equipment', applicableTo: ['collection'] },
    { id: 'meals_accommodation', name: 'Meals & Accommodation', description: 'Staff meals and accommodation during collections', applicableTo: ['collection'] },
    { id: 'maintenance', name: 'Maintenance', description: 'Vehicle and equipment maintenance costs', applicableTo: ['collection'] },
    
    // Common category
    { id: 'other', name: 'Other Expenses', description: 'Miscellaneous operational costs', applicableTo: ['purchase', 'collection'] }
  ];

  res.json({
    success: true,
    data: categories
  });
});

// GET /api/expenses/analytics - Get expense analytics
router.get('/analytics/summary', requirePermission('VIEW_PURCHASE'), async (req, res) => {
  try {
    const { companyId } = req.user;
    const { period = '30', expenseType = '' } = req.query;
    const db = getDbConnection(companyId);

    const dateFrom = new Date();
    dateFrom.setDate(dateFrom.getDate() - parseInt(period));

    let query = db('unified_expenses')
      .where('expenseDate', '>=', dateFrom);

    if (expenseType) {
      query = query.where('expenseType', expenseType);
    }

    // Total expenses by type
    const totalsByType = await db('unified_expenses')
      .select('expenseType')
      .sum('amount as total')
      .count('* as count')
      .where('expenseDate', '>=', dateFrom)
      .groupBy('expenseType');

    // Expenses by category
    const byCategory = await query.clone()
      .select('category', 'expenseType')
      .sum('amount as total')
      .count('* as count')
      .groupBy('category', 'expenseType');

    // Monthly trends
    const monthlyTrends = await query.clone()
      .select(
        db.raw('DATE_FORMAT(expenseDate, "%Y-%m") as month'),
        'expenseType'
      )
      .sum('amount as total')
      .count('* as count')
      .groupBy(db.raw('DATE_FORMAT(expenseDate, "%Y-%m")'), 'expenseType')
      .orderBy('month', 'desc');

    // Top expenses
    const topExpenses = await query.clone()
      .select('*')
      .orderBy('amount', 'desc')
      .limit(10);

    res.json({
      success: true,
      data: {
        totalsByType,
        byCategory,
        monthlyTrends,
        topExpenses,
        period: parseInt(period)
      }
    });

  } catch (error) {
    logger.error('Error fetching expense analytics', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

module.exports = router;