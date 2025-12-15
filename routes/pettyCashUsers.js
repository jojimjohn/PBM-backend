/**
 * Petty Cash Users Routes (Admin)
 *
 * Manage petty cash users - non-system staff who authenticate via QR + PIN
 * to submit expenses. Only accessible by users with MANAGE_PETTY_CASH permission.
 *
 * Routes:
 * GET    /petty-cash-users         - List all petty cash users
 * GET    /petty-cash-users/:id     - Get specific user details
 * POST   /petty-cash-users         - Create new user with QR code
 * PUT    /petty-cash-users/:id     - Update user details
 * DELETE /petty-cash-users/:id     - Deactivate user
 * POST   /petty-cash-users/:id/reset-pin   - Reset user's PIN
 * GET    /petty-cash-users/:id/qr-code     - Get QR code image
 * POST   /petty-cash-users/:id/regenerate-qr - Regenerate QR token
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { getDbConnection } = require('../config/database');
const { requirePermission } = require('../middleware/auth');
const { validate } = require('../middleware/validation');
const Joi = require('joi');
const winston = require('winston');
const {
  generateQrToken,
  generateQRCodeDataUrl,
  getPortalUrl,
} = require('../utils/pettyCashQr');

// Validation schemas
const createUserSchema = Joi.object({
  cardId: Joi.number().integer().positive().required(),
  name: Joi.string().min(2).max(100).required(),
  phone: Joi.string().max(20).allow('', null).optional(),
  department: Joi.string().max(100).allow('', null).optional(),
  employeeId: Joi.string().max(50).allow('', null).optional(),
  pin: Joi.string().pattern(/^\d{4,6}$/).required().messages({
    'string.pattern.base': 'PIN must be 4-6 digits',
  }),
});

const updateUserSchema = Joi.object({
  name: Joi.string().min(2).max(100).optional(),
  phone: Joi.string().max(20).allow('', null).optional(),
  department: Joi.string().max(100).allow('', null).optional(),
  employeeId: Joi.string().max(50).allow('', null).optional(),
  isActive: Joi.boolean().optional(),
});

const resetPinSchema = Joi.object({
  newPin: Joi.string().pattern(/^\d{4,6}$/).required().messages({
    'string.pattern.base': 'PIN must be 4-6 digits',
  }),
});

// Constants
const BCRYPT_ROUNDS = 12;

// GET /petty-cash-users - List all petty cash users
router.get('/', requirePermission('MANAGE_PETTY_CASH'), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);

    const {
      page = 1,
      limit = 50,
      cardId,
      department,
      isActive,
      search,
    } = req.query;

    const offset = (page - 1) * limit;

    let query = db('petty_cash_users')
      .select(
        'petty_cash_users.*',
        'petty_cash_cards.cardNumber',
        'petty_cash_cards.currentBalance',
        'petty_cash_cards.status as cardStatus',
        'creator.firstName as createdByFirstName',
        'creator.lastName as createdByLastName'
      )
      .leftJoin('petty_cash_cards', 'petty_cash_users.card_id', 'petty_cash_cards.id')
      .leftJoin('users as creator', 'petty_cash_users.created_by', 'creator.id')
      .orderBy('petty_cash_users.created_at', 'desc');

    // Apply filters
    if (cardId) {
      query = query.where('petty_cash_users.card_id', cardId);
    }

    if (department) {
      query = query.where('petty_cash_users.department', department);
    }

    if (isActive !== undefined) {
      query = query.where('petty_cash_users.is_active', isActive === 'true');
    }

    if (search) {
      query = query.where(function() {
        this.where('petty_cash_users.name', 'like', `%${search}%`)
          .orWhere('petty_cash_users.phone', 'like', `%${search}%`)
          .orWhere('petty_cash_users.employee_id', 'like', `%${search}%`)
          .orWhere('petty_cash_cards.cardNumber', 'like', `%${search}%`);
      });
    }

    // Get total count
    const totalQuery = query.clone();
    const [{ count }] = await totalQuery.clearSelect().clearOrder().count('* as count');

    // Get paginated results
    const users = await query.limit(limit).offset(offset);

    winston.info('Petty cash users retrieved', {
      companyId: req.user.companyId,
      userId: req.user.userId,
      count: users.length,
    });

    res.json({
      success: true,
      data: users,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count,
        pages: Math.ceil(count / limit),
      },
    });
  } catch (error) {
    winston.error('Error fetching petty cash users', {
      error: error.message,
      companyId: req.user.companyId,
    });

    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// GET /petty-cash-users/:id - Get specific user
router.get('/:id', requirePermission('MANAGE_PETTY_CASH'), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const { id } = req.params;

    const user = await db('petty_cash_users')
      .select(
        'petty_cash_users.*',
        'petty_cash_cards.cardNumber',
        'petty_cash_cards.currentBalance',
        'petty_cash_cards.totalSpent',
        'petty_cash_cards.monthlyLimit',
        'petty_cash_cards.status as cardStatus',
        'creator.firstName as createdByFirstName',
        'creator.lastName as createdByLastName'
      )
      .leftJoin('petty_cash_cards', 'petty_cash_users.card_id', 'petty_cash_cards.id')
      .leftJoin('users as creator', 'petty_cash_users.created_by', 'creator.id')
      .where('petty_cash_users.id', id)
      .first();

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'Petty cash user not found',
      });
    }

    // Get recent expenses for this user's card OR submitted by this user
    // This includes: expenses assigned to this PC user + any expenses on their linked card
    const recentExpenses = await db('petty_cash_expenses')
      .select(
        'id',
        'expenseNumber',
        'amount',
        'category',
        'description',
        'status',
        'expenseDate',
        'created_at',
        'submitted_by_pc_user',
        'submittedBy'
      )
      .where(function() {
        this.where('submitted_by_pc_user', id)
          .orWhere('cardId', user.card_id);
      })
      .orderBy('created_at', 'desc')
      .limit(10);

    user.recentExpenses = recentExpenses;

    // Get expense summary for ALL expenses on this card
    // This gives a complete picture of the card's usage
    const [expenseSummary] = await db('petty_cash_expenses')
      .where('cardId', user.card_id)
      .select(
        db.raw('COUNT(*) as totalExpenses'),
        db.raw('SUM(CASE WHEN status = "approved" THEN amount ELSE 0 END) as totalApproved'),
        db.raw('SUM(CASE WHEN status = "pending" THEN amount ELSE 0 END) as totalPending'),
        db.raw('SUM(CASE WHEN status = "rejected" THEN 1 ELSE 0 END) as rejectedCount')
      );

    user.expenseSummary = expenseSummary;

    // Also get expenses specifically submitted by this PC user for tracking
    const [userSubmittedSummary] = await db('petty_cash_expenses')
      .where('submitted_by_pc_user', id)
      .select(
        db.raw('COUNT(*) as userSubmittedCount'),
        db.raw('SUM(CASE WHEN status = "approved" THEN amount ELSE 0 END) as userSubmittedApproved')
      );

    user.userSubmittedSummary = userSubmittedSummary;

    // Generate portal URL for display
    user.portalUrl = getPortalUrl(user.qr_token, req.user.companyId);

    winston.info('Petty cash user retrieved', {
      pcUserId: id,
      companyId: req.user.companyId,
    });

    res.json({
      success: true,
      data: user,
    });
  } catch (error) {
    winston.error('Error fetching petty cash user', {
      error: error.message,
      pcUserId: req.params.id,
    });

    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// POST /petty-cash-users - Create new petty cash user
router.post(
  '/',
  requirePermission('MANAGE_PETTY_CASH'),
  validate(createUserSchema),
  async (req, res) => {
    try {
      const db = getDbConnection(req.user.companyId);
      const { cardId, name, phone, department, employeeId, pin } = req.body;

      // Verify card exists and doesn't already have a petty cash user
      const card = await db('petty_cash_cards').where('id', cardId).first();

      if (!card) {
        return res.status(400).json({
          success: false,
          error: 'Petty cash card not found',
        });
      }

      // Check if card already has a petty cash user
      const existingUser = await db('petty_cash_users').where('card_id', cardId).first();

      if (existingUser) {
        return res.status(400).json({
          success: false,
          error: 'This card already has a petty cash user assigned',
        });
      }

      // Hash PIN
      const pinHash = await bcrypt.hash(pin, BCRYPT_ROUNDS);

      // Generate QR token
      const qrToken = generateQrToken();

      // Create user
      const newUser = {
        card_id: cardId,
        name,
        phone: phone || null,
        department: department || null,
        employee_id: employeeId || null,
        pin_hash: pinHash,
        qr_token: qrToken,
        is_active: true,
        failed_attempts: 0,
        created_by: req.user.userId,
      };

      const [id] = await db('petty_cash_users').insert(newUser);

      // Generate QR code
      const qrCodeDataUrl = await generateQRCodeDataUrl(qrToken, req.user.companyId);

      winston.info('Petty cash user created', {
        pcUserId: id,
        cardId,
        name,
        companyId: req.user.companyId,
        createdBy: req.user.userId,
      });

      res.status(201).json({
        success: true,
        data: {
          id,
          ...newUser,
          pin_hash: undefined, // Don't send back the hash
          cardNumber: card.cardNumber,
          qrCode: qrCodeDataUrl,
          portalUrl: getPortalUrl(qrToken, req.user.companyId),
        },
        message: 'Petty cash user created successfully',
      });
    } catch (error) {
      winston.error('Error creating petty cash user', {
        error: error.message,
        companyId: req.user.companyId,
      });

      if (error.code === 'ER_DUP_ENTRY') {
        res.status(409).json({
          success: false,
          error: 'A user with this card already exists',
        });
      } else {
        res.status(500).json({
          success: false,
          error: 'Internal server error',
        });
      }
    }
  }
);

// PUT /petty-cash-users/:id - Update petty cash user
router.put(
  '/:id',
  requirePermission('MANAGE_PETTY_CASH'),
  validate(updateUserSchema),
  async (req, res) => {
    try {
      const db = getDbConnection(req.user.companyId);
      const { id } = req.params;
      const { name, phone, department, employeeId, isActive } = req.body;

      // Check if user exists
      const existingUser = await db('petty_cash_users').where('id', id).first();

      if (!existingUser) {
        return res.status(404).json({
          success: false,
          error: 'Petty cash user not found',
        });
      }

      // Build update object
      const updateData = {
        updated_at: new Date(),
      };

      if (name !== undefined) updateData.name = name;
      if (phone !== undefined) updateData.phone = phone || null;
      if (department !== undefined) updateData.department = department || null;
      if (employeeId !== undefined) updateData.employee_id = employeeId || null;
      if (isActive !== undefined) {
        updateData.is_active = isActive;
        // If reactivating, clear lockout
        if (isActive) {
          updateData.locked_until = null;
          updateData.failed_attempts = 0;
        }
      }

      await db('petty_cash_users').where('id', id).update(updateData);

      winston.info('Petty cash user updated', {
        pcUserId: id,
        companyId: req.user.companyId,
        updatedBy: req.user.userId,
      });

      res.json({
        success: true,
        message: 'Petty cash user updated successfully',
      });
    } catch (error) {
      winston.error('Error updating petty cash user', {
        error: error.message,
        pcUserId: req.params.id,
      });

      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }
);

// DELETE /petty-cash-users/:id - Deactivate petty cash user
router.delete('/:id', requirePermission('MANAGE_PETTY_CASH'), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const { id } = req.params;

    const existingUser = await db('petty_cash_users').where('id', id).first();

    if (!existingUser) {
      return res.status(404).json({
        success: false,
        error: 'Petty cash user not found',
      });
    }

    // Check if user has any expenses
    const hasExpenses = await db('petty_cash_expenses')
      .where('submitted_by_pc_user', id)
      .first();

    if (hasExpenses) {
      // Soft delete - deactivate
      await db('petty_cash_users').where('id', id).update({
        is_active: false,
        updated_at: new Date(),
      });

      winston.info('Petty cash user deactivated (has expenses)', {
        pcUserId: id,
        companyId: req.user.companyId,
      });

      res.json({
        success: true,
        message: 'Petty cash user deactivated (has associated expenses)',
      });
    } else {
      // Hard delete - no expenses
      await db('petty_cash_users').where('id', id).del();

      winston.info('Petty cash user deleted', {
        pcUserId: id,
        companyId: req.user.companyId,
      });

      res.json({
        success: true,
        message: 'Petty cash user deleted successfully',
      });
    }
  } catch (error) {
    winston.error('Error deleting petty cash user', {
      error: error.message,
      pcUserId: req.params.id,
    });

    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// POST /petty-cash-users/:id/reset-pin - Reset user's PIN
router.post(
  '/:id/reset-pin',
  requirePermission('MANAGE_PETTY_CASH'),
  validate(resetPinSchema),
  async (req, res) => {
    try {
      const db = getDbConnection(req.user.companyId);
      const { id } = req.params;
      const { newPin } = req.body;

      const existingUser = await db('petty_cash_users').where('id', id).first();

      if (!existingUser) {
        return res.status(404).json({
          success: false,
          error: 'Petty cash user not found',
        });
      }

      // Hash new PIN
      const pinHash = await bcrypt.hash(newPin, BCRYPT_ROUNDS);

      // Update PIN and clear lockout
      await db('petty_cash_users').where('id', id).update({
        pin_hash: pinHash,
        failed_attempts: 0,
        locked_until: null,
        updated_at: new Date(),
      });

      winston.info('Petty cash user PIN reset', {
        pcUserId: id,
        companyId: req.user.companyId,
        resetBy: req.user.userId,
      });

      res.json({
        success: true,
        message: 'PIN reset successfully',
      });
    } catch (error) {
      winston.error('Error resetting PIN', {
        error: error.message,
        pcUserId: req.params.id,
      });

      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }
);

// GET /petty-cash-users/:id/qr-code - Get QR code image
router.get('/:id/qr-code', requirePermission('MANAGE_PETTY_CASH'), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const { id } = req.params;

    const user = await db('petty_cash_users')
      .select('qr_token', 'name')
      .where('id', id)
      .first();

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'Petty cash user not found',
      });
    }

    // Generate QR code
    const qrCodeDataUrl = await generateQRCodeDataUrl(user.qr_token, req.user.companyId, {
      width: 400,
    });

    winston.info('QR code generated', {
      pcUserId: id,
      companyId: req.user.companyId,
    });

    res.json({
      success: true,
      data: {
        qrCode: qrCodeDataUrl,
        portalUrl: getPortalUrl(user.qr_token, req.user.companyId),
        userName: user.name,
      },
    });
  } catch (error) {
    winston.error('Error generating QR code', {
      error: error.message,
      pcUserId: req.params.id,
    });

    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// POST /petty-cash-users/:id/regenerate-qr - Regenerate QR token (if compromised)
router.post('/:id/regenerate-qr', requirePermission('MANAGE_PETTY_CASH'), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const { id } = req.params;

    const existingUser = await db('petty_cash_users').where('id', id).first();

    if (!existingUser) {
      return res.status(404).json({
        success: false,
        error: 'Petty cash user not found',
      });
    }

    // Generate new QR token
    const newQrToken = generateQrToken();

    await db('petty_cash_users').where('id', id).update({
      qr_token: newQrToken,
      updated_at: new Date(),
    });

    // Generate new QR code
    const qrCodeDataUrl = await generateQRCodeDataUrl(newQrToken, req.user.companyId);

    winston.info('QR token regenerated', {
      pcUserId: id,
      companyId: req.user.companyId,
      regeneratedBy: req.user.userId,
    });

    res.json({
      success: true,
      data: {
        qrCode: qrCodeDataUrl,
        portalUrl: getPortalUrl(newQrToken, req.user.companyId),
      },
      message: 'QR code regenerated successfully. Previous QR code is now invalid.',
    });
  } catch (error) {
    winston.error('Error regenerating QR token', {
      error: error.message,
      pcUserId: req.params.id,
    });

    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

module.exports = router;
