/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> } 
 */
exports.seed = async function(knex) {
  
  const customers = [
    {
      name: 'ABC Manufacturing LLC',
      customerType: 'contract',
      contactPerson: 'Ahmed Al-Balushi',
      phone: '+968 1234 5678',
      email: 'procurement@abc-manufacturing.com',
      address: 'Industrial Area, Plot 23, Muscat, Oman',
      vatRegistration: 'OM12345678901',
      creditLimit: 15000.00,
      paymentTermDays: 30,
      isActive: true,
      notes: 'Major industrial customer with long-term contract'
    },
    {
      name: 'XYZ Power Plant',
      customerType: 'project-based',
      contactPerson: 'Khalid Al-Rashid',
      phone: '+968 2234 5678',
      email: 'maintenance@xyz-power.com',
      address: 'Sohar Industrial Port, Sohar, Oman',
      vatRegistration: 'OM98765432109',
      creditLimit: 25000.00,
      paymentTermDays: 45,
      isActive: true,
      notes: 'Power plant maintenance contractor'
    },
    {
      name: 'Global Shipping Co',
      customerType: 'contract',
      contactPerson: 'Mohammed Al-Harthy',
      phone: '+968 3345 6789',
      email: 'fleet@globalship.om',
      address: 'Port Sultan Qaboos, Muttrah, Muscat',
      vatRegistration: 'OM45678901234',
      creditLimit: 20000.00,
      paymentTermDays: 30,
      isActive: true,
      notes: 'Marine fleet management company'
    },
    {
      name: 'Desert Transport LLC',
      customerType: 'walk-in',
      contactPerson: 'Saeed Al-Battashi',
      phone: '+968 4456 7890',
      email: 'ops@deserttransport.net',
      address: 'Nizwa Industrial Area, Nizwa, Oman',
      vatRegistration: 'OM67890123456',
      creditLimit: 5000.00,
      paymentTermDays: 15,
      isActive: true,
      notes: 'Local trucking company, regular walk-in customer'
    },
    {
      name: 'Oman Construction Group',
      customerType: 'project-based',
      contactPerson: 'Abdullah Al-Lawati',
      phone: '+968 5567 8901',
      email: 'procurement@ocg-oman.com',
      address: 'Al Khuwair, Muscat, Oman',
      vatRegistration: 'OM78901234567',
      creditLimit: 18000.00,
      paymentTermDays: 60,
      isActive: true,
      notes: 'Large construction projects, seasonal purchases'
    },
    {
      name: 'Royal Navy Base',
      customerType: 'contract',
      contactPerson: 'Captain Hassan Al-Salmi',
      phone: '+968 6678 9012',
      email: 'logistics@rnb.gov.om',
      address: 'Said Bin Sultan Naval Base, Wudam, Oman',
      vatRegistration: null, // Government entity
      creditLimit: 50000.00,
      paymentTermDays: 90,
      isActive: true,
      notes: 'Government contract - special payment terms'
    }
  ];

  const suppliers = [
    {
      name: 'Metal Collectors Association',
      contactPerson: 'Rashid Al-Amri',
      phone: '+968 7789 0123',
      email: 'collection@metalcollectors.om',
      address: 'Ruwi Industrial Area, Muscat, Oman',
      vatRegistration: 'OM89012345678',
      paymentTermDays: 7,
      isActive: true,
      specialization: 'aluminum-steel',
      notes: 'Primary aluminum and steel supplier'
    },
    {
      name: 'Sohar Scrap Trading',
      contactPerson: 'Youssef Al-Kindi',
      phone: '+968 8890 1234',
      email: 'sales@soharscrap.net',
      address: 'Sohar Free Zone, Sohar, Oman',
      vatRegistration: 'OM90123456789',
      paymentTermDays: 14,
      isActive: true,
      specialization: 'copper-brass',
      notes: 'Copper and brass specialist'
    },
    {
      name: 'E-Waste Solutions LLC',
      contactPerson: 'Fatima Al-Zahra',
      phone: '+968 9901 2345',
      email: 'info@ewaste-solutions.om',
      address: 'Knowledge Oasis Muscat, Muscat, Oman',
      vatRegistration: 'OM01234567890',
      paymentTermDays: 10,
      isActive: true,
      specialization: 'electronic-waste',
      notes: 'Electronic waste and circuit board supplier'
    },
    {
      name: 'Dhofar Recycling Co',
      contactPerson: 'Salem Al-Mahri',
      phone: '+968 1012 3456',
      email: 'collect@dhofar-recycling.om',
      address: 'Salalah Industrial City, Salalah, Oman',
      vatRegistration: 'OM12345067890',
      paymentTermDays: 21,
      isActive: true,
      specialization: 'mixed-materials',
      notes: 'Southern region supplier, mixed materials'
    },
    {
      name: 'Plastic Recovery Network',
      contactPerson: 'Maryam Al-Siyabi',
      phone: '+968 2123 4567',
      email: 'operations@plastic-recovery.net',
      address: 'Barka Industrial Area, Barka, Oman',
      vatRegistration: 'OM23456789012',
      paymentTermDays: 5,
      isActive: true,
      specialization: 'plastic-waste',
      notes: 'PET bottles and plastic waste specialist'
    },
    {
      name: 'Tire Collection Services',
      contactPerson: 'Omar Al-Farsi',
      phone: '+968 3234 5678',
      email: 'tires@tcs-oman.com',
      address: 'Sur Industrial Area, Sur, Oman',
      vatRegistration: 'OM34567890123',
      paymentTermDays: 7,
      isActive: true,
      specialization: 'tire-rubber',
      notes: 'Used tire collection and processing'
    }
  ];

  // Insert data
  
  console.log('🏢 Seeding customers and suppliers...');
  
  await knex('customers').insert(customers);
  await knex('suppliers').insert(suppliers);
  
  console.log('✅ Customers and suppliers seeded successfully');
  console.log(`   👥 Al Ramrami: ${customers.length} customers`);
  console.log(`   🏭 Pride Muscat: ${suppliers.length} suppliers`);
};