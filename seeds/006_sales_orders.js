/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> } 
 */
exports.seed = async function(knex) {
  
  // Get reference data
  const customers = await knex('customers').select('id', 'name');
  const materials = await knex('materials').select('id', 'code', 'standardPrice');
  const suppliers = await knex('suppliers').select('id', 'code');
  
  const customerMap = {};
  customers.forEach(c => customerMap[c.name] = c.id);
  
  const materialMap = {};
  materials.forEach(m => materialMap[m.code] = { id: m.id, price: m.standardPrice });
  
  const supplierMap = {};
  suppliers.forEach(s => supplierMap[s.code] = s.id);

  const alramramiSalesOrders = [
    {
      orderNumber: 'SO-2025-001',
      customerId: customerMap['CUST-001'],
      orderDate: '2025-08-15',
      deliveryDate: '2025-08-20',
      status: 'delivered',
      subtotal: 3750.00,
      taxAmount: 187.50,
      totalAmount: 3937.50,
      paymentStatus: 'paid',
      paymentTerms: 30,
      currency: 'OMR',
      notes: 'Regular monthly order - ABC Manufacturing',
      createdBy: 1,
      approvedBy: 1,
      approvedAt: '2025-08-15 14:30:00'
    },
    {
      orderNumber: 'SO-2025-002',
      customerId: customerMap['CUST-002'],
      orderDate: '2025-08-18',
      deliveryDate: '2025-08-25',
      status: 'delivered',
      subtotal: 2880.00,
      taxAmount: 144.00,
      totalAmount: 3024.00,
      paymentStatus: 'pending',
      paymentTerms: 45,
      currency: 'OMR',
      notes: 'Power plant maintenance oil supply',
      createdBy: 2,
      approvedBy: 1,
      approvedAt: '2025-08-18 09:15:00'
    },
    {
      orderNumber: 'SO-2025-003',
      customerId: customerMap['CUST-003'],
      orderDate: '2025-08-20',
      deliveryDate: '2025-08-27',
      status: 'pending',
      subtotal: 1725.00,
      taxAmount: 86.25,
      totalAmount: 1811.25,
      paymentStatus: 'pending',
      paymentTerms: 30,
      currency: 'OMR',
      notes: 'Marine fleet engine oil supply',
      createdBy: 3,
      approvedBy: null,
      approvedAt: null
    },
    {
      orderNumber: 'SO-2025-004',
      customerId: customerMap['CUST-004'],
      orderDate: '2025-08-22',
      deliveryDate: '2025-08-24',
      status: 'delivered',
      subtotal: 275.00,
      taxAmount: 13.75,
      totalAmount: 288.75,
      paymentStatus: 'paid',
      paymentTerms: 15,
      currency: 'OMR',
      notes: 'Walk-in customer - cash sale',
      createdBy: 3,
      approvedBy: 2,
      approvedAt: '2025-08-22 11:45:00'
    },
    {
      orderNumber: 'SO-2025-005',
      customerId: customerMap['CUST-005'],
      orderDate: '2025-08-25',
      deliveryDate: '2025-08-30',
      status: 'in-progress',
      subtotal: 4200.00,
      taxAmount: 210.00,
      totalAmount: 4410.00,
      paymentStatus: 'pending',
      paymentTerms: 60,
      currency: 'OMR',
      notes: 'Construction project oil supply',
      createdBy: 2,
      approvedBy: 1,
      approvedAt: '2025-08-25 15:20:00'
    },
    {
      orderNumber: 'SO-2025-006',
      customerId: customerMap['CUST-006'],
      orderDate: '2025-08-28',
      deliveryDate: '2025-09-05',
      status: 'approved',
      subtotal: 6750.00,
      taxAmount: 337.50,
      totalAmount: 7087.50,
      paymentStatus: 'pending',
      paymentTerms: 90,
      currency: 'OMR',
      notes: 'Government contract - Royal Navy Base',
      createdBy: 1,
      approvedBy: 1,
      approvedAt: '2025-08-28 10:00:00'
    }
  ];

  const prideMuscatSalesOrders = [
    {
      orderNumber: 'SO-2025-101',
      customerId: null, // Scrap business - direct sales
      orderDate: '2025-08-16',
      deliveryDate: '2025-08-18',
      status: 'delivered',
      subtotal: 2125.00,
      taxAmount: 106.25,
      totalAmount: 2231.25,
      paymentStatus: 'paid',
      paymentTerms: 7,
      currency: 'OMR',
      notes: 'Aluminum scrap export - Container Load',
      createdBy: 4,
      approvedBy: 4,
      approvedAt: '2025-08-16 13:30:00'
    },
    {
      orderNumber: 'SO-2025-102',
      customerId: null,
      orderDate: '2025-08-21',
      deliveryDate: '2025-08-25',
      status: 'delivered',
      subtotal: 1674.00,
      taxAmount: 83.70,
      totalAmount: 1757.70,
      paymentStatus: 'paid',
      paymentTerms: 7,
      currency: 'OMR',
      notes: 'Copper wire export',
      createdBy: 5,
      approvedBy: 4,
      approvedAt: '2025-08-21 16:15:00'
    },
    {
      orderNumber: 'SO-2025-103',
      customerId: null,
      orderDate: '2025-08-26',
      deliveryDate: '2025-08-30',
      status: 'in-progress',
      subtotal: 2380.00,
      taxAmount: 119.00,
      totalAmount: 2499.00,
      paymentStatus: 'pending',
      paymentTerms: 14,
      currency: 'OMR',
      notes: 'Mixed steel scrap - local market',
      createdBy: 6,
      approvedBy: 4,
      approvedAt: '2025-08-26 12:00:00'
    },
    {
      orderNumber: 'SO-2025-104',
      customerId: null,
      orderDate: '2025-08-29',
      deliveryDate: '2025-09-02',
      status: 'approved',
      subtotal: 540.00,
      taxAmount: 27.00,
      totalAmount: 567.00,
      paymentStatus: 'pending',
      paymentTerms: 7,
      currency: 'OMR',
      notes: 'Electronic waste circuit boards',
      createdBy: 5,
      approvedBy: null,
      approvedAt: null
    }
  ];

  // Create sales order items
  const salesOrderItems = [
    // SO-2025-001 (ABC Manufacturing)
    { orderNumber: 'SO-2025-001', materialId: materialMap['ENG_OIL_DRUM'].id, quantity: 100.000, unitPrice: 24.000, totalPrice: 2400.00, notes: 'Contract rate applied' },
    { orderNumber: 'SO-2025-001', materialId: materialMap['ENG_OIL_BULK'].id, quantity: 1000.000, unitPrice: 1.100, totalPrice: 1100.00, notes: '8.5% contract discount' },
    { orderNumber: 'SO-2025-001', materialId: materialMap['EMPTY_DRUMS'].id, quantity: 50.000, unitPrice: 5.000, totalPrice: 250.00, notes: 'Standard price' },
    
    // SO-2025-002 (XYZ Power Plant)
    { orderNumber: 'SO-2025-002', materialId: materialMap['TRANS_OIL'].id, quantity: 1200.000, unitPrice: 2.400, totalPrice: 2880.00, notes: 'Contract fixed rate' },
    
    // SO-2025-003 (Global Shipping)
    { orderNumber: 'SO-2025-003', materialId: materialMap['ENG_OIL_BULK'].id, quantity: 1500.000, unitPrice: 1.150, totalPrice: 1725.00, notes: 'Price guarantee applied' },
    
    // SO-2025-004 (Desert Transport - Walk-in)
    { orderNumber: 'SO-2025-004', materialId: materialMap['DIESEL_FUEL'].id, quantity: 500.000, unitPrice: 0.450, totalPrice: 225.00, notes: 'Standard rate' },
    { orderNumber: 'SO-2025-004', materialId: materialMap['EMPTY_DRUMS'].id, quantity: 10.000, unitPrice: 5.000, totalPrice: 50.00, notes: 'Walk-in customer' },
    
    // SO-2025-005 (Oman Construction)
    { orderNumber: 'SO-2025-005', materialId: materialMap['LUBE_OIL'].id, quantity: 2000.000, unitPrice: 1.800, totalPrice: 3600.00, notes: 'Project bulk order' },
    { orderNumber: 'SO-2025-005', materialId: materialMap['GEAR_OIL'].id, quantity: 400.000, unitPrice: 1.500, totalPrice: 600.00, notes: 'Heavy machinery' },
    
    // SO-2025-006 (Royal Navy)
    { orderNumber: 'SO-2025-006', materialId: materialMap['ENG_OIL_DRUM'].id, quantity: 150.000, unitPrice: 25.000, totalPrice: 3750.00, notes: 'Government standard rate' },
    { orderNumber: 'SO-2025-006', materialId: materialMap['TRANS_OIL'].id, quantity: 1200.000, unitPrice: 2.500, totalPrice: 3000.00, notes: 'Naval equipment' },
    
    // Pride Muscat Sales Orders
    // SO-2025-101 (Aluminum Export)
    { orderNumber: 'SO-2025-101', materialId: materialMap['ALU_CLEAN'].id, quantity: 2500.000, unitPrice: 0.850, totalPrice: 2125.00, notes: 'Export grade aluminum' },
    
    // SO-2025-102 (Copper Export)
    { orderNumber: 'SO-2025-102', materialId: materialMap['COP_BRIGHT'].id, quantity: 150.000, unitPrice: 6.200, totalPrice: 930.00, notes: 'Bright copper wire' },
    { orderNumber: 'SO-2025-102', materialId: materialMap['COP_HEAVY'].id, quantity: 120.000, unitPrice: 6.200, totalPrice: 744.00, notes: 'Heavy copper scrap' },
    
    // SO-2025-103 (Mixed Steel)
    { orderNumber: 'SO-2025-103', materialId: materialMap['STL_HEAVY'].id, quantity: 8000.000, unitPrice: 0.280, totalPrice: 2240.00, notes: 'Heavy structural steel' },
    { orderNumber: 'SO-2025-103', materialId: materialMap['STL_LIGHT'].id, quantity: 500.000, unitPrice: 0.280, totalPrice: 140.00, notes: 'Light steel mix' },
    
    // SO-2025-104 (Electronic Waste)
    { orderNumber: 'SO-2025-104', materialId: materialMap['E_WASTE_BOARD'].id, quantity: 45.000, unitPrice: 12.000, totalPrice: 540.00, notes: 'Circuit board export' }
  ];

  // Clear existing data
  await knex('sales_order_items').del();
  await knex('sales_orders').del();
  
  console.log('🛒 Seeding sales orders and items...');
  
  // Insert sales orders
  await knex('sales_orders').insert(alramramiSalesOrders);
  await knex('sales_orders').insert(prideMuscatSalesOrders);
  
  // Get sales order IDs and update items with proper order IDs
  const orders = await knex('sales_orders').select('id', 'orderNumber');
  const orderMap = {};
  orders.forEach(o => orderMap[o.orderNumber] = o.id);
  
  // Add order IDs to items
  const itemsWithOrderIds = salesOrderItems.map(item => ({
    salesOrderId: orderMap[item.orderNumber],
    materialId: item.materialId,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    totalPrice: item.totalPrice,
    notes: item.notes
  }));
  
  await knex('sales_order_items').insert(itemsWithOrderIds);
  
  console.log('✅ Sales orders seeded successfully');
  console.log(`   🛢️  Al Ramrami: ${alramramiSalesOrders.length} sales orders`);
  console.log(`   ♻️  Pride Muscat: ${prideMuscatSalesOrders.length} sales orders`);
  console.log(`   📝 Total order items: ${salesOrderItems.length}`);
  
  // Calculate totals
  const alramramiTotal = alramramiSalesOrders.reduce((sum, order) => sum + order.totalAmount, 0);
  const prideMuscatTotal = prideMuscatSalesOrders.reduce((sum, order) => sum + order.totalAmount, 0);
  
  console.log(`   💰 Al Ramrami sales value: ${alramramiTotal.toFixed(2)} OMR`);
  console.log(`   💰 Pride Muscat sales value: ${prideMuscatTotal.toFixed(2)} OMR`);
};