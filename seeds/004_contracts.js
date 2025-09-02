/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> } 
 */
exports.seed = async function(knex) {
  
    // Get customer, material, and user IDs
  const customers = await knex('customers').select('id', 'name');
  const materials = await knex('materials').select('id', 'code');
  const adminUser = await knex('users').select('id', 'email').where('email', 'admin@alramrami.com').first();
  
  const customerMap = {};
  customers.forEach(c => customerMap[c.name] = c.id);
  
  const materialMap = {};
  materials.forEach(m => materialMap[m.code] = m.id);
  
  const contracts = [
    {
      contractNumber: 'CON-2025-001',
      customerId: customerMap['ABC Manufacturing LLC'],
      startDate: '2025-01-01',
      endDate: '2025-12-31',
      status: 'active',
      title: 'ABC Manufacturing Annual Oil Supply Contract',
      terms: 'Net 30 payment terms, monthly delivery schedule, fixed rates locked until expiry',
      totalValue: 120000.00,
      currency: 'OMR',
      createdBy: adminUser.id // Admin user
    },
    {
      contractNumber: 'CON-2025-002', 
      customerId: customerMap['XYZ Power Plant'],
      startDate: '2025-02-01',
      endDate: '2026-01-31',
      status: 'active',
      title: 'XYZ Power Plant Maintenance Contract',
      terms: 'Net 45 payment terms, on-demand delivery, volume discounts applicable',
      totalValue: 180000.00,
      currency: 'OMR',
      createdBy: adminUser.id
    },
    {
      contractNumber: 'CON-2025-003',
      customerId: customerMap['Global Shipping Co'],
      startDate: '2025-03-01',
      endDate: '2025-09-30',
      status: 'active',
      title: 'Global Shipping Fleet Lubrication Contract',
      terms: 'Net 30 payment terms, emergency delivery available, minimum price guarantees',
      totalValue: 95000.00,
      currency: 'OMR',
      createdBy: adminUser.id
    },
    {
      contractNumber: 'CON-2024-015',
      customerId: customerMap['Royal Navy Base'],
      startDate: '2024-10-01',
      endDate: '2024-12-31',
      status: 'expired',
      title: 'Royal Navy Base Oil Supply (Expired)',
      terms: 'Net 90 payment terms, security clearance required, expired rates pending renewal',
      totalValue: 75000.00,
      currency: 'OMR',
      createdBy: adminUser.id
    }
  ];

    const contractRates = [
    // ABC Manufacturing Contract (CON-2025-001) - Mixed pricing model
    {
      materialId: materialMap['ENG_OIL_DRUM'],
      contractRate: 24.000,
      rateType: 'fixed_rate',
      isActive: true,
      description: 'Fixed negotiated rate - active until Dec 2025'
    },
    {
      materialId: materialMap['ENG_OIL_BULK'],
      contractRate: 0, // Will use discount percentage
      discountPercentage: 8.5,
      rateType: 'discount_percentage',
      isActive: true,
      description: '8.5% discount off standard price'
    },
    {
      materialId: materialMap['LUBE_OIL'],
      contractRate: 1.750,
      rateType: 'minimum_price_guarantee',
      minimumPrice: 1.750,
      isActive: true,
      description: 'Minimum price guarantee - whichever is lower'
    },
    
    // XYZ Power Plant Contract (CON-2025-002) - Fixed rates
    {
      materialId: materialMap['TRANS_OIL'],
      contractRate: 2.400,
      rateType: 'fixed_rate',
      isActive: true,
      description: 'Fixed rate for transformer oil - active until Jan 2026'
    },
    {
      materialId: materialMap['LUBE_OIL'],
      contractRate: 1.650,
      rateType: 'fixed_rate',
      isActive: true,
      description: 'Fixed hydraulic oil rate'
    },
    
    // Global Shipping Contract (CON-2025-003) - Price guarantees
    {
      materialId: materialMap['ENG_OIL_BULK'],
      contractRate: 1.150,
      rateType: 'minimum_price_guarantee',
      minimumPrice: 1.150,
      isActive: true,
      description: 'Price guarantee for marine engines - active until Sep 2025'
    },
    {
      materialId: materialMap['LUBE_OIL'],
      contractRate: 1.700,
      rateType: 'minimum_price_guarantee',
      minimumPrice: 1.700,
      isActive: true,
      description: 'Price guarantee for deck machinery'
    },
    
    // Royal Navy Contract (EXPIRED) - For testing expired rates
    {
      materialId: materialMap['ENG_OIL_DRUM'],
      contractRate: 0,
      discountPercentage: 15.0,
      rateType: 'discount_percentage',
      isActive: false,
      description: '15% government discount - EXPIRED, pending renewal'
    },
    {
      materialId: materialMap['DIESEL_FUEL'],
      contractRate: 0.420,
      rateType: 'fixed_rate',
      isActive: false,
      description: 'Fixed diesel rate - EXPIRED'
    }
  ];

  // Insert contracts
  
  console.log('📄 Seeding contracts and rates...');
  
  // Insert contracts
  const insertedContracts = await knex('contracts').insert(contracts);
  
  // Get the contract IDs and update contract rates
  const contractRecords = await knex('contracts').select('id', 'contractNumber');
  const contractIdMap = {};
  contractRecords.forEach(c => contractIdMap[c.contractNumber] = c.id);
  
  // Add contract IDs to contract rates
  const ratesWithContractIds = contractRates.map((rate, index) => {
    let contractId;
    if (index < 3) contractId = contractIdMap['CON-2025-001']; // ABC Manufacturing
    else if (index < 5) contractId = contractIdMap['CON-2025-002']; // XYZ Power Plant
    else if (index < 7) contractId = contractIdMap['CON-2025-003']; // Global Shipping
    else contractId = contractIdMap['CON-2024-015']; // Royal Navy (Expired)
    
    return { contractId, ...rate };
  });
  
  await knex('contract_rates').insert(ratesWithContractIds);
  
  console.log('✅ Contracts and rates seeded successfully');
  console.log(`   📄 Contracts: ${contracts.length} (3 active, 1 expired)`);
  console.log(`   💰 Contract rates: ${contractRates.length} across all pricing models`);
};