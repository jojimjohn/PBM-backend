const express = require('express');
const { validate, validateParams, sanitize } = require('../middleware/validation');
const { requirePermission } = require('../middleware/auth');
const { logger, auditLog } = require('../utils/logger');
const { getDbConnection } = require('../config/database');
const { uploadMultipleToS3, requireFiles } = require('../middleware/upload');
const storageService = require('../services/storageService');
const { materialAttachments } = require('../repositories/AttachmentRepository');
const { cacheService, generateCacheKey } = require('../utils/cache');
const Joi = require('joi');

const router = express.Router();

// Apply sanitization to all routes
router.use(sanitize);

// Valid waste types for disposable materials
const WASTE_TYPES = [
  'waste', 'spillage', 'contamination', 'expiry', 'damage',
  'theft', 'evaporation', 'sorting_loss', 'quality_rejection',
  'transport_loss', 'handling_damage', 'other'
];

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
  density: Joi.number().min(0).precision(4).allow(null).optional(),
  shelfLifeDays: Joi.number().integer().min(0).allow(null).optional(),
  specifications: Joi.string().allow('').optional(),
  barcode: Joi.string().max(100).allow('').optional(),
  trackBatches: Joi.boolean().default(false),
  isActive: Joi.boolean().default(true),
  is_composite: Joi.boolean().default(false),
  // Disposable material fields - for materials that auto-convert to wastage
  is_disposable: Joi.boolean().default(false),
  default_waste_type: Joi.string().valid(...WASTE_TYPES).allow(null).optional(),
  auto_wastage_percentage: Joi.number().min(0).max(100).precision(2).default(100),
  compositions: Joi.array().items(
    Joi.object({
      component_material_id: Joi.number().integer().positive().required(),
      component_type: Joi.string().valid('container', 'content').required(),
      capacity: Joi.number().min(0).precision(3).allow(null).optional(),
      capacity_unit: Joi.string().max(20).allow('', null).optional(),
      is_active: Joi.alternatives().try(Joi.boolean(), Joi.number().valid(0, 1)).default(true)
    })
  ).optional()
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
// PERFORMANCE: Uses caching since categories rarely change
router.get('/material-categories', async (req, res) => {
  try {
    const { companyId } = req.user;
    const db = getDbConnection(companyId);

    const {
      business_type = '',
      isActive = 'true'
    } = req.query;

    // PERFORMANCE: Check cache first
    const cacheKey = `${companyId}:categories:${business_type}:${isActive}`;
    const cached = await cacheService.get('categories', cacheKey);
    if (cached) {
      return res.json(cached);
    }

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

    const response = {
      success: true,
      data: categories,
      message: 'Material categories retrieved successfully'
    };

    // PERFORMANCE: Cache for 10 minutes (categories rarely change)
    await cacheService.set('categories', cacheKey, response);

    res.json(response);

  } catch (error) {
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
// PERFORMANCE: Uses caching since categories rarely change (alias endpoint)
router.get('/categories', async (req, res) => {
  try {
    const { companyId } = req.user;
    const db = getDbConnection(companyId);

    const {
      business_type = '',
      isActive = 'true'
    } = req.query;

    // PERFORMANCE: Check cache first (same cache key as material-categories)
    const cacheKey = `${companyId}:categories:${business_type}:${isActive}`;
    const cached = await cacheService.get('categories', cacheKey);
    if (cached) {
      return res.json(cached);
    }

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

    const response = {
      success: true,
      data: categories,
      message: 'Material categories retrieved successfully'
    };

    // PERFORMANCE: Cache for 10 minutes
    await cacheService.set('categories', cacheKey, response);

    res.json(response);

  } catch (error) {
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

      // Get composition components if this is a composite material
      const compositions = await db('material_compositions')
        .leftJoin('materials as component', 'material_compositions.component_material_id', 'component.id')
        .select(
          'material_compositions.*',
          'component.name as component_material_name',
          'component.code as component_material_code'
        )
        .where('material_compositions.composite_material_id', id)
        .where('material_compositions.is_active', 1)
        .orderBy('material_compositions.component_type', 'desc'); // content first, then container

      const materialWithInventory = {
        ...material,
        currentStock: inventory.totalQuantity || 0,
        reservedStock: inventory.totalReserved || 0,
        availableStock: (inventory.totalQuantity || 0) - (inventory.totalReserved || 0),
        averageCost: inventory.avgCost || 0,
        is_composite: compositions.length > 0,
        compositions: compositions
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

      // Extract compositions before creating material data
      const { compositions, ...materialFields } = req.body;

      const materialData = {
        ...materialFields,
        created_at: new Date(),
        updated_at: new Date()
      };

      const [materialId] = await db('materials').insert(materialData);

      // If this is a composite material, create compositions
      if (req.body.is_composite && compositions && compositions.length > 0) {
        const compositionData = compositions.map(comp => ({
          composite_material_id: materialId,
          component_material_id: comp.component_material_id,
          component_type: comp.component_type,
          capacity: comp.capacity || null,
          capacity_unit: comp.capacity_unit || null,
          is_active: comp.is_active !== undefined ? comp.is_active : 1,
          created_at: new Date(),
          updated_at: new Date()
        }));

        await db('material_compositions').insert(compositionData);
      }

      const newMaterial = await db('materials')
        .where({ id: materialId })
        .first();

      auditLog('MATERIAL_CREATED', req.user.userId, {
        materialId,
        materialName: newMaterial.name,
        materialCode: newMaterial.code,
        category: newMaterial.category,
        is_composite: newMaterial.is_composite
      });

      logger.info('Material created', {
        materialId,
        materialName: newMaterial.name,
        materialCode: newMaterial.code,
        createdBy: req.user.userId,
        is_composite: newMaterial.is_composite
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

      // Extract compositions before updating material data
      const { compositions, ...materialFields } = req.body;

      const updateData = {
        ...materialFields,
        updated_at: new Date()
      };

      await db('materials')
        .where({ id })
        .update(updateData);

      // Update compositions if this is a composite material
      if (req.body.is_composite) {
        // Delete existing compositions
        await db('material_compositions')
          .where({ composite_material_id: id })
          .delete();

        // Insert new compositions if provided
        if (compositions && compositions.length > 0) {
          const compositionData = compositions.map(comp => ({
            composite_material_id: id,
            component_material_id: comp.component_material_id,
            component_type: comp.component_type,
            capacity: comp.capacity || null,
            capacity_unit: comp.capacity_unit || null,
            is_active: comp.is_active !== undefined ? comp.is_active : 1,
            created_at: new Date(),
            updated_at: new Date()
          }));

          await db('material_compositions').insert(compositionData);
        }
      } else {
        // If changing from composite to standard, delete compositions
        await db('material_compositions')
          .where({ composite_material_id: id })
          .delete();
      }

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

// ============================================================================
// ATTACHMENT ROUTES (S3/MinIO)
// ============================================================================

// POST /api/materials/:id/attachments - Upload attachments to material
router.post('/:id/attachments',
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  requirePermission('MANAGE_MATERIALS'),
  uploadMultipleToS3,
  requireFiles,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { companyId, userId } = req.user;
      const db = getDbConnection(companyId);

      // Check if material exists
      const material = await db('materials').where({ id }).first();

      if (!material) {
        // Delete uploaded S3 files if material doesn't exist
        if (req.files && req.files.length > 0) {
          await Promise.all(req.files.map(file =>
            storageService.deleteFile(file.key).catch(err =>
              logger.warn('Failed to delete orphaned S3 file', { key: file.key, error: err.message })
            )
          ));
        }
        return res.status(404).json({
          success: false,
          error: 'Material not found'
        });
      }

      // Save attachment metadata to database
      const savedAttachments = [];
      for (const file of req.files) {
        const attachment = await materialAttachments.create(db, {
          material_id: id,
          file_key: file.key,
          file_name: file.originalname,
          file_size: file.size,
          mime_type: file.mimetype,
          uploaded_by: userId
        });
        savedAttachments.push(attachment);
      }

      auditLog('MATERIAL_ATTACHMENTS_UPLOADED', userId, {
        materialId: id,
        materialName: material.name,
        filesCount: req.files.length,
        attachmentIds: savedAttachments.map(a => a.id)
      });

      res.json({
        success: true,
        data: savedAttachments,
        message: `${req.files.length} file(s) uploaded successfully`
      });

    } catch (error) {
      logger.error('Error uploading material attachments', {
        error: error.message,
        materialId: req.params.id,
        userId: req.user.userId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to upload attachments'
      });
    }
  }
);

// GET /api/materials/:id/attachments - Get attachments for material
router.get('/:id/attachments',
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  requirePermission('VIEW_MATERIALS'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      // Verify material exists
      const material = await db('materials').where({ id }).first();

      if (!material) {
        return res.status(404).json({
          success: false,
          error: 'Material not found'
        });
      }

      // Get attachments from repository
      const attachments = await materialAttachments.findByEntity(db, id);

      // Generate presigned URLs for each attachment
      const attachmentsWithUrls = await Promise.all(
        attachments.map(async (attachment) => {
          try {
            const url = await storageService.getPresignedUrl(attachment.file_key);
            return { ...attachment, url };
          } catch (err) {
            logger.warn('Failed to generate presigned URL', {
              attachmentId: attachment.id,
              fileKey: attachment.file_key,
              error: err.message
            });
            return { ...attachment, url: null };
          }
        })
      );

      res.json({
        success: true,
        data: attachmentsWithUrls
      });

    } catch (error) {
      logger.error('Error fetching material attachments', {
        error: error.message,
        materialId: req.params.id,
        userId: req.user.userId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch attachments'
      });
    }
  }
);

// DELETE /api/materials/:id/attachments/:fileId - Delete attachment from material
router.delete('/:id/attachments/:fileId',
  validateParams(Joi.object({
    id: Joi.number().integer().positive().required(),
    fileId: Joi.number().integer().positive().required()
  })),
  requirePermission('MANAGE_MATERIALS'),
  async (req, res) => {
    try {
      const { id, fileId } = req.params;
      const { companyId, userId } = req.user;
      const db = getDbConnection(companyId);

      // Verify material exists
      const material = await db('materials').where({ id }).first();

      if (!material) {
        return res.status(404).json({
          success: false,
          error: 'Material not found'
        });
      }

      // Get attachment record from repository
      const attachment = await materialAttachments.findById(db, fileId);

      if (!attachment || attachment.material_id !== parseInt(id)) {
        return res.status(404).json({
          success: false,
          error: 'Attachment not found'
        });
      }

      // Delete file from S3
      await storageService.deleteFile(attachment.file_key);

      // Delete record from database
      await materialAttachments.delete(db, fileId);

      auditLog('MATERIAL_ATTACHMENT_DELETED', userId, {
        materialId: id,
        materialName: material.name,
        attachmentId: fileId,
        fileName: attachment.file_name
      });

      res.json({
        success: true,
        message: 'Attachment deleted successfully'
      });

    } catch (error) {
      logger.error('Error deleting material attachment', {
        error: error.message,
        materialId: req.params.id,
        fileId: req.params.fileId,
        userId: req.user.userId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to delete attachment'
      });
    }
  }
);

module.exports = router;