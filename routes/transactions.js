const express = require('express');
const router = express.Router();
const { getDbConnection } = require('../config/database');
const { requirePermission } = require('../middleware/auth');
const { validate } = require('../middleware/validation');
const Joi = require('joi');
const winston = require('winston');

// Validation schemas
const transactionSchema = Joi.object({
  transactionType: Joi.string().valid(
    'sale', 'purchase', 'adjustment', 'transfer', 
    'wastage', 'return', 'petty_cash', 'expense'
  ).required(),
  referenceId: Joi.number().integer().positive().optional(),
  referenceType: Joi.string().max(50).optional(),
  materialId: Joi.number().integer().positive().optional(),
  quantity: Joi.number().optional(),
  unitPrice: Joi.number().optional(),
  amount: Joi.number().required(),
  transactionDate: Joi.date().iso().required(),
  description: Joi.string().max(2000).optional(),
  notes: Joi.string().max(1000).optional()
});

const bulkTransactionSchema = Joi.object({
  transactions: Joi.array().items(transactionSchema).min(1).max(100).required()
});

// Generate transaction number
function generateTransactionNumber(companyId, transactionType) {
  const prefix = companyId === 'al-ramrami' ? 'ALR' : 'PM';
  const typeCode = {
    sale: 'S',
    purchase: 'P',
    adjustment: 'ADJ',
    transfer: 'TRF',
    wastage: 'WST',
    return: 'RET',
    petty_cash: 'PC',
    expense: 'EXP'
  }[transactionType] || 'TXN';
  
  const timestamp = Date.now().toString().slice(-8);
  return `${prefix}-${typeCode}-${timestamp}`;
}

// GET /transactions - List all transactions with comprehensive filtering
router.get('/', requirePermission(['VIEW_FINANCIALS']), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    
    const {
      page = 1,
      limit = 100,
      transactionType,
      materialId,
      referenceType,
      dateFrom,
      dateTo,
      amountMin,
      amountMax,
      createdBy,
      search
    } = req.query;
    
    const offset = (page - 1) * limit;
    
    let query = db('transactions')
      .select(
        'transactions.*',
        'materials.name as materialName',
        'materials.code as materialCode',
        'users.firstName as createdByName',
        'users.lastName as createdByLastName'
      )
      .leftJoin('materials', 'transactions.materialId', 'materials.id')
      .leftJoin('users', 'transactions.createdBy', 'users.id')
      .orderBy('transactions.created_at', 'desc');
    
    // Apply filters
    if (transactionType) {
      query = query.where('transactions.transactionType', transactionType);
    }
    
    if (materialId) {
      query = query.where('transactions.materialId', materialId);
    }
    
    if (referenceType) {
      query = query.where('transactions.referenceType', referenceType);
    }
    
    if (dateFrom) {
      query = query.where('transactions.transactionDate', '>=', dateFrom);
    }
    
    if (dateTo) {
      query = query.where('transactions.transactionDate', '<=', dateTo);
    }
    
    if (amountMin) {
      query = query.where('transactions.amount', '>=', amountMin);
    }
    
    if (amountMax) {
      query = query.where('transactions.amount', '<=', amountMax);
    }
    
    if (createdBy) {
      query = query.where('transactions.createdBy', createdBy);
    }
    
    if (search) {
      query = query.where(function() {
        this.where('transactions.transactionNumber', 'like', `%${search}%`)
            .orWhere('transactions.description', 'like', `%${search}%`)
            .orWhere('materials.name', 'like', `%${search}%`);
      });
    }
    
    // Get total count for pagination
    const totalQuery = query.clone();
    const [{ count }] = await totalQuery.clearSelect().clearOrder().count('* as count');
    
    // Get paginated results
    const transactions = await query.limit(limit).offset(offset);
    
    winston.info('Transactions retrieved', {
      companyId: req.user.companyId,
      userId: req.user.id,
      count: transactions.length,
      totalCount: count
    });
    
    res.json({
      success: true,
      data: transactions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count,
        pages: Math.ceil(count / limit)
      }
    });
    
  } catch (error) {
    winston.error('Error fetching transactions', {
      error: error.message,
      companyId: req.user.companyId,
      userId: req.user.id
    });
    
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// GET /transactions/:id - Get specific transaction
router.get('/:id', requirePermission(['VIEW_FINANCIALS']), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const { id } = req.params;
    
    const transaction = await db('transactions')
      .select(
        'transactions.*',
        'materials.name as materialName',
        'materials.code as materialCode',
        'materials.unit as materialUnit',
        'users.firstName as createdByName',
        'users.lastName as createdByLastName'
      )
      .leftJoin('materials', 'transactions.materialId', 'materials.id')
      .leftJoin('users', 'transactions.createdBy', 'users.id')
      .where('transactions.id', id)
      .first();
    
    if (!transaction) {
      return res.status(404).json({
        success: false,
        error: 'Transaction not found'
      });
    }
    
    // Get reference record details if available
    let referenceDetails = null;
    if (transaction.referenceId && transaction.referenceType) {
      try {
        switch (transaction.referenceType) {
          case 'sales_order':
            referenceDetails = await db('sales_orders')
              .select('orderNumber', 'customerName', 'totalAmount')
              .where('id', transaction.referenceId)
              .first();
            break;
          case 'purchase_order':
            referenceDetails = await db('purchase_orders')
              .select('orderNumber', 'supplierName', 'totalAmount')
              .where('id', transaction.referenceId)
              .first();
            break;
          case 'wastage':
            referenceDetails = await db('wastages')
              .select('wastageNumber', 'wasteType', 'totalCost')
              .where('id', transaction.referenceId)
              .first();
            break;
          case 'petty_cash_expense':
            referenceDetails = await db('petty_cash_expenses')
              .select('expenseNumber', 'category', 'amount')
              .where('id', transaction.referenceId)
              .first();
            break;
        }
      } catch (refError) {
        winston.warn('Error fetching reference details', {
          error: refError.message,
          transactionId: id,
          referenceType: transaction.referenceType,
          referenceId: transaction.referenceId
        });
      }
    }
    
    transaction.referenceDetails = referenceDetails;
    
    winston.info('Transaction retrieved', {
      transactionId: id,
      companyId: req.user.companyId,
      userId: req.user.id
    });
    
    res.json({
      success: true,
      data: transaction
    });
    
  } catch (error) {
    winston.error('Error fetching transaction', {
      error: error.message,
      transactionId: req.params.id,
      companyId: req.user.companyId,
      userId: req.user.id
    });
    
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// POST /transactions - Create new transaction
router.post('/', 
  requirePermission(['financial:write']),
  validate(transactionSchema),
  async (req, res) => {
    try {
      const db = getDbConnection(req.user.companyId);
      const transactionData = req.body;
      
      // Generate transaction number
      const transactionNumber = generateTransactionNumber(req.user.companyId, transactionData.transactionType);
      
      // Verify material exists if provided
      if (transactionData.materialId) {
        const material = await db('materials').where('id', transactionData.materialId).first();
        if (!material) {
          return res.status(400).json({
            success: false,
            error: 'Material not found'
          });
        }
      }
      
      // Verify reference record exists if provided
      if (transactionData.referenceId && transactionData.referenceType) {
        const tableMap = {
          'sales_order': 'sales_orders',
          'purchase_order': 'purchase_orders',
          'wastage': 'wastages',
          'petty_cash_expense': 'petty_cash_expenses'
        };
        
        const tableName = tableMap[transactionData.referenceType];
        if (tableName) {
          const referenceRecord = await db(tableName).where('id', transactionData.referenceId).first();
          if (!referenceRecord) {
            return res.status(400).json({
              success: false,
              error: `${transactionData.referenceType} record not found`
            });
          }
        }
      }
      
      const newTransaction = {
        transactionNumber,
        transactionType: transactionData.transactionType,
        referenceId: transactionData.referenceId || null,
        referenceType: transactionData.referenceType || null,
        materialId: transactionData.materialId || null,
        quantity: transactionData.quantity || null,
        unitPrice: transactionData.unitPrice || null,
        amount: transactionData.amount,
        transactionDate: transactionData.transactionDate,
        description: transactionData.description || null,
        notes: transactionData.notes || null,
        createdBy: req.user.id
      };
      
      const [id] = await db('transactions').insert(newTransaction);
      
      winston.info('Transaction created', {
        transactionId: id,
        transactionNumber,
        type: transactionData.transactionType,
        amount: transactionData.amount,
        companyId: req.user.companyId,
        userId: req.user.id
      });
      
      res.status(201).json({
        success: true,
        data: { id, ...newTransaction },
        message: 'Transaction created successfully'
      });
      
    } catch (error) {
      winston.error('Error creating transaction', {
        error: error.message,
        companyId: req.user.companyId,
        userId: req.user.id
      });
      
      if (error.code === 'ER_DUP_ENTRY') {
        res.status(409).json({
          success: false,
          error: 'Transaction number already exists'
        });
      } else {
        res.status(500).json({
          success: false,
          error: 'Internal server error'
        });
      }
    }
  }
);

// POST /transactions/bulk - Create multiple transactions
router.post('/bulk', 
  requirePermission(['financial:write']),
  validate(bulkTransactionSchema),
  async (req, res) => {
    try {
      const db = getDbConnection(req.user.companyId);
      const { transactions } = req.body;
      
      // Process transactions in database transaction
      const results = await db.transaction(async (trx) => {
        const insertedTransactions = [];
        
        for (const transactionData of transactions) {
          // Generate transaction number
          const transactionNumber = generateTransactionNumber(req.user.companyId, transactionData.transactionType);
          
          const newTransaction = {
            transactionNumber,
            transactionType: transactionData.transactionType,
            referenceId: transactionData.referenceId || null,
            referenceType: transactionData.referenceType || null,
            materialId: transactionData.materialId || null,
            quantity: transactionData.quantity || null,
            unitPrice: transactionData.unitPrice || null,
            amount: transactionData.amount,
            transactionDate: transactionData.transactionDate,
            description: transactionData.description || null,
            notes: transactionData.notes || null,
            createdBy: req.user.id
          };
          
          const [id] = await trx('transactions').insert(newTransaction);
          insertedTransactions.push({ id, ...newTransaction });
        }
        
        return insertedTransactions;
      });
      
      winston.info('Bulk transactions created', {
        count: results.length,
        companyId: req.user.companyId,
        userId: req.user.id
      });
      
      res.status(201).json({
        success: true,
        data: results,
        message: `${results.length} transactions created successfully`
      });
      
    } catch (error) {
      winston.error('Error creating bulk transactions', {
        error: error.message,
        companyId: req.user.companyId,
        userId: req.user.id
      });
      
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }
);

// GET /transactions/analytics/summary - Get comprehensive financial analytics
router.get('/analytics/summary', requirePermission(['VIEW_FINANCIALS']), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const { dateFrom, dateTo, transactionType } = req.query;
    
    let query = db('transactions');
    
    // Apply date filters
    if (dateFrom) {
      query = query.where('transactionDate', '>=', dateFrom);
    }
    
    if (dateTo) {
      query = query.where('transactionDate', '<=', dateTo);
    }
    
    if (transactionType) {
      query = query.where('transactionType', transactionType);
    }
    
    // Get summary statistics
    const [totalStats] = await query.clone()
      .select(
        db.raw('COUNT(*) as totalTransactions'),
        db.raw('SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) as totalIncome'),
        db.raw('SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END) as totalExpenses'),
        db.raw('SUM(amount) as netAmount'),
        db.raw('AVG(amount) as averageAmount')
      );
    
    // Get transactions by type
    const transactionsByType = await query.clone()
      .select('transactionType', db.raw('COUNT(*) as count'), db.raw('SUM(amount) as totalAmount'))
      .groupBy('transactionType')
      .orderBy('totalAmount', 'desc');
    
    // Get monthly trend
    const monthlyTrend = await query.clone()
      .select(
        db.raw('DATE_FORMAT(transactionDate, "%Y-%m") as month'),
        db.raw('COUNT(*) as transactionCount'),
        db.raw('SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) as income'),
        db.raw('SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END) as expenses'),
        db.raw('SUM(amount) as netAmount')
      )
      .groupBy(db.raw('DATE_FORMAT(transactionDate, "%Y-%m")'))
      .orderBy('month', 'desc')
      .limit(12);
    
    // Get top materials by transaction value
    const topMaterials = await query.clone()
      .select(
        'materials.name as materialName',
        'materials.code as materialCode',
        db.raw('COUNT(transactions.id) as transactionCount'),
        db.raw('SUM(transactions.amount) as totalValue'),
        db.raw('AVG(transactions.unitPrice) as averagePrice')
      )
      .join('materials', 'transactions.materialId', 'materials.id')
      .whereNotNull('transactions.materialId')
      .groupBy('transactions.materialId', 'materials.name', 'materials.code')
      .orderBy('totalValue', 'desc')
      .limit(10);
    
    // Get daily transactions for last 30 days
    const dailyTransactions = await query.clone()
      .select(
        db.raw('DATE(transactionDate) as date'),
        db.raw('COUNT(*) as count'),
        db.raw('SUM(amount) as totalAmount')
      )
      .where('transactionDate', '>=', db.raw('DATE_SUB(CURDATE(), INTERVAL 30 DAY)'))
      .groupBy(db.raw('DATE(transactionDate)'))
      .orderBy('date', 'desc');
    
    winston.info('Transaction analytics retrieved', {
      companyId: req.user.companyId,
      userId: req.user.id
    });
    
    res.json({
      success: true,
      data: {
        summary: totalStats,
        byType: transactionsByType,
        monthlyTrend,
        topMaterials,
        dailyTrend: dailyTransactions
      }
    });
    
  } catch (error) {
    winston.error('Error fetching transaction analytics', {
      error: error.message,
      companyId: req.user.companyId,
      userId: req.user.id
    });
    
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// GET /transactions/balance-sheet - Get balance sheet data
router.get('/balance-sheet', requirePermission(['VIEW_FINANCIALS']), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const { dateFrom, dateTo } = req.query;
    
    let query = db('transactions');
    
    // Apply date filters
    if (dateFrom) {
      query = query.where('transactionDate', '>=', dateFrom);
    }
    
    if (dateTo) {
      query = query.where('transactionDate', '<=', dateTo);
    }
    
    // Get income (positive amounts)
    const income = await query.clone()
      .select(
        'transactionType',
        db.raw('SUM(amount) as totalAmount'),
        db.raw('COUNT(*) as count')
      )
      .where('amount', '>', 0)
      .groupBy('transactionType')
      .orderBy('totalAmount', 'desc');
    
    // Get expenses (negative amounts or expense types)
    const expenses = await query.clone()
      .select(
        'transactionType',
        db.raw('SUM(ABS(amount)) as totalAmount'),
        db.raw('COUNT(*) as count')
      )
      .where(function() {
        this.where('amount', '<', 0)
            .orWhereIn('transactionType', ['wastage', 'expense', 'petty_cash']);
      })
      .groupBy('transactionType')
      .orderBy('totalAmount', 'desc');
    
    // Calculate totals
    const totalIncome = income.reduce((sum, item) => sum + parseFloat(item.totalAmount), 0);
    const totalExpenses = expenses.reduce((sum, item) => sum + parseFloat(item.totalAmount), 0);
    const netProfit = totalIncome - totalExpenses;
    
    winston.info('Balance sheet retrieved', {
      companyId: req.user.companyId,
      userId: req.user.id,
      totalIncome,
      totalExpenses,
      netProfit
    });
    
    res.json({
      success: true,
      data: {
        income: {
          items: income,
          total: totalIncome
        },
        expenses: {
          items: expenses,
          total: totalExpenses
        },
        summary: {
          totalIncome,
          totalExpenses,
          netProfit,
          profitMargin: totalIncome > 0 ? ((netProfit / totalIncome) * 100).toFixed(2) : 0
        }
      }
    });
    
  } catch (error) {
    winston.error('Error fetching balance sheet', {
      error: error.message,
      companyId: req.user.companyId,
      userId: req.user.id
    });
    
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Helper function to record transaction (can be used by other modules)
async function recordTransaction(db, transactionData, createdBy) {
  const transactionNumber = generateTransactionNumber(db.client.connectionSettings.database, transactionData.transactionType);
  
  const newTransaction = {
    transactionNumber,
    ...transactionData,
    createdBy
  };
  
  const [id] = await db('transactions').insert(newTransaction);
  return { id, ...newTransaction };
}

module.exports = router;
module.exports.recordTransaction = recordTransaction;