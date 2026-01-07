/**
 * Petty Cash User Portal Routes (Public)
 *
 * Public routes for petty cash users to authenticate and submit expenses.
 * These routes do NOT require system authentication - they use their own JWT system.
 *
 * Routes:
 * POST /pc-portal/login      - Validate QR token + PIN, return session token
 * GET  /pc-portal/me         - Get current user info + balance
 * GET  /pc-portal/expenses   - Get expense history
 * POST /pc-portal/expenses   - Submit new expense
 * POST /pc-portal/expenses/:id/receipt - Upload receipt photo
 * GET  /pc-portal/categories - Get expense categories
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const multer = require('multer');
const { getDbConnection } = require('../config/database');
const { getRepositoryFactory } = require('../repositories/RepositoryFactory');
const Joi = require('joi');
const winston = require('winston');
const {
  generatePcToken,
  requirePcAuth,
  validateQrToken,
  recordFailedAttempt,
  clearFailedAttempts,
  getDbConnectionByCompanyId,
} = require('../middleware/pettyCashPortalAuth');
const { isValidTokenFormat } = require('../utils/pettyCashQr');
const storageService = require('../services/storageService');

// Configure multer for receipt uploads (memory storage for S3 upload)
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files (JPEG, PNG, GIF, WebP) and PDF are allowed'));
    }
  },
});

// Validation schemas
const loginSchema = Joi.object({
  token: Joi.string().length(64).required().messages({
    'string.length': 'Invalid QR code',
    'any.required': 'QR token is required',
  }),
  pin: Joi.string().pattern(/^\d{4,6}$/).required().messages({
    'string.pattern.base': 'PIN must be 4-6 digits',
    'any.required': 'PIN is required',
  }),
  company: Joi.string().required().messages({
    'any.required': 'Company ID is required',
  }),
});

// Payment methods available in user portal
const PORTAL_PAYMENT_METHODS = ['top_up_card', 'petrol_card'];

const expenseSchema = Joi.object({
  category: Joi.string().min(2).max(100).required(),
  description: Joi.string().min(2).max(2000).required(),
  amount: Joi.number().positive().max(100000).required(),
  expenseDate: Joi.date().iso().required(),
  vendor: Joi.string().max(200).allow(null, '').optional(),
  receiptNumber: Joi.string().max(100).allow(null, '').optional(),
  notes: Joi.string().max(1000).allow(null, '').optional(),
  paymentMethod: Joi.string().valid(...PORTAL_PAYMENT_METHODS).default('top_up_card').optional(),
});

// Predefined expense categories (same as main system)
const expenseCategories = [
  { id: 'fuel', name: 'Fuel & Petrol', nameAr: 'وقود وبنزين', maxAmount: 500, icon: 'Fuel' },
  { id: 'transport', name: 'Transport & Taxi', nameAr: 'نقل وتاكسي', maxAmount: 200, icon: 'Car' },
  { id: 'meals', name: 'Meals & Refreshments', nameAr: 'وجبات ومرطبات', maxAmount: 100, icon: 'Utensils' },
  { id: 'office_supplies', name: 'Office Supplies', nameAr: 'مستلزمات مكتبية', maxAmount: 300, icon: 'Package' },
  { id: 'maintenance', name: 'Maintenance & Repairs', nameAr: 'صيانة وإصلاحات', maxAmount: 1000, icon: 'Wrench' },
  { id: 'communication', name: 'Communication & Phone', nameAr: 'اتصالات وهاتف', maxAmount: 150, icon: 'Phone' },
  { id: 'travel', name: 'Travel Expenses', nameAr: 'مصاريف سفر', maxAmount: 500, icon: 'Plane' },
  { id: 'miscellaneous', name: 'Miscellaneous', nameAr: 'متنوعة', maxAmount: 200, icon: 'Package' },
  { id: 'emergency', name: 'Emergency Expenses', nameAr: 'مصاريف طارئة', maxAmount: 2000, icon: 'AlertCircle' },
];

// Generate expense number
function generateExpenseNumber(companyId) {
  const prefix = companyId === 'al-ramrami' ? 'ALR-PCE' : 'PM-PCE';
  const timestamp = Date.now().toString().slice(-8);
  return `${prefix}-${timestamp}`;
}

// POST /pc-portal/login - Authenticate with QR token + PIN
router.post('/login', async (req, res) => {
  try {
    const { error, value } = loginSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: error.details[0].message,
      });
    }

    const { token, pin, company } = value;

    // Validate token format
    if (!isValidTokenFormat(token)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid QR code format',
        code: 'INVALID_FORMAT',
      });
    }

    // Validate QR token
    const validation = await validateQrToken(token, company);
    if (!validation.success) {
      winston.warn('PC Portal login failed - invalid QR token', {
        company,
        error: validation.error,
      });

      return res.status(401).json({
        success: false,
        error: validation.error,
        code: validation.code,
      });
    }

    const pcUser = validation.user;

    // Verify PIN
    const pinValid = await bcrypt.compare(pin, pcUser.pin_hash);

    if (!pinValid) {
      // Record failed attempt
      const attemptResult = await recordFailedAttempt(pcUser.id, company);

      winston.warn('PC Portal login failed - invalid PIN', {
        pcUserId: pcUser.id,
        company,
        remainingAttempts: attemptResult.remainingAttempts,
      });

      if (attemptResult.locked) {
        return res.status(401).json({
          success: false,
          error: 'Too many failed attempts. Account is locked for 30 minutes.',
          code: 'ACCOUNT_LOCKED',
        });
      }

      return res.status(401).json({
        success: false,
        error: `Invalid PIN. ${attemptResult.remainingAttempts} attempts remaining.`,
        code: 'INVALID_PIN',
        remainingAttempts: attemptResult.remainingAttempts,
      });
    }

    // Clear failed attempts on success
    await clearFailedAttempts(pcUser.id, company);

    // Generate session token
    const sessionToken = generatePcToken(pcUser, company);

    winston.info('PC Portal login successful', {
      pcUserId: pcUser.id,
      company,
      name: pcUser.name,
    });

    // Set cookie
    res.cookie('pcAccessToken', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 4 * 60 * 60 * 1000, // 4 hours
      path: '/',
    });

    res.json({
      success: true,
      data: {
        token: sessionToken,
        user: {
          id: pcUser.id,
          name: pcUser.name,
          department: pcUser.department,
          cardNumber: pcUser.cardNumber,
          currentBalance: parseFloat(pcUser.currentBalance) || 0,
        },
      },
      message: 'Login successful',
    });
  } catch (error) {
    winston.error('PC Portal login error', { error: error.message });

    res.status(500).json({
      success: false,
      error: 'Login failed',
    });
  }
});

// POST /pc-portal/logout - Clear session
router.post('/logout', (req, res) => {
  res.clearCookie('pcAccessToken', { path: '/' });

  res.json({
    success: true,
    message: 'Logged out successfully',
  });
});

// GET /pc-portal/me - Get current user info
router.get('/me', requirePcAuth, async (req, res) => {
  try {
    const db = getDbConnectionByCompanyId(req.pcUser.companyId);

    // Get fresh user data with card balance
    const userData = await db('petty_cash_users')
      .select(
        'petty_cash_users.id',
        'petty_cash_users.name',
        'petty_cash_users.phone',
        'petty_cash_users.department',
        'petty_cash_users.employee_id',
        'petty_cash_cards.cardNumber',
        'petty_cash_cards.currentBalance',
        'petty_cash_cards.monthlyLimit',
        'petty_cash_cards.totalSpent'
      )
      .leftJoin('petty_cash_cards', 'petty_cash_users.card_id', 'petty_cash_cards.id')
      .where('petty_cash_users.id', req.pcUser.id)
      .first();

    // Get expense summary for this month
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const [monthlyStats] = await db('petty_cash_expenses')
      .where('submitted_by_pc_user', req.pcUser.id)
      .where('expenseDate', '>=', startOfMonth.toISOString().split('T')[0])
      .select(
        db.raw('COUNT(*) as expenseCount'),
        db.raw('SUM(CASE WHEN status = "approved" THEN amount ELSE 0 END) as approvedTotal'),
        db.raw('SUM(CASE WHEN status = "pending" THEN amount ELSE 0 END) as pendingTotal')
      );

    res.json({
      success: true,
      data: {
        ...userData,
        currentBalance: parseFloat(userData.currentBalance) || 0,
        monthlyLimit: userData.monthlyLimit ? parseFloat(userData.monthlyLimit) : null,
        totalSpent: parseFloat(userData.totalSpent) || 0,
        thisMonth: {
          expenseCount: parseInt(monthlyStats.expenseCount) || 0,
          approvedTotal: parseFloat(monthlyStats.approvedTotal) || 0,
          pendingTotal: parseFloat(monthlyStats.pendingTotal) || 0,
        },
      },
    });
  } catch (error) {
    winston.error('Error fetching PC user data', { error: error.message });

    res.status(500).json({
      success: false,
      error: 'Failed to fetch user data',
    });
  }
});

// GET /pc-portal/categories - Get expense categories (from database with fallback)
router.get('/categories', async (req, res) => {
  try {
    // Get company from query param or use default
    const companyId = req.query.company || 'al-ramrami';
    const locale = req.query.locale || 'en';

    const repositoryFactory = getRepositoryFactory(companyId);
    const categoryRepository = repositoryFactory.getExpenseCategoriesRepository();

    // Fetch petty_cash type categories from the database
    const dbCategories = await categoryRepository.findForDropdown('petty_cash', locale);

    if (dbCategories && dbCategories.length > 0) {
      // Map database categories to match expected format
      const categories = dbCategories.map(cat => ({
        id: cat.code,
        name: cat.name,
        nameAr: cat.name_ar || cat.name,
        maxAmount: cat.max_amount || null,
        icon: 'Package' // Default icon, can be extended
      }));

      return res.json({
        success: true,
        data: categories,
      });
    }

    // Fallback to predefined categories if no database categories exist
    winston.debug('No database categories found for portal, using fallback', { companyId });

    res.json({
      success: true,
      data: expenseCategories,
    });
  } catch (error) {
    winston.error('Error fetching portal expense categories', {
      error: error.message
    });

    // Fallback to predefined categories on error
    res.json({
      success: true,
      data: expenseCategories,
    });
  }
});

// GET /pc-portal/expenses - Get expense history
router.get('/expenses', requirePcAuth, async (req, res) => {
  try {
    const db = getDbConnectionByCompanyId(req.pcUser.companyId);

    const {
      page = 1,
      limit = 20,
      status,
      category,
      dateFrom,
      dateTo,
    } = req.query;

    const offset = (page - 1) * limit;

    let query = db('petty_cash_expenses')
      .where('submitted_by_pc_user', req.pcUser.id)
      .orderBy('created_at', 'desc');

    // Apply filters
    if (status) {
      query = query.where('status', status);
    }

    if (category) {
      query = query.where('category', category);
    }

    if (dateFrom) {
      query = query.where('expenseDate', '>=', dateFrom);
    }

    if (dateTo) {
      query = query.where('expenseDate', '<=', dateTo);
    }

    // Get total count
    const totalQuery = query.clone();
    const [{ count }] = await totalQuery.clearSelect().clearOrder().count('* as count');

    // Get paginated results
    const expenses = await query
      .select(
        'id',
        'expenseNumber',
        'category',
        'description',
        'amount',
        'expenseDate',
        'vendor',
        'receiptNumber',
        'receiptPhoto',
        'status',
        'approvalNotes',
        'created_at'
      )
      .limit(limit)
      .offset(offset);

    // Get receipt counts for each expense from the receipts table
    const expenseIds = expenses.map(e => e.id);
    let receiptCounts = {};

    if (expenseIds.length > 0) {
      const counts = await db('petty_cash_expense_receipts')
        .whereIn('expense_id', expenseIds)
        .groupBy('expense_id')
        .select('expense_id', db.raw('COUNT(*) as count'));

      receiptCounts = counts.reduce((acc, row) => {
        acc[row.expense_id] = parseInt(row.count);
        return acc;
      }, {});
    }

    // Add receipt count to each expense
    const expensesWithReceipts = expenses.map(expense => ({
      ...expense,
      receiptCount: receiptCounts[expense.id] || 0,
      hasReceipt: (receiptCounts[expense.id] || 0) > 0 || !!expense.receiptPhoto,
    }));

    res.json({
      success: true,
      data: expensesWithReceipts,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count,
        pages: Math.ceil(count / limit),
      },
    });
  } catch (error) {
    winston.error('Error fetching PC user expenses', { error: error.message });

    res.status(500).json({
      success: false,
      error: 'Failed to fetch expenses',
    });
  }
});

// POST /pc-portal/expenses - Submit new expense
router.post('/expenses', requirePcAuth, async (req, res) => {
  try {
    const { error, value } = expenseSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: error.details[0].message,
      });
    }

    const db = getDbConnectionByCompanyId(req.pcUser.companyId);
    const { category, description, amount, expenseDate, vendor, receiptNumber, notes, paymentMethod } = value;

    // Determine which card to use based on payment method
    let cardId = req.pcUser.cardId;
    let shouldDeductBalance = true;
    let isPetrolCard = false;
    let card = null;

    // For fuel category with petrol_card payment method, find company's shared petrol card
    if (category === 'fuel' && paymentMethod === 'petrol_card') {
      // Find company's active petrol card (shared among all users)
      card = await db('petty_cash_cards')
        .where('card_type', 'petrol')
        .where('status', 'active')
        .first();

      if (card) {
        cardId = card.id;
        isPetrolCard = true;
        // Check petrol card balance
        const petrolBalance = parseFloat(card.currentBalance) || 0;
        if (amount > petrolBalance) {
          return res.status(400).json({
            success: false,
            error: `Insufficient petrol card balance (${petrolBalance.toFixed(3)}). Please use your regular card.`,
            code: 'INSUFFICIENT_PETROL_BALANCE',
          });
        }
        shouldDeductBalance = true; // Petrol cards DO deduct balance
      } else {
        return res.status(400).json({
          success: false,
          error: 'No active petrol card found for this company. Please use your regular card.',
          code: 'NO_PETROL_CARD',
        });
      }
    }

    // For non-petrol cards, check user's assigned card
    if (!isPetrolCard) {
      card = await db('petty_cash_cards')
        .where('id', cardId)
        .first();

      if (!card) {
        return res.status(400).json({
          success: false,
          error: 'Petty cash card not found',
        });
      }

      if (card.status !== 'active') {
        return res.status(400).json({
          success: false,
          error: 'Petty cash card is not active',
        });
      }

      // Check balance for user's card
      const currentBalance = parseFloat(card.currentBalance) || 0;
      if (amount > currentBalance) {
        return res.status(400).json({
          success: false,
          error: `Insufficient balance. Current balance: ${currentBalance.toFixed(3)}`,
          code: 'INSUFFICIENT_BALANCE',
        });
      }
    }

    // Generate expense number
    const expenseNumber = generateExpenseNumber(req.pcUser.companyId);

    // Create expense with atomic balance deduction
    // Use the card's assignedTo user as submittedBy since DB requires NOT NULL
    // The actual submitter is tracked via submitted_by_pc_user
    // For petrol cards (shared), we still use cardId to link to the petrol card for balance operations
    // For submittedBy: use card.assignedTo, or fallback to the admin who created this PC user
    const submittedByUserId = card.assignedTo || req.pcUser.createdBy;

    const newExpense = {
      expenseNumber,
      cardId: cardId, // Always set cardId (user's card OR petrol card) for balance tracking
      petrol_card_id: isPetrolCard ? cardId : null, // Track petrol card separately for reporting
      category,
      description,
      amount,
      expenseDate,
      vendor: vendor || null,
      receiptNumber: receiptNumber || null,
      notes: notes || null,
      status: 'pending',
      payment_method: paymentMethod || 'top_up_card',
      submitted_by_pc_user: req.pcUser.id,
      submittedBy: submittedByUserId, // Card owner or admin who created this PC user
    };

    // Get current balance for logging
    const currentBalance = parseFloat(card.currentBalance) || 0;

    // Use transaction for atomic expense creation + balance deduction
    const result = await db.transaction(async (trx) => {
      // 1. Create the expense record
      const [id] = await trx('petty_cash_expenses').insert(newExpense);

      // 2. Deduct balance from card immediately (will be refunded if rejected)
      if (shouldDeductBalance) {
        await trx('petty_cash_cards')
          .where('id', cardId)
          .update({
            currentBalance: trx.raw('currentBalance - ?', [amount])
          });

        // 3. Log the expense submission transaction
        // Using 'expense' type for the initial deduction (balance reserved pending approval)
        await trx('petty_cash_transactions').insert({
          card_id: cardId,
          transaction_number: `TXN-EXP-${Date.now()}`,
          transaction_type: 'expense', // Valid enum value for expense submission
          amount: -amount, // Negative for deduction
          balance_before: currentBalance,
          balance_after: currentBalance - amount,
          expense_id: id,
          description: `Expense submitted (pending approval): ${category} - ${description}`,
          performed_by: submittedByUserId, // Same user as submittedBy
          pc_user_id: req.pcUser.id,
          transaction_date: new Date()
        });
      }

      return {
        id,
        newBalance: shouldDeductBalance ? currentBalance - amount : currentBalance
      };
    });

    winston.info('PC Portal expense submitted with balance deduction', {
      expenseId: result.id,
      expenseNumber,
      pcUserId: req.pcUser.id,
      cardId: cardId,
      isPetrolCard,
      paymentMethod: paymentMethod || 'top_up_card',
      amount,
      previousBalance: currentBalance,
      newBalance: result.newBalance,
      category,
      company: req.pcUser.companyId,
    });

    res.status(201).json({
      success: true,
      data: {
        id: result.id,
        expenseNumber,
        ...value,
        status: 'pending',
        newBalance: result.newBalance.toFixed(3),
      },
      message: 'Expense submitted successfully. Balance has been reserved pending approval.',
    });
  } catch (error) {
    winston.error('Error submitting PC Portal expense', { error: error.message });

    res.status(500).json({
      success: false,
      error: 'Failed to submit expense',
    });
  }
});

// POST /pc-portal/expenses/:id/receipt - Upload receipt photo
// Uses S3 storage with path: {companyId}/petty-cash/{expenseNumber}/receipt-{timestamp}.{ext}
router.post('/expenses/:id/receipt', requirePcAuth, upload.single('receipt'), async (req, res) => {
  try {
    const db = getDbConnectionByCompanyId(req.pcUser.companyId);
    const { id } = req.params;

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No receipt file uploaded',
      });
    }

    // Verify expense belongs to this user
    const expense = await db('petty_cash_expenses')
      .select('id', 'expenseNumber', 'expenseDate', 'status', 'submitted_by_pc_user')
      .where({
        id,
        submitted_by_pc_user: req.pcUser.id,
      })
      .first();

    if (!expense) {
      return res.status(404).json({
        success: false,
        error: 'Expense not found',
      });
    }

    // Only allow receipt upload for pending expenses
    if (expense.status !== 'pending') {
      return res.status(400).json({
        success: false,
        error: 'Cannot upload receipt for processed expense',
      });
    }

    // Check existing receipts count (max 2 per expense)
    const MAX_RECEIPTS = 2;
    const [existingCount] = await db('petty_cash_expense_receipts')
      .where('expense_id', id)
      .count('id as count');

    if ((existingCount?.count || 0) >= MAX_RECEIPTS) {
      return res.status(400).json({
        success: false,
        error: `Maximum ${MAX_RECEIPTS} receipts allowed per expense`,
      });
    }

    // Upload to S3 using expenseNumber for folder structure
    // Path: {companyId}/{year}/petty-cash/{expenseNumber}/receipt-{timestamp}.{ext}
    // Year is based on expense date (allows backdating old expenses)
    const result = await storageService.uploadReceipt(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      req.pcUser.companyId,
      expense.expenseNumber,
      req.pcUser.createdBy, // Admin who created this PC user (for audit trail)
      expense.expenseDate   // Expense date for year-based folder organization
    );

    // Insert into receipts table
    const [receiptId] = await db('petty_cash_expense_receipts').insert({
      expense_id: id,
      storage_key: result.key,
      original_filename: req.file.originalname,
      content_type: req.file.mimetype,
      file_size: req.file.size,
      uploaded_by: req.pcUser.createdBy, // Link to admin user for FK constraint
      uploaded_at: new Date(),
      created_at: new Date(),
      updated_at: new Date()
    });

    winston.info('Receipt uploaded via PC Portal to S3', {
      expenseId: id,
      receiptId,
      receiptKey: result.key,
      pcUserId: req.pcUser.id,
      filename: req.file.originalname,
      fileSize: req.file.size,
      company: req.pcUser.companyId,
    });

    res.json({
      success: true,
      data: {
        receiptId,
        storageKey: result.key,
        originalFilename: req.file.originalname,
      },
      message: 'Receipt uploaded successfully',
    });
  } catch (error) {
    winston.error('Error uploading receipt via PC Portal', {
      error: error.message,
      expenseId: req.params.id,
      pcUserId: req.pcUser?.id,
    });

    res.status(500).json({
      success: false,
      error: 'Failed to upload receipt',
    });
  }
});

// GET /pc-portal/expenses/:id - Get specific expense with receipts
router.get('/expenses/:id', requirePcAuth, async (req, res) => {
  try {
    const db = getDbConnectionByCompanyId(req.pcUser.companyId);
    const { id } = req.params;

    const expense = await db('petty_cash_expenses')
      .where({
        id,
        submitted_by_pc_user: req.pcUser.id,
      })
      .first();

    if (!expense) {
      return res.status(404).json({
        success: false,
        error: 'Expense not found',
      });
    }

    // Get receipts from the receipts table
    const receipts = await db('petty_cash_expense_receipts')
      .where('expense_id', id)
      .select('id', 'original_filename', 'content_type', 'file_size', 'uploaded_at')
      .orderBy('uploaded_at', 'desc');

    res.json({
      success: true,
      data: {
        ...expense,
        receipts,
        receiptCount: receipts.length,
        hasReceipt: receipts.length > 0 || !!expense.receiptPhoto,
      },
    });
  } catch (error) {
    winston.error('Error fetching expense', { error: error.message });

    res.status(500).json({
      success: false,
      error: 'Failed to fetch expense',
    });
  }
});

// GET /pc-portal/expenses/:id/receipts - Get all receipts for an expense
router.get('/expenses/:id/receipts', requirePcAuth, async (req, res) => {
  try {
    const db = getDbConnectionByCompanyId(req.pcUser.companyId);
    const { id } = req.params;

    // Verify expense belongs to this user
    const expense = await db('petty_cash_expenses')
      .where({
        id,
        submitted_by_pc_user: req.pcUser.id,
      })
      .first();

    if (!expense) {
      return res.status(404).json({
        success: false,
        error: 'Expense not found',
      });
    }

    // Get receipts from the receipts table
    const receipts = await db('petty_cash_expense_receipts')
      .where('expense_id', id)
      .select('id', 'storage_key', 'original_filename', 'content_type', 'file_size', 'uploaded_at')
      .orderBy('uploaded_at', 'desc');

    res.json({
      success: true,
      data: receipts,
    });
  } catch (error) {
    winston.error('Error fetching receipts', { error: error.message });

    res.status(500).json({
      success: false,
      error: 'Failed to fetch receipts',
    });
  }
});

// GET /pc-portal/expenses/:id/receipts/:receiptId - Get presigned URL for a specific receipt
router.get('/expenses/:id/receipts/:receiptId', requirePcAuth, async (req, res) => {
  try {
    const db = getDbConnectionByCompanyId(req.pcUser.companyId);
    const { id, receiptId } = req.params;

    // Verify expense belongs to this user
    const expense = await db('petty_cash_expenses')
      .where({
        id,
        submitted_by_pc_user: req.pcUser.id,
      })
      .first();

    if (!expense) {
      return res.status(404).json({
        success: false,
        error: 'Expense not found',
      });
    }

    // Get the specific receipt
    const receipt = await db('petty_cash_expense_receipts')
      .where({
        id: receiptId,
        expense_id: id,
      })
      .first();

    if (!receipt) {
      return res.status(404).json({
        success: false,
        error: 'Receipt not found',
      });
    }

    // Generate presigned URL for viewing
    const downloadUrl = await storageService.getDownloadUrl(receipt.storage_key);

    res.json({
      success: true,
      data: {
        id: receipt.id,
        downloadUrl,
        originalFilename: receipt.original_filename,
        contentType: receipt.content_type,
        fileSize: receipt.file_size,
        uploadedAt: receipt.uploaded_at,
      },
    });
  } catch (error) {
    winston.error('Error fetching receipt URL', {
      error: error.message,
      expenseId: req.params.id,
      receiptId: req.params.receiptId,
    });

    res.status(500).json({
      success: false,
      error: 'Failed to fetch receipt',
    });
  }
});

module.exports = router;
