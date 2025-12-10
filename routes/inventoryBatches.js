/**
 * Inventory Batches Routes
 * Manages FIFO inventory batches and batch movements
 */

const express = require('express');
const { validate, validateParams, sanitize } = require('../middleware/validation');
const { requirePermission } = require('../middleware/auth');
const { logger, auditLog } = require('../utils/logger');
const { getDbConnection } = require('../config/database');
const { allocateFIFO, previewFIFO, createBatch, getBatchSummary, reverseFIFOAllocation } = require('../utils/fifoAllocator');
const Joi = require('joi');

const router = express.Router();

// Apply sanitization to all routes
router.use(sanitize);

// Validation schemas
const batchCreateSchema = Joi.object({
  materialId: Joi.number().integer().positive().required(),
  batchNumber: Joi.string().max(100).optional(),
  supplierId: Joi.number().integer().positive().required(),
  purchaseOrderId: Joi.number().integer().positive().allow(null).optional(),
  branchId: Joi.number().integer().positive().allow(null).optional(),
  purchaseDate: Joi.date().required(),
  quantityReceived: Joi.number().positive().required(),
  unitCost: Joi.number().min(0).required(),
  expiryDate: Joi.date().allow(null).optional(),
  location: Joi.string().max(100).allow('', null).optional(),
  condition: Joi.string().valid('new', 'used', 'refurbished', 'damaged').default('new'),
  notes: Joi.string().allow('', null).optional()
}).options({ stripUnknown: true });

const batchUpdateSchema = Joi.object({
  location: Joi.string().max(100).allow('', null).optional(),
  condition: Joi.string().valid('new', 'used', 'refurbished', 'damaged').optional(),
  expiryDate: Joi.date().allow(null).optional(),
  notes: Joi.string().allow('', null).optional()
}).options({ stripUnknown: true });

const adjustmentSchema = Joi.object({
  quantity: Joi.number().required(), // Can be positive or negative
  reason: Joi.string().required(),
  notes: Joi.string().allow('', null).optional()
}).options({ stripUnknown: true });

const transferSchema = Joi.object({
  quantity: Joi.number().positive().required(),
  toBranchId: Joi.number().integer().positive().required(),
  notes: Joi.string().allow('', null).optional()
}).options({ stripUnknown: true });

const previewAllocationSchema = Joi.object({
  materialId: Joi.number().integer().positive().required(),
  quantity: Joi.number().positive().required(),
  branchId: Joi.number().integer().positive().allow(null).optional()
}).options({ stripUnknown: true });

// GET /api/inventory-batches - List all batches
router.get('/', requirePermission('VIEW_INVENTORY'), async (req, res) => {
  try {
    const { companyId } = req.user;
    const db = getDbConnection(companyId);

    const {
      page = 1,
      limit = 50,
      materialId,
      supplierId,
      branchId,
      showDepleted = 'false',
      search
    } = req.query;

    const offset = (page - 1) * limit;

    let query = db('inventory_batches')
      .leftJoin('materials', 'inventory_batches.material_id', 'materials.id')
      .leftJoin('suppliers', 'inventory_batches.supplier_id', 'suppliers.id')
      .leftJoin('branches', 'inventory_batches.branch_id', 'branches.id')
      .select(
        'inventory_batches.*',
        'materials.name as materialName',
        'materials.unit as materialUnit',
        'suppliers.name as supplierName',
        'branches.name as branchName'
      );

    // Filter by material
    if (materialId) {
      query = query.where('inventory_batches.material_id', materialId);
    }

    // Filter by supplier
    if (supplierId) {
      query = query.where('inventory_batches.supplier_id', supplierId);
    }

    // Filter by branch
    if (branchId) {
      query = query.where('inventory_batches.branch_id', branchId);
    }

    // Show/hide depleted batches
    if (showDepleted !== 'true') {
      query = query.where('inventory_batches.is_depleted', false);
    }

    // Search by batch number
    if (search) {
      query = query.where(function() {
        this.where('inventory_batches.batch_number', 'like', `%${search}%`)
            .orWhere('materials.name', 'like', `%${search}%`);
      });
    }

    // Get total count
    const totalQuery = query.clone();
    const [{ total }] = await totalQuery.count('* as total');

    // Get paginated results
    const batches = await query
      .orderBy('inventory_batches.purchase_date', 'asc') // FIFO order
      .orderBy('inventory_batches.id', 'asc')
      .limit(limit)
      .offset(offset);

    // Format numeric fields
    const formattedBatches = batches.map(batch => ({
      ...batch,
      quantity_received: parseFloat(batch.quantity_received) || 0,
      remaining_quantity: parseFloat(batch.remaining_quantity) || 0,
      unit_cost: parseFloat(batch.unit_cost) || 0,
      totalValue: (parseFloat(batch.remaining_quantity) || 0) * (parseFloat(batch.unit_cost) || 0)
    }));

    // Calculate summary
    const summary = {
      totalBatches: parseInt(total),
      activeBatches: formattedBatches.filter(b => !b.is_depleted).length,
      totalQuantity: formattedBatches.reduce((sum, b) => sum + b.remaining_quantity, 0),
      totalValue: formattedBatches.reduce((sum, b) => sum + b.totalValue, 0)
    };

    res.json({
      success: true,
      data: formattedBatches,
      summary,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(total),
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    logger.error('Error fetching inventory batches', {
      error: error.message,
      userId: req.user.userId
    });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch inventory batches'
    });
  }
});

// GET /api/inventory-batches/material/:materialId/summary - Get batch summary for a material
router.get('/material/:materialId/summary', requirePermission('VIEW_INVENTORY'), async (req, res) => {
  try {
    const { materialId } = req.params;
    const { companyId } = req.user;
    const db = getDbConnection(companyId);

    const summary = await getBatchSummary(db, materialId);

    // Get material info
    const material = await db('materials')
      .where({ id: materialId })
      .select('name', 'unit')
      .first();

    res.json({
      success: true,
      data: {
        materialId: parseInt(materialId),
        materialName: material?.name || 'Unknown',
        unit: material?.unit || 'units',
        ...summary
      }
    });

  } catch (error) {
    logger.error('Error fetching batch summary', {
      error: error.message,
      materialId: req.params.materialId
    });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch batch summary'
    });
  }
});

// POST /api/inventory-batches/preview-allocation - Preview FIFO allocation
router.post('/preview-allocation',
  validate(previewAllocationSchema),
  requirePermission('VIEW_INVENTORY'),
  async (req, res) => {
    try {
      const { materialId, quantity, branchId } = req.body;
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      const preview = await previewFIFO(db, materialId, quantity, { branchId });

      // Get material info
      const material = await db('materials')
        .where({ id: materialId })
        .select('name', 'unit')
        .first();

      res.json({
        success: true,
        data: {
          materialId,
          materialName: material?.name || 'Unknown',
          unit: material?.unit || 'units',
          requestedQuantity: quantity,
          ...preview
        }
      });

    } catch (error) {
      logger.error('Error previewing FIFO allocation', {
        error: error.message,
        materialId: req.body.materialId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to preview allocation'
      });
    }
  }
);

// GET /api/inventory-batches/:id - Get batch details with movements
router.get('/:id',
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  requirePermission('VIEW_INVENTORY'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      const batch = await db('inventory_batches')
        .leftJoin('materials', 'inventory_batches.material_id', 'materials.id')
        .leftJoin('suppliers', 'inventory_batches.supplier_id', 'suppliers.id')
        .leftJoin('branches', 'inventory_batches.branch_id', 'branches.id')
        .leftJoin('purchase_orders', 'inventory_batches.purchase_order_id', 'purchase_orders.id')
        .select(
          'inventory_batches.*',
          'materials.name as materialName',
          'materials.unit as materialUnit',
          'suppliers.name as supplierName',
          'branches.name as branchName',
          'purchase_orders.orderNumber as purchaseOrderNumber'
        )
        .where('inventory_batches.id', id)
        .first();

      if (!batch) {
        return res.status(404).json({
          success: false,
          error: 'Batch not found'
        });
      }

      // Get movement history
      const movements = await db('batch_movements')
        .leftJoin('users', 'batch_movements.created_by', 'users.id')
        .select(
          'batch_movements.*',
          'users.firstName as createdByFirstName',
          'users.lastName as createdByLastName'
        )
        .where('batch_movements.batch_id', id)
        .orderBy('batch_movements.created_at', 'desc')
        .limit(50);

      // Format batch
      const formattedBatch = {
        ...batch,
        quantity_received: parseFloat(batch.quantity_received) || 0,
        remaining_quantity: parseFloat(batch.remaining_quantity) || 0,
        unit_cost: parseFloat(batch.unit_cost) || 0,
        totalValue: (parseFloat(batch.remaining_quantity) || 0) * (parseFloat(batch.unit_cost) || 0)
      };

      // Format movements
      const formattedMovements = movements.map(m => ({
        ...m,
        quantity: parseFloat(m.quantity) || 0,
        createdByName: `${m.createdByFirstName || ''} ${m.createdByLastName || ''}`.trim()
      }));

      res.json({
        success: true,
        data: {
          batch: formattedBatch,
          movements: formattedMovements
        }
      });

    } catch (error) {
      logger.error('Error fetching batch details', {
        error: error.message,
        batchId: req.params.id
      });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch batch details'
      });
    }
  }
);

// POST /api/inventory-batches - Create new batch (manual receipt)
router.post('/',
  validate(batchCreateSchema),
  requirePermission('MANAGE_INVENTORY'),
  async (req, res) => {
    try {
      const { companyId, userId } = req.user;
      const db = getDbConnection(companyId);

      await db.transaction(async (trx) => {
        const batch = await createBatch(trx, {
          ...req.body,
          userId
        });

        // Update main inventory totals
        const existingInventory = await trx('inventory')
          .where({ materialId: req.body.materialId })
          .first();

        if (existingInventory) {
          // Update existing inventory record
          const newQuantity = parseFloat(existingInventory.currentQuantity) + parseFloat(req.body.quantityReceived);
          const currentValue = parseFloat(existingInventory.currentQuantity) * parseFloat(existingInventory.averageCost);
          const newValue = parseFloat(req.body.quantityReceived) * parseFloat(req.body.unitCost);
          const newAverageCost = (currentValue + newValue) / newQuantity;

          await trx('inventory')
            .where({ materialId: req.body.materialId })
            .update({
              currentQuantity: newQuantity,
              averageCost: newAverageCost,
              lastPurchasePrice: req.body.unitCost,
              lastPurchaseDate: req.body.purchaseDate,
              last_supplier_id: req.body.supplierId,
              updated_at: new Date()
            });
        } else {
          // Create new inventory record
          await trx('inventory').insert({
            materialId: req.body.materialId,
            currentQuantity: req.body.quantityReceived,
            averageCost: req.body.unitCost,
            lastPurchasePrice: req.body.unitCost,
            lastPurchaseDate: req.body.purchaseDate,
            last_supplier_id: req.body.supplierId,
            created_at: new Date(),
            updated_at: new Date()
          });
        }

        auditLog('INVENTORY_BATCH_CREATED', userId, {
          batchId: batch.id,
          batchNumber: batch.batchNumber,
          materialId: req.body.materialId,
          quantity: req.body.quantityReceived,
          unitCost: req.body.unitCost
        });

        res.status(201).json({
          success: true,
          data: batch,
          message: 'Inventory batch created successfully'
        });
      });

    } catch (error) {
      logger.error('Error creating inventory batch', {
        error: error.message,
        userId: req.user.userId
      });
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to create inventory batch'
      });
    }
  }
);

// PUT /api/inventory-batches/:id - Update batch details
router.put('/:id',
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  validate(batchUpdateSchema),
  requirePermission('MANAGE_INVENTORY'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { companyId, userId } = req.user;
      const db = getDbConnection(companyId);

      const batch = await db('inventory_batches').where({ id }).first();

      if (!batch) {
        return res.status(404).json({
          success: false,
          error: 'Batch not found'
        });
      }

      await db('inventory_batches')
        .where({ id })
        .update({
          ...req.body,
          updated_at: new Date()
        });

      auditLog('INVENTORY_BATCH_UPDATED', userId, {
        batchId: id,
        changes: req.body
      });

      res.json({
        success: true,
        message: 'Batch updated successfully'
      });

    } catch (error) {
      logger.error('Error updating batch', {
        error: error.message,
        batchId: req.params.id
      });
      res.status(500).json({
        success: false,
        error: 'Failed to update batch'
      });
    }
  }
);

// POST /api/inventory-batches/:id/adjustment - Manual quantity adjustment
router.post('/:id/adjustment',
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  validate(adjustmentSchema),
  requirePermission('MANAGE_INVENTORY'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { quantity, reason, notes } = req.body;
      const { companyId, userId } = req.user;
      const db = getDbConnection(companyId);

      await db.transaction(async (trx) => {
        const batch = await trx('inventory_batches').where({ id }).first();

        if (!batch) {
          throw new Error('Batch not found');
        }

        const currentQuantity = parseFloat(batch.remaining_quantity);
        const newQuantity = currentQuantity + parseFloat(quantity);

        if (newQuantity < 0) {
          throw new Error(`Cannot reduce below 0. Current: ${currentQuantity}, Adjustment: ${quantity}`);
        }

        // Update batch quantity
        await trx('inventory_batches')
          .where({ id })
          .update({
            remaining_quantity: newQuantity,
            is_depleted: newQuantity <= 0,
            updated_at: new Date()
          });

        // Create movement record
        await trx('batch_movements').insert({
          batch_id: id,
          movement_type: 'adjustment',
          quantity: quantity,
          reference_type: 'manual_adjustment',
          reference_id: null,
          movement_date: new Date().toISOString().split('T')[0],
          notes: `${reason}${notes ? ` - ${notes}` : ''}`,
          created_by: userId,
          created_at: new Date()
        });

        // Update main inventory
        await trx('inventory')
          .where({ materialId: batch.material_id })
          .increment('currentQuantity', parseFloat(quantity));

        auditLog('INVENTORY_BATCH_ADJUSTED', userId, {
          batchId: id,
          previousQuantity: currentQuantity,
          adjustment: quantity,
          newQuantity,
          reason
        });

        res.json({
          success: true,
          data: {
            previousQuantity: currentQuantity,
            adjustment: quantity,
            newQuantity
          },
          message: 'Batch quantity adjusted successfully'
        });
      });

    } catch (error) {
      logger.error('Error adjusting batch quantity', {
        error: error.message,
        batchId: req.params.id
      });
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to adjust batch quantity'
      });
    }
  }
);

// POST /api/inventory-batches/:id/transfer - Transfer to another branch
router.post('/:id/transfer',
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  validate(transferSchema),
  requirePermission('MANAGE_INVENTORY'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { quantity, toBranchId, notes } = req.body;
      const { companyId, userId } = req.user;
      const db = getDbConnection(companyId);

      await db.transaction(async (trx) => {
        const batch = await trx('inventory_batches').where({ id }).first();

        if (!batch) {
          throw new Error('Batch not found');
        }

        const currentQuantity = parseFloat(batch.remaining_quantity);

        if (quantity > currentQuantity) {
          throw new Error(`Transfer quantity (${quantity}) exceeds available (${currentQuantity})`);
        }

        // Reduce quantity in source batch
        const newQuantity = currentQuantity - quantity;
        await trx('inventory_batches')
          .where({ id })
          .update({
            remaining_quantity: newQuantity,
            is_depleted: newQuantity <= 0,
            updated_at: new Date()
          });

        // Create new batch at destination (or update if batch exists)
        const newBatchNumber = `${batch.batch_number}-TRF-${Date.now().toString(36).toUpperCase()}`;

        const [newBatchId] = await trx('inventory_batches').insert({
          material_id: batch.material_id,
          batch_number: newBatchNumber,
          supplier_id: batch.supplier_id,
          purchase_order_id: batch.purchase_order_id,
          branch_id: toBranchId,
          purchase_date: batch.purchase_date,
          quantity_received: quantity,
          remaining_quantity: quantity,
          unit_cost: batch.unit_cost,
          expiry_date: batch.expiry_date,
          location: null,
          condition: batch.condition,
          is_depleted: false,
          notes: `Transferred from batch ${batch.batch_number}`,
          created_at: new Date(),
          updated_at: new Date()
        });

        // Create transfer-out movement on source batch
        await trx('batch_movements').insert({
          batch_id: id,
          movement_type: 'transfer',
          quantity: -quantity,
          reference_type: 'branch_transfer_out',
          reference_id: newBatchId,
          movement_date: new Date().toISOString().split('T')[0],
          notes: `Transfer to branch ${toBranchId}${notes ? ` - ${notes}` : ''}`,
          created_by: userId,
          created_at: new Date()
        });

        // Create receipt movement on destination batch
        await trx('batch_movements').insert({
          batch_id: newBatchId,
          movement_type: 'receipt',
          quantity: quantity,
          reference_type: 'branch_transfer_in',
          reference_id: id,
          movement_date: new Date().toISOString().split('T')[0],
          notes: `Transfer from batch ${batch.batch_number}${notes ? ` - ${notes}` : ''}`,
          created_by: userId,
          created_at: new Date()
        });

        auditLog('INVENTORY_BATCH_TRANSFERRED', userId, {
          sourceBatchId: id,
          destinationBatchId: newBatchId,
          quantity,
          toBranchId
        });

        res.json({
          success: true,
          data: {
            sourceBatchId: id,
            destinationBatchId: newBatchId,
            destinationBatchNumber: newBatchNumber,
            transferredQuantity: quantity
          },
          message: 'Batch transferred successfully'
        });
      });

    } catch (error) {
      logger.error('Error transferring batch', {
        error: error.message,
        batchId: req.params.id
      });
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to transfer batch'
      });
    }
  }
);

// GET /api/inventory-batches/:id/movements - Get movement history
router.get('/:id/movements',
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  requirePermission('VIEW_INVENTORY'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      const movements = await db('batch_movements')
        .leftJoin('users', 'batch_movements.created_by', 'users.id')
        .select(
          'batch_movements.*',
          'users.firstName as createdByFirstName',
          'users.lastName as createdByLastName'
        )
        .where('batch_movements.batch_id', id)
        .orderBy('batch_movements.created_at', 'desc');

      const formattedMovements = movements.map(m => ({
        ...m,
        quantity: parseFloat(m.quantity) || 0,
        createdByName: `${m.createdByFirstName || ''} ${m.createdByLastName || ''}`.trim()
      }));

      res.json({
        success: true,
        data: formattedMovements
      });

    } catch (error) {
      logger.error('Error fetching batch movements', {
        error: error.message,
        batchId: req.params.id
      });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch batch movements'
      });
    }
  }
);

module.exports = router;
