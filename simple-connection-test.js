require('dotenv').config();
const mysql = require('mysql2/promise');

async function testConnection() {
  console.log('🔍 Testing database connection with current credentials...\n');
  
  console.log('Configuration:');
  console.log(`   Host: ${process.env.DB_HOST}`);
  console.log(`   Port: ${process.env.DB_PORT}`);
  console.log(`   User: ${process.env.DB_USER}`);
  console.log(`   Password: ${process.env.DB_PASSWORD ? '[PROVIDED]' : '[NOT SET]'}\n`);

  try {
    // Test basic connection
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
    });

    console.log('✅ Basic connection successful!\n');

    // Test permissions - can we create databases?
    console.log('Testing database creation permissions...');
    
    try {
      await connection.execute(`CREATE DATABASE IF NOT EXISTS ${process.env.AL_RAMRAMI_DB}`);
      console.log(`✅ Successfully created/verified database: ${process.env.AL_RAMRAMI_DB}`);
      
      await connection.execute(`CREATE DATABASE IF NOT EXISTS ${process.env.PRIDE_MUSCAT_DB}`);
      console.log(`✅ Successfully created/verified database: ${process.env.PRIDE_MUSCAT_DB}\n`);
      
    } catch (dbError) {
      console.log(`❌ Database creation failed: ${dbError.message}\n`);
      console.log('💡 This user may not have CREATE privileges.');
      console.log('   Contact your hosting provider to grant database creation rights.\n');
    }

    // Test if databases exist
    console.log('Checking existing databases...');
    const [databases] = await connection.execute('SHOW DATABASES');
    
    const alRamramiExists = databases.some(db => db.Database === process.env.AL_RAMRAMI_DB);
    const prideMuscatExists = databases.some(db => db.Database === process.env.PRIDE_MUSCAT_DB);
    
    console.log(`   ${process.env.AL_RAMRAMI_DB}: ${alRamramiExists ? 'EXISTS' : 'NOT FOUND'}`);
    console.log(`   ${process.env.PRIDE_MUSCAT_DB}: ${prideMuscatExists ? 'EXISTS' : 'NOT FOUND'}\n`);

    await connection.end();
    
    console.log('🎉 Connection test completed successfully!');
    
    if (alRamramiExists && prideMuscatExists) {
      console.log('\n✅ Ready to run: npm run migrate && npm run seed');
    } else {
      console.log('\n⚠️  Run database setup first: npm run setup');
    }

  } catch (error) {
    console.error('❌ Connection failed:');
    console.error(`   ${error.message}\n`);
    
    if (error.code === 'ER_ACCESS_DENIED_ERROR') {
      console.log('💡 Access denied - possible causes:');
      console.log('   1. Wrong username or password');
      console.log('   2. User not allowed to connect from your IP address');
      console.log('   3. User account doesn\'t exist');
      console.log('\n📞 Contact your hosting provider to:');
      console.log('   - Verify the credentials are correct');
      console.log('   - Add your IP to the allowed hosts list');
      console.log('   - Confirm the user has necessary privileges');
    } else if (error.code === 'ECONNREFUSED') {
      console.log('💡 Connection refused - possible causes:');
      console.log('   1. MySQL server is not running');
      console.log('   2. Wrong host or port');
      console.log('   3. Firewall blocking the connection');
    } else if (error.code === 'ENOTFOUND') {
      console.log('💡 Host not found - possible causes:');
      console.log('   1. Wrong hostname in DB_HOST');
      console.log('   2. DNS resolution issues');
      console.log('   3. Network connectivity problems');
    }
  }
}

testConnection();