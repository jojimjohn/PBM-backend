const express = require('express');
const { validate, validateParams, sanitize } = require('../middleware/validation');
const { requirePermission } = require('../middleware/auth');
const { logger, auditLog } = require('../utils/logger');
const { getDbConnection } = require('../config/database');
const Joi = require('joi');

const router = express.Router();

// Apply sanitization to all routes
router.use(sanitize);

// Callout creation schema (saves as collection_order with status 'callout')
const calloutSchema = Joi.object({
  contractId: Joi.number().integer().positive().required(),
  supplierId: Joi.number().integer().positive().required(),
  locationId: Joi.number().integer().positive().required(),
  requestedPickupDate: Joi.date().required(),
  priority: Joi.string().valid('low', 'normal', 'high', 'urgent').default('normal'),
  contactPerson: Joi.string().max(100).allow('').optional(),
  contactPhone: Joi.string().max(20).allow('').optional(),
  specialInstructions: Joi.string().allow('').optional(),
  materials: Joi.array().items(Joi.object({
    materialId: Joi.number().integer().positive().required(),
    availableQuantity: Joi.number().min(0.001).precision(3).required(),
    unit: Joi.string().max(20).required(),
    condition: Joi.string().valid('excellent', 'good', 'fair', 'poor', 'mixed').default('good'),
    contractRate: Joi.number().min(0).precision(3).optional(),
    appliedRateType: Joi.string().max(50).optional(),
    estimatedValue: Joi.number().min(0).precision(2).optional(),
    notes: Joi.string().allow('').optional()
  })).min(1).required(),
  totalEstimatedValue: Joi.number().min(0).precision(2).required()
});

// Collection Order validation schema (for actual collection scheduling)
const collectionOrderSchema = Joi.object({
  scheduledDate: Joi.date().min('now').required(),
  driverName: Joi.string().max(100).allow('').optional(),
  vehiclePlate: Joi.string().max(20).allow('').optional(),
  vehicleType: Joi.string().max(50).allow('').optional(),
  estimatedDistance: Joi.number().min(0).precision(2).optional(),
  notes: Joi.string().allow('').optional()
});

// Collection Item validation schema
const collectionItemSchema = Joi.object({
  materialId: Joi.number().integer().positive().required(),
  requestedQuantity: Joi.number().min(0).precision(3).default(0),
  collectedQuantity: Joi.number().min(0.001).precision(3).required(),
  unit: Joi.string().max(20).required(),
  condition: Joi.string().valid('excellent', 'good', 'fair', 'poor', 'mixed').default('good'),
  qualityGrade: Joi.string().valid('A', 'B', 'C', 'Reject').default('A'),
  batchNumber: Joi.string().max(100).allow('').optional(),
  containerDetails: Joi.string().max(200).allow('').optional(),
  weightVerified: Joi.boolean().default(false),
  qualityVerified: Joi.boolean().default(false),
  notes: Joi.string().allow('').optional()
});

// Collection Expense validation schema
const collectionExpenseSchema = Joi.object({
  expenseCategory: Joi.string().valid('fuel', 'transportation', 'loading_unloading', 'permits_fees', 'equipment_rental', 'meals_accommodation', 'maintenance', 'other').required(),
  description: Joi.string().max(200).required(),
  amount: Joi.number().min(0).precision(2).required(),
  currency: Joi.string().length(3).default('OMR'),
  receiptNumber: Joi.string().max(100).allow('').optional(),
  receiptPhoto: Joi.string().max(500).allow('').optional(),
  paidBy: Joi.string().max(100).allow('').optional(),
  paymentMethod: Joi.string().valid('cash', 'card', 'bank_transfer', 'company_account').default('cash'),
  expenseDate: Joi.date().required(),
  notes: Joi.string().allow('').optional()
});

// POST /api/collection-orders/callouts - Create a callout (saved as collection_order with status 'callout')
router.post('/callouts', 
  validate(calloutSchema),
  requirePermission('CREATE_COLLECTIONS'),
  async (req, res) => {
    try {
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      const { materials, ...calloutData } = req.body;

      // Generate unique order number
      const orderNumber = `CO-${Date.now()}`;

      const result = await db.transaction(async (trx) => {
        // Insert collection order as 'callout' status
        const [collectionOrderId] = await trx('collection_orders').insert({
          orderNumber,
          calloutId: 0, // No separate callout table
          contractId: calloutData.contractId,
          supplierId: calloutData.supplierId,
          locationId: calloutData.locationId,
          scheduledDate: calloutData.requestedPickupDate,
          status: 'scheduled',
          priority: calloutData.priority || 'normal',
          totalValue: calloutData.totalEstimatedValue || 0,
          notes: calloutData.specialInstructions || '',
          createdBy: req.user.userId
        });

        // Insert collection items
        if (materials && materials.length > 0) {
          const collectionItems = materials.map(material => ({
            collectionOrderId: collectionOrderId,
            materialId: material.materialId,
            availableQuantity: material.availableQuantity || 0,
            collectedQuantity: 0,
            unit: material.unit || 'kg',
            contractRate: material.contractRate || null,
            appliedRateType: material.appliedRateType || null,
            totalValue: material.estimatedValue || 0,
            materialCondition: material.condition || 'good',
            qualityGrade: material.qualityGrade || 'A',
            notes: material.notes || ''
          }));

          await trx('collection_items').insert(collectionItems);
        }

        return collectionOrderId;
      });

      auditLog('CALLOUT_CREATED', req.user.userId, {
        collectionOrderId: result,
        orderNumber,
        contractId: calloutData.contractId,
        supplierId: calloutData.supplierId,
        materialsCount: materials.length
      });

      logger.info('Callout created', {
        collectionOrderId: result,
        orderNumber,
        createdBy: req.user.userId
      });

      res.status(201).json({
        success: true,
        message: 'Callout created successfully',
        data: { id: result, orderNumber }
      });

    } catch (error) {
      logger.error('Error creating callout', { 
        error: error.message, 
        userId: req.user.userId,
        calloutData: req.body
      });
      res.status(500).json({
        success: false,
        error: 'Failed to create callout'
      });
    }
  }
);

// GET /api/collection-orders/callouts - List callouts (collection orders with status 'callout')
router.get('/callouts', requirePermission('VIEW_COLLECTIONS'), async (req, res) => {
  try {
    const { companyId } = req.user;
    const db = getDbConnection(companyId);
    
    const {
      page = 1,
      limit = 50,
      status = '',
    const {
      page = 1,
      limit = 50,
      status = '',
      priority = '',
      search = '',
      supplierId = '',
      contractId = ''
    } = req.query;

    const offset = (page - 1) * limit;


    // Check if collection_orders table exists
    const tableExists = await db.schema.hasTable('collection_orders');
    if (!tableExists) {
      return res.json({
        success: true,
        data: [],
        pagination: { page: parseInt(page), limit: parseInt(limit), total: 0, pages: 0 }
      });
    }

    let query = db('collection_orders')
      .leftJoin('contracts', 'collection_orders.contractId', 'contracts.id')
      .leftJoin('suppliers', 'collection_orders.supplierId', 'suppliers.id')
      .leftJoin('supplier_locations', 'collection_orders.locationId', 'supplier_locations.id')
      .select(
        'collection_orders.*',
        'contracts.contractNumber',
        'contracts.title as contractTitle',
        'suppliers.name as supplierName',
        'supplier_locations.locationName',
        'supplier_locations.locationCode'
      );

    // Status filter - if not provided, show all statuses
    if (status && status !== 'all') {
      query = query.where('collection_orders.status', status);
    }

    // Priority filter
    if (priority && priority !== 'all') {
      query = query.where('collection_orders.priority', priority);
    }
      );

    // Status filter - if not provided, show all statuses
    if (status && status !== 'all') {
      query = query.where('collection_orders.status', status);
    }

    // Priority filter
    if (priority && priority !== 'all') {
      query = query.where('collection_orders.priority', priority);
    }

    // Debug: Log the query and results
    // Fix: Update existing records with empty status to 'scheduled'
    const emptyStatusCount = await db('collection_orders')
      .where('status', '')
      .orWhereNull('status')
      .update({ status: 'scheduled' });

    // Search filter
    if (search && search !== 'undefined' && search.trim() !== '') {
      query = query.where(function() {
        this.where('collection_orders.orderNumber', 'like', `%${search}%`)
            .orWhere('contracts.contractNumber', 'like', `%${search}%`)
            .orWhere('suppliers.name', 'like', `%${search}%`);
      });
    }

    // Supplier filter
    if (supplierId) {
      query = query.where('collection_orders.supplierId', supplierId);
    }

    // Contract filter
    if (contractId) {
      query = query.where('collection_orders.contractId', contractId);
    }

    // Get total count for pagination
    const totalQuery = query.clone();
    const [{ total }] = await totalQuery.count('* as total');

    // Get paginated results
    const callouts = await query
      .orderBy('collection_orders.created_at', 'desc')
      .limit(limit)
      .offset(offset);


    auditLog('CALLOUTS_VIEWED', req.user.userId, {
      companyId,
      count: callouts.length,
      filters: { search, priority, supplierId, contractId }
    });

    res.json({
      success: true,
      data: callouts,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(total),
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    logger.error('Error fetching callouts', { 
      error: error.message, 
      userId: req.user.userId,
      companyId: req.user.companyId
    });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch callouts'
    });
  }
});

// PUT /api/collection-orders/:id - Update collection order (callout)
router.put('/:id',
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  validate(calloutSchema),
  requirePermission('EDIT_COLLECTIONS'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      const { materials, ...calloutData } = req.body;

      const result = await db.transaction(async (trx) => {
        // Update collection order
        await trx('collection_orders')
          .where({ id })
          .update({
            contractId: calloutData.contractId,
            supplierId: calloutData.supplierId,
            locationId: calloutData.locationId,
            scheduledDate: calloutData.requestedPickupDate,
            priority: calloutData.priority || 'normal',
            totalValue: calloutData.totalEstimatedValue,
            notes: calloutData.specialInstructions
          });

        // Delete existing items
        await trx('collection_items').where({ collectionOrderId: id }).del();

        // Insert updated materials as collection items
        if (materials && materials.length > 0) {
          const items = materials.map(material => ({
            collectionOrderId: id,
            materialId: material.materialId,
            availableQuantity: material.availableQuantity,
            collectedQuantity: 0,
            unit: material.unit,
            totalValue: material.estimatedValue || 0,
            materialCondition: material.condition || 'good',
            qualityGrade: material.qualityGrade || 'A',
            notes: material.notes || ''
          }));

          await trx('collection_items').insert(items);
        }

        return { id };
      });

      res.json({
        success: true,
        message: 'Callout updated successfully',
        data: result
      });

    } catch (error) {
      console.error('Error updating callout:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update callout'
      });
    }
  }
);

// DELETE /api/collection-orders/:id - Delete collection order (callout)
router.delete('/:id',
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  requirePermission('DELETE_COLLECTIONS'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      const result = await db.transaction(async (trx) => {
        // Check if collection order exists
        const collectionOrder = await trx('collection_orders')
          .where({ id })
          .first();

        if (!collectionOrder) {
          throw new Error('Collection order not found');
        }

        // Only allow deletion if status is 'scheduled' (callout status)
        if (collectionOrder.status !== 'scheduled') {
          throw new Error('Cannot delete collection order that is not in scheduled status');
        }

        // Delete collection items first
        await trx('collection_items').where({ collectionOrderId: id }).del();

        // Delete the collection order
        await trx('collection_orders').where({ id }).del();

        return { id };
      });

      res.json({
        success: true,
        message: 'Callout deleted successfully',
        data: result
      });

    } catch (error) {
      console.error('Error deleting callout:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to delete callout'
      });
    }
  }
);

// PUT /api/collection-orders/:id/driver - Update driver assignment
router.put('/:id/driver', 
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  validate(Joi.object({
    driverName: Joi.string().max(100).required(),
    driverPhone: Joi.string().max(20).allow('').optional(),
    vehiclePlate: Joi.string().max(20).required(),
    vehicleType: Joi.string().valid('truck', 'pickup', 'van', 'trailer').required()
  })),
  requirePermission('EDIT_COLLECTIONS'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { driverName, driverPhone, vehiclePlate, vehicleType } = req.body;
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      // Check if collection order exists and is in appropriate status
      const collectionOrder = await db('collection_orders')
        .where({ id })
        .whereIn('status', ['scheduled', 'in_transit', 'collecting'])
        .first();

      if (!collectionOrder) {
        return res.status(404).json({
          success: false,
          error: 'Collection order not found or not eligible for driver assignment'
        });
      }

      const updateData = {
        driverName,
        vehiclePlate,
        vehicleType,
        updated_at: new Date()
      };

      if (driverPhone) {
        updateData.driverPhone = driverPhone;
      }

      await db('collection_orders')
        .where({ id })
        .update(updateData);

      auditLog('COLLECTION_DRIVER_ASSIGNED', req.user.userId, {
        collectionOrderId: id,
        orderNumber: collectionOrder.orderNumber,
        driverName,
        vehiclePlate,
        vehicleType
      });

      res.json({
        success: true,
        message: 'Driver assigned successfully'
      });

    } catch (error) {
      logger.error('Error assigning driver to collection order', { 
        error: error.message, 
        collectionOrderId: req.params.id,
        userId: req.user.userId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to assign driver'
      });
    }
  }
);

// PUT /api/collection-orders/:id/status - Update collection order status
router.put('/:id/status', 
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  validate(Joi.object({
    status: Joi.string().valid('scheduled', 'in_transit', 'collecting', 'completed', 'cancelled', 'failed').required(),
    status: Joi.string().valid('scheduled', 'in_transit', 'collecting', 'completed', 'cancelled', 'failed').required(),
    notes: Joi.string().allow('').optional(),
    actualCollectionDate: Joi.date().optional(),
    actualQuantity: Joi.number().min(0).precision(3).optional()
  })),
  requirePermission('EDIT_COLLECTIONS'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { status, notes, actualCollectionDate, actualQuantity } = req.body;
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      // Check if collection order exists
      const collectionOrder = await db('collection_orders')
        .where({ id })
        .first();

      if (!collectionOrder) {
        return res.status(404).json({
          success: false,
          error: 'Collection order not found'
        });
      }

      // Fix empty status values before validation
      if (!collectionOrder.status || collectionOrder.status === '') {
        collectionOrder.status = 'scheduled';
        await db('collection_orders').where({ id }).update({ status: 'scheduled' });
      }

      // Allow all status transitions (matching database ENUM)
      const validStatuses = ['scheduled', 'in_transit', 'collecting', 'completed', 'cancelled', 'failed'];
      if (!validStatuses.includes(status)) {
      // Fix empty status values before validation
      if (!collectionOrder.status || collectionOrder.status === '') {
        collectionOrder.status = 'scheduled';
        await db('collection_orders').where({ id }).update({ status: 'scheduled' });
      }

      // Allow all status transitions (matching database ENUM)
      const validStatuses = ['scheduled', 'in_transit', 'collecting', 'completed', 'cancelled', 'failed'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          error: `Invalid status: ${status}`
          error: `Invalid status: ${status}`
        });
      }

      const updateData = {
        status,
        updated_at: new Date()
      };

      // Add optional fields
      if (notes) {
        updateData.notes = notes;
      }

      // Set timestamps based on status
      if (status === 'in_transit' && !collectionOrder.actualStartTime) {
      if (status === 'in_transit' && !collectionOrder.actualStartTime) {
        updateData.actualStartTime = new Date();
      }
      
      if (status === 'completed') {
        updateData.actualEndTime = actualCollectionDate || new Date();
        updateData.completedBy = req.user.userId;


        if (actualQuantity !== undefined) {
          updateData.actualQuantity = actualQuantity;
        }

        // NOTE: Inventory is NOT updated here anymore.
        // Inventory updates happen ONLY during WCN finalization (POST /:id/finalize-wcn)
        // which properly handles:
        // 1. Composite material auto-splitting into components
        // 2. Proper WCN batch number tracking
        // 3. Auto-PO generation for billing
        // This prevents duplicate inventory entries.
        // NOTE: Inventory is NOT updated here anymore.
        // Inventory updates happen ONLY during WCN finalization (POST /:id/finalize-wcn)
        // which properly handles:
        // 1. Composite material auto-splitting into components
        // 2. Proper WCN batch number tracking
        // 3. Auto-PO generation for billing
        // This prevents duplicate inventory entries.
      }

      await db('collection_orders')
        .where({ id })
        .update(updateData);

      auditLog('COLLECTION_STATUS_UPDATED', req.user.userId, {
        collectionOrderId: id,
        orderNumber: collectionOrder.orderNumber,
        oldStatus: collectionOrder.status,
        newStatus: status
      });

      res.json({
        success: true,
        message: 'Collection order status updated successfully'
      });

    } catch (error) {
      logger.error('Error updating collection order status', {
        error: error.message,
      logger.error('Error updating collection order status', {
        error: error.message,
        collectionOrderId: req.params.id,
        userId: req.user.userId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to update collection order status'
      });
    }
  }
);

// PUT /api/collection-orders/:id/driver - Update driver details
router.put('/:id/driver',
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  validate(Joi.object({
    driverName: Joi.string().required(),
    driverPhone: Joi.string().allow('').optional(), // Not in DB but accepted for future
    vehiclePlate: Joi.string().required(),
    vehicleType: Joi.string().valid('truck', 'pickup', 'van', 'trailer').required()
  })),
  requirePermission('EDIT_COLLECTIONS'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { driverName, vehiclePlate, vehicleType } = req.body;
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      // Check if collection order exists
      const collectionOrder = await db('collection_orders')
        .where({ id })
        .first();

      if (!collectionOrder) {
        return res.status(404).json({
          success: false,
          error: 'Collection order not found'
        });
      }

      // Update driver details (driverPhone not in DB schema)
      await db('collection_orders')
        .where({ id })
        .update({
          driverName,
          vehiclePlate,
          vehicleType,
          updated_at: new Date()
        });

      auditLog('DRIVER_ASSIGNED', req.user.userId, {
        collectionOrderId: id,
        orderNumber: collectionOrder.orderNumber,
        driverName,
        vehiclePlate
      });

      res.json({
        success: true,
        message: 'Driver assigned successfully'
      });

    } catch (error) {
      logger.error('Error assigning driver', {
        error: error.message,
        collectionOrderId: req.params.id,
        userId: req.user.userId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to assign driver'
      });
    }
  }
);

// PUT /api/collection-orders/:id/driver - Update driver details
router.put('/:id/driver',
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  validate(Joi.object({
    driverName: Joi.string().required(),
    driverPhone: Joi.string().allow('').optional(), // Not in DB but accepted for future
    vehiclePlate: Joi.string().required(),
    vehicleType: Joi.string().valid('truck', 'pickup', 'van', 'trailer').required()
  })),
  requirePermission('EDIT_COLLECTIONS'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { driverName, vehiclePlate, vehicleType } = req.body;
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      // Check if collection order exists
      const collectionOrder = await db('collection_orders')
        .where({ id })
        .first();

      if (!collectionOrder) {
        return res.status(404).json({
          success: false,
          error: 'Collection order not found'
        });
      }

      // Update driver details (driverPhone not in DB schema)
      await db('collection_orders')
        .where({ id })
        .update({
          driverName,
          vehiclePlate,
          vehicleType,
          updated_at: new Date()
        });

      auditLog('DRIVER_ASSIGNED', req.user.userId, {
        collectionOrderId: id,
        orderNumber: collectionOrder.orderNumber,
        driverName,
        vehiclePlate
      });

      res.json({
        success: true,
        message: 'Driver assigned successfully'
      });

    } catch (error) {
      logger.error('Error assigning driver', {
        error: error.message,
        collectionOrderId: req.params.id,
        userId: req.user.userId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to assign driver'
      });
    }
  }
);

// GET /api/collection-orders - List all collection orders
router.get('/', requirePermission('VIEW_PURCHASE'), async (req, res) => {
  try {
    const { companyId } = req.user;
    const db = getDbConnection(companyId);
    
    const { 
      page = 1, 
      limit = 50, 
      status = '',
      fromDate = '',
      toDate = '',
      supplierId = '',
      contractId = ''
    } = req.query;

    const offset = (page - 1) * limit;
    
    // Check if collection_orders table exists
    const tableExists = await db.schema.hasTable('collection_orders');
    if (!tableExists) {
      return res.json({
        success: true,
        data: [],
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: 0,
          pages: 0
        }
      });
    }

    let query = db('collection_orders')
      .select(
        'collection_orders.*',
        db.raw('NULL as calloutNumber'),
        db.raw('NULL as calloutPriority'),
        db.raw('NULL as contractNumber'),
        db.raw('NULL as supplierName'),
        db.raw('NULL as locationName'),
        db.raw('NULL as locationAddress'),
        db.raw('NULL as createdByName'),
        db.raw('0 as itemCount'),
        db.raw('0 as calculatedValue'),
        db.raw('0 as calculatedExpenses')
      );

    // Status filter
    if (status) {
      query = query.where('collection_orders.status', status);
    }

    // Supplier filter
    if (supplierId) {
      query = query.where('collection_orders.supplierId', supplierId);
    }

    // Contract filter
    if (contractId) {
      query = query.where('collection_orders.contractId', contractId);
    }

    // Date range filter
    if (fromDate) {
      query = query.where('collection_orders.scheduledDate', '>=', fromDate);
    }
    if (toDate) {
      query = query.where('collection_orders.scheduledDate', '<=', toDate);
    }

    // Get total count for pagination
    const totalQuery = query.clone();
    const [{ total }] = await totalQuery.count('* as total');

    // Get paginated results
    const orders = await query
      .orderBy('collection_orders.scheduledDate', 'desc')
      .orderBy('collection_orders.created_at', 'desc')
      .limit(limit)
      .offset(offset);

    auditLog('COLLECTION_ORDERS_VIEWED', req.user.userId, {
      companyId,
      count: orders.length,
      filters: { status, supplierId, contractId, fromDate, toDate }
    });

    res.json({
      success: true,
      data: orders,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(total),
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    logger.error('Error fetching collection orders', { 
      error: error.message, 
      userId: req.user.userId,
      companyId: req.user.companyId
    });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch collection orders'
    });
  }
});

// GET /api/collection-orders/:id - Get specific collection order
router.get('/:id', 
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  requirePermission('VIEW_COLLECTIONS'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      // Get order details
      const order = await db('collection_orders')
        .leftJoin('contracts', 'collection_orders.contractId', 'contracts.id')
        .leftJoin('suppliers', 'collection_orders.supplierId', 'suppliers.id')
        .leftJoin('supplier_locations', 'collection_orders.locationId', 'supplier_locations.id')
        .select(
          'collection_orders.*',
          'collection_orders.orderNumber as calloutNumber',
          'contracts.contractNumber',
          'contracts.title as contractTitle',
          'suppliers.name as supplierName',
          'suppliers.contactPerson as supplierContact',
          'suppliers.phone as supplierPhone',
          'supplier_locations.locationName',
          'supplier_locations.address as locationAddress',
          'supplier_locations.contactPerson as locationContact',
          'supplier_locations.contactPhone as locationPhone'
        )
        .where('collection_orders.id', id)
        .first();

      if (!order) {
        return res.status(404).json({
          success: false,
          error: 'Collection order not found'
        });
      }

      // Get collection items
      const items = await db('collection_items')
        .leftJoin('materials', 'collection_items.materialId', 'materials.id')
        .select(
          'collection_items.*',
          'materials.name as materialName',
          'materials.code as materialCode',
          'materials.unit as materialUnit',
          'materials.category as materialCategory',
          'materials.standardPrice'
        )
        .where('collection_items.collectionOrderId', id)
        .orderBy('materials.name');

      // Get collection expenses
      const expenses = await db('collection_expenses')
        .leftJoin('users as created_users', 'collection_expenses.createdBy', 'created_users.id')
        .leftJoin('users as approved_users', 'collection_expenses.approvedBy', 'approved_users.id')
        .select(
          'collection_expenses.*',
          db.raw('CONCAT(created_users.firstName, " ", created_users.lastName) as createdByName'),
          db.raw('CONCAT(approved_users.firstName, " ", approved_users.lastName) as approvedByName')
        )
        .where('collection_expenses.collectionOrderId', id)
        .orderBy('collection_expenses.expenseDate', 'desc');

      auditLog('COLLECTION_ORDER_VIEWED', req.user.userId, {
        collectionOrderId: id,
        orderNumber: order.orderNumber,
        supplierName: order.supplierName,
        locationName: order.locationName
      });

      res.json({
        success: true,
        data: {
          ...order,
          items,
          expenses
        }
      });

    } catch (error) {
      logger.error('Error fetching collection order', { 
        error: error.message, 
        collectionOrderId: req.params.id,
        userId: req.user.userId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch collection order'
      });
    }
  }
);

// POST /api/collection-orders - Create new collection order from callout
router.post('/', 
  validate(collectionOrderSchema),
  requirePermission('CREATE_PURCHASE'),
  async (req, res) => {
    try {
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      // Validate callout exists and is ready for collection
      const callout = await db('collection_callouts')
        .leftJoin('contracts', 'collection_callouts.contractId', 'contracts.id')
        .leftJoin('suppliers', 'collection_callouts.supplierId', 'suppliers.id')
        .leftJoin('contract_locations', 'collection_callouts.locationId', 'contract_locations.id')
        .select(
          'collection_callouts.*',
          'contracts.contractNumber',
          'suppliers.name as supplierName',
          'contract_locations.locationName'
        )
        .where('collection_callouts.id', req.body.calloutId)
        .whereIn('collection_callouts.status', ['pending', 'scheduled'])
        .first();

      if (!callout) {
        return res.status(400).json({
          success: false,
          error: 'Callout not found or not ready for collection'
        });
      }

      // Check if collection order already exists for this callout
      const existingOrder = await db('collection_orders')
        .where({ calloutId: req.body.calloutId })
        .whereNotIn('status', ['cancelled', 'failed'])
        .first();

      if (existingOrder) {
        return res.status(400).json({
          success: false,
          error: 'Collection order already exists for this callout'
        });
      }

      // Generate order number
      const orderNumber = `CL-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

      const orderData = {
        ...req.body,
        orderNumber,
        contractId: callout.contractId,
        supplierId: callout.supplierId,
        locationId: callout.locationId,
        createdBy: req.user.userId,
        created_at: new Date(),
        updated_at: new Date()
      };

      const [orderId] = await db('collection_orders').insert(orderData);

      // Update callout status to scheduled
      await db('collection_callouts')
        .where({ id: req.body.calloutId })
        .update({
          status: 'scheduled',
          updated_at: new Date()
        });
      
      const newOrder = await db('collection_orders')
        .leftJoin('collection_callouts', 'collection_orders.calloutId', 'collection_callouts.id')
        .leftJoin('contracts', 'collection_orders.contractId', 'contracts.id')
        .leftJoin('suppliers', 'collection_orders.supplierId', 'suppliers.id')
        .leftJoin('contract_locations', 'collection_orders.locationId', 'contract_locations.id')
        .select(
          'collection_orders.*',
          'collection_callouts.calloutNumber',
          'contracts.contractNumber',
          'suppliers.name as supplierName',
          'contract_locations.locationName'
        )
        .where('collection_orders.id', orderId)
        .first();

      auditLog('COLLECTION_ORDER_CREATED', req.user.userId, {
        collectionOrderId: orderId,
        orderNumber: newOrder.orderNumber,
        calloutNumber: newOrder.calloutNumber,
        supplierName: newOrder.supplierName,
        locationName: newOrder.locationName
      });

      logger.info('Collection order created', {
        collectionOrderId: orderId,
        orderNumber: newOrder.orderNumber,
        createdBy: req.user.userId
      });

      res.status(201).json({
        success: true,
        message: 'Collection order created successfully',
        data: newOrder
      });

    } catch (error) {
      logger.error('Error creating collection order', { 
        error: error.message, 
        userId: req.user.userId,
        orderData: req.body
      });
      res.status(500).json({
        success: false,
        error: 'Failed to create collection order'
      });
    }
  }
);

// POST /api/collection-orders/:id/items - Add collected item
router.post('/:id/items',
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  validate(collectionItemSchema),
  requirePermission('EDIT_PURCHASE'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      // Verify order exists and is in progress
      const order = await db('collection_orders')
        .leftJoin('contracts', 'collection_orders.contractId', 'contracts.id')
        .leftJoin('contract_locations', 'collection_orders.locationId', 'contract_locations.id')
        .select(
          'collection_orders.*',
          'contracts.contractNumber',
          'contract_locations.locationName'
        )
        .where('collection_orders.id', id)
        .whereIn('collection_orders.status', ['scheduled', 'in_transit', 'collecting'])
        .first();

      if (!order) {
        return res.status(404).json({
          success: false,
          error: 'Collection order not found or not in progress'
        });
      }

      // Verify material exists
      const material = await db('materials')
        .where({ id: req.body.materialId })
        .first();

      if (!material) {
        return res.status(400).json({
          success: false,
          error: 'Material not found'
        });
      }

      // Get contract location rate for pricing
      const locationRate = await db('contract_location_rates')
        .where({
          contractId: order.contractId,
          locationId: order.locationId,
          materialId: req.body.materialId,
          isActive: true
        })
        .first();

      let contractRate = null;
      let appliedRateType = null;
      let totalValue = 0;

      if (locationRate) {
        contractRate = locationRate.contractRate;
        appliedRateType = locationRate.rateType;

        // Calculate total value based on rate type
        switch (locationRate.rateType) {
          case 'fixed_rate':
            totalValue = req.body.collectedQuantity * locationRate.contractRate;
            break;
          case 'discount_percentage':
            const discountedPrice = material.standardPrice * (1 + locationRate.discountPercentage / 100);
            totalValue = req.body.collectedQuantity * discountedPrice;
            break;
          case 'minimum_price_guarantee':
            const guaranteedPrice = Math.max(material.standardPrice, locationRate.contractRate);
            totalValue = req.body.collectedQuantity * guaranteedPrice;
            break;
          case 'free':
            totalValue = 0;
            break;
          case 'we_pay':
            totalValue = -(req.body.collectedQuantity * Math.abs(locationRate.contractRate)); // Negative for expenses
            break;
          default:
            totalValue = req.body.collectedQuantity * material.standardPrice;
        }

        // Adjust for payment direction
        if (locationRate.paymentDirection === 'we_pay' && locationRate.rateType !== 'we_pay') {
          totalValue = -Math.abs(totalValue); // Negative if we pay
        }
      } else {
        // No contract rate, use standard price
        totalValue = req.body.collectedQuantity * material.standardPrice;
      }

      const itemData = {
        ...req.body,
        collectionOrderId: id,
        contractRate: contractRate,
        appliedRateType: appliedRateType,
        totalValue: parseFloat(totalValue.toFixed(2)),
        created_at: new Date()
      };

      const [itemId] = await db('collection_items').insert(itemData);
      
      // Update order total value
      const orderItems = await db('collection_items')
        .where({ collectionOrderId: id })
        .select(db.raw('SUM(totalValue) as calculatedValue'));

      const newTotalValue = orderItems[0].calculatedValue || 0;

      await db('collection_orders')
        .where({ id })
        .update({
          totalValue: newTotalValue,
          updated_at: new Date()
        });

      const newItem = await db('collection_items')
        .leftJoin('materials', 'collection_items.materialId', 'materials.id')
        .select(
          'collection_items.*',
          'materials.name as materialName',
          'materials.code as materialCode',
          'materials.unit as materialUnit'
        )
        .where('collection_items.id', itemId)
        .first();

      auditLog('COLLECTION_ITEM_ADDED', req.user.userId, {
        collectionOrderId: id,
        itemId,
        materialName: newItem.materialName,
        collectedQuantity: newItem.collectedQuantity,
        totalValue: newItem.totalValue
      });

      res.status(201).json({
        success: true,
        message: 'Collection item added successfully',
        data: newItem
      });

    } catch (error) {
      logger.error('Error adding collection item', { 
        error: error.message, 
        collectionOrderId: req.params.id,
        userId: req.user.userId,
        itemData: req.body
      });
      res.status(500).json({
        success: false,
        error: 'Failed to add collection item'
      });
    }
  }
);

// POST /api/collection-orders/:id/expenses - Add collection expense
router.post('/:id/expenses',
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  validate(collectionExpenseSchema),
  requirePermission('EDIT_PURCHASE'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      // Verify order exists
      const order = await db('collection_orders')
        .where({ id })
        .first();

      if (!order) {
        return res.status(404).json({
          success: false,
          error: 'Collection order not found'
        });
      }

      const expenseData = {
        ...req.body,
        collectionOrderId: id,
        createdBy: req.user.userId,
        created_at: new Date(),
        updated_at: new Date()
      };

      const [expenseId] = await db('collection_expenses').insert(expenseData);

      // Update order total expenses
      const orderExpenses = await db('collection_expenses')
        .where({ collectionOrderId: id })
        .select(db.raw('SUM(amount) as calculatedExpenses'));

      const newTotalExpenses = orderExpenses[0].calculatedExpenses || 0;

      await db('collection_orders')
        .where({ id })
        .update({
          totalExpenses: newTotalExpenses,
          updated_at: new Date()
        });

      const newExpense = await db('collection_expenses')
        .where('id', expenseId)
        .first();

      auditLog('COLLECTION_EXPENSE_ADDED', req.user.userId, {
        collectionOrderId: id,
        expenseId,
        category: newExpense.expenseCategory,
        amount: newExpense.amount,
        description: newExpense.description
      });

      res.status(201).json({
        success: true,
        message: 'Collection expense added successfully',
        data: newExpense
      });

    } catch (error) {
      logger.error('Error adding collection expense', { 
        error: error.message, 
        collectionOrderId: req.params.id,
        userId: req.user.userId,
        expenseData: req.body
      });
      res.status(500).json({
        success: false,
        error: 'Failed to add collection expense'
      });
    }
  }
);

// POST /api/collection-orders/:id/complete - Complete collection order and update inventory
router.post('/:id/complete',
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  validate(Joi.object({
    actualEndTime: Joi.date().optional(),
    notes: Joi.string().allow('').optional()
  })),
  requirePermission('EDIT_PURCHASE'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { actualEndTime, notes } = req.body;
      const { companyId, userId } = req.user;
      const db = getDbConnection(companyId);

      const order = await db('collection_orders')
        .where({ id })
        .whereIn('status', ['scheduled', 'in_transit', 'collecting'])
        .first();

      if (!order) {
        return res.status(404).json({
          success: false,
          error: 'Collection order not found or not ready for completion'
        });
      }

      // Get all collection items
      const items = await db('collection_items')
        .where({ collectionOrderId: id })
        .where('collectedQuantity', '>', 0);

      if (items.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Cannot complete order with no collected items'
        });
      }

      await db.transaction(async (trx) => {
        // Update inventory for each collected item
        for (const item of items) {
          await trx('inventory').insert({
            materialId: item.materialId,
            batchNumber: item.batchNumber || `CL-${order.orderNumber}-${Date.now()}`,
            quantity: item.collectedQuantity,
            reservedQuantity: 0,
            averageCost: item.contractRate || 0,
            lastPurchasePrice: item.contractRate || 0,
            lastPurchaseDate: new Date(),
            location: 'Collection Warehouse',
            condition: item.condition,
            notes: `Collected from ${order.orderNumber}`,
            minimumStockLevel: 0,
            maximumStockLevel: 0,
            isActive: true,
            created_at: new Date(),
            updated_at: new Date()
          });

          // Create transaction record
          await trx('transactions').insert({
            transactionNumber: `COLLECTION-${Date.now()}-${item.id}`,
            transactionType: 'collection',
            referenceId: id,
            referenceType: 'collection_order',
            materialId: item.materialId,
            quantity: item.collectedQuantity,
            amount: item.totalValue,
            transactionDate: new Date(),
            description: `Collection from ${order.orderNumber}`,
            createdBy: userId,
            created_at: new Date(),
            updated_at: new Date()
          });
        }

        // Update collection order status
        await trx('collection_orders')
          .where({ id })
          .update({
            status: 'completed',
            actualEndTime: actualEndTime || new Date(),
            completedBy: userId,
            notes: notes ? `${order.notes || ''}\nCompletion: ${notes}` : order.notes,
            updated_at: new Date()
          });

        // Update callout status
        await trx('collection_callouts')
          .where({ id: order.calloutId })
          .update({
            status: 'completed',
            updated_at: new Date()
          });
      });

      auditLog('COLLECTION_ORDER_COMPLETED', userId, {
        collectionOrderId: id,
        orderNumber: order.orderNumber,
        itemsCollected: items.length,
        totalValue: order.totalValue,
        totalExpenses: order.totalExpenses
      });

      res.json({
        success: true,
        message: 'Collection order completed successfully and inventory updated'
      });

    } catch (error) {
      logger.error('Error completing collection order', { 
        error: error.message, 
        collectionOrderId: req.params.id,
        userId: req.user.userId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to complete collection order'
      });
    }
  }
);

// ============================================================================
// SPRINT 4.5: WCN (Waste Consignment Note) Finalization & Auto-PO Generation
// ============================================================================

// POST /api/collection-orders/:id/finalize-wcn - Finalize WCN and auto-generate PO
router.post('/:id/finalize-wcn',
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  validate(Joi.object({
    wcnDate: Joi.date().optional(),
    notes: Joi.string().allow('').optional(),
    // Support for verified quantities and quality from WCN modal
    items: Joi.array().items(Joi.object({
      id: Joi.number().integer().positive().allow(null).optional(), // Allow null for new items
      materialId: Joi.number().integer().positive().required(),
      verifiedQuantity: Joi.number().min(0).required(),
      originalQuantity: Joi.number().min(0).optional(),
      unit: Joi.string().allow('', null).optional(),
      agreedRate: Joi.number().min(0).allow(null).optional(),
      // NEW: Support for adding materials during WCN finalization
      isNewItem: Joi.boolean().optional(),
      materialName: Joi.string().allow('', null).optional(),
      // Quality verification fields
      expectedQualityGrade: Joi.string().valid('A', 'B', 'C', 'Reject').optional(),
      verifiedQualityGrade: Joi.string().valid('A', 'B', 'C', 'Reject').optional(),
      qualityVerified: Joi.boolean().default(false),
      actualCondition: Joi.string().valid('excellent', 'good', 'fair', 'poor', 'mixed').optional()
    })).optional()
  })),
  requirePermission('EDIT_PURCHASE'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { wcnDate, notes, items: verifiedItems } = req.body;
      const { companyId, userId } = req.user;
      const db = getDbConnection(companyId);

      // Get collection order
      const order = await db('collection_orders')
        .where({ id })
        .where('status', 'completed')  // Must be completed before WCN finalization
        .where('is_finalized', 0)       // Can't finalize twice
        .first();

      if (!order) {
        return res.status(404).json({
          success: false,
          error: 'Collection order not found, not completed, or already finalized'
        });
      }

      // Get collection items
      let items = await db('collection_items')
        .where({ collectionOrderId: id });

      // DEBUG: Log initial items from database
      logger.info('WCN Finalization - Initial DB items', {
        collectionOrderId: id,
        itemCount: items.length,
        items: items.map(i => ({
          id: i.id,
          materialId: i.materialId,
          collectedQuantity: i.collectedQuantity,
          collectedQuantityType: typeof i.collectedQuantity
        }))
      });

      // If verified items were provided, update the quantities
      if (verifiedItems && verifiedItems.length > 0) {
        // DEBUG: Log verified items from frontend
        logger.info('WCN Finalization - Verified items from frontend', {
          collectionOrderId: id,
          verifiedItemsCount: verifiedItems.length,
          verifiedItems: verifiedItems.map(vi => ({
            materialId: vi.materialId,
            materialIdType: typeof vi.materialId,
            verifiedQuantity: vi.verifiedQuantity,
            verifiedQuantityType: typeof vi.verifiedQuantity,
            isNewItem: vi.isNewItem
          }))
        });

        logger.info('Processing verified quantities for WCN finalization', {
          collectionOrderId: id,
          verifiedItemsCount: verifiedItems.length,
          newItemsCount: verifiedItems.filter(vi => vi.isNewItem).length
        });

        // Create a map of verified quantities by materialId
        // IMPORTANT: Use Number() to ensure type consistency (DB returns numbers, JSON may have strings)
        const verifiedMap = new Map();
        verifiedItems.forEach(vi => {
          const materialIdKey = Number(vi.materialId);
          verifiedMap.set(materialIdKey, {
            verifiedQuantity: parseFloat(vi.verifiedQuantity) || 0,
            agreedRate: parseFloat(vi.agreedRate) || 0,
            isNewItem: vi.isNewItem
          });

          logger.debug('WCN verified item mapped', {
            materialId: materialIdKey,
            verifiedQuantity: vi.verifiedQuantity,
            isNewItem: vi.isNewItem
          });
        });

        // DEBUG: Log verifiedMap contents
        logger.info('WCN Finalization - VerifiedMap contents', {
          collectionOrderId: id,
          mapSize: verifiedMap.size,
          entries: Array.from(verifiedMap.entries()).map(([key, val]) => ({
            materialId: key,
            verifiedQuantity: val.verifiedQuantity,
            isNewItem: val.isNewItem
          }))
        });

        // Update existing items with verified quantities
        items = items.map(item => {
          const itemMaterialId = Number(item.materialId);
          const verified = verifiedMap.get(itemMaterialId);

          // DEBUG: Log each item lookup
          logger.info('WCN Finalization - Item lookup', {
            itemId: item.id,
            materialId: itemMaterialId,
            originalCollectedQuantity: item.collectedQuantity,
            availableQuantity: item.availableQuantity,
            estimatedQuantity: item.estimatedQuantity,
            mapLookupResult: verified ? 'FOUND' : 'NOT_FOUND',
            verifiedData: verified || 'N/A',
            willUpdate: verified && !verified.isNewItem ? 'YES' : 'NO'
          });

          if (verified && !verified.isNewItem) {
            logger.info('Applying verified quantity to collection item', {
              materialId: itemMaterialId,
              originalCollectedQuantity: item.collectedQuantity,
              newVerifiedQuantity: verified.verifiedQuantity
            });

            return {
              ...item,
              collectedQuantity: verified.verifiedQuantity,
              contractRate: verified.agreedRate || item.contractRate,
              totalValue: verified.verifiedQuantity * (verified.agreedRate || item.contractRate || 0)
            };
          }

          // FALLBACK: If map lookup failed but item has availableQuantity or estimatedQuantity,
          // use that as the collectedQuantity to ensure PO items have non-zero quantities
          const fallbackQty = parseFloat(item.availableQuantity) || parseFloat(item.estimatedQuantity) || 0;
          if (fallbackQty > 0 && parseFloat(item.collectedQuantity || 0) === 0) {
            logger.warn('WCN Finalization - Using fallback quantity', {
              materialId: itemMaterialId,
              fallbackQty,
              reason: 'Map lookup failed or item not in verifiedItems'
            });
            return {
              ...item,
              collectedQuantity: fallbackQty,
              totalValue: fallbackQty * (parseFloat(item.contractRate) || 0)
            };
          }

          return item;
        });

        // Add new items to the items array (they'll be persisted in the transaction)
        const newItems = verifiedItems.filter(vi => vi.isNewItem);
        for (const newItem of newItems) {
          const qty = parseFloat(newItem.verifiedQuantity) || 0;
          const rate = parseFloat(newItem.agreedRate) || 0;
          items.push({
            materialId: Number(newItem.materialId),
            collectedQuantity: qty,
            contractRate: rate,
            totalValue: qty * rate,
            condition: 'new',
            isNewItem: true  // Flag for tracking
          });
        }
      }

      // FALLBACK: If no verifiedItems were sent, use availableQuantity as collectedQuantity
      if (!verifiedItems || verifiedItems.length === 0) {
        logger.warn('WCN Finalization - No verifiedItems provided, using availableQuantity as fallback');
        items = items.map(item => {
          const fallbackQty = parseFloat(item.availableQuantity) || parseFloat(item.estimatedQuantity) || 0;
          if (fallbackQty > 0 && parseFloat(item.collectedQuantity || 0) === 0) {
            return {
              ...item,
              collectedQuantity: fallbackQty,
              totalValue: fallbackQty * (parseFloat(item.contractRate) || 0)
            };
          }
          return item;
        });
      }

      // Filter to only items with quantity > 0
      items = items.filter(item => (parseFloat(item.collectedQuantity) || 0) > 0);

      // DEBUG: Log items after verification mapping and filtering
      logger.info('WCN Finalization - Items after verification mapping', {
        collectionOrderId: id,
        itemCount: items.length,
        items: items.map(i => ({
          id: i.id,
          materialId: i.materialId,
          collectedQuantity: i.collectedQuantity,
          collectedQuantityType: typeof i.collectedQuantity,
          contractRate: i.contractRate,
          totalValue: i.totalValue,
          isNewItem: i.isNewItem
        }))
      });

      if (items.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Cannot finalize WCN with no collected items (all quantities are zero)'
        });
      }

      // Get contract details for rates
      const contract = order.contractId
        ? await db('contracts').where({ id: order.contractId }).first()
        : null;

      let wcnNumber, purchaseOrderId, poNumber;
      const year = new Date().getFullYear();

      await db.transaction(async (trx) => {
        // 1. Generate WCN number
        const count = await trx('collection_orders')
          .where('wcn_number', 'like', `WCN-${year}-%`)
          .count('* as total')
          .first();

        wcnNumber = `WCN-${year}-${String((count.total || 0) + 1).padStart(4, '0')}`;

        // 1b. Update collection_items with verified quantities (if different from original)
        // Also set original_collected_quantity for tracking rectification baseline
        // NEW: Handle newly added materials during WCN finalization
        if (verifiedItems && verifiedItems.length > 0) {
          // Separate existing items from new items
          const existingItems = verifiedItems.filter(item => !item.isNewItem);
          const newItems = verifiedItems.filter(item => item.isNewItem);

          // Process existing items - update quantities and quality
          for (const verifiedItem of existingItems) {
            // Ensure numeric types for calculations
            const verifiedQty = parseFloat(verifiedItem.verifiedQuantity) || 0;
            const rate = parseFloat(verifiedItem.agreedRate) || 0;
            const totalValue = verifiedQty * rate;
            const materialId = Number(verifiedItem.materialId);

            // Build update object with quantity and quality verification
            const updateData = {
              collectedQuantity: verifiedQty,
              original_collected_quantity: verifiedQty, // Save original WCN qty
              totalValue: totalValue
            };

            // Add quality verification fields if provided
            if (verifiedItem.verifiedQualityGrade) {
              updateData.qualityGrade = verifiedItem.verifiedQualityGrade;
            }
            if (verifiedItem.qualityVerified !== undefined) {
              updateData.qualityVerified = verifiedItem.qualityVerified ? 1 : 0;
            }
            if (verifiedItem.actualCondition) {
              updateData.materialCondition = verifiedItem.actualCondition;
            }

            await trx('collection_items')
              .where({ collectionOrderId: id, materialId: materialId })
              .update(updateData);

            // Log quantity and quality verification for audit trail
            logger.info('WCN quantity and quality verified', {
              collectionOrderId: id,
              materialId: verifiedItem.materialId,
              originalQuantity: verifiedItem.originalQuantity,
              verifiedQuantity: verifiedItem.verifiedQuantity,
              rate: rate,
              expectedQualityGrade: verifiedItem.expectedQualityGrade,
              verifiedQualityGrade: verifiedItem.verifiedQualityGrade,
              qualityVerified: verifiedItem.qualityVerified
            });
          }

          // Process NEW items - create collection_items records (retrospectively update collection order)
          for (const newItem of newItems) {
            // Ensure numeric types
            const newQty = parseFloat(newItem.verifiedQuantity) || 0;
            const rate = parseFloat(newItem.agreedRate) || 0;
            const totalValue = newQty * rate;
            const materialId = Number(newItem.materialId);

            // Create new collection_item record with quality fields
            const [newItemId] = await trx('collection_items').insert({
              collectionOrderId: id,
              materialId: materialId,
              estimatedQuantity: newQty, // Set estimated = collected for new items
              collectedQuantity: newQty,
              original_collected_quantity: newQty,
              contractRate: rate,
              totalValue: totalValue,
              qualityGrade: newItem.verifiedQualityGrade || 'A',
              qualityVerified: newItem.qualityVerified ? 1 : 0,
              materialCondition: newItem.actualCondition || 'good',
              notes: `Added during WCN finalization (${wcnNumber})`,
              created_at: new Date(),
              updated_at: new Date()
            });

            logger.info('New material added during WCN finalization', {
              collectionOrderId: id,
              newItemId,
              materialId: newItem.materialId,
              materialName: newItem.materialName,
              quantity: newItem.verifiedQuantity,
              rate: rate,
              qualityGrade: newItem.verifiedQualityGrade,
              wcnNumber
            });
          }

          // Update callout to include new materials if there are any
          if (newItems.length > 0 && order.calloutId) {
            // Add new materials to the callout as well for complete audit trail
            for (const newItem of newItems) {
              // Check if material already exists in callout_materials
              const existingCalloutMaterial = await trx('callout_materials')
                .where({ calloutId: order.calloutId, materialId: newItem.materialId })
                .first();

              if (!existingCalloutMaterial) {
                await trx('callout_materials').insert({
                  calloutId: order.calloutId,
                  materialId: newItem.materialId,
                  estimatedQuantity: newItem.verifiedQuantity,
                  rate: newItem.agreedRate || 0,
                  notes: `Retrospectively added from WCN finalization (${wcnNumber})`,
                  created_at: new Date(),
                  updated_at: new Date()
                });

                logger.info('Callout updated with new material from WCN', {
                  calloutId: order.calloutId,
                  materialId: newItem.materialId,
                  wcnNumber
                });
              }
            }
          }
        } else {
          // No verified items provided - set original_collected_quantity from current collectedQuantity
          await trx('collection_items')
            .where({ collectionOrderId: id })
            .whereNull('original_collected_quantity')
            .update({
              original_collected_quantity: trx.raw('collectedQuantity')
            });
        }

        // 2. Update inventory for each collected item
        for (const item of items) {
          // Check if material is composite
          const material = await trx('materials').where({ id: item.materialId }).first();

          if (material && material.is_composite) {
            // Get composite breakdown
            const compositions = await trx('material_compositions')
              .where('composite_material_id', item.materialId)
              .where('is_active', 1);

            // Create inventory for each component
            for (const comp of compositions) {
              let componentQuantity;
              if (comp.component_type === 'container') {
                componentQuantity = item.collectedQuantity; // Same as composite quantity
              } else if (comp.component_type === 'content') {
                componentQuantity = item.collectedQuantity; // Actual content quantity
              }

              // Check if batch already exists for component
              const existingCompBatch = await trx('inventory')
                .where({ materialId: comp.component_material_id, batchNumber: `${wcnNumber}-${comp.component_material_id}` })
                .first();

              if (existingCompBatch) {
                await trx('inventory')
                  .where({ id: existingCompBatch.id })
                  .update({
                    quantity: trx.raw('quantity + ?', [componentQuantity]),
                    lastPurchaseDate: new Date(),
                    updated_at: new Date()
                  });
              } else {
                await trx('inventory').insert({
                  materialId: comp.component_material_id,
                  batchNumber: `${wcnNumber}-${comp.component_material_id}`,
                  quantity: componentQuantity,
                  reservedQuantity: 0,
                  averageCost: 0,  // Will be calculated from PO
                  lastPurchasePrice: 0,
                  lastPurchaseDate: new Date(),
                  location: 'Collection Warehouse',
                  condition: item.condition || 'new',
                  notes: `Split from composite (${wcnNumber})`,
                  minimumStockLevel: 0,
                  maximumStockLevel: 0,
                  isActive: 1,  // Use 1 instead of true for MySQL
                  created_at: new Date(),
                  updated_at: new Date()
                });
              }

              // Create transaction for component
              await trx('transactions').insert({
                transactionNumber: `${wcnNumber}-COMP-${comp.component_material_id}`,
                transactionType: 'collection',
                referenceId: id,
                referenceType: 'collection_order',
                materialId: comp.component_material_id,
                quantity: componentQuantity,
                amount: 0,
                transactionDate: new Date(),
                description: `Component from ${wcnNumber}`,
                createdBy: userId,
                created_at: new Date(),
                updated_at: new Date()
              });
            }
          } else {
            // Regular material - add to inventory directly
            // Check if batch already exists (due to unique constraint on materialId + batchNumber)
            const existingBatch = await trx('inventory')
              .where({ materialId: item.materialId, batchNumber: `${wcnNumber}-${item.materialId}` })
              .first();

            if (existingBatch) {
              // Update existing batch quantity instead of inserting
              await trx('inventory')
                .where({ id: existingBatch.id })
                .update({
                  quantity: trx.raw('quantity + ?', [item.collectedQuantity]),
                  lastPurchasePrice: item.contractRate || existingBatch.lastPurchasePrice,
                  lastPurchaseDate: new Date(),
                  updated_at: new Date()
                });

              logger.info('Updated existing inventory batch', {
                batchNumber: `${wcnNumber}-${item.materialId}`,
                addedQuantity: item.collectedQuantity,
                materialId: item.materialId
              });
            } else {
              // Insert new inventory record
              await trx('inventory').insert({
                materialId: item.materialId,
                batchNumber: `${wcnNumber}-${item.materialId}`,
                quantity: item.collectedQuantity,
                reservedQuantity: 0,
                averageCost: item.contractRate || 0,
                lastPurchasePrice: item.contractRate || 0,
                lastPurchaseDate: new Date(),
                location: 'Collection Warehouse',
                condition: item.condition || 'new',
                notes: `Collected via ${wcnNumber}`,
                minimumStockLevel: 0,
                maximumStockLevel: 0,
                isActive: 1,  // Use 1 instead of true for MySQL
                created_at: new Date(),
                updated_at: new Date()
              });

              logger.info('Created new inventory batch', {
                batchNumber: `${wcnNumber}-${item.materialId}`,
                quantity: item.collectedQuantity,
                materialId: item.materialId
              });
            }

            // Create transaction record
            await trx('transactions').insert({
              transactionNumber: `${wcnNumber}-${item.materialId}`,
              transactionType: 'collection',
              referenceId: id,
              referenceType: 'collection_order',
              materialId: item.materialId,
              quantity: item.collectedQuantity,
              amount: item.totalValue || 0,
              transactionDate: new Date(),
              description: `Collection via ${wcnNumber}`,
              createdBy: userId,
              created_at: new Date(),
              updated_at: new Date()
            });
          }
        }

        // 3. AUTO-GENERATE PURCHASE ORDER from WCN
        poNumber = `PO-${year}-${String(Date.now()).slice(-6)}`;

        // Calculate PO totals
        const subtotal = items.reduce((sum, item) => sum + (item.totalValue || 0), 0);
        const taxAmount = subtotal * 0.05;  // 5% tax
        const totalAmount = subtotal + taxAmount;

        const poData = {
          orderNumber: poNumber,
          supplierId: order.supplierId,
          supplierName: order.supplierName || '',
          orderDate: new Date(),
          expectedDeliveryDate: new Date(),  // Already delivered via collection
          actualDeliveryDate: new Date(),
          status: 'received',  // Already received via collection
          subtotal: subtotal,
          taxAmount: taxAmount,
          shippingCost: order.totalExpenses || 0,  // Collection expenses as shipping
          totalAmount: totalAmount + (order.totalExpenses || 0),
          currency: 'OMR',
          terms: 'Payment Terms: As per contract',
          notes: `Auto-generated from ${wcnNumber}. Collection completed ${new Date().toLocaleDateString()}.`,
          source_type: 'wcn_auto',  // NEW: Mark as WCN-generated
          collection_order_id: id,   // NEW: Link to collection order
          createdBy: userId,
          created_at: new Date(),
          updated_at: new Date()
        };

        [purchaseOrderId] = await trx('purchase_orders').insert(poData);

        // 4. Create PO items from collection items
        // DEBUG: Log items before creating PO items
        logger.info('WCN Finalization - Creating PO items', {
          purchaseOrderId,
          itemCount: items.length,
          items: items.map(item => ({
            materialId: item.materialId,
            collectedQuantity: item.collectedQuantity,
            collectedQuantityType: typeof item.collectedQuantity,
            contractRate: item.contractRate,
            totalValue: item.totalValue
          }))
        });

        const poItems = items.map(item => {
          // Use the best available quantity - prioritize collectedQuantity, fallback to availableQuantity or estimatedQuantity
          const qty = parseFloat(item.collectedQuantity) ||
                      parseFloat(item.availableQuantity) ||
                      parseFloat(item.estimatedQuantity) || 0;
          const rate = parseFloat(item.contractRate) || 0;
          const total = parseFloat(item.totalValue) || (qty * rate);

          return {
            purchaseOrderId: purchaseOrderId,
            materialId: item.materialId,
            quantityOrdered: qty,
            quantityReceived: qty,  // Already received
            unitPrice: rate,
            totalPrice: total,
            contractRate: rate || null,
            batchNumber: `${wcnNumber}-${item.materialId}`,
            notes: `From WCN collection`,
            created_at: new Date(),
            updated_at: new Date()
          };
        });

        // DEBUG: Log PO items being inserted with source quantity info
        logger.info('WCN Finalization - PO items to insert', {
          purchaseOrderId,
          poItems: poItems.map((pi, idx) => ({
            materialId: pi.materialId,
            quantityOrdered: pi.quantityOrdered,
            quantityReceived: pi.quantityReceived,
            unitPrice: pi.unitPrice,
            totalPrice: pi.totalPrice,
            sourceCollectedQty: items[idx]?.collectedQuantity,
            sourceAvailableQty: items[idx]?.availableQuantity,
            sourceEstimatedQty: items[idx]?.estimatedQuantity
          }))
        });

        await trx('purchase_order_items').insert(poItems);

        // 5. Update collection order with WCN details
        // Note: is_finalized=1 + purchase_order_id indicates successful finalization
        await trx('collection_orders')
          .where({ id })
          .update({
            wcn_number: wcnNumber,
            wcn_date: wcnDate || new Date(),
            is_finalized: 1,
            finalized_at: new Date(),
            finalized_by: userId,
            purchase_order_id: purchaseOrderId,
            notes: notes ? `${order.notes || ''}\nWCN Finalized: ${notes}` : order.notes
          });

        logger.info('WCN finalization transaction completed', {
          wcnNumber,
          collectionOrderId: id,
          purchaseOrderId,
          inventoryItemsCreated: items.length,
          poItemsCreated: items.length
        });
      });

      // Count new items added during finalization
      const newItemsAdded = items.filter(item => item.isNewItem).length;

      auditLog('WCN_FINALIZED_AND_PO_CREATED', userId, {
        collectionOrderId: id,
        wcnNumber,
        purchaseOrderId,
        itemsCount: items.length,
        newItemsAdded,
        totalValue: order.totalValue,
        autoGeneratedPO: true,
        inventoryUpdated: true
      });

      logger.info('WCN finalized and PO auto-generated', {
        wcnNumber,
        collectionOrderId: id,
        purchaseOrderId,
        itemsCount: items.length,
        newItemsAdded
      });

      // Build appropriate message
      let message = 'WCN finalized successfully. Purchase order auto-generated and inventory updated.';
      if (newItemsAdded > 0) {
        message += ` ${newItemsAdded} new material(s) were added to the collection order.`;
      }

      res.json({
        success: true,
        message,
        data: {
          wcnNumber,
          purchaseOrderId,
          purchaseOrderNumber: poNumber,
          itemsProcessed: items.length,
          newItemsAdded,
          inventoryUpdated: true,
          poCreated: true
        }
      });

    } catch (error) {
      logger.error('Error finalizing WCN', {
        error: error.message,
        stack: error.stack,
        collectionOrderId: req.params.id
      });
      res.status(500).json({
        success: false,
        error: 'Failed to finalize WCN: ' + error.message
      });
    }
  }
);

// POST /api/collection-orders/:id/rectify-wcn - Rectify WCN quantities after finalization
router.post('/:id/rectify-wcn',
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  validate(Joi.object({
    itemAdjustments: Joi.array().items(
      Joi.object({
        itemId: Joi.number().integer().positive().required(),
        newQuantity: Joi.number().min(0).precision(3).required(),
        reason: Joi.string().trim().min(10).max(500).required()
      })
    ).min(1).required(),
    notes: Joi.string().allow('').optional()
  })),
  requirePermission('EDIT_PURCHASE'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { itemAdjustments, notes } = req.body;
      const { companyId, userId } = req.user;
      const db = getDbConnection(companyId);

      // Get finalized collection order
      const order = await db('collection_orders')
        .where({ id })
        .where('is_finalized', 1)
        .first();

      if (!order) {
        return res.status(404).json({
          success: false,
          error: 'Collection order not found or not finalized. Only finalized WCNs can be rectified.'
        });
      }

      const impacts = [];

      await db.transaction(async (trx) => {
        for (const adjustment of itemAdjustments) {
          // Get current item with material info
          const item = await trx('collection_items')
            .leftJoin('materials', 'collection_items.materialId', 'materials.id')
            .select('collection_items.*', 'materials.name as materialName')
            .where({ 'collection_items.id': adjustment.itemId, 'collection_items.collectionOrderId': id })
            .first();

          if (!item) {
            logger.warn('Rectification: Item not found', { itemId: adjustment.itemId, collectionOrderId: id });
            continue;
          }

          // Ensure numeric types (MySQL DECIMAL returns strings)
          const newQty = parseFloat(adjustment.newQuantity) || 0;
          const currentQty = parseFloat(item.collectedQuantity) || 0;
          const quantityDiff = newQty - currentQty;

          logger.info('Processing rectification adjustment', {
            itemId: adjustment.itemId,
            materialId: item.materialId,
            materialName: item.materialName,
            oldQuantity: currentQty,
            newQuantity: newQty,
            quantityDiff,
            wcnNumber: order.wcn_number
          });

          // Get current inventory for this material - use exact batch number
          const expectedBatchNumber = `${order.wcn_number}-${item.materialId}`;
          let inventory = await trx('inventory')
            .where({ materialId: item.materialId, batchNumber: expectedBatchNumber })
            .first();

          // Fallback: try LIKE search if exact match not found
          if (!inventory) {
            inventory = await trx('inventory')
              .where({ materialId: item.materialId })
              .where('batchNumber', 'like', `${order.wcn_number}%`)
              .first();
          }

          if (inventory) {
            const currentStock = parseFloat(inventory.quantity) || 0;
            const newStock = currentStock + quantityDiff;

            logger.info('Updating inventory for rectification', {
              inventoryId: inventory.id,
              batchNumber: inventory.batchNumber,
              currentStock,
              quantityDiff,
              newStock
            });

            impacts.push({
              materialId: item.materialId,
              materialName: item.materialName,
              currentStock,
              adjustment: quantityDiff,
              newStock,
              reason: adjustment.reason
            });

            // Update inventory
            await trx('inventory')
              .where({ id: inventory.id })
              .update({
                quantity: newStock,
                updated_at: new Date()
              });

            // Create adjustment transaction
            await trx('transactions').insert({
              transactionNumber: `WCN-RECTIFY-${Date.now()}-${item.id}`,
              transactionType: 'adjustment',
              referenceId: id,
              referenceType: 'wcn_rectification',
              materialId: item.materialId,
              quantity: quantityDiff,
              amount: 0,
              transactionDate: new Date(),
              description: `WCN ${order.wcn_number} rectification: ${adjustment.reason}`,
              createdBy: userId,
              created_at: new Date(),
              updated_at: new Date()
            });
          } else {
            // Inventory not found - create it if quantity > 0
            logger.warn('Inventory batch not found for rectification, creating new', {
              materialId: item.materialId,
              expectedBatchNumber,
              newQuantity: newQty
            });

            if (newQty > 0) {
              await trx('inventory').insert({
                materialId: item.materialId,
                batchNumber: expectedBatchNumber,
                quantity: newQty,
                reservedQuantity: 0,
                averageCost: parseFloat(item.contractRate) || 0,
                lastPurchasePrice: parseFloat(item.contractRate) || 0,
                lastPurchaseDate: new Date(),
                location: 'Collection Warehouse',
                condition: 'new',
                notes: `Created via WCN rectification (${order.wcn_number})`,
                minimumStockLevel: 0,
                maximumStockLevel: 0,
                isActive: 1,
                created_at: new Date(),
                updated_at: new Date()
              });

              impacts.push({
                materialId: item.materialId,
                materialName: item.materialName,
                currentStock: 0,
                adjustment: newQty,
                newStock: newQty,
                reason: adjustment.reason
              });
            }
          }

          // Update collection item
          await trx('collection_items')
            .where({ id: adjustment.itemId })
            .update({
              collectedQuantity: newQty,
              notes: `${item.notes || ''}\nRectified: ${adjustment.reason}`
            });
        }

        // Update collection order rectification tracking
        // Build detailed rectification log for history display
        const adjustmentDetails = impacts.map(impact =>
          `  • ${impact.materialName || 'Material'}: ${impact.currentStock} → ${impact.newStock} (${impact.adjustment > 0 ? '+' : ''}${impact.adjustment}) - "${impact.reason}"`
        ).join('\n');

        const rectificationEntry = `[${new Date().toISOString()}] Rectification #${(order.rectification_count || 0) + 1}${notes ? ` - ${notes}` : ''}\n${adjustmentDetails}`;

        await trx('collection_orders')
          .where({ id })
          .update({
            rectification_count: (order.rectification_count || 0) + 1,
            rectification_notes: order.rectification_notes
              ? `${order.rectification_notes}\n\n${rectificationEntry}`
              : rectificationEntry,
            updated_at: new Date()
          });

        // === AUTO-SYNC LINKED PURCHASE ORDER ===
        // When WCN is rectified, the linked auto-generated PO must also be updated
        // to maintain data integrity between the source document (WCN) and generated document (PO)
        if (order.purchase_order_id) {
          logger.info('Syncing rectification to linked auto-PO', {
            collectionOrderId: id,
            purchaseOrderId: order.purchase_order_id,
            wcnNumber: order.wcn_number
          });

          // Get purchase order items to update
          const poItems = await trx('purchase_order_items')
            .where({ purchaseOrderId: order.purchase_order_id });

          // For each adjustment, update the corresponding PO item or INSERT if new
          for (const adjustment of itemAdjustments) {
            // Get the collection item to find material ID and rate
            const collectionItem = await trx('collection_items')
              .where({ id: adjustment.itemId })
              .first();

            if (!collectionItem) continue;

            // Ensure numeric type for quantity
            const adjQty = parseFloat(adjustment.newQuantity) || 0;
            const poItemMaterialId = Number(collectionItem.materialId);

            // Find matching PO item by material ID (ensuring numeric comparison)
            const poItem = poItems.find(p => Number(p.materialId) === poItemMaterialId);

            if (poItem) {
              // UPDATE existing PO item
              const poUnitPrice = parseFloat(poItem.unitPrice) || 0;
              await trx('purchase_order_items')
                .where({ id: poItem.id })
                .update({
                  quantityOrdered: adjQty,
                  quantityReceived: adjQty, // Auto-POs are already "received"
                  totalPrice: adjQty * poUnitPrice,
                  updated_at: new Date()
                });

              logger.info('Updated PO item from WCN rectification', {
                poItemId: poItem.id,
                materialId: poItemMaterialId,
                newQuantity: adjQty
              });
            } else if (adjQty > 0) {
              // INSERT new PO item - material was added during rectification
              const unitPrice = parseFloat(collectionItem.contractRate) || 0;
              const totalPrice = adjQty * unitPrice;

              const [newPoItemId] = await trx('purchase_order_items').insert({
                purchaseOrderId: order.purchase_order_id,
                materialId: poItemMaterialId,
                quantityOrdered: adjQty,
                quantityReceived: adjQty, // Auto-POs are already "received"
                unitPrice: unitPrice,
                totalPrice: totalPrice,
                contractRate: unitPrice,
                batchNumber: `${order.wcn_number}-${poItemMaterialId}`,
                notes: `Added via WCN rectification`,
                created_at: new Date(),
                updated_at: new Date()
              });

              logger.info('Created new PO item from WCN rectification', {
                newPoItemId,
                purchaseOrderId: order.purchase_order_id,
                materialId: poItemMaterialId,
                quantity: adjQty,
                unitPrice,
                totalPrice
              });
            }
          }

          // Recalculate PO totals
          const updatedPoItems = await trx('purchase_order_items')
            .where({ purchaseOrderId: order.purchase_order_id });

          const newSubtotal = updatedPoItems.reduce((sum, item) =>
            sum + parseFloat(item.totalPrice || 0), 0
          );

          // Get VAT rate from system settings
          const vatSetting = await trx('system_settings')
            .where({ setting_key: 'vat_rate_percentage' })
            .first();
          const taxPercent = vatSetting ? parseFloat(vatSetting.setting_value) : 5;

          const newTaxAmount = (newSubtotal * taxPercent) / 100;

          // Get current shipping cost
          const currentPO = await trx('purchase_orders')
            .where({ id: order.purchase_order_id })
            .first();
          const shippingCost = parseFloat(currentPO?.shippingCost || 0);

          const newTotalAmount = newSubtotal + newTaxAmount + shippingCost;

          await trx('purchase_orders')
            .where({ id: order.purchase_order_id })
            .update({
              subtotal: newSubtotal,
              taxAmount: newTaxAmount,
              totalAmount: newTotalAmount,
              notes: trx.raw(`CONCAT(IFNULL(notes, ''), '\n[WCN Rectification applied: ${new Date().toISOString()}]')`),
              updated_at: new Date()
            });

          auditLog('PURCHASE_ORDER_AUTO_UPDATED_FROM_WCN_RECTIFICATION', userId, {
            purchaseOrderId: order.purchase_order_id,
            collectionOrderId: id,
            wcnNumber: order.wcn_number,
            newSubtotal,
            newTaxAmount,
            newTotalAmount,
            adjustmentsCount: itemAdjustments.length
          });

          logger.info('Auto-PO synced successfully from WCN rectification', {
            purchaseOrderId: order.purchase_order_id,
            newSubtotal,
            newTotalAmount
          });
        }
      });

      auditLog('WCN_RECTIFIED', userId, {
        collectionOrderId: id,
        wcnNumber: order.wcn_number,
        adjustmentsCount: itemAdjustments.length,
        impacts
      });

      res.json({
        success: true,
        message: order.purchase_order_id
          ? 'WCN rectified successfully. Inventory and linked Purchase Order have been updated.'
          : 'WCN rectified successfully. Inventory has been adjusted.',
        data: {
          wcnNumber: order.wcn_number,
          rectificationCount: (order.rectification_count || 0) + 1,
          inventoryImpacts: impacts,
          purchaseOrderUpdated: !!order.purchase_order_id,
          purchaseOrderId: order.purchase_order_id || null
        }
      });

    } catch (error) {
      logger.error('Error rectifying WCN', {
        error: error.message,
        collectionOrderId: req.params.id
      });
      res.status(500).json({
        success: false,
        error: 'Failed to rectify WCN: ' + error.message
      });
    }
  }
);

module.exports = router;