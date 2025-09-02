const bcrypt = require('bcrypt');

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> } 
 */
exports.seed = async function(knex) {
  // Deletes ALL existing entries
  await knex('users').del();
  
  const saltRounds = 12;
  
  // Hash the default password
  const defaultPassword = await bcrypt.hash('pass123!', saltRounds);
  
  // Insert seed entries
  await knex('users').insert([
    {
      email: 'admin@alramrami.com',
      password: defaultPassword,
      firstName: 'Super',
      lastName: 'Admin',
      role: 'super-admin',
      companyId: 'al-ramrami',
      isActive: true,
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      email: 'admin@pridemuscat.com',
      password: defaultPassword,
      firstName: 'Super',
      lastName: 'Admin',
      role: 'super-admin',
      companyId: 'pride-muscat',
      isActive: true,
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      email: 'manager@alramrami.com',
      password: defaultPassword,
      firstName: 'Company',
      lastName: 'Admin',
      role: 'company-admin',
      companyId: 'al-ramrami',
      isActive: true,
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      email: 'manager@pridemuscat.com',
      password: defaultPassword,
      firstName: 'Company',
      lastName: 'Admin',
      role: 'company-admin',
      companyId: 'pride-muscat',
      isActive: true,
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      email: 'sales@alramrami.com',
      password: defaultPassword,
      firstName: 'Sales',
      lastName: 'Staff',
      role: 'sales-staff',
      companyId: 'al-ramrami',
      isActive: true,
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      email: 'sales@pridemuscat.com',
      password: defaultPassword,
      firstName: 'Sales',
      lastName: 'Staff',
      role: 'sales-staff',
      companyId: 'pride-muscat',
      isActive: true,
      created_at: new Date(),
      updated_at: new Date()
    }
  ]);
  
  console.log('🌱 Users seeded successfully');
  console.log('📧 Default login credentials:');
  console.log('   Email: admin@alramrami.com');
  console.log('   Email: admin@pridemuscat.com');
  console.log('   Password: pass123!');
  console.log('⚠️  CHANGE DEFAULT PASSWORDS IN PRODUCTION!');
};