const express = require('express');
const { validate, validateParams, sanitize } = require('../middleware/validation');
const { requirePermission, requireAnyPermission } = require('../middleware/auth');
const { logger, auditLog } = require('../utils/logger');
const { getDbConnection } = require('../config/database');
const Joi = require('joi');

const router = express.Router();

// Apply sanitization to all routes
router.use(sanitize);

/**
 * Helper function to check purchase expense ownership
 * @param {Object} expense - Purchase expense object
 * @param {number} userId - Current user's ID
 * @param {Array} permissions - User's permissions array
 * @param {string} permissionType - Type of permission to check (VIEW, EDIT, DELETE)
 * @returns {boolean} - Whether user has permission
 */
const checkPurchaseExpenseOwnership = (expense, userId, permissions, permissionType = 'EDIT') => {
  const { hasPermission } = require('../config/permissionsHierarchy');

  // Check if user has permission for ALL purchase expenses
  const allPermission = `${permissionType}_PURCHASE_EXPENSES_ALL`;
  if (hasPermission(permissions, allPermission)) {
    return true;
  }

  // Check if user has permission for OWN purchase expenses and owns this expense
  const ownPermission = `${permissionType}_PURCHASE_EXPENSES_OWN`;
  if (hasPermission(permissions, ownPermission)) {
    return expense.createdBy === userId;
  }

  return false;
};

/**
 * Helper function to audit permission denials
 * @param {string} action - Action being attempted
 * @param {number} userId - User ID
 * @param {Object} details - Additional details
 */
const auditPermissionDenial = (action, userId, details) => {
  logger.warn(`Permission denied: ${action}`, {
    userId,
    ...details,
    timestamp: new Date().toISOString()
  });

  auditLog(action, userId, details);
};

// Purchase expense validation schema
const purchaseExpenseSchema = Joi.object({
  purchaseOrderId: Joi.number().integer().positive().required(),
  category: Joi.string().valid(
    'transportation', 'loading_unloading', 'customs_duty', 'inspection',
    'storage', 'insurance', 'documentation', 'other'
  ).required(),
  description: Joi.string().trim().min(1).max(500).required(),
  amount: Joi.number().min(0.01).precision(3).required(),
  vendor: Joi.string().trim().max(200).allow('').optional(),
  receiptNumber: Joi.string().trim().max(100).allow('').optional(),
  expenseDate: Joi.date().required(),
  notes: Joi.string().trim().max(1000).allow('').optional()
});

// Bulk expense creation schema
const bulkExpenseSchema = Joi.object({
  purchaseOrderId: Joi.number().integer().positive().required(),
  expenses: Joi.array().items(purchaseExpenseSchema.omit(['purchaseOrderId'])).min(1).required(),
  totalAmount: Joi.number().min(0).precision(3).required()
});

// GET /api/purchase-expenses - List purchase expenses
router.get('/',
  requireAnyPermission(['VIEW_PURCHASE_EXPENSES_ALL', 'VIEW_PURCHASE_EXPENSES_OWN']),
  async (req, res) => {
  try {
    const { companyId, userId, permissions } = req.user;
    const db = getDbConnection(companyId);
    const { hasPermission } = require('../config/permissionsHierarchy');

    const {
      page = 1,
      limit = 50,
      search = '',
      purchaseOrderId = '',
      category = '',
      fromDate = '',
      toDate = ''
    } = req.query;

    const offset = (page - 1) * limit;

    let query = db('purchase_expenses')
      .leftJoin('purchase_orders', 'purchase_expenses.purchaseOrderId', 'purchase_orders.id')
      .leftJoin('suppliers', 'purchase_orders.supplierId', 'suppliers.id')
      .select(
        'purchase_expenses.*',
        'purchase_orders.orderNumber',
        'suppliers.name as supplierName'
      );

    // Apply ownership filtering if user only has VIEW_PURCHASE_EXPENSES_OWN permission
    if (!hasPermission(permissions, 'VIEW_PURCHASE_EXPENSES_ALL')) {
      query = query.where('purchase_expenses.createdBy', userId);
      logger.info('Filtering purchase expenses to user\'s own records', {
        userId,
        companyId
      });
    }

    // Search filter
    if (search) {
      query = query.where(function() {
        this.where('purchase_expenses.description', 'like', `%${search}%`)
            .orWhere('purchase_expenses.vendor', 'like', `%${search}%`)
            .orWhere('purchase_orders.orderNumber', 'like', `%${search}%`)
            .orWhere('suppliers.name', 'like', `%${search}%`);
      });
    }

    // Purchase order filter
    if (purchaseOrderId) {
      query = query.where('purchase_expenses.purchaseOrderId', purchaseOrderId);
    }

    // Category filter
    if (category) {
      query = query.where('purchase_expenses.category', category);
    }

    // Date range filter
    if (fromDate) {
      query = query.where('purchase_expenses.expenseDate', '>=', fromDate);
    }
    if (toDate) {
      query = query.where('purchase_expenses.expenseDate', '<=', toDate);
    }

    // Get total count for pagination
    const totalQuery = query.clone();
    const totalCount = await totalQuery.count('* as count').first();
    const total = parseInt(totalCount.count);

    // Get paginated results
    const expenses = await query
      .orderBy('purchase_expenses.expenseDate', 'desc')
      .offset(offset)
      .limit(parseInt(limit));

    // Calculate summary
    const summaryQuery = db('purchase_expenses')
      .select(
        db.raw('SUM(amount) as totalAmount'),
        db.raw('COUNT(*) as totalCount'),
        db.raw('AVG(amount) as averageAmount')
      );

    // Apply same ownership filtering to summary
    if (!hasPermission(permissions, 'VIEW_PURCHASE_EXPENSES_ALL')) {
      summaryQuery.where('createdBy', userId);
    }

    if (purchaseOrderId) {
      summaryQuery.where('purchaseOrderId', purchaseOrderId);
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
        averageAmount: parseFloat(summary.averageAmount) || 0
      }
    });

  } catch (error) {
    logger.error('Error fetching purchase expenses', { error: error.message, stack: error.stack });
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// GET /api/purchase-expenses/:id - Get specific expense
router.get('/:id',
  requireAnyPermission(['VIEW_PURCHASE_EXPENSES_ALL', 'VIEW_PURCHASE_EXPENSES_OWN']),
  validateParams(['id']),
  async (req, res) => {
  try {
    const { companyId, userId, permissions } = req.user;
    const { id } = req.params;
    const db = getDbConnection(companyId);

    const expense = await db('purchase_expenses')
      .leftJoin('purchase_orders', 'purchase_expenses.purchaseOrderId', 'purchase_orders.id')
      .leftJoin('suppliers', 'purchase_orders.supplierId', 'suppliers.id')
      .select(
        'purchase_expenses.*',
        'purchase_orders.orderNumber',
        'purchase_orders.orderDate',
        'suppliers.name as supplierName'
      )
      .where('purchase_expenses.id', id)
      .first();

    if (!expense) {
      return res.status(404).json({
        success: false,
        error: 'Purchase expense not found'
      });
    }

    // Check ownership
    if (!checkPurchaseExpenseOwnership(expense, userId, permissions, 'VIEW')) {
      auditPermissionDenial('PERMISSION_DENIED', userId, {
        action: 'VIEW_PURCHASE_EXPENSE',
        reason: 'Attempted to view another user\'s purchase expense',
        expenseId: id,
        expenseCreatedBy: expense.createdBy,
        requestedBy: userId
      });

      return res.status(403).json({
        success: false,
        error: 'You can only view your own purchase expenses'
      });
    }

    res.json({
      success: true,
      data: expense
    });

  } catch (error) {
    logger.error('Error fetching purchase expense', { error: error.message, expenseId: req.params.id });
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// POST /api/purchase-expenses - Create purchase expenses (bulk)
router.post('/',
  requirePermission('CREATE_PURCHASE_EXPENSES'),
  validate(bulkExpenseSchema),
  async (req, res) => {
  const { companyId, userId } = req.user;
  const { purchaseOrderId, expenses, totalAmount } = req.body;
  const db = getDbConnection(companyId);

  try {
    // Start transaction
    await db.transaction(async (trx) => {
      // Verify purchase order exists and belongs to company
      const purchaseOrder = await trx('purchase_orders')
        .where({ id: purchaseOrderId })
        .first();

      if (!purchaseOrder) {
        throw new Error('Purchase order not found');
      }

      // Create expense entries
      const expenseEntries = expenses.map(expense => ({
        ...expense,
        purchaseOrderId,
        createdBy: userId,
        updatedBy: userId,
        createdAt: new Date(),
        updatedAt: new Date()
      }));

      const insertedIds = await trx('purchase_expenses').insert(expenseEntries);

      // Update purchase order with total expense amount
      await trx('purchase_orders')
        .where({ id: purchaseOrderId })
        .update({
          expenseAmount: totalAmount,
          trueLandedCost: purchaseOrder.totalAmount + totalAmount,
          updatedAt: new Date(),
          updatedBy: userId
        });

      // Create transaction records for expenses
      const transactionEntries = expenses.map((expense, index) => ({
        transactionNumber: `EXP-${purchaseOrder.orderNumber}-${Date.now()}-${index}`,
        transactionType: 'expense',
        referenceId: purchaseOrderId,
        referenceType: 'purchase_order',
        amount: expense.amount,
        transactionDate: expense.expenseDate,
        description: `Purchase Expense: ${expense.description}`,
        category: expense.category,
        createdBy: userId,
        createdAt: new Date()
      }));

      await trx('transactions').insert(transactionEntries);

      auditLog('PURCHASE_EXPENSES_CREATED', userId, {
        purchaseOrderId,
        expenseCount: expenses.length,
        totalAmount,
        orderNumber: purchaseOrder.orderNumber,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });

      // Return created expenses
      const createdExpenses = await trx('purchase_expenses')
        .whereIn('id', insertedIds)
        .leftJoin('purchase_orders', 'purchase_expenses.purchaseOrderId', 'purchase_orders.id')
        .select(
          'purchase_expenses.*',
          'purchase_orders.orderNumber'
        );

      res.status(201).json({
        success: true,
        data: createdExpenses,
        message: `${expenses.length} purchase expenses created successfully`
      });
    });

  } catch (error) {
    logger.error('Error creating purchase expenses', { 
      error: error.message, 
      stack: error.stack,
      purchaseOrderId,
      companyId 
    });
    
    res.status(400).json({
      success: false,
      error: error.message || 'Failed to create purchase expenses'
    });
  }
});

// PUT /api/purchase-expenses/:id - Update expense
router.put('/:id',
  requireAnyPermission(['EDIT_PURCHASE_EXPENSES_ALL', 'EDIT_PURCHASE_EXPENSES_OWN']),
  validateParams(['id']),
  validate(purchaseExpenseSchema.omit(['purchaseOrderId'])),
  async (req, res) => {
  const { companyId, userId, permissions } = req.user;
  const { id } = req.params;
  const updateData = req.body;
  const db = getDbConnection(companyId);

  try {
    // Check if expense exists
    const existingExpense = await db('purchase_expenses')
      .where({ id })
      .first();

    if (!existingExpense) {
      return res.status(404).json({
        success: false,
        error: 'Purchase expense not found'
      });
    }

    // Check ownership
    if (!checkPurchaseExpenseOwnership(existingExpense, userId, permissions, 'EDIT')) {
      auditPermissionDenial('PERMISSION_DENIED', userId, {
        action: 'EDIT_PURCHASE_EXPENSE',
        reason: 'Attempted to edit another user\'s purchase expense',
        expenseId: id,
        expenseCreatedBy: existingExpense.createdBy,
        requestedBy: userId
      });

      return res.status(403).json({
        success: false,
        error: 'You can only edit your own purchase expenses'
      });
    }

    // Update expense
    await db('purchase_expenses')
      .where({ id })
      .update({
        ...updateData,
        updatedBy: userId,
        updatedAt: new Date()
      });

    // Recalculate purchase order expense totals
    const totalExpenses = await db('purchase_expenses')
      .where({ purchaseOrderId: existingExpense.purchaseOrderId })
      .sum('amount as total')
      .first();

    const purchaseOrder = await db('purchase_orders')
      .where({ id: existingExpense.purchaseOrderId })
      .first();

    await db('purchase_orders')
      .where({ id: existingExpense.purchaseOrderId })
      .update({
        expenseAmount: totalExpenses.total || 0,
        trueLandedCost: (purchaseOrder.totalAmount || 0) + (totalExpenses.total || 0),
        updatedAt: new Date(),
        updatedBy: userId
      });

    // Get updated expense
    const updatedExpense = await db('purchase_expenses')
      .leftJoin('purchase_orders', 'purchase_expenses.purchaseOrderId', 'purchase_orders.id')
      .select(
        'purchase_expenses.*',
        'purchase_orders.orderNumber'
      )
      .where('purchase_expenses.id', id)
      .first();

    auditLog('PURCHASE_EXPENSE_UPDATED', userId, {
      expenseId: id,
      purchaseOrderId: existingExpense.purchaseOrderId,
      changes: updateData,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: true,
      data: updatedExpense,
      message: 'Purchase expense updated successfully'
    });

  } catch (error) {
    logger.error('Error updating purchase expense', { 
      error: error.message, 
      expenseId: id,
      companyId 
    });
    
    res.status(400).json({
      success: false,
      error: error.message || 'Failed to update purchase expense'
    });
  }
});

// DELETE /api/purchase-expenses/:id - Delete expense
router.delete('/:id',
  requireAnyPermission(['DELETE_PURCHASE_EXPENSES_ALL', 'DELETE_PURCHASE_EXPENSES_OWN']),
  validateParams(['id']),
  async (req, res) => {
  const { companyId, userId, permissions } = req.user;
  const { id } = req.params;
  const db = getDbConnection(companyId);

  try {
    // Check if expense exists
    const existingExpense = await db('purchase_expenses')
      .where({ id })
      .first();

    if (!existingExpense) {
      return res.status(404).json({
        success: false,
        error: 'Purchase expense not found'
      });
    }

    // Check ownership
    if (!checkPurchaseExpenseOwnership(existingExpense, userId, permissions, 'DELETE')) {
      auditPermissionDenial('PERMISSION_DENIED', userId, {
        action: 'DELETE_PURCHASE_EXPENSE',
        reason: 'Attempted to delete another user\'s purchase expense',
        expenseId: id,
        expenseCreatedBy: existingExpense.createdBy,
        requestedBy: userId
      });

      return res.status(403).json({
        success: false,
        error: 'You can only delete your own purchase expenses'
      });
    }

    // Delete expense
    await db('purchase_expenses').where({ id }).del();

    // Recalculate purchase order expense totals
    const totalExpenses = await db('purchase_expenses')
      .where({ purchaseOrderId: existingExpense.purchaseOrderId })
      .sum('amount as total')
      .first();

    const purchaseOrder = await db('purchase_orders')
      .where({ id: existingExpense.purchaseOrderId })
      .first();

    await db('purchase_orders')
      .where({ id: existingExpense.purchaseOrderId })
      .update({
        expenseAmount: totalExpenses.total || 0,
        trueLandedCost: (purchaseOrder.totalAmount || 0) + (totalExpenses.total || 0),
        updatedAt: new Date(),
        updatedBy: userId
      });

    auditLog('PURCHASE_EXPENSE_DELETED', userId, {
      expenseId: id,
      purchaseOrderId: existingExpense.purchaseOrderId,
      amount: existingExpense.amount,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: true,
      message: 'Purchase expense deleted successfully'
    });

  } catch (error) {
    logger.error('Error deleting purchase expense', { 
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

// GET /api/purchase-expenses/categories - Get expense categories
router.get('/meta/categories', async (req, res) => {
  const categories = [
    { id: 'transportation', name: 'Transportation', description: 'Vehicle transport, fuel, driver costs' },
    { id: 'loading_unloading', name: 'Loading/Unloading', description: 'Labor costs for loading and unloading materials' },
    { id: 'customs_duty', name: 'Customs & Duty', description: 'Import duties, customs clearance fees' },
    { id: 'inspection', name: 'Inspection Fees', description: 'Quality inspection, testing fees' },
    { id: 'storage', name: 'Storage Costs', description: 'Temporary storage, warehousing fees' },
    { id: 'insurance', name: 'Insurance', description: 'Transport insurance, coverage premiums' },
    { id: 'documentation', name: 'Documentation', description: 'Paperwork, permits, certificates' },
    { id: 'other', name: 'Other Expenses', description: 'Miscellaneous purchase-related costs' }
  ];

  res.json({
    success: true,
    data: categories
  });
});

module.exports = router;