const express = require('express');
const { validate, sanitize } = require('../middleware/validation');
const { requirePermission } = require('../middleware/auth');
const { logger, auditLog } = require('../utils/logger');
const { getDbConnection } = require('../config/database');
const Joi = require('joi');

const router = express.Router();
router.use(sanitize);

const vehicleTypeSchema = Joi.object({
  type_name: Joi.string().max(100).required().trim(),
  description: Joi.string().max(255).allow('', null).trim(),
  is_active: Joi.boolean().default(true)
});

// GET / — list all vehicle types
router.get('/', requirePermission('VIEW_VEHICLES'), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const { active_only } = req.query;

    let query = db('vehicle_types').orderBy('type_name', 'asc');
    if (active_only === 'true') query = query.where('is_active', true);

    const types = await query;
    res.json({ success: true, data: types });
  } catch (error) {
    logger.error('Error fetching vehicle types', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to fetch vehicle types' });
  }
});

// POST / — create vehicle type
router.post('/', requirePermission('MANAGE_VEHICLES'), validate(vehicleTypeSchema), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const [id] = await db('vehicle_types').insert(req.body);
    const created = await db('vehicle_types').where('id', id).first();
    auditLog('VEHICLE_TYPE_CREATED', req.user.userId, { id, name: req.body.type_name });
    res.status(201).json({ success: true, data: created, message: 'Vehicle type created' });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, error: 'Vehicle type name already exists' });
    }
    logger.error('Error creating vehicle type', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to create vehicle type' });
  }
});

// PUT /:id — update vehicle type
router.put('/:id', requirePermission('MANAGE_VEHICLES'), validate(vehicleTypeSchema), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const existing = await db('vehicle_types').where('id', req.params.id).first();
    if (!existing) return res.status(404).json({ success: false, error: 'Vehicle type not found' });

    await db('vehicle_types').where('id', req.params.id).update(req.body);
    const updated = await db('vehicle_types').where('id', req.params.id).first();
    auditLog('VEHICLE_TYPE_UPDATED', req.user.userId, { id: req.params.id });
    res.json({ success: true, data: updated, message: 'Vehicle type updated' });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, error: 'Vehicle type name already exists' });
    }
    logger.error('Error updating vehicle type', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to update vehicle type' });
  }
});

// DELETE /:id — soft delete via is_active
router.delete('/:id', requirePermission('MANAGE_VEHICLES'), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const existing = await db('vehicle_types').where('id', req.params.id).first();
    if (!existing) return res.status(404).json({ success: false, error: 'Vehicle type not found' });

    await db('vehicle_types').where('id', req.params.id).update({ is_active: false });
    auditLog('VEHICLE_TYPE_DEACTIVATED', req.user.userId, { id: req.params.id });
    res.json({ success: true, message: 'Vehicle type deactivated' });
  } catch (error) {
    logger.error('Error deactivating vehicle type', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to deactivate vehicle type' });
  }
});

module.exports = router;
