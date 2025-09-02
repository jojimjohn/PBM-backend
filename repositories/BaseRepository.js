const winston = require('winston');
const { getDbConnection } = require('../config/database');

/**
 * Base Repository Class
 * Provides common CRUD operations and database abstraction
 */
class BaseRepository {
  constructor(tableName, companyId) {
    this.tableName = tableName;
    this.companyId = companyId;
    this.db = getDbConnection(companyId);
  }

  /**
   * Get all records with pagination and filtering
   * @param {Object} filters - Filter criteria
   * @param {Object} pagination - Pagination options
   * @param {Array} includes - Relations to include
   */
  async findAll(filters = {}, pagination = {}, includes = []) {
    try {
      const { page = 1, limit = 50, orderBy = 'created_at', orderDirection = 'desc' } = pagination;
      const offset = (page - 1) * limit;

      let query = this.db(this.tableName);

      // Apply includes (joins)
      includes.forEach(include => {
        if (typeof include === 'string') {
          query = query.leftJoin(include, `${this.tableName}.${include}Id`, `${include}.id`);
        } else if (typeof include === 'object') {
          query = query.leftJoin(include.table, include.on[0], include.on[1]);
        }
      });

      // Apply filters
      Object.keys(filters).forEach(key => {
        if (filters[key] !== undefined && filters[key] !== null) {
          if (Array.isArray(filters[key])) {
            query = query.whereIn(`${this.tableName}.${key}`, filters[key]);
          } else if (typeof filters[key] === 'object' && filters[key].operator) {
            query = query.where(`${this.tableName}.${key}`, filters[key].operator, filters[key].value);
          } else {
            query = query.where(`${this.tableName}.${key}`, filters[key]);
          }
        }
      });

      // Get total count for pagination
      const countQuery = query.clone();
      const [{ count }] = await countQuery.clearSelect().clearOrder().count(`${this.tableName}.id as count`);

      // Apply pagination and ordering
      const results = await query
        .select(`${this.tableName}.*`)
        .orderBy(`${this.tableName}.${orderBy}`, orderDirection)
        .limit(limit)
        .offset(offset);

      return {
        data: results,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: count,
          pages: Math.ceil(count / limit)
        }
      };
    } catch (error) {
      winston.error(`Error in ${this.tableName} findAll`, {
        error: error.message,
        companyId: this.companyId
      });
      throw error;
    }
  }

  /**
   * Find record by ID
   * @param {number} id - Record ID
   * @param {Array} includes - Relations to include
   */
  async findById(id, includes = []) {
    try {
      let query = this.db(this.tableName);

      // Apply includes
      includes.forEach(include => {
        if (typeof include === 'string') {
          query = query.leftJoin(include, `${this.tableName}.${include}Id`, `${include}.id`);
        } else if (typeof include === 'object') {
          query = query.leftJoin(include.table, include.on[0], include.on[1]);
        }
      });

      const result = await query
        .select(`${this.tableName}.*`)
        .where(`${this.tableName}.id`, id)
        .first();

      return result;
    } catch (error) {
      winston.error(`Error in ${this.tableName} findById`, {
        error: error.message,
        id,
        companyId: this.companyId
      });
      throw error;
    }
  }

  /**
   * Create new record
   * @param {Object} data - Record data
   * @param {number} userId - User ID for audit
   */
  async create(data, userId = null) {
    try {
      const createData = {
        ...data,
        created_at: new Date(),
        updated_at: new Date()
      };

      if (userId && this.hasAuditFields()) {
        createData.createdBy = userId;
      }

      const [id] = await this.db(this.tableName).insert(createData);

      winston.info(`${this.tableName} record created`, {
        id,
        companyId: this.companyId,
        createdBy: userId
      });

      return { id, ...createData };
    } catch (error) {
      winston.error(`Error creating ${this.tableName} record`, {
        error: error.message,
        companyId: this.companyId,
        createdBy: userId
      });
      throw error;
    }
  }

  /**
   * Update record by ID
   * @param {number} id - Record ID
   * @param {Object} data - Update data
   * @param {number} userId - User ID for audit
   */
  async update(id, data, userId = null) {
    try {
      const updateData = {
        ...data,
        updated_at: new Date()
      };

      if (userId && this.hasAuditFields()) {
        updateData.updatedBy = userId;
      }

      const rowsAffected = await this.db(this.tableName)
        .where('id', id)
        .update(updateData);

      if (rowsAffected === 0) {
        throw new Error(`${this.tableName} record not found`);
      }

      winston.info(`${this.tableName} record updated`, {
        id,
        companyId: this.companyId,
        updatedBy: userId
      });

      return rowsAffected;
    } catch (error) {
      winston.error(`Error updating ${this.tableName} record`, {
        error: error.message,
        id,
        companyId: this.companyId,
        updatedBy: userId
      });
      throw error;
    }
  }

  /**
   * Delete record by ID (soft delete if supported)
   * @param {number} id - Record ID
   * @param {number} userId - User ID for audit
   * @param {boolean} soft - Perform soft delete
   */
  async delete(id, userId = null, soft = false) {
    try {
      let rowsAffected;

      if (soft && this.hasSoftDelete()) {
        rowsAffected = await this.db(this.tableName)
          .where('id', id)
          .update({
            deleted_at: new Date(),
            deletedBy: userId
          });
      } else {
        rowsAffected = await this.db(this.tableName)
          .where('id', id)
          .del();
      }

      if (rowsAffected === 0) {
        throw new Error(`${this.tableName} record not found`);
      }

      winston.info(`${this.tableName} record deleted`, {
        id,
        soft,
        companyId: this.companyId,
        deletedBy: userId
      });

      return rowsAffected;
    } catch (error) {
      winston.error(`Error deleting ${this.tableName} record`, {
        error: error.message,
        id,
        companyId: this.companyId,
        deletedBy: userId
      });
      throw error;
    }
  }

  /**
   * Find records by criteria
   * @param {Object} criteria - Search criteria
   * @param {Object} options - Query options
   */
  async findBy(criteria, options = {}) {
    try {
      let query = this.db(this.tableName);

      // Apply criteria
      Object.keys(criteria).forEach(key => {
        query = query.where(key, criteria[key]);
      });

      // Apply options
      if (options.orderBy) {
        query = query.orderBy(options.orderBy, options.orderDirection || 'asc');
      }

      if (options.limit) {
        query = query.limit(options.limit);
      }

      if (options.offset) {
        query = query.offset(options.offset);
      }

      const results = options.first ? await query.first() : await query;
      return results;
    } catch (error) {
      winston.error(`Error in ${this.tableName} findBy`, {
        error: error.message,
        criteria,
        companyId: this.companyId
      });
      throw error;
    }
  }

  /**
   * Count records with criteria
   * @param {Object} criteria - Filter criteria
   */
  async count(criteria = {}) {
    try {
      let query = this.db(this.tableName);

      // Apply criteria
      Object.keys(criteria).forEach(key => {
        if (criteria[key] !== undefined && criteria[key] !== null) {
          query = query.where(key, criteria[key]);
        }
      });

      const [{ count }] = await query.count('* as count');
      return count;
    } catch (error) {
      winston.error(`Error in ${this.tableName} count`, {
        error: error.message,
        criteria,
        companyId: this.companyId
      });
      throw error;
    }
  }

  /**
   * Check if record exists
   * @param {Object} criteria - Search criteria
   */
  async exists(criteria) {
    try {
      const record = await this.findBy(criteria, { first: true });
      return !!record;
    } catch (error) {
      winston.error(`Error in ${this.tableName} exists`, {
        error: error.message,
        criteria,
        companyId: this.companyId
      });
      throw error;
    }
  }

  /**
   * Execute raw query
   * @param {string} sql - SQL query
   * @param {Array} bindings - Query bindings
   */
  async raw(sql, bindings = []) {
    try {
      return await this.db.raw(sql, bindings);
    } catch (error) {
      winston.error(`Error executing raw query in ${this.tableName}`, {
        error: error.message,
        sql,
        companyId: this.companyId
      });
      throw error;
    }
  }

  /**
   * Begin database transaction
   */
  async transaction(callback) {
    return await this.db.transaction(callback);
  }

  /**
   * Bulk insert records
   * @param {Array} records - Array of records to insert
   * @param {number} userId - User ID for audit
   */
  async bulkInsert(records, userId = null) {
    try {
      const insertData = records.map(record => ({
        ...record,
        created_at: new Date(),
        updated_at: new Date(),
        ...(userId && this.hasAuditFields() && { createdBy: userId })
      }));

      await this.db(this.tableName).insert(insertData);

      winston.info(`${this.tableName} bulk insert completed`, {
        count: records.length,
        companyId: this.companyId,
        createdBy: userId
      });

      return records.length;
    } catch (error) {
      winston.error(`Error in ${this.tableName} bulk insert`, {
        error: error.message,
        count: records.length,
        companyId: this.companyId
      });
      throw error;
    }
  }

  /**
   * Check if table has audit fields (createdBy, updatedBy)
   */
  hasAuditFields() {
    const auditTables = [
      'customers', 'suppliers', 'materials', 'inventory',
      'contracts', 'sales_orders', 'purchase_orders',
      'wastages', 'petty_cash_cards', 'petty_cash_expenses',
      'transactions'
    ];
    return auditTables.includes(this.tableName);
  }

  /**
   * Check if table supports soft delete
   */
  hasSoftDelete() {
    const softDeleteTables = [
      'customers', 'suppliers', 'materials', 'contracts'
    ];
    return softDeleteTables.includes(this.tableName);
  }

  /**
   * Get database connection
   */
  getDb() {
    return this.db;
  }

  /**
   * Get table name
   */
  getTableName() {
    return this.tableName;
  }
}

module.exports = BaseRepository;