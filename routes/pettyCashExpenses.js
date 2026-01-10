const express = require('express');
const router = express.Router();
const { getDbConnection } = require('../config/database');
const { requirePermission } = require('../middleware/auth');
const { validate } = require('../middleware/validation');
const { getRepositoryFactory } = require('../repositories/RepositoryFactory');
const Joi = require('joi');
const winston = require('winston');
const storageService = require('../services/storageService');
const { MAX_FILE_SIZE } = require('../config/s3.config');
const { validateFileSignature } = require('../utils/fileValidation');
const {
  createS3SingleUpload,
  handleS3UploadError,
} = require('../middleware/upload');
const {
  logExpenseSubmission,
  logExpenseRejection,
} = require('../utils/pettyCashTransactions');

// Use shared upload middleware for receipt uploads (memory storage for S3)
// Using createS3SingleUpload with 'receipt' field name for backward compatibility
const uploadReceipt = handleS3UploadError(createS3SingleUpload('receipt'));

// Valid payment methods (updated for card type system)
// top_up_card: User's assigned petty cash card - deducts from card balance
// petrol_card: Shared fuel card - deducts from petrol card balance (fuel only)
// company_card: Company debit card - no petty cash deduction
// iou: Personal expense - no immediate deduction, reimbursed when approved
const PAYMENT_METHODS = ['top_up_card', 'petrol_card', 'company_card', 'iou'];

// Validation schemas
// IMPORTANT: Use string for dates to avoid timezone conversion issues
// Joi.date().iso() converts to Date object which causes UTC timezone shifts
const expenseSchema = Joi.object({
  // cardId is required for top_up_card, optional for petrol_card (auto-selected), not needed for company_card/iou
  cardId: Joi.number().integer().positive().allow(null).optional(),
  category: Joi.string().min(2).max(100).required(),
  paymentMethod: Joi.string().valid(...PAYMENT_METHODS).default('top_up_card'),
  description: Joi.string().min(2).max(2000).required(),
  amount: Joi.number().positive().required(),
  // Keep as string (YYYY-MM-DD format) to preserve date without timezone conversion
  expenseDate: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required()
    .messages({ 'string.pattern.base': 'expenseDate must be in YYYY-MM-DD format' }),
  vendor: Joi.string().max(200).allow(null, '').optional(),
  receiptNumber: Joi.string().max(100).allow(null, '').optional(),
  receiptPhoto: Joi.string().max(500).allow(null, '').optional(),
  notes: Joi.string().max(1000).allow(null, '').optional(),
  // Optional: Admin can assign expense to a specific PC user
  submittedByPcUser: Joi.number().integer().positive().allow(null).optional()
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

// Predefined expense categories with display names and limits
const expenseCategories = [
  { id: 'fuel', name: 'Fuel & Petrol', maxAmount: 500, category: 'operational' },
  { id: 'transport', name: 'Transport & Taxi', maxAmount: 200, category: 'operational' },
  { id: 'meals', name: 'Meals & Refreshments', maxAmount: 100, category: 'daily' },
  { id: 'office_supplies', name: 'Office Supplies', maxAmount: 300, category: 'operational' },
  { id: 'utilities', name: 'Utilities & Bills', maxAmount: 500, category: 'operational' },
  { id: 'maintenance', name: 'Maintenance & Repairs', maxAmount: 1000, category: 'operational' },
  { id: 'communication', name: 'Communication & Phone', maxAmount: 150, category: 'daily' },
  { id: 'travel', name: 'Travel Expenses', maxAmount: 500, category: 'operational' },
  { id: 'entertainment', name: 'Entertainment & Hospitality', maxAmount: 300, category: 'daily' },
  { id: 'miscellaneous', name: 'Miscellaneous', maxAmount: 200, category: 'other' },
  { id: 'equipment', name: 'Equipment & Tools', maxAmount: 500, category: 'operational' },
  { id: 'services', name: 'Professional Services', maxAmount: 1000, category: 'operational' },
  { id: 'emergency', name: 'Emergency Expenses', maxAmount: 2000, category: 'other' }
];

// Helper to get category IDs for validation (fallback)
const expenseCategoryIds = expenseCategories.map(cat => cat.id);

// Helper to validate expense category against database or fallback
async function isValidExpenseCategory(db, categoryCode) {
  if (!categoryCode) return false;

  // Normalize to lowercase for comparison
  const normalizedCode = categoryCode.toLowerCase();

  try {
    // First try to validate against database categories (case-insensitive)
    const dbCategory = await db('expense_categories')
      .whereRaw('LOWER(code) = ?', [normalizedCode])
      .where('is_active', true)
      .whereIn('type', ['petty_cash', 'operational', 'other'])
      .first();

    if (dbCategory) {
      return true;
    }
  } catch (error) {
    // Table might not exist or other DB error - fall through to hardcoded validation
    winston.debug('Database category validation failed, using fallback', { error: error.message });
  }

  // Fallback to hardcoded categories (also case-insensitive)
  return expenseCategoryIds.some(id => id.toLowerCase() === normalizedCode);
}

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
      query = query.where('petty_cash_expenses.submittedBy', req.user.userId);
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
      userId: req.user.userId,
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
      userId: req.user.userId
    });
    
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// GET /petty-cash-expenses/categories - Get expense categories (from database)
router.get('/categories', requirePermission('VIEW_EXPENSE_REPORTS'), async (req, res) => {
  try {
    const repositoryFactory = getRepositoryFactory(req.user.companyId);
    const categoryRepository = repositoryFactory.getExpenseCategoriesRepository();
    const locale = req.query.locale || 'en';

    // Fetch petty_cash type categories from the database
    const dbCategories = await categoryRepository.findForDropdown('petty_cash', locale);

    if (dbCategories && dbCategories.length > 0) {
      // Map database categories to match expected format
      // Use lowercase code for consistency with existing expense data
      const categories = dbCategories.map(cat => ({
        id: cat.code.toLowerCase(),
        code: cat.code,
        name: cat.name,
        maxAmount: cat.maxAmount || null,
        category: 'petty_cash'
      }));

      return res.json({
        success: true,
        data: categories
      });
    }

    // Fallback to predefined categories if no database categories exist
    winston.debug('No database categories found, using fallback', {
      companyId: req.user.companyId
    });

    res.json({
      success: true,
      data: expenseCategories
    });
  } catch (error) {
    winston.error('Error fetching expense categories', {
      error: error.message,
      companyId: req.user.companyId
    });

    // Fallback to predefined categories on error
    res.json({
      success: true,
      data: expenseCategories
    });
  }
});

// GET /petty-cash-expenses/pending-reimbursements - Get all pending IOU reimbursements
// NOTE: This route must come BEFORE /:id routes to avoid matching "pending-reimbursements" as an id
router.get('/pending-reimbursements', requirePermission('VIEW_PETTY_CASH'), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);

    const pendingReimbursements = await db('petty_cash_expenses')
      .select(
        'petty_cash_expenses.*',
        'submitter.firstName as submitterFirstName',
        'submitter.lastName as submitterLastName',
        'submitter.email as submitterEmail',
        'approver.firstName as approverFirstName',
        'approver.lastName as approverLastName'
      )
      .leftJoin('users as submitter', 'petty_cash_expenses.submittedBy', 'submitter.id')
      .leftJoin('users as approver', 'petty_cash_expenses.approvedBy', 'approver.id')
      .where('petty_cash_expenses.payment_method', 'iou')
      .where('petty_cash_expenses.status', 'approved')
      .where('petty_cash_expenses.reimbursement_status', 'pending')
      .orderBy('petty_cash_expenses.approvedAt', 'asc');

    // Calculate totals
    const totalPending = pendingReimbursements.reduce(
      (sum, exp) => sum + parseFloat(exp.reimbursement_amount || exp.amount || 0),
      0
    );

    res.json({
      success: true,
      data: pendingReimbursements,
      summary: {
        count: pendingReimbursements.length,
        totalPendingAmount: totalPending
      }
    });

  } catch (error) {
    winston.error('Error fetching pending reimbursements', {
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

// POST /petty-cash-expenses - Create new expense
router.post('/',
  requirePermission('CREATE_EXPENSE'),
  validate(expenseSchema),
  async (req, res) => {
    try {
      const db = getDbConnection(req.user.companyId);
      const expenseData = req.body;
      const paymentMethod = expenseData.paymentMethod || 'top_up_card';
      const requestedAmount = parseFloat(expenseData.amount) || 0;

      // Generate expense number
      const expenseNumber = generateExpenseNumber(req.user.companyId);

      // Validate expense category (check database first, then fallback to hardcoded)
      const isValidCategory = await isValidExpenseCategory(db, expenseData.category);
      if (!isValidCategory) {
        return res.status(400).json({
          success: false,
          error: 'Invalid expense category'
        });
      }

      // Payment method specific validation and card handling
      let card = null;
      let petrolCardId = null;
      let cardBalance = 0;
      let shouldDeductBalance = false;

      switch (paymentMethod) {
        case 'top_up_card': {
          // top_up_card: Requires cardId, deducts from user's top-up card
          if (!expenseData.cardId) {
            return res.status(400).json({
              success: false,
              error: 'Card ID is required for top-up card payment'
            });
          }

          card = await db('petty_cash_cards').where('id', expenseData.cardId).first();
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

          // Validate it's a top-up card, not petrol
          if (card.card_type === 'petrol') {
            return res.status(400).json({
              success: false,
              error: 'Cannot use petrol card with top_up_card payment method. Use petrol_card instead.'
            });
          }

          // Check if user has permission to use this card
          const canManageExpenses = req.user.permissions.includes('MANAGE_EXPENSES') ||
                                     req.user.permissions.includes('MANAGE_PETTY_CASH');
          if (card.assignedTo !== req.user.userId && !canManageExpenses) {
            return res.status(403).json({
              success: false,
              error: 'You are not authorized to use this card'
            });
          }

          cardBalance = parseFloat(card.currentBalance) || 0;
          if (requestedAmount > cardBalance) {
            return res.status(400).json({
              success: false,
              error: 'Insufficient card balance for this expense'
            });
          }

          // Check monthly limit if set
          if (card.monthlyLimit) {
            const currentMonth = new Date().toISOString().slice(0, 7);
            const [monthlySpent] = await db('petty_cash_expenses')
              .where('cardId', expenseData.cardId)
              .where('status', 'approved')
              .where(db.raw('DATE_FORMAT(expenseDate, "%Y-%m")'), currentMonth)
              .sum('amount as total');

            const monthlyTotal = parseFloat(monthlySpent.total) || 0;
            const monthlyLimit = parseFloat(card.monthlyLimit) || 0;

            if ((monthlyTotal + requestedAmount) > monthlyLimit) {
              return res.status(400).json({
                success: false,
                error: `This expense would exceed the monthly limit of ${monthlyLimit.toFixed(3)}. Current monthly spent: ${monthlyTotal.toFixed(3)}`
              });
            }
          }

          shouldDeductBalance = true;
          break;
        }

        case 'petrol_card': {
          // petrol_card: Auto-select company's petrol card, fuel category only
          if (expenseData.category !== 'fuel') {
            return res.status(400).json({
              success: false,
              error: 'Petrol card can only be used for fuel category expenses'
            });
          }

          // Find company's active petrol card
          card = await db('petty_cash_cards')
            .where('card_type', 'petrol')
            .where('status', 'active')
            .first();

          if (!card) {
            return res.status(400).json({
              success: false,
              error: 'No active petrol card found for this company. Please use another payment method.'
            });
          }

          cardBalance = parseFloat(card.currentBalance) || 0;
          if (requestedAmount > cardBalance) {
            return res.status(400).json({
              success: false,
              error: `Insufficient petrol card balance (${cardBalance.toFixed(3)}). Consider using top-up card or IOU.`
            });
          }

          petrolCardId = card.id;
          shouldDeductBalance = true;
          break;
        }

        case 'company_card': {
          // company_card: No petty cash card involvement, paid via company bank
          // No balance checks or deductions
          break;
        }

        case 'iou': {
          // IOU: Personal expense, will be reimbursed when approved
          // No balance checks or deductions
          break;
        }

        default:
          return res.status(400).json({
            success: false,
            error: 'Invalid payment method'
          });
      }

      // If admin specifies a PC user and we have a card, validate they belong to this card
      let pcUserId = null;
      if (expenseData.submittedByPcUser && card) {
        const pcUser = await db('petty_cash_users')
          .where('id', expenseData.submittedByPcUser)
          .where('card_id', card.id)
          .where('is_active', true)
          .first();

        if (!pcUser) {
          return res.status(400).json({
            success: false,
            error: 'Invalid petty cash user for this card'
          });
        }
        pcUserId = pcUser.id;
      }

      // Determine if expense requires reimbursement
      const requiresReimbursement = paymentMethod === 'iou';

      const newExpense = {
        expenseNumber,
        cardId: paymentMethod === 'top_up_card' ? expenseData.cardId :
                (paymentMethod === 'petrol_card' ? card.id : null),
        petrol_card_id: petrolCardId,
        category: expenseData.category,
        payment_method: paymentMethod,
        requires_reimbursement: requiresReimbursement,
        description: expenseData.description,
        amount: expenseData.amount,
        expenseDate: expenseData.expenseDate,
        vendor: expenseData.vendor || null,
        receiptNumber: expenseData.receiptNumber || null,
        receiptPhoto: expenseData.receiptPhoto || null,
        status: 'pending',
        submittedBy: req.user.userId,
        submitted_by_pc_user: pcUserId,
        notes: expenseData.notes || null
      };

      // Use transaction for atomic operations (if balance deduction needed)
      const result = await db.transaction(async (trx) => {
        // 1. Create the expense record
        const [id] = await trx('petty_cash_expenses').insert(newExpense);

        // 2. Deduct balance from card if applicable (top_up_card or petrol_card)
        let newBalance = null;
        if (shouldDeductBalance && card) {
          await trx('petty_cash_cards')
            .where('id', card.id)
            .update({
              currentBalance: trx.raw('currentBalance - ?', [requestedAmount])
            });

          newBalance = cardBalance - requestedAmount;

          // 3. Log the expense submission transaction
          await logExpenseSubmission(trx, card.id, id, requestedAmount, {
            cardBalance: cardBalance,
            description: `${expenseData.category}: ${expenseData.description}`,
            pcUserId: pcUserId,
            performedBy: req.user.userId,
            paymentMethod: paymentMethod
          });
        }

        return { id, newBalance };
      });

      winston.info('Petty cash expense created', {
        expenseId: result.id,
        expenseNumber,
        paymentMethod,
        cardId: card ? card.id : null,
        petrolCardId,
        amount: expenseData.amount,
        previousBalance: shouldDeductBalance ? cardBalance : null,
        newBalance: result.newBalance,
        requiresReimbursement,
        category: expenseData.category,
        companyId: req.user.companyId,
        userId: req.user.userId
      });

      // Build response message based on payment method
      let message = 'Expense submitted successfully.';
      if (paymentMethod === 'top_up_card' || paymentMethod === 'petrol_card') {
        message = 'Expense submitted successfully. Balance has been reserved pending approval.';
      } else if (paymentMethod === 'iou') {
        message = 'IOU expense submitted successfully. You will be reimbursed when this expense is approved.';
      } else if (paymentMethod === 'company_card') {
        message = 'Company card expense submitted successfully.';
      }

      res.status(201).json({
        success: true,
        data: {
          id: result.id,
          ...newExpense,
          newCardBalance: result.newBalance
        },
        message
      });

    } catch (error) {
      winston.error('Error creating petty cash expense', {
        error: error.message,
        companyId: req.user.companyId,
        userId: req.user.userId
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
      if (existingExpense.submittedBy !== req.user.userId && !req.user.permissions.includes('MANAGE_EXPENSES')) {
        return res.status(403).json({
          success: false,
          error: 'You can only update your own expenses'
        });
      }

      // Validate category if provided (check database first, then fallback to hardcoded)
      if (updateData.category) {
        const isValidCategory = await isValidExpenseCategory(db, updateData.category);
        if (!isValidCategory) {
          return res.status(400).json({
            success: false,
            error: 'Invalid expense category'
          });
        }
      }

      // Determine if card or amount is changing (for balance adjustments)
      const originalCardId = existingExpense.cardId;
      const originalAmount = parseFloat(existingExpense.amount);
      const newCardId = updateData.cardId !== undefined ? updateData.cardId : originalCardId;
      const newAmount = updateData.amount !== undefined ? parseFloat(updateData.amount) : originalAmount;
      const cardChanged = newCardId !== originalCardId;
      const amountChanged = newAmount !== originalAmount;

      // Check if balance adjustment is needed (only for top_up_card or petrol_card payment methods)
      const requiresBalanceAdjustment = (cardChanged || amountChanged) &&
        ['top_up_card', 'petrol_card'].includes(existingExpense.payment_method);

      // Use transaction for ACID compliance when balance adjustments are needed
      const result = await db.transaction(async (trx) => {
        // If balance adjustment is required
        if (requiresBalanceAdjustment) {
          // Validate new card if card is changing
          if (cardChanged && newCardId) {
            const newCard = await trx('petty_cash_cards')
              .where('id', newCardId)
              .first();

            if (!newCard) {
              throw new Error('New card not found');
            }

            if (newCard.status !== 'active') {
              throw new Error('New card is not active');
            }

            // Check if new card has sufficient balance
            if (parseFloat(newCard.currentBalance) < newAmount) {
              throw new Error(`Insufficient balance on new card. Required: ${newAmount.toFixed(3)}, Available: ${parseFloat(newCard.currentBalance).toFixed(3)}`);
            }
          }

          // If only amount changed (same card), check if increase is possible
          if (!cardChanged && amountChanged && newAmount > originalAmount && originalCardId) {
            const currentCard = await trx('petty_cash_cards')
              .where('id', originalCardId)
              .first();

            const amountDifference = newAmount - originalAmount;
            if (currentCard && parseFloat(currentCard.currentBalance) < amountDifference) {
              throw new Error(`Insufficient balance for amount increase. Additional required: ${amountDifference.toFixed(3)}, Available: ${parseFloat(currentCard.currentBalance).toFixed(3)}`);
            }
          }

          // Perform balance adjustments
          if (cardChanged) {
            // Card is changing: refund to old card, deduct from new card
            if (originalCardId) {
              // Refund original amount to old card
              await trx('petty_cash_cards')
                .where('id', originalCardId)
                .update({
                  currentBalance: trx.raw('currentBalance + ?', [originalAmount]),
                  totalSpent: trx.raw('GREATEST(0, totalSpent - ?)', [originalAmount]),
                  updated_at: new Date()
                });

              winston.info('Refunded to original card for pending expense edit', {
                cardId: originalCardId,
                amount: originalAmount,
                expenseId: id
              });
            }

            if (newCardId) {
              // Deduct new amount from new card
              await trx('petty_cash_cards')
                .where('id', newCardId)
                .update({
                  currentBalance: trx.raw('currentBalance - ?', [newAmount]),
                  totalSpent: trx.raw('totalSpent + ?', [newAmount]),
                  updated_at: new Date()
                });

              winston.info('Deducted from new card for pending expense edit', {
                cardId: newCardId,
                amount: newAmount,
                expenseId: id
              });
            }
          } else if (amountChanged && originalCardId) {
            // Same card, different amount: adjust the difference
            const amountDifference = newAmount - originalAmount;

            await trx('petty_cash_cards')
              .where('id', originalCardId)
              .update({
                currentBalance: trx.raw('currentBalance - ?', [amountDifference]), // Negative diff = refund
                totalSpent: trx.raw('totalSpent + ?', [amountDifference]),
                updated_at: new Date()
              });

            winston.info('Adjusted card balance for pending expense amount change', {
              cardId: originalCardId,
              amountDifference,
              oldAmount: originalAmount,
              newAmount,
              expenseId: id
            });
          }
        }

        // Map camelCase request fields to snake_case database columns
        const dbUpdateData = {
          updated_at: new Date()
        };

        if (updateData.cardId !== undefined) dbUpdateData.cardId = updateData.cardId;
        if (updateData.category !== undefined) dbUpdateData.category = updateData.category;
        if (updateData.amount !== undefined) dbUpdateData.amount = updateData.amount;
        if (updateData.expenseDate !== undefined) dbUpdateData.expenseDate = updateData.expenseDate;
        if (updateData.description !== undefined) dbUpdateData.description = updateData.description;
        if (updateData.vendor !== undefined) dbUpdateData.vendor = updateData.vendor;
        if (updateData.receiptNumber !== undefined) dbUpdateData.receiptNumber = updateData.receiptNumber;
        if (updateData.receiptPhoto !== undefined) dbUpdateData.receiptPhoto = updateData.receiptPhoto;
        if (updateData.notes !== undefined) dbUpdateData.notes = updateData.notes;
        if (updateData.paymentMethod !== undefined) dbUpdateData.payment_method = updateData.paymentMethod;
        if (updateData.submittedByPcUser !== undefined) dbUpdateData.submittedByPcUser = updateData.submittedByPcUser;

        await trx('petty_cash_expenses').where('id', id).update(dbUpdateData);

        return {
          cardChanged,
          amountChanged,
          balanceAdjusted: requiresBalanceAdjustment
        };
      });

      winston.info('Petty cash expense updated', {
        expenseId: id,
        companyId: req.user.companyId,
        userId: req.user.userId,
        cardChanged: result.cardChanged,
        amountChanged: result.amountChanged,
        balanceAdjusted: result.balanceAdjusted
      });

      res.json({
        success: true,
        message: result.balanceAdjusted
          ? 'Expense updated and card balances adjusted successfully'
          : 'Expense updated successfully',
        data: {
          cardChanged: result.cardChanged,
          amountChanged: result.amountChanged,
          balanceAdjusted: result.balanceAdjusted
        }
      });

    } catch (error) {
      winston.error('Error updating petty cash expense', {
        error: error.message,
        expenseId: req.params.id,
        companyId: req.user.companyId,
        userId: req.user.userId
      });

      // Return user-friendly error for validation errors
      if (error.message.includes('Insufficient balance') ||
          error.message.includes('not found') ||
          error.message.includes('not active')) {
        return res.status(400).json({
          success: false,
          error: error.message
        });
      }

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
        req.user.userId, 
        approvalNotes
      );
      
      winston.info('Petty cash expense approval processed with ACID compliance', {
        expenseId: id,
        status,
        amount: result.amount,
        companyId: req.user.companyId,
        userId: req.user.userId,
        approvedBy: req.user.userId
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
        userId: req.user.userId
      });
      
      res.status(400).json({
        success: false,
        error: error.message || 'Internal server error'
      });
    }
  }
);

// POST /petty-cash-expenses/:id/change-card - Change card and/or amount for approved expense
// This endpoint handles the complex operation of refunding old card and deducting from new card
// Also handles amount changes with proper balance adjustments
const cardChangeSchema = Joi.object({
  newCardId: Joi.number().integer().positive().required(),
  newAmount: Joi.number().positive().optional(),
  notes: Joi.string().max(500).allow('', null).optional()
});

router.post('/:id/change-card',
  requirePermission('MANAGE_PETTY_CASH'),
  validate(cardChangeSchema),
  async (req, res) => {
    try {
      const TransactionManager = require('../utils/transactionManager');
      const txnManager = new TransactionManager(req.user.companyId);

      const { id } = req.params;
      const { newCardId, newAmount, notes } = req.body;

      // Process the card/amount change with ACID compliance
      const result = await txnManager.processExpenseCardChange(
        parseInt(id),
        newCardId,
        newAmount,
        req.user.userId,
        notes
      );

      winston.info('Expense card change completed', {
        expenseId: id,
        newCardId,
        companyId: req.user.companyId,
        userId: req.user.userId,
        result
      });

      res.json({
        success: true,
        data: result,
        message: 'Card changed successfully. Old card refunded, new card deducted.'
      });

    } catch (error) {
      winston.error('Error changing expense card', {
        error: error.message,
        expenseId: req.params.id,
        newCardId: req.body.newCardId,
        companyId: req.user.companyId,
        userId: req.user.userId
      });

      res.status(400).json({
        success: false,
        error: error.message || 'Failed to change card'
      });
    }
  }
);

// POST /petty-cash-expenses/:id/reimburse - Process IOU reimbursement
// This endpoint is used to mark an approved IOU expense as reimbursed
const reimbursementSchema = Joi.object({
  reimbursementAmount: Joi.number().positive().required(),
  // Keep as string (YYYY-MM-DD) to avoid timezone conversion issues
  reimbursementDate: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required()
    .messages({ 'string.pattern.base': 'reimbursementDate must be in YYYY-MM-DD format' }),
  reimbursementMethod: Joi.string().valid('bank_transfer', 'cash', 'check').required(),
  reimbursementReference: Joi.string().max(100).allow('', null).optional()
});

router.post('/:id/reimburse',
  requirePermission('MANAGE_PETTY_CASH'),
  validate(reimbursementSchema),
  async (req, res) => {
    try {
      const db = getDbConnection(req.user.companyId);
      const { id } = req.params;
      const {
        reimbursementAmount,
        reimbursementDate,
        reimbursementMethod,
        reimbursementReference
      } = req.body;

      // Get the expense
      const expense = await db('petty_cash_expenses')
        .where('id', id)
        .first();

      if (!expense) {
        return res.status(404).json({
          success: false,
          error: 'Expense not found'
        });
      }

      // Validate it's an IOU expense
      if (expense.payment_method !== 'iou') {
        return res.status(400).json({
          success: false,
          error: 'Only IOU expenses can be reimbursed'
        });
      }

      // Validate expense is approved
      if (expense.status !== 'approved') {
        return res.status(400).json({
          success: false,
          error: 'Only approved expenses can be reimbursed'
        });
      }

      // Validate reimbursement is pending
      if (expense.reimbursement_status !== 'pending') {
        return res.status(400).json({
          success: false,
          error: expense.reimbursement_status === 'processed'
            ? 'This expense has already been reimbursed'
            : 'This expense is not pending reimbursement'
        });
      }

      // Process the reimbursement
      await db('petty_cash_expenses')
        .where('id', id)
        .update({
          reimbursement_status: 'processed',
          reimbursement_amount: reimbursementAmount,
          reimbursement_date: reimbursementDate,
          reimbursement_method: reimbursementMethod,
          reimbursement_reference: reimbursementReference || null,
          reimbursed_by: req.user.userId,
          reimbursed_at: new Date()
        });

      // Record in transactions table
      await db('transactions').insert({
        transactionNumber: `REIMB-${Date.now().toString().slice(-8)}`,
        transactionType: 'petty_cash_reimbursement',
        referenceId: id,
        referenceType: 'petty_cash_expense',
        materialId: null,
        quantity: null,
        unitPrice: null,
        amount: -reimbursementAmount, // Negative as it's an outflow
        transactionDate: reimbursementDate,
        description: `IOU Reimbursement for ${expense.category}: ${expense.description}`,
        createdBy: req.user.userId
      });

      winston.info('IOU expense reimbursed', {
        expenseId: id,
        expenseNumber: expense.expenseNumber,
        originalAmount: expense.amount,
        reimbursementAmount,
        reimbursementMethod,
        reimbursementReference,
        submittedBy: expense.submittedBy,
        reimbursedBy: req.user.userId,
        companyId: req.user.companyId
      });

      res.json({
        success: true,
        data: {
          expenseId: id,
          expenseNumber: expense.expenseNumber,
          originalAmount: expense.amount,
          reimbursementAmount,
          reimbursementDate,
          reimbursementMethod,
          reimbursementReference,
          reimbursedBy: req.user.userId,
          reimbursedAt: new Date()
        },
        message: 'IOU reimbursement processed successfully'
      });

    } catch (error) {
      winston.error('Error processing IOU reimbursement', {
        error: error.message,
        expenseId: req.params.id,
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
    if (existingExpense.submittedBy !== req.user.userId && !req.user.permissions.includes('MANAGE_EXPENSES')) {
      return res.status(403).json({
        success: false,
        error: 'You can only delete your own expenses'
      });
    }
    
    await db('petty_cash_expenses').where('id', id).del();
    
    winston.info('Petty cash expense deleted', {
      expenseId: id,
      companyId: req.user.companyId,
      userId: req.user.userId
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
      userId: req.user.userId
    });

    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Maximum receipts per expense
const MAX_RECEIPTS_PER_EXPENSE = 2;

// GET /petty-cash-expenses/:id/receipts - Get all receipts for expense
router.get('/:id/receipts',
  requirePermission('CREATE_EXPENSE'),
  async (req, res) => {
    try {
      const db = getDbConnection(req.user.companyId);
      const { id } = req.params;

      // Check if expense exists
      const expense = await db('petty_cash_expenses')
        .select('petty_cash_expenses.*', 'petty_cash_cards.assignedTo')
        .leftJoin('petty_cash_cards', 'petty_cash_expenses.cardId', 'petty_cash_cards.id')
        .where('petty_cash_expenses.id', id)
        .first();

      if (!expense) {
        return res.status(404).json({
          success: false,
          error: 'Expense not found'
        });
      }

      // Check permission: owner, card holder, or admin
      const isOwner = expense.submittedBy === req.user.userId;
      const isCardHolder = expense.assignedTo === req.user.userId;
      const canManage = req.user.permissions.includes('MANAGE_PETTY_CASH') ||
                        req.user.permissions.includes('MANAGE_EXPENSES') ||
                        req.user.permissions.includes('VIEW_EXPENSES');

      if (!isOwner && !isCardHolder && !canManage) {
        return res.status(403).json({
          success: false,
          error: 'You are not authorized to view receipts for this expense'
        });
      }

      // Get receipts from new table
      const receipts = await db('petty_cash_expense_receipts')
        .select(
          'petty_cash_expense_receipts.*',
          db.raw("CONCAT(users.firstName, ' ', users.lastName) as uploadedByName")
        )
        .leftJoin('users', 'petty_cash_expense_receipts.uploaded_by', 'users.id')
        .where('expense_id', id)
        .orderBy('uploaded_at', 'asc');

      // Generate download URLs for each receipt
      const receiptsWithUrls = await Promise.all(
        receipts.map(async (receipt) => {
          let downloadUrl = null;
          try {
            downloadUrl = await storageService.getDownloadUrl(receipt.storage_key);
          } catch (err) {
            winston.warn('Failed to generate download URL', {
              receiptId: receipt.id,
              storageKey: receipt.storage_key,
              error: err.message
            });
          }
          return {
            id: receipt.id,
            storageKey: receipt.storage_key,
            originalFilename: receipt.original_filename,
            contentType: receipt.content_type,
            fileSize: receipt.file_size,
            uploadedBy: receipt.uploaded_by,
            uploadedByName: receipt.uploadedByName,
            uploadedAt: receipt.uploaded_at,
            downloadUrl
          };
        })
      );

      res.json({
        success: true,
        data: {
          receipts: receiptsWithUrls,
          maxAllowed: MAX_RECEIPTS_PER_EXPENSE,
          canUploadMore: receiptsWithUrls.length < MAX_RECEIPTS_PER_EXPENSE
        }
      });

    } catch (error) {
      winston.error('Error fetching receipts', {
        error: error.message,
        expenseId: req.params.id,
        companyId: req.user.companyId
      });

      res.status(500).json({
        success: false,
        error: 'Failed to fetch receipts'
      });
    }
  }
);

// POST /petty-cash-expenses/:id/receipt - Upload receipt for expense (max 2)
router.post('/:id/receipt',
  requirePermission('CREATE_EXPENSE'),
  uploadReceipt,
  async (req, res) => {
    try {
      const db = getDbConnection(req.user.companyId);
      const { id } = req.params;

      // Check if expense exists
      const expense = await db('petty_cash_expenses')
        .select('petty_cash_expenses.*', 'petty_cash_cards.assignedTo')
        .leftJoin('petty_cash_cards', 'petty_cash_expenses.cardId', 'petty_cash_cards.id')
        .where('petty_cash_expenses.id', id)
        .first();

      if (!expense) {
        return res.status(404).json({
          success: false,
          error: 'Expense not found'
        });
      }

      // Check permission: owner, card holder, or admin
      const isOwner = expense.submittedBy === req.user.userId;
      const isCardHolder = expense.assignedTo === req.user.userId;
      const canManage = req.user.permissions.includes('MANAGE_PETTY_CASH') ||
                        req.user.permissions.includes('MANAGE_EXPENSES');

      if (!isOwner && !isCardHolder && !canManage) {
        return res.status(403).json({
          success: false,
          error: 'You are not authorized to upload receipts for this expense'
        });
      }

      // Validate file was uploaded
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: 'No file uploaded'
        });
      }

      // Check max receipts limit
      const existingReceiptsCount = await db('petty_cash_expense_receipts')
        .where('expense_id', id)
        .count('id as count')
        .first();

      // Also count legacy receipt if exists
      const hasLegacyReceipt = expense.receipt_key ? 1 : 0;
      const totalReceipts = (existingReceiptsCount?.count || 0) + hasLegacyReceipt;

      if (totalReceipts >= MAX_RECEIPTS_PER_EXPENSE) {
        return res.status(400).json({
          success: false,
          error: `Maximum ${MAX_RECEIPTS_PER_EXPENSE} receipts allowed per expense. Delete an existing receipt first.`
        });
      }

      // Validate file signature (magic bytes)
      const isValidSignature = await validateFileSignature(req.file.buffer, req.file.mimetype);
      if (!isValidSignature) {
        return res.status(400).json({
          success: false,
          error: 'Invalid file format. The file content does not match its type.'
        });
      }

      // Upload to S3 using expenseNumber for folder structure
      // Path: {companyId}/{year}/petty-cash/{expenseNumber}/receipt-{timestamp}.{ext}
      // Year is based on expense date (allows backdating old expenses)
      const result = await storageService.uploadReceipt(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype,
        req.user.companyId,
        expense.expenseNumber, // Use expenseNumber for folder path
        req.user.userId,
        expense.expenseDate    // Expense date for year-based folder organization
      );

      // Insert into new receipts table
      const [receiptId] = await db('petty_cash_expense_receipts').insert({
        expense_id: id,
        storage_key: result.key,
        original_filename: req.file.originalname,
        content_type: req.file.mimetype,
        file_size: req.file.size,
        uploaded_by: req.user.userId,
        uploaded_at: new Date(),
        created_at: new Date(),
        updated_at: new Date()
      });

      // Log transaction for audit
      if (expense.cardId) {
        await db('petty_cash_transactions').insert({
          card_id: expense.cardId,
          transaction_number: `TXN-RCP-${Date.now()}`,
          transaction_type: 'adjustment',
          amount: 0,
          expense_id: id,
          description: `Receipt uploaded for expense ${expense.expenseNumber}`,
          notes: `File: ${req.file.originalname}, Size: ${req.file.size} bytes`,
          performed_by: req.user.userId,
          transaction_date: new Date()
        });
      }

      winston.info('Receipt uploaded successfully', {
        expenseId: id,
        receiptId,
        receiptKey: result.key,
        size: result.size,
        companyId: req.user.companyId,
        userId: req.user.userId
      });

      // Generate download URL for immediate use
      const downloadUrl = await storageService.getDownloadUrl(result.key);

      res.json({
        success: true,
        data: {
          id: receiptId,
          storageKey: result.key,
          originalFilename: req.file.originalname,
          size: result.size,
          contentType: result.contentType,
          downloadUrl
        },
        message: 'Receipt uploaded successfully'
      });

    } catch (error) {
      winston.error('Error uploading receipt', {
        error: error.message,
        expenseId: req.params.id,
        companyId: req.user.companyId,
        userId: req.user.userId
      });

      if (error.message.includes('Invalid file')) {
        return res.status(400).json({
          success: false,
          error: error.message
        });
      }

      res.status(500).json({
        success: false,
        error: 'Failed to upload receipt'
      });
    }
  }
);

// DELETE /petty-cash-expenses/:id/receipts/:receiptId - Delete a receipt
router.delete('/:id/receipts/:receiptId',
  requirePermission('CREATE_EXPENSE'),
  async (req, res) => {
    try {
      const db = getDbConnection(req.user.companyId);
      const { id, receiptId } = req.params;

      // Check if expense exists
      const expense = await db('petty_cash_expenses')
        .select('petty_cash_expenses.*', 'petty_cash_cards.assignedTo')
        .leftJoin('petty_cash_cards', 'petty_cash_expenses.cardId', 'petty_cash_cards.id')
        .where('petty_cash_expenses.id', id)
        .first();

      if (!expense) {
        return res.status(404).json({
          success: false,
          error: 'Expense not found'
        });
      }

      // Check permission: owner, card holder, or admin
      const isOwner = expense.submittedBy === req.user.userId;
      const isCardHolder = expense.assignedTo === req.user.userId;
      const canManage = req.user.permissions.includes('MANAGE_PETTY_CASH') ||
                        req.user.permissions.includes('MANAGE_EXPENSES');

      if (!isOwner && !isCardHolder && !canManage) {
        return res.status(403).json({
          success: false,
          error: 'You are not authorized to delete receipts for this expense'
        });
      }

      // Find the receipt
      const receipt = await db('petty_cash_expense_receipts')
        .where('id', receiptId)
        .where('expense_id', id)
        .first();

      if (!receipt) {
        return res.status(404).json({
          success: false,
          error: 'Receipt not found'
        });
      }

      // Delete from S3
      try {
        await storageService.deleteFile(receipt.storage_key);
      } catch (deleteError) {
        winston.warn('Failed to delete receipt from S3', {
          error: deleteError.message,
          key: receipt.storage_key
        });
      }

      // Delete from database
      await db('petty_cash_expense_receipts').where('id', receiptId).delete();

      winston.info('Receipt deleted', {
        expenseId: id,
        receiptId,
        companyId: req.user.companyId,
        userId: req.user.userId
      });

      res.json({
        success: true,
        message: 'Receipt deleted successfully'
      });

    } catch (error) {
      winston.error('Error deleting receipt', {
        error: error.message,
        expenseId: req.params.id,
        receiptId: req.params.receiptId,
        companyId: req.user.companyId
      });

      res.status(500).json({
        success: false,
        error: 'Failed to delete receipt'
      });
    }
  }
);

// GET /petty-cash-expenses/:id/receipt - Get receipt download URL
router.get('/:id/receipt', requirePermission('VIEW_EXPENSE_REPORTS'), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const { id } = req.params;

    // Get expense with receipt info
    const expense = await db('petty_cash_expenses')
      .select('id', 'expenseNumber', 'receipt_key', 'receipt_uploaded_at', 'receipt_uploaded_by', 'submittedBy')
      .where('id', id)
      .first();

    if (!expense) {
      return res.status(404).json({
        success: false,
        error: 'Expense not found'
      });
    }

    // Check if user can view this expense
    const canView = req.user.permissions.includes('VIEW_EXPENSE_REPORTS') ||
                    expense.submittedBy === req.user.userId;
    if (!canView) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }

    if (!expense.receipt_key) {
      return res.status(404).json({
        success: false,
        error: 'No receipt attached to this expense'
      });
    }

    // Check if file exists in S3
    const exists = await storageService.fileExists(expense.receipt_key);
    if (!exists) {
      // File missing - clean up database record
      await db('petty_cash_expenses').where('id', id).update({
        receipt_key: null,
        receipt_uploaded_at: null,
        receipt_uploaded_by: null
      });

      return res.status(404).json({
        success: false,
        error: 'Receipt file not found. It may have been deleted.'
      });
    }

    // Generate presigned download URL
    const downloadUrl = await storageService.getDownloadUrl(expense.receipt_key);

    // Get file info for additional metadata
    const fileInfo = await storageService.getFileInfo(expense.receipt_key);

    res.json({
      success: true,
      data: {
        downloadUrl,
        expiresIn: 3600, // 1 hour
        key: expense.receipt_key,
        uploadedAt: expense.receipt_uploaded_at,
        size: fileInfo?.size,
        contentType: fileInfo?.contentType
      }
    });

  } catch (error) {
    winston.error('Error getting receipt URL', {
      error: error.message,
      expenseId: req.params.id,
      companyId: req.user.companyId,
      userId: req.user.userId
    });

    res.status(500).json({
      success: false,
      error: 'Failed to get receipt URL'
    });
  }
});

// DELETE /petty-cash-expenses/:id/receipt - Delete receipt
router.delete('/:id/receipt', requirePermission('MANAGE_PETTY_CASH'), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const { id } = req.params;

    // Get expense with receipt info
    const expense = await db('petty_cash_expenses')
      .select('id', 'expenseNumber', 'cardId', 'receipt_key')
      .where('id', id)
      .first();

    if (!expense) {
      return res.status(404).json({
        success: false,
        error: 'Expense not found'
      });
    }

    if (!expense.receipt_key) {
      return res.status(400).json({
        success: false,
        error: 'No receipt attached to this expense'
      });
    }

    // Delete from S3
    try {
      await storageService.deleteFile(expense.receipt_key);
    } catch (deleteError) {
      winston.warn('Failed to delete receipt from S3', {
        expenseId: id,
        key: expense.receipt_key,
        error: deleteError.message
      });
      // Continue anyway to clean up database record
    }

    // Update expense record
    await db('petty_cash_expenses').where('id', id).update({
      receipt_key: null,
      receipt_uploaded_at: null,
      receipt_uploaded_by: null,
      updated_at: new Date()
    });

    // Log transaction for audit
    await db('petty_cash_transactions').insert({
      card_id: expense.cardId,
      transaction_number: `TXN-RCD-${Date.now()}`,
      transaction_type: 'adjustment',
      amount: 0,
      expense_id: id,
      description: `Receipt deleted for expense ${expense.expenseNumber}`,
      performed_by: req.user.userId,
      transaction_date: new Date()
    });

    winston.info('Receipt deleted successfully', {
      expenseId: id,
      receiptKey: expense.receipt_key,
      companyId: req.user.companyId,
      userId: req.user.userId
    });

    res.json({
      success: true,
      message: 'Receipt deleted successfully'
    });

  } catch (error) {
    winston.error('Error deleting receipt', {
      error: error.message,
      expenseId: req.params.id,
      companyId: req.user.companyId,
      userId: req.user.userId
    });

    res.status(500).json({
      success: false,
      error: 'Failed to delete receipt'
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
      query = query.where('submittedBy', req.user.userId);
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
      userId: req.user.userId
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
      userId: req.user.userId
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
      query = query.where('petty_cash_expenses.submittedBy', req.user.userId);
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
      userId: req.user.userId
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
      userId: req.user.userId
    });

    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

module.exports = router;