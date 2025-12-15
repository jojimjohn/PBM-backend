/**
 * Petty Cash Portal Authentication Middleware
 *
 * Handles authentication for petty cash users (non-system users) via:
 * 1. QR token validation
 * 2. PIN verification
 * 3. JWT session management
 *
 * Security Features:
 * - Rate limiting via failed_attempts tracking
 * - Account lockout after 5 failed attempts (30 min)
 * - Short session expiry (4 hours)
 * - Company isolation
 */

const jwt = require('jsonwebtoken');
const { getDbConnection, getDbConnectionByCompanyId } = require('../config/database');
const winston = require('winston');

// JWT configuration for petty cash portal (shorter expiry for security)
const PC_JWT_SECRET = process.env.PC_JWT_SECRET || process.env.JWT_SECRET || 'petty-cash-portal-secret';
const PC_JWT_EXPIRES_IN = '4h';

// Security constants
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Generate JWT for petty cash user session
 */
const generatePcToken = (pcUser, companyId) => {
  return jwt.sign(
    {
      pcUserId: pcUser.id,
      cardId: pcUser.card_id,
      companyId: companyId,
      name: pcUser.name,
      type: 'petty_cash_user',
    },
    PC_JWT_SECRET,
    { expiresIn: PC_JWT_EXPIRES_IN }
  );
};

/**
 * Middleware to validate petty cash portal JWT
 * Attaches req.pcUser with user details and card info
 */
const requirePcAuth = async (req, res, next) => {
  try {
    // Get token from Authorization header or cookie
    let token = null;

    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else if (req.cookies && req.cookies.pcAccessToken) {
      token = req.cookies.pcAccessToken;
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        code: 'NO_TOKEN',
      });
    }

    // Verify token
    let decoded;
    try {
      decoded = jwt.verify(token, PC_JWT_SECRET);
    } catch (jwtError) {
      if (jwtError.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          error: 'Session expired',
          code: 'TOKEN_EXPIRED',
        });
      }
      return res.status(401).json({
        success: false,
        error: 'Invalid token',
        code: 'INVALID_TOKEN',
      });
    }

    // Validate token type
    if (decoded.type !== 'petty_cash_user') {
      return res.status(401).json({
        success: false,
        error: 'Invalid token type',
        code: 'INVALID_TOKEN_TYPE',
      });
    }

    // Get database connection for the company
    const db = getDbConnectionByCompanyId(decoded.companyId);

    // Verify user still exists and is active
    const pcUser = await db('petty_cash_users')
      .select(
        'petty_cash_users.*',
        'petty_cash_cards.cardNumber',
        'petty_cash_cards.currentBalance',
        'petty_cash_cards.status as cardStatus',
        'petty_cash_cards.monthlyLimit'
      )
      .leftJoin('petty_cash_cards', 'petty_cash_users.card_id', 'petty_cash_cards.id')
      .where('petty_cash_users.id', decoded.pcUserId)
      .first();

    if (!pcUser) {
      return res.status(401).json({
        success: false,
        error: 'User not found',
        code: 'USER_NOT_FOUND',
      });
    }

    if (!pcUser.is_active) {
      return res.status(401).json({
        success: false,
        error: 'Account is deactivated',
        code: 'ACCOUNT_DEACTIVATED',
      });
    }

    // Check if card is active
    if (pcUser.cardStatus !== 'active') {
      return res.status(401).json({
        success: false,
        error: 'Petty cash card is not active',
        code: 'CARD_INACTIVE',
      });
    }

    // Attach user info to request
    req.pcUser = {
      id: pcUser.id,
      cardId: pcUser.card_id,
      companyId: decoded.companyId,
      name: pcUser.name,
      phone: pcUser.phone,
      department: pcUser.department,
      employeeId: pcUser.employee_id,
      cardNumber: pcUser.cardNumber,
      currentBalance: parseFloat(pcUser.currentBalance) || 0,
      monthlyLimit: pcUser.monthlyLimit ? parseFloat(pcUser.monthlyLimit) : null,
    };

    next();
  } catch (error) {
    winston.error('Petty cash portal auth error', {
      error: error.message,
    });

    res.status(500).json({
      success: false,
      error: 'Authentication error',
    });
  }
};

/**
 * Validate QR token (used during login flow)
 * Returns user info if token is valid
 */
const validateQrToken = async (qrToken, companyId) => {
  try {
    const db = getDbConnectionByCompanyId(companyId);

    const pcUser = await db('petty_cash_users')
      .select(
        'petty_cash_users.*',
        'petty_cash_cards.cardNumber',
        'petty_cash_cards.currentBalance',
        'petty_cash_cards.status as cardStatus'
      )
      .leftJoin('petty_cash_cards', 'petty_cash_users.card_id', 'petty_cash_cards.id')
      .where('petty_cash_users.qr_token', qrToken)
      .first();

    if (!pcUser) {
      return { success: false, error: 'Invalid QR code', code: 'INVALID_TOKEN' };
    }

    if (!pcUser.is_active) {
      return { success: false, error: 'Account is deactivated', code: 'ACCOUNT_DEACTIVATED' };
    }

    if (pcUser.cardStatus !== 'active') {
      return { success: false, error: 'Petty cash card is not active', code: 'CARD_INACTIVE' };
    }

    // Check lockout
    if (pcUser.locked_until) {
      const lockUntil = new Date(pcUser.locked_until);
      if (lockUntil > new Date()) {
        const remainingMinutes = Math.ceil((lockUntil - new Date()) / 60000);
        return {
          success: false,
          error: `Account is locked. Try again in ${remainingMinutes} minutes.`,
          code: 'ACCOUNT_LOCKED',
        };
      }
    }

    return {
      success: true,
      user: pcUser,
    };
  } catch (error) {
    winston.error('QR token validation error', { error: error.message });
    return { success: false, error: 'Validation error', code: 'VALIDATION_ERROR' };
  }
};

/**
 * Record failed login attempt
 */
const recordFailedAttempt = async (pcUserId, companyId) => {
  try {
    const db = getDbConnectionByCompanyId(companyId);

    const user = await db('petty_cash_users').where('id', pcUserId).first();
    const newFailedAttempts = (user.failed_attempts || 0) + 1;

    const updateData = {
      failed_attempts: newFailedAttempts,
      updated_at: new Date(),
    };

    // Lock account if max attempts exceeded
    if (newFailedAttempts >= MAX_FAILED_ATTEMPTS) {
      updateData.locked_until = new Date(Date.now() + LOCKOUT_DURATION_MS);

      winston.warn('Petty cash user account locked', {
        pcUserId,
        companyId,
        failedAttempts: newFailedAttempts,
      });
    }

    await db('petty_cash_users').where('id', pcUserId).update(updateData);

    return {
      locked: newFailedAttempts >= MAX_FAILED_ATTEMPTS,
      remainingAttempts: Math.max(0, MAX_FAILED_ATTEMPTS - newFailedAttempts),
    };
  } catch (error) {
    winston.error('Error recording failed attempt', { error: error.message });
    return { locked: false, remainingAttempts: 0 };
  }
};

/**
 * Clear failed attempts on successful login
 */
const clearFailedAttempts = async (pcUserId, companyId) => {
  try {
    const db = getDbConnectionByCompanyId(companyId);

    await db('petty_cash_users').where('id', pcUserId).update({
      failed_attempts: 0,
      locked_until: null,
      last_login_at: new Date(),
      updated_at: new Date(),
    });
  } catch (error) {
    winston.error('Error clearing failed attempts', { error: error.message });
  }
};

module.exports = {
  generatePcToken,
  requirePcAuth,
  validateQrToken,
  recordFailedAttempt,
  clearFailedAttempts,
  PC_JWT_SECRET,
  PC_JWT_EXPIRES_IN,
  MAX_FAILED_ATTEMPTS,
  LOCKOUT_DURATION_MS,
};
