/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> } 
 */
exports.seed = async function(knex) {
  
  // Get reference data
  const suppliers = await knex('suppliers').select('id', 'code');
  const materials = await knex('materials').select('id', 'code');
  
  const supplierMap = {};
  suppliers.forEach(s => supplierMap[s.code] = s.id);
  
  const materialMap = {};
  materials.forEach(m => materialMap[m.code] = m.id);

  const alramramiPurchaseOrders = [
    {
      orderNumber: 'PO-2025-001',
      supplierId: null, // Oil business - direct collection
      orderDate: '2025-08-10',
      deliveryDate: '2025-08-12',
      status: 'received',
      subtotal: 3600.00,
      taxAmount: 180.00,
      totalAmount: 3780.00,
      paymentStatus: 'paid',
      paymentTerms: 7,
      currency: 'OMR',
      notes: 'Used engine oil collection - Service stations',
      createdBy: 2,
      approvedBy: 1,
      approvedAt: '2025-08-10 08:30:00'
    },
    {
      orderNumber: 'PO-2025-002',
      supplierId: null,
      orderDate: '2025-08-14',
      deliveryDate: '2025-08-16',
      status: 'received',
      subtotal: 2880.00,
      taxAmount: 144.00,
      totalAmount: 3024.00,
      paymentStatus: 'paid',
      paymentTerms: 5,
      currency: 'OMR',
      notes: 'Transformer oil from power company',
      createdBy: 3,
      approvedBy: 1,
      approvedAt: '2025-08-14 14:00:00'
    },
    {
      orderNumber: 'PO-2025-003',
      supplierId: null,
      orderDate: '2025-08-18',
      deliveryDate: '2025-08-20',
      status: 'received',
      subtotal: 480.00,
      taxAmount: 24.00,
      totalAmount: 504.00,
      paymentStatus: 'paid',
      paymentTerms: 3,
      currency: 'OMR',
      notes: 'Used cooking oil from restaurants',
      createdBy: 2,
      approvedBy: 2,
      approvedAt: '2025-08-18 16:45:00'
    },
    {
      orderNumber: 'PO-2025-004',
      supplierId: null,
      orderDate: '2025-08-22',
      deliveryDate: '2025-08-25',
      status: 'received',
      subtotal: 1300.00,
      taxAmount: 65.00,
      totalAmount: 1365.00,
      paymentStatus: 'paid',
      paymentTerms: 7,
      currency: 'OMR',
      notes: 'Hydraulic oil from construction sites',
      createdBy: 3,
      approvedBy: 1,
      approvedAt: '2025-08-22 11:15:00'
    },
    {
      orderNumber: 'PO-2025-005',
      supplierId: null,
      orderDate: '2025-08-26',
      deliveryDate: '2025-08-28',
      status: 'pending',
      subtotal: 675.00,
      taxAmount: 33.75,
      totalAmount: 708.75,
      paymentStatus: 'pending',
      paymentTerms: 10,
      currency: 'OMR',
      notes: 'Diesel fuel collection - Fleet operators',
      createdBy: 2,
      approvedBy: null,
      approvedAt: null
    }
  ];

  const prideMuscatPurchaseOrders = [
    {
      orderNumber: 'PO-2025-101',
      supplierId: supplierMap['SUPP-001'],
      orderDate: '2025-08-12',
      deliveryDate: '2025-08-15',
      status: 'received',
      subtotal: 1950.00,
      taxAmount: 97.50,
      totalAmount: 2047.50,
      paymentStatus: 'paid',
      paymentTerms: 7,
      currency: 'OMR',
      notes: 'Aluminum collection from Metal Collectors Association',
      createdBy: 4,
      approvedBy: 4,
      approvedAt: '2025-08-12 10:30:00'
    },
    {
      orderNumber: 'PO-2025-102',
      supplierId: supplierMap['SUPP-002'],
      orderDate: '2025-08-16',
      deliveryDate: '2025-08-18',
      status: 'received',
      subtotal: 1736.00,
      taxAmount: 86.80,
      totalAmount: 1822.80,
      paymentStatus: 'paid',
      paymentTerms: 14,
      currency: 'OMR',
      notes: 'Copper scrap from Sohar Scrap Trading',
      createdBy: 5,
      approvedBy: 4,
      approvedAt: '2025-08-16 13:15:00'
    },
    {
      orderNumber: 'PO-2025-103',
      supplierId: supplierMap['SUPP-003'],
      orderDate: '2025-08-20',
      deliveryDate: '2025-08-22',
      status: 'received',
      subtotal: 540.00,
      taxAmount: 27.00,
      totalAmount: 567.00,
      paymentStatus: 'paid',
      paymentTerms: 10,
      currency: 'OMR',
      notes: 'Electronic circuit boards from E-Waste Solutions',
      createdBy: 6,
      approvedBy: 4,
      approvedAt: '2025-08-20 15:45:00'
    },
    {
      orderNumber: 'PO-2025-104',
      supplierId: supplierMap['SUPP-004'],
      orderDate: '2025-08-24',
      deliveryDate: '2025-08-27',
      status: 'received',
      subtotal: 2380.00,
      taxAmount: 119.00,
      totalAmount: 2499.00,
      paymentStatus: 'pending',
      paymentTerms: 21,
      currency: 'OMR',
      notes: 'Mixed steel from Dhofar Recycling',
      createdBy: 5,
      approvedBy: 4,
      approvedAt: '2025-08-24 09:20:00'
    },
    {
      orderNumber: 'PO-2025-105',
      supplierId: supplierMap['SUPP-005'],
      orderDate: '2025-08-28',
      deliveryDate: '2025-08-30',
      status: 'pending',
      subtotal: 256.00,
      taxAmount: 12.80,
      totalAmount: 268.80,
      paymentStatus: 'pending',
      paymentTerms: 5,
      currency: 'OMR',
      notes: 'PET bottles from Plastic Recovery Network',
      createdBy: 4,
      approvedBy: null,
      approvedAt: null
    },
    {
      orderNumber: 'PO-2025-106',
      supplierId: supplierMap['SUPP-006'],
      orderDate: '2025-08-30',
      deliveryDate: '2025-09-02',
      status: 'approved',
      subtotal: 345.00,
      taxAmount: 17.25,
      totalAmount: 362.25,
      paymentStatus: 'pending',
      paymentTerms: 7,
      currency: 'OMR',
      notes: 'Used tires from Tire Collection Services',
      createdBy: 6,
      approvedBy: 4,
      approvedAt: '2025-08-30 12:00:00'
    }
  ];

  // Create purchase order items
  const purchaseOrderItems = [
    // Al Ramrami Purchase Orders
    // PO-2025-001 (Engine oil collection)
    { orderNumber: 'PO-2025-001', materialId: materialMap['ENG_OIL_DRUM'].id, quantity: 120.000, unitPrice: 23.500, totalPrice: 2820.00, notes: 'Collection from service stations' },
    { orderNumber: 'PO-2025-001', materialId: materialMap['ENG_OIL_BULK'].id, quantity: 650.000, unitPrice: 1.200, totalPrice: 780.00, notes: 'Bulk collection without drums' },
    
    // PO-2025-002 (Transformer oil)
    { orderNumber: 'PO-2025-002', materialId: materialMap['TRANS_OIL'].id, quantity: 1200.000, unitPrice: 2.400, totalPrice: 2880.00, notes: 'From power company maintenance' },
    
    // PO-2025-003 (Cooking oil)
    { orderNumber: 'PO-2025-003', materialId: materialMap['COOK_OIL'].id, quantity: 600.000, unitPrice: 0.800, totalPrice: 480.00, notes: 'Restaurant collection' },
    
    // PO-2025-004 (Hydraulic oil)
    { orderNumber: 'PO-2025-004', materialId: materialMap['LUBE_OIL'].id, quantity: 800.000, unitPrice: 1.625, totalPrice: 1300.00, notes: 'Construction equipment oil' },
    
    // PO-2025-005 (Diesel fuel)
    { orderNumber: 'PO-2025-005', materialId: materialMap['DIESEL_FUEL'].id, quantity: 1500.000, unitPrice: 0.450, totalPrice: 675.00, notes: 'Fleet operator collection' },
    
    // Pride Muscat Purchase Orders
    // PO-2025-101 (Aluminum from Metal Collectors)
    { orderNumber: 'PO-2025-101', materialId: materialMap['ALU_CLEAN'].id, quantity: 2000.000, unitPrice: 0.780, totalPrice: 1560.00, notes: 'Clean aluminum cans' },
    { orderNumber: 'PO-2025-101', materialId: materialMap['ALU_MIXED'].id, quantity: 500.000, unitPrice: 0.780, totalPrice: 390.00, notes: 'Mixed aluminum scrap' },
    
    // PO-2025-102 (Copper from Sohar Scrap)
    { orderNumber: 'PO-2025-102', materialId: materialMap['COP_BRIGHT'].id, quantity: 150.000, unitPrice: 6.000, totalPrice: 900.00, notes: 'Bright copper wire' },
    { orderNumber: 'PO-2025-102', materialId: materialMap['COP_HEAVY'].id, quantity: 140.000, unitPrice: 5.650, totalPrice: 791.00, notes: 'Heavy copper pipes' },
    { orderNumber: 'PO-2025-102', materialId: materialMap['BRASS_MIXED'].id, quantity: 45.000, unitPrice: 3.200, totalPrice: 144.00, notes: 'Mixed brass fittings' },
    
    // PO-2025-103 (Electronic waste)
    { orderNumber: 'PO-2025-103', materialId: materialMap['E_WASTE_BOARD'].id, quantity: 45.000, unitPrice: 12.000, totalPrice: 540.00, notes: 'Computer circuit boards' },
    
    // PO-2025-104 (Steel from Dhofar)
    { orderNumber: 'PO-2025-104', materialId: materialMap['STL_HEAVY'].id, quantity: 8000.000, unitPrice: 0.260, totalPrice: 2080.00, notes: 'Heavy structural steel' },
    { orderNumber: 'PO-2025-104', materialId: materialMap['STL_LIGHT'].id, quantity: 1200.000, unitPrice: 0.250, totalPrice: 300.00, notes: 'Light automotive steel' },
    
    // PO-2025-105 (PET bottles)
    { orderNumber: 'PO-2025-105', materialId: materialMap['PLASTIC_PET'].id, quantity: 800.000, unitPrice: 0.320, totalPrice: 256.00, notes: 'Clean PET bottles' },
    
    // PO-2025-106 (Used tires)
    { orderNumber: 'PO-2025-106', materialId: materialMap['RUBBER_TIRE'].id, quantity: 150.000, unitPrice: 2.300, totalPrice: 345.00, notes: 'Passenger car tires' }
  ];

  // Clear existing data
  await knex('purchase_order_items').del();
  await knex('purchase_orders').del();
  
  console.log('🛒 Seeding purchase orders and items...');
  
  // Insert purchase orders
  await knex('purchase_orders').insert(alramramiPurchaseOrders);
  await knex('purchase_orders').insert(prideMuscatPurchaseOrders);
  
  // Get purchase order IDs and update items with proper order IDs
  const orders = await knex('purchase_orders').select('id', 'orderNumber');
  const orderMap = {};
  orders.forEach(o => orderMap[o.orderNumber] = o.id);
  
  // Add order IDs to items
  const itemsWithOrderIds = purchaseOrderItems.map(item => ({
    purchaseOrderId: orderMap[item.orderNumber],
    materialId: item.materialId,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    totalPrice: item.totalPrice,
    notes: item.notes
  }));
  
  await knex('purchase_order_items').insert(itemsWithOrderIds);
  
  console.log('✅ Purchase orders seeded successfully');
  console.log(`   🛢️  Al Ramrami: ${alramramiPurchaseOrders.length} purchase orders (direct collection)`);
  console.log(`   ♻️  Pride Muscat: ${prideMuscatPurchaseOrders.length} purchase orders (from suppliers)`);
  console.log(`   📝 Total purchase items: ${purchaseOrderItems.length}`);
  
  // Calculate totals
  const alramramiTotal = alramramiPurchaseOrders.reduce((sum, order) => sum + order.totalAmount, 0);
  const prideMuscatTotal = prideMuscatPurchaseOrders.reduce((sum, order) => sum + order.totalAmount, 0);
  
  console.log(`   💰 Al Ramrami purchase value: ${alramramiTotal.toFixed(2)} OMR`);
  console.log(`   💰 Pride Muscat purchase value: ${prideMuscatTotal.toFixed(2)} OMR`);
};