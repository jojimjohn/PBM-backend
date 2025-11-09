const express = require('express');
const router = express.Router();
const { getDbConnection } = require('../config/database');
const { requirePermission } = require('../middleware/auth');
const { validate } = require('../middleware/validation');
const Joi = require('joi');
const winston = require('winston');

// Validation schemas
const expenseSchema = Joi.object({
  cardId: Joi.number().integer().positive().required(),
  category: Joi.string().min(2).max(100).required(),
  description: Joi.string().min(2).max(2000).required(),
  amount: Joi.number().positive().required(),
  expenseDate: Joi.date().iso().required(),
  vendor: Joi.string().max(200).optional(),
  receiptNumber: Joi.string().max(100).optional(),
  receiptPhoto: Joi.string().max(500).optional(),
  notes: Joi.string().max(1000).optional()
});

const updateExpenseSchema = expenseSchema.fork(
  ['cardId', 'category', 'description', 'amount', 'expenseDate'], 
  (schema) => schema.optional()
);

const approvalSchema = Joi.object({
  status: Joi.string().valid('approved', 'rejected').required(),
  approvalNotes: Joi.string().max(1000).optional()
});

// Generate expense number
function generateExpenseNumber(companyId) {
  const prefix = companyId === 'al-ramrami' ? 'ALR-EXP' : 'PM-EXP';
  const timestamp = Date.now().toString().slice(-8);
  return `${prefix}-${timestamp}`;
}

// Predefined expense categories
const expenseCategories = [
  'fuel', 'transport', 'meals', 'office_supplies', 'utilities',
  'maintenance', 'communication', 'travel', 'entertainment', 
  'miscellaneous', 'equipment', 'services', 'emergency'
];

// GET /petty-cash-expenses - List all expenses with filtering
router.get('/', requirePermission('VIEW_EXPENSE_REPORTS'), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    
    const {
      page = 1,
      limit = 50,
      cardId,
      category,
      status,
      submittedBy,
      dateFrom,
      dateTo,
      search
    } = req.query;
    
    const offset = (page - 1) * limit;
    
    let query = db('petty_cash_expenses')
      .select(
        'petty_cash_expenses.*',
        'petty_cash_cards.cardNumber',
        'petty_cash_cards.staffName',
        'submittedUser.firstName as submittedByName',
        'submittedUser.lastName as submittedByLastName',
        'approvedUser.firstName as approvedByName',
        'approvedUser.lastName as approvedByLastName'
      )
      .leftJoin('petty_cash_cards', 'petty_cash_expenses.cardId', 'petty_cash_cards.id')
      .leftJoin('users as submittedUser', 'petty_cash_expenses.submittedBy', 'submittedUser.id')
      .leftJoin('users as approvedUser', 'petty_cash_expenses.approvedBy', 'approvedUser.id')
      .orderBy('petty_cash_expenses.created_at', 'desc');
    
    // Apply user-specific filters based on role
    if (!req.user.permissions.includes('VIEW_EXPENSE_REPORTS')) {
      // Non-admin users can only see their own expenses
      query = query.where('petty_cash_expenses.submittedBy', req.user.id);
    }
    
    // Apply filters
    if (cardId) {
      query = query.where('petty_cash_expenses.cardId', cardId);
    }
    
    if (category) {
      query = query.where('petty_cash_expenses.category', category);
    }
    
    if (status) {
      query = query.where('petty_cash_expenses.status', status);
    }
    
    if (submittedBy) {
      query = query.where('petty_cash_expenses.submittedBy', submittedBy);
    }
    
    if (dateFrom) {
      query = query.where('petty_cash_expenses.expenseDate', '>=', dateFrom);
    }
    
    if (dateTo) {
      query = query.where('petty_cash_expenses.expenseDate', '<=', dateTo);
    }
    
    if (search) {
      query = query.where(function() {
        this.where('petty_cash_expenses.expenseNumber', 'like', `%${search}%`)
            .orWhere('petty_cash_expenses.description', 'like', `%${search}%`)
            .orWhere('petty_cash_expenses.vendor', 'like', `%${search}%`)
            .orWhere('petty_cash_cards.staffName', 'like', `%${search}%`);
      });
    }
    
    // Get total count for pagination
    const totalQuery = query.clone();
    const [{ count }] = await totalQuery.clearSelect().clearOrder().count('* as count');
    
    // Get paginated results
    const expenses = await query.limit(limit).offset(offset);
    
    winston.info('Petty cash expenses retrieved', {
      companyId: req.user.companyId,
      userId: req.user.id,
      count: expenses.length,
      totalCount: count
    });
    
    res.json({
      success: true,
      data: expenses,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count,
        pages: Math.ceil(count / limit)
      }
    });
    
  } catch (error) {
    winston.error('Error fetching petty cash expenses', {
      error: error.message,
      companyId: req.user.companyId,
      userId: req.user.id
    });
    
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// GET /petty-cash-expenses/categories - Get expense categories
router.get('/categories', requirePermission('VIEW_EXPENSE_REPORTS'), async (req, res) => {
  res.json({
    success: true,
    data: expenseCategories
  });
});

// POST /petty-cash-expenses - Create new expense
router.post('/', 
  requirePermission('CREATE_EXPENSE'),
  validate(expenseSchema),
  async (req, res) => {
    try {
      const db = getDbConnection(req.user.companyId);
      const expenseData = req.body;
      
      // Generate expense number
      const expenseNumber = generateExpenseNumber(req.user.companyId);
      
      // Verify card exists and is active
      const card = await db('petty_cash_cards').where('id', expenseData.cardId).first();
      if (!card) {
        return res.status(400).json({
          success: false,
          error: 'Petty cash card not found'
        });
      }
      
      if (card.status !== 'active') {
        return res.status(400).json({
          success: false,
          error: 'Petty cash card is not active'
        });
      }
      
      // Check if user has permission to use this card
      if (card.assignedTo !== req.user.id && !req.user.permissions.includes('MANAGE_EXPENSES')) {
        return res.status(403).json({
          success: false,
          error: 'You are not authorized to use this card'
        });
      }
      
      // Validate expense category
      if (!expenseCategories.includes(expenseData.category)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid expense category'
        });
      }
      
      // Check if sufficient balance (for approved expenses)
      if (expenseData.amount > card.currentBalance) {
        return res.status(400).json({
          success: false,
          error: 'Insufficient card balance for this expense'
        });
      }
      
      // Check monthly limit if set
      if (card.monthlyLimit) {
        const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM format
        const [monthlySpent] = await db('petty_cash_expenses')
          .where('cardId', expenseData.cardId)
          .where('status', 'approved')
          .where(db.raw('DATE_FORMAT(expenseDate, "%Y-%m")'), currentMonth)
          .sum('amount as total');
        
        const totalMonthlySpent = (monthlySpent.total || 0) + expenseData.amount;
        
        if (totalMonthlySpent > card.monthlyLimit) {
          return res.status(400).json({
            success: false,
            error: `This expense would exceed the monthly limit of ${card.monthlyLimit}. Current monthly spent: ${monthlySpent.total || 0}`
          });
        }
      }
      
      const newExpense = {
        expenseNumber,
        cardId: expenseData.cardId,
        category: expenseData.category,
        description: expenseData.description,
        amount: expenseData.amount,
        expenseDate: expenseData.expenseDate,
        vendor: expenseData.vendor || null,
        receiptNumber: expenseData.receiptNumber || null,
        receiptPhoto: expenseData.receiptPhoto || null,
        status: 'pending',
        submittedBy: req.user.id,
        notes: expenseData.notes || null
      };
      
      const [id] = await db('petty_cash_expenses').insert(newExpense);
      
      winston.info('Petty cash expense created', {
        expenseId: id,
        expenseNumber,
        cardId: expenseData.cardId,
        amount: expenseData.amount,
        category: expenseData.category,
        companyId: req.user.companyId,
        userId: req.user.id
      });
      
      res.status(201).json({
        success: true,
        data: { id, ...newExpense },
        message: 'Expense submitted successfully and is pending approval'
      });
      
    } catch (error) {
      winston.error('Error creating petty cash expense', {
        error: error.message,
        companyId: req.user.companyId,
        userId: req.user.id
      });
      
      if (error.code === 'ER_DUP_ENTRY') {
        res.status(409).json({
          success: false,
          error: 'Expense number already exists'
        });
      } else {
        res.status(500).json({
          success: false,
          error: 'Internal server error'
        });
      }
    }
  }
);

// PUT /petty-cash-expenses/:id - Update expense (only if pending)
router.put('/:id',
  requirePermission('CREATE_EXPENSE'),
  validate(updateExpenseSchema),
  async (req, res) => {
    try {
      const db = getDbConnection(req.user.companyId);
      const { id } = req.params;
      const updateData = req.body;
      
      // Check if expense exists and is pending
      const existingExpense = await db('petty_cash_expenses')
        .select('petty_cash_expenses.*', 'petty_cash_cards.assignedTo')
        .leftJoin('petty_cash_cards', 'petty_cash_expenses.cardId', 'petty_cash_cards.id')
        .where('petty_cash_expenses.id', id)
        .first();
      
      if (!existingExpense) {
        return res.status(404).json({
          success: false,
          error: 'Expense not found'
        });
      }
      
      if (existingExpense.status !== 'pending') {
        return res.status(400).json({
          success: false,
          error: 'Cannot update non-pending expense'
        });
      }
      
      // Check permission to update
      if (existingExpense.submittedBy !== req.user.id && !req.user.permissions.includes('MANAGE_EXPENSES')) {
        return res.status(403).json({
          success: false,
          error: 'You can only update your own expenses'
        });
      }
      
      // Validate category if provided
      if (updateData.category && !expenseCategories.includes(updateData.category)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid expense category'
        });
      }
      
      await db('petty_cash_expenses').where('id', id).update({
        ...updateData,
        updated_at: new Date()
      });
      
      winston.info('Petty cash expense updated', {
        expenseId: id,
        companyId: req.user.companyId,
        userId: req.user.id
      });
      
      res.json({
        success: true,
        message: 'Expense updated successfully'
      });
      
    } catch (error) {
      winston.error('Error updating petty cash expense', {
        error: error.message,
        expenseId: req.params.id,
        companyId: req.user.companyId,
        userId: req.user.id
      });
      
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }
);

// POST /petty-cash-expenses/:id/approve - Approve/Reject expense
router.post('/:id/approve',
  requirePermission('APPROVE_EXPENSE'),
  validate(approvalSchema),
  async (req, res) => {
    try {
      const TransactionManager = require('../utils/transactionManager');
      const txnManager = new TransactionManager(req.user.companyId);
      
      const { id } = req.params;
      const { status, approvalNotes } = req.body;
      
      // Use enhanced transaction manager for ACID compliance
      const result = await txnManager.processExpenseApproval(
        parseInt(id), 
        status, 
        req.user.id, 
        approvalNotes
      );
      
      winston.info('Petty cash expense approval processed with ACID compliance', {
        expenseId: id,
        status,
        amount: result.amount,
        companyId: req.user.companyId,
        userId: req.user.id,
        approvedBy: req.user.id
      });
      
      res.json({
        success: true,
        data: result,
        message: `Expense ${status} successfully`
      });
      
    } catch (error) {
      winston.error('Error processing expense approval', {
        error: error.message,
        expenseId: req.params.id,
        companyId: req.user.companyId,
        userId: req.user.id
      });
      
      res.status(400).json({
        success: false,
        error: error.message || 'Internal server error'
      });
    }
  }
);

// DELETE /petty-cash-expenses/:id - Delete expense (only if pending)
router.delete('/:id', requirePermission('CREATE_EXPENSE'), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const { id } = req.params;
    
    // Check if expense exists and is pending
    const existingExpense = await db('petty_cash_expenses').where('id', id).first();
    
    if (!existingExpense) {
      return res.status(404).json({
        success: false,
        error: 'Expense not found'
      });
    }
    
    if (existingExpense.status !== 'pending') {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete non-pending expense'
      });
    }
    
    // Check permission to delete
    if (existingExpense.submittedBy !== req.user.id && !req.user.permissions.includes('MANAGE_EXPENSES')) {
      return res.status(403).json({
        success: false,
        error: 'You can only delete your own expenses'
      });
    }
    
    await db('petty_cash_expenses').where('id', id).del();
    
    winston.info('Petty cash expense deleted', {
      expenseId: id,
      companyId: req.user.companyId,
      userId: req.user.id
    });
    
    res.json({
      success: true,
      message: 'Expense deleted successfully'
    });
    
  } catch (error) {
    winston.error('Error deleting petty cash expense', {
      error: error.message,
      expenseId: req.params.id,
      companyId: req.user.companyId,
      userId: req.user.id
    });
    
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// GET /petty-cash-expenses/analytics - Get expense analytics
router.get('/analytics', requirePermission('VIEW_EXPENSE_REPORTS'), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const { period = '30' } = req.query;
    
    // Calculate date range based on period
    const now = new Date();
    const periodDays = parseInt(period) || 30;
    const endDate = now.toISOString().split('T')[0];
    const startDate = new Date(now.getTime() - (periodDays * 24 * 60 * 60 * 1000)).toISOString().split('T')[0];
    
    // Get basic analytics
    const analyticsQuery = `
      SELECT
        COUNT(*) as totalExpenses,
        COALESCE(SUM(amount), 0) as totalAmount,
        COALESCE(AVG(amount), 0) as averageAmount,
        COUNT(CASE WHEN status = 'approved' THEN 1 END) as approvedCount,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pendingCount,
        COUNT(CASE WHEN status = 'rejected' THEN 1 END) as rejectedCount
      FROM petty_cash_expenses
      WHERE DATE(expenseDate) >= ?
        AND DATE(expenseDate) <= ?
    `;
    
    const [analytics] = await db.raw(analyticsQuery, [startDate, endDate]);
    
    res.json({
      success: true,
      data: analytics[0] || {
        totalExpenses: 0,
        totalAmount: 0,
        averageAmount: 0,
        approvedCount: 0,
        pendingCount: 0,
        rejectedCount: 0
      }
    });
    
  } catch (error) {
    console.error('Error fetching expense analytics:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// GET /petty-cash-expenses/analytics/summary - Get expense analytics
router.get('/analytics/summary', requirePermission('VIEW_EXPENSE_REPORTS'), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const { dateFrom, dateTo, cardId } = req.query;
    
    let query = db('petty_cash_expenses');
    
    // Apply date filters
    if (dateFrom) {
      query = query.where('expenseDate', '>=', dateFrom);
    }
    
    if (dateTo) {
      query = query.where('expenseDate', '<=', dateTo);
    }
    
    if (cardId) {
      query = query.where('cardId', cardId);
    }
    
    // Apply user-specific filters for non-admin users
    if (!req.user.permissions.includes('VIEW_EXPENSE_REPORTS')) {
      query = query.where('submittedBy', req.user.id);
    }
    
    // Get summary statistics
    const [totalStats] = await query.clone()
      .select(
        db.raw('COUNT(*) as totalExpenses'),
        db.raw('SUM(CASE WHEN status = "approved" THEN amount ELSE 0 END) as totalApprovedAmount'),
        db.raw('SUM(CASE WHEN status = "pending" THEN amount ELSE 0 END) as totalPendingAmount'),
        db.raw('SUM(CASE WHEN status = "pending" THEN 1 ELSE 0 END) as pendingCount'),
        db.raw('SUM(CASE WHEN status = "approved" THEN 1 ELSE 0 END) as approvedCount'),
        db.raw('SUM(CASE WHEN status = "rejected" THEN 1 ELSE 0 END) as rejectedCount')
      );
    
    // Get expenses by category
    const expensesByCategory = await query.clone()
      .select('category', db.raw('COUNT(*) as count'), db.raw('SUM(amount) as totalAmount'))
      .where('status', 'approved')
      .groupBy('category')
      .orderBy('totalAmount', 'desc');
    
    // Get monthly trend
    const monthlyTrend = await query.clone()
      .select(
        db.raw('DATE_FORMAT(expenseDate, "%Y-%m") as month'),
        db.raw('COUNT(*) as count'),
        db.raw('SUM(amount) as totalAmount')
      )
      .where('status', 'approved')
      .groupBy(db.raw('DATE_FORMAT(expenseDate, "%Y-%m")'))
      .orderBy('month', 'desc')
      .limit(12);
    
    // Get top expense cards
    const topCards = await query.clone()
      .select(
        'petty_cash_cards.cardNumber',
        'petty_cash_cards.staffName',
        db.raw('COUNT(petty_cash_expenses.id) as expenseCount'),
        db.raw('SUM(petty_cash_expenses.amount) as totalAmount')
      )
      .join('petty_cash_cards', 'petty_cash_expenses.cardId', 'petty_cash_cards.id')
      .where('petty_cash_expenses.status', 'approved')
      .groupBy('petty_cash_expenses.cardId', 'petty_cash_cards.cardNumber', 'petty_cash_cards.staffName')
      .orderBy('totalAmount', 'desc')
      .limit(10);
    
    winston.info('Petty cash expense analytics retrieved', {
      companyId: req.user.companyId,
      userId: req.user.id
    });
    
    res.json({
      success: true,
      data: {
        summary: totalStats,
        byCategory: expensesByCategory,
        monthlyTrend,
        topCards
      }
    });
    
  } catch (error) {
    winston.error('Error fetching expense analytics', {
      error: error.message,
      companyId: req.user.companyId,
      userId: req.user.id
    });
    
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// GET /petty-cash-expenses/:id - Get specific expense
// NOTE: This route MUST be defined last, after all specific routes (like /analytics)
router.get('/:id', requirePermission('VIEW_EXPENSE_REPORTS'), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const { id } = req.params;

    let query = db('petty_cash_expenses')
      .select(
        'petty_cash_expenses.*',
        'petty_cash_cards.cardNumber',
        'petty_cash_cards.staffName',
        'petty_cash_cards.department',
        'petty_cash_cards.currentBalance as cardBalance',
        'submittedUser.firstName as submittedByName',
        'submittedUser.lastName as submittedByLastName',
        'submittedUser.email as submittedByEmail',
        'approvedUser.firstName as approvedByName',
        'approvedUser.lastName as approvedByLastName'
      )
      .leftJoin('petty_cash_cards', 'petty_cash_expenses.cardId', 'petty_cash_cards.id')
      .leftJoin('users as submittedUser', 'petty_cash_expenses.submittedBy', 'submittedUser.id')
      .leftJoin('users as approvedUser', 'petty_cash_expenses.approvedBy', 'approvedUser.id')
      .where('petty_cash_expenses.id', id);

    // Apply user-specific filters based on role
    if (!req.user.permissions.includes('VIEW_EXPENSE_REPORTS')) {
      query = query.where('petty_cash_expenses.submittedBy', req.user.id);
    }

    const expense = await query.first();

    if (!expense) {
      return res.status(404).json({
        success: false,
        error: 'Expense not found or access denied'
      });
    }

    winston.info('Petty cash expense retrieved', {
      expenseId: id,
      companyId: req.user.companyId,
      userId: req.user.id
    });

    res.json({
      success: true,
      data: expense
    });

  } catch (error) {
    winston.error('Error fetching petty cash expense', {
      error: error.message,
      expenseId: req.params.id,
      companyId: req.user.companyId,
      userId: req.user.id
    });

    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

module.exports = router;