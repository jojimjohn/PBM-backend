const express = require('express');
const router = express.Router();
const { getDbConnection } = require('../config/database');
const { requirePermission } = require('../middleware/auth');
const { validate, validateParams } = require('../middleware/validation');
const Joi = require('joi');
const { logger, auditLog } = require('../utils/logger');

// Validation schemas
const branchSchema = Joi.object({
  code: Joi.string().min(2).max(20).required(),
  name: Joi.string().min(2).max(100).required(),
  region_id: Joi.number().integer().positive().allow(null).optional(),
  address: Joi.string().max(500).allow('', null).optional(),
  city: Joi.string().max(50).allow('', null).optional(),
  phone: Joi.string().max(20).allow('', null).optional(),
  email: Joi.string().email().max(100).allow('', null).optional(),
  manager_name: Joi.string().max(100).allow('', null).optional(),
  manager_phone: Joi.string().max(20).allow('', null).optional(),
  is_active: Joi.alternatives().try(Joi.boolean(), Joi.number().valid(0, 1)).optional(),
  notes: Joi.string().max(1000).allow('', null).optional()
}).options({ stripUnknown: true });

const updateBranchSchema = branchSchema.fork(
  ['code', 'name'],
  (schema) => schema.optional()
).options({ stripUnknown: true });

// GET /api/branches - List all branches
router.get('/', requirePermission('VIEW_SETTINGS'), async (req, res) => {
  try {
    const { companyId } = req.user;
    const db = getDbConnection(companyId);

    const {
      page = 1,
      limit = 50,
      is_active,
      region_id,
      search
    } = req.query;

    const offset = (page - 1) * limit;

    let query = db('branches')
      .select('branches.*')
      .where('branches.company_id', companyId)
      .orderBy('branches.is_active', 'desc')
      .orderBy('branches.name', 'asc');

    // Apply filters
    if (is_active !== undefined) {
      query = query.where('branches.is_active', is_active === 'true' || is_active === '1');
    }

    if (region_id) {
      query = query.where('branches.region_id', region_id);
    }

    if (search) {
      query = query.where(function() {
        this.where('branches.code', 'like', `%${search}%`)
            .orWhere('branches.name', 'like', `%${search}%`)
            .orWhere('branches.city', 'like', `%${search}%`);
      });
    }

    // Get total count for pagination
    const totalQuery = query.clone();
    const [{ count }] = await totalQuery.clearSelect().clearOrder().count('* as count');

    // Get paginated results
    const branches = await query.limit(limit).offset(offset);

    auditLog('BRANCHES_VIEWED', req.user.userId, {
      companyId,
      count: branches.length,
      filters: { is_active, region_id, search }
    });

    res.json({
      success: true,
      data: branches,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count,
        pages: Math.ceil(count / limit)
      }
    });

  } catch (error) {
    logger.error('Error fetching branches', {
      error: error.message,
      companyId: req.user.companyId,
      userId: req.user.userId
    });

    res.status(500).json({
      success: false,
      error: 'Failed to fetch branches'
    });
  }
});

// GET /api/branches/:id - Get specific branch
router.get('/:id',
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  requirePermission('VIEW_SETTINGS'),
  async (req, res) => {
    try {
      const { companyId } = req.user;
      const { id } = req.params;
      const db = getDbConnection(companyId);

      const branch = await db('branches')
        .select('branches.*')
        .where({
          'branches.id': id,
          'branches.company_id': companyId
        })
        .first();

      if (!branch) {
        return res.status(404).json({
          success: false,
          error: 'Branch not found'
        });
      }

      auditLog('BRANCH_VIEWED', req.user.userId, {
        branchId: id,
        branchCode: branch.code,
        companyId
      });

      res.json({
        success: true,
        data: branch
      });

    } catch (error) {
      logger.error('Error fetching branch', {
        error: error.message,
        branchId: req.params.id,
        companyId: req.user.companyId,
        userId: req.user.userId
      });

      res.status(500).json({
        success: false,
        error: 'Failed to fetch branch'
      });
    }
});

// POST /api/branches - Create new branch
router.post('/',
  validate(branchSchema),
  requirePermission('MANAGE_SETTINGS'),
  async (req, res) => {
    try {
      const { companyId, userId } = req.user;
      const db = getDbConnection(companyId);

      // Check if code already exists for this company
      const existingBranch = await db('branches')
        .where({
          company_id: companyId,
          code: req.body.code
        })
        .first();

      if (existingBranch) {
        return res.status(400).json({
          success: false,
          error: 'A branch with this code already exists'
        });
      }

      const branchData = {
        ...req.body,
        company_id: companyId,
        created_at: new Date(),
        updated_at: new Date()
      };

      const [branchId] = await db('branches').insert(branchData);

      const newBranch = await db('branches')
        .where({ id: branchId })
        .first();

      auditLog('BRANCH_CREATED', userId, {
        branchId,
        branchCode: newBranch.code,
        branchName: newBranch.name,
        companyId
      });

      logger.info('Branch created', {
        branchId,
        branchCode: newBranch.code,
        companyId,
        userId
      });

      res.status(201).json({
        success: true,
        message: 'Branch created successfully',
        data: newBranch
      });

    } catch (error) {
      logger.error('Error creating branch', {
        error: error.message,
        branchData: req.body,
        companyId: req.user.companyId,
        userId: req.user.userId
      });

      res.status(500).json({
        success: false,
        error: 'Failed to create branch'
      });
    }
});

// PUT /api/branches/:id - Update branch
router.put('/:id',
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  validate(updateBranchSchema),
  requirePermission('MANAGE_SETTINGS'),
  async (req, res) => {
    try {
      const { companyId, userId } = req.user;
      const { id } = req.params;
      const db = getDbConnection(companyId);

      // Check if branch exists
      const existingBranch = await db('branches')
        .where({
          id,
          company_id: companyId
        })
        .first();

      if (!existingBranch) {
        return res.status(404).json({
          success: false,
          error: 'Branch not found'
        });
      }

      // If code is being changed, check for duplicates
      if (req.body.code && req.body.code !== existingBranch.code) {
        const codeExists = await db('branches')
          .where({
            company_id: companyId,
            code: req.body.code
          })
          .whereNot('id', id)
          .first();

        if (codeExists) {
          return res.status(400).json({
            success: false,
            error: 'A branch with this code already exists'
          });
        }
      }

      const updateData = {
        ...req.body,
        updated_at: new Date()
      };

      // Don't allow changing company_id
      delete updateData.company_id;

      await db('branches')
        .where({ id })
        .update(updateData);

      const updatedBranch = await db('branches')
        .where({ id })
        .first();

      auditLog('BRANCH_UPDATED', userId, {
        branchId: id,
        branchCode: updatedBranch.code,
        branchName: updatedBranch.name,
        companyId
      });

      logger.info('Branch updated', {
        branchId: id,
        branchCode: updatedBranch.code,
        companyId,
        userId
      });

      res.json({
        success: true,
        message: 'Branch updated successfully',
        data: updatedBranch
      });

    } catch (error) {
      logger.error('Error updating branch', {
        error: error.message,
        branchId: req.params.id,
        branchData: req.body,
        companyId: req.user.companyId,
        userId: req.user.userId
      });

      res.status(500).json({
        success: false,
        error: 'Failed to update branch'
      });
    }
});

// DELETE /api/branches/:id - Soft delete branch
router.delete('/:id',
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  requirePermission('MANAGE_SETTINGS'),
  async (req, res) => {
    try {
      const { companyId, userId } = req.user;
      const { id } = req.params;
      const db = getDbConnection(companyId);

      // Check if branch exists
      const branch = await db('branches')
        .where({
          id,
          company_id: companyId
        })
        .first();

      if (!branch) {
        return res.status(404).json({
          success: false,
          error: 'Branch not found'
        });
      }

      // Check if branch is used in purchase_orders
      const poCount = await db('purchase_orders')
        .where({ branch_id: id })
        .count('* as count')
        .first();

      // Check if branch is used in sales_orders
      const soCount = await db('sales_orders')
        .where({ branch_id: id })
        .count('* as count')
        .first();

      if (poCount.count > 0 || soCount.count > 0) {
        // Soft delete - just deactivate
        await db('branches')
          .where({ id })
          .update({
            is_active: false,
            updated_at: new Date()
          });

        auditLog('BRANCH_DEACTIVATED', userId, {
          branchId: id,
          branchCode: branch.code,
          reason: 'Has associated orders',
          companyId
        });

        return res.json({
          success: true,
          message: 'Branch deactivated (has associated orders)',
          data: { id, is_active: false }
        });
      }

      // Hard delete if no orders
      await db('branches')
        .where({ id })
        .delete();

      auditLog('BRANCH_DELETED', userId, {
        branchId: id,
        branchCode: branch.code,
        branchName: branch.name,
        companyId
      });

      logger.info('Branch deleted', {
        branchId: id,
        branchCode: branch.code,
        companyId,
        userId
      });

      res.json({
        success: true,
        message: 'Branch deleted successfully'
      });

    } catch (error) {
      logger.error('Error deleting branch', {
        error: error.message,
        branchId: req.params.id,
        companyId: req.user.companyId,
        userId: req.user.userId
      });

      res.status(500).json({
        success: false,
        error: 'Failed to delete branch'
      });
    }
});

module.exports = router;
