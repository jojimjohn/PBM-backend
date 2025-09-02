require('dotenv').config();
const knex = require('knex');
const fs = require('fs');
const path = require('path');

// Company configurations from companies.json
const companies = {
  'al-ramrami': {
    name: 'Al Ramrami Trading',
    database: process.env.AL_RAMRAMI_DB,
    modules: ["dashboard", "customers", "inventory", "sales", "purchase", "contracts", "wastage", "petty-cash", "reports", "settings"]
  },
  'pride-muscat': {
    name: 'Pride Muscat International',
    database: process.env.PRIDE_MUSCAT_DB,  
    modules: ["dashboard", "suppliers", "inventory", "sales", "purchase", "wastage", "petty-cash", "reports", "settings"]
  }
};

// Module to table mapping
const moduleTableMapping = {
  'customers': ['customers'],
  'suppliers': ['suppliers'],
  'inventory': ['materials', 'inventory'],
  'sales': ['sales_orders', 'sales_order_items'],
  'purchase': ['purchase_orders', 'purchase_order_items'],
  'contracts': ['contracts', 'contract_rates'],
  'wastage': ['wastages'],
  'petty-cash': ['petty_cash_cards', 'petty_cash_expenses'],
  'core': ['users', 'transactions'], // Always needed
};

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
  pool: { min: 2, max: 10 }
};

// Get all migration files
function getAllMigrationFiles() {
  const migrationsDir = path.join(__dirname, 'migrations');
  return fs.readdirSync(migrationsDir)
    .filter(file => file.endsWith('.js'))
    .sort();
}

// Map migration files to their tables
function getMigrationTableMap() {
  const migrations = getAllMigrationFiles();
  const migrationMap = {};
  
  migrations.forEach(file => {
    const tableName = file.replace(/^\d+_create_(.+)_table\.js$/, '$1');
    migrationMap[file] = tableName.replace(/_/g, '_');
  });
  
  return migrationMap;
}

// Get required tables for a company based on enabled modules
function getRequiredTablesForCompany(companyModules) {
  const requiredTables = new Set();
  
  // Always add core tables
  moduleTableMapping.core.forEach(table => requiredTables.add(table));
  
  // Add tables for enabled modules
  companyModules.forEach(module => {
    if (moduleTableMapping[module]) {
      moduleTableMapping[module].forEach(table => requiredTables.add(table));
    }
  });
  
  return Array.from(requiredTables);
}

// Get migration files needed for required tables
function getRequiredMigrationsForTables(requiredTables) {
  const migrationMap = getMigrationTableMap();
  const requiredMigrations = [];
  
  Object.entries(migrationMap).forEach(([migrationFile, tableName]) => {
    if (requiredTables.includes(tableName)) {
      requiredMigrations.push(migrationFile);
    }
  });
  
  return requiredMigrations.sort();
}

async function recreateDatabaseSchema(companyId, companyConfig) {
  console.log(`\n🔄 Creating module-based schema for ${companyConfig.name}...`);
  
  const db = knex({
    ...dbConfig,
    connection: {
      ...dbConfig.connection,
      database: companyConfig.database
    }
  });

  try {
    // Get required tables based on enabled modules
    const requiredTables = getRequiredTablesForCompany(companyConfig.modules);
    console.log(`   📊 Modules: ${companyConfig.modules.join(', ')}`);
    console.log(`   📋 Required tables: ${requiredTables.join(', ')}`);
    
    // Drop all existing tables (except knex migration tables)
    console.log(`   🗑️ Cleaning existing schema...`);
    const existingTables = await db.raw('SHOW TABLES');
    const tableNames = existingTables[0]
      .map(row => Object.values(row)[0])
      .filter(name => !name.startsWith('knex_migrations'));
    
    // Drop tables with foreign key constraints disabled
    await db.raw('SET FOREIGN_KEY_CHECKS = 0');
    
    for (const table of tableNames) {
      await db.raw(`DROP TABLE IF EXISTS \`${table}\``);
      console.log(`     - Dropped ${table}`);
    }
    
    await db.raw('SET FOREIGN_KEY_CHECKS = 1');
    
    // Reset migration status
    await db('knex_migrations').del();
    
    // Get required migrations for this company's modules
    const requiredMigrations = getRequiredMigrationsForTables(requiredTables);
    console.log(`   📦 Required migrations: ${requiredMigrations.length}`);
    
    // Run only the required migrations
    for (const migrationFile of requiredMigrations) {
      const migration = require(path.join(__dirname, 'migrations', migrationFile));
      await migration.up(db);
      
      // Record migration in knex_migrations table
      await db('knex_migrations').insert({
        name: migrationFile,
        batch: 1,
        migration_time: new Date()
      });
      
      console.log(`     ✅ ${migrationFile}`);
    }
    
    // Verify final table structure
    const finalTables = await db.raw('SHOW TABLES');
    const finalTableNames = finalTables[0]
      .map(row => Object.values(row)[0])
      .filter(name => !name.startsWith('knex_migrations'));
      
    console.log(`   ✅ Final schema: ${finalTableNames.length} tables created`);
    console.log(`   📋 Tables: ${finalTableNames.join(', ')}`);
    
    return { success: true, tables: finalTableNames };
    
  } catch (error) {
    console.error(`   ❌ Error: ${error.message}`);
    throw error;
  } finally {
    await db.destroy();
  }
}

async function createModularDatabaseSchemas() {
  console.log('🏗️ Creating Module-Based Database Schemas...\n');
  
  try {
    const results = {};
    
    for (const [companyId, companyConfig] of Object.entries(companies)) {
      results[companyId] = await recreateDatabaseSchema(companyId, companyConfig);
    }
    
    console.log('\n🎉 Module-based database schemas created successfully!\n');
    
    console.log('📊 Company-Specific Database Summary:');
    Object.entries(results).forEach(([companyId, result]) => {
      const company = companies[companyId];
      console.log(`\n🏢 ${company.name}:`);
      console.log(`   Database: ${company.database}`);
      console.log(`   Modules: ${company.modules.length} enabled`);
      console.log(`   Tables: ${result.tables.length} created`);
      console.log(`   Schema: ${result.tables.join(', ')}`);
    });
    
    console.log('\n✅ Multi-tenant architecture now properly reflects business requirements!');
    
  } catch (error) {
    console.error('\n❌ Schema creation failed:', error.message);
    process.exit(1);
  }
}

createModularDatabaseSchemas();