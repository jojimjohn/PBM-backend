const express = require('express');
const { validate, validateParams, sanitize } = require('../middleware/validation');
const { requirePermission } = require('../middleware/auth');
const { logger, auditLog } = require('../utils/logger');
const { getDbConnection } = require('../config/database');
const Joi = require('joi');

const router = express.Router();

// Apply sanitization to all routes
router.use(sanitize);

// Purchase order validation schema
const purchaseOrderSchema = Joi.object({
  supplierId: Joi.number().integer().positive().required(),
  orderDate: Joi.date().default(() => new Date()),
  expectedDeliveryDate: Joi.date().optional(),
  status: Joi.string().valid('draft', 'pending', 'approved', 'sent', 'received', 'completed', 'cancelled').default('draft'),
  paymentStatus: Joi.string().valid('pending', 'partial', 'paid').default('pending'),
  subtotal: Joi.number().min(0).precision(3).default(0),
  taxAmount: Joi.number().min(0).precision(3).default(0),
  totalAmount: Joi.number().min(0).precision(3).default(0),
  discountAmount: Joi.number().min(0).precision(3).default(0),
  shippingCost: Joi.number().min(0).precision(3).default(0),
  notes: Joi.string().allow('').optional()
});

// Purchase order item validation schema
const purchaseOrderItemSchema = Joi.object({
  purchaseOrderId: Joi.number().integer().positive().required(),
  materialId: Joi.number().integer().positive().required(),
  quantity: Joi.number().min(0.001).precision(3).required(),
  unitPrice: Joi.number().min(0).precision(3).required(),
  totalPrice: Joi.number().min(0).precision(3).required(),
  notes: Joi.string().allow('').optional()
});

// GET /api/purchase-orders - List all purchase orders
router.get('/', requirePermission('VIEW_PURCHASE'), async (req, res) => {
  try {
    const { companyId } = req.user;
    const db = getDbConnection(companyId);
    
    const { 
      page = 1, 
      limit = 50, 
      search = '', 
      supplierId = '',
      status = '',
      paymentStatus = '',
      fromDate = '',
      toDate = ''
    } = req.query;

    const offset = (page - 1) * limit;
    
    let query = db('purchase_orders')
      .leftJoin('suppliers', 'purchase_orders.supplierId', 'suppliers.id')
      .select(
        'purchase_orders.*',
        'suppliers.name as supplierName',
        'suppliers.specialization',
        db.raw('(SELECT COUNT(*) FROM purchase_order_items WHERE purchase_order_items.purchaseOrderId = purchase_orders.id) as itemCount')
      )
      .whereNot('purchase_orders.status', 'cancelled');

    // Search filter
    if (search) {
      query = query.where(function() {
        this.where('purchase_orders.orderNumber', 'like', `%${search}%`)
            .orWhere('suppliers.name', 'like', `%${search}%`)
            .orWhere('purchase_orders.notes', 'like', `%${search}%`);
      });
    }

    // Supplier filter
    if (supplierId) {
      query = query.where('purchase_orders.supplierId', supplierId);
    }

    // Status filter
    if (status) {
      query = query.where('purchase_orders.status', status);
    }

    // Payment status filter
    if (paymentStatus) {
      query = query.where('purchase_orders.paymentStatus', paymentStatus);
    }

    // Date range filter
    if (fromDate) {
      query = query.where('purchase_orders.orderDate', '>=', fromDate);
    }
    if (toDate) {
      query = query.where('purchase_orders.orderDate', '<=', toDate);
    }

    // Get total count for pagination
    const totalQuery = query.clone();
    const [{ total }] = await totalQuery.count('* as total');

    // Get paginated results
    const orders = await query
      .orderBy('purchase_orders.orderDate', 'desc')
      .orderBy('purchase_orders.id', 'desc')
      .limit(limit)
      .offset(offset);

    auditLog('PURCHASE_ORDERS_VIEWED', req.user.userId, {
      companyId,
      count: orders.length,
      filters: { search, supplierId, status, paymentStatus, fromDate, toDate }
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
    logger.error('Error fetching purchase orders', { 
      error: error.message, 
      userId: req.user.userId,
      companyId: req.user.companyId
    });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch purchase orders'
    });
  }
});

// GET /api/purchase-orders/:id - Get specific purchase order with items
router.get('/:id', 
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  requirePermission('VIEW_PURCHASE'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      // Get order details
      const order = await db('purchase_orders')
        .leftJoin('suppliers', 'purchase_orders.supplierId', 'suppliers.id')
        .select(
          'purchase_orders.*',
          'suppliers.name as supplierName',
          'suppliers.specialization',
          'suppliers.phone as supplierPhone',
          'suppliers.address as supplierAddress',
          'suppliers.contactPerson'
        )
        .where('purchase_orders.id', id)
        .first();

      if (!order) {
        return res.status(404).json({
          success: false,
          error: 'Purchase order not found'
        });
      }

      // Get order items
      const items = await db('purchase_order_items')
        .leftJoin('materials', 'purchase_order_items.materialId', 'materials.id')
        .select(
          'purchase_order_items.*',
          'materials.name as materialName',
          'materials.code as materialCode',
          'materials.unit',
          'materials.category'
        )
        .where('purchase_order_items.purchaseOrderId', id)
        .orderBy('purchase_order_items.id');

      auditLog('PURCHASE_ORDER_VIEWED', req.user.userId, {
        purchaseOrderId: id,
        orderNumber: order.orderNumber,
        supplierName: order.supplierName
      });

      res.json({
        success: true,
        data: {
          ...order,
          items
        }
      });

    } catch (error) {
      logger.error('Error fetching purchase order', { 
        error: error.message, 
        purchaseOrderId: req.params.id,
        userId: req.user.userId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch purchase order'
      });
    }
  }
);

// POST /api/purchase-orders - Create new purchase order
router.post('/', 
  validate(purchaseOrderSchema),
  requirePermission('CREATE_PURCHASE'),
  async (req, res) => {
    try {
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      // Validate supplier exists
      const supplier = await db('suppliers')
        .where({ id: req.body.supplierId })
        .first();

      if (!supplier) {
        return res.status(400).json({
          success: false,
          error: 'Supplier not found or inactive'
        });
      }

      // Generate order number
      const orderNumber = `PO-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

      const orderData = {
        ...req.body,
        orderNumber,
        created_at: new Date(),
        updated_at: new Date()
      };

      const [orderId] = await db('purchase_orders').insert(orderData);
      
      const newOrder = await db('purchase_orders')
        .leftJoin('suppliers', 'purchase_orders.supplierId', 'suppliers.id')
        .select(
          'purchase_orders.*',
          'suppliers.name as supplierName'
        )
        .where('purchase_orders.id', orderId)
        .first();

      auditLog('PURCHASE_ORDER_CREATED', req.user.userId, {
        purchaseOrderId: orderId,
        orderNumber: newOrder.orderNumber,
        supplierName: newOrder.supplierName,
        totalAmount: newOrder.totalAmount
      });

      logger.info('Purchase order created', {
        purchaseOrderId: orderId,
        orderNumber: newOrder.orderNumber,
        createdBy: req.user.userId
      });

      res.status(201).json({
        success: true,
        message: 'Purchase order created successfully',
        data: newOrder
      });

    } catch (error) {
      logger.error('Error creating purchase order', { 
        error: error.message, 
        userId: req.user.userId,
        orderData: req.body
      });
      res.status(500).json({
        success: false,
        error: 'Failed to create purchase order'
      });
    }
  }
);

// POST /api/purchase-orders/:id/items - Add item to purchase order
router.post('/:id/items',
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  validate(purchaseOrderItemSchema.fork('purchaseOrderId', schema => schema.optional())),
  requirePermission('CREATE_PURCHASE'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      // Verify order exists and is editable
      const order = await db('purchase_orders')
        .where({ id })
        .whereIn('status', ['draft', 'pending'])
        .first();

      if (!order) {
        return res.status(404).json({
          success: false,
          error: 'Purchase order not found or not editable'
        });
      }

      // Verify material exists
      const material = await db('materials')
        .where({ id: req.body.materialId })
        .first();

      if (!material) {
        return res.status(400).json({
          success: false,
          error: 'Material not found or inactive'
        });
      }

      const itemData = {
        ...req.body,
        purchaseOrderId: id,
        created_at: new Date(),
        updated_at: new Date()
      };

      const [itemId] = await db('purchase_order_items').insert(itemData);
      
      // Update order totals
      const orderItems = await db('purchase_order_items')
        .where({ purchaseOrderId: id })
        .select(db.raw('SUM(totalPrice) as subtotal'));

      const subtotal = orderItems[0].subtotal || 0;
      const taxAmount = subtotal * 0.05; // 5% tax
      const totalAmount = subtotal + taxAmount + (order.shippingCost || 0) - (order.discountAmount || 0);

      await db('purchase_orders')
        .where({ id })
        .update({
          subtotal,
          taxAmount,
          totalAmount,
          updated_at: new Date()
        });

      const newItem = await db('purchase_order_items')
        .leftJoin('materials', 'purchase_order_items.materialId', 'materials.id')
        .select(
          'purchase_order_items.*',
          'materials.name as materialName',
          'materials.code as materialCode'
        )
        .where('purchase_order_items.id', itemId)
        .first();

      auditLog('PURCHASE_ORDER_ITEM_ADDED', req.user.userId, {
        purchaseOrderId: id,
        itemId,
        materialName: newItem.materialName,
        quantity: newItem.quantity,
        totalPrice: newItem.totalPrice
      });

      res.status(201).json({
        success: true,
        message: 'Item added to purchase order successfully',
        data: newItem
      });

    } catch (error) {
      logger.error('Error adding purchase order item', { 
        error: error.message, 
        purchaseOrderId: req.params.id,
        userId: req.user.userId,
        itemData: req.body
      });
      res.status(500).json({
        success: false,
        error: 'Failed to add purchase order item'
      });
    }
  }
);

// PUT /api/purchase-orders/:id/receive - Receive purchase order (update inventory)
router.put('/:id/receive',
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  validate(Joi.object({
    receivedItems: Joi.array().items(
      Joi.object({
        itemId: Joi.number().integer().positive().required(),
        receivedQuantity: Joi.number().min(0).precision(3).required(),
        batchNumber: Joi.string().max(100).allow('').optional(),
        expiryDate: Joi.date().optional(),
        condition: Joi.string().valid('new', 'used', 'refurbished', 'damaged').default('new'),
        location: Joi.string().max(100).allow('').optional()
      })
    ).required(),
    notes: Joi.string().allow('').optional()
  })),
  requirePermission('EDIT_PURCHASE'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { receivedItems, notes } = req.body;
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      const order = await db('purchase_orders')
        .where({ id, status: 'approved' })
        .first();

      if (!order) {
        return res.status(404).json({
          success: false,
          error: 'Purchase order not found or not ready for receiving'
        });
      }

      await db.transaction(async (trx) => {
        for (const receivedItem of receivedItems) {
          // Get the order item details
          const orderItem = await trx('purchase_order_items')
            .where({ id: receivedItem.itemId, purchaseOrderId: id })
            .first();

          if (!orderItem) continue;

          // Add to inventory
          await trx('inventory').insert({
            materialId: orderItem.materialId,
            batchNumber: receivedItem.batchNumber || `PO-${order.orderNumber}-${Date.now()}`,
            quantity: receivedItem.receivedQuantity,
            reservedQuantity: 0,
            averageCost: orderItem.unitPrice,
            lastPurchasePrice: orderItem.unitPrice,
            lastPurchaseDate: new Date(),
            expiryDate: receivedItem.expiryDate,
            location: receivedItem.location || 'Main Warehouse',
            condition: receivedItem.condition,
            notes: `Received from PO ${order.orderNumber}`,
            minimumStockLevel: 0,
            maximumStockLevel: 0,
            isActive: true,
            created_at: new Date(),
            updated_at: new Date()
          });

          // Create transaction record
          await trx('transactions').insert({
            transactionNumber: `PURCHASE-${Date.now()}-${orderItem.id}`,
            transactionType: 'purchase',
            referenceId: id,
            referenceType: 'purchase_order',
            materialId: orderItem.materialId,
            quantity: receivedItem.receivedQuantity,
            amount: receivedItem.receivedQuantity * orderItem.unitPrice,
            transactionDate: new Date(),
            description: `Purchase received - Order ${order.orderNumber}`,
            createdBy: req.user.userId,
            created_at: new Date(),
            updated_at: new Date()
          });
        }

        // Update purchase order status
        await trx('purchase_orders')
          .where({ id })
          .update({
            status: 'received',
            notes: notes ? `${order.notes || ''}\nReceived: ${notes}` : order.notes,
            updated_at: new Date()
          });
      });

      auditLog('PURCHASE_ORDER_RECEIVED', req.user.userId, {
        purchaseOrderId: id,
        orderNumber: order.orderNumber,
        itemsReceived: receivedItems.length
      });

      res.json({
        success: true,
        message: 'Purchase order received successfully and inventory updated'
      });

    } catch (error) {
      logger.error('Error receiving purchase order', { 
        error: error.message, 
        purchaseOrderId: req.params.id,
        userId: req.user.userId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to receive purchase order'
      });
    }
  }
);

// POST /api/purchase-orders/:id/approve - Approve a purchase order
router.post('/:id/approve',
  validateParams(Joi.object({
    id: Joi.number().integer().positive().required()
  })),
  validate(Joi.object({
    approvalNotes: Joi.string().allow('').optional(),
    approvedAmount: Joi.number().min(0).precision(3).optional()
  })),
  requirePermission('APPROVE_PURCHASE'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { approvalNotes, approvedAmount } = req.body;
      const { companyId, userId } = req.user;
      const db = getDbConnection(companyId);

      const order = await db('purchase_orders')
        .where({ id, status: 'draft' })
        .first();

      if (!order) {
        return res.status(404).json({
          success: false,
          error: 'Purchase order not found or not ready for approval'
        });
      }

      await db('purchase_orders')
        .where({ id })
        .update({
          status: 'approved',
          approvedBy: userId,
          approvedAt: new Date(),
          notes: approvalNotes ? `${order.notes || ''}\nApproval: ${approvalNotes}` : order.notes,
          updated_at: new Date()
        });

      auditLog('PURCHASE_ORDER_APPROVED', userId, {
        purchaseOrderId: id,
        orderNumber: order.orderNumber,
        originalAmount: order.totalAmount,
        approvedAmount: approvedAmount || order.totalAmount,
        approvalNotes
      });

      res.json({
        success: true,
        message: 'Purchase order approved successfully'
      });

    } catch (error) {
      logger.error('Error approving purchase order', { 
        error: error.message, 
        purchaseOrderId: req.params.id,
        userId: req.user.userId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to approve purchase order'
      });
    }
  }
);

// PATCH /api/purchase-orders/:id/status - Update purchase order status
router.patch('/:id/status',
  validateParams(Joi.object({
    id: Joi.number().integer().positive().required()
  })),
  validate(Joi.object({
    status: Joi.string().valid('draft', 'pending', 'approved', 'sent', 'received', 'completed', 'cancelled').required(),
    notes: Joi.string().allow('').optional()
  })),
  requirePermission('EDIT_PURCHASE'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { status, notes } = req.body;
      const { companyId, userId } = req.user;
      const db = getDbConnection(companyId);

      const order = await db('purchase_orders')
        .where({ id })
        .first();

      if (!order) {
        return res.status(404).json({
          success: false,
          error: 'Purchase order not found'
        });
      }

      // Validate status transitions
      const validTransitions = {
        'draft': ['pending', 'approved', 'cancelled'],
        'pending': ['approved', 'cancelled'],
        'approved': ['sent', 'cancelled'],
        'sent': ['received', 'cancelled'],
        'received': ['completed'],
        'completed': [], // Final state
        'cancelled': [] // Final state
      };

      if (!validTransitions[order.status]?.includes(status)) {
        return res.status(400).json({
          success: false,
          error: `Cannot change status from ${order.status} to ${status}`
        });
      }

      const updateData = {
        status: status,
        updated_at: new Date()
      };

      if (notes) {
        updateData.notes = order.notes ? `${order.notes}\nStatus Update: ${notes}` : notes;
      }

      // Add status-specific fields
      if (status === 'sent') {
        updateData.sentAt = new Date();
        updateData.sentBy = userId;
      } else if (status === 'cancelled') {
        updateData.cancelledAt = new Date();
        updateData.cancelledBy = userId;
      }

      await db('purchase_orders')
        .where({ id })
        .update(updateData);

      auditLog('PURCHASE_ORDER_STATUS_CHANGED', userId, {
        purchaseOrderId: id,
        orderNumber: order.orderNumber,
        fromStatus: order.status,
        toStatus: status,
        notes
      });

      res.json({
        success: true,
        message: `Purchase order status updated to ${status} successfully`
      });

    } catch (error) {
      logger.error('Error updating purchase order status', { 
        error: error.message, 
        purchaseOrderId: req.params.id,
        userId: req.user.userId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to update purchase order status'
      });
    }
  }
);

// GET /api/purchase-orders/pending - Get pending purchase orders for approval
router.get('/pending', 
  requirePermission('VIEW_PURCHASE'),
  async (req, res) => {
    try {
      const { companyId } = req.user;
      const db = getDbConnection(companyId);
      
      const pendingOrders = await db('purchase_orders')
        .leftJoin('suppliers', 'purchase_orders.supplierId', 'suppliers.id')
        .select(
          'purchase_orders.*',
          'suppliers.name as supplierName',
          'suppliers.contactPerson as supplierContact'
        )
        .where('purchase_orders.status', 'draft')
        .orderBy('purchase_orders.created_at', 'desc');

      res.json({
        success: true,
        data: pendingOrders,
        message: 'Pending purchase orders retrieved successfully'
      });

    } catch (error) {
      logger.error('Error fetching pending purchase orders', { 
        error: error.message, 
        userId: req.user.userId,
        companyId: req.user.companyId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch pending purchase orders'
      });
    }
  }
);

module.exports = router;