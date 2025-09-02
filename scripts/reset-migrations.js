#!/usr/bin/env node
/**
 * Reset Migration Table - Fix corrupted migration records
 */

require('dotenv').config();
const knex = require('knex');

const dbConfig = {
  client: 'mysql2',
  connection: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    charset: 'utf8mb4',
    connectTimeout: 60000,
    supportBigNumbers: true,
    bigNumberStrings: true,
  },
  pool: { min: 1, max: 5 }
};

async function resetMigrations() {
  console.log('🔧 Resetting migration tables...');
  
  try {
    // Reset Al Ramrami database
    const alRamramiDb = knex({
      ...dbConfig,
      connection: { ...dbConfig.connection, database: process.env.AL_RAMRAMI_DB }
    });
    
    console.log('🗄️ Cleaning Al Ramrami migration records...');
    await alRamramiDb.raw('DROP TABLE IF EXISTS knex_migrations');
    await alRamramiDb.raw('DROP TABLE IF EXISTS knex_migrations_lock');
    await alRamramiDb.destroy();
    
    // Reset Pride Muscat database
    const prideMuscatDb = knex({
      ...dbConfig,
      connection: { ...dbConfig.connection, database: process.env.PRIDE_MUSCAT_DB }
    });
    
    console.log('🗄️ Cleaning Pride Muscat migration records...');
    await prideMuscatDb.raw('DROP TABLE IF EXISTS knex_migrations');
    await prideMuscatDb.raw('DROP TABLE IF EXISTS knex_migrations_lock');
    await prideMuscatDb.destroy();
    
    console.log('✅ Migration tables reset successfully');
    console.log('💡 Run "node server.js" to apply fresh migrations');
    
  } catch (error) {
    console.error('❌ Failed to reset migrations:', error.message);
    process.exit(1);
  }
}

resetMigrations();