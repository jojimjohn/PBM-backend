const express = require('express');
const router = express.Router();
const { getDbConnection } = require('../config/database');
const { requirePermission } = require('../middleware/auth');
const { validate } = require('../middleware/validation');
const Joi = require('joi');
const winston = require('winston');

// Validation schemas
// Note: assignedTo/staffName are now optional - petty cash users are managed separately via /petty-cash-users
const pettyCashCardSchema = Joi.object({
  cardName: Joi.string().max(100).allow('', null).optional(),
  assignedTo: Joi.number().integer().positive().allow(null).optional(),
  staffName: Joi.string().max(100).allow('', null).optional(),
  department: Joi.string().max(100).allow('', null).optional(),
  initialBalance: Joi.number().min(0).required(),
  monthlyLimit: Joi.number().min(0).allow(null).optional(),
  issueDate: Joi.alternatives().try(Joi.date().iso(), Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/)).required(),
  expiryDate: Joi.alternatives().try(Joi.date().iso(), Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/)).allow('', null).optional(),
  notes: Joi.string().max(1000).allow('', null).optional()
});

const updateCardSchema = pettyCashCardSchema.fork(
  ['assignedTo', 'staffName', 'initialBalance', 'issueDate'], 
  (schema) => schema.optional()
);

const statusUpdateSchema = Joi.object({
  status: Joi.string().valid('active', 'suspended', 'expired', 'closed').required(),
  notes: Joi.string().max(1000).optional()
});

const balanceUpdateSchema = Joi.object({
  amount: Joi.number().required(),
  type: Joi.string().valid('add', 'deduct').required(),
  notes: Joi.string().max(500).optional()
});

const reloadCardSchema = Joi.object({
  amount: Joi.number().positive().required().messages({
    'number.positive': 'Reload amount must be greater than 0',
    'any.required': 'Reload amount is required'
  }),
  reloadDate: Joi.alternatives().try(Joi.date().iso(), Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/)).optional(),
  notes: Joi.string().max(500).allow('', null).optional(),
  bankAccountId: Joi.number().integer().positive().allow(null).optional()
});

// Generate card number
function generateCardNumber(companyId) {
  const prefix = companyId === 'al-ramrami' ? 'ALR-PC' : 'PM-PC';
  const timestamp = Date.now().toString().slice(-6);
  const random = Math.floor(Math.random() * 100).toString().padStart(2, '0');
  return `${prefix}-${timestamp}${random}`;
}

// GET /petty-cash-cards - List all petty cash cards
router.get('/', requirePermission('VIEW_PETTY_CASH'), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    
    const {
      page = 1,
      limit = 50,
      status,
      assignedTo,
      department,
      search
    } = req.query;
    
    const offset = (page - 1) * limit;
    
    let query = db('petty_cash_cards')
      .select(
        'petty_cash_cards.*',
        'assignedUser.firstName as assignedUserFirstName',
        'assignedUser.lastName as assignedUserLastName',
        'assignedUser.email as assignedUserEmail',
        'createdByUser.firstName as createdByFirstName',
        'createdByUser.lastName as createdByLastName',
        // Include petty cash user info (linked via card_id)
        'petty_cash_users.id as pettyCashUserId',
        'petty_cash_users.name as pettyCashUserName',
        'petty_cash_users.phone as pettyCashUserPhone',
        'petty_cash_users.department as pettyCashUserDepartment',
        'petty_cash_users.employee_id as pettyCashUserEmployeeId',
        'petty_cash_users.is_active as pettyCashUserIsActive'
      )
      .leftJoin('users as assignedUser', 'petty_cash_cards.assignedTo', 'assignedUser.id')
      .leftJoin('users as createdByUser', 'petty_cash_cards.createdBy', 'createdByUser.id')
      .leftJoin('petty_cash_users', 'petty_cash_cards.id', 'petty_cash_users.card_id')
      .orderBy('petty_cash_cards.created_at', 'desc');
    
    // Apply filters
    if (status) {
      query = query.where('petty_cash_cards.status', status);
    }
    
    if (assignedTo) {
      query = query.where('petty_cash_cards.assignedTo', assignedTo);
    }
    
    if (department) {
      query = query.where('petty_cash_cards.department', department);
    }
    
    if (search) {
      query = query.where(function() {
        this.where('petty_cash_cards.cardNumber', 'like', `%${search}%`)
            .orWhere('petty_cash_cards.staffName', 'like', `%${search}%`)
            .orWhere('petty_cash_cards.cardName', 'like', `%${search}%`)
            .orWhere('petty_cash_cards.department', 'like', `%${search}%`)
            .orWhere('petty_cash_users.name', 'like', `%${search}%`);
      });
    }
    
    // Get total count for pagination
    const totalQuery = query.clone();
    const [{ count }] = await totalQuery.clearSelect().clearOrder().count('* as count');
    
    // Get paginated results
    const cards = await query.limit(limit).offset(offset);
    
    winston.info('Petty cash cards retrieved', {
      companyId: req.user.companyId,
      userId: req.user.userId,
      count: cards.length,
      totalCount: count
    });
    
    res.json({
      success: true,
      data: cards,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count,
        pages: Math.ceil(count / limit)
      }
    });
    
  } catch (error) {
    winston.error('Error fetching petty cash cards', {
      error: error.message,
      companyId: req.user.companyId,
      userId: req.user.userId
    });
    
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// GET /petty-cash-cards/:id - Get specific petty cash card
router.get('/:id', requirePermission('VIEW_PETTY_CASH'), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const { id } = req.params;
    
    const card = await db('petty_cash_cards')
      .select(
        'petty_cash_cards.*',
        'assignedUser.firstName as assignedUserFirstName',
        'assignedUser.lastName as assignedUserLastName',
        'assignedUser.email as assignedUserEmail',
        'assignedUser.role as assignedUserRole',
        'createdByUser.firstName as createdByFirstName',
        'createdByUser.lastName as createdByLastName',
        // Include petty cash user info (linked via card_id)
        'petty_cash_users.id as pettyCashUserId',
        'petty_cash_users.name as pettyCashUserName',
        'petty_cash_users.phone as pettyCashUserPhone',
        'petty_cash_users.department as pettyCashUserDepartment',
        'petty_cash_users.employee_id as pettyCashUserEmployeeId',
        'petty_cash_users.is_active as pettyCashUserIsActive'
      )
      .leftJoin('users as assignedUser', 'petty_cash_cards.assignedTo', 'assignedUser.id')
      .leftJoin('users as createdByUser', 'petty_cash_cards.createdBy', 'createdByUser.id')
      .leftJoin('petty_cash_users', 'petty_cash_cards.id', 'petty_cash_users.card_id')
      .where('petty_cash_cards.id', id)
      .first();
    
    if (!card) {
      return res.status(404).json({
        success: false,
        error: 'Petty cash card not found'
      });
    }
    
    // Get recent expenses for this card
    const recentExpenses = await db('petty_cash_expenses')
      .select(
        'id', 'expenseNumber', 'amount', 'description', 
        'expenseDate', 'status', 'created_at'
      )
      .where('cardId', id)
      .orderBy('created_at', 'desc')
      .limit(5);
    
    card.recentExpenses = recentExpenses;
    
    winston.info('Petty cash card retrieved', {
      cardId: id,
      companyId: req.user.companyId,
      userId: req.user.userId
    });
    
    res.json({
      success: true,
      data: card
    });
    
  } catch (error) {
    winston.error('Error fetching petty cash card', {
      error: error.message,
      cardId: req.params.id,
      companyId: req.user.companyId,
      userId: req.user.userId
    });
    
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// POST /petty-cash-cards - Create new petty cash card
router.post('/',
  requirePermission('MANAGE_PETTY_CASH'),
  validate(pettyCashCardSchema),
  async (req, res) => {
    try {
      const db = getDbConnection(req.user.companyId);
      const cardData = req.body;

      // Generate card number (unique identifier for QR code)
      const cardNumber = generateCardNumber(req.user.companyId);

      // Optional: Verify assigned user exists (if provided)
      // Note: User assignment is now optional - petty cash users are managed separately
      if (cardData.assignedTo) {
        const assignedUser = await db('users').where('id', cardData.assignedTo).first();
        if (!assignedUser) {
          return res.status(400).json({
            success: false,
            error: 'Assigned user not found'
          });
        }

        // Check if system user already has an active card (only if assignedTo provided)
        const existingCard = await db('petty_cash_cards')
          .where('assignedTo', cardData.assignedTo)
          .where('status', 'active')
          .first();

        if (existingCard) {
          return res.status(400).json({
            success: false,
            error: 'User already has an active petty cash card'
          });
        }
      }

      const newCard = {
        cardNumber,
        cardName: cardData.cardName || null,
        assignedTo: cardData.assignedTo || null,
        staffName: cardData.staffName || null,
        department: cardData.department || null,
        initialBalance: cardData.initialBalance,
        currentBalance: cardData.initialBalance, // Start with initial balance
        totalSpent: 0,
        monthlyLimit: cardData.monthlyLimit || null,
        issueDate: cardData.issueDate,
        expiryDate: cardData.expiryDate || null,
        status: 'active',
        notes: cardData.notes || null,
        createdBy: req.user.userId
      };

      const [id] = await db('petty_cash_cards').insert(newCard);
      
      winston.info('Petty cash card created', {
        cardId: id,
        cardNumber,
        assignedTo: cardData.assignedTo,
        initialBalance: cardData.initialBalance,
        companyId: req.user.companyId,
        userId: req.user.userId
      });
      
      res.status(201).json({
        success: true,
        data: { id, ...newCard },
        message: 'Petty cash card created successfully'
      });
      
    } catch (error) {
      winston.error('Error creating petty cash card', {
        error: error.message,
        companyId: req.user.companyId,
        userId: req.user.userId
      });
      
      if (error.code === 'ER_DUP_ENTRY') {
        res.status(409).json({
          success: false,
          error: 'Card number already exists'
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

// PUT /petty-cash-cards/:id - Update petty cash card
router.put('/:id',
  requirePermission('MANAGE_PETTY_CASH'),
  validate(updateCardSchema),
  async (req, res) => {
    try {
      const db = getDbConnection(req.user.companyId);
      const { id } = req.params;
      const updateData = req.body;
      
      // Check if card exists
      const existingCard = await db('petty_cash_cards').where('id', id).first();
      
      if (!existingCard) {
        return res.status(404).json({
          success: false,
          error: 'Petty cash card not found'
        });
      }
      
      // If changing assigned user, verify new user exists and doesn't have active card
      if (updateData.assignedTo && updateData.assignedTo !== existingCard.assignedTo) {
        const newAssignedUser = await db('users').where('id', updateData.assignedTo).first();
        if (!newAssignedUser) {
          return res.status(400).json({
            success: false,
            error: 'New assigned user not found'
          });
        }
        
        const existingActiveCard = await db('petty_cash_cards')
          .where('assignedTo', updateData.assignedTo)
          .where('status', 'active')
          .where('id', '!=', id)
          .first();
        
        if (existingActiveCard) {
          return res.status(400).json({
            success: false,
            error: 'User already has an active petty cash card'
          });
        }
      }
      
      await db('petty_cash_cards').where('id', id).update({
        ...updateData,
        updated_at: new Date()
      });
      
      winston.info('Petty cash card updated', {
        cardId: id,
        companyId: req.user.companyId,
        userId: req.user.userId
      });
      
      res.json({
        success: true,
        message: 'Petty cash card updated successfully'
      });
      
    } catch (error) {
      winston.error('Error updating petty cash card', {
        error: error.message,
        cardId: req.params.id,
        companyId: req.user.companyId,
        userId: req.user.userId
      });
      
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }
);

// POST /petty-cash-cards/:id/status - Update card status
router.post('/:id/status',
  requirePermission('MANAGE_PETTY_CASH'),
  validate(statusUpdateSchema),
  async (req, res) => {
    try {
      const db = getDbConnection(req.user.companyId);
      const { id } = req.params;
      const { status, notes } = req.body;
      
      // Check if card exists
      const existingCard = await db('petty_cash_cards').where('id', id).first();
      
      if (!existingCard) {
        return res.status(404).json({
          success: false,
          error: 'Petty cash card not found'
        });
      }
      
      await db('petty_cash_cards').where('id', id).update({
        status,
        notes: notes || existingCard.notes,
        updated_at: new Date()
      });
      
      winston.info('Petty cash card status updated', {
        cardId: id,
        oldStatus: existingCard.status,
        newStatus: status,
        companyId: req.user.companyId,
        userId: req.user.userId
      });
      
      res.json({
        success: true,
        message: `Card status updated to ${status}`
      });
      
    } catch (error) {
      winston.error('Error updating card status', {
        error: error.message,
        cardId: req.params.id,
        companyId: req.user.companyId,
        userId: req.user.userId
      });
      
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }
);

// POST /petty-cash-cards/:id/balance - Update card balance
router.post('/:id/balance',
  requirePermission('MANAGE_PETTY_CASH'),
  validate(balanceUpdateSchema),
  async (req, res) => {
    try {
      const db = getDbConnection(req.user.companyId);
      const { id } = req.params;
      const { amount, type, notes } = req.body;
      
      // Check if card exists and is active
      const existingCard = await db('petty_cash_cards').where('id', id).first();
      
      if (!existingCard) {
        return res.status(404).json({
          success: false,
          error: 'Petty cash card not found'
        });
      }
      
      if (existingCard.status !== 'active') {
        return res.status(400).json({
          success: false,
          error: 'Cannot update balance for inactive card'
        });
      }
      
      // Calculate new balance
      // IMPORTANT: MySQL returns DECIMAL as strings, so we must parseFloat
      const currentBalance = parseFloat(existingCard.currentBalance) || 0;
      let newBalance = currentBalance;

      if (type === 'add') {
        newBalance += parseFloat(amount);
      } else if (type === 'deduct') {
        const deductAmount = parseFloat(amount);
        if (deductAmount > currentBalance) {
          return res.status(400).json({
            success: false,
            error: 'Insufficient balance for deduction'
          });
        }
        newBalance -= deductAmount;
      }
      
      await db('petty_cash_cards').where('id', id).update({
        currentBalance: newBalance,
        updated_at: new Date()
      });
      
      winston.info('Petty cash card balance updated', {
        cardId: id,
        type,
        amount: parseFloat(amount),
        oldBalance: currentBalance,
        newBalance,
        companyId: req.user.companyId,
        userId: req.user.userId
      });

      res.json({
        success: true,
        data: {
          oldBalance: currentBalance,
          newBalance,
          change: type === 'add' ? parseFloat(amount) : -parseFloat(amount)
        },
        message: `Balance ${type === 'add' ? 'added' : 'deducted'} successfully`
      });
      
    } catch (error) {
      winston.error('Error updating card balance', {
        error: error.message,
        cardId: req.params.id,
        companyId: req.user.companyId,
        userId: req.user.userId
      });
      
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }
);

// POST /petty-cash-cards/:id/reload - Reload card balance
router.post('/:id/reload',
  requirePermission('MANAGE_PETTY_CASH'),
  validate(reloadCardSchema),
  async (req, res) => {
    try {
      const db = getDbConnection(req.user.companyId);
      const { id } = req.params;
      const { amount, reloadDate, notes, bankAccountId } = req.body;

      // Check if card exists
      const existingCard = await db('petty_cash_cards').where('id', id).first();

      if (!existingCard) {
        return res.status(404).json({
          success: false,
          error: 'Petty cash card not found'
        });
      }

      // Check if card is active
      if (existingCard.status !== 'active') {
        return res.status(400).json({
          success: false,
          error: 'Cannot reload inactive card. Card status: ' + existingCard.status
        });
      }

      // Calculate new balance
      // IMPORTANT: MySQL returns DECIMAL as strings, so we must parseFloat both values
      // to prevent string concatenation (e.g., "500.000" + 100 = "500.000100")
      const oldBalance = parseFloat(existingCard.currentBalance) || 0;
      const newBalance = oldBalance + parseFloat(amount);

      // Update card balance
      await db('petty_cash_cards').where('id', id).update({
        currentBalance: newBalance,
        updated_at: new Date()
      });

      // If bank account is specified, create a bank transaction (withdrawal for petty cash reload)
      if (bankAccountId) {
        // Get assigned user name for description
        let userName = 'Staff';
        if (existingCard.assignedTo) {
          const user = await db('users')
            .where({ id: existingCard.assignedTo })
            .select('firstName', 'lastName')
            .first();
          if (user) {
            userName = `${user.firstName || ''} ${user.lastName || ''}`.trim();
          }
        }

        // Create bank transaction (withdrawal)
        await db('bank_transactions').insert({
          account_id: bankAccountId,
          transaction_type: 'withdrawal',
          amount: parseFloat(amount),
          transaction_date: reloadDate || new Date().toISOString().split('T')[0],
          description: `Petty Cash Reload - Card ${existingCard.cardNumber}${userName ? ` (${userName})` : ''}`,
          reference_type: 'petty_cash_reload',
          reference_id: id,
          category: 'petty_cash',
          reconciled: false,
          notes: notes || '',
          created_by: req.user.userId,
          created_at: new Date(),
          updated_at: new Date()
        });

        // Update bank account balance
        await db('bank_accounts')
          .where({ id: bankAccountId })
          .decrement('current_balance', parseFloat(amount));

        winston.info('Bank transaction created for petty cash reload', {
          cardId: id,
          cardNumber: existingCard.cardNumber,
          bankAccountId,
          amount
        });
      }

      // Get updated card with user info
      const updatedCard = await db('petty_cash_cards')
        .select(
          'petty_cash_cards.*',
          'assignedUser.firstName as assignedUserFirstName',
          'assignedUser.lastName as assignedUserLastName'
        )
        .leftJoin('users as assignedUser', 'petty_cash_cards.assignedTo', 'assignedUser.id')
        .where('petty_cash_cards.id', id)
        .first();

      winston.info('Petty cash card reloaded', {
        cardId: id,
        cardNumber: existingCard.cardNumber,
        amount,
        oldBalance,
        newBalance,
        reloadDate: reloadDate || new Date().toISOString().split('T')[0],
        notes,
        companyId: req.user.companyId,
        userId: req.user.userId
      });

      res.json({
        success: true,
        data: {
          card: updatedCard,
          reload: {
            amount: parseFloat(amount),
            oldBalance,
            newBalance,
            reloadDate: reloadDate || new Date().toISOString().split('T')[0],
            notes
          }
        },
        message: 'Card reloaded successfully'
      });

    } catch (error) {
      winston.error('Error reloading petty cash card', {
        error: error.message,
        cardId: req.params.id,
        companyId: req.user.companyId,
        userId: req.user.userId
      });

      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }
);

// GET /petty-cash-cards/analytics/summary - Get petty cash cards analytics
router.get('/analytics/summary', requirePermission('VIEW_PETTY_CASH'), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    
    // Get summary statistics
    const [cardStats] = await db('petty_cash_cards')
      .select(
        db.raw('COUNT(*) as totalCards'),
        db.raw('SUM(CASE WHEN status = "active" THEN 1 ELSE 0 END) as activeCards'),
        db.raw('SUM(CASE WHEN status = "suspended" THEN 1 ELSE 0 END) as suspendedCards'),
        db.raw('SUM(CASE WHEN status = "expired" THEN 1 ELSE 0 END) as expiredCards'),
        db.raw('SUM(CASE WHEN status = "closed" THEN 1 ELSE 0 END) as closedCards'),
        db.raw('SUM(initialBalance) as totalInitialBalance'),
        db.raw('SUM(currentBalance) as totalCurrentBalance'),
        db.raw('SUM(totalSpent) as totalSpentAmount')
      );
    
    // Get cards by department
    const cardsByDepartment = await db('petty_cash_cards')
      .select('department', db.raw('COUNT(*) as count'), db.raw('SUM(currentBalance) as totalBalance'))
      .whereNotNull('department')
      .groupBy('department')
      .orderBy('count', 'desc');
    
    // Get top spending cards
    const topSpendingCards = await db('petty_cash_cards')
      .select(
        'id', 'cardNumber', 'staffName', 'department', 
        'totalSpent', 'currentBalance', 'monthlyLimit'
      )
      .where('status', 'active')
      .orderBy('totalSpent', 'desc')
      .limit(10);
    
    // Get cards nearing monthly limit
    const cardsNearLimit = await db('petty_cash_cards')
      .select(
        'id', 'cardNumber', 'staffName', 'department',
        'totalSpent', 'monthlyLimit', 
        db.raw('(totalSpent / monthlyLimit * 100) as percentageUsed')
      )
      .where('status', 'active')
      .whereNotNull('monthlyLimit')
      .where(db.raw('totalSpent / monthlyLimit'), '>', 0.8)
      .orderBy(db.raw('totalSpent / monthlyLimit'), 'desc');
    
    winston.info('Petty cash cards analytics retrieved', {
      companyId: req.user.companyId,
      userId: req.user.userId
    });
    
    res.json({
      success: true,
      data: {
        summary: cardStats,
        byDepartment: cardsByDepartment,
        topSpending: topSpendingCards,
        nearingLimit: cardsNearLimit
      }
    });
    
  } catch (error) {
    winston.error('Error fetching petty cash cards analytics', {
      error: error.message,
      companyId: req.user.companyId,
      userId: req.user.userId
    });
    
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// DELETE /petty-cash-cards/:id - Delete petty cash card (soft delete by closing)
router.delete('/:id', requirePermission('MANAGE_PETTY_CASH'), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const { id } = req.params;
    
    // Check if card exists
    const existingCard = await db('petty_cash_cards').where('id', id).first();
    
    if (!existingCard) {
      return res.status(404).json({
        success: false,
        error: 'Petty cash card not found'
      });
    }
    
    // Check if card has any expenses
    const hasExpenses = await db('petty_cash_expenses').where('cardId', id).first();
    
    if (hasExpenses) {
      // Soft delete by changing status to closed
      await db('petty_cash_cards').where('id', id).update({
        status: 'closed',
        updated_at: new Date()
      });
      
      winston.info('Petty cash card closed (soft delete)', {
        cardId: id,
        companyId: req.user.companyId,
        userId: req.user.userId
      });
      
      res.json({
        success: true,
        message: 'Petty cash card closed successfully (has associated expenses)'
      });
    } else {
      // Hard delete if no expenses
      await db('petty_cash_cards').where('id', id).del();
      
      winston.info('Petty cash card deleted', {
        cardId: id,
        companyId: req.user.companyId,
        userId: req.user.userId
      });
      
      res.json({
        success: true,
        message: 'Petty cash card deleted successfully'
      });
    }
    
  } catch (error) {
    winston.error('Error deleting petty cash card', {
      error: error.message,
      cardId: req.params.id,
      companyId: req.user.companyId,
      userId: req.user.userId
    });
    
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

module.exports = router;