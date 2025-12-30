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
const path = require('path');
const fs = require('fs');
const { getDbConnection } = require('../config/database');
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

// Configure multer for receipt uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads/receipts');
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `receipt-${uniqueSuffix}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp|pdf/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error('Only image files (JPEG, PNG, GIF, WebP) and PDF are allowed'));
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

const expenseSchema = Joi.object({
  category: Joi.string().min(2).max(100).required(),
  description: Joi.string().min(2).max(2000).required(),
  amount: Joi.number().positive().max(100000).required(),
  expenseDate: Joi.date().iso().required(),
  vendor: Joi.string().max(200).allow(null, '').optional(),
  receiptNumber: Joi.string().max(100).allow(null, '').optional(),
  notes: Joi.string().max(1000).allow(null, '').optional(),
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

// GET /pc-portal/categories - Get expense categories
router.get('/categories', (req, res) => {
  res.json({
    success: true,
    data: expenseCategories,
  });
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

    res.json({
      success: true,
      data: expenses,
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
    const { category, description, amount, expenseDate, vendor, receiptNumber, notes } = value;

    // Check if card has sufficient balance
    const card = await db('petty_cash_cards')
      .where('id', req.pcUser.cardId)
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

    const currentBalance = parseFloat(card.currentBalance) || 0;
    if (amount > currentBalance) {
      return res.status(400).json({
        success: false,
        error: `Insufficient balance. Current balance: ${currentBalance.toFixed(3)}`,
        code: 'INSUFFICIENT_BALANCE',
      });
    }

    // Generate expense number
    const expenseNumber = generateExpenseNumber(req.pcUser.companyId);

    // Create expense
    // Use the card's assignedTo user as submittedBy since DB requires NOT NULL
    // The actual submitter is tracked via submitted_by_pc_user
    const newExpense = {
      expenseNumber,
      cardId: req.pcUser.cardId,
      category,
      description,
      amount,
      expenseDate,
      vendor: vendor || null,
      receiptNumber: receiptNumber || null,
      notes: notes || null,
      status: 'pending',
      submitted_by_pc_user: req.pcUser.id,
      submittedBy: card.assignedTo, // Use card owner as system user reference
    };

    const [id] = await db('petty_cash_expenses').insert(newExpense);

    winston.info('PC Portal expense submitted', {
      expenseId: id,
      expenseNumber,
      pcUserId: req.pcUser.id,
      cardId: req.pcUser.cardId,
      amount,
      category,
      company: req.pcUser.companyId,
    });

    res.status(201).json({
      success: true,
      data: {
        id,
        expenseNumber,
        ...value,
        status: 'pending',
      },
      message: 'Expense submitted successfully',
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
      .where({
        id,
        submitted_by_pc_user: req.pcUser.id,
      })
      .first();

    if (!expense) {
      // Delete uploaded file
      fs.unlinkSync(req.file.path);

      return res.status(404).json({
        success: false,
        error: 'Expense not found',
      });
    }

    // Only allow receipt upload for pending expenses
    if (expense.status !== 'pending') {
      fs.unlinkSync(req.file.path);

      return res.status(400).json({
        success: false,
        error: 'Cannot upload receipt for processed expense',
      });
    }

    // Delete old receipt if exists
    if (expense.receiptPhoto) {
      const oldPath = path.join(__dirname, '../uploads/receipts', expense.receiptPhoto);
      if (fs.existsSync(oldPath)) {
        fs.unlinkSync(oldPath);
      }
    }

    // Update expense with receipt path
    await db('petty_cash_expenses').where('id', id).update({
      receiptPhoto: req.file.filename,
      updated_at: new Date(),
    });

    winston.info('Receipt uploaded via PC Portal', {
      expenseId: id,
      pcUserId: req.pcUser.id,
      filename: req.file.filename,
    });

    res.json({
      success: true,
      data: {
        receiptPhoto: req.file.filename,
      },
      message: 'Receipt uploaded successfully',
    });
  } catch (error) {
    // Clean up uploaded file on error
    if (req.file) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (e) {
        // Ignore cleanup errors
      }
    }

    winston.error('Error uploading receipt', { error: error.message });

    res.status(500).json({
      success: false,
      error: 'Failed to upload receipt',
    });
  }
});

// GET /pc-portal/expenses/:id - Get specific expense
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

    res.json({
      success: true,
      data: expense,
    });
  } catch (error) {
    winston.error('Error fetching expense', { error: error.message });

    res.status(500).json({
      success: false,
      error: 'Failed to fetch expense',
    });
  }
});

module.exports = router;
