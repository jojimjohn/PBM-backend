// Load environment variables FIRST
require('dotenv').config();

const { initializeDatabases, getDbConnection } = require('../config/database');
const { logger } = require('../utils/logger');
const knex = require('knex');
const knexConfig = require('../knexfile');

const setup = async () => {
  try {
    console.log('🚀 Starting database setup...');
    
    // Debug: Show loaded environment variables
    console.log('📋 Environment Variables:');
    console.log(`   DB_HOST: ${process.env.DB_HOST}`);
    console.log(`   DB_USER: ${process.env.DB_USER}`);
    console.log(`   DB_PASSWORD: ${process.env.DB_PASSWORD ? '[PROVIDED]' : '[MISSING]'}`);
    console.log(`   AL_RAMRAMI_DB: ${process.env.AL_RAMRAMI_DB}`);
    console.log(`   PRIDE_MUSCAT_DB: ${process.env.PRIDE_MUSCAT_DB}`);
    console.log('');

    // Initialize databases
    await initializeDatabases();
    console.log('✅ Databases created successfully');

    // Run migrations for both company databases
    console.log('📦 Running migrations for Al Ramrami...');
    const alRamramiConfig = {
      ...knexConfig.development,
      connection: {
        ...knexConfig.development.connection,
        database: process.env.AL_RAMRAMI_DB
      }
    };
    const alRamramiKnex = knex(alRamramiConfig);
    await alRamramiKnex.migrate.latest();
    console.log('✅ Al Ramrami migrations completed');

    console.log('📦 Running migrations for Pride Muscat...');
    const prideMuscatConfig = {
      ...knexConfig.development,
      connection: {
        ...knexConfig.development.connection,
        database: process.env.PRIDE_MUSCAT_DB
      }
    };
    const prideMuscatKnex = knex(prideMuscatConfig);
    await prideMuscatKnex.migrate.latest();
    console.log('✅ Pride Muscat migrations completed');

    // Run seeds for both databases
    console.log('🌱 Seeding Al Ramrami database...');
    await alRamramiKnex.seed.run();
    console.log('✅ Al Ramrami seeding completed');

    console.log('🌱 Seeding Pride Muscat database...');
    await prideMuscatKnex.seed.run();
    console.log('✅ Pride Muscat seeding completed');

    // Clean up connections
    await alRamramiKnex.destroy();
    await prideMuscatKnex.destroy();

    console.log('🎉 Database setup completed successfully!');
    console.log('');
    console.log('📧 Default admin credentials:');
    console.log('   Al Ramrami: admin@alramrami.com');
    console.log('   Pride Muscat: admin@pridemuscat.com');
    console.log('   Password: pass123!');
    console.log('');
    console.log('⚠️  IMPORTANT: Change default passwords in production!');
    
  } catch (error) {
    console.error('❌ Database setup failed:', error.message);
    logger.error('Database setup failed', { error: error.message, stack: error.stack });
    process.exit(1);
  }
};

// Run setup if called directly
if (require.main === module) {
  setup();
}

module.exports = setup;