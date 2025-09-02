const express = require('express');
const { validate, validateParams, sanitize } = require('../middleware/validation');
const { requirePermission } = require('../middleware/auth');
const { logger, auditLog } = require('../utils/logger');
const { getDbConnection } = require('../config/database');
const Joi = require('joi');

const router = express.Router();

// Apply sanitization to all routes
router.use(sanitize);

// Supplier validation schema
const supplierSchema = Joi.object({
  name: Joi.string().min(2).max(200).required().trim(),
  email: Joi.string().email().max(255).allow('').optional(),
  phone: Joi.string().max(20).allow('').optional(),
  address: Joi.string().allow('').optional(),
  vatRegistration: Joi.string().max(50).allow('').optional(),
  contactPerson: Joi.string().max(100).allow('').optional(),
  specialization: Joi.string().max(100).allow('').optional(),
  creditBalance: Joi.number().min(0).precision(2).default(0),
  paymentTermDays: Joi.number().integer().min(0).default(0),
  notes: Joi.string().allow('').optional(),
  isActive: Joi.boolean().default(true)
});

// GET /api/suppliers - List all suppliers
router.get('/', requirePermission('VIEW_SUPPLIERS'), async (req, res) => {
  try {
    const { companyId } = req.user;
    const db = getDbConnection(companyId);
    
    const { 
      page = 1, 
      limit = 50, 
      search = '', 
      specialization = '',
      isActive = ''
    } = req.query;

    const offset = (page - 1) * limit;
    
    let query = db('suppliers').select('*');

    // Search filter
    if (search) {
      query = query.where(function() {
        this.where('name', 'like', `%${search}%`)
            .orWhere('email', 'like', `%${search}%`)
            .orWhere('phone', 'like', `%${search}%`)
            .orWhere('contactPerson', 'like', `%${search}%`);
      });
    }

    // Specialization filter
    if (specialization) {
      query = query.where('specialization', specialization);
    }

    // Active status filter
    if (isActive !== '') {
      query = query.where('isActive', isActive === 'true');
    }

    // Get total count for pagination
    const totalQuery = query.clone();
    const [{ total }] = await totalQuery.count('* as total');

    // Get paginated results
    const suppliers = await query
      .orderBy('name', 'asc')
      .limit(limit)
      .offset(offset);

    auditLog('SUPPLIERS_VIEWED', req.user.userId, {
      companyId,
      count: suppliers.length,
      filters: { search, specialization, isActive }
    });

    res.json({
      success: true,
      data: suppliers,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(total),
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    logger.error('Error fetching suppliers', { 
      error: error.message, 
      userId: req.user.userId,
      companyId: req.user.companyId
    });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch suppliers'
    });
  }
});

// GET /api/suppliers/:id - Get specific supplier
router.get('/:id', 
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  requirePermission('VIEW_SUPPLIERS'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      const supplier = await db('suppliers')
        .where({ id })
        .first();

      if (!supplier) {
        return res.status(404).json({
          success: false,
          error: 'Supplier not found'
        });
      }

      auditLog('SUPPLIER_VIEWED', req.user.userId, {
        supplierId: id,
        supplierName: supplier.name
      });

      res.json({
        success: true,
        data: supplier
      });

    } catch (error) {
      logger.error('Error fetching supplier', { 
        error: error.message, 
        supplierId: req.params.id,
        userId: req.user.userId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch supplier'
      });
    }
  }
);

// POST /api/suppliers - Create new supplier
router.post('/', 
  validate(supplierSchema),
  requirePermission('MANAGE_SUPPLIERS'),
  async (req, res) => {
    try {
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      // Check if supplier with same email already exists (if email provided)
      if (req.body.email) {
        const existingSupplier = await db('suppliers')
          .where({ email: req.body.email })
          .first();

        if (existingSupplier) {
          return res.status(400).json({
            success: false,
            error: 'Supplier with this email already exists'
          });
        }
      }

      const supplierData = {
        ...req.body,
        created_at: new Date(),
        updated_at: new Date()
      };

      const [supplierId] = await db('suppliers').insert(supplierData);
      
      const newSupplier = await db('suppliers')
        .where({ id: supplierId })
        .first();

      auditLog('SUPPLIER_CREATED', req.user.userId, {
        supplierId,
        supplierName: newSupplier.name,
        specialization: newSupplier.specialization
      });

      logger.info('Supplier created', {
        supplierId,
        supplierName: newSupplier.name,
        createdBy: req.user.userId
      });

      res.status(201).json({
        success: true,
        message: 'Supplier created successfully',
        data: newSupplier
      });

    } catch (error) {
      logger.error('Error creating supplier', { 
        error: error.message, 
        userId: req.user.userId,
        supplierData: req.body
      });
      res.status(500).json({
        success: false,
        error: 'Failed to create supplier'
      });
    }
  }
);

// PUT /api/suppliers/:id - Update supplier
router.put('/:id',
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  validate(supplierSchema),
  requirePermission('MANAGE_SUPPLIERS'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      // Check if supplier exists
      const existingSupplier = await db('suppliers')
        .where({ id })
        .first();

      if (!existingSupplier) {
        return res.status(404).json({
          success: false,
          error: 'Supplier not found'
        });
      }

      // Check if email is being changed to an existing one
      if (req.body.email && req.body.email !== existingSupplier.email) {
        const duplicateSupplier = await db('suppliers')
          .where({ email: req.body.email })
          .where('id', '!=', id)
          .first();

        if (duplicateSupplier) {
          return res.status(400).json({
            success: false,
            error: 'Supplier with this email already exists'
          });
        }
      }

      const updateData = {
        ...req.body,
        updated_at: new Date()
      };

      await db('suppliers')
        .where({ id })
        .update(updateData);

      const updatedSupplier = await db('suppliers')
        .where({ id })
        .first();

      auditLog('SUPPLIER_UPDATED', req.user.userId, {
        supplierId: id,
        supplierName: updatedSupplier.name,
        changes: Object.keys(req.body)
      });

      logger.info('Supplier updated', {
        supplierId: id,
        supplierName: updatedSupplier.name,
        updatedBy: req.user.userId
      });

      res.json({
        success: true,
        message: 'Supplier updated successfully',
        data: updatedSupplier
      });

    } catch (error) {
      logger.error('Error updating supplier', { 
        error: error.message, 
        supplierId: req.params.id,
        userId: req.user.userId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to update supplier'
      });
    }
  }
);

// DELETE /api/suppliers/:id - Delete supplier
router.delete('/:id',
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  requirePermission('MANAGE_SUPPLIERS'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      // Check if supplier exists
      const supplier = await db('suppliers')
        .where({ id })
        .first();

      if (!supplier) {
        return res.status(404).json({
          success: false,
          error: 'Supplier not found'
        });
      }

      // Check if supplier has any purchase orders (prevent deletion if has orders)
      const orderCount = await db('purchase_orders')
        .where({ supplierId: id })
        .count('* as count')
        .first();

      if (orderCount.count > 0) {
        return res.status(400).json({
          success: false,
          error: 'Cannot delete supplier with existing purchase orders. Deactivate instead.'
        });
      }

      // Soft delete by setting isActive to false
      await db('suppliers')
        .where({ id })
        .update({ 
          isActive: false,
          updated_at: new Date()
        });

      auditLog('SUPPLIER_DELETED', req.user.userId, {
        supplierId: id,
        supplierName: supplier.name
      });

      logger.info('Supplier deleted (deactivated)', {
        supplierId: id,
        supplierName: supplier.name,
        deletedBy: req.user.userId
      });

      res.json({
        success: true,
        message: 'Supplier deactivated successfully'
      });

    } catch (error) {
      logger.error('Error deleting supplier', { 
        error: error.message, 
        supplierId: req.params.id,
        userId: req.user.userId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to delete supplier'
      });
    }
  }
);

module.exports = router;