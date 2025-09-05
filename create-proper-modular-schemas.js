require('dotenv').config();
const knex = require('knex');
const fs = require('fs');
const path = require('path');

// Company configurations matching companies.json
const companies = {
  'al-ramrami': {
    name: 'Al Ramrami Trading',
    database: process.env.AL_RAMRAMI_DB,
    modules: ["dashboard", "customers", "suppliers", "inventory", "sales", "purchase", "contracts", "wastage", "petty-cash", "reports", "settings"]
  },
  'pride-muscat': {
    name: 'Pride Muscat International',
    database: process.env.PRIDE_MUSCAT_DB,  
    modules: ["dashboard", "suppliers", "inventory", "sales", "purchase", "wastage", "petty-cash", "reports", "settings"]
  }
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

// Define what tables each module needs
const moduleTableDefinitions = {
  // Core tables - always needed (handled separately for order dependency)
  core: [],
  
  // Module-specific tables
  customers: [
    { name: 'customers', migration: '002_create_customers_table.js' }
  ],
  
  suppliers: [
    { name: 'suppliers', migration: '003_create_suppliers_table.js' }
  ],
  
  inventory: [
    { name: 'materials', migration: '004_create_materials_table.js' },
    { name: 'inventory', migration: '005_create_inventory_table.js' }
  ],
  
  contracts: [
    { name: 'contracts', migration: '006_create_contracts_table.js' },
    { name: 'contract_rates', migration: '007_create_contract_rates_table.js' }
  ],
  
  sales: [
    // Use flexible version that doesn't require customers table
    { name: 'sales_orders', migration: 'flexible/008_create_sales_orders_flexible.js' },
    { name: 'sales_order_items', migration: '009_create_sales_order_items_table.js' }
  ],
  
  purchase: [
    // Use flexible version that doesn't require suppliers table
    { name: 'purchase_orders', migration: 'flexible/010_create_purchase_orders_flexible.js' },
    { name: 'purchase_order_items', migration: '011_create_purchase_order_items_table.js' }
  ],
  
  wastage: [
    { name: 'wastages', migration: '012_create_wastages_table.js' }
  ],
  
  'petty-cash': [
    { name: 'petty_cash_cards', migration: '013_create_petty_cash_cards_table.js' },
    { name: 'petty_cash_expenses', migration: '014_create_petty_cash_expenses_table.js' }
  ]
};

// Copy flexible migrations to regular migrations directory
function setupFlexibleMigrations() {
  const flexibleDir = path.join(__dirname, 'migrations-flexible');
  const migrationsDir = path.join(__dirname, 'migrations');
  
  if (!fs.existsSync(path.join(migrationsDir, 'flexible'))) {
    fs.mkdirSync(path.join(migrationsDir, 'flexible'), { recursive: true });
  }
  
  // Copy flexible migration files
  const flexibleFiles = fs.readdirSync(flexibleDir);
  flexibleFiles.forEach(file => {
    const sourcePath = path.join(flexibleDir, file);
    const destPath = path.join(migrationsDir, 'flexible', file);
    fs.copyFileSync(sourcePath, destPath);
    console.log(`   📋 Copied ${file} to migrations/flexible/`);
  });
}

async function createModularSchema(companyId, companyConfig) {
  console.log(`\n🔄 Creating modular schema for ${companyConfig.name}...`);
  
  const db = knex({
    ...dbConfig,
    connection: {
      ...dbConfig.connection,
      database: companyConfig.database
    }
  });

  try {
    // Determine required migrations based on enabled modules
    const requiredMigrations = [];
    
    // Add users table first (needed for foreign keys)
    requiredMigrations.push({ 
      file: '001_create_users_table.js', 
      table: 'users', 
      module: 'core' 
    });
    
    // Add module-specific tables
    companyConfig.modules.forEach(moduleName => {
      if (moduleTableDefinitions[moduleName]) {
        moduleTableDefinitions[moduleName].forEach(table => {
          requiredMigrations.push({ 
            file: table.migration, 
            table: table.name, 
            module: moduleName 
          });
        });
      }
    });
    
    // Add transactions table last (references other tables)
    requiredMigrations.push({ 
      file: '015_create_transactions_table.js', 
      table: 'transactions', 
      module: 'core' 
    });
    
    console.log(`   📊 Enabled modules: ${companyConfig.modules.join(', ')}`);
    console.log(`   📋 Required tables: ${requiredMigrations.map(m => m.table).join(', ')}`);
    console.log(`   📦 Migrations needed: ${requiredMigrations.length}`);
    
    // Clean existing schema
    console.log(`   🗑️ Cleaning existing schema...`);
    const existingTables = await db.raw('SHOW TABLES');
    const tableNames = existingTables[0]
      .map(row => Object.values(row)[0])
      .filter(name => !name.startsWith('knex_migrations'));
    
    if (tableNames.length > 0) {
      await db.raw('SET FOREIGN_KEY_CHECKS = 0');
      for (const table of tableNames) {
        await db.raw(`DROP TABLE IF EXISTS \`${table}\``);
        console.log(`     - Dropped ${table}`);
      }
      await db.raw('SET FOREIGN_KEY_CHECKS = 1');
    }
    
    // Reset migration status
    await db('knex_migrations').del();
    
    // Run required migrations
    console.log(`   🔄 Running migrations...`);
    for (const migration of requiredMigrations) {
      try {
        const migrationPath = path.join(__dirname, 'migrations', migration.file);
        const migrationModule = require(migrationPath);
        await migrationModule.up(db);
        
        // Record migration
        await db('knex_migrations').insert({
          name: migration.file,
          batch: 1,
          migration_time: new Date()
        });
        
        console.log(`     ✅ ${migration.table} (${migration.module})`);
      } catch (error) {
        console.log(`     ❌ ${migration.table} failed: ${error.message}`);
        throw error;
      }
    }
    
    // Verify final schema
    const finalTables = await db.raw('SHOW TABLES');
    const finalTableNames = finalTables[0]
      .map(row => Object.values(row)[0])
      .filter(name => !name.startsWith('knex_migrations'));
      
    console.log(`   ✅ Schema complete: ${finalTableNames.length} tables`);
    
    return { 
      success: true, 
      tables: finalTableNames,
      modules: companyConfig.modules 
    };
    
  } catch (error) {
    console.error(`   ❌ Error: ${error.message}`);
    throw error;
  } finally {
    await db.destroy();
  }
}

async function main() {
  console.log('🏗️ Creating Proper Modular Database Schemas...\n');
  
  try {
    // Setup flexible migrations
    console.log('📋 Setting up flexible migrations...');
    setupFlexibleMigrations();
    
    // Create schemas for each company
    const results = {};
    for (const [companyId, companyConfig] of Object.entries(companies)) {
      results[companyId] = await createModularSchema(companyId, companyConfig);
    }
    
    console.log('\n🎉 Modular database schemas created successfully!\n');
    
    // Show summary
    console.log('📊 Final Multi-Tenant Architecture:\n');
    Object.entries(results).forEach(([companyId, result]) => {
      const company = companies[companyId];
      console.log(`🏢 ${company.name}:`);
      console.log(`   Database: ${company.database}`);
      console.log(`   Modules: ${result.modules.length} enabled (${result.modules.join(', ')})`);
      console.log(`   Tables: ${result.tables.length} created`);
      console.log(`   Schema: ${result.tables.join(', ')}\n`);
    });
    
    console.log('✅ Architecture now properly reflects business requirements!');
    console.log('   - Al Ramrami: Has customers, suppliers, contracts (oil trading business)');
    console.log('   - Pride Muscat: Has suppliers (no customers, contracts - scrap business)');
    console.log('   - Both: Can handle sales/purchases with flexible entity references');
    
  } catch (error) {
    console.error('\n❌ Schema creation failed:', error.message);
    process.exit(1);
  }
}

main();