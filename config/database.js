const knex = require('knex');
const { logger } = require('../utils/logger');

// Database configuration for both companies
const dbConfig = {
  client: 'mysql2',
  connection: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    charset: 'utf8mb4',
    // Remove invalid MySQL2 options
    connectTimeout: 60000,
    supportBigNumbers: true,
    bigNumberStrings: true,
  },
  pool: {
    min: 2,
    max: 20, // Increased from 5 to handle concurrent requests
    createTimeoutMillis: 10000,
    acquireTimeoutMillis: 30000, // Reduced from 60s to fail faster
    idleTimeoutMillis: 30000, // Reduced from 600s to release idle connections quicker
    reapIntervalMillis: 10000,
    createRetryIntervalMillis: 500,
  },
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

// Initialize database connections
const initializeDatabases = async () => {
  try {
    // Create databases if they don't exist
    const mainConnection = knex({
      ...dbConfig,
      connection: {
        ...dbConfig.connection,
        database: undefined // Connect without specifying database
      }
    });

    // Create Al Ramrami database
    await mainConnection.raw(`CREATE DATABASE IF NOT EXISTS \`${process.env.AL_RAMRAMI_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    
    // Create Pride Muscat database
    await mainConnection.raw(`CREATE DATABASE IF NOT EXISTS \`${process.env.PRIDE_MUSCAT_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    
    await mainConnection.destroy();

    // Initialize company-specific connections
    alRamramiDb = createConnection(process.env.AL_RAMRAMI_DB);
    prideMuscatDb = createConnection(process.env.PRIDE_MUSCAT_DB);

    // Skip migrations for now - tables already exist
    // await runSafeMigrations();

    logger.info('🗄️ Database initialization completed');
    
  } catch (error) {
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