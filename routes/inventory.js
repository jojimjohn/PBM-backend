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