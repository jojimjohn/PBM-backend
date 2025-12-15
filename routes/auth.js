const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { generateTokenPair, verifyRefreshToken } = require('../utils/jwt');
const { validate, sanitize, schemas } = require('../middleware/validation');
const { authRateLimit, authenticateToken, requirePermission } = require('../middleware/auth');
const { logger, auditLog } = require('../utils/logger');
const { getDbConnection } = require('../config/database');
const {
  initializeSession,
  clearSession,
  getSessionStatus,
  extendSession,
  getSessionTimeoutForCompany,
  SESSION_TIMEOUT_MINUTES
} = require('../middleware/sessionTimeout');
const {
  generateSecret,
  generateQRCode,
  verifyCode,
  generateBackupCodes,
  verifyBackupCode,
  encryptSecret,
  decryptSecret,
  APP_NAME
} = require('../utils/mfa');
const { setCsrfCookie, clearCsrfCookie } = require('../middleware/csrf');

// Cookie configuration for secure token storage
// COOKIE_DOMAIN env var is required for Docker deployments behind reverse proxy
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',  // 'lax' is more compatible with reverse proxies while still preventing CSRF
  path: '/',
  ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {})
};

const ACCESS_TOKEN_MAX_AGE = 15 * 60 * 1000;        // 15 minutes
const REFRESH_TOKEN_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Set authentication cookies (JWT tokens + CSRF token)
 * @param {Response} res - Express response object
 * @param {string} accessToken - JWT access token
 * @param {string} refreshToken - JWT refresh token
 */
const setAuthCookies = (res, accessToken, refreshToken) => {
  // Access token - HttpOnly, used for API authentication
  res.cookie('accessToken', accessToken, {
    ...COOKIE_OPTIONS,
    maxAge: ACCESS_TOKEN_MAX_AGE
  });

  // Refresh token - HttpOnly, restricted path for security
  res.cookie('refreshToken', refreshToken, {
    ...COOKIE_OPTIONS,
    maxAge: REFRESH_TOKEN_MAX_AGE,
    path: '/api/auth/refresh'  // Only sent to refresh endpoint
  });

  // Set CSRF token using shared module
  setCsrfCookie(res);
};

/**
 * Clear all authentication cookies
 * @param {Response} res - Express response object
 */
const clearAuthCookies = (res) => {
  res.clearCookie('accessToken', { path: '/' });
  res.clearCookie('refreshToken', { path: '/api/auth/refresh' });
  clearCsrfCookie(res);
};

const router = express.Router();

// Apply sanitization to all routes
router.use(sanitize);

// Debug endpoint to get server IP information (for database whitelisting)
// SECURITY: Disabled in production to prevent information disclosure
router.get('/server-info', async (req, res) => {
  // Block access in production
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }

  try {
    const os = require('os');
    const dns = require('dns').promises;

    // Get network interfaces
    const interfaces = os.networkInterfaces();
    
    // Get public IP (try multiple services)
    let publicIP = 'Unknown';
    try {
      const response = await fetch('https://api.ipify.org?format=json');
      const data = await response.json();
      publicIP = data.ip;
    } catch (error) {
      try {
        const response = await fetch('https://httpbin.org/ip');
        const data = await response.json();
        publicIP = data.origin;
      } catch (err) {
        console.log('Could not fetch public IP');
      }
    }
    
    res.json({
      success: true,
      serverInfo: {
        hostname: os.hostname(),
        platform: os.platform(),
        publicIP: publicIP,
        networkInterfaces: interfaces,
        environment: process.env.NODE_ENV || 'development',
        headers: req.headers,
        railwayDomain: process.env.RAILWAY_PUBLIC_DOMAIN || 'Not set'
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Could not retrieve server info'
    });
  }
});

// Get current user endpoint - Returns user info from valid session
// Used by frontend to validate existing session on page load
router.get('/me', async (req, res) => {
  try {
    const { verifyToken } = require('../utils/jwt');
    const tokenBlacklist = require('../utils/tokenBlacklist');

    // Extract token from cookies or header
    let token = req.cookies?.accessToken;
    if (!token) {
      const authHeader = req.headers['authorization'];
      token = authHeader && authHeader.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Not authenticated',
        code: 'NO_TOKEN'
      });
    }

    // Verify token
    const decoded = verifyToken(token);

    // Check blacklist
    const blacklistCheck = await tokenBlacklist.isTokenValid(
      token,
      decoded.userId,
      decoded.iat
    );

    if (!blacklistCheck.valid) {
      clearAuthCookies(res);
      return res.status(401).json({
        success: false,
        error: 'Session expired',
        code: blacklistCheck.reason
      });
    }

    // Get fresh user data from database
    const db = getDbConnection(decoded.companyId || 'al-ramrami');
    const user = await db('users')
      .where({ id: decoded.userId })
      .first();

    if (!user || !user.isActive) {
      clearAuthCookies(res);
      return res.status(401).json({
        success: false,
        error: 'User not found or inactive',
        code: 'USER_INVALID'
      });
    }

    // Convert role format
    const roleMapping = {
      'super-admin': 'SUPER_ADMIN',
      'company-admin': 'COMPANY_ADMIN',
      'manager': 'MANAGER',
      'sales-staff': 'SALES_STAFF',
      'purchase-staff': 'PURCHASE_STAFF',
      'accounts-staff': 'ACCOUNTS_STAFF'
    };
    const mappedRole = roleMapping[user.role] || user.role;

    // Get permissions - prefer role_id from DB, fallback to legacy role string
    const permissions = await getUserPermissions(user.role_id || mappedRole, user.companyId, db);

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: mappedRole,
          roleId: user.role_id,
          companyId: user.companyId,
          permissions,
          mfaEnabled: !!user.mfa_enabled
        }
      }
    });

  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      clearAuthCookies(res);
      return res.status(401).json({
        success: false,
        error: 'Token expired',
        code: 'TOKEN_EXPIRED'
      });
    }

    logger.error('Get current user error', { error: error.message });
    res.status(401).json({
      success: false,
      error: 'Invalid session',
      code: 'INVALID_TOKEN'
    });
  }
});

// Login endpoint
router.post('/login', authRateLimit, validate(schemas.login), async (req, res) => {
  try {
    const { email, password, companyId } = req.body;
    const db = getDbConnection(companyId);

    // Find user in database
    const user = await db('users')
      .where({ email, companyId })
      .first();

    if (!user) {
      auditLog('LOGIN_FAILED', null, {
        email,
        companyId,
        reason: 'user_not_found',
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });

      return res.status(401).json({
        success: false,
        error: 'Invalid email or password'
      });
    }

    // Check if user is active
    if (!user.isActive) {
      auditLog('LOGIN_FAILED', user.id, {
        email,
        companyId,
        reason: 'account_disabled',
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });

      return res.status(401).json({
        success: false,
        error: 'Account is disabled'
      });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password);

    if (!isValidPassword) {
      auditLog('LOGIN_FAILED', user.id, {
        email,
        companyId,
        reason: 'invalid_password',
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });

      return res.status(401).json({
        success: false,
        error: 'Invalid email or password'
      });
    }

    // Check if MFA is enabled for this user
    if (user.mfa_enabled && user.mfa_verified_at) {
      // MFA is required - don't complete login yet
      auditLog('LOGIN_MFA_REQUIRED', user.id, {
        email,
        companyId,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });

      // Return partial success indicating MFA is needed
      // Don't issue tokens or set cookies until MFA is verified
      return res.json({
        success: true,
        requiresMfa: true,
        message: 'MFA verification required',
        data: {
          userId: user.id,
          companyId: user.companyId,
          email: user.email,
          firstName: user.firstName
        }
      });
    }

    // No MFA - proceed with normal login flow

    // Convert backend role names to frontend format
    const roleMapping = {
      'super-admin': 'SUPER_ADMIN',
      'company-admin': 'COMPANY_ADMIN',
      'manager': 'MANAGER',
      'sales-staff': 'SALES_STAFF',
      'purchase-staff': 'PURCHASE_STAFF',
      'accounts-staff': 'ACCOUNTS_STAFF'
    };
    const mappedRole = roleMapping[user.role] || user.role;

    // Get user permissions - prefer role_id from DB, fallback to legacy role string
    const permissions = await getUserPermissions(user.role_id || mappedRole, companyId, db);

    // Generate tokens
    const tokens = generateTokenPair(
      user.id,
      user.email,
      mappedRole,
      user.companyId,
      permissions,
      user.role_id
    );

    // Update last login
    await db('users')
      .where({ id: user.id })
      .update({
        lastLoginAt: new Date(),
        lastLoginIp: req.ip
      });

    auditLog('LOGIN_SUCCESS', user.id, {
      email,
      companyId,
      role: user.role,
      mfaEnabled: false,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    // Set HttpOnly cookies for tokens (SECURITY: tokens not in response body)
    setAuthCookies(res, tokens.accessToken, tokens.refreshToken);

    // Initialize session activity tracking (per-company configurable timeout)
    await initializeSession(user.id, user.companyId);

    res.json({
      success: true,
      requiresMfa: false,
      message: 'Login successful',
      data: {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: mappedRole,
          companyId: user.companyId,
          permissions,
          mfaEnabled: !!user.mfa_enabled
        },
        session: {
          timeoutMinutes: SESSION_TIMEOUT_MINUTES
        }
        // NOTE: Tokens no longer in response - stored in HttpOnly cookies
      }
    });

  } catch (error) {
    logger.error('Login error', { error: error.message, stack: error.stack });
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Register endpoint - SECURITY: Requires authentication + MANAGE_USERS permission
// Only Company Admins and Super Admins can create new users
router.post('/register',
  authenticateToken,
  requirePermission('MANAGE_USERS'),
  validate(schemas.register),
  async (req, res) => {
  try {
    const {
      email,
      password,
      firstName,
      lastName,
      role,
      companyId
    } = req.body;

    const db = getDbConnection(companyId);

    // Check if user already exists
    const existingUser = await db('users')
      .where({ email, companyId })
      .first();

    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: 'User already exists with this email'
      });
    }

    // Hash password
    const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Create user
    const [userId] = await db('users').insert({
      email,
      password: hashedPassword,
      firstName,
      lastName,
      role,
      companyId,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    auditLog('USER_REGISTERED', userId, {
      email,
      role,
      companyId,
      registeredBy: req.user?.userId || 'system',
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    logger.info('User registered successfully', {
      userId,
      email,
      role,
      companyId
    });

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: {
        userId,
        email,
        firstName,
        lastName,
        role,
        companyId
      }
    });

  } catch (error) {
    logger.error('Registration error', { error: error.message, stack: error.stack });
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Refresh token endpoint - SECURITY: Uses cookie-based refresh with token rotation
router.post('/refresh', async (req, res) => {
  try {
    const tokenBlacklist = require('../utils/tokenBlacklist');

    // Extract refresh token from cookie first, then body (for migration)
    let refreshToken = req.cookies?.refreshToken;
    let tokenSource = 'cookie';

    if (!refreshToken && req.body?.refreshToken) {
      refreshToken = req.body.refreshToken;
      tokenSource = 'body';
    }

    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        error: 'Refresh token required',
        code: 'NO_REFRESH_TOKEN'
      });
    }

    // Check if token is blacklisted before verification
    const isBlacklisted = await tokenBlacklist.isBlacklisted(refreshToken);
    if (isBlacklisted) {
      clearAuthCookies(res);
      return res.status(401).json({
        success: false,
        error: 'Refresh token has been revoked',
        code: 'TOKEN_REVOKED'
      });
    }

    // Verify refresh token
    const decoded = verifyRefreshToken(refreshToken);
    const db = getDbConnection(decoded.companyId || 'al-ramrami');

    // Check if user was force logged out after this token was issued
    const wasForceLoggedOut = await tokenBlacklist.wasForceLoggedOut(
      decoded.userId,
      decoded.iat
    );
    if (wasForceLoggedOut) {
      clearAuthCookies(res);
      return res.status(401).json({
        success: false,
        error: 'Session has been terminated',
        code: 'FORCE_LOGOUT'
      });
    }

    // Get user details
    const user = await db('users')
      .where({ id: decoded.userId })
      .first();

    if (!user || !user.isActive) {
      clearAuthCookies(res);
      return res.status(401).json({
        success: false,
        error: 'Invalid refresh token',
        code: 'USER_INVALID'
      });
    }

    // Convert backend role names to frontend format (same as login endpoint)
    const roleMapping = {
      'super-admin': 'SUPER_ADMIN',
      'company-admin': 'COMPANY_ADMIN',
      'manager': 'MANAGER',
      'sales-staff': 'SALES_STAFF',
      'purchase-staff': 'PURCHASE_STAFF',
      'accounts-staff': 'ACCOUNTS_STAFF'
    };
    const mappedRole = roleMapping[user.role] || user.role;

    // Get user permissions - prefer role_id from DB, fallback to legacy role string
    const permissions = await getUserPermissions(user.role_id || mappedRole, user.companyId, db);

    // Generate new tokens
    const tokens = generateTokenPair(
      user.id,
      user.email,
      mappedRole,
      user.companyId,
      permissions,
      user.role_id
    );

    // SECURITY: Blacklist the old refresh token (token rotation)
    // This prevents replay attacks with stolen refresh tokens
    const remainingTTL = decoded.exp ? Math.max(decoded.exp - Math.floor(Date.now() / 1000), 0) : 7 * 24 * 60 * 60;
    await tokenBlacklist.blacklistToken(refreshToken, remainingTTL);

    auditLog('TOKEN_REFRESHED', user.id, {
      email: user.email,
      tokenSource,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    // Set new cookies
    setAuthCookies(res, tokens.accessToken, tokens.refreshToken);

    res.json({
      success: true,
      message: 'Tokens refreshed successfully',
      data: {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: mappedRole,
          companyId: user.companyId,
          permissions
        }
        // NOTE: Tokens stored in HttpOnly cookies, not in response body
      }
    });

  } catch (error) {
    logger.error('Token refresh error', { error: error.message });
    clearAuthCookies(res);
    res.status(401).json({
      success: false,
      error: 'Invalid refresh token',
      code: 'INVALID_TOKEN'
    });
  }
});

// Token migration endpoint - Converts header-based auth to cookie-based auth
// This allows existing sessions to seamlessly transition without re-login
router.post('/migrate-to-cookies', async (req, res) => {
  try {
    const { verifyToken } = require('../utils/jwt');

    // This endpoint ONLY accepts tokens from Authorization header
    // (if cookies already exist, migration is unnecessary)
    if (req.cookies?.accessToken) {
      return res.json({
        success: true,
        message: 'Already using cookie-based authentication',
        migrated: false
      });
    }

    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Authorization header required for migration',
        code: 'NO_TOKEN'
      });
    }

    // Verify the token is valid
    const decoded = verifyToken(token);
    const db = getDbConnection(decoded.companyId || 'al-ramrami');

    // Get fresh user data
    const user = await db('users')
      .where({ id: decoded.userId })
      .first();

    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        error: 'User account not found or inactive',
        code: 'USER_INVALID'
      });
    }

    // Convert role format
    const roleMapping = {
      'super-admin': 'SUPER_ADMIN',
      'company-admin': 'COMPANY_ADMIN',
      'manager': 'MANAGER',
      'sales-staff': 'SALES_STAFF',
      'purchase-staff': 'PURCHASE_STAFF',
      'accounts-staff': 'ACCOUNTS_STAFF'
    };
    const mappedRole = roleMapping[user.role] || user.role;

    // Get current permissions - prefer role_id from DB, fallback to legacy role string
    const permissions = await getUserPermissions(user.role_id || mappedRole, user.companyId, db);

    // Generate fresh tokens
    const tokens = generateTokenPair(
      user.id,
      user.email,
      mappedRole,
      user.companyId,
      permissions,
      user.role_id
    );

    // Set cookies
    setAuthCookies(res, tokens.accessToken, tokens.refreshToken);

    auditLog('TOKEN_MIGRATED', user.id, {
      email: user.email,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    logger.info('Token migrated to cookies', {
      userId: user.id,
      email: user.email
    });

    res.json({
      success: true,
      message: 'Successfully migrated to cookie-based authentication',
      migrated: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: mappedRole,
          companyId: user.companyId,
          permissions
        }
      }
    });

  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Token expired - please login again',
        code: 'TOKEN_EXPIRED'
      });
    }

    logger.error('Token migration error', { error: error.message });
    res.status(401).json({
      success: false,
      error: 'Invalid token - please login again',
      code: 'INVALID_TOKEN'
    });
  }
});

// Logout endpoint - SECURITY: Blacklists token and clears cookies
router.post('/logout', async (req, res) => {
  try {
    const tokenBlacklist = require('../utils/tokenBlacklist');
    const { verifyToken } = require('../utils/jwt');

    // Extract token from cookies first, then header (same priority as auth middleware)
    let token = req.cookies?.accessToken;
    let tokenSource = 'cookie';

    if (!token) {
      const authHeader = req.headers['authorization'];
      token = authHeader && authHeader.split(' ')[1];
      tokenSource = 'header';
    }

    if (token) {
      try {
        const decoded = verifyToken(token);

        // Calculate remaining TTL for blacklist entry
        // Token exp is in seconds, we need seconds until expiration
        const now = Math.floor(Date.now() / 1000);
        const remainingTTL = decoded.exp ? Math.max(decoded.exp - now, 0) : 900; // Default 15 min

        // Blacklist the access token
        await tokenBlacklist.blacklistToken(token, remainingTTL);

        // Also blacklist refresh token if present in cookies
        const refreshToken = req.cookies?.refreshToken;
        if (refreshToken) {
          // Refresh tokens have 7-day lifetime
          await tokenBlacklist.blacklistToken(refreshToken, 7 * 24 * 60 * 60);
        }

        // Clear session activity tracking
        await clearSession(decoded.userId);

        auditLog('LOGOUT', decoded.userId, {
          email: decoded.email,
          tokenSource,
          ip: req.ip,
          userAgent: req.get('User-Agent')
        });
      } catch (error) {
        // Token might be expired or invalid, but we still want to clear cookies
        logger.debug('Token verification failed during logout', { error: error.message });
      }
    }

    // Clear all authentication cookies
    clearAuthCookies(res);

    res.json({
      success: true,
      message: 'Logged out successfully'
    });

  } catch (error) {
    logger.error('Logout error', { error: error.message });
    // Still clear cookies even if there's an error
    clearAuthCookies(res);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Session status endpoint - Returns remaining session time
// Used by frontend to show timeout warning
router.get('/session/status', authenticateToken, async (req, res) => {
  try {
    const status = await getSessionStatus(req.user.userId, req.user.companyId);

    if (!status || !status.active) {
      return res.status(401).json({
        success: false,
        error: 'Session not active',
        code: 'SESSION_INACTIVE'
      });
    }

    res.json({
      success: true,
      data: {
        ...status,
        user: {
          id: req.user.userId,
          email: req.user.email
        }
      }
    });
  } catch (error) {
    logger.error('Session status error', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to get session status'
    });
  }
});

// Extend session endpoint - "Stay logged in" functionality
router.post('/session/extend', authenticateToken, async (req, res) => {
  try {
    const success = await extendSession(req.user.userId, req.user.companyId);

    if (!success) {
      return res.status(500).json({
        success: false,
        error: 'Failed to extend session'
      });
    }

    // Get the per-company timeout for response
    const timeoutMinutes = await getSessionTimeoutForCompany(req.user.companyId);

    auditLog('SESSION_EXTENDED', req.user.userId, {
      email: req.user.email,
      ip: req.ip,
      timeoutMinutes
    });

    res.json({
      success: true,
      message: 'Session extended successfully',
      data: {
        timeoutMinutes: timeoutMinutes,
        expiresAt: Date.now() + (timeoutMinutes * 60 * 1000)
      }
    });
  } catch (error) {
    logger.error('Session extend error', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to extend session'
    });
  }
});

// Session heartbeat endpoint - Silent activity tracking
// Called by frontend when user activity is detected (mouse/keyboard/scroll)
// Unlike /session/extend, this is a lightweight call without detailed audit logging
router.post('/session/heartbeat', authenticateToken, async (req, res) => {
  try {
    const success = await extendSession(req.user.userId, req.user.companyId);

    if (!success) {
      return res.status(500).json({
        success: false,
        error: 'Failed to update session activity'
      });
    }

    // Get updated session status
    const status = await getSessionStatus(req.user.userId, req.user.companyId);

    // Debug log (not audit) - too frequent for audit trail
    logger.debug('Session heartbeat', {
      userId: req.user.userId,
      remainingMinutes: status?.remainingMinutes
    });

    res.json({
      success: true,
      data: {
        remainingMinutes: status?.remainingMinutes || 0,
        timeoutMinutes: status?.timeoutMinutes || 30
      }
    });
  } catch (error) {
    logger.error('Session heartbeat error', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to update session'
    });
  }
});

// ============================================================================
// Password Change Endpoint
// ============================================================================

/**
 * POST /auth/change-password
 * Allows authenticated users to change their own password
 * Requires: Authentication + current password verification
 * SECURITY: Self-service feature - doesn't require MANAGE_USERS permission
 */
router.post('/change-password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.userId;
    const companyId = req.user.companyId || 'al-ramrami';
    const db = getDbConnection(companyId);

    // Validate input
    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        error: 'Current password and new password are required'
      });
    }

    // Password policy validation (using existing regex)
    // At least 8 chars, 1 uppercase, 1 lowercase, 1 number, 1 special char
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
    if (!passwordRegex.test(newPassword)) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 8 characters and include uppercase, lowercase, number, and special character'
      });
    }

    // Get current user
    const user = await db('users')
      .where({ id: userId })
      .first();

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Verify current password
    const isValidPassword = await bcrypt.compare(currentPassword, user.password);
    if (!isValidPassword) {
      auditLog('PASSWORD_CHANGE_FAILED', userId, {
        email: user.email,
        reason: 'invalid_current_password',
        ip: req.ip
      });

      return res.status(401).json({
        success: false,
        error: 'Current password is incorrect'
      });
    }

    // Check if new password is same as current
    const isSamePassword = await bcrypt.compare(newPassword, user.password);
    if (isSamePassword) {
      return res.status(400).json({
        success: false,
        error: 'New password must be different from current password'
      });
    }

    // Hash new password
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

    // Update password and clear force_password_change flag
    await db('users')
      .where({ id: userId })
      .update({
        password: hashedPassword,
        force_password_change: false,
        updated_at: new Date()
      });

    auditLog('PASSWORD_CHANGE_SUCCESS', userId, {
      email: user.email,
      ip: req.ip
    });

    logger.info('User changed password', {
      userId,
      email: user.email
    });

    res.json({
      success: true,
      message: 'Password changed successfully'
    });

  } catch (error) {
    logger.error('Password change error', { error: error.message, stack: error.stack });
    res.status(500).json({
      success: false,
      error: 'Failed to change password'
    });
  }
});

/**
 * PUT /auth/update-profile
 * Allows authenticated users to update their profile information
 * Requires: Authentication
 * SECURITY: Self-service feature - users can only update their own profile
 */
router.put('/update-profile', authenticateToken, async (req, res) => {
  try {
    const { firstName, lastName } = req.body;
    const userId = req.user.userId;
    const companyId = req.user.companyId || 'al-ramrami';
    const db = getDbConnection(companyId);

    // Validate input
    if (!firstName || !lastName) {
      return res.status(400).json({
        success: false,
        error: 'First name and last name are required'
      });
    }

    // Trim and validate lengths
    const trimmedFirstName = firstName.trim();
    const trimmedLastName = lastName.trim();

    if (trimmedFirstName.length < 1 || trimmedFirstName.length > 50) {
      return res.status(400).json({
        success: false,
        error: 'First name must be between 1 and 50 characters'
      });
    }

    if (trimmedLastName.length < 1 || trimmedLastName.length > 50) {
      return res.status(400).json({
        success: false,
        error: 'Last name must be between 1 and 50 characters'
      });
    }

    // Get current user
    const user = await db('users')
      .where({ id: userId })
      .first();

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Update profile
    await db('users')
      .where({ id: userId })
      .update({
        first_name: trimmedFirstName,
        last_name: trimmedLastName,
        updated_at: new Date()
      });

    auditLog('PROFILE_UPDATE', userId, {
      email: user.email,
      changes: {
        firstName: { from: user.first_name, to: trimmedFirstName },
        lastName: { from: user.last_name, to: trimmedLastName }
      },
      ip: req.ip
    });

    logger.info('User updated profile', {
      userId,
      email: user.email
    });

    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        firstName: trimmedFirstName,
        lastName: trimmedLastName,
        name: `${trimmedFirstName} ${trimmedLastName}`
      }
    });

  } catch (error) {
    logger.error('Profile update error', { error: error.message, stack: error.stack });
    res.status(500).json({
      success: false,
      error: 'Failed to update profile'
    });
  }
});

// ============================================================================
// MFA (Multi-Factor Authentication) Endpoints
// ============================================================================

/**
 * GET /auth/mfa/setup
 * Initiates MFA setup - generates a new TOTP secret and returns QR code
 * Requires: Authentication
 * Returns: QR code data URL and secret (for manual entry)
 */
router.get('/mfa/setup', authenticateToken, async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId || 'al-ramrami');

    // Get current user
    const user = await db('users')
      .where({ id: req.user.userId })
      .first();

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Check if MFA is already enabled and verified
    if (user.mfa_enabled && user.mfa_verified_at) {
      return res.status(400).json({
        success: false,
        error: 'MFA is already enabled. Disable it first to reconfigure.',
        code: 'MFA_ALREADY_ENABLED'
      });
    }

    // Generate a new TOTP secret
    const secret = generateSecret();

    // Store the encrypted secret (not yet verified)
    const encryptedSecret = encryptSecret(secret);
    await db('users')
      .where({ id: req.user.userId })
      .update({
        mfa_secret: encryptedSecret,
        mfa_enabled: false,  // Not enabled until verified
        mfa_verified_at: null,
        updated_at: new Date()
      });

    // Generate QR code
    const qrCodeDataUrl = await generateQRCode(secret, user.email);

    auditLog('MFA_SETUP_INITIATED', req.user.userId, {
      email: user.email,
      ip: req.ip
    });

    res.json({
      success: true,
      data: {
        qrCode: qrCodeDataUrl,
        secret: secret,  // For manual entry
        appName: APP_NAME,
        email: user.email,
        instructions: 'Scan the QR code with your authenticator app (Google Authenticator, Authy, etc.), then verify with a code to complete setup.'
      }
    });

  } catch (error) {
    logger.error('MFA setup error', { error: error.message, userId: req.user?.userId });
    res.status(500).json({
      success: false,
      error: 'Failed to initiate MFA setup'
    });
  }
});

/**
 * POST /auth/mfa/verify-setup
 * Verifies TOTP code to complete MFA setup
 * Requires: Authentication + valid TOTP code
 * Returns: Backup codes (one-time display)
 */
router.post('/mfa/verify-setup', authenticateToken, async (req, res) => {
  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({
        success: false,
        error: 'Verification code is required'
      });
    }

    const db = getDbConnection(req.user.companyId || 'al-ramrami');

    // Get user with pending MFA secret
    const user = await db('users')
      .where({ id: req.user.userId })
      .first();

    if (!user || !user.mfa_secret) {
      return res.status(400).json({
        success: false,
        error: 'MFA setup not initiated. Call /auth/mfa/setup first.',
        code: 'MFA_NOT_INITIATED'
      });
    }

    if (user.mfa_enabled && user.mfa_verified_at) {
      return res.status(400).json({
        success: false,
        error: 'MFA is already enabled',
        code: 'MFA_ALREADY_ENABLED'
      });
    }

    // Decrypt the secret and verify the code
    const secret = decryptSecret(user.mfa_secret);
    const isValid = verifyCode(code, secret);

    if (!isValid) {
      auditLog('MFA_SETUP_FAILED', req.user.userId, {
        email: user.email,
        reason: 'invalid_code',
        ip: req.ip
      });

      return res.status(400).json({
        success: false,
        error: 'Invalid verification code. Please try again.',
        code: 'INVALID_CODE'
      });
    }

    // Generate backup codes
    const { codes: backupCodes, hashedCodes } = generateBackupCodes();

    // Enable MFA and store backup codes
    await db('users')
      .where({ id: req.user.userId })
      .update({
        mfa_enabled: true,
        mfa_verified_at: new Date(),
        mfa_backup_codes: JSON.stringify(hashedCodes),
        updated_at: new Date()
      });

    auditLog('MFA_ENABLED', req.user.userId, {
      email: user.email,
      ip: req.ip
    });

    logger.info('MFA enabled for user', {
      userId: req.user.userId,
      email: user.email
    });

    res.json({
      success: true,
      message: 'MFA enabled successfully',
      data: {
        backupCodes: backupCodes,
        warning: 'IMPORTANT: Save these backup codes in a secure location. They will not be shown again. Each code can only be used once.'
      }
    });

  } catch (error) {
    logger.error('MFA verify-setup error', { error: error.message, userId: req.user?.userId });
    res.status(500).json({
      success: false,
      error: 'Failed to complete MFA setup'
    });
  }
});

/**
 * DELETE /auth/mfa
 * Disables MFA for the user
 * Requires: Authentication + current password (for security)
 */
router.delete('/mfa', authenticateToken, async (req, res) => {
  try {
    const { password, code } = req.body;

    // Require either password or MFA code for security
    if (!password && !code) {
      return res.status(400).json({
        success: false,
        error: 'Password or MFA code required to disable MFA'
      });
    }

    const db = getDbConnection(req.user.companyId || 'al-ramrami');

    const user = await db('users')
      .where({ id: req.user.userId })
      .first();

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    if (!user.mfa_enabled) {
      return res.status(400).json({
        success: false,
        error: 'MFA is not enabled',
        code: 'MFA_NOT_ENABLED'
      });
    }

    // Verify authentication (password or MFA code)
    let authenticated = false;

    if (password) {
      authenticated = await bcrypt.compare(password, user.password);
    }

    if (!authenticated && code && user.mfa_secret) {
      const secret = decryptSecret(user.mfa_secret);
      authenticated = verifyCode(code, secret);
    }

    if (!authenticated) {
      auditLog('MFA_DISABLE_FAILED', req.user.userId, {
        email: user.email,
        reason: 'authentication_failed',
        ip: req.ip
      });

      return res.status(401).json({
        success: false,
        error: 'Invalid password or MFA code'
      });
    }

    // Disable MFA
    await db('users')
      .where({ id: req.user.userId })
      .update({
        mfa_enabled: false,
        mfa_secret: null,
        mfa_backup_codes: null,
        mfa_verified_at: null,
        mfa_last_used: null,
        updated_at: new Date()
      });

    auditLog('MFA_DISABLED', req.user.userId, {
      email: user.email,
      ip: req.ip
    });

    logger.info('MFA disabled for user', {
      userId: req.user.userId,
      email: user.email
    });

    res.json({
      success: true,
      message: 'MFA has been disabled'
    });

  } catch (error) {
    logger.error('MFA disable error', { error: error.message, userId: req.user?.userId });
    res.status(500).json({
      success: false,
      error: 'Failed to disable MFA'
    });
  }
});

/**
 * POST /auth/mfa/regenerate-backup-codes
 * Regenerates backup codes (invalidates all existing codes)
 * Requires: Authentication + MFA code (to prove possession of authenticator)
 */
router.post('/mfa/regenerate-backup-codes', authenticateToken, async (req, res) => {
  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({
        success: false,
        error: 'MFA code required to regenerate backup codes'
      });
    }

    const db = getDbConnection(req.user.companyId || 'al-ramrami');

    const user = await db('users')
      .where({ id: req.user.userId })
      .first();

    if (!user || !user.mfa_enabled) {
      return res.status(400).json({
        success: false,
        error: 'MFA is not enabled',
        code: 'MFA_NOT_ENABLED'
      });
    }

    // Verify MFA code
    const secret = decryptSecret(user.mfa_secret);
    const isValid = verifyCode(code, secret);

    if (!isValid) {
      auditLog('MFA_BACKUP_REGEN_FAILED', req.user.userId, {
        email: user.email,
        reason: 'invalid_code',
        ip: req.ip
      });

      return res.status(401).json({
        success: false,
        error: 'Invalid MFA code'
      });
    }

    // Generate new backup codes
    const { codes: backupCodes, hashedCodes } = generateBackupCodes();

    // Update backup codes in database
    await db('users')
      .where({ id: req.user.userId })
      .update({
        mfa_backup_codes: JSON.stringify(hashedCodes),
        updated_at: new Date()
      });

    auditLog('MFA_BACKUP_CODES_REGENERATED', req.user.userId, {
      email: user.email,
      ip: req.ip
    });

    res.json({
      success: true,
      message: 'Backup codes regenerated',
      data: {
        backupCodes: backupCodes,
        warning: 'IMPORTANT: All previous backup codes are now invalid. Save these new codes in a secure location.'
      }
    });

  } catch (error) {
    logger.error('MFA backup regeneration error', { error: error.message, userId: req.user?.userId });
    res.status(500).json({
      success: false,
      error: 'Failed to regenerate backup codes'
    });
  }
});

/**
 * GET /auth/mfa/status
 * Gets the MFA status for the current user
 * Requires: Authentication
 */
router.get('/mfa/status', authenticateToken, async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId || 'al-ramrami');

    const user = await db('users')
      .where({ id: req.user.userId })
      .select('mfa_enabled', 'mfa_verified_at', 'mfa_last_used', 'mfa_backup_codes')
      .first();

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Count remaining backup codes
    let backupCodesRemaining = 0;
    if (user.mfa_backup_codes) {
      try {
        // Handle both array (MySQL JSON column) and string formats
        let codes = user.mfa_backup_codes;
        if (typeof codes === 'string') {
          codes = JSON.parse(codes);
        }
        backupCodesRemaining = codes.filter(c => c !== null).length;
      } catch (e) {
        // Ignore parse errors
      }
    }

    res.json({
      success: true,
      data: {
        enabled: !!user.mfa_enabled,
        verifiedAt: user.mfa_verified_at,
        lastUsed: user.mfa_last_used,
        backupCodesRemaining: backupCodesRemaining
      }
    });

  } catch (error) {
    logger.error('MFA status error', { error: error.message, userId: req.user?.userId });
    res.status(500).json({
      success: false,
      error: 'Failed to get MFA status'
    });
  }
});

/**
 * POST /auth/mfa/verify
 * Verifies MFA code during login flow (used after password verification)
 * This is called by the frontend when MFA is required
 * Accepts either TOTP code or backup code
 */
router.post('/mfa/verify', async (req, res) => {
  try {
    const { userId, companyId, code, isBackupCode } = req.body;

    if (!userId || !companyId || !code) {
      return res.status(400).json({
        success: false,
        error: 'userId, companyId, and code are required'
      });
    }

    const db = getDbConnection(companyId);

    const user = await db('users')
      .where({ id: userId })
      .first();

    if (!user || !user.mfa_enabled) {
      return res.status(400).json({
        success: false,
        error: 'MFA is not enabled for this user',
        code: 'MFA_NOT_ENABLED'
      });
    }

    let verified = false;

    if (isBackupCode) {
      // Verify backup code
      // Handle both array (MySQL JSON column) and string formats
      let hashedCodes = user.mfa_backup_codes || [];
      if (typeof hashedCodes === 'string') {
        hashedCodes = JSON.parse(hashedCodes);
      }
      const result = verifyBackupCode(code, hashedCodes);

      if (result.valid) {
        verified = true;
        // Invalidate the used backup code
        hashedCodes[result.usedIndex] = null;
        await db('users')
          .where({ id: userId })
          .update({
            mfa_backup_codes: JSON.stringify(hashedCodes),
            mfa_last_used: new Date()
          });

        auditLog('MFA_BACKUP_CODE_USED', userId, {
          email: user.email,
          codesRemaining: hashedCodes.filter(c => c !== null).length,
          ip: req.ip
        });
      }
    } else {
      // Verify TOTP code
      const secret = decryptSecret(user.mfa_secret);
      verified = verifyCode(code, secret);

      if (verified) {
        await db('users')
          .where({ id: userId })
          .update({ mfa_last_used: new Date() });
      }
    }

    if (!verified) {
      auditLog('MFA_VERIFY_FAILED', userId, {
        email: user.email,
        isBackupCode,
        ip: req.ip
      });

      return res.status(401).json({
        success: false,
        error: isBackupCode ? 'Invalid backup code' : 'Invalid verification code',
        code: 'INVALID_CODE'
      });
    }

    // Convert role format
    const roleMapping = {
      'super-admin': 'SUPER_ADMIN',
      'company-admin': 'COMPANY_ADMIN',
      'manager': 'MANAGER',
      'sales-staff': 'SALES_STAFF',
      'purchase-staff': 'PURCHASE_STAFF',
      'accounts-staff': 'ACCOUNTS_STAFF'
    };
    const mappedRole = roleMapping[user.role] || user.role;

    // Get user permissions - prefer role_id from DB, fallback to legacy role string
    const permissions = await getUserPermissions(user.role_id || mappedRole, user.companyId);

    // Generate tokens (completing the login flow)
    const tokens = generateTokenPair(
      user.id,
      user.email,
      mappedRole,
      user.companyId,
      permissions,
      user.role_id
    );

    // Set cookies
    setAuthCookies(res, tokens.accessToken, tokens.refreshToken);

    // Initialize session (per-company configurable timeout)
    await initializeSession(user.id, user.companyId);

    auditLog('MFA_VERIFY_SUCCESS', userId, {
      email: user.email,
      isBackupCode,
      ip: req.ip
    });

    res.json({
      success: true,
      message: 'MFA verification successful',
      data: {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: mappedRole,
          roleId: user.role_id,
          companyId: user.companyId,
          permissions
        },
        session: {
          timeoutMinutes: SESSION_TIMEOUT_MINUTES
        }
      }
    });

  } catch (error) {
    logger.error('MFA verify error', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'MFA verification failed'
    });
  }
});

// ============================================================================
// Helper Functions
// ============================================================================

// Get user permissions based on role_id (database) or role string (legacy fallback)
const getUserPermissions = async (roleOrRoleId, companyId, db = null) => {
  // In development mode with GRANT_ALL_PERMISSIONS=true, grant all permissions
  if (process.env.NODE_ENV === 'development' && process.env.GRANT_ALL_PERMISSIONS === 'true') {
    console.log('🔓 DEVELOPMENT MODE: Granting all permissions');
    return [
      // All permissions for development testing
      'VIEW_CUSTOMERS', 'CREATE_CUSTOMERS', 'EDIT_CUSTOMERS', 'DELETE_CUSTOMERS', 'MANAGE_CUSTOMERS',
      'VIEW_SUPPLIERS', 'CREATE_SUPPLIERS', 'EDIT_SUPPLIERS', 'DELETE_SUPPLIERS', 'MANAGE_SUPPLIERS',
      'MANAGE_VENDORS', 'VIEW_VENDORS',
      'VIEW_INVENTORY', 'UPDATE_INVENTORY', 'MANAGE_INVENTORY', 'UPDATE_STOCK',
      'VIEW_SALES', 'CREATE_SALES', 'PROCESS_SALES', 'EDIT_SALES', 'DELETE_SALES', 'APPROVE_SALES',
      'VIEW_PURCHASE', 'VIEW_PURCHASES', 'CREATE_PURCHASE', 'CREATE_PURCHASES', 'EDIT_PURCHASE', 'EDIT_PURCHASES',
      'DELETE_PURCHASE', 'DELETE_PURCHASES', 'APPROVE_PURCHASE', 'APPROVE_PURCHASES',
      'CREATE_PURCHASE_ORDER', 'VIEW_PURCHASE_ORDER', 'EDIT_PURCHASE_ORDER', 'DELETE_PURCHASE_ORDER', 'APPROVE_PURCHASE_ORDER',
      'CREATE_INVOICES', 'VIEW_INVOICES', 'EDIT_INVOICES',
      'VIEW_CONTRACTS', 'CREATE_CONTRACTS', 'EDIT_CONTRACTS', 'MANAGE_CONTRACTS', 'APPROVE_CONTRACTS',
      'VIEW_WASTAGE', 'CREATE_WASTAGE', 'EDIT_WASTAGE', 'DELETE_WASTAGE', 'APPROVE_WASTAGE',
      'VIEW_PETTY_CASH', 'MANAGE_PETTY_CASH', 'CREATE_PETTY_CASH', 'EDIT_PETTY_CASH', 'RELOAD_CARD',
      'VIEW_EXPENSE_REPORTS', 'CREATE_EXPENSE', 'EDIT_EXPENSE', 'DELETE_EXPENSE', 'APPROVE_EXPENSE',
      'VIEW_COLLECTIONS', 'CREATE_COLLECTIONS', 'EDIT_COLLECTIONS', 'DELETE_COLLECTIONS', 'APPROVE_COLLECTIONS',
      'VIEW_MATERIALS', 'CREATE_MATERIALS', 'EDIT_MATERIALS', 'DELETE_MATERIALS',
      'VIEW_FINANCIALS', 'MANAGE_EXPENSES', 'APPROVE_EXPENSES', 'VIEW_PROFIT_LOSS',
      'VIEW_REPORTS', 'EXPORT_REPORTS', 'CREATE_CUSTOM_REPORTS',
      'VIEW_SETTINGS', 'EDIT_SETTINGS', 'MANAGE_SETTINGS',
      'MANAGE_USERS', 'VIEW_USERS', 'ASSIGN_ROLES', 'MANAGE_ROLES', 'VIEW_ROLES',
      'VIEW_AUDIT_LOGS', 'VIEW_COMPANIES', 'MANAGE_COMPANIES', 'SWITCH_COMPANIES'
    ];
  }

  // Try to fetch permissions from database roles table
  if (typeof roleOrRoleId === 'number' && roleOrRoleId > 0) {
    try {
      const dbConn = db || getDbConnection(companyId);
      const role = await dbConn('roles')
        .where({ id: roleOrRoleId, company_id: companyId, is_active: true })
        .first();

      if (role && role.permissions) {
        const permissions = typeof role.permissions === 'string'
          ? JSON.parse(role.permissions)
          : role.permissions;
        logger.debug('Loaded permissions from DB role', { roleId: roleOrRoleId, roleName: role.name, count: permissions.length });
        return permissions;
      }
    } catch (error) {
      logger.warn('Failed to load permissions from DB, using fallback', { error: error.message, roleOrRoleId });
    }
  }

  // Legacy fallback: Use hardcoded permissions based on role string
  // This ensures backward compatibility for users without role_id
  const rolePermissions = {
    'SUPER_ADMIN': [
      'VIEW_CUSTOMERS', 'CREATE_CUSTOMERS', 'EDIT_CUSTOMERS', 'DELETE_CUSTOMERS', 'MANAGE_CUSTOMERS',
      'VIEW_SUPPLIERS', 'CREATE_SUPPLIERS', 'EDIT_SUPPLIERS', 'DELETE_SUPPLIERS', 'MANAGE_SUPPLIERS',
      'MANAGE_VENDORS', 'VIEW_VENDORS',
      'VIEW_INVENTORY', 'UPDATE_INVENTORY', 'MANAGE_INVENTORY', 'UPDATE_STOCK',
      'VIEW_SALES', 'CREATE_SALES', 'PROCESS_SALES', 'EDIT_SALES', 'DELETE_SALES', 'APPROVE_SALES',
      'VIEW_PURCHASE', 'VIEW_PURCHASES', 'CREATE_PURCHASE', 'CREATE_PURCHASES', 'APPROVE_PURCHASE', 'APPROVE_PURCHASES',
      'CREATE_PURCHASE_ORDER', 'VIEW_PURCHASE_ORDER', 'EDIT_PURCHASE_ORDER', 'DELETE_PURCHASE_ORDER', 'APPROVE_PURCHASE_ORDER',
      'CREATE_INVOICES', 'VIEW_INVOICES', 'EDIT_INVOICES',
      'VIEW_CONTRACTS', 'CREATE_CONTRACTS', 'EDIT_CONTRACTS', 'MANAGE_CONTRACTS', 'APPROVE_CONTRACTS',
      'VIEW_WASTAGE', 'CREATE_WASTAGE', 'EDIT_WASTAGE', 'APPROVE_WASTAGE',
      'VIEW_COLLECTIONS', 'CREATE_COLLECTIONS', 'EDIT_COLLECTIONS', 'DELETE_COLLECTIONS', 'APPROVE_COLLECTIONS',
      'VIEW_PETTY_CASH', 'MANAGE_PETTY_CASH', 'RELOAD_CARD',
      'VIEW_EXPENSE_REPORTS', 'CREATE_EXPENSE', 'APPROVE_EXPENSE',
      'VIEW_FINANCIALS', 'MANAGE_EXPENSES', 'APPROVE_EXPENSES', 'VIEW_PROFIT_LOSS',
      'VIEW_REPORTS', 'EXPORT_REPORTS', 'CREATE_CUSTOM_REPORTS',
      'VIEW_SETTINGS', 'EDIT_SETTINGS', 'MANAGE_SETTINGS',
      'MANAGE_USERS', 'VIEW_USERS', 'ASSIGN_ROLES', 'MANAGE_ROLES', 'VIEW_ROLES',
      'VIEW_AUDIT_LOGS', 'VIEW_COMPANIES', 'MANAGE_COMPANIES', 'SWITCH_COMPANIES'
    ],
    'COMPANY_ADMIN': [
      'VIEW_CUSTOMERS', 'CREATE_CUSTOMERS', 'EDIT_CUSTOMERS', 'DELETE_CUSTOMERS', 'MANAGE_CUSTOMERS',
      'VIEW_SUPPLIERS', 'CREATE_SUPPLIERS', 'EDIT_SUPPLIERS', 'DELETE_SUPPLIERS', 'MANAGE_SUPPLIERS',
      'MANAGE_VENDORS', 'VIEW_VENDORS',
      'VIEW_INVENTORY', 'UPDATE_INVENTORY', 'MANAGE_INVENTORY', 'UPDATE_STOCK',
      'VIEW_SALES', 'CREATE_SALES', 'EDIT_SALES', 'PROCESS_SALES', 'DELETE_SALES', 'APPROVE_SALES',
      'VIEW_PURCHASE', 'VIEW_PURCHASES', 'CREATE_PURCHASE', 'CREATE_PURCHASES', 'EDIT_PURCHASE', 'APPROVE_PURCHASE', 'APPROVE_PURCHASES',
      'CREATE_PURCHASE_ORDER', 'VIEW_PURCHASE_ORDER', 'EDIT_PURCHASE_ORDER', 'DELETE_PURCHASE_ORDER', 'APPROVE_PURCHASE_ORDER',
      'CREATE_INVOICES', 'VIEW_INVOICES', 'EDIT_INVOICES',
      'VIEW_CONTRACTS', 'CREATE_CONTRACTS', 'EDIT_CONTRACTS', 'MANAGE_CONTRACTS', 'APPROVE_CONTRACTS',
      'VIEW_WASTAGE', 'CREATE_WASTAGE', 'EDIT_WASTAGE', 'APPROVE_WASTAGE',
      'VIEW_COLLECTIONS', 'CREATE_COLLECTIONS', 'EDIT_COLLECTIONS', 'DELETE_COLLECTIONS', 'APPROVE_COLLECTIONS',
      'VIEW_PETTY_CASH', 'MANAGE_PETTY_CASH', 'RELOAD_CARD',
      'VIEW_EXPENSE_REPORTS', 'CREATE_EXPENSE', 'APPROVE_EXPENSE',
      'VIEW_FINANCIALS', 'MANAGE_EXPENSES', 'APPROVE_EXPENSES', 'VIEW_PROFIT_LOSS',
      'VIEW_REPORTS', 'EXPORT_REPORTS', 'CREATE_CUSTOM_REPORTS',
      'VIEW_SETTINGS', 'EDIT_SETTINGS', 'MANAGE_SETTINGS',
      'MANAGE_USERS', 'VIEW_USERS', 'ASSIGN_ROLES', 'MANAGE_ROLES', 'VIEW_ROLES',
      'VIEW_AUDIT_LOGS', 'VIEW_COMPANIES'
    ],
    'MANAGER': [
      'VIEW_CUSTOMERS', 'CREATE_CUSTOMERS', 'EDIT_CUSTOMERS', 'MANAGE_CUSTOMERS',
      'VIEW_SUPPLIERS', 'CREATE_SUPPLIERS', 'EDIT_SUPPLIERS', 'MANAGE_SUPPLIERS',
      'MANAGE_VENDORS', 'VIEW_VENDORS',
      'VIEW_INVENTORY', 'UPDATE_INVENTORY', 'UPDATE_STOCK', 'MANAGE_INVENTORY',
      'VIEW_SALES', 'CREATE_SALES', 'EDIT_SALES', 'PROCESS_SALES', 'APPROVE_SALES',
      'VIEW_PURCHASE', 'VIEW_PURCHASES', 'CREATE_PURCHASE', 'CREATE_PURCHASES', 'EDIT_PURCHASE', 'APPROVE_PURCHASE',
      'CREATE_PURCHASE_ORDER', 'VIEW_PURCHASE_ORDER', 'EDIT_PURCHASE_ORDER', 'APPROVE_PURCHASE_ORDER',
      'CREATE_INVOICES', 'VIEW_INVOICES', 'EDIT_INVOICES',
      'VIEW_CONTRACTS', 'CREATE_CONTRACTS', 'EDIT_CONTRACTS', 'APPROVE_CONTRACTS',
      'VIEW_WASTAGE', 'CREATE_WASTAGE', 'EDIT_WASTAGE', 'APPROVE_WASTAGE',
      'VIEW_COLLECTIONS', 'CREATE_COLLECTIONS', 'EDIT_COLLECTIONS', 'APPROVE_COLLECTIONS',
      'VIEW_PETTY_CASH', 'MANAGE_PETTY_CASH', 'RELOAD_CARD',
      'VIEW_EXPENSE_REPORTS', 'CREATE_EXPENSE', 'APPROVE_EXPENSE',
      'VIEW_FINANCIALS', 'MANAGE_EXPENSES', 'APPROVE_EXPENSES', 'VIEW_PROFIT_LOSS',
      'VIEW_REPORTS', 'EXPORT_REPORTS',
      'VIEW_USERS', 'VIEW_ROLES'
    ],
    'SALES_STAFF': [
      'VIEW_CUSTOMERS', 'CREATE_CUSTOMERS', 'EDIT_CUSTOMERS', 'MANAGE_CUSTOMERS',
      'VIEW_SUPPLIERS',
      'VIEW_INVENTORY',
      'VIEW_SALES', 'CREATE_SALES', 'EDIT_SALES',
      'CREATE_INVOICES', 'VIEW_INVOICES', 'EDIT_INVOICES',
      'VIEW_CONTRACTS',
      'VIEW_WASTAGE',
      'VIEW_PETTY_CASH',
      'VIEW_FINANCIALS',
      'VIEW_REPORTS'
    ],
    'PURCHASE_STAFF': [
      'VIEW_SUPPLIERS', 'CREATE_SUPPLIERS', 'EDIT_SUPPLIERS', 'MANAGE_SUPPLIERS',
      'MANAGE_VENDORS', 'VIEW_VENDORS',
      'VIEW_INVENTORY', 'UPDATE_INVENTORY', 'UPDATE_STOCK', 'MANAGE_INVENTORY',
      'VIEW_PURCHASE', 'VIEW_PURCHASES', 'CREATE_PURCHASE', 'CREATE_PURCHASES', 'EDIT_PURCHASE',
      'CREATE_PURCHASE_ORDER', 'VIEW_PURCHASE_ORDER', 'EDIT_PURCHASE_ORDER',
      'VIEW_CONTRACTS',
      'VIEW_WASTAGE', 'CREATE_WASTAGE', 'EDIT_WASTAGE',
      'VIEW_PETTY_CASH', 'CREATE_EXPENSE',
      'VIEW_COLLECTIONS', 'CREATE_COLLECTIONS', 'EDIT_COLLECTIONS',
      'VIEW_FINANCIALS',
      'VIEW_REPORTS'
    ],
    'ACCOUNTS_STAFF': [
      'VIEW_CUSTOMERS', 'VIEW_SUPPLIERS',
      'VIEW_INVENTORY',
      'VIEW_SALES', 'VIEW_PURCHASE', 'VIEW_PURCHASES',
      'VIEW_INVOICES', 'EDIT_INVOICES',
      'VIEW_WASTAGE',
      'VIEW_PETTY_CASH', 'MANAGE_PETTY_CASH',
      'VIEW_EXPENSE_REPORTS', 'CREATE_EXPENSE',
      'VIEW_FINANCIALS', 'MANAGE_EXPENSES', 'VIEW_PROFIT_LOSS',
      'VIEW_REPORTS', 'EXPORT_REPORTS'
    ]
  };

  return rolePermissions[roleOrRoleId] || [];
};

// Debug endpoint to check token permissions
// SECURITY: Disabled in production to prevent information disclosure
router.get('/debug-token', async (req, res) => {
  // Block access in production
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }

  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }
    
    const { verifyToken } = require('../utils/jwt');
    const decoded = verifyToken(token);
    
    res.json({
      success: true,
      tokenData: {
        userId: decoded.userId,
        email: decoded.email,
        role: decoded.role,
        companyId: decoded.companyId,
        permissions: decoded.permissions || []
      }
    });
  } catch (error) {
    res.status(401).json({ error: error.message });
  }
});

module.exports = router;