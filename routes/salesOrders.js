const express = require('express');
const { validate, validateParams, sanitize } = require('../middleware/validation');
const { requirePermission } = require('../middleware/auth');
const { logger, auditLog } = require('../utils/logger');
const { getDbConnection } = require('../config/database');
const Joi = require('joi');

const router = express.Router();

// Apply sanitization to all routes
router.use(sanitize);

// Sales order validation schema
const salesOrderSchema = Joi.object({
  customerId: Joi.number().integer().positive().required(),
  orderDate: Joi.date().default(() => new Date()),
  expectedDeliveryDate: Joi.date().optional(),
  orderStatus: Joi.string().valid('draft', 'confirmed', 'delivered', 'cancelled').default('draft'),
  paymentStatus: Joi.string().valid('pending', 'partial', 'paid').default('pending'),
  subtotal: Joi.number().min(0).precision(3).default(0),
  taxAmount: Joi.number().min(0).precision(3).default(0),
  totalAmount: Joi.number().min(0).precision(3).default(0),
  discountAmount: Joi.number().min(0).precision(3).default(0),
  notes: Joi.string().allow('').optional(),
});

// Sales order item validation schema
const salesOrderItemSchema = Joi.object({
  salesOrderId: Joi.number().integer().positive().required(),
  materialId: Joi.number().integer().positive().required(),
  quantity: Joi.number().min(0.001).precision(3).required(),
  unitPrice: Joi.number().min(0).precision(3).required(),
  totalPrice: Joi.number().min(0).precision(3).required(),
  notes: Joi.string().allow('').optional()
});

// GET /api/sales-orders - List all sales orders
router.get('/', requirePermission('VIEW_SALES'), async (req, res) => {
  try {
    const { companyId } = req.user;
    const db = getDbConnection(companyId);
    
    const { 
      page = 1, 
      limit = 50, 
      search = '', 
      customerId = '',
      orderStatus = '',
      paymentStatus = '',
      fromDate = '',
      toDate = ''
    } = req.query;

    const offset = (page - 1) * limit;
    
    let query = db('sales_orders')
      .leftJoin('customers', 'sales_orders.customerId', 'customers.id')
      .select(
        'sales_orders.*',
        'customers.name as customerName',
        'customers.customerType',
        db.raw('(SELECT COUNT(*) FROM sales_order_items WHERE sales_order_items.salesOrderId = sales_orders.id) as itemCount')
      )
      ;

    // Search filter
    if (search) {
      query = query.where(function() {
        this.where('sales_orders.orderNumber', 'like', `%${search}%`)
            .orWhere('customers.name', 'like', `%${search}%`)
            .orWhere('sales_orders.notes', 'like', `%${search}%`);
      });
    }

    // Customer filter
    if (customerId) {
      query = query.where('sales_orders.customerId', customerId);
    }

    // Order status filter
    if (orderStatus) {
      query = query.where('sales_orders.orderStatus', orderStatus);
    }

    // Payment status filter
    if (paymentStatus) {
      query = query.where('sales_orders.paymentStatus', paymentStatus);
    }

    // Date range filter
    if (fromDate) {
      query = query.where('sales_orders.orderDate', '>=', fromDate);
    }
    if (toDate) {
      query = query.where('sales_orders.orderDate', '<=', toDate);
    }

    // Get total count for pagination
    const totalQuery = query.clone();
    const [{ total }] = await totalQuery.count('* as total');

    // Get paginated results
    const orders = await query
      .orderBy('sales_orders.orderDate', 'desc')
      .orderBy('sales_orders.id', 'desc')
      .limit(limit)
      .offset(offset);

    auditLog('SALES_ORDERS_VIEWED', req.user.userId, {
      companyId,
      count: orders.length,
      filters: { search, customerId, orderStatus, paymentStatus, fromDate, toDate }
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
    logger.error('Error fetching sales orders', { 
      error: error.message, 
      userId: req.user.userId,
      companyId: req.user.companyId
    });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch sales orders'
    });
  }
});

// GET /api/sales-orders/today-summary - Get today's sales summary
router.get('/today-summary', requirePermission('VIEW_SALES'), async (req, res) => {
  try {
    const { companyId } = req.user;
    const db = getDbConnection(companyId);
    
    // Get today's date range
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);

    // Get today's sales summary
    const summary = await db('sales_orders')
      .select(
        db.raw('COUNT(*) as totalOrders'),
        db.raw('COALESCE(SUM(totalAmount), 0) as totalSales'),
        db.raw('COUNT(CASE WHEN status IN (\'draft\', \'confirmed\') THEN 1 END) as pendingOrders')
      )
      .where('orderDate', '>=', todayStart)
      .where('orderDate', '<', todayEnd)
      .first();

    const result = {
      totalSales: parseFloat(summary.totalSales || 0),
      totalOrders: parseInt(summary.totalOrders || 0),
      pendingOrders: parseInt(summary.pendingOrders || 0)
    };

    auditLog('SALES_SUMMARY_VIEWED', req.user.userId, {
      companyId,
      date: today.toISOString().split('T')[0],
      summary: result
    });

    res.json({
      success: true,
      data: result,
      message: 'Today\'s sales summary retrieved successfully'
    });

  } catch (error) {
    logger.error('Error fetching today\'s sales summary', { 
      error: error.message, 
      userId: req.user.userId,
      companyId: req.user.companyId
    });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch today\'s sales summary'
    });
  }
});

// GET /api/sales-orders/:id - Get specific sales order with items
router.get('/:id', 
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  requirePermission('VIEW_SALES'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      // Get order details
      const order = await db('sales_orders')
        .leftJoin('customers', 'sales_orders.customerId', 'customers.id')
        .select(
          'sales_orders.*',
          'customers.name as customerName',
          'customers.customerType',
          'customers.phone as customerPhone',
          'customers.address as customerAddress'
        )
        .where('sales_orders.id', id)
        .first();

      if (!order) {
        return res.status(404).json({
          success: false,
          error: 'Sales order not found'
        });
      }

      // Get order items
      const items = await db('sales_order_items')
        .leftJoin('materials', 'sales_order_items.materialId', 'materials.id')
        .select(
          'sales_order_items.*',
          'materials.name as materialName',
          'materials.code as materialCode',
          'materials.unit',
          'materials.category'
        )
        .where('sales_order_items.salesOrderId', id)
        .orderBy('sales_order_items.id');

      auditLog('SALES_ORDER_VIEWED', req.user.userId, {
        salesOrderId: id,
        orderNumber: order.orderNumber,
        customerName: order.customerName
      });

      res.json({
        success: true,
        data: {
          ...order,
          items
        }
      });

    } catch (error) {
      logger.error('Error fetching sales order', { 
        error: error.message, 
        salesOrderId: req.params.id,
        userId: req.user.userId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch sales order'
      });
    }
  }
);

// POST /api/sales-orders - Create new sales order
router.post('/', 
  validate(salesOrderSchema),
  requirePermission('CREATE_SALES'),
  async (req, res) => {
    try {
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      // Validate customer exists
      const customer = await db('customers')
        .where({ id: req.body.customerId })
        .first();

      if (!customer) {
        return res.status(400).json({
          success: false,
          error: 'Customer not found or inactive'
        });
      }

      // Generate order number
      const orderNumber = `SO-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

      const orderData = {
        ...req.body,
        orderNumber,
        created_at: new Date(),
        updated_at: new Date()
      };

      const [orderId] = await db('sales_orders').insert(orderData);
      
      const newOrder = await db('sales_orders')
        .leftJoin('customers', 'sales_orders.customerId', 'customers.id')
        .select(
          'sales_orders.*',
          'customers.name as customerName'
        )
        .where('sales_orders.id', orderId)
        .first();

      auditLog('SALES_ORDER_CREATED', req.user.userId, {
        salesOrderId: orderId,
        orderNumber: newOrder.orderNumber,
        customerName: newOrder.customerName,
        totalAmount: newOrder.totalAmount
      });

      logger.info('Sales order created', {
        salesOrderId: orderId,
        orderNumber: newOrder.orderNumber,
        createdBy: req.user.userId
      });

      res.status(201).json({
        success: true,
        message: 'Sales order created successfully',
        data: newOrder
      });

    } catch (error) {
      logger.error('Error creating sales order', { 
        error: error.message, 
        userId: req.user.userId,
        orderData: req.body
      });
      res.status(500).json({
        success: false,
        error: 'Failed to create sales order'
      });
    }
  }
);

// POST /api/sales-orders/:id/items - Add item to sales order
router.post('/:id/items',
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  validate(salesOrderItemSchema.fork('salesOrderId', schema => schema.optional())),
  requirePermission('CREATE_SALES'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      // Verify order exists and is editable
      const order = await db('sales_orders')
        .where({ id })
        .whereIn('orderStatus', ['draft', 'confirmed'])
        .first();

      if (!order) {
        return res.status(404).json({
          success: false,
          error: 'Sales order not found or not editable'
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

      // Check available inventory
      const inventory = await db('inventory')
        .select(db.raw('SUM(quantity - reservedQuantity) as availableQuantity'))
        .where({ materialId: req.body.materialId })
        .first();

      if (inventory.availableQuantity < req.body.quantity) {
        return res.status(400).json({
          success: false,
          error: `Insufficient inventory. Available: ${inventory.availableQuantity} ${material.unit}`
        });
      }

      const itemData = {
        ...req.body,
        salesOrderId: id,
        created_at: new Date(),
        updated_at: new Date()
      };

      const [itemId] = await db('sales_order_items').insert(itemData);
      
      // Update order totals
      const orderItems = await db('sales_order_items')
        .where({ salesOrderId: id })
        .select(db.raw('SUM(totalPrice) as subtotal'));

      const subtotal = orderItems[0].subtotal || 0;
      const taxAmount = subtotal * 0.05; // 5% tax
      const totalAmount = subtotal + taxAmount;

      await db('sales_orders')
        .where({ id })
        .update({
          subtotal,
          taxAmount,
          totalAmount,
          updated_at: new Date()
        });

      const newItem = await db('sales_order_items')
        .leftJoin('materials', 'sales_order_items.materialId', 'materials.id')
        .select(
          'sales_order_items.*',
          'materials.name as materialName',
          'materials.code as materialCode'
        )
        .where('sales_order_items.id', itemId)
        .first();

      auditLog('SALES_ORDER_ITEM_ADDED', req.user.userId, {
        salesOrderId: id,
        itemId,
        materialName: newItem.materialName,
        quantity: newItem.quantity,
        totalPrice: newItem.totalPrice
      });

      res.status(201).json({
        success: true,
        message: 'Item added to sales order successfully',
        data: newItem
      });

    } catch (error) {
      logger.error('Error adding sales order item', { 
        error: error.message, 
        salesOrderId: req.params.id,
        userId: req.user.userId,
        itemData: req.body
      });
      res.status(500).json({
        success: false,
        error: 'Failed to add sales order item'
      });
    }
  }
);

// PUT /api/sales-orders/:id/status - Update order status
router.put('/:id/status',
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  validate(Joi.object({
    orderStatus: Joi.string().valid('draft', 'confirmed', 'delivered', 'cancelled').required(),
    paymentStatus: Joi.string().valid('pending', 'partial', 'paid').optional(),
    notes: Joi.string().allow('').optional()
  })),
  requirePermission('EDIT_SALES'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { orderStatus, paymentStatus, notes } = req.body;
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      const order = await db('sales_orders')
        .where({ id })
        .first();

      if (!order) {
        return res.status(404).json({
          success: false,
          error: 'Sales order not found'
        });
      }

      const updateData = {
        orderStatus,
        updated_at: new Date()
      };

      if (paymentStatus) {
        updateData.paymentStatus = paymentStatus;
      }

      if (notes !== undefined) {
        updateData.notes = notes;
      }

      await db('sales_orders')
        .where({ id })
        .update(updateData);

      // If order is confirmed, reserve inventory
      if (orderStatus === 'confirmed' && order.orderStatus !== 'confirmed') {
        const items = await db('sales_order_items')
          .where({ salesOrderId: id });

        for (const item of items) {
          // Reserve inventory
          await db('inventory')
            .where({ materialId: item.materialId })
            .increment('reservedQuantity', item.quantity)
            .update('updated_at', new Date());
        }
      }

      // If order is delivered, reduce actual inventory
      if (orderStatus === 'delivered' && order.orderStatus !== 'delivered') {
        const items = await db('sales_order_items')
          .where({ salesOrderId: id });

        for (const item of items) {
          await db.transaction(async (trx) => {
            // Reduce inventory
            await trx('inventory')
              .where({ materialId: item.materialId })
              .decrement('quantity', item.quantity)
              .decrement('reservedQuantity', item.quantity)
              .update('updated_at', new Date());

            // Create transaction record
            await trx('transactions').insert({
              transactionNumber: `SALE-${Date.now()}-${item.id}`,
              transactionType: 'sale',
              referenceId: id,
              referenceType: 'sales_order',
              materialId: item.materialId,
              quantity: -item.quantity,
              amount: -item.totalPrice,
              transactionDate: new Date(),
              description: `Sale delivery - Order ${order.orderNumber}`,
              createdBy: req.user.userId,
              created_at: new Date(),
              updated_at: new Date()
            });
          });
        }
      }

      auditLog('SALES_ORDER_STATUS_UPDATED', req.user.userId, {
        salesOrderId: id,
        oldStatus: order.orderStatus,
        newStatus: orderStatus,
        orderNumber: order.orderNumber
      });

      res.json({
        success: true,
        message: 'Sales order status updated successfully',
        data: { orderStatus, paymentStatus }
      });

    } catch (error) {
      logger.error('Error updating sales order status', { 
        error: error.message, 
        salesOrderId: req.params.id,
        userId: req.user.userId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to update sales order status'
      });
    }
  }
);

module.exports = router;