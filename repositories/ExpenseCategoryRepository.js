/**
 * Expense Category Repository
 *
 * Provides data access for expense categories with company isolation.
 * Categories are used across petty cash, purchase, sales, and operational expenses.
 *
 * Requirements: 5.1, 5.3 (Expense Categories)
 */

const BaseRepository = require('./BaseRepository');
const winston = require('winston');

class ExpenseCategoryRepository extends BaseRepository {
  constructor(companyId) {
    super('expense_categories', companyId);
  }

  /**
   * Get all active categories for a specific type
   * Used for dropdown lists in expense forms
   *
   * @param {string} type - Category type: 'purchase', 'sales', 'operational', 'petty_cash'
   * @param {object} options - Additional options
   * @param {boolean} options.includeInactive - Include inactive categories (default: false)
   * @returns {Promise<Array>} Sorted categories
   */
  async findByType(type, options = {}) {
    try {
      const query = this.db(this.tableName)
        .where('company_id', this.companyId)
        .where('type', type)
        .orderBy('sort_order', 'asc')
        .orderBy('name', 'asc');

      if (!options.includeInactive) {
        query.where('is_active', true);
      }

      const categories = await query;

      winston.debug('Expense categories fetched by type', {
        type,
        count: categories.length,
        companyId: this.companyId,
      });

      return categories;
    } catch (error) {
      winston.error('Error fetching expense categories by type', {
        type,
        companyId: this.companyId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get all active categories for the company
   * Used for category management screens
   *
   * @param {object} options - Query options
   * @param {boolean} options.includeInactive - Include inactive categories
   * @returns {Promise<Array>} All categories sorted by type then sort_order
   */
  async findActive(options = {}) {
    try {
      const query = this.db(this.tableName)
        .where('company_id', this.companyId)
        .orderBy('type', 'asc')
        .orderBy('sort_order', 'asc')
        .orderBy('name', 'asc');

      if (!options.includeInactive) {
        query.where('is_active', true);
      }

      const categories = await query;

      winston.debug('Active expense categories fetched', {
        count: categories.length,
        companyId: this.companyId,
      });

      return categories;
    } catch (error) {
      winston.error('Error fetching active expense categories', {
        companyId: this.companyId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Find category by unique code within company
   *
   * @param {string} code - Category code (e.g., 'FUEL', 'TRANSPORT')
   * @returns {Promise<object|null>} Category or null
   */
  async findByCode(code) {
    try {
      const category = await this.db(this.tableName)
        .where('company_id', this.companyId)
        .where('code', code.toUpperCase())
        .first();

      return category || null;
    } catch (error) {
      winston.error('Error fetching expense category by code', {
        code,
        companyId: this.companyId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get categories formatted for dropdown selection
   * Returns minimal data optimized for UI dropdowns
   *
   * @param {string} type - Category type filter
   * @param {string} locale - Locale for name field ('en' or 'ar')
   * @returns {Promise<Array>} Dropdown-optimized category list
   */
  async findForDropdown(type, locale = 'en') {
    try {
      const categories = await this.db(this.tableName)
        .where('company_id', this.companyId)
        .where('type', type)
        .where('is_active', true)
        .select('id', 'code', 'name', 'name_ar', 'max_amount')
        .orderBy('sort_order', 'asc')
        .orderBy('name', 'asc');

      // Return with localized name
      return categories.map((cat) => ({
        id: cat.id,
        code: cat.code,
        name: locale === 'ar' && cat.name_ar ? cat.name_ar : cat.name,
        maxAmount: cat.max_amount,
      }));
    } catch (error) {
      winston.error('Error fetching expense categories for dropdown', {
        type,
        locale,
        companyId: this.companyId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Validate if an amount exceeds the category's max_amount limit
   *
   * @param {number} categoryId - Category ID to check
   * @param {number} amount - Amount to validate
   * @returns {Promise<{valid: boolean, maxAmount: number|null, exceeded: boolean}>}
   */
  async validateMaxAmount(categoryId, amount) {
    try {
      const category = await this.findById(categoryId);

      if (!category) {
        return { valid: false, error: 'Category not found' };
      }

      // No max limit set - always valid
      if (!category.max_amount) {
        return { valid: true, maxAmount: null, exceeded: false };
      }

      const exceeded = parseFloat(amount) > parseFloat(category.max_amount);

      return {
        valid: !exceeded,
        maxAmount: parseFloat(category.max_amount),
        exceeded,
        categoryName: category.name,
      };
    } catch (error) {
      winston.error('Error validating category max amount', {
        categoryId,
        amount,
        companyId: this.companyId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Create a new expense category
   * Overrides base to add company_id and uppercase code
   *
   * @param {object} data - Category data
   * @param {number} userId - Creating user ID
   * @returns {Promise<object>} Created category
   */
  async create(data, userId = null) {
    try {
      // Ensure company_id is set
      const categoryData = {
        ...data,
        company_id: this.companyId,
        code: data.code.toUpperCase(),
      };

      // Check for duplicate code
      const existing = await this.findByCode(categoryData.code);
      if (existing) {
        throw new Error(`Category code '${categoryData.code}' already exists`);
      }

      return await super.create(categoryData, userId);
    } catch (error) {
      winston.error('Error creating expense category', {
        data,
        companyId: this.companyId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Update expense category
   * Prevents changing company_id and ensures code uniqueness
   *
   * @param {number} id - Category ID
   * @param {object} data - Update data
   * @param {number} userId - Updating user ID
   * @returns {Promise<number>} Rows affected
   */
  async update(id, data, userId = null) {
    try {
      // Remove company_id if present (prevent tenant switching)
      const { company_id, ...updateData } = data;

      // If code is being changed, ensure uniqueness
      if (updateData.code) {
        updateData.code = updateData.code.toUpperCase();
        const existing = await this.findByCode(updateData.code);
        if (existing && existing.id !== id) {
          throw new Error(`Category code '${updateData.code}' already exists`);
        }
      }

      return await super.update(id, updateData, userId);
    } catch (error) {
      winston.error('Error updating expense category', {
        id,
        data,
        companyId: this.companyId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Soft delete - deactivate category instead of removing
   * Categories may be referenced by historical expenses
   *
   * @param {number} id - Category ID
   * @param {number} userId - User performing deletion
   * @returns {Promise<number>} Rows affected
   */
  async softDelete(id, userId = null) {
    try {
      const rowsAffected = await this.db(this.tableName)
        .where('id', id)
        .where('company_id', this.companyId)
        .update({
          is_active: false,
          updated_at: new Date(),
        });

      if (rowsAffected === 0) {
        throw new Error('Category not found or already inactive');
      }

      winston.info('Expense category soft deleted', {
        categoryId: id,
        companyId: this.companyId,
        deactivatedBy: userId,
      });

      return rowsAffected;
    } catch (error) {
      winston.error('Error soft deleting expense category', {
        id,
        companyId: this.companyId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Reactivate a previously deactivated category
   *
   * @param {number} id - Category ID
   * @param {number} userId - User performing reactivation
   * @returns {Promise<number>} Rows affected
   */
  async reactivate(id, userId = null) {
    try {
      const rowsAffected = await this.db(this.tableName)
        .where('id', id)
        .where('company_id', this.companyId)
        .update({
          is_active: true,
          updated_at: new Date(),
        });

      if (rowsAffected === 0) {
        throw new Error('Category not found');
      }

      winston.info('Expense category reactivated', {
        categoryId: id,
        companyId: this.companyId,
        reactivatedBy: userId,
      });

      return rowsAffected;
    } catch (error) {
      winston.error('Error reactivating expense category', {
        id,
        companyId: this.companyId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get category statistics for analytics
   *
   * @returns {Promise<object>} Category statistics
   */
  async getStatistics() {
    try {
      const stats = await this.db(this.tableName)
        .where('company_id', this.companyId)
        .select('type')
        .count('* as total')
        .sum(this.db.raw('CASE WHEN is_active = 1 THEN 1 ELSE 0 END as active'))
        .groupBy('type');

      // Transform to object
      const result = {
        byType: {},
        total: 0,
        totalActive: 0,
      };

      stats.forEach((row) => {
        result.byType[row.type] = {
          total: parseInt(row.total),
          active: parseInt(row.active),
        };
        result.total += parseInt(row.total);
        result.totalActive += parseInt(row.active);
      });

      return result;
    } catch (error) {
      winston.error('Error fetching expense category statistics', {
        companyId: this.companyId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Override findAll to filter by company
   */
  async findAll(filters = {}, pagination = {}, includes = []) {
    // Ensure company isolation
    const companyFilters = {
      ...filters,
      company_id: this.companyId,
    };

    return await super.findAll(companyFilters, pagination, includes);
  }

  /**
   * Override findById to verify company ownership
   */
  async findById(id, includes = []) {
    const category = await super.findById(id, includes);

    // Verify company ownership
    if (category && category.company_id !== this.companyId) {
      winston.warn('Attempted to access expense category from different company', {
        categoryId: id,
        requestedCompany: this.companyId,
        actualCompany: category.company_id,
      });
      return null;
    }

    return category;
  }
}

module.exports = ExpenseCategoryRepository;
