require('dotenv').config();
const knex = require('knex');

const dbConfig = {
  client: 'mysql2',
  connection: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.AL_RAMRAMI_DB,
    charset: 'utf8mb4',
    connectTimeout: 60000,
    supportBigNumbers: true,
    bigNumberStrings: true,
  },
  pool: { min: 2, max: 10 }
};

const db = knex(dbConfig);

// Al Ramrami Oil Trading Suppliers - matching actual table schema
const suppliers = [
  {
    name: 'Gulf Petroleum Services LLC',
    email: 'procurement@gulfpetroleum.om',
    phone: '+968 2445 6789',
    address: 'Ruwi Commercial District, Building 25, Muscat, Muscat Governorate, Oman',
    vatRegistration: 'OM12345678901',
    contactPerson: 'Ahmed Al Balushi',
    specialization: 'engine_oil,transformer_oil,lube_oil',
    creditBalance: 0.00,
    paymentTermDays: 30,
    notes: 'Business supplier - Oil trading partner. CR: CR-10203040, Tax: TAX-10203040',
    isActive: true
  },
  {
    name: 'Oman Oil Recovery Solutions',
    email: 'operations@omanoilrecovery.com',
    phone: '+968 2356 7890',
    address: 'Sohar Industrial Port, Warehouse Complex B, Sohar, Al Batinah North Governorate, Oman',
    vatRegistration: 'OM98765432109',
    contactPerson: 'Khalid Al Rashid',
    specialization: 'engine_oil,crude_sludge,empty_drums',
    creditBalance: 0.00,
    paymentTermDays: 15,
    notes: 'Industrial supplier - Waste oil recovery. CR: CR-50607080, Tax: TAX-50607080',
    isActive: true
  },
  {
    name: 'Al Wusta Lubricants Trading',
    email: 'supply@alwustalube.om',
    phone: '+968 2567 8901',
    address: 'Industrial Area, Plot 15, Nizwa, Ad Dakhiliyah Governorate, Oman',
    vatRegistration: 'OM11223344556',
    contactPerson: 'Fatima Al Zahra',
    specialization: 'lube_oil,cooking_oil,diesel',
    creditBalance: 0.00,
    paymentTermDays: 7,
    notes: 'Business supplier - Lubricants trading. CR: CR-90112233, Tax: TAX-90112233',
    isActive: true
  },
  {
    name: 'Mohammed Al Hinai',
    email: null,
    phone: '+968 9876 5432',
    address: 'Al Seeb, Muscat, Muscat Governorate, Oman',
    vatRegistration: null,
    contactPerson: null,
    specialization: 'engine_oil,empty_drums',
    creditBalance: 0.00,
    paymentTermDays: 0, // Cash payment
    notes: 'Individual supplier - Small scale oil collector. National ID: 55667788',
    isActive: true
  },
  {
    name: 'Salalah Oil Waste Management',
    email: 'waste@salalahOil.com',
    phone: '+968 2389 0123',
    address: 'Salalah Industrial Area, Zone C, Salalah, Dhofar Governorate, Oman',
    vatRegistration: 'OM22334455667',
    contactPerson: 'Salem Al Kindi',
    specialization: 'crude_sludge,transformer_oil,diesel',
    creditBalance: 0.00,
    paymentTermDays: 21,
    notes: 'Industrial supplier - Oil waste management. CR: CR-44556677, Tax: TAX-44556677',
    isActive: true
  }
];

async function seedSuppliers() {
  console.log('🌱 Seeding Al Ramrami suppliers...\n');
  
  try {
    // Check if suppliers already exist
    const existingCount = await db('suppliers').count('* as count').first();
    console.log(`📊 Current suppliers in database: ${existingCount.count}`);
    
    if (existingCount.count > 0) {
      console.log('⚠️  Suppliers already exist. Clearing existing data...');
      await db('suppliers').del();
      console.log('✅ Existing suppliers cleared');
    }
    
    // Insert new suppliers
    console.log(`📥 Inserting ${suppliers.length} suppliers...`);
    const insertedIds = await db('suppliers').insert(suppliers);
    
    console.log('\n✅ Successfully seeded suppliers:');
    suppliers.forEach((supplier, index) => {
      console.log(`   ${index + 1}. ${supplier.name}`);
      console.log(`      📞 ${supplier.phone}`);
      console.log(`      📧 ${supplier.email || 'No email'}`);
      console.log(`      👤 Contact: ${supplier.contactPerson || 'N/A'}`);
      console.log(`      🔧 Specialization: ${supplier.specialization}`);
      console.log(`      💰 Payment Terms: ${supplier.paymentTermDays} days`);
      console.log('');
    });
    
    console.log(`🎉 Seeding complete! ${suppliers.length} suppliers added to Al Ramrami database.`);
    console.log('\n📋 Supplier Summary:');
    console.log(`   • Business suppliers: 3 (Gulf Petroleum, Al Wusta, Salalah Oil)`);
    console.log(`   • Individual suppliers: 1 (Mohammed Al Hinai)`);
    console.log(`   • Industrial suppliers: 1 (Oman Oil Recovery)`);
    console.log(`   • All suppliers are active and ready for purchase orders`);
    
  } catch (error) {
    console.error('❌ Error seeding suppliers:', error.message);
    throw error;
  } finally {
    await db.destroy();
  }
}

// Run the seed function
seedSuppliers().catch(console.error);