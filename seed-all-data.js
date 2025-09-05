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

// Users for both companies
const users = [
  {
    id: 1,
    username: 'admin',
    email: 'admin@petroleum-system.com',
    password: bcrypt.hashSync('admin123', 10),
    name: 'System Administrator',
    role: 'SUPER_ADMIN',
    company_id: null, // Super admin can access both
    is_active: true,
    created_at: new Date('2025-07-23T00:00:00Z'),
    updated_at: new Date('2025-07-23T00:00:00Z')
  },
  {
    id: 2,
    username: 'alramrami_admin',
    email: 'admin@alramrami.com',
    password: bcrypt.hashSync('admin123', 10),
    name: 'Al Ramrami Administrator',
    role: 'COMPANY_ADMIN',
    company_id: 'al-ramrami',
    is_active: true,
    created_at: new Date('2025-07-23T00:00:00Z'),
    updated_at: new Date('2025-07-23T00:00:00Z')
  },
  {
    id: 3,
    username: 'pridemuscat_admin',
    email: 'admin@pridemuscat.com',
    password: bcrypt.hashSync('admin123', 10),
    name: 'Pride Muscat Administrator',
    role: 'COMPANY_ADMIN',
    company_id: 'pride-muscat',
    is_active: true,
    created_at: new Date('2025-07-23T00:00:00Z'),
    updated_at: new Date('2025-07-23T00:00:00Z')
  }
];

// Al Ramrami Materials
const alRamramiMaterials = [
  {
    id: 1,
    name: 'Engine Oil with Drums',
    code: 'ENG_OIL_WITH_DRUM',
    category: 'engine_oil',
    unit: 'drums',
    standard_price: 25.000,
    description: 'Engine oil including container drums',
    is_active: true
  },
  {
    id: 2,
    name: 'Engine Oil without Drums',
    code: 'ENG_OIL_NO_DRUM',
    category: 'engine_oil',
    unit: 'liters',
    standard_price: 1.200,
    description: 'Engine oil excluding container',
    is_active: true
  },
  {
    id: 3,
    name: 'Empty Drums',
    code: 'EMPTY_DRUMS',
    category: 'empty_drums',
    unit: 'pieces',
    standard_price: 5.000,
    description: 'Empty oil drums for collection',
    is_active: true
  },
  {
    id: 4,
    name: 'Transformer Oil',
    code: 'TRANSFORMER_OIL',
    category: 'transformer_oil',
    unit: 'liters',
    standard_price: 2.500,
    description: 'Electrical transformer oil',
    is_active: true
  }
];

// Al Ramrami Customers
const alRamramiCustomers = [
  {
    id: 1,
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
    id: 2,
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
    id: 1,
    material_id: 1,
    current_stock: 150.00,
    minimum_stock: 50.00,
    opening_stock: 100.00,
    location: 'Warehouse A',
    last_updated: new Date()
  },
  {
    id: 2,
    material_id: 2,
    current_stock: 2500.00,
    minimum_stock: 500.00,
    opening_stock: 2000.00,
    location: 'Warehouse A',
    last_updated: new Date()
  },
  {
    id: 3,
    material_id: 3,
    current_stock: 85.00,
    minimum_stock: 20.00,
    opening_stock: 60.00,
    location: 'Warehouse B',
    last_updated: new Date()
  },
  {
    id: 4,
    material_id: 4,
    current_stock: 800.00,
    minimum_stock: 200.00,
    opening_stock: 600.00,
    location: 'Warehouse A',
    last_updated: new Date()
  }
];

// Pride Muscat Materials
const prideMuscatMaterials = [
  {
    id: 1,
    name: 'Copper Scrap',
    code: 'COPPER_SCRAP',
    category: 'copper',
    unit: 'kilograms',
    standard_price: 2.150,
    description: 'High-grade copper scrap materials',
    is_active: true
  },
  {
    id: 2,
    name: 'Aluminum Scrap',
    code: 'ALUMINUM_SCRAP', 
    category: 'aluminum',
    unit: 'kilograms',
    standard_price: 0.850,
    description: 'Clean aluminum scrap materials',
    is_active: true
  },
  {
    id: 3,
    name: 'Steel Scrap',
    code: 'STEEL_SCRAP',
    category: 'steel',
    unit: 'tons',
    standard_price: 95.000,
    description: 'Industrial steel scrap',
    is_active: true
  }
];

// Pride Muscat Suppliers (already created separately, but including main ones here)
const prideMuscatSuppliersAdditional = [
  // Main suppliers already seeded separately
];

// Pride Muscat Inventory
const prideMuscatInventory = [
  {
    id: 1,
    material_id: 1,
    current_stock: 1250.50,
    minimum_stock: 200.00,
    opening_stock: 1000.00,
    location: 'Yard A',
    last_updated: new Date()
  },
  {
    id: 2,
    material_id: 2,
    current_stock: 3200.75,
    minimum_stock: 500.00,
    opening_stock: 2800.00,
    location: 'Yard B',
    last_updated: new Date()
  },
  {
    id: 3,
    material_id: 3,
    current_stock: 15.25,
    minimum_stock: 2.00,
    opening_stock: 12.00,
    location: 'Heavy Yard',
    last_updated: new Date()
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
    // 1. Seed Users
    console.log('📥 Seeding users...');
    await db('users').del();
    await db('users').insert(users);
    console.log(`✅ ${users.length} users seeded`);

    if (companyId === 'al-ramrami') {
      // 2. Seed Materials
      console.log('📥 Seeding materials...');
      await db('materials').del();
      await db('materials').insert(alRamramiMaterials);
      console.log(`✅ ${alRamramiMaterials.length} materials seeded`);

      // 3. Seed Customers
      console.log('📥 Seeding customers...');
      await db('customers').del(); 
      await db('customers').insert(alRamramiCustomers);
      console.log(`✅ ${alRamramiCustomers.length} customers seeded`);

      // 4. Seed Inventory
      console.log('📥 Seeding inventory...');
      await db('inventory').del();
      await db('inventory').insert(alRamramiInventory);
      console.log(`✅ ${alRamramiInventory.length} inventory items seeded`);

    } else if (companyId === 'pride-muscat') {
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
    console.log(`   • Users: 3 (admin, alramrami_admin, pridemuscat_admin)`);
    console.log(`   • Al Ramrami: 4 materials, 2 customers, 4 inventory items, 5 suppliers`);
    console.log(`   • Pride Muscat: 3 materials, 3 inventory items, existing suppliers`);
    console.log(`   • All users have password: admin123`);
    console.log(`   • All data is now ready for testing!`);
    
  } catch (error) {
    console.error('\n❌ Seeding failed:', error.message);
    process.exit(1);
  }
}

main().catch(console.error);