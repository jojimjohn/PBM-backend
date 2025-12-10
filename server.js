const express = require('express');
const cors = require('cors');

const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const { logger } = require('./utils/logger');
const errorHandler = require('./middleware/errorHandler');
const authRoutes = require('./routes/auth');
const customersRoutes = require('./routes/customers');
const materialsRoutes = require('./routes/materials');
const inventoryRoutes = require('./routes/inventory');
const suppliersRoutes = require('./routes/suppliers');
const contractsRoutes = require('./routes/contracts');
const supplierContractsRoutes = require('./routes/supplierContracts');
const contractLocationsRoutes = require('./routes/contractLocations');
const calloutsRoutes = require('./routes/callouts');
const collectionOrdersRoutes = require('./routes/collectionOrders');
const salesOrdersRoutes = require('./routes/salesOrders');
const purchaseOrdersRoutes = require('./routes/purchaseOrders');
const expensesRoutes = require('./routes/expenses');
const wastagesRoutes = require('./routes/wastages');
const pettyCashCardsRoutes = require('./routes/pettyCashCards');
const pettyCashExpensesRoutes = require('./routes/pettyCashExpenses');
const transactionsRoutes = require('./routes/transactions');
const backupsRoutes = require('./routes/backups');
const supplierLocationsRoutes = require('./routes/supplierLocations');
const usersRoutes = require('./routes/users');
const systemSettingsRoutes = require('./routes/systemSettings');
const customerTypesRoutes = require('./routes/customerTypes');
const supplierTypesRoutes = require('./routes/supplierTypes');
const branchesRoutes = require('./routes/branches');
const materialCompositionsRoutes = require('./routes/materialCompositions');
const purchaseOrderAmendmentsRoutes = require('./routes/purchaseOrderAmendments');
const purchaseInvoicesRoutes = require('./routes/purchaseInvoices');
const uploadRoutes = require('./routes/uploadRoutes');
const purchaseOrderExpensesRoutes = require('./routes/purchaseOrderExpenses');
const workflowRoutes = require('./routes/workflow');
const reportsRoutes = require('./routes/reports');
const bankAccountsRoutes = require('./routes/bankAccounts');
const bankTransactionsRoutes = require('./routes/bankTransactions');
const inventoryBatchesRoutes = require('./routes/inventoryBatches');
const rolesRoutes = require('./routes/roles');
const { authenticateToken } = require('./middleware/auth');
const { checkSessionTimeout } = require('./middleware/sessionTimeout');
const { validateCsrfToken, ensureCsrfToken } = require('./middleware/csrf');
const { initializeDatabases, closeConnections, healthCheck } = require('./config/database');

const app = express();
const PORT = process.env.PORT || 5000;

app.set('trust proxy', 1);


// Security middleware - SECURITY FIX: Hardened CSP headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],  // SECURITY: Removed 'unsafe-inline' - use external stylesheets
      imgSrc: ["'self'", "data:", "blob:"],
      fontSrc: ["'self'"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: []
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  crossOriginEmbedderPolicy: false,  // Allow loading cross-origin assets
  crossOriginResourcePolicy: { policy: "cross-origin" }  // Allow resources to be loaded cross-origin
}));

// Rate limiting - Increased 10x for internal use
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 1000,                  // 1000 requests per window (10x for internal use)
  message: {
    error: 'Too many requests from this IP, please try again later.',
    code: 'RATE_LIMITED',
    retryAfter: 900
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next, options) => {
    logger.warn('Rate limit exceeded', {
      ip: req.ip,
      path: req.path,
      limit: options.max
    });
    res.status(429).json(options.message);
  }
});

// Rate limiter for authentication endpoints (100 attempts/15min - 10x for internal use)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 100,                   // 100 login attempts per window (10x for internal use)
  message: {
    error: 'Too many login attempts. Please try again in 15 minutes.',
    code: 'AUTH_RATE_LIMITED',
    retryAfter: 900
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next, options) => {
    logger.warn('Auth rate limit exceeded', {
      ip: req.ip,
      email: req.body?.email ? req.body.email.substring(0, 3) + '***' : 'unknown'
    });
    res.status(429).json(options.message);
  }
});

// Rate limiter for MFA verification (50 attempts/15min - 10x for internal use)
const mfaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 50,                    // 50 MFA attempts per window (10x for internal use)
  message: {
    error: 'Too many MFA attempts. Please try again in 15 minutes.',
    code: 'MFA_RATE_LIMITED',
    retryAfter: 900
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next, options) => {
    logger.warn('MFA rate limit exceeded', { ip: req.ip });
    res.status(429).json(options.message);
  }
});

app.use(globalLimiter);

// CORS configuration - SECURITY FIX: Proper origin validation
const corsOptions = {
  origin: function (origin, callback) {
    // Build allowed origins list from environment or defaults
    const envOrigins = process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : [];
    const allowedOrigins = [
      ...envOrigins,
      'https://pbm.alramramiapp.com'
    ];

    // In development, allow localhost variants
    if (process.env.NODE_ENV !== 'production') {
      allowedOrigins.push(
        'http://localhost:3000',
        'http://localhost:3001',
        'http://localhost:5173',
        'http://127.0.0.1:3000',
        'http://127.0.0.1:5173',
        
      );
    }

    // Allow requests with no origin (same-origin, mobile apps, Postman)
    if (!origin) {
      return callback(null, true);
    }

    // Strict origin validation - SECURITY: No wildcard fallback
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      logger.warn('CORS blocked request', {
        blockedOrigin: origin,
        allowedOrigins: allowedOrigins.filter(o => !o.includes('localhost'))
      });
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,  // Required for cookie-based authentication
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin', 'X-CSRF-Token'],
  exposedHeaders: ['X-Total-Count']
};

app.use(cors(corsOptions));
app.use(compression());
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    timestamp: new Date().toISOString()
  });
  next();
});

// Health check endpoint
app.get('/health', async (req, res) => {
  const dbHealth = await healthCheck();
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: process.env.npm_package_version || '1.0.0',
    database: dbHealth
  });
});

// API Routes
// Apply strict rate limiters to authentication endpoints
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/mfa', mfaLimiter);
app.use('/api/auth', authRoutes);

// Protected routes (require authentication + session timeout check + CSRF validation)
app.use('/api', authenticateToken);
app.use('/api', checkSessionTimeout);
app.use('/api', validateCsrfToken);  // SECURITY: Validate CSRF token on POST/PUT/PATCH/DELETE

// Business entity routes
app.use('/api/customers', customersRoutes);
app.use('/api/materials', materialsRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/suppliers', suppliersRoutes);
app.use('/api/contracts', contractsRoutes);
app.use('/api/supplier-contracts', supplierContractsRoutes);
app.use('/api/contract-locations', contractLocationsRoutes);
app.use('/api/callouts', calloutsRoutes);
app.use('/api/collection-orders', collectionOrdersRoutes);
app.use('/api/sales-orders', salesOrdersRoutes);
app.use('/api/purchase-orders', purchaseOrdersRoutes);
app.use('/api/purchase-orders', purchaseOrderExpensesRoutes);
app.use('/api/purchase-orders', purchaseOrderExpensesRoutes);
app.use('/api/expenses', expensesRoutes);
app.use('/api/wastages', wastagesRoutes);
app.use('/api/petty-cash-cards', pettyCashCardsRoutes);
app.use('/api/petty-cash-expenses', pettyCashExpensesRoutes);
app.use('/api/transactions', transactionsRoutes);
app.use('/api/backups', backupsRoutes);
app.use('/api/workflow', workflowRoutes);
app.use('/api/supplier-locations', supplierLocationsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/roles', rolesRoutes);
app.use('/api/system-settings', systemSettingsRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/customer-types', customerTypesRoutes);
app.use('/api/supplier-types', supplierTypesRoutes);
app.use('/api/branches', branchesRoutes);
app.use('/api/material-compositions', materialCompositionsRoutes);
app.use('/api/purchase-order-amendments', purchaseOrderAmendmentsRoutes);
app.use('/api/purchase-invoices', purchaseInvoicesRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/bank-accounts', bankAccountsRoutes);
app.use('/api/bank-transactions', bankTransactionsRoutes);
app.use('/api/inventory-batches', inventoryBatchesRoutes);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ 
    error: 'Endpoint not found',
    path: req.originalUrl,
    method: req.method
  });
});

// Global error handler
app.use(errorHandler);

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  await closeConnections();
  logger.info('Database connections closed');
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  await closeConnections();
  logger.info('Database connections closed');
  process.exit(0);
});

// Initialize databases and start server
const startServer = async () => {
  try {
    // Initialize database connections
    await initializeDatabases();
    logger.info('✅ Database connections initialized');

    // Start server
    app.listen(PORT, '0.0.0.0', () => {
      logger.info(`🚀 Server running on port ${PORT}`, {
        environment: process.env.NODE_ENV,
        port: PORT,
        timestamp: new Date().toISOString()
      });
    });
  } catch (error) {
    logger.error('❌ Failed to start server', { error: error.message, stack: error.stack });
    process.exit(1);
  }
};

startServer();

module.exports = app;