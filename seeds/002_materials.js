/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> } 
 */
exports.seed = async function(knex) {
  
  const materials = [
    // Al Ramrami Oil Business Materials
    {
      code: 'ENG_OIL_DRUM',
      name: 'Engine Oil with Drums',
      description: 'Used engine oil including container drums',
      category: 'engine-oil',
      unit: 'drums',
      standardPrice: 25.000,
      minimumPrice: 22.000,
      density: 0.850,
      shelfLifeDays: 1095, // 3 years
      specifications: 'API CF-4, SAE 15W-40, Viscosity Index 120',
      trackBatches: true,
      isActive: true
    },
    {
      code: 'ENG_OIL_BULK',
      name: 'Engine Oil without Drums',
      description: 'Used engine oil excluding container',
      category: 'engine-oil',
      unit: 'liters',
      standardPrice: 1.200,
      minimumPrice: 1.000,
      density: 0.850,
      shelfLifeDays: 1095,
      specifications: 'API CF-4, SAE 15W-40',
      trackBatches: true,
      isActive: true
    },
    {
      code: 'EMPTY_DRUMS',
      name: 'Empty Drums',
      description: 'Empty oil drums for collection and resale',
      category: 'empty-drums',
      unit: 'pieces',
      standardPrice: 5.000,
      minimumPrice: 4.000,
      specifications: '200L capacity, steel construction',
      trackBatches: false,
      isActive: true
    },
    {
      code: 'TRANS_OIL',
      name: 'Transformer Oil',
      description: 'Electrical transformer insulating oil',
      category: 'transformer-oil',
      unit: 'liters',
      standardPrice: 2.500,
      minimumPrice: 2.200,
      density: 0.870,
      shelfLifeDays: 1825, // 5 years
      specifications: 'IEC 60296, Breakdown voltage >70kV',
      trackBatches: true,
      isActive: true
    },
    {
      code: 'LUBE_OIL',
      name: 'Hydraulic/Lube Oil',
      description: 'Industrial hydraulic and lubrication oil',
      category: 'lube-oil',
      unit: 'liters',
      standardPrice: 1.800,
      minimumPrice: 1.500,
      density: 0.860,
      shelfLifeDays: 1095,
      specifications: 'ISO VG 46, Anti-wear additives',
      trackBatches: true,
      isActive: true
    },
    {
      code: 'COOK_OIL',
      name: 'Used Cooking Oil',
      description: 'Used cooking oil for biodiesel production',
      category: 'cooking-oil',
      unit: 'liters',
      standardPrice: 0.800,
      minimumPrice: 0.600,
      density: 0.920,
      shelfLifeDays: 365,
      specifications: 'Free fatty acid content <10%, Moisture <2%',
      trackBatches: true,
      isActive: true
    },
    {
      code: 'DIESEL_FUEL',
      name: 'Diesel/Gas Oil',
      description: 'Used diesel fuel and gas oil',
      category: 'diesel',
      unit: 'liters',
      standardPrice: 0.450,
      minimumPrice: 0.400,
      density: 0.840,
      shelfLifeDays: 730,
      specifications: 'Cetane number >40, Sulfur content <500ppm',
      trackBatches: true,
      isActive: true
    },
    {
      code: 'CRUDE_SLUDGE',
      name: 'Crude Oil Sludge',
      description: 'Crude oil tank bottom sludge',
      category: 'lubricants',
      unit: 'liters',
      standardPrice: 0.300,
      minimumPrice: 0.250,
      density: 0.950,
      specifications: 'API Gravity 15-20, Water content <30%',
      trackBatches: true,
      isActive: true
    },
    {
      code: 'GEAR_OIL',
      name: 'Gear Oil',
      description: 'Used automotive and industrial gear oil',
      category: 'lubricants',
      unit: 'liters',
      standardPrice: 1.500,
      minimumPrice: 1.200,
      density: 0.890,
      shelfLifeDays: 1095,
      specifications: 'API GL-4, SAE 80W-90',
      trackBatches: true,
      isActive: true
    },
    {
      code: 'WASTE_OIL_MIX',
      name: 'Mixed Waste Oil',
      description: 'Mixed waste oil for fuel blending',
      category: 'lubricants',
      unit: 'liters',
      standardPrice: 0.350,
      minimumPrice: 0.300,
      density: 0.880,
      specifications: 'Mixed grade, suitable for fuel blending',
      trackBatches: false,
      isActive: true
    }
  ];

  const scrapMaterials = [
    // Pride Muscat Scrap Business Materials
    {
      code: 'ALU_CLEAN',
      name: 'Clean Aluminum',
      description: 'Clean aluminum scrap - cans, profiles, sheets',
      category: 'aluminum',
      unit: 'kg',
      standardPrice: 0.850,
      minimumPrice: 0.750,
      specifications: '99% pure aluminum, no coatings',
      trackBatches: false,
      isActive: true
    },
    {
      code: 'ALU_MIXED',
      name: 'Mixed Aluminum',
      description: 'Mixed aluminum scrap with various alloys',
      category: 'aluminum',
      unit: 'kg',
      standardPrice: 0.650,
      minimumPrice: 0.550,
      specifications: 'Various aluminum alloys, cleaned',
      trackBatches: false,
      isActive: true
    },
    {
      code: 'COP_BRIGHT',
      name: 'Bright Copper Wire',
      description: 'Clean bright copper wire #1',
      category: 'copper',
      unit: 'kg',
      standardPrice: 6.200,
      minimumPrice: 5.800,
      specifications: 'Minimum 99% copper content, no insulation',
      trackBatches: false,
      isActive: true
    },
    {
      code: 'COP_HEAVY',
      name: 'Heavy Copper',
      description: 'Heavy copper pipes, bus bars, sheets',
      category: 'copper',
      unit: 'kg',
      standardPrice: 5.800,
      minimumPrice: 5.400,
      specifications: 'Minimum 98% copper, thickness >1mm',
      trackBatches: false,
      isActive: true
    },
    {
      code: 'STL_HEAVY',
      name: 'Heavy Steel',
      description: 'Heavy steel scrap - beams, plates, machinery',
      category: 'steel',
      unit: 'kg',
      standardPrice: 0.280,
      minimumPrice: 0.240,
      specifications: 'Structural steel, minimum 6mm thickness',
      trackBatches: false,
      isActive: true
    },
    {
      code: 'STL_LIGHT',
      name: 'Light Steel',
      description: 'Light steel scrap - sheets, automotive parts',
      category: 'steel',
      unit: 'kg',
      standardPrice: 0.220,
      minimumPrice: 0.180,
      specifications: 'Light gauge steel, under 6mm thickness',
      trackBatches: false,
      isActive: true
    },
    {
      code: 'BRASS_MIXED',
      name: 'Mixed Brass',
      description: 'Mixed brass scrap - fittings, valves, decorative',
      category: 'brass',
      unit: 'kg',
      standardPrice: 3.200,
      minimumPrice: 2.900,
      specifications: 'Brass alloy, minimum 60% copper content',
      trackBatches: false,
      isActive: true
    },
    {
      code: 'E_WASTE_BOARD',
      name: 'Electronic Circuit Boards',
      description: 'Computer and electronic circuit boards',
      category: 'electronic-waste',
      unit: 'kg',
      standardPrice: 12.000,
      minimumPrice: 10.000,
      specifications: 'Mixed PCB boards, gold-plated contacts',
      trackBatches: true,
      isActive: true
    },
    {
      code: 'PLASTIC_PET',
      name: 'PET Plastic Bottles',
      description: 'Clear PET plastic bottles',
      category: 'plastic',
      unit: 'kg',
      standardPrice: 0.320,
      minimumPrice: 0.280,
      specifications: 'Clear PET bottles, labels removed',
      trackBatches: false,
      isActive: true
    },
    {
      code: 'RUBBER_TIRE',
      name: 'Tire Rubber',
      description: 'Used tire rubber for recycling',
      category: 'rubber',
      unit: 'pieces',
      standardPrice: 2.500,
      minimumPrice: 2.000,
      specifications: 'Passenger and light truck tires',
      trackBatches: false,
      isActive: true
    }
  ];

  // Insert materials for both companies
  
  console.log('🔧 Seeding materials for both companies...');
  
  await knex('materials').insert(materials);
  await knex('materials').insert(scrapMaterials);
  
  console.log('✅ Materials seeded successfully');
  console.log(`   📦 Al Ramrami: ${materials.length} oil products`);
  console.log(`   📦 Pride Muscat: ${scrapMaterials.length} scrap materials`);
};