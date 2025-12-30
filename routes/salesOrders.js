const express = require('express');
const { validate, validateParams, sanitize } = require('../middleware/validation');
const { requirePermission } = require('../middleware/auth');
const { logger, auditLog } = require('../utils/logger');
const { getDbConnection } = require('../config/database');
const { allocateFIFO, previewFIFO, reverseFIFOAllocation } = require('../utils/fifoAllocator');
const Joi = require('joi');

const router = express.Router();

// Apply sanitization to all routes
router.use(sanitize);

// Sales order validation schema
const salesOrderSchema = Joi.object({
  customerId: Joi.number().integer().positive().optional(), // Optional if customer object provided
  orderDate: Joi.date().default(() => new Date()),
  expectedDeliveryDate: Joi.date().optional(),
  deliveryDate: Joi.string().allow('').optional(),
  orderStatus: Joi.string().valid('draft', 'confirmed', 'delivered', 'cancelled').default('draft'),
  subtotal: Joi.number().min(0).precision(3).default(0),
  taxAmount: Joi.number().min(0).precision(3).default(0),
  vatAmount: Joi.number().min(0).precision(3).optional().default(0),
  vatRate: Joi.number().min(0).max(100).optional().default(5),
  totalAmount: Joi.number().min(0).precision(3).default(0),
  netAmount: Joi.number().min(0).precision(3).optional().default(0),
  discountAmount: Joi.number().min(0).precision(3).default(0),
  discountPercent: Joi.number().min(0).max(100).optional().default(0),
  notes: Joi.string().allow('').optional(),
  specialInstructions: Joi.string().allow('').optional(),
  orderNumber: Joi.string().optional(), // Frontend may send this but backend generates it
  branch_id: Joi.number().integer().positive().allow(null).optional(), // Branch ID for multi-branch support
  // Items array for creating order with items in one request
  items: Joi.array().items(Joi.object({
    materialId: Joi.number().integer().positive().required(),
    // For drafts, quantity/rate are optional; for other statuses they're required
    quantity: Joi.number().min(0.001).precision(3).optional().default(0),
    rate: Joi.number().min(0).precision(3).optional().default(0),
    amount: Joi.number().min(0).precision(3).optional().default(0)
  }).options({ stripUnknown: true })).optional(),
  // Additional fields that frontend may send
  status: Joi.string().valid('draft', 'pending', 'confirmed', 'delivered', 'cancelled').optional(),
  customer: Joi.object().unknown(true).optional(), // Frontend sends full customer object
  contractInfo: Joi.object().unknown(true).allow(null).optional(), // Frontend sends contract info
  id: Joi.string().optional(), // Frontend generated ID, ignored by backend
  createdAt: Joi.date().optional(), // Frontend timestamp, ignored by backend
  createdBy: Joi.string().optional() // Frontend user, ignored by backend
}).options({ stripUnknown: true }).custom((value, helpers) => {
  // Extract customerId from customer object if not provided directly
  if (!value.customerId && value.customer && value.customer.id) {
    value.customerId = value.customer.id;
  }

  // Validate customerId is present
  if (!value.customerId) {
    return helpers.error('any.custom', { message: 'Customer ID is required' });
  }

  // If not a draft, require quantity and rate for all items
  const status = value.status || value.orderStatus || 'draft';
  if (status !== 'draft' && value.items && value.items.length > 0) {
    for (const item of value.items) {
      if (!item.quantity || item.quantity <= 0) {
        return helpers.error('any.custom', { message: 'Quantity is required for non-draft orders' });
      }
      if (item.rate === undefined || item.rate === null) {
        return helpers.error('any.custom', { message: 'Rate is required for non-draft orders' });
      }
    }
  }
  return value;
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

/**
 * Convert decimal fields from MySQL strings to numbers
 * MySQL DECIMAL fields are returned as strings by the driver
 * @param {Object|Array} data - Single order object or array of orders
 * @returns {Object|Array} Data with decimal fields converted to numbers
 */
function convertDecimalFields(data) {
  const decimalFields = [
    'subtotal', 'taxAmount', 'discountAmount', 'shippingCost', 'totalAmount',
    'quantity', 'unitPrice', 'totalPrice', 'discountPercentage'
  ];

  const convertObject = (obj) => {
    if (!obj) return obj;
    const converted = { ...obj };
    decimalFields.forEach(field => {
      if (converted[field] !== undefined && converted[field] !== null) {
        converted[field] = parseFloat(converted[field]) || 0;
      }
    });

    // Map database taxAmount to frontend vatAmount for consistency
    if (converted.taxAmount !== undefined) {
      converted.vatAmount = converted.taxAmount;
    }

    // Convert items if present
    if (converted.items && Array.isArray(converted.items)) {
      converted.items = converted.items.map(item => convertObject(item));
    }
    return converted;
  };

  return Array.isArray(data) ? data.map(convertObject) : convertObject(data);
}

// FIFO preview validation schema
const fifoPreviewSchema = Joi.object({
  items: Joi.array().items(Joi.object({
    materialId: Joi.number().integer().positive().required(),
    quantity: Joi.number().min(0.001).precision(3).required(),
    unitPrice: Joi.number().min(0).precision(3).optional() // For gross margin calculation
  })).min(1).required(),
  branchId: Joi.number().integer().positive().optional()
});

// POST /api/sales-orders/preview-fifo - Preview FIFO allocation before confirmation
// Returns batch allocation breakdown, COGS, and gross margin for each item
router.post('/preview-fifo',
  validate(fifoPreviewSchema),
  requirePermission('VIEW_SALES'),
  async (req, res) => {
    try {
      const { companyId } = req.user;
      const db = getDbConnection(companyId);
      const { items, branchId } = req.body;

      logger.debug('FIFO preview requested', {
        userId: req.user.userId,
        companyId,
        itemCount: items.length,
        branchId: branchId || 'none'
      });

      const previews = [];
      let totalCOGS = 0;
      let totalRevenue = 0;
      let allCanFulfill = true;
      const insufficientItems = [];

      for (const item of items) {
        // Ensure materialId is an integer
        const materialId = parseInt(item.materialId, 10);

        // Get material details
        const material = await db('materials')
          .where({ id: materialId })
          .first();

        if (!material) {
          return res.status(400).json({
            success: false,
            error: `Material with ID ${materialId} not found`
          });
        }

        // Preview FIFO allocation for this item
        const preview = await previewFIFO(db, materialId, item.quantity, { branchId });

        logger.debug('FIFO preview result for material', {
          materialId,
          materialName: material.name,
          canFulfill: preview.canFulfill,
          totalAvailable: preview.totalAvailable,
          allocationsCount: preview.allocations?.length || 0
        });

        // Calculate revenue if unit price provided
        const itemRevenue = item.unitPrice ? item.unitPrice * item.quantity : 0;
        const itemGrossMargin = item.unitPrice ? itemRevenue - preview.totalCOGS : null;

        previews.push({
          materialId: materialId,
          materialName: material.name,
          materialCode: material.code,
          unit: material.unit,
          requestedQuantity: item.quantity,
          unitPrice: item.unitPrice || null,
          revenue: parseFloat(itemRevenue.toFixed(3)),
          canFulfill: preview.canFulfill,
          totalAvailable: preview.totalAvailable,
          shortfall: preview.shortfall,
          cogs: preview.totalCOGS,
          grossMargin: itemGrossMargin !== null ? parseFloat(itemGrossMargin.toFixed(3)) : null,
          allocations: preview.allocations.map(alloc => ({
            batchId: alloc.batchId,
            batchNumber: alloc.batchNumber,
            quantity: alloc.quantity,
            unitCost: alloc.unitCost,
            cogs: alloc.cogs,
            purchaseDate: alloc.purchaseDate,
            remainingAfter: alloc.remainingAfter
          }))
        });

        totalCOGS += preview.totalCOGS;
        totalRevenue += itemRevenue;

        if (!preview.canFulfill) {
          allCanFulfill = false;
          insufficientItems.push({
            materialId: item.materialId,
            materialName: material.name,
            requested: item.quantity,
            available: preview.totalAvailable,
            shortfall: preview.shortfall
          });
        }
      }

      const orderGrossMargin = totalRevenue - totalCOGS;

      auditLog('FIFO_PREVIEW_GENERATED', req.user.userId, {
        companyId,
        itemCount: items.length,
        totalCOGS: parseFloat(totalCOGS.toFixed(3)),
        canFulfill: allCanFulfill
      });

      res.json({
        success: true,
        data: {
          canFulfillAll: allCanFulfill,
          items: previews,
          summary: {
            totalCOGS: parseFloat(totalCOGS.toFixed(3)),
            totalRevenue: parseFloat(totalRevenue.toFixed(3)),
            grossMargin: parseFloat(orderGrossMargin.toFixed(3)),
            grossMarginPercent: totalRevenue > 0
              ? parseFloat(((orderGrossMargin / totalRevenue) * 100).toFixed(2))
              : 0
          },
          insufficientItems: insufficientItems.length > 0 ? insufficientItems : null
        }
      });

    } catch (error) {
      logger.error('Error generating FIFO preview', {
        error: error.message,
        userId: req.user.userId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to generate FIFO preview'
      });
    }
  }
);

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
      query = query.where('sales_orders.status', orderStatus);
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

    // Convert decimal fields from strings to numbers
    const convertedOrders = convertDecimalFields(orders);

    auditLog('SALES_ORDERS_VIEWED', req.user.userId, {
      companyId,
      count: convertedOrders.length,
      filters: { search, customerId, orderStatus, fromDate, toDate }
    });

    res.json({
      success: true,
      data: convertedOrders,
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

      // Convert decimal fields from strings to numbers for order and items
      const convertedOrder = convertDecimalFields(order);
      const convertedItems = convertDecimalFields(items);

      // Get batch allocations for each item (FIFO allocations from delivered orders)
      // Only fetch if order is delivered (batch_movements exist for delivered orders)
      const itemsWithAllocations = await Promise.all(
        convertedItems.map(async (item) => {
          // Query batch_movements for this sales order and material
          const batchMovements = await db('batch_movements')
            .join('inventory_batches', 'batch_movements.batch_id', 'inventory_batches.id')
            .where('batch_movements.reference_type', 'sales_order')
            .where('batch_movements.reference_id', id)
            .where('inventory_batches.material_id', item.materialId)
            .where('batch_movements.movement_type', 'sale')
            .select(
              'inventory_batches.batch_number as batchNumber',
              'batch_movements.quantity',
              'inventory_batches.unit_cost as unitCost',
              'inventory_batches.purchase_date as purchaseDate'
            )
            .orderBy('inventory_batches.purchase_date', 'asc');

          // Format batch allocations
          const batchAllocations = batchMovements.map(bm => ({
            batchNumber: bm.batchNumber,
            quantity: Math.abs(parseFloat(bm.quantity) || 0), // quantity is negative for sales, convert to positive
            unitCost: parseFloat(bm.unitCost) || 0,
            purchaseDate: bm.purchaseDate
          }));

          return {
            ...item,
            batchAllocations: batchAllocations.length > 0 ? batchAllocations : null,
            hasBatchAllocation: batchAllocations.length > 0
          };
        })
      );

      auditLog('SALES_ORDER_VIEWED', req.user.userId, {
        salesOrderId: id,
        orderNumber: convertedOrder.orderNumber,
        customerName: convertedOrder.customerName
      });

      res.json({
        success: true,
        data: {
          ...convertedOrder,
          items: itemsWithAllocations
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

      // Extract items and other frontend-only fields
      const {
        items,
        customer: customerObj,
        contractInfo,
        status,
        id,
        createdAt,
        createdBy,
        deliveryDate, // Frontend sends this but DB uses expectedDeliveryDate
        discountPercent, // Frontend field, not in DB
        netAmount, // Frontend field, not in DB
        vatAmount, // Frontend sends this, map to taxAmount
        vatRate, // Frontend sends this, map to taxPercent (if needed)
        specialInstructions, // Check if DB has this column
        ...orderFields
      } = req.body;

      // Map frontend status/orderStatus field to database 'status' column
      const orderData = {
        ...orderFields,
        status: status || orderFields.orderStatus || orderFields.status || 'draft',
        orderNumber,
        createdBy: req.user.userId,
        created_at: new Date(),
        updated_at: new Date()
      };

      // Map vatAmount to taxAmount (database column)
      if (vatAmount !== undefined) {
        orderData.taxAmount = vatAmount;
      }

      // Map deliveryDate to expectedDeliveryDate if provided
      if (deliveryDate) {
        orderData.expectedDeliveryDate = deliveryDate;
      }

      // Remove frontend-only fields that don't exist in DB
      delete orderData.orderStatus;
      delete orderData.vatAmount;
      delete orderData.vatRate;
      delete orderData.netAmount;
      delete orderData.discountPercent;

      const [orderId] = await db('sales_orders').insert(orderData);

      // Insert items if provided
      if (items && items.length > 0) {
        const itemsData = items.map(item => ({
          salesOrderId: orderId,
          materialId: item.materialId,
          quantity: item.quantity || 0,
          unitPrice: item.rate || 0,
          totalPrice: item.amount || (item.quantity * item.rate) || 0,
          created_at: new Date(),
          updated_at: new Date()
        }));
        await db('sales_order_items').insert(itemsData);
      }
      
      const newOrder = await db('sales_orders')
        .leftJoin('customers', 'sales_orders.customerId', 'customers.id')
        .select(
          'sales_orders.*',
          'customers.name as customerName'
        )
        .where('sales_orders.id', orderId)
        .first();

      // Get order items with material details
      const orderItems = await db('sales_order_items')
        .leftJoin('materials', 'sales_order_items.materialId', 'materials.id')
        .select(
          'sales_order_items.*',
          'materials.name as materialName',
          'materials.code as materialCode',
          'materials.unit',
          'materials.category'
        )
        .where('sales_order_items.salesOrderId', orderId)
        .orderBy('sales_order_items.id');

      // Convert decimal fields from strings to numbers
      const convertedOrder = convertDecimalFields(newOrder);
      const convertedItems = convertDecimalFields(orderItems);

      auditLog('SALES_ORDER_CREATED', req.user.userId, {
        salesOrderId: orderId,
        orderNumber: convertedOrder.orderNumber,
        customerName: convertedOrder.customerName,
        totalAmount: convertedOrder.totalAmount
      });

      logger.info('Sales order created', {
        salesOrderId: orderId,
        orderNumber: convertedOrder.orderNumber,
        createdBy: req.user.userId
      });

      res.status(201).json({
        success: true,
        message: 'Sales order created successfully',
        data: {
          ...convertedOrder,
          salesOrderItems: convertedItems
        }
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

// PUT /api/sales-orders/:id - Update existing sales order
router.put('/:id',
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  validate(salesOrderSchema),
  requirePermission('EDIT_SALES'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      // Check if order exists
      const existingOrder = await db('sales_orders')
        .where({ id })
        .first();

      if (!existingOrder) {
        return res.status(404).json({
          success: false,
          error: 'Sales order not found'
        });
      }

      // Extract items and other frontend-only fields
      const {
        items,
        customer: customerObj,
        contractInfo,
        status,
        id: frontendId,
        createdAt,
        createdBy,
        deliveryDate,
        discountPercent,
        netAmount,
        vatAmount,
        vatRate,
        specialInstructions,
        ...orderFields
      } = req.body;

      // Map frontend status/orderStatus field to database 'status' column
      const updateData = {
        ...orderFields,
        status: status || orderFields.orderStatus || existingOrder.status,
        updated_at: new Date()
      };

      // Map vatAmount to taxAmount (database column)
      if (vatAmount !== undefined) {
        updateData.taxAmount = vatAmount;
      }

      // Map deliveryDate to expectedDeliveryDate if provided
      if (deliveryDate) {
        updateData.expectedDeliveryDate = deliveryDate;
      }

      // Remove frontend-only fields that don't exist in DB
      delete updateData.orderStatus;
      delete updateData.vatAmount;
      delete updateData.vatRate;
      delete updateData.netAmount;
      delete updateData.discountPercent;
      // Don't allow changing order number
      delete updateData.orderNumber;

      await db('sales_orders')
        .where({ id })
        .update(updateData);

      // If items provided, update them
      if (items && items.length > 0) {
        // Delete existing items
        await db('sales_order_items').where({ salesOrderId: id }).delete();

        // Insert new items
        const itemsData = items.map(item => ({
          salesOrderId: id,
          materialId: item.materialId,
          quantity: item.quantity || 0,
          unitPrice: item.rate || 0,
          totalPrice: item.amount || (item.quantity * item.rate) || 0,
          created_at: new Date(),
          updated_at: new Date()
        }));
        await db('sales_order_items').insert(itemsData);
      }

      const updatedOrder = await db('sales_orders')
        .leftJoin('customers', 'sales_orders.customerId', 'customers.id')
        .select(
          'sales_orders.*',
          'customers.name as customerName'
        )
        .where('sales_orders.id', id)
        .first();

      // Get order items with material details
      const orderItems = await db('sales_order_items')
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

      // Convert decimal fields from strings to numbers
      const convertedOrder = convertDecimalFields(updatedOrder);
      const convertedItems = convertDecimalFields(orderItems);

      auditLog('SALES_ORDER_UPDATED', req.user.userId, {
        salesOrderId: id,
        orderNumber: convertedOrder.orderNumber,
        customerName: convertedOrder.customerName,
        totalAmount: convertedOrder.totalAmount
      });

      logger.info('Sales order updated', {
        salesOrderId: id,
        orderNumber: convertedOrder.orderNumber,
        updatedBy: req.user.userId
      });

      res.json({
        success: true,
        message: 'Sales order updated successfully',
        data: {
          ...convertedOrder,
          salesOrderItems: convertedItems
        }
      });

    } catch (error) {
      logger.error('Error updating sales order', {
        error: error.message,
        salesOrderId: req.params.id,
        userId: req.user.userId,
        orderData: req.body
      });
      res.status(500).json({
        success: false,
        error: 'Failed to update sales order'
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
        .whereIn('status', ['draft', 'confirmed'])
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
    notes: Joi.string().allow('').optional()
  })),
  requirePermission('EDIT_SALES'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { orderStatus, notes } = req.body;
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
        status: orderStatus, // DB column is 'status', not 'orderStatus'
        updated_at: new Date()
      };

      if (notes !== undefined) {
        updateData.notes = notes;
      }

      await db('sales_orders')
        .where({ id })
        .update(updateData);

      // If order is confirmed, reserve inventory
      // Note: order.status comes from DB (column name is 'status')
      if (orderStatus === 'confirmed' && order.status !== 'confirmed') {
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

      // If order is delivered, reduce actual inventory using FIFO allocation
      if (orderStatus === 'delivered' && order.status !== 'delivered') {
        const items = await db('sales_order_items')
          .where({ salesOrderId: id });

        let totalOrderCOGS = 0;

        await db.transaction(async (trx) => {
          for (const item of items) {
            // FIFO allocation - consume from oldest batches first
            const fifoResult = await allocateFIFO(
              trx,
              item.materialId,
              item.quantity,
              'sale',
              'sales_order',
              id,
              req.user.userId,
              { branchId: order.branchId || null }
            );

            if (!fifoResult.success) {
              // If FIFO allocation fails, throw to rollback transaction
              throw new Error(`FIFO allocation failed for material ${item.materialId}: ${fifoResult.error}`);
            }

            const itemCOGS = fifoResult.totalCOGS;
            totalOrderCOGS += itemCOGS;

            // Also reduce from legacy inventory table for backwards compatibility
            await trx('inventory')
              .where({ materialId: item.materialId })
              .decrement('quantity', item.quantity)
              .decrement('reservedQuantity', item.quantity)
              .update('updated_at', new Date());

            // Update sales_order_items with actual COGS from FIFO
            await trx('sales_order_items')
              .where({ id: item.id })
              .update({
                cogs: itemCOGS,
                updated_at: new Date()
              });

            // Create transaction record with actual COGS
            await trx('transactions').insert({
              transactionNumber: `SALE-${Date.now()}-${item.id}`,
              transactionType: 'sale',
              referenceId: id,
              referenceType: 'sales_order',
              materialId: item.materialId,
              quantity: -item.quantity,
              amount: -item.totalPrice,
              transactionDate: new Date(),
              description: `Sale delivery - Order ${order.orderNumber} | COGS: ${itemCOGS.toFixed(3)} from ${fifoResult.batchesUsed} batch(es)`,
              createdBy: req.user.userId,
              created_at: new Date(),
              updated_at: new Date()
            });

            logger.info('FIFO allocation for sale', {
              salesOrderId: id,
              orderNumber: order.orderNumber,
              materialId: item.materialId,
              quantity: item.quantity,
              cogs: itemCOGS,
              salePrice: item.totalPrice,
              grossMargin: item.totalPrice - itemCOGS,
              batchesUsed: fifoResult.batchesUsed
            });
          }

          // Update sales order with total COGS
          await trx('sales_orders')
            .where({ id })
            .update({
              cogs: totalOrderCOGS,
              updated_at: new Date()
            });
        });

        logger.info('Sales order delivered with FIFO COGS', {
          salesOrderId: id,
          orderNumber: order.orderNumber,
          totalCOGS: totalOrderCOGS,
          totalRevenue: order.totalAmount,
          grossProfit: order.totalAmount - totalOrderCOGS
        });
      }

      // Handle cancellation - reverse inventory operations
      if (orderStatus === 'cancelled' && order.status !== 'cancelled') {
        const items = await db('sales_order_items')
          .where({ salesOrderId: id });

        await db.transaction(async (trx) => {
          // Case 1: Cancelling from confirmed - release reserved quantity
          if (order.status === 'confirmed') {
            for (const item of items) {
              await trx('inventory')
                .where({ materialId: item.materialId })
                .decrement('reservedQuantity', item.quantity)
                .update('updated_at', new Date());
            }

            logger.info('Cancelled confirmed order - reserved inventory released', {
              salesOrderId: id,
              orderNumber: order.orderNumber,
              itemCount: items.length
            });
          }

          // Case 2: Cancelling from delivered - reverse FIFO allocations
          if (order.status === 'delivered') {
            // Reverse FIFO allocations (restores batch quantities)
            const reversalResult = await reverseFIFOAllocation(
              trx,
              'sales_order',
              id,
              req.user.userId
            );

            if (!reversalResult.success) {
              throw new Error(`FIFO reversal failed: ${reversalResult.error}`);
            }

            // Also restore legacy inventory table
            for (const item of items) {
              await trx('inventory')
                .where({ materialId: item.materialId })
                .increment('quantity', item.quantity)
                .update('updated_at', new Date());

              // Create reversal transaction record
              await trx('transactions').insert({
                transactionNumber: `SALE-REV-${Date.now()}-${item.id}`,
                transactionType: 'adjustment',
                referenceId: id,
                referenceType: 'sales_order_cancellation',
                materialId: item.materialId,
                quantity: item.quantity, // Positive for reversal
                amount: item.totalPrice,
                transactionDate: new Date(),
                description: `Sale cancelled - Order ${order.orderNumber} | COGS reversed: ${item.cogs || 0}`,
                createdBy: req.user.userId,
                created_at: new Date(),
                updated_at: new Date()
              });
            }

            // Clear COGS from cancelled order
            await trx('sales_orders')
              .where({ id })
              .update({
                cogs: 0,
                updated_at: new Date()
              });

            await trx('sales_order_items')
              .where({ salesOrderId: id })
              .update({
                cogs: 0,
                updated_at: new Date()
              });

            logger.info('Cancelled delivered order - FIFO reversed', {
              salesOrderId: id,
              orderNumber: order.orderNumber,
              reversedMovements: reversalResult.reversedCount,
              itemCount: items.length
            });
          }
        });
      }

      auditLog('SALES_ORDER_STATUS_UPDATED', req.user.userId, {
        salesOrderId: id,
        oldStatus: order.status,
        newStatus: orderStatus,
        orderNumber: order.orderNumber
      });

      res.json({
        success: true,
        message: 'Sales order status updated successfully',
        data: {
          status: orderStatus,
          paymentStatus: order.paymentStatus
        }
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

// POST /api/sales-orders/:id/invoice - Generate invoice from sales order
router.post('/:id/invoice',
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  requirePermission('CREATE_INVOICES'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { companyId, userId } = req.user;
      const db = getDbConnection(companyId);

      // Get sales order with items
      const order = await db('sales_orders')
        .where({ id })
        .first();

      if (!order) {
        return res.status(404).json({
          success: false,
          error: 'Sales order not found'
        });
      }

      // Only allow invoice generation for confirmed or delivered orders
      if (order.status !== 'confirmed' && order.status !== 'delivered') {
        return res.status(400).json({
          success: false,
          error: 'Invoice can only be generated for confirmed or delivered orders'
        });
      }

      // Get order items
      const items = await db('sales_order_items')
        .select('sales_order_items.*', 'materials.name as materialName', 'materials.unit')
        .leftJoin('materials', 'sales_order_items.materialId', 'materials.id')
        .where({ salesOrderId: id });

      if (items.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Cannot generate invoice for order with no items'
        });
      }

      // Generate invoice number
      const invoiceNumber = `INV-${order.orderNumber}-${Date.now()}`;

      // Create invoice record (stored in sales_orders table with invoice metadata)
      await db('sales_orders')
        .where({ id })
        .update({
          invoiceNumber,
          invoiceGeneratedAt: new Date(),
          invoiceGeneratedBy: userId,
          updated_at: new Date()
        });

      auditLog('SALES_INVOICE_GENERATED', userId, {
        salesOrderId: id,
        orderNumber: order.orderNumber,
        invoiceNumber,
        totalAmount: order.totalAmount
      });

      res.json({
        success: true,
        message: 'Invoice generated successfully',
        data: {
          invoiceNumber,
          orderNumber: order.orderNumber,
          totalAmount: parseFloat(order.totalAmount || 0),
          items: items.map(item => ({
            materialName: item.materialName,
            quantity: parseFloat(item.quantity || 0),
            unitPrice: parseFloat(item.unitPrice || 0),
            totalPrice: parseFloat(item.totalPrice || 0),
            unit: item.unit
          }))
        }
      });

    } catch (error) {
      logger.error('Error generating sales invoice', {
        error: error.message,
        salesOrderId: req.params.id,
        userId: req.user.userId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to generate invoice'
      });
    }
  }
);

module.exports = router;