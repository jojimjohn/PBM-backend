const knex = require('knex');
const { logger } = require('../utils/logger');

// Database configuration for both companies
// PERFORMANCE: Optimized for 100+ concurrent users
const dbConfig = {
  client: 'mysql2',
  connection: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    charset: 'utf8mb4',
    // Connection timeout - fail fast to avoid hanging
    connectTimeout: parseInt(process.env.DB_CONNECT_TIMEOUT) || 10000,
    supportBigNumbers: true,
    bigNumberStrings: true,
    // IMPORTANT: Keep dates as strings to prevent timezone conversion issues
    // Without this, mysql2 converts date strings to JavaScript Date objects,
    // which causes UTC timezone shifts (dates saved as -1 day)
    dateStrings: true,
    // PERFORMANCE: Enable connection compression for large result sets
    compress: process.env.DB_COMPRESS === 'true',
    // PERFORMANCE: Allow multiple statements for batch operations
    multipleStatements: false, // Keep false for security
  },
  pool: {
    // PERFORMANCE: Pool sizing for 100 users
    // Formula: (concurrent_users × avg_queries_per_request) / 2
    // 100 users × 3 queries × 0.5 = 150, rounded up with headroom
    min: parseInt(process.env.DB_POOL_MIN) || 5,
    max: parseInt(process.env.DB_POOL_MAX) || 100,
    // PERFORMANCE: Faster timeout to fail fast and free resources
    createTimeoutMillis: parseInt(process.env.DB_CREATE_TIMEOUT) || 5000,
    acquireTimeoutMillis: parseInt(process.env.DB_ACQUIRE_TIMEOUT) || 10000,
    // PERFORMANCE: Release idle connections to free MySQL slots
    idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT) || 30000,
    reapIntervalMillis: 5000,
    createRetryIntervalMillis: 200, // Faster retry
    propagateCreateError: false,
    // PERFORMANCE: Validate connections before use to avoid stale connection errors
    afterCreate: (conn, done) => {
      conn.query('SELECT 1', (err) => {
        if (err) {
          logger.error('Connection validation failed', { error: err.message });
        }
        done(err, conn);
      });
    },
  },
  // PERFORMANCE: Query timeout to prevent long-running queries from blocking pool
  acquireConnectionTimeout: 10000,
  migrations: {
    tableName: 'knex_migrations',
    directory: './migrations'
  },
  seeds: {
    directory: './seeds'
  }
};

// Create database connections for both companies
const createConnection = (database) => {
  const connection = knex({
    ...dbConfig,
    connection: {
      ...dbConfig.connection,
      database
    }
  });

  // Test connection
  connection.raw('SELECT 1+1 as result')
    .then(() => {
      logger.info(`✅ Database connection successful: ${database}`);
    })
    .catch((err) => {
      logger.error(`❌ Database connection failed: ${database}`, { error: err.message });
    });

  return connection;
};

// Database connections
let alRamramiDb = null;
let prideMuscatDb = null;

// FIX (Jan 2026): Helper to add timeout to promises
const withTimeout = (promise, ms, operation) => {
  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`${operation} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]);
};

// Initialize database connections
const initializeDatabases = async () => {
  const DB_INIT_TIMEOUT = parseInt(process.env.DB_INIT_TIMEOUT) || 30000; // 30 seconds default

  try {
    console.log('[DB Init] Starting database initialization...');
    console.log('[DB Init] Host:', process.env.DB_HOST || 'localhost');
    console.log('[DB Init] Port:', process.env.DB_PORT || 3306);
    console.log('[DB Init] User:', process.env.DB_USER ? '***' : 'NOT SET');
    console.log('[DB Init] AL_RAMRAMI_DB:', process.env.AL_RAMRAMI_DB || 'NOT SET');
    console.log('[DB Init] PRIDE_MUSCAT_DB:', process.env.PRIDE_MUSCAT_DB || 'NOT SET');

    // Validate required env vars
    if (!process.env.DB_USER || !process.env.DB_PASSWORD) {
      throw new Error('DB_USER and DB_PASSWORD environment variables are required');
    }
    if (!process.env.AL_RAMRAMI_DB || !process.env.PRIDE_MUSCAT_DB) {
      throw new Error('AL_RAMRAMI_DB and PRIDE_MUSCAT_DB environment variables are required');
    }

    console.log('[DB Init] Creating main connection...');

    // Create databases if they don't exist
    const mainConnection = knex({
      ...dbConfig,
      connection: {
        ...dbConfig.connection,
        database: undefined // Connect without specifying database
      }
    });

    console.log('[DB Init] Testing connection...');

    // Test connection with timeout
    await withTimeout(
      mainConnection.raw('SELECT 1'),
      DB_INIT_TIMEOUT,
      'Database connection test'
    );

    console.log('[DB Init] Connection successful, creating databases...');

    // Create Al Ramrami database
    await withTimeout(
      mainConnection.raw(`CREATE DATABASE IF NOT EXISTS \`${process.env.AL_RAMRAMI_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`),
      DB_INIT_TIMEOUT,
      'Create AL_RAMRAMI_DB'
    );
    console.log('[DB Init] AL_RAMRAMI_DB ready');

    // Create Pride Muscat database
    await withTimeout(
      mainConnection.raw(`CREATE DATABASE IF NOT EXISTS \`${process.env.PRIDE_MUSCAT_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`),
      DB_INIT_TIMEOUT,
      'Create PRIDE_MUSCAT_DB'
    );
    console.log('[DB Init] PRIDE_MUSCAT_DB ready');

    await mainConnection.destroy();
    console.log('[DB Init] Main connection closed, initializing company connections...');

    // Initialize company-specific connections
    alRamramiDb = createConnection(process.env.AL_RAMRAMI_DB);
    prideMuscatDb = createConnection(process.env.PRIDE_MUSCAT_DB);

    // Skip migrations for now - tables already exist
    // await runSafeMigrations();

    logger.info('🗄️ Database initialization completed');
    console.log('[DB Init] ✅ Database initialization completed');

  } catch (error) {
    console.error('[DB Init] ❌ FAILED:', error.message);
    logger.error('❌ Database initialization failed', { error: error.message });
    throw error;
  }
};

// Safe migration runner - only applies new migrations
const runSafeMigrations = async () => {
  try {
    logger.info('🔄 Running database migrations...');
    
    // Run migrations for Al Ramrami database
    if (alRamramiDb) {
      await alRamramiDb.migrate.latest();
      logger.info('✅ Al Ramrami migrations completed');
    }
    
    // Run migrations for Pride Muscat database  
    if (prideMuscatDb) {
      await prideMuscatDb.migrate.latest();
      logger.info('✅ Pride Muscat migrations completed');
    }
    
  } catch (error) {
    logger.error('❌ Migration failed', { error: error.message });
    throw error;
  }
};

// Get database connection by company ID (requires kebab-case)
const getDbConnection = (companyId) => {
  if (companyId === 'al-ramrami') {
    return alRamramiDb;
  } else if (companyId === 'pride-muscat') {
    return prideMuscatDb;
  } else {
    throw new Error(`Invalid company ID: ${companyId}`);
  }
};

// Get database connection with company ID normalization
// Handles both camelCase (frontend) and kebab-case (backend) formats
const getDbConnectionByCompanyId = (companyId) => {
  // Normalize company ID (handle both formats)
  const normalizedId =
    companyId === 'alramrami' || companyId === 'al-ramrami'
      ? 'al-ramrami'
      : companyId === 'pridemuscat' || companyId === 'pride-muscat'
      ? 'pride-muscat'
      : companyId;

  return getDbConnection(normalizedId);
};

// Database health check
const healthCheck = async () => {
  const results = {};

  try {
    if (alRamramiDb) {
      await alRamramiDb.raw('SELECT 1');
      const pool = alRamramiDb.client.pool;
      results.alRamrami = {
        status: 'healthy',
        pool: {
          size: pool.numUsed() + pool.numFree(),
          used: pool.numUsed(),
          free: pool.numFree(),
          pending: pool.numPendingAcquires(),
          waiting: pool.numPendingCreates()
        }
      };
    }
  } catch (error) {
    results.alRamrami = { status: 'unhealthy', error: error.message };
    logger.error('Al Ramrami DB health check failed', { error: error.message });
  }

  try {
    if (prideMuscatDb) {
      await prideMuscatDb.raw('SELECT 1');
      const pool = prideMuscatDb.client.pool;
      results.prideMuscat = {
        status: 'healthy',
        pool: {
          size: pool.numUsed() + pool.numFree(),
          used: pool.numUsed(),
          free: pool.numFree(),
          pending: pool.numPendingAcquires(),
          waiting: pool.numPendingCreates()
        }
      };
    }
  } catch (error) {
    results.prideMuscat = { status: 'unhealthy', error: error.message };
    logger.error('Pride Muscat DB health check failed', { error: error.message });
  }

  return results;
};

// Graceful shutdown
const closeConnections = async () => {
  try {
    if (alRamramiDb) {
      await alRamramiDb.destroy();
      logger.info('Al Ramrami DB connection closed');
    }
    if (prideMuscatDb) {
      await prideMuscatDb.destroy();
      logger.info('Pride Muscat DB connection closed');
    }
  } catch (error) {
    logger.error('Error closing database connections', { error: error.message });
  }
};

module.exports = {
  initializeDatabases,
  getDbConnection,
  getDbConnectionByCompanyId,
  healthCheck,
  closeConnections,
  alRamramiDb: () => alRamramiDb,
  prideMuscatDb: () => prideMuscatDb
};