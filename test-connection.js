// Load environment variables first
require('dotenv').config();

const { initializeDatabases, healthCheck, closeConnections } = require('./config/database');
const { logger } = require('./utils/logger');

const testConnection = async () => {
  try {
    console.log('🔍 Testing database connection...\n');

    // Test database initialization
    console.log('1. Initializing databases...');
    await initializeDatabases();
    console.log('✅ Database initialization successful!\n');

    // Test health check
    console.log('2. Running health check...');
    const health = await healthCheck();
    console.log('Database Health Status:');
    console.log(`   Al Ramrami DB: ${health.alRamrami}`);
    console.log(`   Pride Muscat DB: ${health.prideMuscat}\n`);

    if (health.alRamrami === 'healthy' && health.prideMuscat === 'healthy') {
      console.log('🎉 All database connections are healthy!\n');
    } else {
      console.log('⚠️  Some database connections have issues.\n');
    }

    // Test if tables exist
    console.log('3. Checking if tables exist...');
    const { getDbConnection } = require('./config/database');
    
    const alRamramiDb = getDbConnection('al-ramrami');
    const prideMuscatDb = getDbConnection('pride-muscat');

    try {
      const alRamramiTables = await alRamramiDb.raw("SHOW TABLES");
      const prideMuscatTables = await prideMuscatDb.raw("SHOW TABLES");
      
      console.log(`   Al Ramrami tables: ${alRamramiTables[0].length} found`);
      console.log(`   Pride Muscat tables: ${prideMuscatTables[0].length} found\n`);

      // Check for users table specifically
      const alRamramiUsers = await alRamramiDb.raw("SELECT COUNT(*) as count FROM users");
      const prideMuscatUsers = await prideMuscatDb.raw("SELECT COUNT(*) as count FROM users");
      
      console.log(`   Al Ramrami users: ${alRamramiUsers[0][0].count}`);
      console.log(`   Pride Muscat users: ${prideMuscatUsers[0][0].count}\n`);

    } catch (error) {
      console.log('⚠️  Tables may not exist yet. Run migrations first.');
      console.log('   Command: npm run setup\n');
    }

    console.log('✅ Database connection test completed successfully!');

  } catch (error) {
    console.error('❌ Database connection test failed:');
    console.error(`   Error: ${error.message}\n`);
    
    if (error.message.includes('ECONNREFUSED')) {
      console.log('💡 Troubleshooting tips:');
      console.log('   - Check if MySQL server is running');
      console.log('   - Verify host and port are correct');
      console.log('   - Confirm firewall allows connections');
    } else if (error.message.includes('Access denied')) {
      console.log('💡 Troubleshooting tips:');
      console.log('   - Check username and password in .env');
      console.log('   - Verify user has database creation privileges');
      console.log('   - Confirm user can connect from this IP');
    } else if (error.message.includes('Unknown database')) {
      console.log('💡 Note: This is expected on first run.');
      console.log('   Databases will be created automatically.');
    }
  } finally {
    // Close connections
    await closeConnections();
    process.exit(0);
  }
};

// Run the test
testConnection();