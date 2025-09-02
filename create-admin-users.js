require('dotenv').config();
const bcrypt = require('bcrypt');
const { initializeDatabases, getDbConnection } = require('./config/database');

async function createAdminUsers() {
  console.log('🔐 Creating admin users for both companies...\n');

  try {
    // Initialize database connections first
    await initializeDatabases();
    console.log('📊 Database connections initialized\n');
    // Hash the password
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash('pass123!', saltRounds);

    // Al Ramrami admin user
    console.log('👤 Creating Al Ramrami admin user...');
    const alRamramiDb = getDbConnection('al-ramrami');
    
    // Check if user already exists
    const existingAlRamrami = await alRamramiDb('users')
      .where({ email: 'admin@alramrami.com', companyId: 'al-ramrami' })
      .first();

    if (!existingAlRamrami) {
      await alRamramiDb('users').insert({
        email: 'admin@alramrami.com',
        password: hashedPassword,
        firstName: 'Super',
        lastName: 'Admin',
        role: 'super-admin',
        companyId: 'al-ramrami',
        isActive: true,
        created_at: new Date(),
        updated_at: new Date()
      });
      console.log('   ✅ Al Ramrami admin user created');
    } else {
      console.log('   ℹ️ Al Ramrami admin user already exists');
    }

    // Pride Muscat admin user
    console.log('👤 Creating Pride Muscat admin user...');
    const prideMuscatDb = getDbConnection('pride-muscat');
    
    // Check if user already exists
    const existingPrideMuscat = await prideMuscatDb('users')
      .where({ email: 'admin@pridemuscat.com', companyId: 'pride-muscat' })
      .first();

    if (!existingPrideMuscat) {
      await prideMuscatDb('users').insert({
        email: 'admin@pridemuscat.com',
        password: hashedPassword,
        firstName: 'Super',
        lastName: 'Admin',
        role: 'super-admin',
        companyId: 'pride-muscat',
        isActive: true,
        created_at: new Date(),
        updated_at: new Date()
      });
      console.log('   ✅ Pride Muscat admin user created');
    } else {
      console.log('   ℹ️ Pride Muscat admin user already exists');
    }

    // Verify users were created
    const alRamramiUsers = await alRamramiDb('users').select('email', 'role', 'companyId');
    const prideMuscatUsers = await prideMuscatDb('users').select('email', 'role', 'companyId');

    console.log('\n📊 User Summary:');
    console.log('🏢 Al Ramrami Trading:');
    alRamramiUsers.forEach(user => {
      console.log(`   👤 ${user.email} (${user.role})`);
    });

    console.log('🏢 Pride Muscat International:');
    prideMuscatUsers.forEach(user => {
      console.log(`   👤 ${user.email} (${user.role})`);
    });

    console.log('\n✅ Admin users ready for authentication!');
    
  } catch (error) {
    console.error('\n❌ Error creating admin users:', error.message);
    process.exit(1);
  }
}

createAdminUsers();