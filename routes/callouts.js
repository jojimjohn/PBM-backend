const express = require('express');
const { validate, validateParams, sanitize } = require('../middleware/validation');
const { requirePermission } = require('../middleware/auth');
const { logger, auditLog } = require('../utils/logger');
const { getDbConnection } = require('../config/database');
const Joi = require('joi');

const router = express.Router();

// Apply sanitization to all routes
router.use(sanitize);

// Collection Callout validation schema
const calloutSchema = Joi.object({
  contractId: Joi.number().integer().positive().required(),
  supplierId: Joi.number().integer().positive().required(),
  locationId: Joi.number().integer().positive().required(),
  requestedPickupDate: Joi.date().min('now').required(),
  priority: Joi.string().valid('low', 'normal', 'high', 'urgent').default('normal'),
  contactPerson: Joi.string().max(100).allow('').optional(),
  contactPhone: Joi.string().max(20).allow('').optional(),
  specialInstructions: Joi.string().allow('').optional(),
  estimatedDuration: Joi.number().integer().min(15).max(480).optional(), // 15 minutes to 8 hours
  notes: Joi.string().allow('').optional(),
  assignedTo: Joi.number().integer().positive().optional()
});

// Callout Item validation schema
const calloutItemSchema = Joi.object({
  materialId: Joi.number().integer().positive().required(),
  availableQuantity: Joi.number().min(0.001).precision(3).required(),
  unit: Joi.string().max(20).required(),
  condition: Joi.string().valid('excellent', 'good', 'fair', 'poor', 'mixed').default('good'),
  estimatedValue: Joi.number().min(0).precision(2).optional(),
  notes: Joi.string().allow('').optional()
});

// GET /api/callouts - List all collection callouts
router.get('/', requirePermission('VIEW_PURCHASE'), async (req, res) => {
  try {
    const { companyId } = req.user;
    const db = getDbConnection(companyId);
    
    const { 
      page = 1, 
      limit = 50, 
      status = '',
      priority = '',
      supplierId = '',
      contractId = '',
      assignedTo = '',
      fromDate = '',
      toDate = ''
    } = req.query;

    const offset = (page - 1) * limit;
    
    // Check if collection_callouts table exists and has data
    const tableExists = await db.schema.hasTable('collection_callouts');
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

    let query = db('collection_callouts')
      .select(
        'collection_callouts.*',
        db.raw('NULL as contractNumber'),
        db.raw('NULL as contractTitle'),
        db.raw('NULL as supplierName'),
        db.raw('NULL as supplierContact'),
        db.raw('NULL as locationName'),
        db.raw('NULL as locationAddress'),
        db.raw('NULL as assignedUserName'),
        db.raw('NULL as createdByName'),
        db.raw('0 as itemCount'),
        db.raw('0 as totalQuantity')
      );

    // Status filter
    if (status) {
      query = query.where('collection_callouts.status', status);
    }

    // Priority filter
    if (priority) {
      query = query.where('collection_callouts.priority', priority);
    }

    // Supplier filter
    if (supplierId) {
      query = query.where('collection_callouts.supplierId', supplierId);
    }

    // Contract filter
    if (contractId) {
      query = query.where('collection_callouts.contractId', contractId);
    }

    // Assigned user filter
    if (assignedTo) {
      query = query.where('collection_callouts.assignedTo', assignedTo);
    }

    // Date range filter
    if (fromDate) {
      query = query.where('collection_callouts.calloutDate', '>=', fromDate);
    }
    if (toDate) {
      query = query.where('collection_callouts.calloutDate', '<=', toDate);
    }

    // Get total count for pagination
    const totalQuery = query.clone();
    const [{ total }] = await totalQuery.count('* as total');

    // Get paginated results
    const callouts = await query
      .orderBy('collection_callouts.calloutDate', 'desc')
      .orderBy('collection_callouts.priority', 'desc')
      .limit(limit)
      .offset(offset);

    auditLog('CALLOUTS_VIEWED', req.user.userId, {
      companyId,
      count: callouts.length,
      filters: { status, priority, supplierId, contractId, assignedTo }
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

// GET /api/callouts/:id - Get specific callout with items
router.get('/:id', 
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  requirePermission('VIEW_PURCHASE'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      // Get callout details
      const callout = await db('collection_callouts')
        .leftJoin('contracts', 'collection_callouts.contractId', 'contracts.id')
        .leftJoin('suppliers', 'collection_callouts.supplierId', 'suppliers.id')
        .leftJoin('contract_locations', 'collection_callouts.locationId', 'contract_locations.id')
        .leftJoin('users as assigned_users', 'collection_callouts.assignedTo', 'assigned_users.id')
        .leftJoin('users as created_users', 'collection_callouts.createdBy', 'created_users.id')
        .select(
          'collection_callouts.*',
          'contracts.contractNumber',
          'contracts.title as contractTitle',
          'contracts.startDate as contractStartDate',
          'contracts.endDate as contractEndDate',
          'suppliers.name as supplierName',
          'suppliers.contactPerson as supplierContact',
          'suppliers.phone as supplierPhone',
          'suppliers.address as supplierAddress',
          'contract_locations.locationName',
          'contract_locations.address as locationAddress',
          'contract_locations.contactPerson as locationContact',
          'contract_locations.contactPhone as locationPhone',
          'contract_locations.coordinates',
          'assigned_users.name as assignedUserName',
          'assigned_users.phone as assignedUserPhone',
          'created_users.name as createdByName'
        )
        .where('collection_callouts.id', id)
        .first();

      if (!callout) {
        return res.status(404).json({
          success: false,
          error: 'Callout not found'
        });
      }

      // Get callout items with material details and contract rates
      const items = await db('callout_items')
        .leftJoin('materials', 'callout_items.materialId', 'materials.id')
        .leftJoin('contract_location_rates', function() {
          this.on('contract_location_rates.materialId', '=', 'callout_items.materialId')
              .andOn('contract_location_rates.locationId', '=', callout.locationId)
              .andOn('contract_location_rates.contractId', '=', callout.contractId)
              .andOn('contract_location_rates.isActive', '=', db.raw('TRUE'));
        })
        .select(
          'callout_items.*',
          'materials.name as materialName',
          'materials.code as materialCode',
          'materials.unit as materialUnit',
          'materials.category as materialCategory',
          'materials.standardPrice',
          'contract_location_rates.rateType',
          'contract_location_rates.contractRate',
          'contract_location_rates.paymentDirection',
          'contract_location_rates.minimumQuantity',
          'contract_location_rates.maximumQuantity'
        )
        .where('callout_items.calloutId', id)
        .orderBy('materials.name');

      auditLog('CALLOUT_VIEWED', req.user.userId, {
        calloutId: id,
        calloutNumber: callout.calloutNumber,
        supplierName: callout.supplierName,
        locationName: callout.locationName
      });

      res.json({
        success: true,
        data: {
          ...callout,
          items
        }
      });

    } catch (error) {
      logger.error('Error fetching callout', { 
        error: error.message, 
        calloutId: req.params.id,
        userId: req.user.userId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch callout'
      });
    }
  }
);

// POST /api/callouts - Create new callout
router.post('/', 
  validate(calloutSchema),
  requirePermission('CREATE_PURCHASE'),
  async (req, res) => {
    try {
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      // Validate contract exists and is active
      const contract = await db('contracts')
        .leftJoin('suppliers', 'contracts.supplierId', 'suppliers.id')
        .select(
          'contracts.*',
          'suppliers.name as supplierName'
        )
        .where('contracts.id', req.body.contractId)
        .where('contracts.status', 'active')
        .first();

      if (!contract) {
        return res.status(400).json({
          success: false,
          error: 'Contract not found or not active'
        });
      }

      // Validate location exists for this contract
      const location = await db('contract_locations')
        .where({
          id: req.body.locationId,
          contractId: req.body.contractId,
          isActive: true
        })
        .first();

      if (!location) {
        return res.status(400).json({
          success: false,
          error: 'Location not found or not active for this contract'
        });
      }

      // Generate callout number
      const calloutNumber = `CO-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

      const calloutData = {
        ...req.body,
        calloutNumber,
        createdBy: req.user.userId,
        created_at: new Date(),
        updated_at: new Date()
      };

      const [calloutId] = await db('collection_callouts').insert(calloutData);
      
      const newCallout = await db('collection_callouts')
        .leftJoin('contracts', 'collection_callouts.contractId', 'contracts.id')
        .leftJoin('suppliers', 'collection_callouts.supplierId', 'suppliers.id')
        .leftJoin('contract_locations', 'collection_callouts.locationId', 'contract_locations.id')
        .select(
          'collection_callouts.*',
          'contracts.contractNumber',
          'suppliers.name as supplierName',
          'contract_locations.locationName'
        )
        .where('collection_callouts.id', calloutId)
        .first();

      auditLog('CALLOUT_CREATED', req.user.userId, {
        calloutId,
        calloutNumber: newCallout.calloutNumber,
        contractNumber: newCallout.contractNumber,
        supplierName: newCallout.supplierName,
        locationName: newCallout.locationName
      });

      logger.info('Collection callout created', {
        calloutId,
        calloutNumber: newCallout.calloutNumber,
        createdBy: req.user.userId
      });

      res.status(201).json({
        success: true,
        message: 'Collection callout created successfully',
        data: newCallout
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

// POST /api/callouts/:id/items - Add item to callout
router.post('/:id/items',
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  validate(calloutItemSchema),
  requirePermission('CREATE_PURCHASE'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      // Verify callout exists and is editable
      const callout = await db('collection_callouts')
        .where({ id })
        .whereIn('status', ['pending', 'scheduled'])
        .first();

      if (!callout) {
        return res.status(404).json({
          success: false,
          error: 'Callout not found or not editable'
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

      // Check if item already exists for this material
      const existingItem = await db('callout_items')
        .where({ 
          calloutId: id, 
          materialId: req.body.materialId
        })
        .first();

      if (existingItem) {
        return res.status(400).json({
          success: false,
          error: 'Item already exists for this material in this callout'
        });
      }

      const itemData = {
        ...req.body,
        calloutId: id,
        created_at: new Date()
      };

      const [itemId] = await db('callout_items').insert(itemData);
      
      const newItem = await db('callout_items')
        .leftJoin('materials', 'callout_items.materialId', 'materials.id')
        .select(
          'callout_items.*',
          'materials.name as materialName',
          'materials.code as materialCode',
          'materials.unit as materialUnit'
        )
        .where('callout_items.id', itemId)
        .first();

      auditLog('CALLOUT_ITEM_ADDED', req.user.userId, {
        calloutId: id,
        itemId,
        materialName: newItem.materialName,
        availableQuantity: newItem.availableQuantity
      });

      res.status(201).json({
        success: true,
        message: 'Item added to callout successfully',
        data: newItem
      });

    } catch (error) {
      logger.error('Error adding callout item', { 
        error: error.message, 
        calloutId: req.params.id,
        userId: req.user.userId,
        itemData: req.body
      });
      res.status(500).json({
        success: false,
        error: 'Failed to add callout item'
      });
    }
  }
);

// PATCH /api/callouts/:id/status - Update callout status
router.patch('/:id/status',
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  validate(Joi.object({
    status: Joi.string().valid('pending', 'scheduled', 'in_progress', 'completed', 'cancelled').required(),
    notes: Joi.string().allow('').optional(),
    assignedTo: Joi.number().integer().positive().optional()
  })),
  requirePermission('EDIT_PURCHASE'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { status, notes, assignedTo } = req.body;
      const { companyId, userId } = req.user;
      const db = getDbConnection(companyId);

      const callout = await db('collection_callouts')
        .where({ id })
        .first();

      if (!callout) {
        return res.status(404).json({
          success: false,
          error: 'Callout not found'
        });
      }

      const updateData = {
        status: status,
        updated_at: new Date()
      };

      if (assignedTo) {
        updateData.assignedTo = assignedTo;
      }

      if (notes) {
        updateData.notes = callout.notes ? `${callout.notes}\nStatus Update: ${notes}` : notes;
      }

      await db('collection_callouts')
        .where({ id })
        .update(updateData);

      auditLog('CALLOUT_STATUS_CHANGED', userId, {
        calloutId: id,
        calloutNumber: callout.calloutNumber,
        fromStatus: callout.status,
        toStatus: status,
        assignedTo,
        notes
      });

      res.json({
        success: true,
        message: `Callout status updated to ${status} successfully`
      });

    } catch (error) {
      logger.error('Error updating callout status', { 
        error: error.message, 
        calloutId: req.params.id,
        userId: req.user.userId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to update callout status'
      });
    }
  }
);

// GET /api/callouts/active - Get active callouts for dashboard
router.get('/active/summary', 
  requirePermission('VIEW_PURCHASE'),
  async (req, res) => {
    try {
      const { companyId } = req.user;
      const db = getDbConnection(companyId);
      
      const activeCallouts = await db('collection_callouts')
        .leftJoin('contracts', 'collection_callouts.contractId', 'contracts.id')
        .leftJoin('suppliers', 'collection_callouts.supplierId', 'suppliers.id')
        .leftJoin('contract_locations', 'collection_callouts.locationId', 'contract_locations.id')
        .select(
          'collection_callouts.*',
          'contracts.contractNumber',
          'suppliers.name as supplierName',
          'contract_locations.locationName',
          db.raw('(SELECT COUNT(*) FROM callout_items WHERE callout_items.calloutId = collection_callouts.id) as itemCount')
        )
        .whereIn('collection_callouts.status', ['pending', 'scheduled', 'in_progress'])
        .orderBy('collection_callouts.priority', 'desc')
        .orderBy('collection_callouts.requestedPickupDate', 'asc')
        .limit(20);

      // Get summary statistics
      const stats = await db('collection_callouts')
        .select(
          db.raw('COUNT(*) as totalActive'),
          db.raw('SUM(CASE WHEN status = "pending" THEN 1 ELSE 0 END) as pending'),
          db.raw('SUM(CASE WHEN status = "scheduled" THEN 1 ELSE 0 END) as scheduled'),
          db.raw('SUM(CASE WHEN status = "in_progress" THEN 1 ELSE 0 END) as inProgress'),
          db.raw('SUM(CASE WHEN priority = "urgent" THEN 1 ELSE 0 END) as urgent'),
          db.raw('SUM(CASE WHEN priority = "high" THEN 1 ELSE 0 END) as high')
        )
        .whereIn('status', ['pending', 'scheduled', 'in_progress'])
        .first();

      res.json({
        success: true,
        data: {
          callouts: activeCallouts,
          statistics: stats
        }
      });

    } catch (error) {
      logger.error('Error fetching active callouts', { 
        error: error.message, 
        userId: req.user.userId,
        companyId: req.user.companyId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch active callouts'
      });
    }
  }
);

module.exports = router;