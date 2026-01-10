const express = require('express');
const router = express.Router();
const { getDbConnection } = require('../config/database');
const { requirePermission } = require('../middleware/auth');
const { validate, validateParams } = require('../middleware/validation');
const { uploadMultipleToS3, requireFiles } = require('../middleware/upload');
const storageService = require('../services/storageService');
const { bankTransactionAttachments } = require('../repositories/AttachmentRepository');
const Joi = require('joi');
const { logger, auditLog } = require('../utils/logger');

// Validation schemas
const bankTransactionSchema = Joi.object({
  account_id: Joi.number().integer().positive().required(),
  transaction_date: Joi.date().required(),
  transaction_type: Joi.string().valid(
    'deposit', 'withdrawal', 'transfer_in', 'transfer_out', 'fee', 'interest', 'charge'
  ).required(),
  category: Joi.string().max(50).allow('', null).optional(),
  amount: Joi.number().positive().precision(2).required(),
  reference_number: Joi.string().max(50).allow('', null).optional(),
  reference_type: Joi.string().max(50).allow('', null).optional(),
  reference_id: Joi.number().integer().positive().allow(null).optional(),
  description: Joi.string().max(1000).allow('', null).optional(),
  payee_payer: Joi.string().max(100).allow('', null).optional(),
  notes: Joi.string().max(1000).allow('', null).optional()
}).options({ stripUnknown: true });

const updateTransactionSchema = bankTransactionSchema.fork(
  ['account_id', 'transaction_date', 'transaction_type', 'amount'],
  (schema) => schema.optional()
).options({ stripUnknown: true });

const reconcileSchema = Joi.object({
  transaction_ids: Joi.array().items(Joi.number().integer().positive()).min(1).required()
}).options({ stripUnknown: true });

const linkPaymentSchema = Joi.object({
  account_id: Joi.number().integer().positive().required(),
  transaction_date: Joi.date().required(),
  amount: Joi.number().positive().precision(2).required(),
  reference_type: Joi.string().valid('purchase_invoice', 'sales_order', 'petty_cash_reload').required(),
  reference_id: Joi.number().integer().positive().required(),
  reference_number: Joi.string().max(50).allow('', null).optional(),
  payee_payer: Joi.string().max(100).allow('', null).optional(),
  description: Joi.string().max(500).allow('', null).optional(),
  notes: Joi.string().max(1000).allow('', null).optional()
}).options({ stripUnknown: true });

// Helper function to generate transaction number
const generateTransactionNumber = async (db) => {
  const year = new Date().getFullYear();
  const prefix = `TXN-${year}-`;

  const lastTransaction = await db('bank_transactions')
    .where('transaction_number', 'like', `${prefix}%`)
    .orderBy('id', 'desc')
    .first();

  let nextNumber = 1;
  if (lastTransaction) {
    const lastNumber = parseInt(lastTransaction.transaction_number.split('-').pop()) || 0;
    nextNumber = lastNumber + 1;
  }

  return `${prefix}${String(nextNumber).padStart(6, '0')}`;
};

// Helper function to update account balance
const updateAccountBalance = async (db, accountId, amount, isCredit) => {
  const account = await db('bank_accounts').where({ id: accountId }).first();
  if (!account) throw new Error('Bank account not found');

  const currentBalance = parseFloat(account.current_balance) || 0;
  const newBalance = isCredit ? currentBalance + amount : currentBalance - amount;

  await db('bank_accounts')
    .where({ id: accountId })
    .update({
      current_balance: newBalance,
      updated_at: new Date()
    });

  return newBalance;
};

// Check if transaction is a credit (increases balance)
const isCreditTransaction = (type) => {
  return ['deposit', 'transfer_in', 'interest'].includes(type);
};

// GET /api/bank-transactions - List all transactions
router.get('/', requirePermission('VIEW_SETTINGS'), async (req, res) => {
  try {
    const { companyId } = req.user;
    const db = getDbConnection(companyId);

    const {
      page = 1,
      limit = 50,
      account_id,
      transaction_type,
      category,
      reconciled,
      start_date,
      end_date,
      reference_type,
      search
    } = req.query;

    const offset = (page - 1) * limit;

    let query = db('bank_transactions')
      .leftJoin('bank_accounts', 'bank_transactions.account_id', 'bank_accounts.id')
      .leftJoin('users as created_users', 'bank_transactions.created_by', 'created_users.id')
      .select(
        'bank_transactions.*',
        'bank_accounts.account_number',
        'bank_accounts.account_name',
        'bank_accounts.bank_name',
        db.raw('CONCAT(created_users.firstName, " ", created_users.lastName) as created_by_name')
      )
      .where('bank_accounts.company_id', companyId)
      .orderBy('bank_transactions.transaction_date', 'desc')
      .orderBy('bank_transactions.created_at', 'desc');

    // Apply filters
    if (account_id) {
      query = query.where('bank_transactions.account_id', account_id);
    }

    if (transaction_type) {
      query = query.where('bank_transactions.transaction_type', transaction_type);
    }

    if (category) {
      query = query.where('bank_transactions.category', category);
    }

    if (reconciled !== undefined) {
      query = query.where('bank_transactions.reconciled', reconciled === 'true' || reconciled === '1');
    }

    if (start_date) {
      query = query.where('bank_transactions.transaction_date', '>=', start_date);
    }

    if (end_date) {
      query = query.where('bank_transactions.transaction_date', '<=', end_date);
    }

    if (reference_type) {
      query = query.where('bank_transactions.reference_type', reference_type);
    }

    if (search) {
      query = query.where(function() {
        this.where('bank_transactions.transaction_number', 'like', `%${search}%`)
            .orWhere('bank_transactions.reference_number', 'like', `%${search}%`)
            .orWhere('bank_transactions.payee_payer', 'like', `%${search}%`)
            .orWhere('bank_transactions.description', 'like', `%${search}%`);
      });
    }

    // Get total count for pagination
    const totalQuery = query.clone();
    const [{ count }] = await totalQuery.clearSelect().clearOrder().count('* as count');

    // Get paginated results
    const transactions = await query.limit(limit).offset(offset);

    // Get summary statistics for the filtered results
    const summaryQuery = db('bank_transactions')
      .leftJoin('bank_accounts', 'bank_transactions.account_id', 'bank_accounts.id')
      .where('bank_accounts.company_id', companyId);

    if (account_id) summaryQuery.where('bank_transactions.account_id', account_id);
    if (start_date) summaryQuery.where('bank_transactions.transaction_date', '>=', start_date);
    if (end_date) summaryQuery.where('bank_transactions.transaction_date', '<=', end_date);

    const summary = await summaryQuery
      .select(
        db.raw('SUM(CASE WHEN transaction_type IN ("deposit", "transfer_in", "interest") THEN amount ELSE 0 END) as total_credits'),
        db.raw('SUM(CASE WHEN transaction_type IN ("withdrawal", "transfer_out", "fee", "charge") THEN amount ELSE 0 END) as total_debits'),
        db.raw('COUNT(CASE WHEN reconciled = 0 THEN 1 END) as unreconciled_count')
      )
      .first();

    auditLog('BANK_TRANSACTIONS_VIEWED', req.user.userId, {
      companyId,
      count: transactions.length,
      filters: { account_id, transaction_type, category, reconciled, start_date, end_date }
    });

    res.json({
      success: true,
      data: transactions,
      summary: {
        totalCredits: parseFloat(summary.total_credits) || 0,
        totalDebits: parseFloat(summary.total_debits) || 0,
        netFlow: (parseFloat(summary.total_credits) || 0) - (parseFloat(summary.total_debits) || 0),
        unreconciledCount: parseInt(summary.unreconciled_count) || 0
      },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count,
        pages: Math.ceil(count / limit)
      }
    });

  } catch (error) {
    logger.error('Error fetching bank transactions', {
      error: error.message,
      companyId: req.user.companyId,
      userId: req.user.userId
    });

    res.status(500).json({
      success: false,
      error: 'Failed to fetch bank transactions'
    });
  }
});

// GET /api/bank-transactions/categories - Get transaction categories
router.get('/categories', requirePermission('VIEW_SETTINGS'), async (req, res) => {
  try {
    // Predefined categories for bank transactions
    const categories = [
      { value: 'sales', label: 'Sales Revenue' },
      { value: 'purchases', label: 'Purchase Payments' },
      { value: 'salary', label: 'Salary & Wages' },
      { value: 'utilities', label: 'Utilities' },
      { value: 'rent', label: 'Rent & Lease' },
      { value: 'petty_cash', label: 'Petty Cash' },
      { value: 'loan_payment', label: 'Loan Payment' },
      { value: 'loan_receipt', label: 'Loan Receipt' },
      { value: 'tax', label: 'Tax Payment' },
      { value: 'insurance', label: 'Insurance' },
      { value: 'maintenance', label: 'Maintenance' },
      { value: 'transport', label: 'Transport' },
      { value: 'miscellaneous', label: 'Miscellaneous' },
      { value: 'refund', label: 'Refund' },
      { value: 'transfer', label: 'Internal Transfer' }
    ];

    res.json({
      success: true,
      data: categories
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch categories'
    });
  }
});

// GET /api/bank-transactions/:id - Get specific transaction
router.get('/:id',
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  requirePermission('VIEW_SETTINGS'),
  async (req, res) => {
    try {
      const { companyId } = req.user;
      const { id } = req.params;
      const db = getDbConnection(companyId);

      const transaction = await db('bank_transactions')
        .leftJoin('bank_accounts', 'bank_transactions.account_id', 'bank_accounts.id')
        .leftJoin('users as created_users', 'bank_transactions.created_by', 'created_users.id')
        .leftJoin('users as reconciled_users', 'bank_transactions.reconciled_by', 'reconciled_users.id')
        .select(
          'bank_transactions.*',
          'bank_accounts.account_number',
          'bank_accounts.account_name',
          'bank_accounts.bank_name',
          db.raw('CONCAT(created_users.firstName, " ", created_users.lastName) as created_by_name'),
          db.raw('CONCAT(reconciled_users.firstName, " ", reconciled_users.lastName) as reconciled_by_name')
        )
        .where('bank_transactions.id', id)
        .where('bank_accounts.company_id', companyId)
        .first();

      if (!transaction) {
        return res.status(404).json({
          success: false,
          error: 'Transaction not found'
        });
      }

      // Get linked reference details if available
      let referenceDetails = null;
      if (transaction.reference_type && transaction.reference_id) {
        if (transaction.reference_type === 'purchase_invoice') {
          referenceDetails = await db('purchase_invoices')
            .where({ id: transaction.reference_id })
            .select('invoice_number', 'invoice_date', 'total_amount', 'status')
            .first();
        } else if (transaction.reference_type === 'sales_order') {
          referenceDetails = await db('sales_orders')
            .where({ id: transaction.reference_id })
            .select('orderNumber', 'orderDate', 'totalAmount', 'status')
            .first();
        } else if (transaction.reference_type === 'petty_cash_reload') {
          referenceDetails = await db('petty_cash_cards')
            .where({ id: transaction.reference_id })
            .select('cardNumber', 'cardholderName', 'currentBalance')
            .first();
        }
      }

      res.json({
        success: true,
        data: {
          ...transaction,
          referenceDetails
        }
      });

    } catch (error) {
      logger.error('Error fetching bank transaction', {
        error: error.message,
        transactionId: req.params.id,
        companyId: req.user.companyId,
        userId: req.user.userId
      });

      res.status(500).json({
        success: false,
        error: 'Failed to fetch transaction'
      });
    }
});

// POST /api/bank-transactions - Create new transaction
router.post('/',
  validate(bankTransactionSchema),
  requirePermission('MANAGE_SETTINGS'),
  async (req, res) => {
    try {
      const { companyId, userId } = req.user;
      const db = getDbConnection(companyId);

      // Verify account belongs to this company
      const account = await db('bank_accounts')
        .where({ id: req.body.account_id, company_id: companyId })
        .first();

      if (!account) {
        return res.status(400).json({
          success: false,
          error: 'Invalid bank account'
        });
      }

      // Generate transaction number
      const transactionNumber = await generateTransactionNumber(db);

      // Calculate new balance
      const amount = parseFloat(req.body.amount);
      const isCredit = isCreditTransaction(req.body.transaction_type);
      const newBalance = await updateAccountBalance(db, req.body.account_id, amount, isCredit);

      const transactionData = {
        ...req.body,
        transaction_number: transactionNumber,
        balance_after: newBalance,
        reconciled: 0,
        created_by: userId,
        created_at: new Date(),
        updated_at: new Date()
      };

      const [transactionId] = await db('bank_transactions').insert(transactionData);

      const newTransaction = await db('bank_transactions')
        .leftJoin('bank_accounts', 'bank_transactions.account_id', 'bank_accounts.id')
        .select('bank_transactions.*', 'bank_accounts.account_number', 'bank_accounts.account_name')
        .where('bank_transactions.id', transactionId)
        .first();

      auditLog('BANK_TRANSACTION_CREATED', userId, {
        transactionId,
        transactionNumber,
        accountId: req.body.account_id,
        type: req.body.transaction_type,
        amount,
        newBalance,
        companyId
      });

      logger.info('Bank transaction created', {
        transactionId,
        transactionNumber,
        accountId: req.body.account_id,
        amount,
        companyId,
        userId
      });

      res.status(201).json({
        success: true,
        message: 'Transaction recorded successfully',
        data: newTransaction
      });

    } catch (error) {
      logger.error('Error creating bank transaction', {
        error: error.message,
        transactionData: req.body,
        companyId: req.user.companyId,
        userId: req.user.userId
      });

      res.status(500).json({
        success: false,
        error: 'Failed to record transaction'
      });
    }
});

// POST /api/bank-transactions/link-payment - Create transaction linked to PO/SO/PettyCash
router.post('/link-payment',
  validate(linkPaymentSchema),
  requirePermission('MANAGE_SETTINGS'),
  async (req, res) => {
    try {
      const { companyId, userId } = req.user;
      const db = getDbConnection(companyId);

      const {
        account_id,
        transaction_date,
        amount,
        reference_type,
        reference_id,
        reference_number,
        payee_payer,
        description,
        notes
      } = req.body;

      // Verify account belongs to this company
      const account = await db('bank_accounts')
        .where({ id: account_id, company_id: companyId })
        .first();

      if (!account) {
        return res.status(400).json({
          success: false,
          error: 'Invalid bank account'
        });
      }

      // Determine transaction type and category based on reference
      let transactionType, category, autoPayeePayer, autoDescription;

      if (reference_type === 'purchase_invoice') {
        transactionType = 'withdrawal';
        category = 'purchases';

        const invoice = await db('purchase_invoices')
          .leftJoin('suppliers', 'purchase_invoices.supplier_id', 'suppliers.id')
          .select('purchase_invoices.invoice_number', 'suppliers.name as supplier_name')
          .where('purchase_invoices.id', reference_id)
          .first();

        if (!invoice) {
          return res.status(400).json({
            success: false,
            error: 'Purchase invoice not found'
          });
        }

        autoPayeePayer = invoice.supplier_name;
        autoDescription = `Payment for invoice ${invoice.invoice_number}`;

      } else if (reference_type === 'sales_order') {
        transactionType = 'deposit';
        category = 'sales';

        const salesOrder = await db('sales_orders')
          .leftJoin('customers', 'sales_orders.customerId', 'customers.id')
          .select('sales_orders.orderNumber', 'customers.name as customer_name')
          .where('sales_orders.id', reference_id)
          .first();

        if (!salesOrder) {
          return res.status(400).json({
            success: false,
            error: 'Sales order not found'
          });
        }

        autoPayeePayer = salesOrder.customer_name;
        autoDescription = `Payment received for ${salesOrder.orderNumber}`;

      } else if (reference_type === 'petty_cash_reload') {
        transactionType = 'withdrawal';
        category = 'petty_cash';

        const pettyCashCard = await db('petty_cash_cards')
          .select('cardNumber', 'cardholderName')
          .where('id', reference_id)
          .first();

        if (!pettyCashCard) {
          return res.status(400).json({
            success: false,
            error: 'Petty cash card not found'
          });
        }

        autoPayeePayer = pettyCashCard.cardholderName;
        autoDescription = `Petty cash reload for ${pettyCashCard.cardNumber}`;
      }

      // Generate transaction number
      const transactionNumber = await generateTransactionNumber(db);

      // Calculate new balance
      const isCredit = isCreditTransaction(transactionType);
      const newBalance = await updateAccountBalance(db, account_id, amount, isCredit);

      const transactionData = {
        account_id,
        transaction_number: transactionNumber,
        transaction_date,
        transaction_type: transactionType,
        category,
        amount,
        reference_number: reference_number || null,
        reference_type,
        reference_id,
        description: description || autoDescription,
        payee_payer: payee_payer || autoPayeePayer,
        balance_after: newBalance,
        reconciled: 0,
        notes,
        created_by: userId,
        created_at: new Date(),
        updated_at: new Date()
      };

      const [transactionId] = await db('bank_transactions').insert(transactionData);

      const newTransaction = await db('bank_transactions')
        .leftJoin('bank_accounts', 'bank_transactions.account_id', 'bank_accounts.id')
        .select('bank_transactions.*', 'bank_accounts.account_number', 'bank_accounts.account_name')
        .where('bank_transactions.id', transactionId)
        .first();

      auditLog('BANK_TRANSACTION_LINKED', userId, {
        transactionId,
        transactionNumber,
        referenceType: reference_type,
        referenceId: reference_id,
        amount,
        companyId
      });

      logger.info('Linked bank transaction created', {
        transactionId,
        transactionNumber,
        referenceType: reference_type,
        referenceId: reference_id,
        amount,
        companyId,
        userId
      });

      res.status(201).json({
        success: true,
        message: 'Payment recorded and linked successfully',
        data: newTransaction
      });

    } catch (error) {
      logger.error('Error creating linked bank transaction', {
        error: error.message,
        transactionData: req.body,
        companyId: req.user.companyId,
        userId: req.user.userId
      });

      res.status(500).json({
        success: false,
        error: 'Failed to record payment'
      });
    }
});

// PUT /api/bank-transactions/:id - Update transaction (only unreconciled)
router.put('/:id',
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  validate(updateTransactionSchema),
  requirePermission('MANAGE_SETTINGS'),
  async (req, res) => {
    try {
      const { companyId, userId } = req.user;
      const { id } = req.params;
      const db = getDbConnection(companyId);

      // Get existing transaction
      const existingTransaction = await db('bank_transactions')
        .leftJoin('bank_accounts', 'bank_transactions.account_id', 'bank_accounts.id')
        .where('bank_transactions.id', id)
        .where('bank_accounts.company_id', companyId)
        .first();

      if (!existingTransaction) {
        return res.status(404).json({
          success: false,
          error: 'Transaction not found'
        });
      }

      if (existingTransaction.reconciled) {
        return res.status(400).json({
          success: false,
          error: 'Cannot edit a reconciled transaction'
        });
      }

      // If amount or type changed, recalculate balance
      const newAmount = req.body.amount !== undefined ? parseFloat(req.body.amount) : parseFloat(existingTransaction.amount);
      const newType = req.body.transaction_type || existingTransaction.transaction_type;

      const oldAmount = parseFloat(existingTransaction.amount);
      const oldIsCredit = isCreditTransaction(existingTransaction.transaction_type);
      const newIsCredit = isCreditTransaction(newType);

      // Reverse old transaction effect on balance
      let currentBalance = parseFloat(existingTransaction.balance_after);
      currentBalance = oldIsCredit ? currentBalance - oldAmount : currentBalance + oldAmount;

      // Apply new transaction effect
      const newBalanceAfter = newIsCredit ? currentBalance + newAmount : currentBalance - newAmount;

      const updateData = {
        ...req.body,
        balance_after: newBalanceAfter,
        updated_at: new Date()
      };

      // Don't allow changing certain fields
      delete updateData.transaction_number;
      delete updateData.created_by;
      delete updateData.reconciled;
      delete updateData.reconciled_at;
      delete updateData.reconciled_by;

      await db('bank_transactions')
        .where({ id })
        .update(updateData);

      // Update account balance if amount or type changed
      if (req.body.amount !== undefined || req.body.transaction_type) {
        await db('bank_accounts')
          .where({ id: existingTransaction.account_id })
          .update({
            current_balance: newBalanceAfter,
            updated_at: new Date()
          });
      }

      const updatedTransaction = await db('bank_transactions')
        .where({ id })
        .first();

      auditLog('BANK_TRANSACTION_UPDATED', userId, {
        transactionId: id,
        transactionNumber: updatedTransaction.transaction_number,
        changes: Object.keys(req.body),
        companyId
      });

      res.json({
        success: true,
        message: 'Transaction updated successfully',
        data: updatedTransaction
      });

    } catch (error) {
      logger.error('Error updating bank transaction', {
        error: error.message,
        transactionId: req.params.id,
        companyId: req.user.companyId,
        userId: req.user.userId
      });

      res.status(500).json({
        success: false,
        error: 'Failed to update transaction'
      });
    }
});

// POST /api/bank-transactions/reconcile - Mark transactions as reconciled
router.post('/reconcile',
  validate(reconcileSchema),
  requirePermission('MANAGE_SETTINGS'),
  async (req, res) => {
    try {
      const { companyId, userId } = req.user;
      const { transaction_ids } = req.body;
      const db = getDbConnection(companyId);

      // Verify all transactions belong to this company
      const transactions = await db('bank_transactions')
        .leftJoin('bank_accounts', 'bank_transactions.account_id', 'bank_accounts.id')
        .whereIn('bank_transactions.id', transaction_ids)
        .where('bank_accounts.company_id', companyId)
        .select('bank_transactions.id', 'bank_transactions.reconciled');

      if (transactions.length !== transaction_ids.length) {
        return res.status(400).json({
          success: false,
          error: 'Some transactions not found or do not belong to your company'
        });
      }

      const alreadyReconciled = transactions.filter(t => t.reconciled);
      if (alreadyReconciled.length > 0) {
        return res.status(400).json({
          success: false,
          error: `${alreadyReconciled.length} transaction(s) are already reconciled`
        });
      }

      await db('bank_transactions')
        .whereIn('id', transaction_ids)
        .update({
          reconciled: 1,
          reconciled_at: new Date(),
          reconciled_by: userId,
          updated_at: new Date()
        });

      auditLog('BANK_TRANSACTIONS_RECONCILED', userId, {
        transactionIds: transaction_ids,
        count: transaction_ids.length,
        companyId
      });

      res.json({
        success: true,
        message: `${transaction_ids.length} transaction(s) marked as reconciled`,
        data: { reconciled_count: transaction_ids.length }
      });

    } catch (error) {
      logger.error('Error reconciling bank transactions', {
        error: error.message,
        transactionIds: req.body.transaction_ids,
        companyId: req.user.companyId,
        userId: req.user.userId
      });

      res.status(500).json({
        success: false,
        error: 'Failed to reconcile transactions'
      });
    }
});

// DELETE /api/bank-transactions/:id - Delete transaction (only unreconciled)
router.delete('/:id',
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  requirePermission('MANAGE_SETTINGS'),
  async (req, res) => {
    try {
      const { companyId, userId } = req.user;
      const { id } = req.params;
      const db = getDbConnection(companyId);

      // Get transaction
      const transaction = await db('bank_transactions')
        .leftJoin('bank_accounts', 'bank_transactions.account_id', 'bank_accounts.id')
        .where('bank_transactions.id', id)
        .where('bank_accounts.company_id', companyId)
        .select('bank_transactions.*')
        .first();

      if (!transaction) {
        return res.status(404).json({
          success: false,
          error: 'Transaction not found'
        });
      }

      if (transaction.reconciled) {
        return res.status(400).json({
          success: false,
          error: 'Cannot delete a reconciled transaction'
        });
      }

      // Reverse the transaction effect on account balance
      const amount = parseFloat(transaction.amount);
      const isCredit = isCreditTransaction(transaction.transaction_type);

      const account = await db('bank_accounts').where({ id: transaction.account_id }).first();
      const currentBalance = parseFloat(account.current_balance);
      const newBalance = isCredit ? currentBalance - amount : currentBalance + amount;

      await db('bank_accounts')
        .where({ id: transaction.account_id })
        .update({
          current_balance: newBalance,
          updated_at: new Date()
        });

      // Delete the transaction
      await db('bank_transactions').where({ id }).delete();

      auditLog('BANK_TRANSACTION_DELETED', userId, {
        transactionId: id,
        transactionNumber: transaction.transaction_number,
        amount,
        type: transaction.transaction_type,
        companyId
      });

      logger.info('Bank transaction deleted', {
        transactionId: id,
        transactionNumber: transaction.transaction_number,
        companyId,
        userId
      });

      res.json({
        success: true,
        message: 'Transaction deleted successfully'
      });

    } catch (error) {
      logger.error('Error deleting bank transaction', {
        error: error.message,
        transactionId: req.params.id,
        companyId: req.user.companyId,
        userId: req.user.userId
      });

      res.status(500).json({
        success: false,
        error: 'Failed to delete transaction'
      });
    }
});

// ============================================================================
// ATTACHMENT ROUTES (S3/MinIO)
// ============================================================================

// POST /api/bank-transactions/:id/attachments - Upload attachments to bank transaction
router.post('/:id/attachments',
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  requirePermission('MANAGE_BANKING'),
  uploadMultipleToS3,
  requireFiles,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { companyId, userId } = req.user;
      const db = getDbConnection(companyId);

      // Check if bank transaction exists
      const transaction = await db('bank_transactions').where({ id }).first();

      if (!transaction) {
        // Delete uploaded S3 files if transaction doesn't exist
        if (req.files && req.files.length > 0) {
          await Promise.all(req.files.map(file =>
            storageService.deleteFile(file.key).catch(err =>
              logger.warn('Failed to delete orphaned S3 file', { key: file.key, error: err.message })
            )
          ));
        }
        return res.status(404).json({
          success: false,
          error: 'Bank transaction not found'
        });
      }

      // Save attachment metadata to database
      const savedAttachments = [];
      for (const file of req.files) {
        const attachment = await bankTransactionAttachments.create(db, {
          bank_transaction_id: id,
          file_key: file.key,
          file_name: file.originalname,
          file_size: file.size,
          mime_type: file.mimetype,
          uploaded_by: userId
        });
        savedAttachments.push(attachment);
      }

      auditLog('BANK_TRANSACTION_ATTACHMENTS_UPLOADED', userId, {
        transactionId: id,
        transactionNumber: transaction.transaction_number,
        filesCount: req.files.length,
        attachmentIds: savedAttachments.map(a => a.id)
      });

      res.json({
        success: true,
        data: savedAttachments,
        message: `${req.files.length} file(s) uploaded successfully`
      });

    } catch (error) {
      logger.error('Error uploading bank transaction attachments', {
        error: error.message,
        transactionId: req.params.id,
        userId: req.user.userId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to upload attachments'
      });
    }
  }
);

// GET /api/bank-transactions/:id/attachments - Get attachments for bank transaction
router.get('/:id/attachments',
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  requirePermission('VIEW_BANKING'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      // Verify bank transaction exists
      const transaction = await db('bank_transactions').where({ id }).first();

      if (!transaction) {
        return res.status(404).json({
          success: false,
          error: 'Bank transaction not found'
        });
      }

      // Get attachments from repository
      const attachments = await bankTransactionAttachments.findByEntity(db, id);

      // Generate presigned URLs for each attachment
      const attachmentsWithUrls = await Promise.all(
        attachments.map(async (attachment) => {
          try {
            const url = await storageService.getPresignedUrl(attachment.file_key);
            return { ...attachment, url };
          } catch (err) {
            logger.warn('Failed to generate presigned URL', {
              attachmentId: attachment.id,
              fileKey: attachment.file_key,
              error: err.message
            });
            return { ...attachment, url: null };
          }
        })
      );

      res.json({
        success: true,
        data: attachmentsWithUrls
      });

    } catch (error) {
      logger.error('Error fetching bank transaction attachments', {
        error: error.message,
        transactionId: req.params.id,
        userId: req.user.userId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch attachments'
      });
    }
  }
);

// DELETE /api/bank-transactions/:id/attachments/:fileId - Delete attachment from bank transaction
router.delete('/:id/attachments/:fileId',
  validateParams(Joi.object({
    id: Joi.number().integer().positive().required(),
    fileId: Joi.number().integer().positive().required()
  })),
  requirePermission('MANAGE_BANKING'),
  async (req, res) => {
    try {
      const { id, fileId } = req.params;
      const { companyId, userId } = req.user;
      const db = getDbConnection(companyId);

      // Verify bank transaction exists
      const transaction = await db('bank_transactions').where({ id }).first();

      if (!transaction) {
        return res.status(404).json({
          success: false,
          error: 'Bank transaction not found'
        });
      }

      // Get attachment record from repository
      const attachment = await bankTransactionAttachments.findById(db, fileId);

      if (!attachment || attachment.bank_transaction_id !== parseInt(id)) {
        return res.status(404).json({
          success: false,
          error: 'Attachment not found'
        });
      }

      // Delete file from S3
      await storageService.deleteFile(attachment.file_key);

      // Delete record from database
      await bankTransactionAttachments.delete(db, fileId);

      auditLog('BANK_TRANSACTION_ATTACHMENT_DELETED', userId, {
        transactionId: id,
        transactionNumber: transaction.transaction_number,
        attachmentId: fileId,
        fileName: attachment.file_name
      });

      res.json({
        success: true,
        message: 'Attachment deleted successfully'
      });

    } catch (error) {
      logger.error('Error deleting bank transaction attachment', {
        error: error.message,
        transactionId: req.params.id,
        fileId: req.params.fileId,
        userId: req.user.userId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to delete attachment'
      });
    }
  }
);

module.exports = router;
