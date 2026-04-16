const { verifyToken } = require('../utils/jwt');
const { logger, auditLog } = require('../utils/logger');
const tokenBlacklist = require('../utils/tokenBlacklist');
const { hasPermission, hasAnyPermission, hasAllPermissions } = require('../config/permissionsHierarchy');

/**
 * Authentication middleware
 *
 * Token extraction priority:
 * 1. HttpOnly cookie (accessToken) - preferred, secure
 * 2. Authorization header (Bearer token) - fallback for migration/mobile
 *
 * Validation checks:
 * 1. Token exists
 * 2. Token is valid JWT
 * 3. Token is not blacklisted (individual)
 * 4. User is not force logged out (user-wide)
 */
const authenticateToken = async (req, res, next) => {
  try {
    // 1. Extract token - cookies first, then header (for migration)
    let token = req.cookies?.accessToken;
    let tokenSource = 'cookie';

    // Fallback to Authorization header if no cookie
    if (!token) {
      const authHeader = req.headers['authorization'];
      token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
      tokenSource = 'header';
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        code: 'NO_TOKEN'
      });
    }

    // 2. Verify token signature and expiration
    const decoded = verifyToken(token);

    // 3. Check token blacklist (individual token and user-wide)
    const blacklistCheck = await tokenBlacklist.isTokenValid(
      token,
      decoded.userId,
      decoded.iat
    );

    if (!blacklistCheck.valid) {
      auditLog('TOKEN_REJECTED', decoded.userId, {
        reason: blacklistCheck.reason,
        email: decoded.email,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        endpoint: req.originalUrl
      });

      // Clear cookies if token is revoked
      res.clearCookie('accessToken');
      res.clearCookie('refreshToken');

      return res.status(401).json({
        success: false,
        error: blacklistCheck.reason === 'FORCE_LOGOUT'
          ? 'Your session has been terminated by an administrator'
          : 'Token has been revoked',
        code: blacklistCheck.reason
      });
    }

    // 4. Add user info and token to request
    req.user = {
      userId: decoded.userId,
      email: decoded.email,
      role: decoded.role,
      companyId: decoded.companyId,
      permissions: decoded.permissions || [],
      roleId: decoded.roleId,  // Use camelCase to match JWT payload and route expectations
      impersonated_by: decoded.impersonated_by || null,
      impersonator_email: decoded.impersonator_email || null
    };

    // Store token for potential logout blacklisting
    req.token = token;
    req.tokenSource = tokenSource;
    req.tokenIssuedAt = decoded.iat;

    // Log successful authentication (debug level to reduce noise)
    logger.debug('Auth success', {
      userId: decoded.userId,
      source: tokenSource,
      endpoint: req.originalUrl
    });

    next();
  } catch (error) {
    // Log failed authentication attempt
    auditLog('AUTH_FAILED', 'unknown', {
      error: error.message,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      endpoint: req.originalUrl
    });

    // Determine error type for appropriate response
    let errorCode = 'INVALID_TOKEN';
    let errorMessage = 'Invalid or expired token';

    if (error.name === 'TokenExpiredError') {
      errorCode = 'TOKEN_EXPIRED';
      errorMessage = 'Token has expired';
    } else if (error.name === 'JsonWebTokenError') {
      errorCode = 'INVALID_TOKEN';
      errorMessage = 'Invalid token';
    }

    return res.status(401).json({
      success: false,
      error: errorMessage,
      code: errorCode
    });
  }
};

// Role-based authorization middleware
const requireRole = (allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const userRole = req.user.role;
    if (!allowedRoles.includes(userRole)) {
      auditLog('AUTHORIZATION_FAILED', req.user.userId, {
        requiredRoles: allowedRoles,
        userRole: userRole,
        endpoint: req.originalUrl,
        ip: req.ip
      });

      return res.status(403).json({
        success: false,
        error: 'Insufficient permissions'
      });
    }

    next();
  };
};

// Permission-based authorization middleware with hierarchical checking
const requirePermission = (requiredPermission) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    // Super Admin bypass: role-based + permission-based + roleId-based overrides
    // Ensures super admins are never blocked regardless of JWT structure
    const rawRole = (req.user.role || '').toString();
    const normalizedRole = rawRole.toLowerCase().replace(/[-_\s]/g, '');
    const userPerms = req.user.permissions || [];
    if (
      normalizedRole === 'superadmin' ||
      userPerms.includes('SUPER_ADMIN') ||
      userPerms.includes('*') ||
      req.user.roleId === 1  // Role ID 1 is typically super admin
    ) {
      return next();
    }

    const userPermissions = req.user.permissions || [];

    // Use hierarchical permission checking - parent permissions grant child permissions
    if (!hasPermission(userPermissions, requiredPermission)) {
      auditLog('PERMISSION_DENIED', req.user.userId, {
        requiredPermission,
        userPermissions,
        endpoint: req.originalUrl,
        ip: req.ip
      });

      return res.status(403).json({
        success: false,
        error: `Permission '${requiredPermission}' is required`
      });
    }

    next();
  };
};

/**
 * Require any of the specified permissions (hierarchical checking)
 * @param {string[]} permissions - Array of permission strings (user needs at least ONE)
 */
const requireAnyPermission = (permissions) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    // Super Admin bypass
    const userRole = (req.user.role || '').toLowerCase().replace(/[_\s]/g, '-');
    if (userRole === 'super-admin') {
      return next();
    }

    const userPermissions = req.user.permissions || [];

    // Use hierarchical checking - checks if user has ANY of the required permissions
    if (!hasAnyPermission(userPermissions, permissions)) {
      auditLog('PERMISSION_DENIED', req.user.userId, {
        requiredPermissions: permissions,
        userPermissions,
        endpoint: req.originalUrl,
        ip: req.ip
      });

      return res.status(403).json({
        success: false,
        error: `One of these permissions is required: ${permissions.join(', ')}`
      });
    }

    next();
  };
};

/**
 * Require all of the specified permissions (hierarchical checking)
 * @param {string[]} permissions - Array of permission strings (user needs ALL)
 */
const requireAllPermissions = (permissions) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const userPermissions = req.user.permissions || [];

    // Use hierarchical checking - checks if user has ALL of the required permissions
    if (!hasAllPermissions(userPermissions, permissions)) {
      auditLog('PERMISSION_DENIED', req.user.userId, {
        requiredPermissions: permissions,
        userPermissions,
        endpoint: req.originalUrl,
        ip: req.ip
      });

      return res.status(403).json({
        success: false,
        error: `All of these permissions are required: ${permissions.join(', ')}`
      });
    }

    next();
  };
};

// Company access middleware
const requireCompanyAccess = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required'
    });
  }

  const requestedCompany = req.params.companyId || req.body.companyId || req.query.companyId;
  const userCompany = req.user.companyId;
  const userRole = req.user.role;

  // Super admin can access all companies
  if (userRole === 'super-admin') {
    return next();
  }

  // Check if user has access to requested company
  if (requestedCompany && requestedCompany !== userCompany) {
    auditLog('COMPANY_ACCESS_DENIED', req.user.userId, {
      requestedCompany,
      userCompany,
      userRole,
      endpoint: req.originalUrl,
      ip: req.ip
    });

    return res.status(403).json({
      success: false,
      error: 'Access to this company is not allowed'
    });
  }

  next();
};

// Rate limiting for authentication attempts
const authRateLimit = require('express-rate-limit')({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 requests per windowMs
  message: {
    error: 'Too many authentication attempts, please try again later.',
    retryAfter: 15 * 60 // 15 minutes in seconds
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true
});

module.exports = {
  authenticateToken,
  requireRole,
  requirePermission,
  requireAnyPermission,
  requireAllPermissions,
  requireCompanyAccess,
  authRateLimit
};