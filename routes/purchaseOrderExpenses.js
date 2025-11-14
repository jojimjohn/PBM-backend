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
const expenseSchema = Joi.object({
  category: Joi.string().valid(
    'freight', 'loading', 'unloading', 'transport',
    'customs', 'import_tax', 'handling', 'insurance', 'other'
  ).required(),
  description: Joi.string().trim().max(500).required(),
  amount: Joi.number().min(0).precision(3).required(),
  expenseDate: Joi.date().required(),
  vendor: Joi.string().trim().max(200).allow('').optional(),
  referenceNumber: Joi.string().trim().max(100).allow('').optional(),
  notes: Joi.string().trim().max(1000).allow('').optional()
}).options({ stripUnknown: true });

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

      // Create expense record
      const expenseData = {
        ...req.body,
        referenceType: 'purchase_order',
        referenceId: id,
        status: 'approved', // PO expenses are auto-approved
        createdBy: userId,
        approvedBy: userId,
        approvedAt: new Date(),
        created_at: new Date()
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

      // Update expense
      await db('unified_expenses')
        .where({ id: expenseId })
        .update({
          ...req.body,
          updated_at: new Date()
        });

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

module.exports = router;
