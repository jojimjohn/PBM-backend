const express = require('express');
const router = express.Router();
const { getDbConnection } = require('../config/database');
const { requirePermission } = require('../middleware/auth');
const { validate, validateParams } = require('../middleware/validation');
const Joi = require('joi');
const { logger, auditLog } = require('../utils/logger');

// Validation schemas
const bankAccountSchema = Joi.object({
  account_number: Joi.string().min(5).max(50).required(),
  account_name: Joi.string().min(2).max(100).required(),
  bank_name: Joi.string().min(2).max(100).required(),
  branch_name: Joi.string().max(100).allow('', null).optional(),
  branch_code: Joi.string().max(20).allow('', null).optional(),
  iban: Joi.string().max(50).allow('', null).optional(),
  swift_code: Joi.string().max(20).allow('', null).optional(),
  currency: Joi.string().max(10).default('OMR'),
  account_type: Joi.string().valid('checking', 'savings', 'credit', 'loan').default('checking'),
  opening_balance: Joi.number().precision(2).default(0),
  is_active: Joi.alternatives().try(Joi.boolean(), Joi.number().valid(0, 1)).default(true),
  notes: Joi.string().max(1000).allow('', null).optional()
}).options({ stripUnknown: true });

const updateBankAccountSchema = bankAccountSchema.fork(
  ['account_number', 'account_name', 'bank_name'],
  (schema) => schema.optional()
).options({ stripUnknown: true });

// GET /api/bank-accounts - List all bank accounts
router.get('/', requirePermission('VIEW_SETTINGS'), async (req, res) => {
  try {
    const { companyId } = req.user;
    const db = getDbConnection(companyId);

    const {
      page = 1,
      limit = 50,
      is_active,
      account_type,
      search
    } = req.query;

    const offset = (page - 1) * limit;

    let query = db('bank_accounts')
      .select('bank_accounts.*')
      .where('bank_accounts.company_id', companyId)
      .orderBy('bank_accounts.is_active', 'desc')
      .orderBy('bank_accounts.account_name', 'asc');

    // Apply filters
    if (is_active !== undefined) {
      query = query.where('bank_accounts.is_active', is_active === 'true' || is_active === '1');
    }

    if (account_type) {
      query = query.where('bank_accounts.account_type', account_type);
    }

    if (search) {
      query = query.where(function() {
        this.where('bank_accounts.account_number', 'like', `%${search}%`)
            .orWhere('bank_accounts.account_name', 'like', `%${search}%`)
            .orWhere('bank_accounts.bank_name', 'like', `%${search}%`)
            .orWhere('bank_accounts.iban', 'like', `%${search}%`);
      });
    }

    // Get total count for pagination
    const totalQuery = query.clone();
    const [{ count }] = await totalQuery.clearSelect().clearOrder().count('* as count');

    // Get paginated results
    const accounts = await query.limit(limit).offset(offset);

    // Get summary statistics
    const stats = await db('bank_accounts')
      .where({ company_id: companyId, is_active: 1 })
      .select(
        db.raw('COUNT(*) as total_accounts'),
        db.raw('SUM(current_balance) as total_balance'),
        db.raw('SUM(CASE WHEN current_balance > 0 THEN current_balance ELSE 0 END) as positive_balance'),
        db.raw('SUM(CASE WHEN current_balance < 0 THEN current_balance ELSE 0 END) as negative_balance')
      )
      .first();

    auditLog('BANK_ACCOUNTS_VIEWED', req.user.userId, {
      companyId,
      count: accounts.length,
      filters: { is_active, account_type, search }
    });

    res.json({
      success: true,
      data: accounts,
      summary: {
        totalAccounts: parseInt(stats.total_accounts) || 0,
        totalBalance: parseFloat(stats.total_balance) || 0,
        positiveBalance: parseFloat(stats.positive_balance) || 0,
        negativeBalance: parseFloat(stats.negative_balance) || 0
      },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count,
        pages: Math.ceil(count / limit)
      }
    });

  } catch (error) {
    logger.error('Error fetching bank accounts', {
      error: error.message,
      companyId: req.user.companyId,
      userId: req.user.userId
    });

    res.status(500).json({
      success: false,
      error: 'Failed to fetch bank accounts'
    });
  }
});

// GET /api/bank-accounts/:id - Get specific bank account with recent transactions
router.get('/:id',
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  requirePermission('VIEW_SETTINGS'),
  async (req, res) => {
    try {
      const { companyId } = req.user;
      const { id } = req.params;
      const db = getDbConnection(companyId);

      const account = await db('bank_accounts')
        .leftJoin('users', 'bank_accounts.created_by', 'users.id')
        .select(
          'bank_accounts.*',
          db.raw('CONCAT(users.firstName, " ", users.lastName) as created_by_name')
        )
        .where({
          'bank_accounts.id': id,
          'bank_accounts.company_id': companyId
        })
        .first();

      if (!account) {
        return res.status(404).json({
          success: false,
          error: 'Bank account not found'
        });
      }

      // Get recent transactions
      const recentTransactions = await db('bank_transactions')
        .where('account_id', id)
        .orderBy('transaction_date', 'desc')
        .orderBy('created_at', 'desc')
        .limit(10);

      // Get transaction stats for this account
      const transactionStats = await db('bank_transactions')
        .where('account_id', id)
        .select(
          db.raw('COUNT(*) as total_transactions'),
          db.raw('SUM(CASE WHEN transaction_type IN ("deposit", "transfer_in", "interest") THEN amount ELSE 0 END) as total_credits'),
          db.raw('SUM(CASE WHEN transaction_type IN ("withdrawal", "transfer_out", "fee", "charge") THEN amount ELSE 0 END) as total_debits'),
          db.raw('COUNT(CASE WHEN reconciled = 0 THEN 1 END) as unreconciled_count')
        )
        .first();

      auditLog('BANK_ACCOUNT_VIEWED', req.user.userId, {
        accountId: id,
        accountNumber: account.account_number,
        companyId
      });

      res.json({
        success: true,
        data: {
          ...account,
          recentTransactions,
          stats: {
            totalTransactions: parseInt(transactionStats.total_transactions) || 0,
            totalCredits: parseFloat(transactionStats.total_credits) || 0,
            totalDebits: parseFloat(transactionStats.total_debits) || 0,
            unreconciledCount: parseInt(transactionStats.unreconciled_count) || 0
          }
        }
      });

    } catch (error) {
      logger.error('Error fetching bank account', {
        error: error.message,
        accountId: req.params.id,
        companyId: req.user.companyId,
        userId: req.user.userId
      });

      res.status(500).json({
        success: false,
        error: 'Failed to fetch bank account'
      });
    }
});

// POST /api/bank-accounts - Create new bank account
router.post('/',
  validate(bankAccountSchema),
  requirePermission('MANAGE_SETTINGS'),
  async (req, res) => {
    try {
      const { companyId, userId } = req.user;
      const db = getDbConnection(companyId);

      // Check if account number already exists for this company
      const existingAccount = await db('bank_accounts')
        .where({
          company_id: companyId,
          account_number: req.body.account_number
        })
        .first();

      if (existingAccount) {
        return res.status(400).json({
          success: false,
          error: 'A bank account with this account number already exists'
        });
      }

      const accountData = {
        ...req.body,
        company_id: companyId,
        current_balance: req.body.opening_balance || 0,
        created_by: userId,
        created_at: new Date(),
        updated_at: new Date()
      };

      const [accountId] = await db('bank_accounts').insert(accountData);

      const newAccount = await db('bank_accounts')
        .where({ id: accountId })
        .first();

      auditLog('BANK_ACCOUNT_CREATED', userId, {
        accountId,
        accountNumber: newAccount.account_number,
        bankName: newAccount.bank_name,
        openingBalance: newAccount.opening_balance,
        companyId
      });

      logger.info('Bank account created', {
        accountId,
        accountNumber: newAccount.account_number,
        companyId,
        userId
      });

      res.status(201).json({
        success: true,
        message: 'Bank account created successfully',
        data: newAccount
      });

    } catch (error) {
      logger.error('Error creating bank account', {
        error: error.message,
        accountData: req.body,
        companyId: req.user.companyId,
        userId: req.user.userId
      });

      res.status(500).json({
        success: false,
        error: 'Failed to create bank account'
      });
    }
});

// PUT /api/bank-accounts/:id - Update bank account
router.put('/:id',
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  validate(updateBankAccountSchema),
  requirePermission('MANAGE_SETTINGS'),
  async (req, res) => {
    try {
      const { companyId, userId } = req.user;
      const { id } = req.params;
      const db = getDbConnection(companyId);

      // Check if account exists
      const existingAccount = await db('bank_accounts')
        .where({
          id,
          company_id: companyId
        })
        .first();

      if (!existingAccount) {
        return res.status(404).json({
          success: false,
          error: 'Bank account not found'
        });
      }

      // If account number is being changed, check for duplicates
      if (req.body.account_number && req.body.account_number !== existingAccount.account_number) {
        const numberExists = await db('bank_accounts')
          .where({
            company_id: companyId,
            account_number: req.body.account_number
          })
          .whereNot('id', id)
          .first();

        if (numberExists) {
          return res.status(400).json({
            success: false,
            error: 'A bank account with this account number already exists'
          });
        }
      }

      const updateData = {
        ...req.body,
        updated_at: new Date()
      };

      // Don't allow changing company_id, created_by, or current_balance directly
      delete updateData.company_id;
      delete updateData.created_by;
      delete updateData.current_balance;

      await db('bank_accounts')
        .where({ id })
        .update(updateData);

      const updatedAccount = await db('bank_accounts')
        .where({ id })
        .first();

      auditLog('BANK_ACCOUNT_UPDATED', userId, {
        accountId: id,
        accountNumber: updatedAccount.account_number,
        changes: Object.keys(req.body),
        companyId
      });

      logger.info('Bank account updated', {
        accountId: id,
        accountNumber: updatedAccount.account_number,
        companyId,
        userId
      });

      res.json({
        success: true,
        message: 'Bank account updated successfully',
        data: updatedAccount
      });

    } catch (error) {
      logger.error('Error updating bank account', {
        error: error.message,
        accountId: req.params.id,
        accountData: req.body,
        companyId: req.user.companyId,
        userId: req.user.userId
      });

      res.status(500).json({
        success: false,
        error: 'Failed to update bank account'
      });
    }
});

// PATCH /api/bank-accounts/:id/status - Toggle account active status
router.patch('/:id/status',
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  validate(Joi.object({ is_active: Joi.boolean().required() })),
  requirePermission('MANAGE_SETTINGS'),
  async (req, res) => {
    try {
      const { companyId, userId } = req.user;
      const { id } = req.params;
      const { is_active } = req.body;
      const db = getDbConnection(companyId);

      const account = await db('bank_accounts')
        .where({ id, company_id: companyId })
        .first();

      if (!account) {
        return res.status(404).json({
          success: false,
          error: 'Bank account not found'
        });
      }

      await db('bank_accounts')
        .where({ id })
        .update({
          is_active,
          updated_at: new Date()
        });

      auditLog('BANK_ACCOUNT_STATUS_CHANGED', userId, {
        accountId: id,
        accountNumber: account.account_number,
        oldStatus: account.is_active,
        newStatus: is_active,
        companyId
      });

      res.json({
        success: true,
        message: `Bank account ${is_active ? 'activated' : 'deactivated'} successfully`,
        data: { id, is_active }
      });

    } catch (error) {
      logger.error('Error updating bank account status', {
        error: error.message,
        accountId: req.params.id,
        companyId: req.user.companyId,
        userId: req.user.userId
      });

      res.status(500).json({
        success: false,
        error: 'Failed to update bank account status'
      });
    }
});

// DELETE /api/bank-accounts/:id - Delete bank account
router.delete('/:id',
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  requirePermission('MANAGE_SETTINGS'),
  async (req, res) => {
    try {
      const { companyId, userId } = req.user;
      const { id } = req.params;
      const db = getDbConnection(companyId);

      // Check if account exists
      const account = await db('bank_accounts')
        .where({
          id,
          company_id: companyId
        })
        .first();

      if (!account) {
        return res.status(404).json({
          success: false,
          error: 'Bank account not found'
        });
      }

      // Check if account has transactions
      const transactionCount = await db('bank_transactions')
        .where({ account_id: id })
        .count('* as count')
        .first();

      if (transactionCount.count > 0) {
        // Soft delete - just deactivate
        await db('bank_accounts')
          .where({ id })
          .update({
            is_active: false,
            updated_at: new Date()
          });

        auditLog('BANK_ACCOUNT_DEACTIVATED', userId, {
          accountId: id,
          accountNumber: account.account_number,
          reason: 'Has associated transactions',
          transactionCount: transactionCount.count,
          companyId
        });

        return res.json({
          success: true,
          message: 'Bank account deactivated (has associated transactions)',
          data: { id, is_active: false }
        });
      }

      // Hard delete if no transactions
      await db('bank_accounts')
        .where({ id })
        .delete();

      auditLog('BANK_ACCOUNT_DELETED', userId, {
        accountId: id,
        accountNumber: account.account_number,
        bankName: account.bank_name,
        companyId
      });

      logger.info('Bank account deleted', {
        accountId: id,
        accountNumber: account.account_number,
        companyId,
        userId
      });

      res.json({
        success: true,
        message: 'Bank account deleted successfully'
      });

    } catch (error) {
      logger.error('Error deleting bank account', {
        error: error.message,
        accountId: req.params.id,
        companyId: req.user.companyId,
        userId: req.user.userId
      });

      res.status(500).json({
        success: false,
        error: 'Failed to delete bank account'
      });
    }
});

// GET /api/bank-accounts/:id/balance-history - Get balance history for charting
router.get('/:id/balance-history',
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  requirePermission('VIEW_SETTINGS'),
  async (req, res) => {
    try {
      const { companyId } = req.user;
      const { id } = req.params;
      const { days = 30 } = req.query;
      const db = getDbConnection(companyId);

      // Verify account belongs to company
      const account = await db('bank_accounts')
        .where({ id, company_id: companyId })
        .first();

      if (!account) {
        return res.status(404).json({
          success: false,
          error: 'Bank account not found'
        });
      }

      // Get daily balance snapshots from transactions
      const history = await db('bank_transactions')
        .where('account_id', id)
        .where('transaction_date', '>=', db.raw(`DATE_SUB(CURDATE(), INTERVAL ? DAY)`, [days]))
        .select(
          'transaction_date',
          db.raw('MAX(balance_after) as closing_balance'),
          db.raw('SUM(CASE WHEN transaction_type IN ("deposit", "transfer_in", "interest") THEN amount ELSE 0 END) as daily_credits'),
          db.raw('SUM(CASE WHEN transaction_type IN ("withdrawal", "transfer_out", "fee", "charge") THEN amount ELSE 0 END) as daily_debits')
        )
        .groupBy('transaction_date')
        .orderBy('transaction_date', 'asc');

      res.json({
        success: true,
        data: {
          accountId: id,
          accountNumber: account.account_number,
          currentBalance: parseFloat(account.current_balance) || 0,
          history: history.map(h => ({
            date: h.transaction_date,
            closingBalance: parseFloat(h.closing_balance) || 0,
            dailyCredits: parseFloat(h.daily_credits) || 0,
            dailyDebits: parseFloat(h.daily_debits) || 0
          }))
        }
      });

    } catch (error) {
      logger.error('Error fetching balance history', {
        error: error.message,
        accountId: req.params.id,
        companyId: req.user.companyId,
        userId: req.user.userId
      });

      res.status(500).json({
        success: false,
        error: 'Failed to fetch balance history'
      });
    }
});

module.exports = router;
