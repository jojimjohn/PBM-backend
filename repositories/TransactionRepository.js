const BaseRepository = require('./BaseRepository');

/**
 * Transaction Repository
 * Handles transaction-specific database operations for financial tracking
 */
class TransactionRepository extends BaseRepository {
  constructor(companyId) {
    super('transactions', companyId);
  }

  /**
   * Find transactions with material and user details
   * @param {Object} filters - Filter criteria
   * @param {Object} pagination - Pagination options
   */
  async findAllWithDetails(filters = {}, pagination = {}) {
    try {
      const { page = 1, limit = 100 } = pagination;
      const offset = (page - 1) * limit;

      let query = this.db(this.tableName)
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
      if (filters.transactionType) {
        query = query.where('transactions.transactionType', filters.transactionType);
      }
      if (filters.materialId) {
        query = query.where('transactions.materialId', filters.materialId);
      }
      if (filters.referenceType) {
        query = query.where('transactions.referenceType', filters.referenceType);
      }
      if (filters.dateFrom) {
        query = query.where('transactions.transactionDate', '>=', filters.dateFrom);
      }
      if (filters.dateTo) {
        query = query.where('transactions.transactionDate', '<=', filters.dateTo);
      }
      if (filters.amountMin) {
        query = query.where('transactions.amount', '>=', filters.amountMin);
      }
      if (filters.amountMax) {
        query = query.where('transactions.amount', '<=', filters.amountMax);
      }

      // Get total count
      const totalQuery = query.clone();
      const [{ count }] = await totalQuery.clearSelect().clearOrder().count('transactions.id as count');

      // Get paginated results
      const transactions = await query.limit(limit).offset(offset);

      return {
        data: transactions,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: count,
          pages: Math.ceil(count / limit)
        }
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get comprehensive financial analytics
   * @param {Object} filters - Filter criteria
   */
  async getFinancialAnalytics(filters = {}) {
    try {
      let query = this.db(this.tableName);

      // Apply filters
      if (filters.dateFrom) {
        query = query.where('transactionDate', '>=', filters.dateFrom);
      }
      if (filters.dateTo) {
        query = query.where('transactionDate', '<=', filters.dateTo);
      }
      if (filters.transactionType) {
        query = query.where('transactionType', filters.transactionType);
      }

      // Get summary statistics
      const [totalStats] = await query.clone()
        .select(
          this.db.raw('COUNT(*) as totalTransactions'),
          this.db.raw('SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) as totalIncome'),
          this.db.raw('SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END) as totalExpenses'),
          this.db.raw('SUM(amount) as netAmount'),
          this.db.raw('AVG(amount) as averageAmount')
        );

      // Get transactions by type
      const transactionsByType = await query.clone()
        .select('transactionType', this.db.raw('COUNT(*) as count'), this.db.raw('SUM(amount) as totalAmount'))
        .groupBy('transactionType')
        .orderBy('totalAmount', 'desc');

      // Get monthly trend
      const monthlyTrend = await query.clone()
        .select(
          this.db.raw('DATE_FORMAT(transactionDate, "%Y-%m") as month'),
          this.db.raw('COUNT(*) as transactionCount'),
          this.db.raw('SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) as income'),
          this.db.raw('SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END) as expenses'),
          this.db.raw('SUM(amount) as netAmount')
        )
        .groupBy(this.db.raw('DATE_FORMAT(transactionDate, "%Y-%m")'))
        .orderBy('month', 'desc')
        .limit(12);

      return {
        summary: totalStats,
        byType: transactionsByType,
        monthlyTrend
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get balance sheet data
   * @param {Object} filters - Date filters
   */
  async getBalanceSheet(filters = {}) {
    try {
      let query = this.db(this.tableName);

      if (filters.dateFrom) {
        query = query.where('transactionDate', '>=', filters.dateFrom);
      }
      if (filters.dateTo) {
        query = query.where('transactionDate', '<=', filters.dateTo);
      }

      // Get income (positive amounts)
      const income = await query.clone()
        .select(
          'transactionType',
          this.db.raw('SUM(amount) as totalAmount'),
          this.db.raw('COUNT(*) as count')
        )
        .where('amount', '>', 0)
        .groupBy('transactionType')
        .orderBy('totalAmount', 'desc');

      // Get expenses (negative amounts or expense types)
      const expenses = await query.clone()
        .select(
          'transactionType',
          this.db.raw('SUM(ABS(amount)) as totalAmount'),
          this.db.raw('COUNT(*) as count')
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

      return {
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
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Record a new transaction
   * @param {Object} transactionData - Transaction data
   * @param {number} userId - User ID
   */
  async recordTransaction(transactionData, userId) {
    const transactionNumber = this.generateTransactionNumber(transactionData.transactionType);
    
    const newTransaction = {
      transactionNumber,
      ...transactionData,
      createdBy: userId
    };

    return await this.create(newTransaction, userId);
  }

  /**
   * Find transactions by reference
   * @param {number} referenceId - Reference record ID
   * @param {string} referenceType - Reference type
   */
  async findByReference(referenceId, referenceType) {
    return await this.findBy(
      { referenceId, referenceType }, 
      { orderBy: 'created_at', orderDirection: 'desc' }
    );
  }

  /**
   * Get transaction totals by type for date range
   * @param {string} dateFrom - Start date
   * @param {string} dateTo - End date
   */
  async getTotalsByType(dateFrom, dateTo) {
    try {
      return await this.db(this.tableName)
        .select(
          'transactionType',
          this.db.raw('SUM(amount) as totalAmount'),
          this.db.raw('COUNT(*) as count')
        )
        .where('transactionDate', '>=', dateFrom)
        .where('transactionDate', '<=', dateTo)
        .groupBy('transactionType')
        .orderBy('totalAmount', 'desc');
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get top materials by transaction value
   * @param {string} dateFrom - Start date
   * @param {string} dateTo - End date
   * @param {number} limit - Number of records to return
   */
  async getTopMaterialsByValue(dateFrom, dateTo, limit = 10) {
    try {
      return await this.db(this.tableName)
        .select(
          'materials.name as materialName',
          'materials.code as materialCode',
          this.db.raw('COUNT(transactions.id) as transactionCount'),
          this.db.raw('SUM(transactions.amount) as totalValue'),
          this.db.raw('AVG(transactions.unitPrice) as averagePrice')
        )
        .join('materials', 'transactions.materialId', 'materials.id')
        .where('transactions.transactionDate', '>=', dateFrom)
        .where('transactions.transactionDate', '<=', dateTo)
        .whereNotNull('transactions.materialId')
        .groupBy('transactions.materialId', 'materials.name', 'materials.code')
        .orderBy('totalValue', 'desc')
        .limit(limit);
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get daily transaction summary for last N days
   * @param {number} days - Number of days
   */
  async getDailyTrend(days = 30) {
    try {
      return await this.db(this.tableName)
        .select(
          this.db.raw('DATE(transactionDate) as date'),
          this.db.raw('COUNT(*) as count'),
          this.db.raw('SUM(amount) as totalAmount')
        )
        .where('transactionDate', '>=', this.db.raw(`DATE_SUB(CURDATE(), INTERVAL ${days} DAY)`))
        .groupBy(this.db.raw('DATE(transactionDate)'))
        .orderBy('date', 'desc');
    } catch (error) {
      throw error;
    }
  }

  /**
   * Generate transaction number
   * @param {string} transactionType - Transaction type
   */
  generateTransactionNumber(transactionType) {
    const prefix = this.companyId === 'al-ramrami' ? 'ALR' : 'PM';
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
}

module.exports = TransactionRepository;