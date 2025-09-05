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
    // 1. Seed Users (matching exact schema: email, password, firstName, lastName, role, companyId, isActive)
    console.log('📥 Seeding users...');
    await db('users').del();
    
    const users = [
      {
        email: `admin@${companyId === 'al-ramrami' ? 'alramrami' : 'pridemuscat'}.com`,
        password: bcrypt.hashSync('admin123', 10),
        firstName: companyName.split(' ')[0],
        lastName: 'Administrator',
        role: 'company-admin',
        companyId: companyId,
        isActive: true,
        lastLoginAt: null,
        lastLoginIp: null
      },
      {
        email: `manager@${companyId === 'al-ramrami' ? 'alramrami' : 'pridemuscat'}.com`,
        password: bcrypt.hashSync('manager123', 10),
        firstName: 'Operations',
        lastName: 'Manager',
        role: 'manager',
        companyId: companyId,
        isActive: true,
        lastLoginAt: null,
        lastLoginIp: null
      }
    ];
    
    await db('users').insert(users);
    console.log(`✅ ${users.length} users seeded`);

    if (companyId === 'al-ramrami') {
      // 2. Seed Materials
      console.log('📥 Seeding materials...');
      await db('materials').del();
      
      const materials = [
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
      
      await db('materials').insert(materials);
      console.log(`✅ ${materials.length} materials seeded`);

      // 3. Seed Customers
      console.log('📥 Seeding customers...');
      await db('customers').del();
      
      const customers = [
        {
          name: 'Oman Power Company',
          email: 'procurement@omanpower.om',
          phone: '+968 2456 7890',
          address: 'Industrial Area, Muscat, Oman',
          customerType: 'contract',
          vatRegistration: 'OM12345678901',
          contactPerson: 'Ahmed Al Rashid',
          creditLimit: 50000.00,
          paymentTermDays: 30,
          notes: 'Major power company - contract customer',
          isActive: true
        },
        {
          name: 'Gulf Industrial Services',
          email: 'orders@gulfindustrial.om',
          phone: '+968 2567 8901',
          address: 'Sohar Industrial Port, Oman',
          customerType: 'project-based',
          vatRegistration: 'OM98765432109',
          contactPerson: 'Fatima Al Zahra',
          creditLimit: 25000.00,
          paymentTermDays: 15,
          notes: 'Industrial services company - project-based customer',
          isActive: true
        }
      ];
      
      await db('customers').insert(customers);
      console.log(`✅ ${customers.length} customers seeded`);

      // 4. Seed Inventory (matching exact schema: materialId, quantity, averageCost, location, etc.)
      console.log('📥 Seeding inventory...');
      await db('inventory').del();
      
      const inventory = [
        {
          materialId: 1,
          batchNumber: 'ENG001-2025',
          quantity: 150.000,
          reservedQuantity: 0.000,
          averageCost: 24.500,
          lastPurchasePrice: 25.000,
          lastPurchaseDate: '2025-08-01',
          location: 'Warehouse A',
          condition: 'new',
          minimumStockLevel: 50.000,
          maximumStockLevel: 300.000,
          isActive: true
        },
        {
          materialId: 2,
          batchNumber: 'ENG002-2025',
          quantity: 2500.000,
          reservedQuantity: 0.000,
          averageCost: 1.150,
          lastPurchasePrice: 1.200,
          lastPurchaseDate: '2025-08-01',
          location: 'Warehouse A',
          condition: 'new',
          minimumStockLevel: 500.000,
          maximumStockLevel: 5000.000,
          isActive: true
        },
        {
          materialId: 3,
          batchNumber: 'DRM001-2025',
          quantity: 85.000,
          reservedQuantity: 0.000,
          averageCost: 4.800,
          lastPurchasePrice: 5.000,
          lastPurchaseDate: '2025-08-01',
          location: 'Warehouse B',
          condition: 'used',
          minimumStockLevel: 20.000,
          maximumStockLevel: 200.000,
          isActive: true
        },
        {
          materialId: 4,
          batchNumber: 'TRF001-2025',
          quantity: 800.000,
          reservedQuantity: 0.000,
          averageCost: 2.400,
          lastPurchasePrice: 2.500,
          lastPurchaseDate: '2025-08-01',
          location: 'Warehouse A',
          condition: 'new',
          minimumStockLevel: 200.000,
          maximumStockLevel: 1500.000,
          isActive: true
        }
      ];
      
      await db('inventory').insert(inventory);
      console.log(`✅ ${inventory.length} inventory items seeded`);

    } else if (companyId === 'pride-muscat') {
      // 2. Seed Materials
      console.log('📥 Seeding materials...');
      await db('materials').del();
      
      const materials = [
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
      
      await db('materials').insert(materials);
      console.log(`✅ ${materials.length} materials seeded`);

      // 3. Seed Inventory
      console.log('📥 Seeding inventory...');
      await db('inventory').del();
      
      const inventory = [
        {
          materialId: 1,
          batchNumber: 'COP001-2025',
          quantity: 1250.500,
          reservedQuantity: 0.000,
          averageCost: 2.100,
          lastPurchasePrice: 2.150,
          lastPurchaseDate: '2025-08-01',
          location: 'Yard A',
          condition: 'used',
          minimumStockLevel: 200.000,
          maximumStockLevel: 3000.000,
          isActive: true
        },
        {
          materialId: 2,
          batchNumber: 'ALU001-2025',
          quantity: 3200.750,
          reservedQuantity: 0.000,
          averageCost: 0.820,
          lastPurchasePrice: 0.850,
          lastPurchaseDate: '2025-08-01',
          location: 'Yard B',
          condition: 'used',
          minimumStockLevel: 500.000,
          maximumStockLevel: 5000.000,
          isActive: true
        },
        {
          materialId: 3,
          batchNumber: 'STL001-2025',
          quantity: 15.250,
          reservedQuantity: 0.000,
          averageCost: 92.500,
          lastPurchasePrice: 95.000,
          lastPurchaseDate: '2025-08-01',
          location: 'Heavy Yard',
          condition: 'used',
          minimumStockLevel: 2.000,
          maximumStockLevel: 50.000,
          isActive: true
        }
      ];
      
      await db('inventory').insert(inventory);
      console.log(`✅ ${inventory.length} inventory items seeded`);
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
  console.log('🌱 Starting final data seeding...\n');
  
  try {
    // Seed both companies
    await seedDatabase('al-ramrami', 'Al Ramrami Trading', process.env.AL_RAMRAMI_DB);
    await seedDatabase('pride-muscat', 'Pride Muscat International', process.env.PRIDE_MUSCAT_DB);
    
    console.log('\n🎉 ALL DATA SUCCESSFULLY RESTORED!');
    console.log('\n📋 Complete System Summary:');
    console.log(`   👥 Users: admin@[company].com / manager@[company].com (passwords: admin123/manager123)`);
    console.log(`   🏢 Al Ramrami: 4 materials, 2 customers, 4 inventory items, 5 suppliers`);
    console.log(`   🏢 Pride Muscat: 3 materials, 3 inventory items, existing suppliers`);
    console.log(`   📦 All inventory with realistic stock levels and batch numbers`);
    console.log(`   🔐 Ready for purchase order testing!`);
    
  } catch (error) {
    console.error('\n❌ Seeding failed:', error.message);
    process.exit(1);
  }
}

main().catch(console.error);