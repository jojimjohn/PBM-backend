/**
 * Petty Cash Balance Verifier
 *
 * Utility to verify the integrity of petty cash card balances.
 * Calculates expected balance from all transactions and compares
 * to the stored currentBalance to detect discrepancies.
 *
 * Balance Formula:
 *   Expected Balance = Initial Balance
 *                    + Total Reloads
 *                    - Pending Expenses (already deducted)
 *                    - Approved Expenses (tracked in totalSpent)
 *                    + Rejected Expenses (refunded)
 *                    +/- Adjustments
 */

const winston = require('winston');

/**
 * Generate transaction number for verification records
 */
function generateVerificationNumber(companyId) {
  const prefix = companyId === 'al-ramrami' ? 'ALR' : 'PM';
  const timestamp = Date.now().toString().slice(-8);
  return `${prefix}-VRF-${timestamp}`;
}

/**
 * Verify balance for a single card
 *
 * @param {Object} db - Knex database connection
 * @param {number} cardId - Card ID to verify
 * @returns {Object} Verification result
 */
async function verifyCardBalance(db, cardId) {
  // Get card details
  const card = await db('petty_cash_cards').where('id', cardId).first();

  if (!card) {
    return {
      success: false,
      error: 'Card not found',
      cardId
    };
  }

  const storedBalance = parseFloat(card.currentBalance) || 0;
  const initialBalance = parseFloat(card.initialBalance) || 0;
  const storedTotalSpent = parseFloat(card.totalSpent) || 0;

  // Calculate total reloads from transactions table
  const [reloadResult] = await db('petty_cash_transactions')
    .where('card_id', cardId)
    .whereIn('transaction_type', ['reload', 'initial_balance'])
    .sum('amount as total');
  const totalReloads = parseFloat(reloadResult?.total) || 0;

  // Get pending expenses (already deducted from balance)
  const [pendingResult] = await db('petty_cash_expenses')
    .where('cardId', cardId)
    .where('status', 'pending')
    .sum('amount as total');
  const pendingExpenses = parseFloat(pendingResult?.total) || 0;

  // Get approved expenses
  const [approvedResult] = await db('petty_cash_expenses')
    .where('cardId', cardId)
    .where('status', 'approved')
    .sum('amount as total');
  const approvedExpenses = parseFloat(approvedResult?.total) || 0;

  // Get rejected expenses (these were refunded)
  const [rejectedResult] = await db('petty_cash_expenses')
    .where('cardId', cardId)
    .where('status', 'rejected')
    .sum('amount as total');
  const rejectedExpenses = parseFloat(rejectedResult?.total) || 0;

  // Get adjustments from transactions
  const [adjustmentResult] = await db('petty_cash_transactions')
    .where('card_id', cardId)
    .whereIn('transaction_type', ['adjustment', 'deduction'])
    .sum('amount as total');
  const adjustments = parseFloat(adjustmentResult?.total) || 0;

  // Calculate expected balance
  // Note: With immediate deduction model:
  // - Pending expenses are already deducted
  // - Approved expenses move to totalSpent but don't affect balance again
  // - Rejected expenses get refunded (added back)
  const expectedBalance = initialBalance
    + totalReloads
    - pendingExpenses  // Deducted on submission
    - approvedExpenses // These were pending, now approved (no additional deduction)
    + adjustments;     // Can be positive or negative

  // Alternative calculation using totalSpent
  // expectedBalance = initialBalance + totalReloads - pendingExpenses - storedTotalSpent + adjustments

  const discrepancy = Math.abs(storedBalance - expectedBalance);
  const isValid = discrepancy < 0.01; // Allow for floating point precision

  const result = {
    success: true,
    cardId,
    cardNumber: card.cardNumber,
    storedBalance,
    expectedBalance,
    discrepancy,
    isValid,
    breakdown: {
      initialBalance,
      totalReloads,
      pendingExpenses,
      approvedExpenses,
      rejectedExpenses,
      adjustments,
      storedTotalSpent
    }
  };

  if (!isValid) {
    winston.warn('Balance discrepancy detected', {
      cardId,
      cardNumber: card.cardNumber,
      storedBalance,
      expectedBalance,
      discrepancy
    });
  }

  return result;
}

/**
 * Verify balances for all cards
 *
 * @param {Object} db - Knex database connection
 * @returns {Object} Verification results for all cards
 */
async function verifyAllCardBalances(db) {
  const cards = await db('petty_cash_cards')
    .select('id', 'cardNumber')
    .whereNot('status', 'closed');

  const results = {
    totalCards: cards.length,
    validCards: 0,
    invalidCards: 0,
    cards: [],
    discrepancies: []
  };

  for (const card of cards) {
    const verification = await verifyCardBalance(db, card.id);
    results.cards.push(verification);

    if (verification.isValid) {
      results.validCards++;
    } else {
      results.invalidCards++;
      results.discrepancies.push({
        cardId: card.id,
        cardNumber: card.cardNumber,
        storedBalance: verification.storedBalance,
        expectedBalance: verification.expectedBalance,
        discrepancy: verification.discrepancy
      });
    }
  }

  return results;
}

/**
 * Recalculate and fix card balance
 * USE WITH CAUTION - This will overwrite the stored balance
 *
 * @param {Object} db - Knex database connection
 * @param {number} cardId - Card ID to fix
 * @param {number} userId - User performing the fix
 * @returns {Object} Fix result
 */
async function recalculateAndFixBalance(db, cardId, userId) {
  return await db.transaction(async (trx) => {
    const verification = await verifyCardBalance(trx, cardId);

    if (!verification.success) {
      throw new Error(verification.error);
    }

    if (verification.isValid) {
      return {
        success: true,
        message: 'Balance is already correct',
        cardId,
        balance: verification.storedBalance
      };
    }

    const oldBalance = verification.storedBalance;
    const newBalance = verification.expectedBalance;
    const adjustment = newBalance - oldBalance;

    // Update the card balance
    await trx('petty_cash_cards')
      .where('id', cardId)
      .update({
        currentBalance: newBalance
      });

    // Log the correction as an adjustment transaction
    await trx('petty_cash_transactions').insert({
      card_id: cardId,
      transaction_number: generateVerificationNumber('fix'),
      transaction_type: 'adjustment',
      amount: adjustment,
      balance_before: oldBalance,
      balance_after: newBalance,
      description: `Balance correction: Discrepancy of ${verification.discrepancy.toFixed(3)} fixed by system verification`,
      performed_by: userId,
      transaction_date: new Date()
    });

    winston.info('Card balance corrected', {
      cardId,
      cardNumber: verification.cardNumber,
      oldBalance,
      newBalance,
      adjustment,
      correctedBy: userId
    });

    return {
      success: true,
      message: 'Balance corrected successfully',
      cardId,
      cardNumber: verification.cardNumber,
      oldBalance,
      newBalance,
      adjustment,
      breakdown: verification.breakdown
    };
  });
}

/**
 * Get detailed transaction audit for a card
 *
 * @param {Object} db - Knex database connection
 * @param {number} cardId - Card ID
 * @returns {Object} Detailed audit trail
 */
async function getCardAuditTrail(db, cardId) {
  const card = await db('petty_cash_cards').where('id', cardId).first();

  if (!card) {
    return { success: false, error: 'Card not found' };
  }

  // Get all transactions ordered by date
  const transactions = await db('petty_cash_transactions')
    .where('card_id', cardId)
    .orderBy('transaction_date', 'asc')
    .orderBy('id', 'asc');

  // Get all expenses with status history
  const expenses = await db('petty_cash_expenses')
    .select(
      'petty_cash_expenses.*',
      'submittedUser.firstName as submittedByName',
      'submittedUser.lastName as submittedByLastName',
      'approvedUser.firstName as approvedByName',
      'approvedUser.lastName as approvedByLastName'
    )
    .leftJoin('users as submittedUser', 'petty_cash_expenses.submittedBy', 'submittedUser.id')
    .leftJoin('users as approvedUser', 'petty_cash_expenses.approvedBy', 'approvedUser.id')
    .where('cardId', cardId)
    .orderBy('created_at', 'asc');

  // Build running balance trail
  let runningBalance = parseFloat(card.initialBalance) || 0;
  const auditTrail = [{
    date: card.created_at,
    type: 'initial_balance',
    amount: runningBalance,
    runningBalance,
    description: 'Card created with initial balance'
  }];

  for (const txn of transactions) {
    runningBalance += parseFloat(txn.amount) || 0;
    auditTrail.push({
      date: txn.transaction_date,
      type: txn.transaction_type,
      amount: parseFloat(txn.amount),
      runningBalance,
      description: txn.description,
      expenseId: txn.expense_id,
      transactionId: txn.id
    });
  }

  return {
    success: true,
    cardId,
    cardNumber: card.cardNumber,
    currentStoredBalance: parseFloat(card.currentBalance),
    calculatedBalance: runningBalance,
    isConsistent: Math.abs(parseFloat(card.currentBalance) - runningBalance) < 0.01,
    auditTrail,
    expenses: expenses.map(e => ({
      id: e.id,
      expenseNumber: e.expenseNumber,
      amount: parseFloat(e.amount),
      status: e.status,
      category: e.category,
      description: e.description,
      submittedBy: `${e.submittedByName || ''} ${e.submittedByLastName || ''}`.trim(),
      approvedBy: e.approvedByName ? `${e.approvedByName} ${e.approvedByLastName || ''}`.trim() : null,
      submittedAt: e.created_at,
      approvedAt: e.approvedAt
    }))
  };
}

module.exports = {
  verifyCardBalance,
  verifyAllCardBalances,
  recalculateAndFixBalance,
  getCardAuditTrail
};
