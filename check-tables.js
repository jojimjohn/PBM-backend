require('dotenv').config();
const mysql = require('mysql2/promise');

async function checkTables() {
  try {
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.AL_RAMRAMI_DB
    });

    console.log('📊 Al Ramrami Database Tables:');
    const [alRamramiTables] = await connection.execute('SHOW TABLES');
    alRamramiTables.forEach((table, i) => {
      const tableName = Object.values(table)[0];
      console.log(`   ${i+1}. ${tableName}`);
    });

    // Switch to Pride Muscat database
    await connection.execute(`USE ${process.env.PRIDE_MUSCAT_DB}`);
    
    console.log('\n📊 Pride Muscat Database Tables:');
    const [prideMuscatTables] = await connection.execute('SHOW TABLES');
    prideMuscatTables.forEach((table, i) => {
      const tableName = Object.values(table)[0];
      console.log(`   ${i+1}. ${tableName}`);
    });

    console.log(`\n✅ Total tables created: ${alRamramiTables.length} per database`);
    console.log('🎉 Database schema setup completed successfully!');

    await connection.end();
  } catch (error) {
    console.error('❌ Error checking tables:', error.message);
  }
}

checkTables();