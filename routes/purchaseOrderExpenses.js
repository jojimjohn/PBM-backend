const express = require('express');
const router = express.Router();
const Joi = require('joi');
const { authenticateToken, requirePermission } = require('../middleware/auth');
const { validate, validateParams } = require('../middleware/validation');
const { getDbConnection } = require('../config/database');
const { logger } = require('../utils/logger');

/**
 * Purchase Order Expenses Routes
 *
 * Manages expenses linked to purchase orders (freight, customs, handling, etc.)
 * These expenses affect the true cost of inventory.
 */

// Validation schemas
// Category is validated dynamically against expense_categories table
// Accepts both 'purchase' and 'operational' type categories for flexibility
const expenseSchema = Joi.object({
  category: Joi.string().trim().max(50).required(),
  description: Joi.string().trim().max(500).required(),
  amount: Joi.number().min(0).precision(3).required(),
  expenseDate: Joi.date().required(),
  vendor: Joi.string().trim().max(200).allow('').optional(),
  referenceNumber: Joi.string().trim().max(100).allow('').optional(),
  notes: Joi.string().trim().max(1000).allow('').optional(),
  receiptPhoto: Joi.string().allow(null, '').optional() // Base64 encoded image/PDF
}).options({ stripUnknown: true });

/**
 * Validate category against expense_categories table
 * @param {object} db - Database connection
 * @param {string} categoryCode - Category code to validate
 * @param {string} companyId - Company ID for isolation
 * @returns {Promise<{valid: boolean, error?: string}>}
 */
async function validateCategoryCode(db, categoryCode, companyId) {
  // Accept both purchase and operational categories for PO expenses
  const validTypes = ['purchase', 'operational'];

  const category = await db('expense_categories')
    .where('company_id', companyId)
    .where('code', categoryCode.toUpperCase())
    .whereIn('type', validTypes)
    .where('is_active', true)
    .first();

  if (!category) {
    return {
      valid: false,
      error: `Invalid category code: ${categoryCode}. Must be an active purchase or operational category.`
    };
  }

  return { valid: true, category };
}

/**
 * GET /api/purchase-orders/:id/expenses
 * Get all expenses for a purchase order
 */
router.get('/:id/expenses',
  authenticateToken,
  requirePermission('VIEW_PURCHASE'),
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      // Get expenses linked to this PO
      const expenses = await db('unified_expenses')
        .where({
          referenceType: 'purchase_order',
          referenceId: id
        })
        .orderBy('expenseDate', 'desc');

      // Calculate totals by category
      const summary = expenses.reduce((acc, exp) => {
        acc.total += parseFloat(exp.amount);
        acc.byCategory[exp.category] = (acc.byCategory[exp.category] || 0) + parseFloat(exp.amount);
        acc.count++;
        return acc;
      }, { total: 0, byCategory: {}, count: 0 });

      res.json({
        success: true,
        data: {
          expenses: expenses.map(exp => ({
            ...exp,
            amount: parseFloat(exp.amount)
          })),
          summary
        }
      });
    } catch (error) {
      logger.error('Error fetching PO expenses', {
        error: error.message,
        purchaseOrderId: req.params.id
      });
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to fetch expenses'
      });
    }
  }
);

/**
 * POST /api/purchase-orders/:id/expenses
 * Add an expense to a purchase order
 */
router.post('/:id/expenses',
  authenticateToken,
  requirePermission('CREATE_PURCHASE'),
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  validate(expenseSchema),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { companyId, userId } = req.user;
      const db = getDbConnection(companyId);

      // Verify PO exists
      const po = await db('purchase_orders').where({ id }).first();
      if (!po) {
        return res.status(404).json({
          success: false,
          error: 'Purchase order not found'
        });
      }

      // Validate category against expense_categories table
      const categoryValidation = await validateCategoryCode(db, req.body.category, companyId);
      if (!categoryValidation.valid) {
        return res.status(400).json({
          success: false,
          error: categoryValidation.error
        });
      }

      // Create expense record
      // Note: unified_expenses table doesn't have approval columns - expenses are auto-approved
      // Required fields: referenceId, referenceType, expenseType, category, description, amount, expenseDate, createdBy, updatedBy
      // Column mapping: frontend 'referenceNumber' -> database 'receiptNumber'
      // Category is normalized to uppercase for consistency with expense_categories table
      // project_id is inherited from the purchase order for proper filtering
      const expenseData = {
        category: req.body.category.toUpperCase(),
        description: req.body.description,
        amount: req.body.amount,
        expenseDate: req.body.expenseDate,
        vendor: req.body.vendor || null,
        receiptNumber: req.body.referenceNumber || null, // frontend sends 'referenceNumber', DB column is 'receiptNumber'
        notes: req.body.notes || null,
        receiptPhoto: req.body.receiptPhoto || null, // Base64 encoded receipt image/PDF
        referenceType: 'purchase_order',
        referenceId: id,
        expenseType: 'purchase', // Required: 'purchase' or 'collection'
        project_id: po.project_id || null, // Inherit project from PO for filtering consistency
        createdBy: userId,
        updatedBy: userId
        // createdAt and updatedAt have DEFAULT CURRENT_TIMESTAMP
      };

      const [expenseId] = await db('unified_expenses').insert(expenseData);

      // Get created expense
      const expense = await db('unified_expenses').where({ id: expenseId }).first();

      logger.info('PO expense created', {
        expenseId,
        purchaseOrderId: id,
        category: expense.category,
        amount: expense.amount,
        userId
      });

      res.json({
        success: true,
        data: {
          ...expense,
          amount: parseFloat(expense.amount)
        },
        message: 'Expense added successfully'
      });
    } catch (error) {
      logger.error('Error creating PO expense', {
        error: error.message,
        purchaseOrderId: req.params.id,
        body: req.body
      });
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to create expense'
      });
    }
  }
);

/**
 * PUT /api/purchase-orders/expenses/:expenseId
 * Update a PO expense
 */
router.put('/expenses/:expenseId',
  authenticateToken,
  requirePermission('EDIT_PURCHASE'),
  validateParams(Joi.object({ expenseId: Joi.number().integer().positive().required() })),
  validate(expenseSchema),
  async (req, res) => {
    try {
      const { expenseId } = req.params;
      const { companyId, userId } = req.user;
      const db = getDbConnection(companyId);

      // Verify expense exists and is linked to PO
      const expense = await db('unified_expenses')
        .where({ id: expenseId, referenceType: 'purchase_order' })
        .first();

      if (!expense) {
        return res.status(404).json({
          success: false,
          error: 'Expense not found'
        });
      }

      // Validate category against expense_categories table
      const categoryValidation = await validateCategoryCode(db, req.body.category, companyId);
      if (!categoryValidation.valid) {
        return res.status(400).json({
          success: false,
          error: categoryValidation.error
        });
      }

      // Update expense - only allow specific fields to be updated
      // Column mapping: frontend 'referenceNumber' -> database 'receiptNumber'
      // Category is normalized to uppercase for consistency with expense_categories table
      const updateData = {
        category: req.body.category.toUpperCase(),
        description: req.body.description,
        amount: req.body.amount,
        expenseDate: req.body.expenseDate,
        vendor: req.body.vendor || null,
        receiptNumber: req.body.referenceNumber || null, // frontend sends 'referenceNumber', DB column is 'receiptNumber'
        notes: req.body.notes || null,
        receiptPhoto: req.body.receiptPhoto || null, // Base64 encoded receipt image/PDF
        updatedBy: userId
        // updatedAt has DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      };

      await db('unified_expenses')
        .where({ id: expenseId })
        .update(updateData);

      // Get updated expense
      const updated = await db('unified_expenses').where({ id: expenseId }).first();

      logger.info('PO expense updated', {
        expenseId,
        purchaseOrderId: expense.referenceId,
        userId
      });

      res.json({
        success: true,
        data: {
          ...updated,
          amount: parseFloat(updated.amount)
        },
        message: 'Expense updated successfully'
      });
    } catch (error) {
      logger.error('Error updating PO expense', {
        error: error.message,
        expenseId: req.params.expenseId
      });
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to update expense'
      });
    }
  }
);

/**
 * DELETE /api/purchase-orders/expenses/:expenseId
 * Delete a PO expense
 */
router.delete('/expenses/:expenseId',
  authenticateToken,
  requirePermission('DELETE_PURCHASE'),
  validateParams(Joi.object({ expenseId: Joi.number().integer().positive().required() })),
  async (req, res) => {
    try {
      const { expenseId } = req.params;
      const { companyId, userId } = req.user;
      const db = getDbConnection(companyId);

      // Verify expense exists
      const expense = await db('unified_expenses')
        .where({ id: expenseId, referenceType: 'purchase_order' })
        .first();

      if (!expense) {
        return res.status(404).json({
          success: false,
          error: 'Expense not found'
        });
      }

      // Delete expense
      await db('unified_expenses').where({ id: expenseId }).delete();

      logger.info('PO expense deleted', {
        expenseId,
        purchaseOrderId: expense.referenceId,
        userId
      });

      res.json({
        success: true,
        message: 'Expense deleted successfully'
      });
    } catch (error) {
      logger.error('Error deleting PO expense', {
        error: error.message,
        expenseId: req.params.expenseId
      });
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to delete expense'
      });
    }
  }
);

/**
 * GET /api/purchase-orders/expenses/categories
 * Get available expense categories
 */
router.get('/expenses/categories',
  authenticateToken,
  requirePermission('VIEW_PURCHASE'),
  async (req, res) => {
    try {
      const categories = {
        'freight': 'Freight Charges',
        'loading': 'Loading Fees',
        'unloading': 'Unloading Fees',
        'transport': 'Transportation',
        'customs': 'Customs Duties',
        'import_tax': 'Import Tax',
        'handling': 'Handling Charges',
        'insurance': 'Insurance',
        'other': 'Other'
      };

      res.json({
        success: true,
        data: categories
      });
    } catch (error) {
      logger.error('Error fetching expense categories', { error: error.message });
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to fetch categories'
      });
    }
  }
);

/**
 * GET /api/purchase-orders/:id/expense-summary
 * Get expense summary with PO total and true landed cost
 */
router.get('/:id/expense-summary',
  authenticateToken,
  requirePermission('VIEW_PURCHASE'),
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      // Get PO details
      const po = await db('purchase_orders').where({ id }).first();
      if (!po) {
        return res.status(404).json({
          success: false,
          error: 'Purchase order not found'
        });
      }

      // Get expenses linked to this PO
      const expenses = await db('unified_expenses')
        .where({
          referenceType: 'purchase_order',
          referenceId: id
        })
        .orderBy('expenseDate', 'desc');

      // Calculate totals by category
      const byCategory = {};
      let expenseTotal = 0;

      expenses.forEach(exp => {
        const amount = parseFloat(exp.amount);
        expenseTotal += amount;
        byCategory[exp.category] = (byCategory[exp.category] || 0) + amount;
      });

      // Calculate PO total from items
      const poTotal = parseFloat(po.totalAmount) || 0;
      const trueLandedCost = poTotal + expenseTotal;

      res.json({
        success: true,
        data: {
          poNumber: po.orderNumber,
          poTotal,
          expenseTotal,
          expenseCount: expenses.length,
          trueLandedCost,
          byCategory,
          costBreakdown: {
            material: poTotal,
            freight: byCategory.freight || 0,
            loading: byCategory.loading || 0,
            unloading: byCategory.unloading || 0,
            transport: byCategory.transport || 0,
            customs: byCategory.customs || 0,
            importTax: byCategory.import_tax || 0,
            handling: byCategory.handling || 0,
            insurance: byCategory.insurance || 0,
            other: byCategory.other || 0
          }
        }
      });
    } catch (error) {
      logger.error('Error fetching PO expense summary', {
        error: error.message,
        purchaseOrderId: req.params.id
      });
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to fetch expense summary'
      });
    }
  }
);

module.exports = router;
