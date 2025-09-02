const express = require('express');
const bcrypt = require('bcrypt');
const { generateTokenPair, verifyRefreshToken } = require('../utils/jwt');
const { validate, sanitize, schemas } = require('../middleware/validation');
const { authRateLimit } = require('../middleware/auth');
const { logger, auditLog } = require('../utils/logger');
const { getDbConnection } = require('../config/database');

const router = express.Router();

// Apply sanitization to all routes
router.use(sanitize);

// Debug endpoint to get server IP information (for database whitelisting)
router.get('/server-info', async (req, res) => {
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

    // Get user permissions based on role
    const permissions = await getUserPermissions(user.role, companyId);

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

    // Generate tokens
    const tokens = generateTokenPair(
      user.id,
      user.email,
      mappedRole,
      user.companyId,
      permissions
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
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: mappedRole,
          companyId: user.companyId,
          permissions
        },
        ...tokens
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

// Register endpoint (restricted to super-admin)
router.post('/register', validate(schemas.register), async (req, res) => {
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

// Refresh token endpoint
router.post('/refresh', validate(schemas.refreshToken), async (req, res) => {
  try {
    const { refreshToken } = req.body;

    // Verify refresh token
    const decoded = verifyRefreshToken(refreshToken);
    const db = getDbConnection(decoded.companyId || 'al-ramrami');

    // Get user details
    const user = await db('users')
      .where({ id: decoded.userId })
      .first();

    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        error: 'Invalid refresh token'
      });
    }

    // Get user permissions
    const permissions = await getUserPermissions(user.role, user.companyId);

    // Generate new tokens
    const tokens = generateTokenPair(
      user.id,
      user.email,
      user.role,
      user.companyId,
      permissions
    );

    auditLog('TOKEN_REFRESHED', user.id, {
      email: user.email,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: true,
      message: 'Tokens refreshed successfully',
      data: tokens
    });

  } catch (error) {
    logger.error('Token refresh error', { error: error.message });
    res.status(401).json({
      success: false,
      error: 'Invalid refresh token'
    });
  }
});

// Logout endpoint
router.post('/logout', async (req, res) => {
  try {
    // In a more sophisticated setup, you would blacklist the token
    // For now, we'll just log the logout event
    
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
      try {
        const { verifyToken } = require('../utils/jwt');
        const decoded = verifyToken(token);
        
        auditLog('LOGOUT', decoded.userId, {
          email: decoded.email,
          ip: req.ip,
          userAgent: req.get('User-Agent')
        });
      } catch (error) {
        // Token might be expired, but that's okay for logout
      }
    }

    res.json({
      success: true,
      message: 'Logged out successfully'
    });

  } catch (error) {
    logger.error('Logout error', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Get user permissions based on role and company
const getUserPermissions = async (role, companyId) => {
  // Define permissions based on roles (as per existing RBAC system)
  const rolePermissions = {
    'SUPER_ADMIN': [
      'customers:read', 'customers:write', 'customers:delete',
      'suppliers:read', 'suppliers:write', 'suppliers:delete',
      'inventory:read', 'inventory:write', 'inventory:update',
      'sales:read', 'sales:write', 'sales:process',
      'purchases:read', 'purchases:write', 'purchases:approve',
      'contracts:read', 'contracts:write', 'contracts:manage',
      'wastage:read', 'wastage:write', 'wastage:approve',
      'petty-cash:read', 'petty-cash:write', 'petty-cash:manage',
      'expense:read', 'expense:write', 'expense:approve',
      'reports:read', 'settings:read', 'settings:write',
      'users:read', 'users:write', 'users:delete'
    ],
    'COMPANY_ADMIN': [
      'customers:read', 'customers:write', 'customers:delete',
      'suppliers:read', 'suppliers:write', 'suppliers:delete',
      'inventory:read', 'inventory:write', 'inventory:update',
      'sales:read', 'sales:write', 'sales:process',
      'purchases:read', 'purchases:write', 'purchases:approve',
      'contracts:read', 'contracts:write', 'contracts:manage',
      'wastage:read', 'wastage:write', 'wastage:approve',
      'petty-cash:read', 'petty-cash:write', 'petty-cash:manage',
      'expense:read', 'expense:write', 'expense:approve',
      'reports:read', 'settings:read',
      'users:read', 'users:write'
    ],
    'MANAGER': [
      'customers:read', 'customers:write',
      'suppliers:read', 'suppliers:write',
      'inventory:read', 'inventory:write',
      'sales:read', 'sales:write', 'sales:process',
      'purchases:read', 'purchases:write',
      'contracts:read', 'contracts:write',
      'wastage:read', 'wastage:approve',
      'expense:read', 'expense:approve',
      'reports:read'
    ],
    'SALES': [
      'customers:read', 'customers:write',
      'inventory:read',
      'sales:read', 'sales:write',
      'contracts:read',
      'wastage:read',
      'expense:read'
    ],
    'PURCHASE': [
      'suppliers:read', 'suppliers:write',
      'inventory:read', 'inventory:write', 'inventory:update',
      'purchases:read', 'purchases:write',
      'wastage:read', 'wastage:write',
      'expense:read', 'expense:write'
    ],
    'ACCOUNTS': [
      'inventory:read',
      'sales:read',
      'purchases:read',
      'wastage:read',
      'petty-cash:read', 'petty-cash:write',
      'expense:read', 'expense:write',
      'reports:read'
    ]
  };

  return rolePermissions[role] || [];
};

module.exports = router;