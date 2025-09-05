require('dotenv').config();
const knex = require('knex');
const bcrypt = require('bcrypt');

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

// Users for Al Ramrami - matching actual table schema
const usersAlRamrami = [
  {
    email: 'admin@alramrami.com',
    password: bcrypt.hashSync('admin123', 10),
    firstName: 'Al Ramrami',
    lastName: 'Administrator',
    role: 'company-admin',
    companyId: 'al-ramrami',
    isActive: true,
    lastLoginAt: null,
    lastLoginIp: null
  },
  {
    email: 'manager@alramrami.com',
    password: bcrypt.hashSync('manager123', 10),
    firstName: 'Operations',
    lastName: 'Manager',
    role: 'manager',
    companyId: 'al-ramrami',
    isActive: true,
    lastLoginAt: null,
    lastLoginIp: null
  }
];

// Users for Pride Muscat
const usersPrideMuscat = [
  {
    email: 'admin@pridemuscat.com',
    password: bcrypt.hashSync('admin123', 10),
    firstName: 'Pride Muscat',
    lastName: 'Administrator',
    role: 'company-admin',
    companyId: 'pride-muscat',
    isActive: true,
    lastLoginAt: null,
    lastLoginIp: null
  },
  {
    email: 'manager@pridemuscat.com',
    password: bcrypt.hashSync('manager123', 10),
    firstName: 'Operations',
    lastName: 'Manager',
    role: 'manager',
    companyId: 'pride-muscat',
    isActive: true,
    lastLoginAt: null,
    lastLoginIp: null
  }
];

// Al Ramrami Materials
const alRamramiMaterials = [
  {
    name: 'Engine Oil with Drums',
    code: 'ENG_OIL_WITH_DRUM',
    category: 'engine_oil',
    unit: 'drums',
    standardPrice: 25.000,
    description: 'Engine oil including container drums',
    isActive: true
  },
  {
    name: 'Engine Oil without Drums',
    code: 'ENG_OIL_NO_DRUM',
    category: 'engine_oil',
    unit: 'liters',
    standardPrice: 1.200,
    description: 'Engine oil excluding container',
    isActive: true
  },
  {
    name: 'Empty Drums',
    code: 'EMPTY_DRUMS',
    category: 'empty_drums',
    unit: 'pieces',
    standardPrice: 5.000,
    description: 'Empty oil drums for collection',
    isActive: true
  },
  {
    name: 'Transformer Oil',
    code: 'TRANSFORMER_OIL',
    category: 'transformer_oil',
    unit: 'liters',
    standardPrice: 2.500,
    description: 'Electrical transformer oil',
    isActive: true
  }
];

// Al Ramrami Customers
const alRamramiCustomers = [
  {
    name: 'Oman Power Company',
    email: 'procurement@omanpower.om',
    phone: '+968 2456 7890',
    address: 'Industrial Area, Muscat, Oman',
    vatRegistration: 'OM12345678901',
    contactPerson: 'Ahmed Al Rashid',
    creditLimit: 50000.00,
    creditBalance: 0.00,
    paymentTermDays: 30,
    customerType: 'contract',
    isActive: true
  },
  {
    name: 'Gulf Industrial Services',
    email: 'orders@gulfindustrial.om',
    phone: '+968 2567 8901',
    address: 'Sohar Industrial Port, Oman',
    vatRegistration: 'OM98765432109',
    contactPerson: 'Fatima Al Zahra',
    creditLimit: 25000.00,
    creditBalance: 0.00,
    paymentTermDays: 15,
    customerType: 'project',
    isActive: true
  }
];

// Al Ramrami Inventory
const alRamramiInventory = [
  {
    materialId: 1,
    currentStock: 150.00,
    minimumStock: 50.00,
    openingStock: 100.00,
    location: 'Warehouse A',
    lastUpdated: new Date()
  },
  {
    materialId: 2,
    currentStock: 2500.00,
    minimumStock: 500.00,
    openingStock: 2000.00,
    location: 'Warehouse A',
    lastUpdated: new Date()
  },
  {
    materialId: 3,
    currentStock: 85.00,
    minimumStock: 20.00,
    openingStock: 60.00,
    location: 'Warehouse B',
    lastUpdated: new Date()
  },
  {
    materialId: 4,
    currentStock: 800.00,
    minimumStock: 200.00,
    openingStock: 600.00,
    location: 'Warehouse A',
    lastUpdated: new Date()
  }
];

// Pride Muscat Materials
const prideMuscatMaterials = [
  {
    name: 'Copper Scrap',
    code: 'COPPER_SCRAP',
    category: 'copper',
    unit: 'kilograms',
    standardPrice: 2.150,
    description: 'High-grade copper scrap materials',
    isActive: true
  },
  {
    name: 'Aluminum Scrap',
    code: 'ALUMINUM_SCRAP',
    category: 'aluminum',
    unit: 'kilograms',
    standardPrice: 0.850,
    description: 'Clean aluminum scrap materials',
    isActive: true
  },
  {
    name: 'Steel Scrap',
    code: 'STEEL_SCRAP',
    category: 'steel',
    unit: 'tons',
    standardPrice: 95.000,
    description: 'Industrial steel scrap',
    isActive: true
  }
];

// Pride Muscat Inventory
const prideMuscatInventory = [
  {
    materialId: 1,
    currentStock: 1250.50,
    minimumStock: 200.00,
    openingStock: 1000.00,
    location: 'Yard A',
    lastUpdated: new Date()
  },
  {
    materialId: 2,
    currentStock: 3200.75,
    minimumStock: 500.00,
    openingStock: 2800.00,
    location: 'Yard B',
    lastUpdated: new Date()
  },
  {
    materialId: 3,
    currentStock: 15.25,
    minimumStock: 2.00,
    openingStock: 12.00,
    location: 'Heavy Yard',
    lastUpdated: new Date()
  }
];

async function seedDatabase(companyId, companyName, dbName) {
  console.log(`\n🌱 Seeding ${companyName}...`);
  
  const db = knex({
    ...dbConfig,
    connection: {
      ...dbConfig.connection,
      database: dbName
    }
  });

  try {
    if (companyId === 'al-ramrami') {
      // 1. Seed Users
      console.log('📥 Seeding users...');
      await db('users').del();
      await db('users').insert(usersAlRamrami);
      console.log(`✅ ${usersAlRamrami.length} users seeded`);

      // 2. Seed Materials
      console.log('📥 Seeding materials...');
      await db('materials').del();
      const materialIds = await db('materials').insert(alRamramiMaterials);
      console.log(`✅ ${alRamramiMaterials.length} materials seeded`);

      // 3. Seed Customers
      console.log('📥 Seeding customers...');
      await db('customers').del();
      await db('customers').insert(alRamramiCustomers);
      console.log(`✅ ${alRamramiCustomers.length} customers seeded`);

      // 4. Seed Inventory (with correct material IDs)
      console.log('📥 Seeding inventory...');
      await db('inventory').del();
      await db('inventory').insert(alRamramiInventory);
      console.log(`✅ ${alRamramiInventory.length} inventory items seeded`);

    } else if (companyId === 'pride-muscat') {
      // 1. Seed Users  
      console.log('📥 Seeding users...');
      await db('users').del();
      await db('users').insert(usersPrideMuscat);
      console.log(`✅ ${usersPrideMuscat.length} users seeded`);

      // 2. Seed Materials
      console.log('📥 Seeding materials...');
      await db('materials').del();
      await db('materials').insert(prideMuscatMaterials);
      console.log(`✅ ${prideMuscatMaterials.length} materials seeded`);

      // 3. Seed Inventory
      console.log('📥 Seeding inventory...');
      await db('inventory').del();
      await db('inventory').insert(prideMuscatInventory);
      console.log(`✅ ${prideMuscatInventory.length} inventory items seeded`);
    }

    console.log(`✅ ${companyName} seeding complete!`);

  } catch (error) {
    console.error(`❌ Error seeding ${companyName}:`, error.message);
    throw error;
  } finally {
    await db.destroy();
  }
}

async function main() {
  console.log('🌱 Starting comprehensive data seeding...\n');
  
  try {
    // Seed both companies
    await seedDatabase('al-ramrami', 'Al Ramrami Trading', process.env.AL_RAMRAMI_DB);
    await seedDatabase('pride-muscat', 'Pride Muscat International', process.env.PRIDE_MUSCAT_DB);
    
    console.log('\n🎉 All data seeding completed successfully!');
    console.log('\n📋 Summary:');
    console.log(`   • Users: 2 per company (admin, manager)`);
    console.log(`   • Al Ramrami: 4 materials, 2 customers, 4 inventory items, 5 suppliers (previously seeded)`);
    console.log(`   • Pride Muscat: 3 materials, 3 inventory items, existing suppliers`);
    console.log(`   • Admin passwords: admin123`);
    console.log(`   • Manager passwords: manager123`);
    console.log(`   • All data is now ready for testing!`);
    
  } catch (error) {
    console.error('\n❌ Seeding failed:', error.message);
    process.exit(1);
  }
}

main().catch(console.error);