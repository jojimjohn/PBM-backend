/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> } 
 */
exports.seed = async function(knex) {
  
  // Get user IDs for assigning cards
  const users = await knex('users').select('id', 'email', 'firstName', 'lastName');
  const userMap = {};
  users.forEach(u => userMap[u.email] = u);

  const alramramiPettyCashCards = [
    {
      cardNumber: 'ALR-PC-001',
      assignedTo: userMap['manager@alramrami.com']?.id || 3,
      staffName: 'Company Admin',
      department: 'Administration',
      initialBalance: 500.00,
      currentBalance: 287.50,
      totalSpent: 212.50,
      monthlyLimit: 1000.00,
      issueDate: '2025-08-01',
      expiryDate: '2025-12-31',
      status: 'active',
      notes: 'Admin expenses and office supplies',
      createdBy: 1
    },
    {
      cardNumber: 'ALR-PC-002',
      assignedTo: userMap['sales@alramrami.com']?.id || 5,
      staffName: 'Sales Staff',
      department: 'Sales',
      initialBalance: 300.00,
      currentBalance: 145.75,
      totalSpent: 154.25,
      monthlyLimit: 500.00,
      issueDate: '2025-08-05',
      expiryDate: '2025-12-31',
      status: 'active',
      notes: 'Client meetings and travel expenses',
      createdBy: 1
    },
    {
      cardNumber: 'ALR-PC-003',
      assignedTo: 2, // Operations staff
      staffName: 'Operations Manager',
      department: 'Operations',
      initialBalance: 400.00,
      currentBalance: 75.20,
      totalSpent: 324.80,
      monthlyLimit: 800.00,
      issueDate: '2025-08-10',
      expiryDate: '2025-12-31',
      status: 'active',
      notes: 'Equipment maintenance and site expenses',
      createdBy: 1
    },
    {
      cardNumber: 'ALR-PC-004',
      assignedTo: 3, // Driver/Transport
      staffName: 'Transport Coordinator',
      department: 'Logistics',
      initialBalance: 200.00,
      currentBalance: 45.50,
      totalSpent: 154.50,
      monthlyLimit: 400.00,
      issueDate: '2025-08-15',
      expiryDate: '2025-12-31',
      status: 'active',
      notes: 'Vehicle fuel and minor repairs',
      createdBy: 1
    }
  ];

  const prideMuscatPettyCashCards = [
    {
      cardNumber: 'PM-PC-001',
      assignedTo: userMap['manager@pridemuscat.com']?.id || 8,
      staffName: 'Company Admin',
      department: 'Administration',
      initialBalance: 600.00,
      currentBalance: 425.30,
      totalSpent: 174.70,
      monthlyLimit: 1200.00,
      issueDate: '2025-08-01',
      expiryDate: '2025-12-31',
      status: 'active',
      notes: 'Office operations and regulatory fees',
      createdBy: 4
    },
    {
      cardNumber: 'PM-PC-002',
      assignedTo: userMap['sales@pridemuscat.com']?.id || 10,
      staffName: 'Sales Staff',
      department: 'Sales',
      initialBalance: 350.00,
      currentBalance: 89.45,
      totalSpent: 260.55,
      monthlyLimit: 700.00,
      issueDate: '2025-08-03',
      expiryDate: '2025-12-31',
      status: 'active',
      notes: 'Supplier visits and market research',
      createdBy: 4
    },
    {
      cardNumber: 'PM-PC-003',
      assignedTo: 5, // Yard operations
      staffName: 'Yard Supervisor',
      department: 'Operations',
      initialBalance: 300.00,
      currentBalance: 12.75,
      totalSpent: 287.25,
      monthlyLimit: 600.00,
      issueDate: '2025-08-08',
      expiryDate: '2025-12-31',
      status: 'active',
      notes: 'Yard equipment and safety supplies',
      createdBy: 4
    },
    {
      cardNumber: 'PM-PC-004',
      assignedTo: 6, // Quality control
      staffName: 'Quality Inspector',
      department: 'Quality Control',
      initialBalance: 250.00,
      currentBalance: 165.80,
      totalSpent: 84.20,
      monthlyLimit: 500.00,
      issueDate: '2025-08-12',
      expiryDate: '2025-12-31',
      status: 'active',
      notes: 'Testing equipment and lab supplies',
      createdBy: 4
    }
  ];

  const pettyCashExpenses = [
    // Al Ramrami Expenses
    {
      cardNumber: 'ALR-PC-001',
      expenseNumber: 'EXP-ALR-001',
      expenseDate: '2025-08-16',
      category: 'office_supplies',
      description: 'Printer paper and ink cartridges',
      amount: 45.50,
      receiptNumber: 'OFF-2025-0816',
      vendor: 'Office World Muscat',
      status: 'approved',
      submittedBy: 3,
      approvedBy: 1,
      approvedAt: '2025-08-17 09:30:00',
      approvalNotes: 'Routine office supplies',
      attachments: JSON.stringify(['receipt_OFF_2025_0816.jpg'])
    },
    {
      cardNumber: 'ALR-PC-001',
      expenseNumber: 'EXP-ALR-002',
      expenseDate: '2025-08-20',
      category: 'utilities',
      description: 'Internet service top-up for site office',
      amount: 25.00,
      receiptNumber: 'INT-789456',
      vendor: 'Omantel',
      status: 'approved',
      submittedBy: 3,
      approvedBy: 1,
      approvedAt: '2025-08-20 14:15:00',
      approvalNotes: 'Essential communication service',
      attachments: JSON.stringify(['receipt_omantel_789456.pdf'])
    },
    {
      cardNumber: 'ALR-PC-002',
      expenseNumber: 'EXP-ALR-003',
      expenseDate: '2025-08-18',
      category: 'travel',
      description: 'Fuel for client visit to Sohar',
      amount: 32.75,
      receiptNumber: 'FUEL-2025-0818',
      vendor: 'Shell Station Sohar',
      status: 'approved',
      submittedBy: 5,
      approvedBy: 2,
      approvedAt: '2025-08-19 08:45:00',
      approvalNotes: 'Client meeting travel',
      attachments: JSON.stringify(['fuel_receipt_shell.jpg'])
    },
    {
      cardNumber: 'ALR-PC-002',
      expenseNumber: 'EXP-ALR-004',
      expenseDate: '2025-08-22',
      category: 'meals',
      description: 'Business lunch with ABC Manufacturing',
      amount: 68.50,
      receiptNumber: 'RES-456789',
      vendor: 'Intercontinental Hotel',
      status: 'pending',
      submittedBy: 5,
      approvedBy: null,
      approvedAt: null,
      approvalNotes: null,
      attachments: JSON.stringify(['lunch_receipt_intercontinental.pdf'])
    },
    {
      cardNumber: 'ALR-PC-003',
      expenseNumber: 'EXP-ALR-005',
      expenseDate: '2025-08-19',
      category: 'maintenance',
      description: 'Pump repair parts and labor',
      amount: 185.30,
      receiptNumber: 'REP-2025-001',
      vendor: 'Muscat Pump Services',
      status: 'approved',
      submittedBy: 2,
      approvedBy: 1,
      approvedAt: '2025-08-20 11:30:00',
      approvalNotes: 'Critical equipment repair',
      attachments: JSON.stringify(['pump_repair_invoice.pdf', 'parts_receipt.jpg'])
    },
    
    // Pride Muscat Expenses
    {
      cardNumber: 'PM-PC-001',
      expenseNumber: 'EXP-PM-001',
      expenseDate: '2025-08-17',
      category: 'regulatory',
      description: 'Environmental permit renewal fee',
      amount: 125.00,
      receiptNumber: 'ENV-2025-0817',
      vendor: 'Ministry of Environment',
      status: 'approved',
      submittedBy: 8,
      approvedBy: 4,
      approvedAt: '2025-08-17 16:00:00',
      approvalNotes: 'Mandatory regulatory compliance',
      attachments: JSON.stringify(['env_permit_receipt.pdf'])
    },
    {
      cardNumber: 'PM-PC-002',
      expenseNumber: 'EXP-PM-002',
      expenseDate: '2025-08-21',
      category: 'travel',
      description: 'Site visit to Dhofar supplier',
      amount: 95.25,
      receiptNumber: 'TRAVEL-2025-001',
      vendor: 'Various (Fuel, Meals, Parking)',
      status: 'approved',
      submittedBy: 10,
      approvedBy: 4,
      approvedAt: '2025-08-22 09:15:00',
      approvalNotes: 'Supplier relationship visit',
      attachments: JSON.stringify(['travel_receipts_dhofar.zip'])
    },
    {
      cardNumber: 'PM-PC-002',
      expenseNumber: 'EXP-PM-003',
      expenseDate: '2025-08-25',
      category: 'office_supplies',
      description: 'Safety equipment and first aid kit',
      amount: 78.30,
      receiptNumber: 'SAF-789123',
      vendor: 'Safety First Muscat',
      status: 'pending',
      submittedBy: 10,
      approvedBy: null,
      approvedAt: null,
      approvalNotes: null,
      attachments: JSON.stringify(['safety_equipment_invoice.pdf'])
    },
    {
      cardNumber: 'PM-PC-003',
      expenseNumber: 'EXP-PM-004',
      expenseDate: '2025-08-23',
      category: 'equipment',
      description: 'Magnet separator replacement parts',
      amount: 142.50,
      receiptNumber: 'MAG-2025-456',
      vendor: 'Industrial Equipment LLC',
      status: 'approved',
      submittedBy: 5,
      approvedBy: 4,
      approvedAt: '2025-08-24 13:45:00',
      approvalNotes: 'Critical sorting equipment',
      attachments: JSON.stringify(['magnet_parts_invoice.pdf'])
    },
    {
      cardNumber: 'PM-PC-004',
      expenseNumber: 'EXP-PM-005',
      expenseDate: '2025-08-26',
      category: 'testing',
      description: 'Metal purity testing chemicals',
      amount: 42.70,
      receiptNumber: 'LAB-987654',
      vendor: 'Scientific Supplies Oman',
      status: 'rejected',
      submittedBy: 6,
      approvedBy: 4,
      approvedAt: '2025-08-27 10:20:00',
      approvalNotes: 'Use existing stock first',
      attachments: JSON.stringify(['lab_chemicals_receipt.jpg'])
    }
  ];

  // Clear existing data
  await knex('petty_cash_expenses').del();
  await knex('petty_cash_cards').del();
  
  console.log('💳 Seeding petty cash cards and expenses...');
  
  // Insert petty cash cards
  await knex('petty_cash_cards').insert(alramramiPettyCashCards);
  await knex('petty_cash_cards').insert(prideMuscatPettyCashCards);
  
  // Get card IDs for expenses
  const cards = await knex('petty_cash_cards').select('id', 'cardNumber');
  const cardMap = {};
  cards.forEach(c => cardMap[c.cardNumber] = c.id);
  
  // Add card IDs to expenses
  const expensesWithCardIds = pettyCashExpenses.map(expense => ({
    pettyCashCardId: cardMap[expense.cardNumber],
    expenseNumber: expense.expenseNumber,
    expenseDate: expense.expenseDate,
    category: expense.category,
    description: expense.description,
    amount: expense.amount,
    receiptNumber: expense.receiptNumber,
    vendor: expense.vendor,
    status: expense.status,
    submittedBy: expense.submittedBy,
    approvedBy: expense.approvedBy,
    approvedAt: expense.approvedAt,
    approvalNotes: expense.approvalNotes,
    attachments: expense.attachments
  }));
  
  await knex('petty_cash_expenses').insert(expensesWithCardIds);
  
  console.log('✅ Petty cash system seeded successfully');
  console.log(`   🛢️  Al Ramrami: ${alramramiPettyCashCards.length} cards`);
  console.log(`   ♻️  Pride Muscat: ${prideMuscatPettyCashCards.length} cards`);
  console.log(`   📝 Total expenses: ${pettyCashExpenses.length}`);
  
  // Calculate totals
  const alramramiTotalBalance = alramramiPettyCashCards.reduce((sum, card) => sum + card.currentBalance, 0);
  const alramramiTotalSpent = alramramiPettyCashCards.reduce((sum, card) => sum + card.totalSpent, 0);
  const prideMuscatTotalBalance = prideMuscatPettyCashCards.reduce((sum, card) => sum + card.currentBalance, 0);
  const prideMuscatTotalSpent = prideMuscatPettyCashCards.reduce((sum, card) => sum + card.totalSpent, 0);
  
  console.log(`   💰 Al Ramrami current balance: ${alramramiTotalBalance.toFixed(2)} OMR`);
  console.log(`   💸 Al Ramrami total spent: ${alramramiTotalSpent.toFixed(2)} OMR`);
  console.log(`   💰 Pride Muscat current balance: ${prideMuscatTotalBalance.toFixed(2)} OMR`);
  console.log(`   💸 Pride Muscat total spent: ${prideMuscatTotalSpent.toFixed(2)} OMR`);
  
  // Status breakdown
  const approvedExpenses = pettyCashExpenses.filter(e => e.status === 'approved').length;
  const pendingExpenses = pettyCashExpenses.filter(e => e.status === 'pending').length;
  const rejectedExpenses = pettyCashExpenses.filter(e => e.status === 'rejected').length;
  
  console.log(`   📊 Expenses: ${approvedExpenses} approved, ${pendingExpenses} pending, ${rejectedExpenses} rejected`);
};