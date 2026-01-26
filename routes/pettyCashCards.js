const express = require('express');
const router = express.Router();
const { getDbConnection } = require('../config/database');
const { requirePermission } = require('../middleware/auth');
const { validate } = require('../middleware/validation');
const Joi = require('joi');
const winston = require('winston');
const {
  logInitialBalance,
  logReload,
  logAdjustment,
  logDeduction,
  getCardTransactionHistory,
} = require('../utils/pettyCashTransactions');
const {
  verifyCardBalance,
  verifyAllCardBalances,
  recalculateAndFixBalance,
  getCardAuditTrail
} = require('../utils/pettyCashBalanceVerifier');
const pettyCashUserService = require('../services/pettyCashUserService');

// Validation schemas
// Note: assignedTo/staffName are now optional - petty cash users are managed separately via /petty-cash-users
const pettyCashCardSchema = Joi.object({
  cardNumber: Joi.string().max(50).allow('', null).optional(), // Manual entry for physical card number
  cardType: Joi.string().valid('top_up', 'petrol').default('top_up').optional(),
  cardName: Joi.string().max(100).allow('', null).optional(),
  assignedTo: Joi.number().integer().positive().allow(null).optional(),
  staffName: Joi.string().max(100).allow('', null).optional(),
  department: Joi.string().max(100).allow('', null).optional(),
  initialBalance: Joi.number().min(0).required(),
  monthlyLimit: Joi.number().min(0).allow(null).optional(),
  // Keep as string (YYYY-MM-DD) to avoid timezone conversion issues
  issueDate: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required()
    .messages({ 'string.pattern.base': 'issueDate must be in YYYY-MM-DD format' }),
  expiryDate: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).allow('', null).optional()
    .messages({ 'string.pattern.base': 'expiryDate must be in YYYY-MM-DD format' }),
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

const deactivateCardSchema = Joi.object({
  reason: Joi.string().min(5).max(500).required().messages({
    'string.min': 'Deactivation reason must be at least 5 characters',
    'any.required': 'Deactivation reason is required'
  })
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
  // Keep as string (YYYY-MM-DD) to avoid timezone conversion issues
  reloadDate: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).optional()
    .messages({ 'string.pattern.base': 'reloadDate must be in YYYY-MM-DD format' }),
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
      cardType,
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

    if (cardType) {
      query = query.where('petty_cash_cards.card_type', cardType);
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

// GET /petty-cash-cards/petrol-card - Get user's assigned petrol card
// This endpoint is used when creating expenses with petrol_card payment method
// Query param: userId (optional) - if not provided, uses authenticated user's ID
router.get('/petrol-card', requirePermission('VIEW_PETTY_CASH'), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const { userId } = req.query;

    // Get the petrol card assigned to the specified user (or authenticated user if not specified)
    const targetUserId = userId ? parseInt(userId) : req.user.userId;

    const petrolCard = await db('petty_cash_cards')
      .select(
        'petty_cash_cards.id',
        'petty_cash_cards.cardNumber',
        'petty_cash_cards.cardName',
        'petty_cash_cards.card_type',
        'petty_cash_cards.currentBalance',
        'petty_cash_cards.status',
        'petty_cash_cards.assignedTo',
        'users.firstName as assignedUserFirstName',
        'users.lastName as assignedUserLastName'
      )
      .leftJoin('users', 'petty_cash_cards.assignedTo', 'users.id')
      .where('petty_cash_cards.card_type', 'petrol')
      .where('petty_cash_cards.status', 'active')
      .where('petty_cash_cards.assignedTo', targetUserId)
      .first();

    if (!petrolCard) {
      return res.status(404).json({
        success: false,
        error: 'No active petrol card found for this user',
        data: null
      });
    }

    res.json({
      success: true,
      data: petrolCard
    });

  } catch (error) {
    winston.error('Error fetching petrol card', {
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

// GET /petty-cash-cards/user-cards/:userId - Get all cards assigned to a user (top-up and petrol)
// Used for expense forms to determine available payment methods
router.get('/user-cards/:userId', requirePermission('VIEW_PETTY_CASH'), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const { userId } = req.params;

    const cards = await db('petty_cash_cards')
      .select(
        'id',
        'cardNumber',
        'cardName',
        'card_type',
        'currentBalance',
        'status',
        'assignedTo'
      )
      .where('assignedTo', userId)
      .where('status', 'active');

    // Separate into top-up and petrol cards
    const topUpCard = cards.find(c => c.card_type === 'top_up') || null;
    const petrolCard = cards.find(c => c.card_type === 'petrol') || null;

    res.json({
      success: true,
      data: {
        topUpCard,
        petrolCard,
        allCards: cards
      }
    });

  } catch (error) {
    winston.error('Error fetching user cards', {
      error: error.message,
      userId: req.params.userId,
      companyId: req.user.companyId
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
      const cardType = cardData.cardType || 'top_up';

      // Validate card type specific rules
      if (cardType === 'petrol') {
        // Petrol cards can be assigned to users (one petrol card per user)
        if (cardData.assignedTo) {
          const assignedUser = await db('users').where('id', cardData.assignedTo).first();
          if (!assignedUser) {
            return res.status(400).json({
              success: false,
              error: 'Assigned user not found'
            });
          }

          // Check if user already has an active petrol card
          const existingPetrolCard = await db('petty_cash_cards')
            .where('assignedTo', cardData.assignedTo)
            .where('card_type', 'petrol')
            .where('status', 'active')
            .first();

          if (existingPetrolCard) {
            return res.status(400).json({
              success: false,
              error: 'User already has an active petrol card assigned'
            });
          }
        }
      }

      // Use provided card number or generate one
      let cardNumber;
      if (cardData.cardNumber && cardData.cardNumber.trim()) {
        // Verify card number is unique
        const existingCardNumber = await db('petty_cash_cards')
          .where('cardNumber', cardData.cardNumber.trim())
          .first();

        if (existingCardNumber) {
          return res.status(400).json({
            success: false,
            error: 'Card number already exists. Please enter a unique card number.'
          });
        }
        cardNumber = cardData.cardNumber.trim();
      } else {
        // Auto-generate card number
        cardNumber = generateCardNumber(req.user.companyId);
      }

      // For top-up cards: Optional user assignment validation
      if (cardType === 'top_up' && cardData.assignedTo) {
        const assignedUser = await db('users').where('id', cardData.assignedTo).first();
        if (!assignedUser) {
          return res.status(400).json({
            success: false,
            error: 'Assigned user not found'
          });
        }

        // Check if system user already has an active card
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
        card_type: cardType,
        cardName: cardData.cardName || (cardType === 'petrol' ? 'Petrol Card' : null),
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

      // Log initial balance transaction (if balance > 0)
      if (cardData.initialBalance > 0) {
        await logInitialBalance(
          db,
          id,
          cardData.initialBalance,
          req.user.userId,
          req.user.companyId
        );
      }

      // Handle petty cash user linking for cards with assigned users
      // Both top-up and petrol cards can be assigned to users
      let pettyCashUserResult = null;
      let generatedPin = null;

      if (cardData.assignedTo) {
        try {
          // Check if user already has a petty cash user record (from auto-creation during registration)
          const existingPcUser = await pettyCashUserService.findByUserId(
            cardData.assignedTo,
            req.user.companyId
          );

          if (existingPcUser) {
            // Activate existing PC user and link to this card
            pettyCashUserResult = await pettyCashUserService.activateAndLinkCard(
              existingPcUser.id,
              id,
              req.user.companyId,
              { activatedBy: req.user.userId }
            );
            generatedPin = pettyCashUserResult.generatedPin;

            winston.info('Existing petty cash user activated and linked to card', {
              pettyCashUserId: existingPcUser.id,
              cardId: id,
              userId: cardData.assignedTo,
            });
          } else {
            // No existing PC user - get or create one (legacy flow with auto-creation)
            const createResult = await pettyCashUserService.getOrCreate(
              cardData.assignedTo,
              req.user.companyId,
              {
                name: cardData.staffName || `User ${cardData.assignedTo}`,
                department: cardData.department,
                createdBy: req.user.userId,
              }
            );

            // Now activate and link the card
            pettyCashUserResult = await pettyCashUserService.activateAndLinkCard(
              createResult.pettyCashUser.id,
              id,
              req.user.companyId,
              { activatedBy: req.user.userId }
            );
            generatedPin = pettyCashUserResult.generatedPin;

            winston.info('New petty cash user created and linked to card', {
              pettyCashUserId: createResult.pettyCashUser.id,
              cardId: id,
              userId: cardData.assignedTo,
              wasExisting: createResult.existing,
            });
          }
        } catch (pcError) {
          // Log error but don't fail card creation
          winston.error('Failed to link petty cash user to card', {
            cardId: id,
            userId: cardData.assignedTo,
            error: pcError.message,
          });
        }
      }

      winston.info('Petty cash card created', {
        cardId: id,
        cardNumber,
        cardType,
        assignedTo: cardData.assignedTo || null,
        initialBalance: cardData.initialBalance,
        companyId: req.user.companyId,
        userId: req.user.userId,
        pettyCashUserLinked: !!pettyCashUserResult,
      });

      res.status(201).json({
        success: true,
        data: {
          id,
          ...newCard,
          // Include generated PIN (one-time display) if a PC user was linked
          ...(generatedPin ? { generatedPin } : {}),
          pettyCashUser: pettyCashUserResult ? {
            id: pettyCashUserResult.pettyCashUserId,
            activated: true,
            message: 'Petty cash user activated. Please securely provide the PIN to the user.',
          } : null,
        },
        message: generatedPin
          ? 'Petty cash card created and user activated. IMPORTANT: Save the generated PIN - it will only be shown once!'
          : 'Petty cash card created successfully'
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

      // Handle card type changes and validation
      const newCardType = updateData.cardType || existingCard.card_type;

      // Validate card type specific rules for petrol cards
      if (newCardType === 'petrol' && updateData.assignedTo && updateData.assignedTo !== existingCard.assignedTo) {
        // If assigning petrol card to a different user, verify user exists
        const newAssignedUser = await db('users').where('id', updateData.assignedTo).first();
        if (!newAssignedUser) {
          return res.status(400).json({
            success: false,
            error: 'Assigned user not found'
          });
        }

        // Check if new user already has an active petrol card
        const existingPetrolCard = await db('petty_cash_cards')
          .where('assignedTo', updateData.assignedTo)
          .where('card_type', 'petrol')
          .where('status', 'active')
          .where('id', '!=', id)
          .first();

        if (existingPetrolCard) {
          return res.status(400).json({
            success: false,
            error: 'User already has an active petrol card assigned'
          });
        }
      }

      // If changing assigned user for top-up card, verify new user exists and doesn't have active card
      if (newCardType === 'top_up' && updateData.assignedTo && updateData.assignedTo !== existingCard.assignedTo) {
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

      // Handle card number uniqueness if being updated
      if (updateData.cardNumber && updateData.cardNumber !== existingCard.cardNumber) {
        const duplicateCard = await db('petty_cash_cards')
          .where('cardNumber', updateData.cardNumber.trim())
          .where('id', '!=', id)
          .first();

        if (duplicateCard) {
          return res.status(400).json({
            success: false,
            error: 'Card number already exists. Please enter a unique card number.'
          });
        }
      }

      // Build update object with card_type mapping
      const updateFields = { ...updateData };
      if (updateData.cardType) {
        updateFields.card_type = updateData.cardType;
        delete updateFields.cardType;
      }

      await db('petty_cash_cards').where('id', id).update({
        ...updateFields,
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

      // Log the transaction
      if (type === 'add') {
        await logAdjustment(
          db,
          id,
          parseFloat(amount),
          currentBalance,
          newBalance,
          req.user.userId,
          req.user.companyId,
          notes
        );
      } else {
        await logDeduction(
          db,
          id,
          parseFloat(amount),
          currentBalance,
          newBalance,
          req.user.userId,
          req.user.companyId,
          notes
        );
      }

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

      // Log the reload transaction
      await logReload(
        db,
        parseInt(id),
        parseFloat(amount),
        oldBalance,
        newBalance,
        req.user.userId,
        req.user.companyId,
        notes
      );

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

// GET /petty-cash-cards/:id/transactions - Get card transaction history
router.get('/:id/transactions', requirePermission('VIEW_PETTY_CASH'), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const { id } = req.params;
    const { page = 1, limit = 50, type, dateFrom, dateTo } = req.query;

    // Check if card exists
    const existingCard = await db('petty_cash_cards').where('id', id).first();

    if (!existingCard) {
      return res.status(404).json({
        success: false,
        error: 'Petty cash card not found'
      });
    }

    // Get transaction history
    const result = await getCardTransactionHistory(db, id, {
      page: parseInt(page),
      limit: parseInt(limit),
      transactionType: type,
      dateFrom,
      dateTo,
    });

    winston.info('Petty cash card transactions retrieved', {
      cardId: id,
      transactionCount: result.transactions.length,
      companyId: req.user.companyId,
      userId: req.user.userId
    });

    res.json({
      success: true,
      data: result.transactions,
      pagination: result.pagination
    });

  } catch (error) {
    winston.error('Error fetching card transactions', {
      error: error.message,
      cardId: req.params.id,
      companyId: req.user.companyId
    });

    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// POST /petty-cash-cards/:id/deactivate - Deactivate card with reason
router.post('/:id/deactivate',
  requirePermission('MANAGE_PETTY_CASH'),
  validate(deactivateCardSchema),
  async (req, res) => {
    try {
      const db = getDbConnection(req.user.companyId);
      const { id } = req.params;
      const { reason } = req.body;

      // Check if card exists
      const existingCard = await db('petty_cash_cards').where('id', id).first();

      if (!existingCard) {
        return res.status(404).json({
          success: false,
          error: 'Petty cash card not found'
        });
      }

      if (existingCard.status === 'closed') {
        return res.status(400).json({
          success: false,
          error: 'Card is already closed'
        });
      }

      // Update card status with deactivation details
      await db('petty_cash_cards').where('id', id).update({
        status: 'suspended',
        deactivation_reason: reason,
        deactivated_at: new Date(),
        deactivated_by: req.user.userId,
        updated_at: new Date()
      });

      // Also deactivate any linked petty cash user
      await db('petty_cash_users')
        .where('card_id', id)
        .update({
          is_active: false,
          deactivation_reason: `Card deactivated: ${reason}`,
          deactivated_at: new Date(),
          deactivated_by: req.user.userId,
          updated_at: new Date()
        });

      winston.info('Petty cash card deactivated with reason', {
        cardId: id,
        reason,
        previousStatus: existingCard.status,
        companyId: req.user.companyId,
        userId: req.user.userId
      });

      res.json({
        success: true,
        message: 'Card deactivated successfully',
        data: {
          cardId: id,
          status: 'suspended',
          reason,
          deactivatedAt: new Date()
        }
      });

    } catch (error) {
      winston.error('Error deactivating card', {
        error: error.message,
        cardId: req.params.id,
        companyId: req.user.companyId
      });

      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }
);

// POST /petty-cash-cards/:id/reactivate - Reactivate a deactivated card
router.post('/:id/reactivate', requirePermission('MANAGE_PETTY_CASH'), async (req, res) => {
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

    if (existingCard.status === 'active') {
      return res.status(400).json({
        success: false,
        error: 'Card is already active'
      });
    }

    if (existingCard.status === 'closed') {
      return res.status(400).json({
        success: false,
        error: 'Closed cards cannot be reactivated. Create a new card instead.'
      });
    }

    // Reactivate the card
    await db('petty_cash_cards').where('id', id).update({
      status: 'active',
      deactivation_reason: null,
      deactivated_at: null,
      deactivated_by: null,
      updated_at: new Date()
    });

    // Also reactivate any linked petty cash user
    await db('petty_cash_users')
      .where('card_id', id)
      .update({
        is_active: true,
        deactivation_reason: null,
        deactivated_at: null,
        deactivated_by: null,
        failed_attempts: 0,
        locked_until: null,
        updated_at: new Date()
      });

    winston.info('Petty cash card reactivated', {
      cardId: id,
      previousStatus: existingCard.status,
      companyId: req.user.companyId,
      userId: req.user.userId
    });

    res.json({
      success: true,
      message: 'Card reactivated successfully'
    });

  } catch (error) {
    winston.error('Error reactivating card', {
      error: error.message,
      cardId: req.params.id,
      companyId: req.user.companyId
    });

    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// ============================================
// BALANCE VERIFICATION ENDPOINTS
// ============================================

// GET /petty-cash-cards/:id/verify-balance - Verify single card balance
router.get('/:id/verify-balance', requirePermission('MANAGE_PETTY_CASH'), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const { id } = req.params;

    const result = await verifyCardBalance(db, id);

    if (!result.success) {
      return res.status(404).json({
        success: false,
        error: result.error
      });
    }

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    winston.error('Error verifying card balance', {
      error: error.message,
      cardId: req.params.id,
      companyId: req.user.companyId
    });

    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// GET /petty-cash-cards/verify-all-balances - Verify all card balances
router.get('/verify-all-balances', requirePermission('MANAGE_PETTY_CASH'), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);

    const result = await verifyAllCardBalances(db);

    winston.info('All card balances verified', {
      companyId: req.user.companyId,
      userId: req.user.userId,
      totalCards: result.totalCards,
      validCards: result.validCards,
      invalidCards: result.invalidCards
    });

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    winston.error('Error verifying all card balances', {
      error: error.message,
      companyId: req.user.companyId
    });

    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// POST /petty-cash-cards/:id/fix-balance - Recalculate and fix card balance
router.post('/:id/fix-balance', requirePermission('MANAGE_PETTY_CASH'), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const { id } = req.params;

    const result = await recalculateAndFixBalance(db, id, req.user.userId);

    winston.info('Card balance fixed', {
      cardId: id,
      companyId: req.user.companyId,
      userId: req.user.userId,
      result
    });

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    winston.error('Error fixing card balance', {
      error: error.message,
      cardId: req.params.id,
      companyId: req.user.companyId
    });

    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
});

// GET /petty-cash-cards/:id/audit-trail - Get detailed audit trail for a card
router.get('/:id/audit-trail', requirePermission('MANAGE_PETTY_CASH'), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const { id } = req.params;

    const result = await getCardAuditTrail(db, id);

    if (!result.success) {
      return res.status(404).json({
        success: false,
        error: result.error
      });
    }

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    winston.error('Error getting card audit trail', {
      error: error.message,
      cardId: req.params.id,
      companyId: req.user.companyId
    });

    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

module.exports = router;