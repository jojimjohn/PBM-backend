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
const { authenticateToken } = require('./middleware/auth');
const { initializeDatabases, healthCheck } = require('./config/database');

const app = express();
const PORT = process.env.PORT || 5000;

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 10000, // limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests from this IP, please try again later.',
    retryAfter: Math.ceil((parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000) / 1000)
  },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, etc.)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://localhost:5173',
      'http://127.0.0.1:5173'
    ];
    
    if (process.env.NODE_ENV === 'production') {
      // Add production origins here
      allowedOrigins.push('https://pbm-git-main-jojimjohns-projects.vercel.app');
      allowedOrigins.push('https://pbm-one.vercel.app');
      allowedOrigins.push('http://localhost:3000');
    }
    
    // Check if origin is in allowed list or is a Vercel deployment
    const isAllowed = allowedOrigins.indexOf(origin) !== -1 || 
                     (origin && origin.endsWith('.vercel.app'));
    
    if (isAllowed) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With','accept','origin'],
  exposedHeaders: ['X-Total-Count'],
  allowedOrigins: ['*']
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
app.use('/api/auth', authRoutes);

// Protected routes (require authentication)
app.use('/api', authenticateToken);

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
app.use('/api/expenses', expensesRoutes);
app.use('/api/wastages', wastagesRoutes);
app.use('/api/petty-cash-cards', pettyCashCardsRoutes);
app.use('/api/petty-cash-expenses', pettyCashExpensesRoutes);
app.use('/api/transactions', transactionsRoutes);
app.use('/api/backups', backupsRoutes);
app.use('/api/supplier-locations', supplierLocationsRoutes);

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
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  process.exit(0);
});

// Initialize databases and start server
const startServer = async () => {
  try {
    // Initialize database connections
    await initializeDatabases();
    logger.info('✅ Database connections initialized');

    // Start server
    app.listen(PORT, () => {
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