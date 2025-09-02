/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> } 
 */
exports.seed = async function(knex) {
  
  // Get reference IDs
  const salesOrders = await knex('sales_orders').select('id', 'orderNumber', 'totalAmount', 'orderDate');
  const purchaseOrders = await knex('purchase_orders').select('id', 'orderNumber', 'totalAmount', 'orderDate');
  const wastages = await knex('wastages').select('id', 'wastageNumber', 'totalCost', 'wastageDate', 'status');
  const expenses = await knex('petty_cash_expenses').select('id', 'expenseNumber', 'amount', 'expenseDate', 'status');

  const transactions = [
    // Al Ramrami Sales Revenue Transactions
    {
      transactionNumber: 'TXN-ALR-001',
      transactionType: 'sales_revenue',
      referenceType: 'sales_order',
      referenceId: salesOrders.find(s => s.orderNumber === 'SO-2025-001')?.id,
      amount: 3937.50,
      currency: 'OMR',
      transactionDate: '2025-08-15',
      description: 'Sales revenue - ABC Manufacturing (SO-2025-001)',
      status: 'completed',
      notes: 'Regular monthly oil supply contract'
    },
    {
      transactionNumber: 'TXN-ALR-002',
      transactionType: 'sales_revenue',
      referenceType: 'sales_order',
      referenceId: salesOrders.find(s => s.orderNumber === 'SO-2025-002')?.id,
      amount: 3024.00,
      currency: 'OMR',
      transactionDate: '2025-08-18',
      description: 'Sales revenue - XYZ Power Plant (SO-2025-002)',
      status: 'completed',
      notes: 'Transformer oil supply for power plant maintenance'
    },
    {
      transactionNumber: 'TXN-ALR-003',
      transactionType: 'sales_revenue',
      referenceType: 'sales_order',
      referenceId: salesOrders.find(s => s.orderNumber === 'SO-2025-004')?.id,
      amount: 288.75,
      currency: 'OMR',
      transactionDate: '2025-08-22',
      description: 'Sales revenue - Desert Transport (SO-2025-004)',
      status: 'completed',
      notes: 'Walk-in customer cash sale'
    },

    // Al Ramrami Purchase Cost Transactions
    {
      transactionNumber: 'TXN-ALR-004',
      transactionType: 'purchase_cost',
      referenceType: 'purchase_order',
      referenceId: purchaseOrders.find(p => p.orderNumber === 'PO-2025-001')?.id,
      amount: -3780.00, // Negative for cost
      currency: 'OMR',
      transactionDate: '2025-08-10',
      description: 'Purchase cost - Used engine oil collection (PO-2025-001)',
      status: 'completed',
      notes: 'Collection from service stations'
    },
    {
      transactionNumber: 'TXN-ALR-005',
      transactionType: 'purchase_cost',
      referenceType: 'purchase_order',
      referenceId: purchaseOrders.find(p => p.orderNumber === 'PO-2025-002')?.id,
      amount: -3024.00,
      currency: 'OMR',
      transactionDate: '2025-08-14',
      description: 'Purchase cost - Transformer oil collection (PO-2025-002)',
      status: 'completed',
      notes: 'From power company maintenance'
    },
    {
      transactionNumber: 'TXN-ALR-006',
      transactionType: 'purchase_cost',
      referenceType: 'purchase_order',
      referenceId: purchaseOrders.find(p => p.orderNumber === 'PO-2025-003')?.id,
      amount: -504.00,
      currency: 'OMR',
      transactionDate: '2025-08-18',
      description: 'Purchase cost - Cooking oil collection (PO-2025-003)',
      status: 'completed',
      notes: 'Restaurant collection program'
    },

    // Al Ramrami Wastage Losses
    {
      transactionNumber: 'TXN-ALR-007',
      transactionType: 'wastage_loss',
      referenceType: 'wastage',
      referenceId: wastages.find(w => w.wastageNumber === 'ALR-W-20250815001')?.id,
      amount: -117.50,
      currency: 'OMR',
      transactionDate: '2025-08-15',
      description: 'Wastage loss - Engine oil spillage (ALR-W-20250815001)',
      status: 'completed',
      notes: 'Tank overflow during transfer - approved'
    },
    {
      transactionNumber: 'TXN-ALR-008',
      transactionType: 'wastage_loss',
      referenceType: 'wastage',
      referenceId: wastages.find(w => w.wastageNumber === 'ALR-W-20250817002')?.id,
      amount: -28.75,
      currency: 'OMR',
      transactionDate: '2025-08-17',
      description: 'Wastage loss - Oil contamination (ALR-W-20250817002)',
      status: 'completed',
      notes: 'Water contamination - approved'
    },

    // Al Ramrami Petty Cash Expenses
    {
      transactionNumber: 'TXN-ALR-009',
      transactionType: 'expense',
      referenceType: 'petty_cash_expense',
      referenceId: expenses.find(e => e.expenseNumber === 'EXP-ALR-001')?.id,
      amount: -45.50,
      currency: 'OMR',
      transactionDate: '2025-08-16',
      description: 'Office expense - Printer supplies (EXP-ALR-001)',
      status: 'completed',
      notes: 'Approved petty cash expense'
    },
    {
      transactionNumber: 'TXN-ALR-010',
      transactionType: 'expense',
      referenceType: 'petty_cash_expense',
      referenceId: expenses.find(e => e.expenseNumber === 'EXP-ALR-005')?.id,
      amount: -185.30,
      currency: 'OMR',
      transactionDate: '2025-08-19',
      description: 'Maintenance expense - Pump repair (EXP-ALR-005)',
      status: 'completed',
      notes: 'Critical equipment repair - approved'
    },

    // Pride Muscat Sales Revenue Transactions
    {
      transactionNumber: 'TXN-PM-001',
      transactionType: 'sales_revenue',
      referenceType: 'sales_order',
      referenceId: salesOrders.find(s => s.orderNumber === 'SO-2025-101')?.id,
      amount: 2231.25,
      currency: 'OMR',
      transactionDate: '2025-08-16',
      description: 'Sales revenue - Aluminum export (SO-2025-101)',
      status: 'completed',
      notes: 'Container load aluminum scrap export'
    },
    {
      transactionNumber: 'TXN-PM-002',
      transactionType: 'sales_revenue',
      referenceType: 'sales_order',
      referenceId: salesOrders.find(s => s.orderNumber === 'SO-2025-102')?.id,
      amount: 1757.70,
      currency: 'OMR',
      transactionDate: '2025-08-21',
      description: 'Sales revenue - Copper export (SO-2025-102)',
      status: 'completed',
      notes: 'Premium copper wire and heavy copper export'
    },

    // Pride Muscat Purchase Cost Transactions
    {
      transactionNumber: 'TXN-PM-003',
      transactionType: 'purchase_cost',
      referenceType: 'purchase_order',
      referenceId: purchaseOrders.find(p => p.orderNumber === 'PO-2025-101')?.id,
      amount: -2047.50,
      currency: 'OMR',
      transactionDate: '2025-08-12',
      description: 'Purchase cost - Aluminum from Metal Collectors (PO-2025-101)',
      status: 'completed',
      notes: 'Clean and mixed aluminum purchase'
    },
    {
      transactionNumber: 'TXN-PM-004',
      transactionType: 'purchase_cost',
      referenceType: 'purchase_order',
      referenceId: purchaseOrders.find(p => p.orderNumber === 'PO-2025-102')?.id,
      amount: -1822.80,
      currency: 'OMR',
      transactionDate: '2025-08-16',
      description: 'Purchase cost - Copper from Sohar Scrap (PO-2025-102)',
      status: 'completed',
      notes: 'Premium copper and brass purchase'
    },
    {
      transactionNumber: 'TXN-PM-005',
      transactionType: 'purchase_cost',
      referenceType: 'purchase_order',
      referenceId: purchaseOrders.find(p => p.orderNumber === 'PO-2025-103')?.id,
      amount: -567.00,
      currency: 'OMR',
      transactionDate: '2025-08-20',
      description: 'Purchase cost - Electronic boards (PO-2025-103)',
      status: 'completed',
      notes: 'Circuit boards from E-Waste Solutions'
    },

    // Pride Muscat Wastage Losses
    {
      transactionNumber: 'TXN-PM-006',
      transactionType: 'wastage_loss',
      referenceType: 'wastage',
      referenceId: wastages.find(w => w.wastageNumber === 'PM-W-20250816001')?.id,
      amount: -9.36,
      currency: 'OMR',
      transactionDate: '2025-08-16',
      description: 'Wastage loss - Aluminum contamination (PM-W-20250816001)',
      status: 'completed',
      notes: 'Steel contamination - reclassified'
    },
    {
      transactionNumber: 'TXN-PM-007',
      transactionType: 'wastage_loss',
      referenceType: 'wastage',
      referenceId: wastages.find(w => w.wastageNumber === 'PM-W-20250818002')?.id,
      amount: -15.00,
      currency: 'OMR',
      transactionDate: '2025-08-18',
      description: 'Wastage loss - Copper theft (PM-W-20250818002)',
      status: 'completed',
      notes: 'Security review required - approved'
    },

    // Pride Muscat Petty Cash Expenses
    {
      transactionNumber: 'TXN-PM-008',
      transactionType: 'expense',
      referenceType: 'petty_cash_expense',
      referenceId: expenses.find(e => e.expenseNumber === 'EXP-PM-001')?.id,
      amount: -125.00,
      currency: 'OMR',
      transactionDate: '2025-08-17',
      description: 'Regulatory expense - Environmental permit (EXP-PM-001)',
      status: 'completed',
      notes: 'Mandatory compliance fee - approved'
    },
    {
      transactionNumber: 'TXN-PM-009',
      transactionType: 'expense',
      referenceType: 'petty_cash_expense',
      referenceId: expenses.find(e => e.expenseNumber === 'EXP-PM-004')?.id,
      amount: -142.50,
      currency: 'OMR',
      transactionDate: '2025-08-23',
      description: 'Equipment expense - Magnet separator parts (EXP-PM-004)',
      status: 'completed',
      notes: 'Critical sorting equipment - approved'
    }
  ];

  // Clear existing data
  await knex('transactions').del();
  
  console.log('💰 Seeding financial transactions...');
  
  await knex('transactions').insert(transactions);
  
  console.log('✅ Transactions seeded successfully');
  console.log(`   📊 Total transactions: ${transactions.length}`);
  
  // Calculate totals by type
  const salesRevenue = transactions.filter(t => t.transactionType === 'sales_revenue').reduce((sum, t) => sum + t.amount, 0);
  const purchaseCosts = transactions.filter(t => t.transactionType === 'purchase_cost').reduce((sum, t) => sum + Math.abs(t.amount), 0);
  const wastageLosses = transactions.filter(t => t.transactionType === 'wastage_loss').reduce((sum, t) => sum + Math.abs(t.amount), 0);
  const totalExpenses = transactions.filter(t => t.transactionType === 'expense').reduce((sum, t) => sum + Math.abs(t.amount), 0);
  
  console.log('💹 Financial Summary:');
  console.log(`   📈 Total Sales Revenue: ${salesRevenue.toFixed(2)} OMR`);
  console.log(`   📉 Total Purchase Costs: ${purchaseCosts.toFixed(2)} OMR`);
  console.log(`   🗑️ Total Wastage Losses: ${wastageLosses.toFixed(2)} OMR`);
  console.log(`   💸 Total Expenses: ${totalExpenses.toFixed(2)} OMR`);
  
  const grossProfit = salesRevenue - purchaseCosts;
  const netProfit = grossProfit - wastageLosses - totalExpenses;
  
  console.log(`   💚 Gross Profit: ${grossProfit.toFixed(2)} OMR`);
  console.log(`   💰 Net Profit: ${netProfit.toFixed(2)} OMR`);
  console.log(`   📊 Profit Margin: ${((netProfit/salesRevenue)*100).toFixed(1)}%`);
  
  // Company breakdown
  const alramramiTransactions = transactions.filter(t => t.transactionNumber.includes('ALR')).length;
  const prideMuscatTransactions = transactions.filter(t => t.transactionNumber.includes('PM')).length;
  
  console.log(`   🛢️  Al Ramrami: ${alramramiTransactions} transactions`);
  console.log(`   ♻️  Pride Muscat: ${prideMuscatTransactions} transactions`);
};