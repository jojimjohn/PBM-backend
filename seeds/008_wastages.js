/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> } 
 */
exports.seed = async function(knex) {
  
  // Get reference data
  const materials = await knex('materials').select('id', 'code');
  const inventory = await knex('inventory').select('id', 'materialId', 'batchNumber');
  
  const materialMap = {};
  materials.forEach(m => materialMap[m.code] = m.id);
  
  const inventoryMap = {};
  inventory.forEach(i => inventoryMap[i.materialId] = i.id);

  const alramramiWastages = [
    {
      wastageNumber: 'ALR-W-20250815001',
      materialId: materialMap['ENG_OIL_DRUM'],
      inventoryId: inventoryMap[materialMap['ENG_OIL_DRUM']],
      quantity: 5.000,
      unitCost: 23.500,
      totalCost: 117.50,
      wasteType: 'spillage',
      reason: 'Tank overflow during transfer',
      description: 'Engine oil spillage occurred during tank-to-tank transfer operation. Immediate cleanup performed.',
      wastageDate: '2025-08-15',
      location: 'Tank Farm A-1',
      status: 'approved',
      reportedBy: 2,
      approvedBy: 1,
      approvedAt: '2025-08-16 09:30:00',
      approvalNotes: 'Approved - operational spillage within normal limits'
    },
    {
      wastageNumber: 'ALR-W-20250817002',
      materialId: materialMap['ENG_OIL_BULK'],
      inventoryId: inventoryMap[materialMap['ENG_OIL_BULK']],
      quantity: 25.000,
      unitCost: 1.150,
      totalCost: 28.75,
      wasteType: 'contamination',
      reason: 'Water contamination detected',
      description: 'Oil contaminated with water during storage. Quality testing showed 8% water content.',
      wastageDate: '2025-08-17',
      location: 'Tank Farm A-2',
      status: 'approved',
      reportedBy: 3,
      approvedBy: 1,
      approvedAt: '2025-08-18 14:15:00',
      approvalNotes: 'Approved - contamination due to tank seal failure'
    },
    {
      wastageNumber: 'ALR-W-20250820003',
      materialId: materialMap['COOK_OIL'],
      inventoryId: inventoryMap[materialMap['COOK_OIL']],
      quantity: 15.000,
      unitCost: 0.750,
      totalCost: 11.25,
      wasteType: 'expiry',
      reason: 'Free fatty acid content exceeded limits',
      description: 'Cooking oil quality degraded beyond acceptable levels for biodiesel production.',
      wastageDate: '2025-08-20',
      location: 'Tank Farm D-1',
      status: 'approved',
      reportedBy: 2,
      approvedBy: 2,
      approvedAt: '2025-08-21 11:00:00',
      approvalNotes: 'Approved - natural degradation over time'
    },
    {
      wastageNumber: 'ALR-W-20250822004',
      materialId: materialMap['EMPTY_DRUMS'],
      inventoryId: inventoryMap[materialMap['EMPTY_DRUMS']],
      quantity: 3.000,
      unitCost: 4.750,
      totalCost: 14.25,
      wasteType: 'damage',
      reason: 'Physical damage during handling',
      description: 'Drums damaged during forklift operations - holes and dents making them unusable.',
      wastageDate: '2025-08-22',
      location: 'Storage Yard B',
      status: 'pending',
      reportedBy: 3,
      approvedBy: null,
      approvedAt: null,
      approvalNotes: null
    },
    {
      wastageNumber: 'ALR-W-20250825005',
      materialId: materialMap['TRANS_OIL'],
      inventoryId: inventoryMap[materialMap['TRANS_OIL']],
      quantity: 8.000,
      unitCost: 2.350,
      totalCost: 18.80,
      wasteType: 'sorting_loss',
      reason: 'Quality grading rejection',
      description: 'Oil failed electrical breakdown voltage test - unsuitable for high-voltage applications.',
      wastageDate: '2025-08-25',
      location: 'Tank Farm C-1',
      status: 'rejected',
      reportedBy: 2,
      approvedBy: 1,
      approvedAt: '2025-08-26 08:45:00',
      approvalNotes: 'Rejected - can be downgraded to lubricant use'
    }
  ];

  const prideMuscatWastages = [
    {
      wastageNumber: 'PM-W-20250816001',
      materialId: materialMap['ALU_CLEAN'],
      inventoryId: inventoryMap[materialMap['ALU_CLEAN']],
      quantity: 12.000,
      unitCost: 0.780,
      totalCost: 9.36,
      wasteType: 'contamination',
      reason: 'Steel contamination found',
      description: 'Aluminum batch contaminated with ferrous materials - failed magnet separation test.',
      wastageDate: '2025-08-16',
      location: 'Yard A - Clean Metals',
      status: 'approved',
      reportedBy: 5,
      approvedBy: 4,
      approvedAt: '2025-08-17 10:20:00',
      approvalNotes: 'Approved - reclassify as mixed aluminum'
    },
    {
      wastageNumber: 'PM-W-20250818002',
      materialId: materialMap['COP_BRIGHT'],
      inventoryId: inventoryMap[materialMap['COP_BRIGHT']],
      quantity: 2.500,
      unitCost: 6.000,
      totalCost: 15.00,
      wasteType: 'theft',
      reason: 'Missing inventory during audit',
      description: 'Copper wire inventory shortage discovered during monthly stock audit.',
      wastageDate: '2025-08-18',
      location: 'Secure Storage - Copper',
      status: 'approved',
      reportedBy: 4,
      approvedBy: 4,
      approvedAt: '2025-08-19 15:30:00',
      approvalNotes: 'Approved - security measures to be reviewed'
    },
    {
      wastageNumber: 'PM-W-20250821003',
      materialId: materialMap['STL_LIGHT'],
      inventoryId: inventoryMap[materialMap['STL_LIGHT']],
      quantity: 45.000,
      unitCost: 0.200,
      totalCost: 9.00,
      wasteType: 'handling_damage',
      reason: 'Damage during crane operations',
      description: 'Light steel pieces scattered and damaged during crane loading operations.',
      wastageDate: '2025-08-21',
      location: 'Yard B - Light Steel',
      status: 'approved',
      reportedBy: 6,
      approvedBy: 4,
      approvedAt: '2025-08-22 13:15:00',
      approvalNotes: 'Approved - operator training required'
    },
    {
      wastageNumber: 'PM-W-20250823004',
      materialId: materialMap['PLASTIC_PET'],
      inventoryId: inventoryMap[materialMap['PLASTIC_PET']],
      quantity: 8.000,
      unitCost: 0.300,
      totalCost: 2.40,
      wasteType: 'quality_rejection',
      reason: 'Color contamination',
      description: 'PET bottles with colored plastic mixed in - failed export quality standards.',
      wastageDate: '2025-08-23',
      location: 'Yard C - Plastics',
      status: 'pending',
      reportedBy: 5,
      approvedBy: null,
      approvedAt: null,
      approvalNotes: null
    },
    {
      wastageNumber: 'PM-W-20250826005',
      materialId: materialMap['E_WASTE_BOARD'],
      inventoryId: inventoryMap[materialMap['E_WASTE_BOARD']],
      quantity: 1.200,
      unitCost: 11.500,
      totalCost: 13.80,
      wasteType: 'transport_loss',
      reason: 'Lost during transportation',
      description: 'Circuit boards fell off truck during transport to processing facility.',
      wastageDate: '2025-08-26',
      location: 'In Transit',
      status: 'rejected',
      reportedBy: 4,
      approvedBy: 4,
      approvedAt: '2025-08-27 09:00:00',
      approvalNotes: 'Rejected - investigate transport procedures'
    }
  ];

  // Clear existing data
  await knex('wastages').del();
  
  console.log('🗑️ Seeding wastage records...');
  
  await knex('wastages').insert(alramramiWastages);
  await knex('wastages').insert(prideMuscatWastages);
  
  console.log('✅ Wastages seeded successfully');
  console.log(`   🛢️  Al Ramrami: ${alramramiWastages.length} wastage records`);
  console.log(`   ♻️  Pride Muscat: ${prideMuscatWastages.length} wastage records`);
  
  // Calculate wastage costs
  const alramramiWastageCost = alramramiWastages.reduce((sum, w) => sum + w.totalCost, 0);
  const prideMuscatWastageCost = prideMuscatWastages.reduce((sum, w) => sum + w.totalCost, 0);
  
  console.log(`   💸 Al Ramrami wastage cost: ${alramramiWastageCost.toFixed(2)} OMR`);
  console.log(`   💸 Pride Muscat wastage cost: ${prideMuscatWastageCost.toFixed(2)} OMR`);
  
  // Status breakdown
  const alramramiApproved = alramramiWastages.filter(w => w.status === 'approved').length;
  const alramramiPending = alramramiWastages.filter(w => w.status === 'pending').length;
  const alramramiRejected = alramramiWastages.filter(w => w.status === 'rejected').length;
  
  const prideMuscatApproved = prideMuscatWastages.filter(w => w.status === 'approved').length;
  const prideMuscatPending = prideMuscatWastages.filter(w => w.status === 'pending').length;
  const prideMuscatRejected = prideMuscatWastages.filter(w => w.status === 'rejected').length;
  
  console.log(`   📊 Al Ramrami status: ${alramramiApproved} approved, ${alramramiPending} pending, ${alramramiRejected} rejected`);
  console.log(`   📊 Pride Muscat status: ${prideMuscatApproved} approved, ${prideMuscatPending} pending, ${prideMuscatRejected} rejected`);
};