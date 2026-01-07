/**
 * Expense Categories API Routes
 *
 * Provides CRUD operations for company-specific expense categories.
 * Categories are used across petty cash, purchase, sales, and operational expenses.
 *
 * Requirements: 5.1 (Expense Categories Master Table), 5.3 (Category CRUD)
 */

const express = require('express');
const router = express.Router();
const { requirePermission } = require('../middleware/auth');
const { validate } = require('../middleware/validation');
const { getRepositoryFactory } = require('../repositories/RepositoryFactory');
const Joi = require('joi');
const winston = require('winston');

// =============================================================================
// Validation Schemas
// =============================================================================

const categorySchema = Joi.object({
  code: Joi.string()
    .max(50)
    .required()
    .pattern(/^[A-Z0-9_]+$/)
    .messages({
      'string.pattern.base': 'Category code must contain only uppercase letters, numbers, and underscores',
    }),
  name: Joi.string().max(100).required(),
  name_ar: Joi.string().max(100).allow(null, '').optional(),
  type: Joi.string().valid('purchase', 'sales', 'operational', 'petty_cash').required(),
  description: Joi.string().max(500).allow(null, '').optional(),
  max_amount: Joi.number().precision(2).positive().allow(null).optional(),
  sort_order: Joi.number().integer().min(0).default(0),
  is_active: Joi.boolean().default(true),
});

const updateCategorySchema = categorySchema.fork(['code', 'type'], (schema) => schema.optional());

const toggleActiveSchema = Joi.object({
  is_active: Joi.boolean().required(),
});

// =============================================================================
// Routes
// =============================================================================

/**
 * GET /expense-categories
 * List all categories with optional filtering
 * Requires VIEW_EXPENSES or MANAGE_SETTINGS permission
 */
router.get('/', async (req, res) => {
  // Check for either permission
  const hasViewExpenses = req.user.permissions?.includes('VIEW_EXPENSES');
  const hasManageSettings = req.user.permissions?.includes('MANAGE_SETTINGS');
  const hasManageCategories = req.user.permissions?.includes('MANAGE_EXPENSE_CATEGORIES');

  if (!hasViewExpenses && !hasManageSettings && !hasManageCategories) {
    return res.status(403).json({
      success: false,
      error: 'Permission required: VIEW_EXPENSES, MANAGE_SETTINGS, or MANAGE_EXPENSE_CATEGORIES'
    });
  }
  try {
    const repositoryFactory = getRepositoryFactory(req.user.companyId);
    const categoryRepository = repositoryFactory.getExpenseCategoriesRepository();

    const filters = {};

    // Apply type filter if provided
    if (req.query.type) {
      filters.type = req.query.type;
    }

    // Apply active filter
    if (req.query.is_active !== undefined) {
      filters.is_active = req.query.is_active === 'true';
    }

    const pagination = {
      page: parseInt(req.query.page) || 1,
      limit: parseInt(req.query.limit) || 100,
      orderBy: req.query.orderBy || 'sort_order',
      orderDirection: req.query.orderDirection || 'asc',
    };

    const result = await categoryRepository.findAll(filters, pagination);

    winston.debug('Expense categories retrieved', {
      companyId: req.user.companyId,
      count: result.data.length,
    });

    res.json({
      success: true,
      data: result.data,
      pagination: result.pagination,
    });
  } catch (error) {
    winston.error('Error fetching expense categories', {
      error: error.message,
      companyId: req.user.companyId,
    });

    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * GET /expense-categories/types
 * Get all available category types
 */
router.get('/types', requirePermission('VIEW_EXPENSES'), async (req, res) => {
  try {
    const types = [
      {
        value: 'purchase',
        label: 'Purchase Expenses',
        label_ar: 'مصاريف المشتريات',
        description: 'Expenses related to purchase orders',
      },
      {
        value: 'sales',
        label: 'Sales Expenses',
        label_ar: 'مصاريف المبيعات',
        description: 'Expenses related to sales orders',
      },
      {
        value: 'operational',
        label: 'Operational Expenses',
        label_ar: 'المصاريف التشغيلية',
        description: 'General operational/overhead expenses',
      },
      {
        value: 'petty_cash',
        label: 'Petty Cash Expenses',
        label_ar: 'مصاريف الصندوق',
        description: 'Day-to-day minor expenses from petty cash',
      },
    ];

    res.json({
      success: true,
      data: types,
    });
  } catch (error) {
    winston.error('Error fetching category types', {
      error: error.message,
    });

    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * GET /expense-categories/dropdown/:type
 * Get categories formatted for dropdown selection
 * Returns minimal data with localized names
 * More permissive - allows any authenticated user to access dropdowns
 */
router.get('/dropdown/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const locale = req.query.locale || 'en';

    // Validate type
    const validTypes = ['purchase', 'sales', 'operational', 'petty_cash'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        error: `Invalid category type. Must be one of: ${validTypes.join(', ')}`,
      });
    }

    const repositoryFactory = getRepositoryFactory(req.user.companyId);
    const categoryRepository = repositoryFactory.getExpenseCategoriesRepository();

    const categories = await categoryRepository.findForDropdown(type, locale);

    res.json({
      success: true,
      data: categories,
    });
  } catch (error) {
    winston.error('Error fetching dropdown categories', {
      error: error.message,
      type: req.params.type,
      companyId: req.user.companyId,
    });

    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * GET /expense-categories/by-type/:type
 * Get all categories for a specific type
 */
router.get('/by-type/:type', requirePermission('VIEW_EXPENSES'), async (req, res) => {
  try {
    const { type } = req.params;
    const includeInactive = req.query.includeInactive === 'true';

    // Validate type
    const validTypes = ['purchase', 'sales', 'operational', 'petty_cash'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        error: `Invalid category type. Must be one of: ${validTypes.join(', ')}`,
      });
    }

    const repositoryFactory = getRepositoryFactory(req.user.companyId);
    const categoryRepository = repositoryFactory.getExpenseCategoriesRepository();

    const categories = await categoryRepository.findByType(type, { includeInactive });

    res.json({
      success: true,
      data: categories,
    });
  } catch (error) {
    winston.error('Error fetching categories by type', {
      error: error.message,
      type: req.params.type,
      companyId: req.user.companyId,
    });

    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * GET /expense-categories/statistics
 * Get category statistics for analytics
 */
router.get('/statistics', requirePermission('VIEW_EXPENSES'), async (req, res) => {
  try {
    const repositoryFactory = getRepositoryFactory(req.user.companyId);
    const categoryRepository = repositoryFactory.getExpenseCategoriesRepository();

    const stats = await categoryRepository.getStatistics();

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    winston.error('Error fetching category statistics', {
      error: error.message,
      companyId: req.user.companyId,
    });

    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * GET /expense-categories/:id
 * Get specific category by ID
 */
router.get('/:id', requirePermission('VIEW_EXPENSES'), async (req, res) => {
  try {
    const repositoryFactory = getRepositoryFactory(req.user.companyId);
    const categoryRepository = repositoryFactory.getExpenseCategoriesRepository();

    const category = await categoryRepository.findById(parseInt(req.params.id));

    if (!category) {
      return res.status(404).json({
        success: false,
        error: 'Category not found',
      });
    }

    res.json({
      success: true,
      data: category,
    });
  } catch (error) {
    winston.error('Error fetching expense category', {
      error: error.message,
      categoryId: req.params.id,
      companyId: req.user.companyId,
    });

    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * POST /expense-categories
 * Create new expense category
 */
router.post('/', requirePermission('MANAGE_EXPENSE_CATEGORIES'), validate(categorySchema), async (req, res) => {
  try {
    const repositoryFactory = getRepositoryFactory(req.user.companyId);
    const categoryRepository = repositoryFactory.getExpenseCategoriesRepository();

    const category = await categoryRepository.create(req.body, req.user.userId);

    winston.info('Expense category created', {
      categoryId: category.id,
      code: category.code,
      type: category.type,
      companyId: req.user.companyId,
      userId: req.user.userId,
    });

    res.status(201).json({
      success: true,
      data: category,
      message: 'Expense category created successfully',
    });
  } catch (error) {
    winston.error('Error creating expense category', {
      error: error.message,
      companyId: req.user.companyId,
      userId: req.user.userId,
    });

    // Handle duplicate code error
    if (error.message.includes('already exists')) {
      return res.status(400).json({
        success: false,
        error: error.message,
      });
    }

    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * PUT /expense-categories/:id
 * Update expense category
 */
router.put('/:id', requirePermission('MANAGE_EXPENSE_CATEGORIES'), validate(updateCategorySchema), async (req, res) => {
  try {
    const repositoryFactory = getRepositoryFactory(req.user.companyId);
    const categoryRepository = repositoryFactory.getExpenseCategoriesRepository();
    const categoryId = parseInt(req.params.id);

    // Verify category exists
    const existing = await categoryRepository.findById(categoryId);
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Category not found',
      });
    }

    await categoryRepository.update(categoryId, req.body, req.user.userId);

    // Get updated category
    const updated = await categoryRepository.findById(categoryId);

    winston.info('Expense category updated', {
      categoryId,
      companyId: req.user.companyId,
      userId: req.user.userId,
    });

    res.json({
      success: true,
      data: updated,
      message: 'Expense category updated successfully',
    });
  } catch (error) {
    winston.error('Error updating expense category', {
      error: error.message,
      categoryId: req.params.id,
      companyId: req.user.companyId,
    });

    // Handle duplicate code error
    if (error.message.includes('already exists')) {
      return res.status(400).json({
        success: false,
        error: error.message,
      });
    }

    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * PATCH /expense-categories/:id/toggle-active
 * Toggle category active status (soft delete/reactivate)
 */
router.patch('/:id/toggle-active', requirePermission('MANAGE_EXPENSE_CATEGORIES'), validate(toggleActiveSchema), async (req, res) => {
  try {
    const repositoryFactory = getRepositoryFactory(req.user.companyId);
    const categoryRepository = repositoryFactory.getExpenseCategoriesRepository();
    const categoryId = parseInt(req.params.id);

    // Verify category exists
    const existing = await categoryRepository.findById(categoryId);
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Category not found',
      });
    }

    if (req.body.is_active) {
      await categoryRepository.reactivate(categoryId, req.user.userId);
    } else {
      await categoryRepository.softDelete(categoryId, req.user.userId);
    }

    winston.info('Expense category active status toggled', {
      categoryId,
      is_active: req.body.is_active,
      companyId: req.user.companyId,
      userId: req.user.userId,
    });

    res.json({
      success: true,
      message: req.body.is_active ? 'Category reactivated' : 'Category deactivated',
    });
  } catch (error) {
    winston.error('Error toggling expense category status', {
      error: error.message,
      categoryId: req.params.id,
      companyId: req.user.companyId,
    });

    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * DELETE /expense-categories/:id
 * Hard delete category (only if not referenced by expenses)
 */
router.delete('/:id', requirePermission('MANAGE_EXPENSE_CATEGORIES'), async (req, res) => {
  try {
    const repositoryFactory = getRepositoryFactory(req.user.companyId);
    const categoryRepository = repositoryFactory.getExpenseCategoriesRepository();
    const categoryId = parseInt(req.params.id);

    // Verify category exists
    const existing = await categoryRepository.findById(categoryId);
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Category not found',
      });
    }

    // Check if category is referenced by any expenses
    // This would need to check petty_cash_expenses, unified_expenses, etc.
    // For now, recommend soft delete instead
    const db = categoryRepository.getDb();
    const expenseCount = await db('petty_cash_expenses')
      .where('category', existing.code)
      .count('id as count')
      .first();

    if (expenseCount && parseInt(expenseCount.count) > 0) {
      return res.status(400).json({
        success: false,
        error: `Cannot delete category. It is referenced by ${expenseCount.count} expense(s). Use deactivate instead.`,
      });
    }

    // Safe to delete
    await categoryRepository.delete(categoryId, req.user.userId, false);

    winston.info('Expense category deleted', {
      categoryId,
      code: existing.code,
      companyId: req.user.companyId,
      userId: req.user.userId,
    });

    res.json({
      success: true,
      message: 'Expense category deleted successfully',
    });
  } catch (error) {
    winston.error('Error deleting expense category', {
      error: error.message,
      categoryId: req.params.id,
      companyId: req.user.companyId,
    });

    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * POST /expense-categories/:id/validate-amount
 * Validate if an amount exceeds the category's max_amount limit
 */
router.post('/:id/validate-amount', requirePermission('VIEW_EXPENSES'), async (req, res) => {
  try {
    const { amount } = req.body;

    if (amount === undefined || amount === null) {
      return res.status(400).json({
        success: false,
        error: 'Amount is required',
      });
    }

    const repositoryFactory = getRepositoryFactory(req.user.companyId);
    const categoryRepository = repositoryFactory.getExpenseCategoriesRepository();

    const validation = await categoryRepository.validateMaxAmount(parseInt(req.params.id), amount);

    res.json({
      success: true,
      data: validation,
    });
  } catch (error) {
    winston.error('Error validating category amount', {
      error: error.message,
      categoryId: req.params.id,
      companyId: req.user.companyId,
    });

    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

module.exports = router;
