const express = require('express');
const router = express.Router();
const { getDbConnection } = require('../config/database');
const { requirePermission } = require('../middleware/auth');
const { validate, validateParams } = require('../middleware/validation');
const Joi = require('joi');
const { logger, auditLog } = require('../utils/logger');

// Validation schemas
const compositionSchema = Joi.object({
  composite_material_id: Joi.number().integer().positive().required(),
  component_material_id: Joi.number().integer().positive().required(),
  component_type: Joi.string().valid('container', 'content').required(),
  capacity: Joi.number().min(0).precision(3).allow(null).optional(),
  capacity_unit: Joi.string().min(1).max(20).allow('', null).optional(),
  is_active: Joi.alternatives().try(Joi.boolean(), Joi.number().valid(0, 1)).optional()
}).options({ stripUnknown: true });

const updateCompositionSchema = compositionSchema.fork(
  ['composite_material_id', 'component_material_id', 'component_type'],
  (schema) => schema.optional()
).options({ stripUnknown: true });

// GET /api/material-compositions - List all compositions
// Using VIEW_INVENTORY permission since this is needed for inventory page filtering
router.get('/', requirePermission('VIEW_INVENTORY'), async (req, res) => {
  try {
    const { companyId } = req.user;
    const db = getDbConnection(companyId);

    const {
      composite_material_id,
      component_material_id,
      is_active
    } = req.query;

    let query = db('material_compositions')
      .leftJoin('materials as composite', 'material_compositions.composite_material_id', 'composite.id')
      .leftJoin('materials as component', 'material_compositions.component_material_id', 'component.id')
      .select(
        'material_compositions.*',
        'composite.name as composite_material_name',
        'composite.code as composite_material_code',
        'component.name as component_material_name',
        'component.code as component_material_code'
      )
      .orderBy('material_compositions.composite_material_id', 'asc')
      .orderBy('material_compositions.component_type', 'desc'); // content first, then container

    // Filter by composite material
    if (composite_material_id) {
      query = query.where('material_compositions.composite_material_id', composite_material_id);
    }

    // Filter by component material
    if (component_material_id) {
      query = query.where('material_compositions.component_material_id', component_material_id);
    }

    // Filter by active status
    if (is_active !== undefined) {
      query = query.where('material_compositions.is_active', is_active === 'true' ? 1 : 0);
    }

    const compositions = await query;

    auditLog('COMPOSITIONS_VIEWED', req.user.userId, {
      companyId,
      count: compositions.length,
      filters: { composite_material_id, component_material_id, is_active }
    });

    res.json({
      success: true,
      data: compositions,
      total: compositions.length
    });

  } catch (error) {
    logger.error('Error fetching compositions', {
      error: error.message,
      companyId: req.user.companyId,
      userId: req.user.userId
    });

    res.status(500).json({
      success: false,
      error: 'Failed to fetch compositions'
    });
  }
});

// GET /api/material-compositions/:id - Get single composition
router.get('/:id',
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  requirePermission('VIEW_INVENTORY'),
  async (req, res) => {
    try {
      const { companyId } = req.user;
      const { id } = req.params;
      const db = getDbConnection(companyId);

      const composition = await db('material_compositions')
        .leftJoin('materials as composite', 'material_compositions.composite_material_id', 'composite.id')
        .leftJoin('materials as component', 'material_compositions.component_material_id', 'component.id')
        .select(
          'material_compositions.*',
          'composite.name as composite_material_name',
          'composite.code as composite_material_code',
          'component.name as component_material_name',
          'component.code as component_material_code'
        )
        .where('material_compositions.id', id)
        .first();

      if (!composition) {
        return res.status(404).json({
          success: false,
          error: 'Composition not found'
        });
      }

      res.json({
        success: true,
        data: composition
      });

    } catch (error) {
      logger.error('Error fetching composition', {
        error: error.message,
        compositionId: req.params.id,
        companyId: req.user.companyId,
        userId: req.user.userId
      });

      res.status(500).json({
        success: false,
        error: 'Failed to fetch composition'
      });
    }
});

// GET /api/material-compositions/by-composite/:materialId - Get all components for a composite material
router.get('/by-composite/:materialId',
  validateParams(Joi.object({ materialId: Joi.number().integer().positive().required() })),
  requirePermission('VIEW_INVENTORY'),
  async (req, res) => {
    try {
      const { companyId } = req.user;
      const { materialId } = req.params;
      const db = getDbConnection(companyId);

      const components = await db('material_compositions')
        .leftJoin('materials', 'material_compositions.component_material_id', 'materials.id')
        .select(
          'material_compositions.*',
          'materials.name as component_material_name',
          'materials.code as component_material_code',
          'materials.unit as component_material_unit'
        )
        .where('material_compositions.composite_material_id', materialId)
        .where('material_compositions.is_active', 1)
        .orderBy('material_compositions.component_type', 'desc'); // content first, then container

      res.json({
        success: true,
        data: components
      });

    } catch (error) {
      logger.error('Error fetching composition components', {
        error: error.message,
        materialId: req.params.materialId,
        companyId: req.user.companyId,
        userId: req.user.userId
      });

      res.status(500).json({
        success: false,
        error: 'Failed to fetch composition components'
      });
    }
});

// POST /api/material-compositions - Create new composition
router.post('/',
  validate(compositionSchema),
  requirePermission('MANAGE_SETTINGS'),
  async (req, res) => {
    try {
      const { userId } = req.user;
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      // Validate that composite and component materials exist
      const compositeMaterial = await db('materials')
        .where({ id: req.body.composite_material_id })
        .first();

      const componentMaterial = await db('materials')
        .where({ id: req.body.component_material_id })
        .first();

      if (!compositeMaterial) {
        return res.status(400).json({
          success: false,
          error: 'Composite material not found'
        });
      }

      if (!componentMaterial) {
        return res.status(400).json({
          success: false,
          error: 'Component material not found'
        });
      }

      // Check for duplicate composition
      const existingComposition = await db('material_compositions')
        .where({
          composite_material_id: req.body.composite_material_id,
          component_material_id: req.body.component_material_id,
          component_type: req.body.component_type
        })
        .first();

      if (existingComposition) {
        return res.status(400).json({
          success: false,
          error: 'This composition already exists'
        });
      }

      const compositionData = {
        ...req.body,
        created_at: new Date(),
        updated_at: new Date()
      };

      const [compositionId] = await db('material_compositions').insert(compositionData);

      const newComposition = await db('material_compositions')
        .leftJoin('materials as composite', 'material_compositions.composite_material_id', 'composite.id')
        .leftJoin('materials as component', 'material_compositions.component_material_id', 'component.id')
        .select(
          'material_compositions.*',
          'composite.name as composite_material_name',
          'composite.code as composite_material_code',
          'component.name as component_material_name',
          'component.code as component_material_code'
        )
        .where('material_compositions.id', compositionId)
        .first();

      auditLog('COMPOSITION_CREATED', userId, {
        compositionId,
        compositeMaterial: compositeMaterial.name,
        componentMaterial: componentMaterial.name,
        componentType: req.body.component_type,
        quantity: req.body.quantity_per_unit,
        companyId
      });

      logger.info('Composition created', {
        compositionId,
        compositeMaterialId: req.body.composite_material_id,
        componentMaterialId: req.body.component_material_id,
        companyId,
        userId
      });

      res.status(201).json({
        success: true,
        message: 'Composition created successfully',
        data: newComposition
      });

    } catch (error) {
      logger.error('Error creating composition', {
        error: error.message,
        compositionData: req.body,
        companyId: req.user.companyId,
        userId: req.user.userId
      });

      res.status(500).json({
        success: false,
        error: 'Failed to create composition'
      });
    }
});

// PUT /api/material-compositions/:id - Update composition
router.put('/:id',
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  validate(updateCompositionSchema),
  requirePermission('MANAGE_SETTINGS'),
  async (req, res) => {
    try {
      const { userId } = req.user;
      const { companyId } = req.user;
      const { id } = req.params;
      const db = getDbConnection(companyId);

      // Check if composition exists
      const existingComposition = await db('material_compositions')
        .where({ id })
        .first();

      if (!existingComposition) {
        return res.status(404).json({
          success: false,
          error: 'Composition not found'
        });
      }

      const updateData = {
        ...req.body,
        updated_at: new Date()
      };

      await db('material_compositions')
        .where({ id })
        .update(updateData);

      const updatedComposition = await db('material_compositions')
        .leftJoin('materials as composite', 'material_compositions.composite_material_id', 'composite.id')
        .leftJoin('materials as component', 'material_compositions.component_material_id', 'component.id')
        .select(
          'material_compositions.*',
          'composite.name as composite_material_name',
          'composite.code as composite_material_code',
          'component.name as component_material_name',
          'component.code as component_material_code'
        )
        .where('material_compositions.id', id)
        .first();

      auditLog('COMPOSITION_UPDATED', userId, {
        compositionId: id,
        changes: updateData,
        companyId
      });

      logger.info('Composition updated', {
        compositionId: id,
        companyId,
        userId
      });

      res.json({
        success: true,
        message: 'Composition updated successfully',
        data: updatedComposition
      });

    } catch (error) {
      logger.error('Error updating composition', {
        error: error.message,
        compositionId: req.params.id,
        compositionData: req.body,
        companyId: req.user.companyId,
        userId: req.user.userId
      });

      res.status(500).json({
        success: false,
        error: 'Failed to update composition'
      });
    }
});

// DELETE /api/material-compositions/:id - Delete composition
router.delete('/:id',
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  requirePermission('MANAGE_SETTINGS'),
  async (req, res) => {
    try {
      const { userId } = req.user;
      const { companyId } = req.user;
      const { id } = req.params;
      const db = getDbConnection(companyId);

      const composition = await db('material_compositions')
        .where({ id })
        .first();

      if (!composition) {
        return res.status(404).json({
          success: false,
          error: 'Composition not found'
        });
      }

      await db('material_compositions')
        .where({ id })
        .delete();

      auditLog('COMPOSITION_DELETED', userId, {
        compositionId: id,
        compositeMaterialId: composition.composite_material_id,
        componentMaterialId: composition.component_material_id,
        companyId
      });

      logger.info('Composition deleted', {
        compositionId: id,
        companyId,
        userId
      });

      res.json({
        success: true,
        message: 'Composition deleted successfully'
      });

    } catch (error) {
      logger.error('Error deleting composition', {
        error: error.message,
        compositionId: req.params.id,
        companyId: req.user.companyId,
        userId: req.user.userId
      });

      res.status(500).json({
        success: false,
        error: 'Failed to delete composition'
      });
    }
});

module.exports = router;
