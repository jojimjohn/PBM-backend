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
  pool: {
    min: 2,
    max: 10,
  },
  migrations: {
    tableName: 'knex_migrations',
    directory: './migrations'
  }
};

async function runMigrationsForDatabase(dbName, displayName) {
  console.log(`\n🔄 Running migrations for ${displayName} (${dbName})...`);
  
  const db = knex({
    ...dbConfig,
    connection: {
      ...dbConfig.connection,
      database: dbName
    }
  });

  try {
    // Check current migration status
    const [migrationStatus] = await db.migrate.currentVersion();
    console.log(`   Current version: ${migrationStatus || 'none'}`);

    // Run pending migrations
    const [batchNo, migrations] = await db.migrate.latest();
    
    if (migrations.length === 0) {
      console.log(`✅ ${displayName}: No new migrations to run`);
    } else {
      console.log(`✅ ${displayName}: Ran ${migrations.length} migrations (batch ${batchNo})`);
      migrations.forEach(migration => {
        console.log(`   - ${migration}`);
      });
    }

    // Show all tables
    const tables = await db.raw('SHOW TABLES');
    const tableNames = tables[0].map(row => Object.values(row)[0]);
    console.log(`   📊 Total tables: ${tableNames.length}`);
    console.log(`   📋 Tables: ${tableNames.join(', ')}`);

  } catch (error) {
    console.error(`❌ Error migrating ${displayName}:`, error.message);
    throw error;
  } finally {
    await db.destroy();
  }
}

async function migrateAllDatabases() {
  try {
    console.log('🚀 Starting migration process for all databases...');

    // Migrate Al Ramrami database
    await runMigrationsForDatabase(process.env.AL_RAMRAMI_DB, 'Al Ramrami Trading');

    // Migrate Pride Muscat database  
    await runMigrationsForDatabase(process.env.PRIDE_MUSCAT_DB, 'Pride Muscat International');

    console.log('\n🎉 All database migrations completed successfully!');
    console.log('\n📊 Multi-tenant setup complete:');
    console.log(`   🏢 Al Ramrami Trading: ${process.env.AL_RAMRAMI_DB}`);
    console.log(`   🏢 Pride Muscat International: ${process.env.PRIDE_MUSCAT_DB}`);
    
  } catch (error) {
    console.error('\n❌ Migration process failed:', error.message);
    process.exit(1);
  }
}

migrateAllDatabases();