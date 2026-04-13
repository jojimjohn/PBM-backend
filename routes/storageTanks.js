const express = require('express');
const { validate, sanitize } = require('../middleware/validation');
const { requirePermission } = require('../middleware/auth');
const { logger, auditLog } = require('../utils/logger');
const { getDbConnection } = require('../config/database');
const Joi = require('joi');

const router = express.Router();
router.use(sanitize);

const tankSchema = Joi.object({
  tank_number: Joi.string().max(50).required().trim(),
  capacity_litres: Joi.number().min(0).precision(3).allow(null),
  material_type: Joi.string().max(100).allow('', null).trim(),
  location: Joi.string().max(150).allow('', null).trim(),
  notes: Joi.string().allow('', null).trim(),
  is_active: Joi.boolean().default(true)
});

// GET / — list all storage tanks
router.get('/', requirePermission('VIEW_TANK_LOGS'), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const { active_only } = req.query;
    let query = db('storage_tanks').orderBy('tank_number', 'asc');
    if (active_only === 'true') query = query.where('is_active', true);
    const tanks = await query;
    res.json({ success: true, data: tanks });
  } catch (error) {
    logger.error('Error fetching storage tanks', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to fetch tanks' });
  }
});

// POST / — create tank
router.post('/', requirePermission('MANAGE_TANK_LOGS'), validate(tankSchema), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const [id] = await db('storage_tanks').insert(req.body);
    const created = await db('storage_tanks').where('id', id).first();
    auditLog('STORAGE_TANK_CREATED', req.user.userId, { id, number: req.body.tank_number });
    res.status(201).json({ success: true, data: created, message: 'Tank created' });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ success: false, error: 'Tank number already exists' });
    logger.error('Error creating tank', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to create tank' });
  }
});

// PUT /:id — update tank
router.put('/:id', requirePermission('MANAGE_TANK_LOGS'), validate(tankSchema), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const existing = await db('storage_tanks').where('id', req.params.id).first();
    if (!existing) return res.status(404).json({ success: false, error: 'Tank not found' });
    await db('storage_tanks').where('id', req.params.id).update(req.body);
    const updated = await db('storage_tanks').where('id', req.params.id).first();
    res.json({ success: true, data: updated, message: 'Tank updated' });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ success: false, error: 'Tank number already exists' });
    logger.error('Error updating tank', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to update tank' });
  }
});

// DELETE /:id — soft deactivate
router.delete('/:id', requirePermission('MANAGE_TANK_LOGS'), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    await db('storage_tanks').where('id', req.params.id).update({ is_active: false });
    res.json({ success: true, message: 'Tank deactivated' });
  } catch (error) {
    logger.error('Error deactivating tank', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to deactivate tank' });
  }
});

module.exports = router;
