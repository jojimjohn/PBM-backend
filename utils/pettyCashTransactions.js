/**
 * Petty Cash Transaction Logger
 *
 * Utility functions to log all petty cash card transactions
 * for complete audit trail and history tracking.
 */

const winston = require('winston');

// Generate unique transaction number
const generateTransactionNumber = (companyId, type) => {
  const prefix = companyId === 'al-ramrami' || companyId === 'alramrami' ? 'ALR' : 'PMI';
  const typeCode = {
    initial_balance: 'IB',
    reload: 'RL',
    expense: 'EX',
    expense_approved: 'EA',
    expense_rejected: 'ER',
    adjustment: 'AD',
    deduction: 'DD',
    reversal: 'RV',
  }[type] || 'TX';

  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substr(2, 4).toUpperCase();

  return `${prefix}-PCT-${typeCode}-${timestamp}${random}`;
};

/**
 * Log a petty cash transaction
 *
 * @param {object} db - Knex database connection
 * @param {object} params - Transaction parameters
 * @param {number} params.cardId - Card ID
 * @param {string} params.transactionType - Type of transaction
 * @param {number} params.amount - Transaction amount
 * @param {number} params.balanceBefore - Balance before transaction
 * @param {number} params.balanceAfter - Balance after transaction
 * @param {number} [params.expenseId] - Related expense ID (if applicable)
 * @param {string} [params.referenceType] - Related entity type
 * @param {number} [params.referenceId] - Related entity ID
 * @param {string} [params.description] - Transaction description
 * @param {string} [params.notes] - Additional notes
 * @param {number} [params.performedBy] - System user ID
 * @param {number} [params.pcUserId] - Petty cash user ID
 * @param {string} params.companyId - Company ID for transaction number
 * @returns {Promise<number>} - Created transaction ID
 */
const logTransaction = async (db, params) => {
  const {
    cardId,
    transactionType,
    amount,
    balanceBefore,
    balanceAfter,
    expenseId = null,
    referenceType = null,
    referenceId = null,
    description = null,
    notes = null,
    performedBy = null,
    pcUserId = null,
    companyId,
  } = params;

  const transactionNumber = generateTransactionNumber(companyId, transactionType);

  try {
    const [id] = await db('petty_cash_transactions').insert({
      card_id: cardId,
      transaction_number: transactionNumber,
      transaction_type: transactionType,
      amount,
      balance_before: balanceBefore,
      balance_after: balanceAfter,
      expense_id: expenseId,
      reference_type: referenceType,
      reference_id: referenceId,
      description,
      notes,
      performed_by: performedBy,
      pc_user_id: pcUserId,
      transaction_date: new Date(),
    });

    winston.info('Petty cash transaction logged', {
      transactionId: id,
      transactionNumber,
      transactionType,
      cardId,
      amount,
    });

    return id;
  } catch (error) {
    winston.error('Failed to log petty cash transaction', {
      error: error.message,
      params,
    });
    // Don't throw - transaction logging should not break main operations
    return null;
  }
};

/**
 * Log initial balance when card is created
 */
const logInitialBalance = async (db, cardId, amount, performedBy, companyId) => {
  return logTransaction(db, {
    cardId,
    transactionType: 'initial_balance',
    amount,
    balanceBefore: 0,
    balanceAfter: amount,
    description: 'Initial balance set on card creation',
    performedBy,
    companyId,
  });
};

/**
 * Log card reload
 */
const logReload = async (db, cardId, amount, balanceBefore, balanceAfter, performedBy, companyId, notes = null) => {
  return logTransaction(db, {
    cardId,
    transactionType: 'reload',
    amount,
    balanceBefore,
    balanceAfter,
    description: 'Balance reloaded',
    notes,
    performedBy,
    companyId,
  });
};

/**
 * Log expense submission
 */
const logExpenseSubmission = async (db, cardId, expenseId, amount, balanceBefore, companyId, pcUserId = null, performedBy = null) => {
  return logTransaction(db, {
    cardId,
    transactionType: 'expense',
    amount,
    balanceBefore,
    balanceAfter: balanceBefore, // Balance not changed until approved
    expenseId,
    description: 'Expense submitted (pending approval)',
    pcUserId,
    performedBy,
    companyId,
  });
};

/**
 * Log expense approval (balance deducted)
 */
const logExpenseApproval = async (db, cardId, expenseId, amount, balanceBefore, balanceAfter, performedBy, companyId) => {
  return logTransaction(db, {
    cardId,
    transactionType: 'expense_approved',
    amount: -amount, // Negative as it's a deduction
    balanceBefore,
    balanceAfter,
    expenseId,
    description: 'Expense approved - balance deducted',
    performedBy,
    companyId,
  });
};

/**
 * Log expense rejection
 */
const logExpenseRejection = async (db, cardId, expenseId, amount, performedBy, companyId, notes = null) => {
  // Get current balance
  const card = await db('petty_cash_cards').where('id', cardId).first();

  return logTransaction(db, {
    cardId,
    transactionType: 'expense_rejected',
    amount: 0, // No balance change
    balanceBefore: card?.currentBalance || 0,
    balanceAfter: card?.currentBalance || 0,
    expenseId,
    description: 'Expense rejected',
    notes,
    performedBy,
    companyId,
  });
};

/**
 * Log manual balance adjustment
 */
const logAdjustment = async (db, cardId, amount, balanceBefore, balanceAfter, performedBy, companyId, notes = null) => {
  return logTransaction(db, {
    cardId,
    transactionType: 'adjustment',
    amount,
    balanceBefore,
    balanceAfter,
    description: 'Manual balance adjustment',
    notes,
    performedBy,
    companyId,
  });
};

/**
 * Log manual deduction
 */
const logDeduction = async (db, cardId, amount, balanceBefore, balanceAfter, performedBy, companyId, notes = null) => {
  return logTransaction(db, {
    cardId,
    transactionType: 'deduction',
    amount: -amount,
    balanceBefore,
    balanceAfter,
    description: 'Manual balance deduction',
    notes,
    performedBy,
    companyId,
  });
};

/**
 * Get transaction history for a card
 */
const getCardTransactionHistory = async (db, cardId, options = {}) => {
  const {
    page = 1,
    limit = 50,
    transactionType = null,
    dateFrom = null,
    dateTo = null,
  } = options;

  const offset = (page - 1) * limit;

  let query = db('petty_cash_transactions')
    .where('card_id', cardId)
    .orderBy('transaction_date', 'desc');

  if (transactionType) {
    query = query.where('transaction_type', transactionType);
  }

  if (dateFrom) {
    query = query.where('transaction_date', '>=', dateFrom);
  }

  if (dateTo) {
    query = query.where('transaction_date', '<=', dateTo);
  }

  // Get total count
  const countQuery = query.clone();
  const [{ count }] = await countQuery.clearSelect().clearOrder().count('* as count');

  // Get paginated results with user details
  const transactions = await query
    .select(
      'petty_cash_transactions.*',
      'users.firstName as performedByFirstName',
      'users.lastName as performedByLastName',
      'petty_cash_users.name as pcUserName'
    )
    .leftJoin('users', 'petty_cash_transactions.performed_by', 'users.id')
    .leftJoin('petty_cash_users', 'petty_cash_transactions.pc_user_id', 'petty_cash_users.id')
    .limit(limit)
    .offset(offset);

  return {
    transactions,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total: count,
      pages: Math.ceil(count / limit),
    },
  };
};

module.exports = {
  generateTransactionNumber,
  logTransaction,
  logInitialBalance,
  logReload,
  logExpenseSubmission,
  logExpenseApproval,
  logExpenseRejection,
  logAdjustment,
  logDeduction,
  getCardTransactionHistory,
};
