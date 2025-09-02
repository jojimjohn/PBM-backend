/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> } 
 */
exports.seed = async function(knex) {
  
  // Get material IDs
  const materials = await knex('materials').select('id', 'code', 'unit');
  const materialMap = {};
  materials.forEach(m => materialMap[m.code] = { id: m.id, unit: m.unit });
  
  const oilInventory = [
    // Al Ramrami Oil Business Inventory
    {
      materialId: materialMap['ENG_OIL_DRUM'].id,
      batchNumber: 'EOD-2025-001',
      quantity: 150.000,
      reservedQuantity: 0.000,
      averageCost: 23.500,
      lastPurchasePrice: 24.000,
      lastPurchaseDate: '2025-08-15',
      expiryDate: '2028-08-15',
      location: 'Tank Farm A-1',
      condition: 'used',
      notes: 'High-quality used engine oil with drums',
      minimumStockLevel: 50.000,
      maximumStockLevel: 300.000,
      isActive: true
    },
    {
      materialId: materialMap['ENG_OIL_BULK'].id,
      batchNumber: 'EOB-2025-002',
      quantity: 2500.000,
      reservedQuantity: 200.000,
      averageCost: 1.150,
      lastPurchasePrice: 1.200,
      lastPurchaseDate: '2025-08-20',
      expiryDate: '2028-08-20',
      location: 'Tank Farm A-2',
      condition: 'used',
      notes: 'Bulk engine oil without containers',
      minimumStockLevel: 1000.000,
      maximumStockLevel: 5000.000,
      isActive: true
    },
    {
      materialId: materialMap['EMPTY_DRUMS'].id,
      batchNumber: null,
      quantity: 85.000,
      reservedQuantity: 0.000,
      averageCost: 4.750,
      lastPurchasePrice: 5.000,
      lastPurchaseDate: '2025-08-10',
      expiryDate: null,
      location: 'Storage Yard B',
      condition: 'used',
      notes: '200L steel drums, various conditions',
      minimumStockLevel: 30.000,
      maximumStockLevel: 150.000,
      isActive: true
    },
    {
      materialId: materialMap['TRANS_OIL'].id,
      batchNumber: 'TO-2025-001',
      quantity: 1200.000,
      reservedQuantity: 150.000,
      averageCost: 2.350,
      lastPurchasePrice: 2.400,
      lastPurchaseDate: '2025-08-18',
      expiryDate: '2030-08-18',
      location: 'Tank Farm C-1',
      condition: 'used',
      notes: 'Transformer oil from power stations',
      minimumStockLevel: 500.000,
      maximumStockLevel: 2000.000,
      isActive: true
    },
    {
      materialId: materialMap['LUBE_OIL'].id,
      batchNumber: 'LO-2025-003',
      quantity: 800.000,
      reservedQuantity: 50.000,
      averageCost: 1.650,
      lastPurchasePrice: 1.700,
      lastPurchaseDate: '2025-08-22',
      expiryDate: '2028-08-22',
      location: 'Tank Farm C-2',
      condition: 'used',
      notes: 'Hydraulic and lubrication oils',
      minimumStockLevel: 300.000,
      maximumStockLevel: 1500.000,
      isActive: true
    },
    {
      materialId: materialMap['COOK_OIL'].id,
      batchNumber: 'CO-2025-004',
      quantity: 600.000,
      reservedQuantity: 0.000,
      averageCost: 0.750,
      lastPurchasePrice: 0.800,
      lastPurchaseDate: '2025-08-25',
      expiryDate: '2026-08-25',
      location: 'Tank Farm D-1',
      condition: 'used',
      notes: 'Used cooking oil from restaurants',
      minimumStockLevel: 200.000,
      maximumStockLevel: 1000.000,
      isActive: true
    },
    {
      materialId: materialMap['DIESEL_FUEL'].id,
      batchNumber: 'DF-2025-002',
      quantity: 1500.000,
      reservedQuantity: 100.000,
      averageCost: 0.420,
      lastPurchasePrice: 0.445,
      lastPurchaseDate: '2025-08-28',
      expiryDate: '2027-08-28',
      location: 'Tank Farm E-1',
      condition: 'used',
      notes: 'Used diesel and gas oil mixture',
      minimumStockLevel: 500.000,
      maximumStockLevel: 3000.000,
      isActive: true
    },
    {
      materialId: materialMap['CRUDE_SLUDGE'].id,
      batchNumber: 'CS-2025-001',
      quantity: 400.000,
      reservedQuantity: 0.000,
      averageCost: 0.280,
      lastPurchasePrice: 0.300,
      lastPurchaseDate: '2025-08-12',
      expiryDate: null,
      location: 'Tank Farm F-1',
      condition: 'used',
      notes: 'Crude tank bottom sludge',
      minimumStockLevel: 100.000,
      maximumStockLevel: 800.000,
      isActive: true
    }
  ];

  const scrapInventory = [
    // Pride Muscat Scrap Business Inventory
    {
      materialId: materialMap['ALU_CLEAN'].id,
      batchNumber: null,
      quantity: 2500.000,
      reservedQuantity: 200.000,
      averageCost: 0.780,
      lastPurchasePrice: 0.800,
      lastPurchaseDate: '2025-08-26',
      expiryDate: null,
      location: 'Yard A - Clean Metals',
      condition: 'used',
      notes: 'Clean aluminum cans and profiles',
      minimumStockLevel: 1000.000,
      maximumStockLevel: 5000.000,
      isActive: true
    },
    {
      materialId: materialMap['ALU_MIXED'].id,
      batchNumber: null,
      quantity: 1800.000,
      reservedQuantity: 0.000,
      averageCost: 0.620,
      lastPurchasePrice: 0.650,
      lastPurchaseDate: '2025-08-24',
      expiryDate: null,
      location: 'Yard A - Mixed Metals',
      condition: 'used',
      notes: 'Mixed aluminum alloys and scrap',
      minimumStockLevel: 500.000,
      maximumStockLevel: 3000.000,
      isActive: true
    },
    {
      materialId: materialMap['COP_BRIGHT'].id,
      batchNumber: null,
      quantity: 150.000,
      reservedQuantity: 25.000,
      averageCost: 6.000,
      lastPurchasePrice: 6.200,
      lastPurchaseDate: '2025-08-29',
      expiryDate: null,
      location: 'Secure Storage - Copper',
      condition: 'new',
      notes: 'Bright copper wire #1 grade',
      minimumStockLevel: 50.000,
      maximumStockLevel: 300.000,
      isActive: true
    },
    {
      materialId: materialMap['COP_HEAVY'].id,
      batchNumber: null,
      quantity: 280.000,
      reservedQuantity: 40.000,
      averageCost: 5.650,
      lastPurchasePrice: 5.800,
      lastPurchaseDate: '2025-08-27',
      expiryDate: null,
      location: 'Secure Storage - Copper',
      condition: 'used',
      notes: 'Heavy copper pipes and sheets',
      minimumStockLevel: 100.000,
      maximumStockLevel: 500.000,
      isActive: true
    },
    {
      materialId: materialMap['STL_HEAVY'].id,
      batchNumber: null,
      quantity: 8500.000,
      reservedQuantity: 500.000,
      averageCost: 0.260,
      lastPurchasePrice: 0.275,
      lastPurchaseDate: '2025-08-30',
      expiryDate: null,
      location: 'Yard B - Heavy Steel',
      condition: 'used',
      notes: 'Structural steel beams and plates',
      minimumStockLevel: 3000.000,
      maximumStockLevel: 15000.000,
      isActive: true
    },
    {
      materialId: materialMap['STL_LIGHT'].id,
      batchNumber: null,
      quantity: 3200.000,
      reservedQuantity: 0.000,
      averageCost: 0.200,
      lastPurchasePrice: 0.220,
      lastPurchaseDate: '2025-08-28',
      expiryDate: null,
      location: 'Yard B - Light Steel',
      condition: 'used',
      notes: 'Automotive parts and sheet metal',
      minimumStockLevel: 1000.000,
      maximumStockLevel: 6000.000,
      isActive: true
    },
    {
      materialId: materialMap['BRASS_MIXED'].id,
      batchNumber: null,
      quantity: 120.000,
      reservedQuantity: 15.000,
      averageCost: 3.050,
      lastPurchasePrice: 3.200,
      lastPurchaseDate: '2025-08-25',
      expiryDate: null,
      location: 'Secure Storage - Brass',
      condition: 'used',
      notes: 'Mixed brass fittings and decorative items',
      minimumStockLevel: 50.000,
      maximumStockLevel: 250.000,
      isActive: true
    },
    {
      materialId: materialMap['E_WASTE_BOARD'].id,
      batchNumber: 'PCB-2025-001',
      quantity: 45.000,
      reservedQuantity: 10.000,
      averageCost: 11.500,
      lastPurchasePrice: 12.000,
      lastPurchaseDate: '2025-08-20',
      expiryDate: null,
      location: 'Secure Storage - Electronics',
      condition: 'used',
      notes: 'Computer and electronic circuit boards',
      minimumStockLevel: 20.000,
      maximumStockLevel: 100.000,
      isActive: true
    },
    {
      materialId: materialMap['PLASTIC_PET'].id,
      batchNumber: null,
      quantity: 800.000,
      reservedQuantity: 0.000,
      averageCost: 0.300,
      lastPurchasePrice: 0.320,
      lastPurchaseDate: '2025-08-31',
      expiryDate: null,
      location: 'Yard C - Plastics',
      condition: 'used',
      notes: 'Clean PET bottles, labels removed',
      minimumStockLevel: 300.000,
      maximumStockLevel: 1500.000,
      isActive: true
    },
    {
      materialId: materialMap['RUBBER_TIRE'].id,
      batchNumber: null,
      quantity: 150.000,
      reservedQuantity: 0.000,
      averageCost: 2.200,
      lastPurchasePrice: 2.300,
      lastPurchaseDate: '2025-08-23',
      expiryDate: null,
      location: 'Yard D - Tires',
      condition: 'used',
      notes: 'Used passenger and light truck tires',
      minimumStockLevel: 50.000,
      maximumStockLevel: 300.000,
      isActive: true
    }
  ];

  // Clear existing inventory
  await knex('inventory').del();
  
  console.log('📦 Seeding inventory with opening stock...');
  
  await knex('inventory').insert(oilInventory);
  await knex('inventory').insert(scrapInventory);
  
  console.log('✅ Inventory seeded successfully');
  console.log(`   🛢️  Al Ramrami: ${oilInventory.length} oil inventory records`);
  console.log(`   ♻️  Pride Muscat: ${scrapInventory.length} scrap inventory records`);
  
  // Calculate total inventory values
  const totalOilValue = oilInventory.reduce((sum, item) => sum + (item.quantity * item.averageCost), 0);
  const totalScrapValue = scrapInventory.reduce((sum, item) => sum + (item.quantity * item.averageCost), 0);
  
  console.log(`   💰 Total oil inventory value: ${totalOilValue.toFixed(2)} OMR`);
  console.log(`   💰 Total scrap inventory value: ${totalScrapValue.toFixed(2)} OMR`);
};