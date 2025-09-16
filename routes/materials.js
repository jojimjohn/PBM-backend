const express = require('express');
const { validate, validateParams, sanitize } = require('../middleware/validation');
const { requirePermission } = require('../middleware/auth');
const { logger, auditLog } = require('../utils/logger');
const { getDbConnection } = require('../config/database');
const Joi = require('joi');

const router = express.Router();

// Apply sanitization to all routes
router.use(sanitize);

// Material validation schema
const materialSchema = Joi.object({
  code: Joi.string().max(50).required().trim().uppercase(),
  name: Joi.string().min(2).max(200).required().trim(),
  description: Joi.string().allow('').optional(),
  category_id: Joi.number().integer().positive().required(),
  // Keep category field for backward compatibility but make it optional
  category: Joi.string().optional(),
  unit: Joi.string().max(20).required().default('liters'),
  standardPrice: Joi.number().min(0).precision(3).default(0),
  minimumPrice: Joi.number().min(0).precision(3).default(0),
  density: Joi.number().min(0).precision(4).optional(),
  shelfLifeDays: Joi.number().integer().min(0).optional(),
  specifications: Joi.string().allow('').optional(),
  barcode: Joi.string().max(100).allow('').optional(),
  trackBatches: Joi.boolean().default(false),
  isActive: Joi.boolean().default(true)
});

// GET /api/materials - List all materials
router.get('/', requirePermission('VIEW_INVENTORY'), async (req, res) => {
  try {
    const { companyId } = req.user;
    const db = getDbConnection(companyId);
    
    const { 
      page = 1, 
      limit = 50, 
      search = '', 
      category = '',
      isActive = '',
      trackBatches = ''
    } = req.query;

    const offset = (page - 1) * limit;
    
    let query = db('materials')
      .leftJoin('material_categories', 'materials.category_id', 'material_categories.id')
      .select(
        'materials.*',
        'material_categories.name as categoryName',
        'material_categories.description as categoryDescription',
        'material_categories.business_type as categoryBusinessType'
      );

    // Search filter
    if (search) {
      query = query.where(function() {
        this.where('name', 'like', `%${search}%`)
            .orWhere('code', 'like', `%${search}%`)
            .orWhere('description', 'like', `%${search}%`);
      });
    }

    // Category filter - support both category_id and legacy category name
    if (category) {
      if (!isNaN(category)) {
        // If category is a number, filter by category_id
        query = query.where('materials.category_id', parseInt(category));
      } else {
        // If category is a string, filter by category name (legacy support)
        query = query.where('material_categories.name', category);
      }
    }

    // Active status filter
    if (isActive !== '') {
      query = query.where('isActive', isActive === 'true');
    }

    // Batch tracking filter
    if (trackBatches !== '') {
      query = query.where('trackBatches', trackBatches === 'true');
    }

    // Get total count for pagination
    const totalQuery = query.clone();
    const [{ total }] = await totalQuery.count('* as total');

    // Get paginated results
    const materials = await query
      .orderBy('category', 'asc')
      .orderBy('name', 'asc')
      .limit(limit)
      .offset(offset);

    auditLog('MATERIALS_VIEWED', req.user.userId, {
      companyId,
      count: materials.length,
      filters: { search, category, isActive, trackBatches }
    });

    res.json({
      success: true,
      data: materials,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(total),
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    logger.error('Error fetching materials', { 
      error: error.message, 
      userId: req.user.userId,
      companyId: req.user.companyId
    });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch materials'
    });
  }
});

// GET /api/materials/regions - Get available regions for collection areas
router.get('/regions', requirePermission('VIEW_SUPPLIERS'), async (req, res) => {
  try {
    const { companyId } = req.user;
    const db = getDbConnection(companyId);
    
    const { 
      governorate = '',
      isActive = 'true'
    } = req.query;
    
    let query = db('regions').select('*');
    
    // Filter by governorate if specified
    if (governorate) {
      query = query.where('governorate', governorate);
    }
    
    // Filter by active status
    if (isActive !== '') {
      query = query.where('isActive', isActive === 'true');
    }
    
    const regions = await query.orderBy('governorate', 'asc').orderBy('name', 'asc');

    auditLog('REGIONS_VIEWED', req.user.userId, {
      companyId,
      regionsCount: regions.length,
      governorate
    });

    res.json({
      success: true,
      data: regions,
      message: 'Regions retrieved successfully'
    });

  } catch (error) {
    logger.error('Error fetching regions', { 
      error: error.message, 
      userId: req.user.userId,
      companyId: req.user.companyId
    });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch regions'
    });
  }
});

// GET /api/materials/material-categories - Get available material categories  
router.get('/material-categories', async (req, res) => {
  try {
    console.log('Material categories endpoint hit - user:', req.user?.userId, 'company:', req.user?.companyId, 'query:', req.query);
    const { companyId } = req.user;
    const db = getDbConnection(companyId);
    
    const { 
      business_type = '',
      isActive = 'true'
    } = req.query;
    
    let query = db('material_categories').select('*');
    
    // Filter by business type if specified
    if (business_type) {
      query = query.where(function() {
        this.where('business_type', business_type)
            .orWhere('business_type', 'both');
      });
    }
    
    // Filter by active status
    if (isActive !== '') {
      query = query.where('isActive', isActive === 'true');
    }
    
    const categories = await query.orderBy('sort_order', 'asc');

    auditLog('MATERIAL_CATEGORIES_VIEWED', req.user.userId, {
      companyId,
      categoriesCount: categories.length,
      business_type
    });

    res.json({
      success: true,
      data: categories,
      message: 'Material categories retrieved successfully'
    });

  } catch (error) {
    console.error('Material categories endpoint error:', error);
    logger.error('Error fetching material categories', { 
      error: error.message, 
      userId: req.user?.userId,
      companyId: req.user?.companyId
    });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch material categories'
    });
  }
});

// GET /api/materials/categories - Get available material categories  
router.get('/categories', async (req, res) => {
  try {
    console.log('Categories endpoint hit - user:', req.user?.userId, 'company:', req.user?.companyId, 'query:', req.query);
    const { companyId } = req.user;
    const db = getDbConnection(companyId);
    
    const { 
      business_type = '',
      isActive = 'true'
    } = req.query;
    
    let query = db('material_categories').select('*');
    
    // Filter by business type if specified
    if (business_type) {
      query = query.where(function() {
        this.where('business_type', business_type)
            .orWhere('business_type', 'both');
      });
    }
    
    // Filter by active status
    if (isActive !== '') {
      query = query.where('isActive', isActive === 'true');
    }
    
    const categories = await query.orderBy('sort_order', 'asc');

    auditLog('MATERIAL_CATEGORIES_VIEWED', req.user.userId, {
      companyId,
      categoriesCount: categories.length,
      business_type
    });

    res.json({
      success: true,
      data: categories,
      message: 'Material categories retrieved successfully'
    });

  } catch (error) {
    console.error('Categories endpoint error:', error);
    logger.error('Error fetching material categories', { 
      error: error.message, 
      userId: req.user?.userId,
      companyId: req.user?.companyId
    });
    res.status(400).json({
      success: false,
      error: 'Invalid parameters'
    });
  }
});

// GET /api/materials/:id - Get specific material
router.get('/:id', 
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  requirePermission('VIEW_INVENTORY'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      const material = await db('materials')
        .where({ id })
        .first();

      if (!material) {
        return res.status(404).json({
          success: false,
          error: 'Material not found'
        });
      }

      // Get current inventory levels for this material
      const inventory = await db('inventory')
        .select(
          db.raw('SUM(quantity) as totalQuantity'),
          db.raw('SUM(reservedQuantity) as totalReserved'),
          db.raw('AVG(averageCost) as avgCost')
        )
        .where({ materialId: id, isActive: true })
        .first();

      const materialWithInventory = {
        ...material,
        currentStock: inventory.totalQuantity || 0,
        reservedStock: inventory.totalReserved || 0,
        availableStock: (inventory.totalQuantity || 0) - (inventory.totalReserved || 0),
        averageCost: inventory.avgCost || 0
      };

      auditLog('MATERIAL_VIEWED', req.user.userId, {
        materialId: id,
        materialName: material.name
      });

      res.json({
        success: true,
        data: materialWithInventory
      });

    } catch (error) {
      logger.error('Error fetching material', { 
        error: error.message, 
        materialId: req.params.id,
        userId: req.user.userId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch material'
      });
    }
  }
);

// POST /api/materials - Create new material
router.post('/', 
  validate(materialSchema),
  requirePermission('MANAGE_INVENTORY'),
  async (req, res) => {
    try {
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      // Check if material code already exists
      const existingMaterial = await db('materials')
        .where({ code: req.body.code })
        .first();

      if (existingMaterial) {
        return res.status(400).json({
          success: false,
          error: 'Material with this code already exists'
        });
      }

      // Ensure minimum price doesn't exceed standard price
      if (req.body.minimumPrice > req.body.standardPrice) {
        return res.status(400).json({
          success: false,
          error: 'Minimum price cannot exceed standard price'
        });
      }

      const materialData = {
        ...req.body,
        created_at: new Date(),
        updated_at: new Date()
      };

      const [materialId] = await db('materials').insert(materialData);
      
      const newMaterial = await db('materials')
        .where({ id: materialId })
        .first();

      auditLog('MATERIAL_CREATED', req.user.userId, {
        materialId,
        materialName: newMaterial.name,
        materialCode: newMaterial.code,
        category: newMaterial.category
      });

      logger.info('Material created', {
        materialId,
        materialName: newMaterial.name,
        materialCode: newMaterial.code,
        createdBy: req.user.userId
      });

      res.status(201).json({
        success: true,
        message: 'Material created successfully',
        data: newMaterial
      });

    } catch (error) {
      logger.error('Error creating material', { 
        error: error.message, 
        userId: req.user.userId,
        materialData: req.body
      });
      res.status(500).json({
        success: false,
        error: 'Failed to create material'
      });
    }
  }
);

// PUT /api/materials/:id - Update material
router.put('/:id',
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  validate(materialSchema),
  requirePermission('MANAGE_INVENTORY'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      // Check if material exists
      const existingMaterial = await db('materials')
        .where({ id })
        .first();

      if (!existingMaterial) {
        return res.status(404).json({
          success: false,
          error: 'Material not found'
        });
      }

      // Check if code is being changed to an existing one
      if (req.body.code !== existingMaterial.code) {
        const duplicateMaterial = await db('materials')
          .where({ code: req.body.code })
          .where('id', '!=', id)
          .first();

        if (duplicateMaterial) {
          return res.status(400).json({
            success: false,
            error: 'Material with this code already exists'
          });
        }
      }

      // Ensure minimum price doesn't exceed standard price
      if (req.body.minimumPrice > req.body.standardPrice) {
        return res.status(400).json({
          success: false,
          error: 'Minimum price cannot exceed standard price'
        });
      }

      const updateData = {
        ...req.body,
        updated_at: new Date()
      };

      await db('materials')
        .where({ id })
        .update(updateData);

      const updatedMaterial = await db('materials')
        .where({ id })
        .first();

      auditLog('MATERIAL_UPDATED', req.user.userId, {
        materialId: id,
        materialName: updatedMaterial.name,
        materialCode: updatedMaterial.code,
        changes: Object.keys(req.body)
      });

      logger.info('Material updated', {
        materialId: id,
        materialName: updatedMaterial.name,
        updatedBy: req.user.userId
      });

      res.json({
        success: true,
        message: 'Material updated successfully',
        data: updatedMaterial
      });

    } catch (error) {
      logger.error('Error updating material', { 
        error: error.message, 
        materialId: req.params.id,
        userId: req.user.userId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to update material'
      });
    }
  }
);

// DELETE /api/materials/:id - Delete material
router.delete('/:id',
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  requirePermission('MANAGE_INVENTORY'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      // Check if material exists
      const material = await db('materials')
        .where({ id })
        .first();

      if (!material) {
        return res.status(404).json({
          success: false,
          error: 'Material not found'
        });
      }

      // Check if material has inventory or orders
      const [inventoryCount, orderCount] = await Promise.all([
        db('inventory').where({ materialId: id }).count('* as count').first(),
        db('sales_order_items').where({ materialId: id }).count('* as count').first()
      ]);

      if (inventoryCount.count > 0 || orderCount.count > 0) {
        return res.status(400).json({
          success: false,
          error: 'Cannot delete material with existing inventory or orders. Deactivate instead.'
        });
      }

      // Soft delete by setting isActive to false
      await db('materials')
        .where({ id })
        .update({ 
          isActive: false,
          updated_at: new Date()
        });

      auditLog('MATERIAL_DELETED', req.user.userId, {
        materialId: id,
        materialName: material.name,
        materialCode: material.code
      });

      logger.info('Material deleted (deactivated)', {
        materialId: id,
        materialName: material.name,
        deletedBy: req.user.userId
      });

      res.json({
        success: true,
        message: 'Material deactivated successfully'
      });

    } catch (error) {
      logger.error('Error deleting material', { 
        error: error.message, 
        materialId: req.params.id,
        userId: req.user.userId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to delete material'
      });
    }
  }
);

module.exports = router;