const express = require('express');
const { validate, sanitize } = require('../middleware/validation');
const { requirePermission } = require('../middleware/auth');
const { logger, auditLog } = require('../utils/logger');
const { getDbConnection } = require('../config/database');
const Joi = require('joi');

const router = express.Router();
router.use(sanitize);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const EXPIRY_THRESHOLDS_DAYS = [60, 30, 7];

// ---------------------------------------------------------------------------
// Joi Schemas
// ---------------------------------------------------------------------------
const vehicleSchema = Joi.object({
  vehicle_plate: Joi.string().max(20).required().trim().uppercase(),
  vehicle_type_id: Joi.number().integer().positive().allow(null),
  make: Joi.string().max(100).allow('', null).trim(),
  model: Joi.string().max(100).allow('', null).trim(),
  year: Joi.number().integer().min(1900).max(2100).allow(null),
  status: Joi.string().valid('active', 'inactive', 'under_maintenance').default('active'),
  photo_path: Joi.string().max(500).allow('', null).trim(),
  notes: Joi.string().allow('', null).trim()
});

const documentSchema = Joi.object({
  document_type: Joi.string().valid('vehicle_license', 'registration', 'insurance', 'mulkiya', 'other').required(),
  document_number: Joi.string().max(100).allow('', null).trim(),
  issue_date: Joi.date().allow(null),
  expiry_date: Joi.date().allow(null),
  file_path: Joi.string().max(500).allow('', null).trim(),
  notes: Joi.string().allow('', null).trim()
});

// ============================================================================
// EXPIRY ALERTS — GET /expiry-alerts?days=30
// Must be before /:id to avoid route collision
// ============================================================================
router.get('/expiry-alerts', requirePermission('VIEW_VEHICLES'), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const days = parseInt(req.query.days) || 30;

    const now = new Date();
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + days);
    const futureStr = futureDate.toISOString().split('T')[0];

    const docs = await db('vehicle_documents as d')
      .join('vehicles as v', 'v.id', 'd.vehicle_id')
      .whereNotNull('d.expiry_date')
      .where('d.expiry_date', '<=', futureStr)
      .where('v.status', '!=', 'inactive')
      .select(
        'v.id as vehicleId', 'v.vehicle_plate', 'v.make', 'v.model',
        'd.id as documentId', 'd.document_type', 'd.document_number', 'd.expiry_date'
      )
      .orderBy('d.expiry_date', 'asc');

    const alerts = docs.map(doc => {
      const diffMs = new Date(doc.expiry_date) - now;
      const daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      let severity = 'info';
      if (daysRemaining <= EXPIRY_THRESHOLDS_DAYS[2]) severity = 'critical';
      else if (daysRemaining <= EXPIRY_THRESHOLDS_DAYS[1]) severity = 'warning';
      else if (daysRemaining <= EXPIRY_THRESHOLDS_DAYS[0]) severity = 'notice';

      return { ...doc, daysRemaining, severity, expired: daysRemaining <= 0 };
    });

    res.json({ success: true, data: alerts, thresholds: EXPIRY_THRESHOLDS_DAYS, meta: { total: alerts.length, requestedDays: days } });
  } catch (error) {
    logger.error('Error fetching vehicle expiry alerts', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to fetch expiry alerts' });
  }
});

// ============================================================================
// CRUD — Vehicles
// ============================================================================

// GET / — list vehicles with optional type join
router.get('/', requirePermission('VIEW_VEHICLES'), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const { status, vehicle_type_id, search } = req.query;

    let query = db('vehicles as v')
      .leftJoin('vehicle_types as vt', 'vt.id', 'v.vehicle_type_id')
      .select('v.*', 'vt.type_name as vehicle_type_name');

    if (status) query = query.where('v.status', status);
    if (vehicle_type_id) query = query.where('v.vehicle_type_id', vehicle_type_id);
    if (search) {
      query = query.where(function () {
        this.where('v.vehicle_plate', 'like', `%${search}%`)
          .orWhere('v.make', 'like', `%${search}%`)
          .orWhere('v.model', 'like', `%${search}%`);
      });
    }

    const vehicles = await query.orderBy('v.created_at', 'desc');
    res.json({ success: true, data: vehicles });
  } catch (error) {
    logger.error('Error fetching vehicles', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to fetch vehicles' });
  }
});

// GET /:id — single vehicle
router.get('/:id', requirePermission('VIEW_VEHICLES'), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const vehicle = await db('vehicles as v')
      .leftJoin('vehicle_types as vt', 'vt.id', 'v.vehicle_type_id')
      .where('v.id', req.params.id)
      .select('v.*', 'vt.type_name as vehicle_type_name')
      .first();
    if (!vehicle) return res.status(404).json({ success: false, error: 'Vehicle not found' });

    res.json({ success: true, data: vehicle });
  } catch (error) {
    logger.error('Error fetching vehicle', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to fetch vehicle' });
  }
});

// POST / — create vehicle (plate is uppercased by Joi)
router.post('/', requirePermission('MANAGE_VEHICLES'), validate(vehicleSchema), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const [id] = await db('vehicles').insert(req.body);
    const created = await db('vehicles as v')
      .leftJoin('vehicle_types as vt', 'vt.id', 'v.vehicle_type_id')
      .where('v.id', id)
      .select('v.*', 'vt.type_name as vehicle_type_name')
      .first();

    auditLog('VEHICLE_CREATED', req.user.userId, { vehicleId: id, plate: req.body.vehicle_plate });
    res.status(201).json({ success: true, data: created, message: 'Vehicle created' });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, error: 'Vehicle plate already exists' });
    }
    logger.error('Error creating vehicle', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to create vehicle' });
  }
});

// PUT /:id — update vehicle
router.put('/:id', requirePermission('MANAGE_VEHICLES'), validate(vehicleSchema), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const existing = await db('vehicles').where('id', req.params.id).first();
    if (!existing) return res.status(404).json({ success: false, error: 'Vehicle not found' });

    await db('vehicles').where('id', req.params.id).update({ ...req.body, updated_at: db.fn.now() });
    const updated = await db('vehicles as v')
      .leftJoin('vehicle_types as vt', 'vt.id', 'v.vehicle_type_id')
      .where('v.id', req.params.id)
      .select('v.*', 'vt.type_name as vehicle_type_name')
      .first();

    auditLog('VEHICLE_UPDATED', req.user.userId, { vehicleId: req.params.id });
    res.json({ success: true, data: updated, message: 'Vehicle updated' });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, error: 'Vehicle plate already exists' });
    }
    logger.error('Error updating vehicle', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to update vehicle' });
  }
});

// DELETE /:id — soft delete (set status = inactive)
router.delete('/:id', requirePermission('MANAGE_VEHICLES'), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const existing = await db('vehicles').where('id', req.params.id).first();
    if (!existing) return res.status(404).json({ success: false, error: 'Vehicle not found' });

    await db('vehicles').where('id', req.params.id).update({ status: 'inactive', updated_at: db.fn.now() });
    auditLog('VEHICLE_DEACTIVATED', req.user.userId, { vehicleId: req.params.id });
    res.json({ success: true, message: 'Vehicle deactivated' });
  } catch (error) {
    logger.error('Error deactivating vehicle', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to deactivate vehicle' });
  }
});

// ============================================================================
// Documents — nested under vehicle
// ============================================================================

// GET /:id/documents
router.get('/:id/documents', requirePermission('VIEW_VEHICLES'), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const docs = await db('vehicle_documents').where('vehicle_id', req.params.id).orderBy('created_at', 'desc');

    const now = new Date();
    const enriched = docs.map(doc => {
      if (!doc.expiry_date) return { ...doc, expiryStatus: null, daysRemaining: null };
      const daysRemaining = Math.ceil((new Date(doc.expiry_date) - now) / (1000 * 60 * 60 * 24));
      let expiryStatus = 'valid';
      if (daysRemaining <= 0) expiryStatus = 'expired';
      else if (daysRemaining <= EXPIRY_THRESHOLDS_DAYS[2]) expiryStatus = 'critical';
      else if (daysRemaining <= EXPIRY_THRESHOLDS_DAYS[1]) expiryStatus = 'warning';
      else if (daysRemaining <= EXPIRY_THRESHOLDS_DAYS[0]) expiryStatus = 'notice';
      return { ...doc, expiryStatus, daysRemaining };
    });

    res.json({ success: true, data: enriched });
  } catch (error) {
    logger.error('Error fetching vehicle documents', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to fetch documents' });
  }
});

// POST /:id/documents
router.post('/:id/documents', requirePermission('MANAGE_VEHICLES'), validate(documentSchema), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const vehicle = await db('vehicles').where('id', req.params.id).first();
    if (!vehicle) return res.status(404).json({ success: false, error: 'Vehicle not found' });

    const [id] = await db('vehicle_documents').insert({ ...req.body, vehicle_id: req.params.id });
    const created = await db('vehicle_documents').where('id', id).first();
    auditLog('VEHICLE_DOCUMENT_ADDED', req.user.userId, { vehicleId: req.params.id, documentType: req.body.document_type });
    res.status(201).json({ success: true, data: created, message: 'Document added' });
  } catch (error) {
    logger.error('Error adding vehicle document', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to add document' });
  }
});

// PUT /:id/documents/:docId
router.put('/:id/documents/:docId', requirePermission('MANAGE_VEHICLES'), validate(documentSchema), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const doc = await db('vehicle_documents').where({ id: req.params.docId, vehicle_id: req.params.id }).first();
    if (!doc) return res.status(404).json({ success: false, error: 'Document not found' });

    await db('vehicle_documents').where('id', req.params.docId).update({ ...req.body, updated_at: db.fn.now() });
    const updated = await db('vehicle_documents').where('id', req.params.docId).first();
    res.json({ success: true, data: updated, message: 'Document updated' });
  } catch (error) {
    logger.error('Error updating vehicle document', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to update document' });
  }
});

module.exports = router;
