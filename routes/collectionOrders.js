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
      )
      .where('collection_orders.status', 'scheduled');

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
    status: Joi.string().valid('scheduled', 'in_progress', 'completed', 'cancelled').required(),
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

      // Validate status transitions
      const validTransitions = {
        'scheduled': ['in_progress', 'cancelled'],
        'in_progress': ['completed', 'cancelled'],
        'completed': [], // Cannot transition from completed
        'cancelled': [] // Cannot transition from cancelled
      };

      if (!validTransitions[collectionOrder.status]?.includes(status)) {
        return res.status(400).json({
          success: false,
          error: `Invalid status transition from ${collectionOrder.status} to ${status}`
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
      if (status === 'in_progress' && !collectionOrder.actualStartTime) {
        updateData.actualStartTime = new Date();
      }
      
      if (status === 'completed') {
        updateData.actualEndTime = actualCollectionDate || new Date();
        updateData.completedBy = req.user.userId;
        
        if (actualQuantity !== undefined) {
          updateData.actualQuantity = actualQuantity;
        }

        // Auto-update inventory when collection is completed
        const items = await db('collection_items')
          .where({ collectionOrderId: id })
          .where('collectedQuantity', '>', 0);

        if (items.length > 0) {
          await db.transaction(async (trx) => {
            // Update inventory for each collected item
            for (const item of items) {
              await trx('inventory').insert({
                materialId: item.materialId,
                batchNumber: item.batchNumber || `CL-${collectionOrder.orderNumber}-${Date.now()}`,
                quantity: item.collectedQuantity,
                reservedQuantity: 0,
                averageCost: item.contractRate || 0,
                lastPurchasePrice: item.contractRate || 0,
                lastPurchaseDate: new Date(),
                location: 'Collection Warehouse',
                condition: item.materialCondition || 'good',
                notes: `Collected from ${collectionOrder.orderNumber}`,
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
                description: `Collection from ${collectionOrder.orderNumber}`,
                createdBy: req.user.userId,
                created_at: new Date(),
                updated_at: new Date()
              });
            }
          });

          auditLog('COLLECTION_INVENTORY_UPDATED', req.user.userId, {
            collectionOrderId: id,
            orderNumber: collectionOrder.orderNumber,
            itemsProcessed: items.length
          });
        }
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

module.exports = router;