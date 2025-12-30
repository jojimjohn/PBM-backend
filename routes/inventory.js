const express = require('express');
const { validate, validateParams, sanitize } = require('../middleware/validation');
const { requirePermission } = require('../middleware/auth');
const { logger, auditLog } = require('../utils/logger');
const { getDbConnection } = require('../config/database');
const Joi = require('joi');

const router = express.Router();

// Apply sanitization to all routes
router.use(sanitize);

// Inventory validation schema
const inventorySchema = Joi.object({
  materialId: Joi.number().integer().positive().required(),
  batchNumber: Joi.string().max(100).allow('').optional(),
  quantity: Joi.number().min(0).precision(3).required(),
  averageCost: Joi.number().min(0).precision(3).required(),
  lastPurchasePrice: Joi.number().min(0).precision(3).optional(),
  lastPurchaseDate: Joi.date().optional(),
  expiryDate: Joi.date().optional(),
  location: Joi.string().max(100).allow('').optional(),
  condition: Joi.string().valid('new', 'used', 'refurbished', 'damaged').default('new'),
  notes: Joi.string().allow('').optional(),
  minimumStockLevel: Joi.number().min(0).precision(3).default(0),
  maximumStockLevel: Joi.number().min(0).precision(3).default(0),
  isActive: Joi.boolean().default(true)
});

// Stock adjustment schema
const stockAdjustmentSchema = Joi.object({
  adjustmentType: Joi.string().valid('increase', 'decrease', 'set').required(),
  quantity: Joi.number().min(0).precision(3).required(),
  reason: Joi.string().required(),
  notes: Joi.string().allow('').optional()
});

// GET /api/inventory - List all inventory items
router.get('/', requirePermission('VIEW_INVENTORY'), async (req, res) => {
  try {
    const { companyId } = req.user;
    const db = getDbConnection(companyId);
    
    const { 
      page = 1, 
      limit = 50, 
      search = '', 
      category = '',
      condition = '',
      lowStock = '',
      expiringSoon = ''
    } = req.query;

    const offset = (page - 1) * limit;
    
    let query = db('inventory')
      .leftJoin('materials', 'inventory.materialId', 'materials.id')
      .select(
        'inventory.*',
        'materials.name as materialName',
        'materials.code as materialCode',
        'materials.category',
        'materials.unit',
        'materials.standardPrice',
        db.raw('(inventory.quantity - inventory.reservedQuantity) as availableQuantity')
      )
      .where('inventory.isActive', true);

    // Search filter
    if (search) {
      query = query.where(function() {
        this.where('materials.name', 'like', `%${search}%`)
            .orWhere('materials.code', 'like', `%${search}%`)
            .orWhere('inventory.batchNumber', 'like', `%${search}%`)
            .orWhere('inventory.location', 'like', `%${search}%`);
      });
    }

    // Category filter
    if (category) {
      query = query.where('materials.category', category);
    }

    // Condition filter
    if (condition) {
      query = query.where('inventory.condition', condition);
    }

    // Low stock filter
    if (lowStock === 'true') {
      query = query.whereRaw('inventory.quantity <= inventory.minimumStockLevel');
    }

    // Expiring soon filter (next 30 days)
    if (expiringSoon === 'true') {
      const thirtyDaysFromNow = new Date();
      thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
      query = query.where('inventory.expiryDate', '<=', thirtyDaysFromNow)
                   .whereNotNull('inventory.expiryDate');
    }

    // Get total count for pagination
    const totalQuery = query.clone();
    const [{ total }] = await totalQuery.count('* as total');

    // Get paginated results
    const inventory = await query
      .orderBy('materials.category', 'asc')
      .orderBy('materials.name', 'asc')
      .orderBy('inventory.batchNumber', 'asc')
      .limit(limit)
      .offset(offset);

    auditLog('INVENTORY_VIEWED', req.user.userId, {
      companyId,
      count: inventory.length,
      filters: { search, category, condition, lowStock, expiringSoon }
    });

    res.json({
      success: true,
      data: inventory,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(total),
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    logger.error('Error fetching inventory', { 
      error: error.message, 
      userId: req.user.userId,
      companyId: req.user.companyId
    });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch inventory'
    });
  }
});

// GET /api/inventory/summary - Get inventory summary by material
router.get('/summary', requirePermission('VIEW_INVENTORY'), async (req, res) => {
  try {
    const { companyId } = req.user;
    const db = getDbConnection(companyId);

    const summary = await db('materials')
      .leftJoin('inventory', function() {
        this.on('materials.id', 'inventory.materialId')
            .andOn('inventory.isActive', db.raw('?', [true]));
      })
      .select(
        'materials.id',
        'materials.name',
        'materials.code',
        'materials.category',
        'materials.unit',
        'materials.standardPrice',
        db.raw('COALESCE(SUM(inventory.quantity), 0) as totalQuantity'),
        db.raw('COALESCE(SUM(inventory.reservedQuantity), 0) as totalReserved'),
        db.raw('COALESCE(SUM(inventory.quantity - inventory.reservedQuantity), 0) as availableQuantity'),
        db.raw('COALESCE(AVG(inventory.averageCost), 0) as avgCost'),
        db.raw('COALESCE(SUM(inventory.quantity * inventory.averageCost), 0) as totalValue'),
        db.raw('MIN(inventory.minimumStockLevel) as minStockLevel'),
        db.raw('MAX(inventory.maximumStockLevel) as maxStockLevel')
      )
      .where('materials.isActive', true)
      .groupBy('materials.id')
      .orderBy('materials.category')
      .orderBy('materials.name');

    res.json({
      success: true,
      data: summary
    });

  } catch (error) {
    logger.error('Error fetching inventory summary', { 
      error: error.message, 
      userId: req.user.userId
    });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch inventory summary'
    });
  }
});

// GET /api/inventory/alerts - Get inventory alerts (low stock, expiring)
router.get('/alerts', requirePermission('VIEW_INVENTORY'), async (req, res) => {
  try {
    const { companyId } = req.user;
    const db = getDbConnection(companyId);

    // Low stock items
    const lowStockItems = await db('inventory')
      .leftJoin('materials', 'inventory.materialId', 'materials.id')
      .select(
        'inventory.*',
        'materials.name as materialName',
        'materials.code as materialCode',
        'materials.category'
      )
      .whereRaw('inventory.quantity <= inventory.minimumStockLevel')
      .where('inventory.minimumStockLevel', '>', 0)
      .where('inventory.isActive', true)
      .orderBy('materials.name');

    // Expiring items (next 30 days)
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
    
    const expiringItems = await db('inventory')
      .leftJoin('materials', 'inventory.materialId', 'materials.id')
      .select(
        'inventory.*',
        'materials.name as materialName',
        'materials.code as materialCode',
        'materials.category'
      )
      .where('inventory.expiryDate', '<=', thirtyDaysFromNow)
      .whereNotNull('inventory.expiryDate')
      .where('inventory.isActive', true)
      .orderBy('inventory.expiryDate');

    res.json({
      success: true,
      data: {
        lowStockItems,
        expiringItems,
        summary: {
          lowStockCount: lowStockItems.length,
          expiringCount: expiringItems.length
        }
      }
    });

  } catch (error) {
    logger.error('Error fetching inventory alerts', { 
      error: error.message, 
      userId: req.user.userId
    });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch inventory alerts'
    });
  }
});

// GET /api/inventory/material/:materialId/stock - Get current stock for material
router.get('/material/:materialId/stock',
  validateParams(Joi.object({ materialId: Joi.number().integer().positive().required() })),
  requirePermission('VIEW_INVENTORY'),
  async (req, res) => {
    try {
      const { materialId } = req.params;
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      // Get stock summary for the material
      const stockSummary = await db('inventory')
        .leftJoin('materials', 'inventory.materialId', 'materials.id')
        .select(
          'materials.id as materialId',
          'materials.name as materialName',
          'materials.code as materialCode',
          'materials.category',
          'materials.unit',
          'materials.standardPrice',
          db.raw('COALESCE(SUM(inventory.quantity), 0) as totalQuantity'),
          db.raw('COALESCE(SUM(inventory.reservedQuantity), 0) as reservedQuantity'),
          db.raw('COALESCE(SUM(inventory.quantity - inventory.reservedQuantity), 0) as availableQuantity'),
          db.raw('COALESCE(AVG(inventory.averageCost), 0) as averageCost'),
          db.raw('COALESCE(SUM(inventory.quantity * inventory.averageCost), 0) as totalValue'),
          db.raw('MIN(inventory.minimumStockLevel) as minimumStockLevel'),
          db.raw('MAX(inventory.maximumStockLevel) as maximumStockLevel')
        )
        .where('materials.id', materialId)
        .where('materials.isActive', true)
        .where('inventory.isActive', true)
        .groupBy('materials.id')
        .first();

      if (!stockSummary || !stockSummary.materialId) {
        // Material exists but no inventory entries
        const material = await db('materials')
          .where({ id: materialId, isActive: true })
          .first();

        if (!material) {
          return res.status(404).json({
            success: false,
            error: 'Material not found'
          });
        }

        // Return zero stock for material with no inventory
        return res.json({
          success: true,
          data: {
            materialId: material.id,
            materialName: material.name,
            materialCode: material.code,
            category: material.category,
            unit: material.unit,
            standardPrice: parseFloat(material.standardPrice || 0),
            totalQuantity: 0,
            reservedQuantity: 0,
            availableQuantity: 0,
            averageCost: 0,
            totalValue: 0,
            minimumStockLevel: 0,
            maximumStockLevel: 0,
            stockStatus: 'out-of-stock'
          }
        });
      }

      // Determine stock status
      let stockStatus = 'in-stock';
      if (stockSummary.availableQuantity <= 0) {
        stockStatus = 'out-of-stock';
      } else if (stockSummary.availableQuantity <= (stockSummary.minimumStockLevel || 0)) {
        stockStatus = 'low-stock';
      }

      const result = {
        materialId: parseInt(stockSummary.materialId),
        materialName: stockSummary.materialName,
        materialCode: stockSummary.materialCode,
        category: stockSummary.category,
        unit: stockSummary.unit,
        standardPrice: parseFloat(stockSummary.standardPrice || 0),
        totalQuantity: parseFloat(stockSummary.totalQuantity || 0),
        reservedQuantity: parseFloat(stockSummary.reservedQuantity || 0),
        availableQuantity: parseFloat(stockSummary.availableQuantity || 0),
        averageCost: parseFloat(stockSummary.averageCost || 0),
        totalValue: parseFloat(stockSummary.totalValue || 0),
        minimumStockLevel: parseFloat(stockSummary.minimumStockLevel || 0),
        maximumStockLevel: parseFloat(stockSummary.maximumStockLevel || 0),
        stockStatus
      };

      auditLog('MATERIAL_STOCK_VIEWED', req.user.userId, {
        materialId,
        materialName: stockSummary.materialName,
        availableQuantity: result.availableQuantity
      });

      res.json({
        success: true,
        data: result
      });

    } catch (error) {
      logger.error('Error fetching material stock', { 
        error: error.message, 
        materialId: req.params.materialId,
        userId: req.user.userId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch material stock'
      });
    }
  }
);

// GET /api/inventory/batch-stock/:materialId - Get stock from inventory_batches (FIFO source)
// This endpoint provides accurate real-time stock for sales order forms
router.get('/batch-stock/:materialId',
  validateParams(Joi.object({ materialId: Joi.number().integer().positive().required() })),
  requirePermission('VIEW_INVENTORY'),
  async (req, res) => {
    try {
      const { materialId } = req.params;
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      // Get material details
      const material = await db('materials')
        .where({ id: materialId, isActive: true })
        .first();

      if (!material) {
        return res.status(404).json({
          success: false,
          error: 'Material not found'
        });
      }

      // Get available stock from inventory_batches (excludes depleted batches)
      const batchStock = await db('inventory_batches')
        .select(
          db.raw('SUM(remaining_quantity) as totalRemaining'),
          db.raw('COUNT(CASE WHEN is_depleted = false THEN 1 END) as activeBatchCount'),
          db.raw('MIN(purchase_date) as oldestBatchDate'),
          db.raw('AVG(unit_cost) as weightedAvgCost')
        )
        .where({ material_id: materialId, is_depleted: false })
        .first();

      // Get reserved quantity from inventory table for this material
      const inventoryReserved = await db('inventory')
        .select(db.raw('COALESCE(SUM(reservedQuantity), 0) as totalReserved'))
        .where({ materialId, isActive: true })
        .first();

      const totalRemaining = parseFloat(batchStock?.totalRemaining || 0);
      const reservedQuantity = parseFloat(inventoryReserved?.totalReserved || 0);
      const availableQuantity = Math.max(0, totalRemaining - reservedQuantity);

      // Determine stock status
      let stockStatus = 'in-stock';
      if (availableQuantity <= 0) {
        stockStatus = 'out-of-stock';
      } else if (availableQuantity <= 10) { // Low stock threshold
        stockStatus = 'low-stock';
      }

      const result = {
        materialId: parseInt(materialId),
        materialName: material.name,
        materialCode: material.code,
        category: material.category,
        unit: material.unit,
        standardPrice: parseFloat(material.standardPrice || 0),
        totalRemaining: totalRemaining,
        reservedQuantity: reservedQuantity,
        availableQuantity: availableQuantity,
        activeBatchCount: parseInt(batchStock?.activeBatchCount || 0),
        oldestBatchDate: batchStock?.oldestBatchDate || null,
        weightedAvgCost: parseFloat(batchStock?.weightedAvgCost || 0),
        stockStatus,
        source: 'inventory_batches' // Indicates this is from FIFO batch system
      };

      auditLog('BATCH_STOCK_VIEWED', req.user.userId, {
        materialId,
        materialName: material.name,
        availableQuantity: result.availableQuantity
      });

      res.json({
        success: true,
        data: result
      });

    } catch (error) {
      logger.error('Error fetching batch stock', {
        error: error.message,
        materialId: req.params.materialId,
        userId: req.user.userId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch batch stock'
      });
    }
  }
);

// GET /api/inventory/movements - Get stock movements timeline
router.get('/movements', requirePermission('VIEW_INVENTORY'), async (req, res) => {
  try {
    const { companyId } = req.user;
    const db = getDbConnection(companyId);

    logger.info('Stock movements request', { companyId, query: req.query });

    const {
      page = 1,
      limit = 50,
      startDate,
      endDate,
      materialId,
      type, // 'receipt', 'sale', 'adjustment', 'wastage', 'transfer'
      batchId
    } = req.query;

    const offset = (page - 1) * limit;

    // Build query for batch movements with full traceability
    let query = db('batch_movements')
      .join('inventory_batches', 'batch_movements.batch_id', 'inventory_batches.id')
      .join('materials', 'inventory_batches.material_id', 'materials.id')
      .leftJoin('suppliers', 'inventory_batches.supplier_id', 'suppliers.id')
      .leftJoin('users', 'batch_movements.created_by', 'users.id')
      .leftJoin('purchase_orders', 'inventory_batches.purchase_order_id', 'purchase_orders.id')
      .leftJoin('collection_orders', 'purchase_orders.collection_order_id', 'collection_orders.id')
      .select(
        'batch_movements.id',
        'batch_movements.batch_id as batchId',
        'batch_movements.movement_type as movementType',
        'batch_movements.quantity',
        'batch_movements.reference_type as referenceType',
        'batch_movements.reference_id as referenceId',
        'batch_movements.movement_date as movementDate',
        'batch_movements.notes',
        'batch_movements.created_at as createdAt',
        'inventory_batches.batch_number as batchNumber',
        'inventory_batches.material_id as materialId',
        'inventory_batches.unit_cost as unitCost',
        'materials.name as materialName',
        'materials.unit as materialUnit',
        'materials.category as materialCategory',
        'suppliers.name as supplierName',
        'users.firstName as createdByFirstName',
        'users.lastName as createdByLastName',
        // Traceability fields
        'purchase_orders.orderNumber as purchaseOrderNumber',
        'purchase_orders.source_type as purchaseOrderSourceType',
        'collection_orders.orderNumber as collectionOrderNumber',
        'collection_orders.wcn_number as wcnNumber'
      );

    // Filter by date range
    if (startDate) {
      query = query.where('batch_movements.movement_date', '>=', startDate);
    }
    if (endDate) {
      query = query.where('batch_movements.movement_date', '<=', endDate);
    }

    // Filter by material
    if (materialId) {
      query = query.where('inventory_batches.material_id', materialId);
    }

    // Filter by movement type
    if (type) {
      query = query.where('batch_movements.movement_type', type);
    }

    // Filter by batch
    if (batchId) {
      query = query.where('batch_movements.batch_id', batchId);
    }

    // Get total count
    const totalQuery = query.clone();
    const [{ total }] = await totalQuery.count('* as total');

    // Get paginated results (reverse chronological for timeline)
    const movements = await query
      .orderBy('batch_movements.movement_date', 'desc')
      .orderBy('batch_movements.created_at', 'desc')
      .limit(parseInt(limit))
      .offset(offset);

    // Format movements with reference numbers
    const formattedMovements = await Promise.all(
      movements.map(async (m) => {
        // Get reference number based on reference type
        let referenceNumber = null;
        if (m.referenceType && m.referenceId) {
          switch (m.referenceType) {
            case 'sales_order':
              const so = await db('sales_orders').where({ id: m.referenceId }).select('orderNumber').first();
              referenceNumber = so?.orderNumber || null;
              break;
            case 'purchase_order':
              referenceNumber = m.purchaseOrderNumber;
              break;
            case 'wastage':
              const w = await db('wastages').where({ id: m.referenceId }).select('id').first();
              referenceNumber = w ? `WAS-${w.id}` : null;
              break;
            case 'manual_adjustment':
              referenceNumber = `ADJ-${m.referenceId || m.id}`;
              break;
            case 'branch_transfer_out':
            case 'branch_transfer_in':
              referenceNumber = `TRF-${m.referenceId}`;
              break;
          }
        }

        // Convert Date to ISO string for frontend compatibility
        const movementDateStr = m.movementDate instanceof Date
          ? m.movementDate.toISOString()
          : m.movementDate;

        return {
          id: m.id,
          movementDate: movementDateStr,
          movementType: m.movementType,
          quantity: parseFloat(m.quantity) || 0,
          materialId: m.materialId,
          materialName: m.materialName,
          materialUnit: m.materialUnit,
          materialCategory: m.materialCategory,
          batchId: m.batchId,
          batchNumber: m.batchNumber,
          unitCost: parseFloat(m.unitCost) || 0,
          referenceType: m.referenceType,
          referenceId: m.referenceId,
          referenceNumber,
          notes: m.notes,
          supplierName: m.supplierName,
          createdByName: `${m.createdByFirstName || ''} ${m.createdByLastName || ''}`.trim(),
          createdAt: m.createdAt,
          // Traceability (for receipt movements)
          traceability: m.movementType === 'receipt' ? {
            collectionOrderNumber: m.collectionOrderNumber || null,
            wcnNumber: m.wcnNumber || null,
            purchaseOrderNumber: m.purchaseOrderNumber || null,
            sourceType: m.purchaseOrderSourceType || 'manual',
            isManualReceipt: !m.collectionOrderNumber
          } : null
        };
      })
    );

    // Group movements by date for timeline display
    const groupedByDate = {};
    formattedMovements.forEach(m => {
      // Handle both Date objects and ISO strings
      let dateKey = 'unknown';
      if (m.movementDate) {
        if (m.movementDate instanceof Date) {
          dateKey = m.movementDate.toISOString().split('T')[0];
        } else if (typeof m.movementDate === 'string') {
          dateKey = m.movementDate.split('T')[0];
        }
      }
      if (!groupedByDate[dateKey]) {
        groupedByDate[dateKey] = [];
      }
      groupedByDate[dateKey].push(m);
    });

    logger.info('Sending stock movements response', {
      movementsCount: formattedMovements.length,
      total,
      page,
      groupCount: Object.keys(groupedByDate).length
    });

    res.json({
      success: true,
      data: {
        movements: formattedMovements,
        groupedByDate,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: parseInt(total),
          pages: Math.ceil(total / limit),
          hasMore: offset + movements.length < total
        }
      }
    });

  } catch (error) {
    logger.error('Error fetching stock movements timeline', {
      error: error.message,
      userId: req.user.userId
    });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch stock movements'
    });
  }
});

// GET /api/inventory/batch-movements - Get stock movements history for View History modal
// This endpoint provides a simplified view of batch movements for material history display
router.get('/batch-movements', requirePermission('VIEW_INVENTORY'), async (req, res) => {
  try {
    const { companyId } = req.user;
    const db = getDbConnection(companyId);

    const {
      materialId,
      limit = 50,
      page = 1,
      startDate,
      endDate
    } = req.query;

    if (!materialId) {
      return res.status(400).json({
        success: false,
        error: 'materialId is required'
      });
    }

    const offset = (parseInt(page) - 1) * parseInt(limit);

    // Build query for batch movements
    let query = db('batch_movements')
      .join('inventory_batches', 'batch_movements.batch_id', 'inventory_batches.id')
      .join('materials', 'inventory_batches.material_id', 'materials.id')
      .leftJoin('suppliers', 'inventory_batches.supplier_id', 'suppliers.id')
      .leftJoin('users', 'batch_movements.created_by', 'users.id')
      .select(
        'batch_movements.id',
        'batch_movements.batch_id as batchId',
        'batch_movements.movement_type as movementType',
        'batch_movements.quantity',
        'batch_movements.reference_type as referenceType',
        'batch_movements.reference_id as referenceId',
        'batch_movements.movement_date as movementDate',
        'batch_movements.notes',
        'batch_movements.created_at as createdAt',
        'inventory_batches.batch_number as batchNumber',
        'inventory_batches.unit_cost as unitCost',
        'materials.name as materialName',
        'materials.code as materialCode',
        'materials.unit as materialUnit',
        'suppliers.name as supplierName',
        db.raw("CONCAT(users.firstName, ' ', users.lastName) as createdByName")
      )
      .where('inventory_batches.material_id', materialId);

    // Filter by date range
    if (startDate) {
      query = query.where('batch_movements.movement_date', '>=', startDate);
    }
    if (endDate) {
      query = query.where('batch_movements.movement_date', '<=', endDate);
    }

    // Get total count
    const totalQuery = query.clone();
    const [{ total }] = await totalQuery.count('* as total');

    // Get paginated results
    const movements = await query
      .orderBy('batch_movements.movement_date', 'desc')
      .orderBy('batch_movements.created_at', 'desc')
      .limit(parseInt(limit))
      .offset(offset);

    // Calculate running balance
    // Get all movements for this material (for calculating running balance)
    const allMovements = await db('batch_movements')
      .join('inventory_batches', 'batch_movements.batch_id', 'inventory_batches.id')
      .select('batch_movements.quantity', 'batch_movements.movement_date', 'batch_movements.id')
      .where('inventory_batches.material_id', materialId)
      .orderBy('batch_movements.movement_date', 'asc')
      .orderBy('batch_movements.id', 'asc');

    // Calculate cumulative balance at each movement
    let cumulativeBalance = 0;
    const balanceMap = {};
    allMovements.forEach(m => {
      cumulativeBalance += parseFloat(m.quantity) || 0;
      balanceMap[m.id] = cumulativeBalance;
    });

    // Format response with running balance
    const formattedMovements = movements.map(m => {
      const movementDateStr = m.movementDate instanceof Date
        ? m.movementDate.toISOString()
        : m.movementDate;

      return {
        id: m.id,
        movementDate: movementDateStr,
        movementType: m.movementType,
        quantity: parseFloat(m.quantity) || 0,
        runningBalance: balanceMap[m.id] || 0,
        batchId: m.batchId,
        batchNumber: m.batchNumber,
        unitCost: parseFloat(m.unitCost) || 0,
        totalValue: Math.abs(parseFloat(m.quantity) || 0) * (parseFloat(m.unitCost) || 0),
        referenceType: m.referenceType,
        referenceId: m.referenceId,
        notes: m.notes,
        materialName: m.materialName,
        materialCode: m.materialCode,
        materialUnit: m.materialUnit,
        supplierName: m.supplierName,
        createdByName: m.createdByName,
        createdAt: m.createdAt
      };
    });

    // Get current stock level
    const currentStock = await db('inventory_batches')
      .sum('remaining_quantity as total')
      .where('material_id', materialId)
      .where('is_depleted', false)
      .first();

    res.json({
      success: true,
      data: {
        movements: formattedMovements,
        currentStock: parseFloat(currentStock?.total) || 0,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: parseInt(total),
          pages: Math.ceil(total / limit)
        }
      }
    });

  } catch (error) {
    logger.error('Error fetching batch movements history', {
      error: error.message,
      materialId: req.query.materialId,
      userId: req.user.userId
    });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch batch movements history'
    });
  }
});

// GET /api/inventory/chart-data - Get aggregated data for inventory charts
router.get('/chart-data', requirePermission('VIEW_INVENTORY'), async (req, res) => {
  try {
    const { companyId } = req.user;
    const db = getDbConnection(companyId);

    const {
      startDate,
      endDate,
      materialIds, // comma-separated list of material IDs
      groupBy = 'day' // 'day', 'week', 'month'
    } = req.query;

    // Parse material IDs
    const materialIdList = materialIds
      ? materialIds.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id))
      : [];

    // Default date range: last 30 days
    const endDateParsed = endDate ? new Date(endDate) : new Date();
    const startDateParsed = startDate
      ? new Date(startDate)
      : new Date(endDateParsed.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Get all materials for selection dropdown and chart legends
    const materials = await db('materials')
      .select('id', 'name', 'code', 'unit', 'category')
      .where('isActive', true)
      .orderBy('name');

    // Assign colors to materials
    const CHART_COLORS = [
      '#3B82F6', '#22C55E', '#F59E0B', '#EF4444', '#8B5CF6',
      '#06B6D4', '#EC4899', '#6366F1', '#14B8A6', '#F97316'
    ];
    const materialInfo = materials.map((m, index) => ({
      id: m.id,
      name: m.name,
      code: m.code,
      unit: m.unit,
      category: m.category,
      color: CHART_COLORS[index % CHART_COLORS.length]
    }));

    // Filter materials if specific IDs provided
    const targetMaterialIds = materialIdList.length > 0
      ? materialIdList
      : materials.slice(0, 5).map(m => m.id); // Default to first 5 materials

    // Determine date grouping format for SQL
    let dateGroupFormat;
    switch (groupBy) {
      case 'week':
        dateGroupFormat = db.raw("DATE_FORMAT(movement_date, '%Y-%u')"); // Year-Week
        break;
      case 'month':
        dateGroupFormat = db.raw("DATE_FORMAT(movement_date, '%Y-%m')"); // Year-Month
        break;
      default:
        dateGroupFormat = db.raw("DATE(movement_date)"); // Day
    }

    // === QUERY 1: Movement breakdown by type (using batch_movements table) ===
    // This is the primary source for FIFO-accurate stock tracking
    const movementsRaw = await db('batch_movements')
      .join('inventory_batches', 'batch_movements.batch_id', 'inventory_batches.id')
      .select(
        db.raw("DATE(batch_movements.movement_date) as date"),
        'batch_movements.movement_type',
        db.raw('SUM(ABS(batch_movements.quantity)) as total_quantity')
      )
      .whereBetween('batch_movements.movement_date', [startDateParsed, endDateParsed])
      .whereIn('inventory_batches.material_id', targetMaterialIds)
      .groupBy(db.raw('DATE(batch_movements.movement_date)'), 'batch_movements.movement_type')
      .orderBy('date');

    // Map movement types to chart categories
    const typeMapping = {
      'receipt': 'receipts',
      'purchase': 'receipts',
      'sale': 'sales',
      'wastage': 'wastage',
      'adjustment': 'adjustments',
      'transfer': 'adjustments',
      'return': 'adjustments'
    };

    // Transform movements into chart-ready format
    const movementsByDate = {};
    movementsRaw.forEach(row => {
      const dateStr = row.date instanceof Date
        ? row.date.toISOString().split('T')[0]
        : String(row.date).split('T')[0];

      if (!movementsByDate[dateStr]) {
        movementsByDate[dateStr] = {
          date: dateStr,
          receipts: 0,
          sales: 0,
          wastage: 0,
          adjustments: 0
        };
      }

      const qty = Math.abs(parseFloat(row.total_quantity) || 0);
      const category = typeMapping[row.movement_type] || 'adjustments';
      movementsByDate[dateStr][category] += qty;
    });

    const movements = Object.values(movementsByDate).sort((a, b) =>
      new Date(a.date) - new Date(b.date)
    );

    // === QUERY 2: Stock levels over time per material (using batch_movements table) ===
    // Get current stock levels from inventory_batches (sum of remaining_quantity)
    // This is more accurate than inventory table as it reflects FIFO tracking
    const currentStocks = await db('inventory_batches')
      .select('material_id')
      .sum('remaining_quantity as current_stock')
      .whereIn('material_id', targetMaterialIds)
      .where('is_depleted', false)
      .groupBy('material_id');

    const currentStockMap = {};
    currentStocks.forEach(row => {
      currentStockMap[row.material_id] = parseFloat(row.current_stock) || 0;
    });

    // Get daily net changes from batch_movements table
    // The quantity in batch_movements is already signed correctly:
    // - Positive for receipts/purchases
    // - Negative for sales/wastage/outflows
    const dailyChanges = await db('batch_movements')
      .join('inventory_batches', 'batch_movements.batch_id', 'inventory_batches.id')
      .select(
        db.raw("DATE(batch_movements.movement_date) as date"),
        'inventory_batches.material_id',
        db.raw('SUM(batch_movements.quantity) as net_change')
      )
      .whereBetween('batch_movements.movement_date', [startDateParsed, endDateParsed])
      .whereIn('inventory_batches.material_id', targetMaterialIds)
      .groupBy(db.raw('DATE(batch_movements.movement_date)'), 'inventory_batches.material_id')
      .orderBy('date', 'desc');

    // Generate all dates in the range for complete timeline
    const generateDateRange = (start, end) => {
      const dates = [];
      const current = new Date(start);
      const endDate = new Date(end);
      while (current <= endDate) {
        dates.push(current.toISOString().split('T')[0]);
        current.setDate(current.getDate() + 1);
      }
      return dates;
    };

    const allDatesInRange = generateDateRange(startDateParsed, endDateParsed);

    // Build daily change map for quick lookup
    const dailyChangeMap = {};
    dailyChanges.forEach(row => {
      const dateStr = row.date instanceof Date
        ? row.date.toISOString().split('T')[0]
        : String(row.date).split('T')[0];
      const materialId = row.material_id;

      if (!dailyChangeMap[dateStr]) {
        dailyChangeMap[dateStr] = {};
      }
      dailyChangeMap[dateStr][materialId] = parseFloat(row.net_change) || 0;
    });

    // Work backwards from current stock to calculate historical levels
    // Key fix: When working backwards, we ADD the net change (reverse the transaction)
    // If today's stock is 100 and we sold 20 today, yesterday's stock was 100 + 20 = 120
    const stockLevels = [];
    const runningStocks = { ...currentStockMap };

    // Process dates in reverse order (most recent first)
    for (let i = allDatesInRange.length - 1; i >= 0; i--) {
      const date = allDatesInRange[i];
      const dataPoint = { date };

      targetMaterialIds.forEach(materialId => {
        const material = materialInfo.find(m => m.id === materialId);
        const key = material?.code || `material_${materialId}`;

        // Current running stock for this date (stock at END of day)
        dataPoint[key] = Math.max(0, runningStocks[materialId] || 0);

        // Get the net change for this date (if any)
        const netChange = dailyChangeMap[date]?.[materialId] || 0;

        // To find previous day's stock: SUBTRACT the net change (reverse the transaction)
        // netChange is positive for receipts (stock increased), negative for sales (stock decreased)
        // If we received 50 today (netChange = +50), yesterday was current - 50
        // If we sold 20 today (netChange = -20), yesterday was current - (-20) = current + 20
        runningStocks[materialId] = (runningStocks[materialId] || 0) - netChange;
      });

      stockLevels.unshift(dataPoint); // Add to beginning (building array in chronological order)
    }

    // Get summary statistics
    const totalReceipts = movements.reduce((sum, m) => sum + m.receipts, 0);
    const totalSales = movements.reduce((sum, m) => sum + m.sales, 0);
    const totalWastage = movements.reduce((sum, m) => sum + m.wastage, 0);
    const netChange = totalReceipts - totalSales - totalWastage;

    logger.info('Chart data generated', {
      companyId,
      dateRange: { start: startDateParsed, end: endDateParsed },
      materialCount: targetMaterialIds.length,
      movementDays: movements.length,
      stockLevelDays: stockLevels.length,
      currentStocks: currentStockMap,
      summary: { totalReceipts, totalSales, totalWastage, netChange },
      sampleStockLevels: stockLevels.slice(-3) // Last 3 days for debugging
    });

    res.json({
      success: true,
      data: {
        stockLevels,
        movements,
        materialInfo: materialInfo.filter(m => targetMaterialIds.includes(m.id)),
        allMaterials: materialInfo,
        dateRange: {
          start: startDateParsed.toISOString().split('T')[0],
          end: endDateParsed.toISOString().split('T')[0]
        },
        summary: {
          totalReceipts,
          totalSales,
          totalWastage,
          netChange
        }
      }
    });

  } catch (error) {
    logger.error('Error generating chart data', {
      error: error.message,
      stack: error.stack,
      userId: req.user.userId
    });
    res.status(500).json({
      success: false,
      error: 'Failed to generate chart data'
    });
  }
});

// GET /api/inventory/composite-receipts/:materialId - Get composite material receipts with component breakdown
router.get('/composite-receipts/:materialId',
  validateParams(Joi.object({ materialId: Joi.number().integer().positive().required() })),
  requirePermission('VIEW_INVENTORY'),
  async (req, res) => {
    try {
      const { materialId } = req.params;
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      // Verify the material exists and is a composite material
      const material = await db('materials')
        .where({ id: materialId, isActive: true })
        .first();

      if (!material) {
        return res.status(404).json({
          success: false,
          error: 'Material not found'
        });
      }

      // Check if this material is a composite (has components)
      const components = await db('material_compositions')
        .where({ composite_material_id: materialId, is_active: true })
        .select('component_material_id', 'component_type', 'ratio');

      if (components.length === 0) {
        return res.json({
          success: true,
          data: {
            materialId: parseInt(materialId),
            materialName: material.name,
            isComposite: false,
            receipts: []
          }
        });
      }

      // Get component material names
      const componentMaterialIds = components.map(c => c.component_material_id);
      const componentMaterials = await db('materials')
        .whereIn('id', componentMaterialIds)
        .select('id', 'name', 'unit');

      const componentMaterialMap = {};
      componentMaterials.forEach(m => {
        componentMaterialMap[m.id] = { name: m.name, unit: m.unit };
      });

      // Find collection orders that had this composite material collected
      const collectionReceipts = await db('collection_items')
        .join('collection_orders', 'collection_items.collectionOrderId', 'collection_orders.id')
        .leftJoin('suppliers', 'collection_orders.supplierId', 'suppliers.id')
        .leftJoin('supplier_locations', 'collection_orders.supplierLocationId', 'supplier_locations.id')
        .where('collection_items.materialId', materialId)
        .where('collection_orders.status', 'finalized')
        .select(
          'collection_orders.id as collectionOrderId',
          'collection_orders.orderNumber as collectionOrderNumber',
          'collection_orders.wcn_number as wcnNumber',
          'collection_orders.finalized_at as receiptDate',
          'collection_items.collectedQuantity',
          'suppliers.name as supplierName',
          'supplier_locations.name as locationName'
        )
        .orderBy('collection_orders.finalized_at', 'desc');

      // For each collection order, find the component batches created
      const receiptsWithComponents = await Promise.all(
        collectionReceipts.map(async (receipt) => {
          // Find the purchase order linked to this collection order
          const purchaseOrder = await db('purchase_orders')
            .where({ collection_order_id: receipt.collectionOrderId, source_type: 'wcn_auto' })
            .select('id', 'orderNumber')
            .first();

          // Find component batches created from this collection
          let componentBatches = [];
          if (purchaseOrder) {
            componentBatches = await db('inventory_batches')
              .join('materials', 'inventory_batches.material_id', 'materials.id')
              .where('inventory_batches.purchase_order_id', purchaseOrder.id)
              .whereIn('inventory_batches.material_id', componentMaterialIds)
              .select(
                'inventory_batches.id as batchId',
                'inventory_batches.batch_number as batchNumber',
                'inventory_batches.material_id as materialId',
                'materials.name as materialName',
                'materials.unit as unit',
                'inventory_batches.quantity_received as quantityReceived',
                'inventory_batches.remaining_quantity as remainingQuantity',
                'inventory_batches.unit_cost as unitCost'
              );
          }

          // Add component type to each batch
          const componentsWithType = componentBatches.map(batch => {
            const componentDef = components.find(c => c.component_material_id === batch.materialId);
            return {
              ...batch,
              quantityReceived: parseFloat(batch.quantityReceived) || 0,
              remainingQuantity: parseFloat(batch.remainingQuantity) || 0,
              unitCost: parseFloat(batch.unitCost) || 0,
              componentType: componentDef?.component_type || 'unknown'
            };
          });

          return {
            collectionOrderId: receipt.collectionOrderId,
            collectionOrderNumber: receipt.collectionOrderNumber,
            wcnNumber: receipt.wcnNumber,
            receiptDate: receipt.receiptDate,
            collectedQuantity: parseFloat(receipt.collectedQuantity) || 0,
            supplierName: receipt.supplierName,
            locationName: receipt.locationName,
            purchaseOrderId: purchaseOrder?.id || null,
            purchaseOrderNumber: purchaseOrder?.orderNumber || null,
            components: componentsWithType
          };
        })
      );

      res.json({
        success: true,
        data: {
          materialId: parseInt(materialId),
          materialName: material.name,
          isComposite: true,
          componentDefinitions: components.map(c => ({
            materialId: c.component_material_id,
            materialName: componentMaterialMap[c.component_material_id]?.name || 'Unknown',
            unit: componentMaterialMap[c.component_material_id]?.unit || 'units',
            componentType: c.component_type,
            ratio: parseFloat(c.ratio) || 1
          })),
          receipts: receiptsWithComponents
        }
      });

    } catch (error) {
      logger.error('Error fetching composite receipts', {
        error: error.message,
        materialId: req.params.materialId,
        userId: req.user.userId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch composite receipts'
      });
    }
  }
);

// GET /api/inventory/:id - Get specific inventory item
router.get('/:id',
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  requirePermission('VIEW_INVENTORY'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      const inventory = await db('inventory')
        .leftJoin('materials', 'inventory.materialId', 'materials.id')
        .select(
          'inventory.*',
          'materials.name as materialName',
          'materials.code as materialCode',
          'materials.category',
          'materials.unit',
          'materials.standardPrice',
          db.raw('(inventory.quantity - inventory.reservedQuantity) as availableQuantity')
        )
        .where('inventory.id', id)
        .first();

      if (!inventory) {
        return res.status(404).json({
          success: false,
          error: 'Inventory item not found'
        });
      }

      auditLog('INVENTORY_ITEM_VIEWED', req.user.userId, {
        inventoryId: id,
        materialName: inventory.materialName,
        batchNumber: inventory.batchNumber
      });

      res.json({
        success: true,
        data: inventory
      });

    } catch (error) {
      logger.error('Error fetching inventory item', { 
        error: error.message, 
        inventoryId: req.params.id,
        userId: req.user.userId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch inventory item'
      });
    }
  }
);

// POST /api/inventory - Add inventory item
router.post('/', 
  validate(inventorySchema),
  requirePermission('MANAGE_INVENTORY'),
  async (req, res) => {
    try {
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      // Validate material exists
      const material = await db('materials')
        .where({ id: req.body.materialId, isActive: true })
        .first();

      if (!material) {
        return res.status(400).json({
          success: false,
          error: 'Material not found or inactive'
        });
      }

      // Check for unique batch number if provided
      if (req.body.batchNumber) {
        const existingBatch = await db('inventory')
          .where({ 
            materialId: req.body.materialId,
            batchNumber: req.body.batchNumber 
          })
          .first();

        if (existingBatch) {
          return res.status(400).json({
            success: false,
            error: 'Batch number already exists for this material'
          });
        }
      }

      const inventoryData = {
        ...req.body,
        created_at: new Date(),
        updated_at: new Date()
      };

      // Start transaction for inventory and transaction log
      const result = await db.transaction(async (trx) => {
        const [inventoryId] = await trx('inventory').insert(inventoryData);
        
        // Create transaction record
        await trx('transactions').insert({
          transactionNumber: `INV-${Date.now()}-${inventoryId}`,
          transactionType: 'adjustment',
          referenceId: inventoryId,
          referenceType: 'inventory',
          materialId: req.body.materialId,
          quantity: req.body.quantity,
          amount: req.body.quantity * req.body.averageCost,
          transactionDate: new Date(),
          description: 'Initial inventory entry',
          createdBy: req.user.userId,
          created_at: new Date(),
          updated_at: new Date()
        });

        return inventoryId;
      });

      const newInventory = await db('inventory')
        .leftJoin('materials', 'inventory.materialId', 'materials.id')
        .select(
          'inventory.*',
          'materials.name as materialName',
          'materials.code as materialCode'
        )
        .where('inventory.id', result)
        .first();

      auditLog('INVENTORY_ADDED', req.user.userId, {
        inventoryId: result,
        materialName: newInventory.materialName,
        quantity: req.body.quantity,
        batchNumber: req.body.batchNumber
      });

      logger.info('Inventory added', {
        inventoryId: result,
        materialName: newInventory.materialName,
        quantity: req.body.quantity,
        createdBy: req.user.userId
      });

      res.status(201).json({
        success: true,
        message: 'Inventory item added successfully',
        data: newInventory
      });

    } catch (error) {
      logger.error('Error adding inventory', { 
        error: error.message, 
        userId: req.user.userId,
        inventoryData: req.body
      });
      res.status(500).json({
        success: false,
        error: 'Failed to add inventory item'
      });
    }
  }
);

// PUT /api/inventory/:id/adjust - Adjust inventory quantity
router.put('/:id/adjust',
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  validate(stockAdjustmentSchema),
  requirePermission('UPDATE_STOCK'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { adjustmentType, quantity, reason, notes } = req.body;
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      // Get current inventory item
      const inventory = await db('inventory')
        .leftJoin('materials', 'inventory.materialId', 'materials.id')
        .select(
          'inventory.*',
          'materials.name as materialName',
          'materials.code as materialCode'
        )
        .where('inventory.id', id)
        .first();

      if (!inventory) {
        return res.status(404).json({
          success: false,
          error: 'Inventory item not found'
        });
      }

      let newQuantity;
      let adjustmentAmount;

      switch (adjustmentType) {
        case 'increase':
          newQuantity = inventory.quantity + quantity;
          adjustmentAmount = quantity;
          break;
        case 'decrease':
          if (quantity > inventory.quantity) {
            return res.status(400).json({
              success: false,
              error: 'Cannot decrease quantity by more than current stock'
            });
          }
          newQuantity = inventory.quantity - quantity;
          adjustmentAmount = -quantity;
          break;
        case 'set':
          newQuantity = quantity;
          adjustmentAmount = quantity - inventory.quantity;
          break;
      }

      // Start transaction
      await db.transaction(async (trx) => {
        // Update inventory
        await trx('inventory')
          .where({ id })
          .update({
            quantity: newQuantity,
            updated_at: new Date()
          });

        // Create transaction record
        await trx('transactions').insert({
          transactionNumber: `ADJ-${Date.now()}-${id}`,
          transactionType: 'adjustment',
          referenceId: id,
          referenceType: 'inventory',
          materialId: inventory.materialId,
          quantity: adjustmentAmount,
          amount: adjustmentAmount * inventory.averageCost,
          transactionDate: new Date(),
          description: `Stock adjustment: ${reason}`,
          notes: notes,
          createdBy: req.user.userId,
          created_at: new Date(),
          updated_at: new Date()
        });
      });

      auditLog('INVENTORY_ADJUSTED', req.user.userId, {
        inventoryId: id,
        materialName: inventory.materialName,
        oldQuantity: inventory.quantity,
        newQuantity: newQuantity,
        adjustmentType,
        reason
      });

      logger.info('Inventory adjusted', {
        inventoryId: id,
        materialName: inventory.materialName,
        adjustmentType,
        quantity: adjustmentAmount,
        adjustedBy: req.user.userId
      });

      res.json({
        success: true,
        message: 'Inventory adjusted successfully',
        data: {
          oldQuantity: inventory.quantity,
          newQuantity: newQuantity,
          adjustment: adjustmentAmount
        }
      });

    } catch (error) {
      logger.error('Error adjusting inventory', { 
        error: error.message, 
        inventoryId: req.params.id,
        userId: req.user.userId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to adjust inventory'
      });
    }
  }
);

module.exports = router;