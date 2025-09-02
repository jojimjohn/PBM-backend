const { verifyToken } = require('../utils/jwt');
const { logger, auditLog } = require('../utils/logger');

// Authentication middleware
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Access token is required'
      });
    }

    // Verify token
    const decoded = verifyToken(token);
    
    // Add user info to request
    req.user = {
      userId: decoded.userId,
      email: decoded.email,
      role: decoded.role,
      companyId: decoded.companyId,
      permissions: decoded.permissions || []
    };

    // Log successful authentication
    auditLog('AUTH_SUCCESS', decoded.userId, {
      email: decoded.email,
      role: decoded.role,
      companyId: decoded.companyId,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
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

    return res.status(401).json({
      success: false,
      error: error.message
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

// Permission-based authorization middleware
const requirePermission = (requiredPermission) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const userPermissions = req.user.permissions || [];
    if (!userPermissions.includes(requiredPermission)) {
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
  requireCompanyAccess,
  authRateLimit
};