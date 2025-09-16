const express = require('express');
const { validate, validateParams, sanitize, schemas } = require('../middleware/validation');
const { requirePermission, requireCompanyAccess } = require('../middleware/auth');
const { logger, auditLog } = require('../utils/logger');
const { getDbConnection } = require('../config/database');
const Joi = require('joi');

const router = express.Router();

// Apply sanitization to all routes
router.use(sanitize);

// Customer validation schema
const customerSchema = Joi.object({
  name: Joi.string().min(2).max(200).required().trim(),
  email: Joi.string().email().max(255).allow('').optional(),
  phone: Joi.string().max(20).allow('').optional(),
  address: Joi.string().allow('').optional(),
  customerType: Joi.string().valid('walk-in', 'project-based', 'contract').required(),
  vatRegistration: Joi.string().max(50).allow('').optional(),
  contactPerson: Joi.string().max(100).allow('').optional(),
  creditLimit: Joi.number().min(0).default(0),
  paymentTermDays: Joi.number().integer().min(0).default(0),
  notes: Joi.string().allow('').optional(),
  isActive: Joi.boolean().default(true)
});

// GET /api/customers - List all customers
router.get('/', requirePermission('VIEW_CUSTOMERS'), async (req, res) => {
  try {
    const { companyId } = req.user;
    const db = getDbConnection(companyId);
    
    const { 
      page = 1, 
      limit = 50, 
      search = '', 
      customerType = '',
      isActive = ''
    } = req.query;

    const offset = (page - 1) * limit;
    
    let query = db('customers').select('*');

    // Search filter
    if (search) {
      query = query.where(function() {
        this.where('name', 'like', `%${search}%`)
            .orWhere('email', 'like', `%${search}%`)
            .orWhere('phone', 'like', `%${search}%`)
            .orWhere('contactPerson', 'like', `%${search}%`);
      });
    }

    // Customer type filter
    if (customerType) {
      query = query.where('customerType', customerType);
    }

    // Active status filter
    if (isActive !== '') {
      query = query.where('isActive', isActive === 'true');
    }

    // Get total count for pagination
    const totalQuery = query.clone();
    const [{ total }] = await totalQuery.count('* as total');

    // Get paginated results
    const customers = await query
      .orderBy('name', 'asc')
      .limit(limit)
      .offset(offset);

    auditLog('CUSTOMERS_VIEWED', req.user.userId, {
      companyId,
      count: customers.length,
      filters: { search, customerType, isActive }
    });

    res.json({
      success: true,
      data: customers,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(total),
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    logger.error('Error fetching customers', { 
      error: error.message, 
      userId: req.user.userId,
      companyId: req.user.companyId
    });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch customers'
    });
  }
});

// GET /api/customers/:id - Get specific customer
router.get('/:id', 
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  requirePermission('VIEW_CUSTOMERS'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      const customer = await db('customers')
        .where({ id })
        .first();

      if (!customer) {
        return res.status(404).json({
          success: false,
          error: 'Customer not found'
        });
      }

      auditLog('CUSTOMER_VIEWED', req.user.userId, {
        customerId: id,
        customerName: customer.name
      });

      res.json({
        success: true,
        data: customer
      });

    } catch (error) {
      logger.error('Error fetching customer', { 
        error: error.message, 
        customerId: req.params.id,
        userId: req.user.userId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch customer'
      });
    }
  }
);

// POST /api/customers - Create new customer
router.post('/', 
  validate(customerSchema),
  requirePermission('MANAGE_CUSTOMERS'),
  async (req, res) => {
    try {
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      // Check if customer with same email already exists (if email provided)
      if (req.body.email) {
        const existingCustomer = await db('customers')
          .where({ email: req.body.email })
          .first();

        if (existingCustomer) {
          return res.status(400).json({
            success: false,
            error: 'Customer with this email already exists'
          });
        }
      }

      const customerData = {
        ...req.body,
        created_at: new Date(),
        updated_at: new Date()
      };

      const [customerId] = await db('customers').insert(customerData);
      
      const newCustomer = await db('customers')
        .where({ id: customerId })
        .first();

      auditLog('CUSTOMER_CREATED', req.user.userId, {
        customerId,
        customerName: newCustomer.name,
        customerType: newCustomer.customerType
      });

      logger.info('Customer created', {
        customerId,
        customerName: newCustomer.name,
        createdBy: req.user.userId
      });

      res.status(201).json({
        success: true,
        message: 'Customer created successfully',
        data: newCustomer
      });

    } catch (error) {
      logger.error('Error creating customer', { 
        error: error.message, 
        userId: req.user.userId,
        customerData: req.body
      });
      res.status(500).json({
        success: false,
        error: 'Failed to create customer'
      });
    }
  }
);

// PUT /api/customers/:id - Update customer
router.put('/:id',
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  validate(customerSchema),
  requirePermission('MANAGE_CUSTOMERS'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      // Check if customer exists
      const existingCustomer = await db('customers')
        .where({ id })
        .first();

      if (!existingCustomer) {
        return res.status(404).json({
          success: false,
          error: 'Customer not found'
        });
      }

      // Check if email is being changed to an existing one
      if (req.body.email && req.body.email !== existingCustomer.email) {
        const duplicateCustomer = await db('customers')
          .where({ email: req.body.email })
          .where('id', '!=', id)
          .first();

        if (duplicateCustomer) {
          return res.status(400).json({
            success: false,
            error: 'Customer with this email already exists'
          });
        }
      }

      const updateData = {
        ...req.body,
        updated_at: new Date()
      };

      await db('customers')
        .where({ id })
        .update(updateData);

      const updatedCustomer = await db('customers')
        .where({ id })
        .first();

      auditLog('CUSTOMER_UPDATED', req.user.userId, {
        customerId: id,
        customerName: updatedCustomer.name,
        changes: Object.keys(req.body)
      });

      logger.info('Customer updated', {
        customerId: id,
        customerName: updatedCustomer.name,
        updatedBy: req.user.userId
      });

      res.json({
        success: true,
        message: 'Customer updated successfully',
        data: updatedCustomer
      });

    } catch (error) {
      logger.error('Error updating customer', { 
        error: error.message, 
        customerId: req.params.id,
        userId: req.user.userId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to update customer'
      });
    }
  }
);

// DELETE /api/customers/:id - Delete customer
router.delete('/:id',
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  requirePermission('MANAGE_CUSTOMERS'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      // Check if customer exists
      const customer = await db('customers')
        .where({ id })
        .first();

      if (!customer) {
        return res.status(404).json({
          success: false,
          error: 'Customer not found'
        });
      }

      // Check if customer has any orders (prevent deletion if has orders)
      const orderCount = await db('sales_orders')
        .where({ customerId: id })
        .count('* as count')
        .first();

      if (orderCount.count > 0) {
        return res.status(400).json({
          success: false,
          error: 'Cannot delete customer with existing orders. Deactivate instead.'
        });
      }

      // Check if customer has any contracts (prevent deletion if has contracts)
      const contractCount = await db('contracts')
        .where({ customerId: id })
        .count('* as count')
        .first();

      if (contractCount.count > 0) {
        return res.status(400).json({
          success: false,
          error: 'Cannot delete customer with existing contracts. Deactivate instead.'
        });
      }

      // Soft delete by setting isActive to false
      await db('customers')
        .where({ id })
        .update({ 
          isActive: false,
          updated_at: new Date()
        });

      auditLog('CUSTOMER_DELETED', req.user.userId, {
        customerId: id,
        customerName: customer.name
      });

      logger.info('Customer deleted (deactivated)', {
        customerId: id,
        customerName: customer.name,
        deletedBy: req.user.userId
      });

      res.json({
        success: true,
        message: 'Customer deactivated successfully'
      });

    } catch (error) {
      logger.error('Error deleting customer', { 
        error: error.message, 
        customerId: req.params.id,
        userId: req.user.userId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to delete customer'
      });
    }
  }
);

module.exports = router;