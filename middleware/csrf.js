/**
 * CSRF (Cross-Site Request Forgery) Protection Middleware
 *
 * Protects state-changing requests by validating that the X-CSRF-Token header
 * matches the csrf-token cookie. This prevents malicious sites from making
 * requests on behalf of authenticated users.
 *
 * How it works:
 * 1. On login, server sets csrf-token cookie (NOT HttpOnly - JS must read it)
 * 2. Frontend reads cookie and includes value in X-CSRF-Token header
 * 3. This middleware compares header to cookie on POST/PUT/PATCH/DELETE
 * 4. Requests without matching tokens are rejected with 403
 *
 * Why this works:
 * - Attackers can trigger cookies to be sent (via hidden forms)
 * - But attackers CANNOT read cookies from another origin (SOP)
 * - And attackers CANNOT set custom headers from another origin (CORS)
 * - So only legitimate requests from our frontend will have matching values
 */

const crypto = require('crypto');
const { logger, auditLog } = require('../utils/logger');

// CSRF token configuration
const CSRF_TOKEN_LENGTH = 32; // 32 bytes = 64 hex characters
const CSRF_COOKIE_NAME = 'csrf-token';
const CSRF_HEADER_NAME = 'x-csrf-token';
const CSRF_TOKEN_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours

// Methods that are safe (don't change state) - exempt from CSRF validation
const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

/**
 * Generate a cryptographically secure CSRF token
 * @returns {string} 64-character hex string
 */
const generateCsrfToken = () => {
  return crypto.randomBytes(CSRF_TOKEN_LENGTH).toString('hex');
};

/**
 * Set CSRF token cookie (used on login/session creation)
 * This is called from auth routes after successful authentication
 *
 * @param {Response} res - Express response object
 * @param {string} token - CSRF token to set (or generates new if not provided)
 * @returns {string} The CSRF token that was set
 */
const setCsrfCookie = (res, token = null) => {
  const csrfToken = token || generateCsrfToken();

  res.cookie(CSRF_COOKIE_NAME, csrfToken, {
    httpOnly: false,  // MUST be false - JavaScript needs to read this
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: CSRF_TOKEN_MAX_AGE,
    path: '/'
  });

  return csrfToken;
};

/**
 * Clear CSRF token cookie (used on logout)
 * @param {Response} res - Express response object
 */
const clearCsrfCookie = (res) => {
  res.clearCookie(CSRF_COOKIE_NAME, { path: '/' });
};

/**
 * Middleware to validate CSRF token on state-changing requests
 *
 * Compares the X-CSRF-Token header with the csrf-token cookie.
 * GET, HEAD, OPTIONS requests are exempt (they don't change state).
 *
 * Usage in server.js:
 *   app.use('/api', authenticateToken);
 *   app.use('/api', validateCsrfToken);  // After auth, before routes
 *
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const validateCsrfToken = (req, res, next) => {
  // Skip validation for safe methods (they don't modify state)
  if (SAFE_METHODS.includes(req.method)) {
    return next();
  }

  // Get CSRF token from cookie
  const cookieToken = req.cookies?.[CSRF_COOKIE_NAME];

  // Get CSRF token from header (case-insensitive header names)
  const headerToken = req.get(CSRF_HEADER_NAME);

  // Validate both tokens exist
  if (!cookieToken) {
    logCsrfFailure(req, 'MISSING_COOKIE');
    return res.status(403).json({
      success: false,
      error: 'CSRF validation failed',
      code: 'CSRF_MISSING_COOKIE',
      message: 'Session invalid. Please refresh the page and try again.'
    });
  }

  if (!headerToken) {
    logCsrfFailure(req, 'MISSING_HEADER');
    return res.status(403).json({
      success: false,
      error: 'CSRF validation failed',
      code: 'CSRF_MISSING_HEADER',
      message: 'Invalid request. Please refresh the page and try again.'
    });
  }

  // Constant-time comparison to prevent timing attacks
  if (!timingSafeEqual(cookieToken, headerToken)) {
    logCsrfFailure(req, 'TOKEN_MISMATCH');
    return res.status(403).json({
      success: false,
      error: 'CSRF validation failed',
      code: 'CSRF_INVALID',
      message: 'Security validation failed. Please refresh the page and try again.'
    });
  }

  // CSRF validation passed
  next();
};

/**
 * Timing-safe string comparison to prevent timing attacks
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {boolean} True if strings are equal
 */
const timingSafeEqual = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }

  // Ensure both strings are same length for timing-safe comparison
  if (a.length !== b.length) {
    return false;
  }

  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch (error) {
    return false;
  }
};

/**
 * Log CSRF validation failure for security monitoring
 * @param {Request} req - Express request object
 * @param {string} reason - Reason for failure
 */
const logCsrfFailure = (req, reason) => {
  const logData = {
    reason,
    method: req.method,
    path: req.path,
    ip: req.ip || req.connection?.remoteAddress,
    userAgent: req.get('user-agent'),
    referer: req.get('referer'),
    origin: req.get('origin'),
    timestamp: new Date().toISOString()
  };

  // Include user ID if available (request might be authenticated)
  if (req.user?.userId) {
    logData.userId = req.user.userId;
  }

  logger.warn('CSRF validation failed', logData);

  // Also log to audit trail for security analysis
  auditLog('CSRF_VALIDATION_FAILED', req.user?.userId || 'unknown', logData);
};

/**
 * Middleware to ensure CSRF cookie exists (sets one if missing)
 * Use this on routes that need a CSRF token before authentication
 *
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const ensureCsrfToken = (req, res, next) => {
  if (!req.cookies?.[CSRF_COOKIE_NAME]) {
    setCsrfCookie(res);
  }
  next();
};

module.exports = {
  generateCsrfToken,
  setCsrfCookie,
  clearCsrfCookie,
  validateCsrfToken,
  ensureCsrfToken,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME
};
