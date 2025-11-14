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

    // Get user permissions based on mapped role
    const permissions = await getUserPermissions(mappedRole, companyId);

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

    // Get user permissions
    const permissions = await getUserPermissions(mappedRole, user.companyId);

    // Generate new tokens
    const tokens = generateTokenPair(
      user.id,
      user.email,
      mappedRole,
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
  // In development mode, grant all permissions to make testing easier
  if (process.env.NODE_ENV === 'development') {
    console.log('🔓 DEVELOPMENT MODE: Granting all permissions to', role);
    return [
      // Customer permissions
      'VIEW_CUSTOMERS', 'CREATE_CUSTOMERS', 'EDIT_CUSTOMERS', 'DELETE_CUSTOMERS', 'MANAGE_CUSTOMERS',
      // Supplier permissions
      'VIEW_SUPPLIERS', 'CREATE_SUPPLIERS', 'EDIT_SUPPLIERS', 'DELETE_SUPPLIERS', 'MANAGE_SUPPLIERS',
      // Inventory permissions
      'VIEW_INVENTORY', 'UPDATE_INVENTORY', 'MANAGE_INVENTORY',
      // Sales permissions
      'VIEW_SALES', 'CREATE_SALES', 'PROCESS_SALES', 'EDIT_SALES', 'DELETE_SALES', 'APPROVE_SALES',
      // Purchase permissions
      'VIEW_PURCHASE', 'VIEW_PURCHASES', 'CREATE_PURCHASE', 'CREATE_PURCHASES', 'EDIT_PURCHASE', 'EDIT_PURCHASES',
      'DELETE_PURCHASE', 'DELETE_PURCHASES', 'APPROVE_PURCHASE', 'APPROVE_PURCHASES',
      // Invoice permissions
      'CREATE_INVOICES', 'VIEW_INVOICES', 'EDIT_INVOICES',
      // Contract permissions
      'VIEW_CONTRACTS', 'CREATE_CONTRACTS', 'EDIT_CONTRACTS', 'MANAGE_CONTRACTS', 'APPROVE_CONTRACTS',
      // Wastage permissions
      'VIEW_WASTAGE', 'CREATE_WASTAGE', 'EDIT_WASTAGE', 'DELETE_WASTAGE', 'APPROVE_WASTAGE',
      // Petty cash permissions
      'VIEW_PETTY_CASH', 'MANAGE_PETTY_CASH', 'CREATE_PETTY_CASH', 'EDIT_PETTY_CASH', 'RELOAD_CARD',
      // Expense permissions
      'VIEW_EXPENSE_REPORTS', 'CREATE_EXPENSE', 'EDIT_EXPENSE', 'DELETE_EXPENSE', 'APPROVE_EXPENSE',
      // Collections permissions
      'VIEW_COLLECTIONS', 'CREATE_COLLECTIONS', 'EDIT_COLLECTIONS', 'DELETE_COLLECTIONS', 'APPROVE_COLLECTIONS',
      // Material permissions
      'VIEW_MATERIALS', 'CREATE_MATERIALS', 'EDIT_MATERIALS', 'DELETE_MATERIALS',
      // Financial permissions
      'VIEW_FINANCIALS', 'MANAGE_EXPENSES', 'VIEW_PROFIT_LOSS',
      // Report permissions
      'VIEW_REPORTS', 'EXPORT_REPORTS', 'CREATE_CUSTOM_REPORTS',
      // Settings permissions
      'VIEW_SETTINGS', 'EDIT_SETTINGS', 'MANAGE_SETTINGS',
      // User permissions
      'MANAGE_USERS', 'VIEW_USERS', 'ASSIGN_ROLES',
      // Audit permissions
      'VIEW_AUDIT_LOGS'
    ];
  }

  // Production permissions based on roles using underscore format (matching route requirements)
  const rolePermissions = {
    'SUPER_ADMIN': [
      'VIEW_CUSTOMERS', 'CREATE_CUSTOMERS', 'EDIT_CUSTOMERS', 'DELETE_CUSTOMERS', 'MANAGE_CUSTOMERS',
      'VIEW_SUPPLIERS', 'CREATE_SUPPLIERS', 'EDIT_SUPPLIERS', 'DELETE_SUPPLIERS',
      'VIEW_INVENTORY', 'UPDATE_INVENTORY', 'MANAGE_INVENTORY',
      'VIEW_SALES', 'CREATE_SALES', 'PROCESS_SALES',
      'VIEW_PURCHASE', 'VIEW_PURCHASES', 'CREATE_PURCHASE', 'CREATE_PURCHASES', 'APPROVE_PURCHASE', 'APPROVE_PURCHASES',
      'CREATE_INVOICES', 'VIEW_INVOICES', 'EDIT_INVOICES',
      'VIEW_CONTRACTS', 'CREATE_CONTRACTS', 'EDIT_CONTRACTS', 'MANAGE_CONTRACTS',
      'VIEW_WASTAGE', 'CREATE_WASTAGE', 'EDIT_WASTAGE', 'APPROVE_WASTAGE',
      'VIEW_COLLECTIONS', 'CREATE_COLLECTIONS', 'EDIT_COLLECTIONS', 'DELETE_COLLECTIONS', 'APPROVE_COLLECTIONS',
      'VIEW_PETTY_CASH', 'MANAGE_PETTY_CASH',
      'VIEW_EXPENSE_REPORTS', 'CREATE_EXPENSE', 'APPROVE_EXPENSE',
      'VIEW_REPORTS', 'VIEW_SETTINGS', 'EDIT_SETTINGS',
      'MANAGE_USERS'
    ],
    'COMPANY_ADMIN': [
      'VIEW_CUSTOMERS', 'CREATE_CUSTOMERS', 'EDIT_CUSTOMERS', 'DELETE_CUSTOMERS', 'MANAGE_CUSTOMERS',
      'VIEW_SUPPLIERS', 'CREATE_SUPPLIERS', 'EDIT_SUPPLIERS', 'DELETE_SUPPLIERS', 'MANAGE_SUPPLIERS',
      'VIEW_INVENTORY', 'UPDATE_INVENTORY', 'MANAGE_INVENTORY',
      'VIEW_SALES', 'CREATE_SALES', 'EDIT_SALES', 'PROCESS_SALES',
      'VIEW_PURCHASE', 'VIEW_PURCHASES', 'CREATE_PURCHASE', 'CREATE_PURCHASES', 'EDIT_PURCHASE', 'APPROVE_PURCHASE', 'APPROVE_PURCHASES',
      'CREATE_INVOICES', 'VIEW_INVOICES', 'EDIT_INVOICES',
      'VIEW_CONTRACTS', 'CREATE_CONTRACTS', 'EDIT_CONTRACTS', 'MANAGE_CONTRACTS',
      'VIEW_WASTAGE', 'CREATE_WASTAGE', 'EDIT_WASTAGE', 'APPROVE_WASTAGE',
      'VIEW_COLLECTIONS', 'CREATE_COLLECTIONS', 'EDIT_COLLECTIONS', 'DELETE_COLLECTIONS', 'APPROVE_COLLECTIONS',
      'VIEW_PETTY_CASH', 'MANAGE_PETTY_CASH',
      'VIEW_EXPENSE_REPORTS', 'CREATE_EXPENSE', 'APPROVE_EXPENSE',
      'VIEW_REPORTS', 'VIEW_SETTINGS', 'EDIT_SETTINGS', 'MANAGE_SETTINGS',
      'MANAGE_USERS'
    ],
    'MANAGER': [
      'VIEW_CUSTOMERS', 'CREATE_CUSTOMERS', 'EDIT_CUSTOMERS',
      'VIEW_SUPPLIERS', 'CREATE_SUPPLIERS', 'EDIT_SUPPLIERS',
      'VIEW_INVENTORY', 'UPDATE_INVENTORY',
      'VIEW_SALES', 'CREATE_SALES', 'PROCESS_SALES',
      'VIEW_PURCHASE', 'VIEW_PURCHASES', 'CREATE_PURCHASE', 'CREATE_PURCHASES', 'APPROVE_PURCHASE',
      'CREATE_INVOICES', 'VIEW_INVOICES', 'EDIT_INVOICES',
      'VIEW_CONTRACTS', 'CREATE_CONTRACTS', 'EDIT_CONTRACTS',
      'VIEW_WASTAGE', 'APPROVE_WASTAGE',
      'VIEW_COLLECTIONS', 'CREATE_COLLECTIONS', 'EDIT_COLLECTIONS', 'APPROVE_COLLECTIONS',
      'VIEW_EXPENSE_REPORTS', 'APPROVE_EXPENSE',
      'VIEW_REPORTS'
    ],
    'SALES_STAFF': [
      'VIEW_CUSTOMERS', 'CREATE_CUSTOMERS', 'EDIT_CUSTOMERS', 'MANAGE_CUSTOMERS',
      'VIEW_INVENTORY',
      'VIEW_SALES', 'CREATE_SALES',
      'CREATE_INVOICES', 'VIEW_INVOICES', 'EDIT_INVOICES',
      'VIEW_CONTRACTS',
      'VIEW_WASTAGE',
      'VIEW_EXPENSE_REPORTS'
    ],
    'PURCHASE_STAFF': [
      'VIEW_SUPPLIERS', 'CREATE_SUPPLIERS', 'EDIT_SUPPLIERS',
      'VIEW_INVENTORY', 'UPDATE_INVENTORY',
      'VIEW_PURCHASE', 'VIEW_PURCHASES', 'CREATE_PURCHASE', 'CREATE_PURCHASES',
      'VIEW_WASTAGE', 'CREATE_WASTAGE', 'EDIT_WASTAGE',
      'VIEW_EXPENSE_REPORTS', 'CREATE_EXPENSE'
    ],
    'ACCOUNTS_STAFF': [
      'VIEW_INVENTORY',
      'VIEW_SALES',
      'VIEW_PURCHASE', 'VIEW_PURCHASES',
      'VIEW_WASTAGE',
      'VIEW_PETTY_CASH', 'MANAGE_PETTY_CASH',
      'VIEW_EXPENSE_REPORTS', 'CREATE_EXPENSE',
      'VIEW_REPORTS'
    ]
  };

  return rolePermissions[role] || [];
};

// Debug endpoint to check token permissions
router.get('/debug-token', async (req, res) => {
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