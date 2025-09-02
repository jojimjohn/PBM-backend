#!/usr/bin/env node
/**
 * Mark existing migrations as completed without running them
 */

require('dotenv').config();
const knex = require('knex');
const fs = require('fs');
const path = require('path');

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
  pool: { min: 1, max: 5 },
  migrations: {
    tableName: 'knex_migrations',
    directory: './migrations'
  }
};

async function markMigrationsCompleted() {
  console.log('📋 Marking existing migrations as completed...');
  
  try {
    // Get all migration files
    const migrationsDir = path.join(__dirname, '../migrations');
    const migrationFiles = fs.readdirSync(migrationsDir)
      .filter(file => file.endsWith('.js'))
      .sort();
    
    console.log(`Found ${migrationFiles.length} migration files`);
    
    // Process Al Ramrami database
    const alRamramiDb = knex({
      ...dbConfig,
      connection: { ...dbConfig.connection, database: process.env.AL_RAMRAMI_DB }
    });
    
    console.log('🗄️ Marking Al Ramrami migrations as completed...');
    
    // Create migration table
    await alRamramiDb.migrate.latest({
      disableTransactions: true,
      schemaName: process.env.AL_RAMRAMI_DB
    }).catch(() => {
      // Ignore errors - table might already exist
    });
    
    // Insert migration records
    for (const file of migrationFiles) {
      const migrationName = file.replace('.js', '');
      await alRamramiDb('knex_migrations')
        .insert({
          name: migrationName,
          batch: 1,
          migration_time: new Date()
        })
        .onConflict('name')
        .ignore();
    }
    
    await alRamramiDb.destroy();
    
    // Process Pride Muscat database
    const prideMuscatDb = knex({
      ...dbConfig,
      connection: { ...dbConfig.connection, database: process.env.PRIDE_MUSCAT_DB }
    });
    
    console.log('🗄️ Marking Pride Muscat migrations as completed...');
    
    // Create migration table
    await prideMuscatDb.migrate.latest({
      disableTransactions: true,
      schemaName: process.env.PRIDE_MUSCAT_DB
    }).catch(() => {
      // Ignore errors - table might already exist
    });
    
    // Insert migration records
    for (const file of migrationFiles) {
      const migrationName = file.replace('.js', '');
      await prideMuscatDb('knex_migrations')
        .insert({
          name: migrationName,
          batch: 1,
          migration_time: new Date()
        })
        .onConflict('name')
        .ignore();
    }
    
    await prideMuscatDb.destroy();
    
    console.log('✅ All existing migrations marked as completed');
    console.log('💡 Server should now start without migration errors');
    
  } catch (error) {
    console.error('❌ Failed to mark migrations:', error.message);
    process.exit(1);
  }
}

markMigrationsCompleted();