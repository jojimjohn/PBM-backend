const express = require('express');
const router = express.Router();
const { getDbConnection } = require('../config/database');
const { requirePermission } = require('../middleware/auth');
const { validate } = require('../middleware/validation');
const { getRepositoryFactory } = require('../repositories/RepositoryFactory');
const Joi = require('joi');
const winston = require('winston');

// Validation schemas
const wastageSchema = Joi.object({
  materialId: Joi.number().integer().positive().required(),
  inventoryId: Joi.number().integer().positive().optional(),
  quantity: Joi.number().positive().required(),
  unitCost: Joi.number().positive().required(),
  wasteType: Joi.string().valid(
    'spillage', 'contamination', 'expiry', 'damage', 
    'theft', 'evaporation', 'sorting_loss', 'quality_rejection',
    'transport_loss', 'handling_damage', 'other'
  ).required(),
  reason: Joi.string().max(1000).optional(),
  description: Joi.string().max(2000).optional(),
  wastageDate: Joi.date().iso().required(),
  location: Joi.string().max(100).optional(),
  attachments: Joi.array().items(Joi.string()).optional()
});

const updateWastageSchema = wastageSchema.fork(['materialId'], (schema) => schema.optional());

const approvalSchema = Joi.object({
  status: Joi.string().valid('approved', 'rejected').required(),
  approvalNotes: Joi.string().max(1000).optional()
});

// Generate wastage number
function generateWastageNumber(companyId) {
  const prefix = companyId === 'al-ramrami' ? 'ALR-W' : 'PM-W';
  const timestamp = Date.now().toString().slice(-8);
  return `${prefix}-${timestamp}`;
}

// GET /wastages - List all wastages with filtering and pagination
router.get('/', requirePermission('VIEW_WASTAGE'), async (req, res) => {
  try {
    const repositoryFactory = getRepositoryFactory(req.user.companyId);
    const wastageRepository = repositoryFactory.getWastagesRepository();
    
    const filters = {
      materialId: req.query.materialId,
      wasteType: req.query.wasteType,
      status: req.query.status,
      reportedBy: req.query.reportedBy,
      dateFrom: req.query.dateFrom,
      dateTo: req.query.dateTo
    };
    
    const pagination = {
      page: req.query.page || 1,
      limit: req.query.limit || 50
    };
    
    const result = await wastageRepository.findAllWithDetails(filters, pagination);
    
    winston.info('Wastages retrieved using repository pattern', {
      companyId: req.user.companyId,
      userId: req.user.id,
      count: result.data.length,
      totalCount: result.pagination.total
    });
    
    res.json({
      success: true,
      data: result.data,
      pagination: result.pagination
    });
    
  } catch (error) {
    winston.error('Error fetching wastages', {
      error: error.message,
      companyId: req.user.companyId,
      userId: req.user.id
    });
    
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// GET /wastages/:id - Get specific wastage
router.get('/:id', requirePermission('VIEW_WASTAGE'), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const { id } = req.params;
    
    const wastage = await db('wastages')
      .select(
        'wastages.*',
        'materials.name as materialName',
        'materials.code as materialCode',
        'materials.unit as materialUnit',
        'inventory.batchNumber as inventoryBatch',
        'reportedUser.firstName as reportedByName',
        'reportedUser.lastName as reportedByLastName',
        'approvedUser.firstName as approvedByName',
        'approvedUser.lastName as approvedByLastName'
      )
      .leftJoin('materials', 'wastages.materialId', 'materials.id')
      .leftJoin('inventory', 'wastages.inventoryId', 'inventory.id')
      .leftJoin('users as reportedUser', 'wastages.reportedBy', 'reportedUser.id')
      .leftJoin('users as approvedUser', 'wastages.approvedBy', 'approvedUser.id')
      .where('wastages.id', id)
      .first();
    
    if (!wastage) {
      return res.status(404).json({
        success: false,
        error: 'Wastage not found'
      });
    }
    
    // Parse attachments JSON
    wastage.attachments = wastage.attachments ? JSON.parse(wastage.attachments) : [];
    
    winston.info('Wastage retrieved', {
      wastageId: id,
      companyId: req.user.companyId,
      userId: req.user.id
    });
    
    res.json({
      success: true,
      data: wastage
    });
    
  } catch (error) {
    winston.error('Error fetching wastage', {
      error: error.message,
      wastageId: req.params.id,
      companyId: req.user.companyId,
      userId: req.user.id
    });
    
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// POST /wastages - Create new wastage
router.post('/', 
  requirePermission('CREATE_WASTAGE'),
  validate(wastageSchema),
  async (req, res) => {
    try {
      const db = getDbConnection(req.user.companyId);
      const wastageData = req.body;
      
      // Calculate total cost
      const totalCost = wastageData.quantity * wastageData.unitCost;
      
      // Generate wastage number
      const wastageNumber = generateWastageNumber(req.user.companyId);
      
      // Verify material exists
      const material = await db('materials').where('id', wastageData.materialId).first();
      if (!material) {
        return res.status(400).json({
          success: false,
          error: 'Material not found'
        });
      }
      
      // Verify inventory exists if provided
      if (wastageData.inventoryId) {
        const inventory = await db('inventory')
          .where('id', wastageData.inventoryId)
          .where('materialId', wastageData.materialId)
          .first();
        
        if (!inventory) {
          return res.status(400).json({
            success: false,
            error: 'Inventory record not found or does not match material'
          });
        }
        
        // Check if sufficient quantity available
        if (inventory.currentStock < wastageData.quantity) {
          return res.status(400).json({
            success: false,
            error: 'Insufficient stock available'
          });
        }
      }
      
      const newWastage = {
        wastageNumber,
        materialId: wastageData.materialId,
        inventoryId: wastageData.inventoryId || null,
        quantity: wastageData.quantity,
        unitCost: wastageData.unitCost,
        totalCost,
        wasteType: wastageData.wasteType,
        reason: wastageData.reason || null,
        description: wastageData.description || null,
        wastageDate: wastageData.wastageDate,
        location: wastageData.location || null,
        status: 'pending',
        reportedBy: req.user.id,
        attachments: wastageData.attachments ? JSON.stringify(wastageData.attachments) : null
      };
      
      const [id] = await db('wastages').insert(newWastage);
      
      winston.info('Wastage created', {
        wastageId: id,
        wastageNumber,
        materialId: wastageData.materialId,
        quantity: wastageData.quantity,
        totalCost,
        companyId: req.user.companyId,
        userId: req.user.id
      });
      
      res.status(201).json({
        success: true,
        data: { id, ...newWastage },
        message: 'Wastage record created successfully'
      });
      
    } catch (error) {
      winston.error('Error creating wastage', {
        error: error.message,
        companyId: req.user.companyId,
        userId: req.user.id
      });
      
      if (error.code === 'ER_DUP_ENTRY') {
        res.status(409).json({
          success: false,
          error: 'Wastage number already exists'
        });
      } else {
        res.status(500).json({
          success: false,
          error: 'Internal server error'
        });
      }
    }
  }
);

// PUT /wastages/:id - Update wastage (only if pending)
router.put('/:id',
  requirePermission('EDIT_WASTAGE'),
  validate(updateWastageSchema),
  async (req, res) => {
    try {
      const db = getDbConnection(req.user.companyId);
      const { id } = req.params;
      const updateData = req.body;
      
      // Check if wastage exists and is pending
      const existingWastage = await db('wastages').where('id', id).first();
      
      if (!existingWastage) {
        return res.status(404).json({
          success: false,
          error: 'Wastage not found'
        });
      }
      
      if (existingWastage.status !== 'pending') {
        return res.status(400).json({
          success: false,
          error: 'Cannot update non-pending wastage records'
        });
      }
      
      // Calculate total cost if quantity or unit cost changed
      if (updateData.quantity || updateData.unitCost) {
        const quantity = updateData.quantity || existingWastage.quantity;
        const unitCost = updateData.unitCost || existingWastage.unitCost;
        updateData.totalCost = quantity * unitCost;
      }
      
      // Process attachments
      if (updateData.attachments) {
        updateData.attachments = JSON.stringify(updateData.attachments);
      }
      
      await db('wastages').where('id', id).update({
        ...updateData,
        updated_at: new Date()
      });
      
      winston.info('Wastage updated', {
        wastageId: id,
        companyId: req.user.companyId,
        userId: req.user.id
      });
      
      res.json({
        success: true,
        message: 'Wastage updated successfully'
      });
      
    } catch (error) {
      winston.error('Error updating wastage', {
        error: error.message,
        wastageId: req.params.id,
        companyId: req.user.companyId,
        userId: req.user.id
      });
      
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }
);

// POST /wastages/:id/approve - Approve/Reject wastage
router.post('/:id/approve',
  requirePermission('APPROVE_WASTAGE'),
  validate(approvalSchema),
  async (req, res) => {
    try {
      const TransactionManager = require('../utils/transactionManager');
      const txnManager = new TransactionManager(req.user.companyId);
      
      const { id } = req.params;
      const { status, approvalNotes } = req.body;
      
      // Use enhanced transaction manager for ACID compliance
      const result = await txnManager.processWastageApproval(
        parseInt(id), 
        status, 
        req.user.id, 
        approvalNotes
      );
      
      winston.info('Wastage approval processed with ACID compliance', {
        wastageId: id,
        status,
        totalCost: result.totalCost,
        companyId: req.user.companyId,
        userId: req.user.id,
        approvedBy: req.user.id
      });
      
      res.json({
        success: true,
        data: result,
        message: `Wastage ${status} successfully`
      });
      
    } catch (error) {
      winston.error('Error processing wastage approval', {
        error: error.message,
        wastageId: req.params.id,
        companyId: req.user.companyId,
        userId: req.user.id
      });
      
      res.status(400).json({
        success: false,
        error: error.message || 'Internal server error'
      });
    }
  }
);

// DELETE /wastages/:id - Delete wastage (only if pending)
router.delete('/:id', requirePermission('DELETE_WASTAGE'), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const { id } = req.params;
    
    // Check if wastage exists and is pending
    const existingWastage = await db('wastages').where('id', id).first();
    
    if (!existingWastage) {
      return res.status(404).json({
        success: false,
        error: 'Wastage not found'
      });
    }
    
    if (existingWastage.status !== 'pending') {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete non-pending wastage records'
      });
    }
    
    await db('wastages').where('id', id).del();
    
    winston.info('Wastage deleted', {
      wastageId: id,
      companyId: req.user.companyId,
      userId: req.user.id
    });
    
    res.json({
      success: true,
      message: 'Wastage deleted successfully'
    });
    
  } catch (error) {
    winston.error('Error deleting wastage', {
      error: error.message,
      wastageId: req.params.id,
      companyId: req.user.companyId,
      userId: req.user.id
    });
    
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// GET /wastages/analytics/summary - Get wastage analytics
router.get('/analytics/summary', requirePermission('VIEW_WASTAGE'), async (req, res) => {
  try {
    const repositoryFactory = getRepositoryFactory(req.user.companyId);
    const wastageRepository = repositoryFactory.getWastagesRepository();
    
    const filters = {
      dateFrom: req.query.dateFrom,
      dateTo: req.query.dateTo,
      materialId: req.query.materialId
    };
    
    const analytics = await wastageRepository.getAnalytics(filters);
    
    winston.info('Wastage analytics retrieved using repository pattern', {
      companyId: req.user.companyId,
      userId: req.user.id
    });
    
    res.json({
      success: true,
      data: analytics
    });
    
  } catch (error) {
    winston.error('Error fetching wastage analytics', {
      error: error.message,
      companyId: req.user.companyId,
      userId: req.user.id
    });
    
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

module.exports = router;