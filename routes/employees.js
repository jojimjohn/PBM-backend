const express = require('express');
const { validate, sanitize } = require('../middleware/validation');
const { requirePermission, requireAnyPermission } = require('../middleware/auth');
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
const employeeSchema = Joi.object({
  full_name: Joi.string().max(150).required().trim(),
  phone: Joi.string().max(20).allow('', null).trim(),
  email: Joi.string().email().max(100).allow('', null).trim(),
  nationality: Joi.string().max(80).allow('', null).trim(),
  date_of_birth: Joi.date().allow(null),
  gender: Joi.string().valid('male', 'female').allow(null),
  employment_start_date: Joi.date().allow(null),
  designation: Joi.string().max(100).allow('', null).trim(),
  department: Joi.string().max(100).allow('', null).trim(),
  employee_type: Joi.string().valid('driver', 'helper', 'operator', 'supervisor', 'mechanic', 'admin_staff', 'contract_worker', 'other').allow(null),
  status: Joi.string().valid('active', 'inactive', 'terminated').default('active')
});

const documentSchema = Joi.object({
  document_type: Joi.string().valid('passport', 'resident_id', 'other').required(),
  document_number: Joi.string().max(100).allow('', null).trim(),
  issue_date: Joi.date().allow(null),
  expiry_date: Joi.date().allow(null),
  file_path: Joi.string().max(500).allow('', null).trim(),
  notes: Joi.string().allow('', null).trim()
});

const locationAssignmentSchema = Joi.object({
  location_id: Joi.number().integer().positive().required(),
  location_source: Joi.string().valid('branch', 'supplier_location').default('branch'),
  role: Joi.string().valid('in_charge', 'staff', 'driver', 'helper').required(),
  assigned_from: Joi.date().required(),
  assigned_to: Joi.date().allow(null)
});

const addressSchema = Joi.object({
  address_type: Joi.string().valid('oman_residential', 'home_country').required(),
  address_line1: Joi.string().max(255).allow('', null).trim(),
  address_line2: Joi.string().max(255).allow('', null).trim(),
  city: Joi.string().max(100).allow('', null).trim(),
  state: Joi.string().max(100).allow('', null).trim(),
  country: Joi.string().max(100).allow('', null).trim(),
  postal_code: Joi.string().max(20).allow('', null).trim()
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate next employee code: EMP-001, EMP-002, ...
 */
async function generateEmployeeCode(db) {
  const last = await db('employees')
    .orderBy('id', 'desc')
    .first('employee_code');

  let seq = 1;
  if (last && last.employee_code) {
    const num = parseInt(last.employee_code.replace('EMP-', ''), 10);
    if (!isNaN(num)) seq = num + 1;
  }
  return `EMP-${String(seq).padStart(3, '0')}`;
}

// ============================================================================
// LOCATION MANAGERS — GET /managers
// Returns all current in-charge assignments with employee + location details.
// Provides two views: grouped by employee, and grouped by location.
// Must be registered BEFORE /:id to avoid route collision
// ============================================================================
router.get('/managers', requirePermission('VIEW_EMPLOYEES'), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);

    // Active in-charge assignments only (assigned_to IS NULL means still active)
    const assignments = await db('employee_location_assignments as a')
      .join('employees as e', 'e.id', 'a.employee_id')
      .where('a.role', 'in_charge')
      .whereNull('a.assigned_to')
      .where('e.status', 'active')
      .select(
        'a.id as assignmentId',
        'a.location_id',
        'a.location_source',
        'a.assigned_from',
        'e.id as employeeId',
        'e.employee_code',
        'e.full_name',
        'e.phone',
        'e.email',
        'e.employee_type',
        'e.designation'
      );

    // Enrich with location names
    const enriched = await Promise.all(assignments.map(async (a) => {
      const source = a.location_source || 'branch';
      let locationName = 'Unknown';
      let locationCode = null;

      if (source === 'branch') {
        const b = await db('branches').where('id', a.location_id).first();
        if (b) { locationName = b.name; locationCode = b.code; }
      } else {
        const sl = await db('supplier_locations').where('id', a.location_id).first();
        if (sl) { locationName = sl.locationName; locationCode = sl.locationCode; }
      }

      return { ...a, locationName, locationCode };
    }));

    // Group by employee (one employee, many locations)
    const byEmployee = {};
    enriched.forEach(a => {
      if (!byEmployee[a.employeeId]) {
        byEmployee[a.employeeId] = {
          employeeId: a.employeeId,
          employee_code: a.employee_code,
          full_name: a.full_name,
          phone: a.phone,
          email: a.email,
          employee_type: a.employee_type,
          designation: a.designation,
          locations: []
        };
      }
      byEmployee[a.employeeId].locations.push({
        locationId: a.location_id,
        locationSource: a.location_source,
        locationName: a.locationName,
        locationCode: a.locationCode,
        assignedFrom: a.assigned_from
      });
    });

    // Group by location (one location, potentially many managers — though usually one)
    const byLocation = {};
    enriched.forEach(a => {
      const key = `${a.location_source}:${a.location_id}`;
      if (!byLocation[key]) {
        byLocation[key] = {
          locationId: a.location_id,
          locationSource: a.location_source,
          locationName: a.locationName,
          locationCode: a.locationCode,
          managers: []
        };
      }
      byLocation[key].managers.push({
        employeeId: a.employeeId,
        employee_code: a.employee_code,
        full_name: a.full_name,
        phone: a.phone,
        assignedFrom: a.assigned_from
      });
    });

    res.json({
      success: true,
      data: {
        byEmployee: Object.values(byEmployee),
        byLocation: Object.values(byLocation),
        total: enriched.length
      }
    });
  } catch (error) {
    logger.error('Error fetching location managers', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to fetch managers' });
  }
});

// ============================================================================
// EXPIRY ALERTS  — GET /expiry-alerts?days=30
// Must be registered BEFORE /:id to avoid route collision
// ============================================================================
router.get('/expiry-alerts', requirePermission('VIEW_EMPLOYEES'), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const days = parseInt(req.query.days) || 30;

    const now = new Date();
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + days);
    const nowStr = now.toISOString().split('T')[0];
    const futureStr = futureDate.toISOString().split('T')[0];

    const docs = await db('employee_documents as d')
      .join('employees as e', 'e.id', 'd.employee_id')
      .whereNotNull('d.expiry_date')
      .where('d.expiry_date', '<=', futureStr)
      .where('e.status', '!=', 'terminated')
      .whereIn('d.document_type', ['passport', 'resident_id'])
      .select(
        'e.id as employeeId',
        'e.employee_code',
        'e.full_name',
        'd.id as documentId',
        'd.document_type',
        'd.document_number',
        'd.expiry_date'
      )
      .orderBy('d.expiry_date', 'asc');

    // Categorize by threshold
    const alerts = docs.map(doc => {
      const expiryDate = new Date(doc.expiry_date);
      const diffMs = expiryDate - now;
      const daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      let severity = 'info';
      if (daysRemaining <= EXPIRY_THRESHOLDS_DAYS[2]) severity = 'critical';      // <= 7
      else if (daysRemaining <= EXPIRY_THRESHOLDS_DAYS[1]) severity = 'warning';   // <= 30
      else if (daysRemaining <= EXPIRY_THRESHOLDS_DAYS[0]) severity = 'notice';    // <= 60

      return {
        ...doc,
        daysRemaining,
        severity,
        expired: daysRemaining <= 0
      };
    });

    res.json({
      success: true,
      data: alerts,
      thresholds: EXPIRY_THRESHOLDS_DAYS,
      meta: { total: alerts.length, requestedDays: days }
    });
  } catch (error) {
    logger.error('Error fetching expiry alerts', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to fetch expiry alerts' });
  }
});

// ============================================================================
// CRUD — Employees
// ============================================================================

// GET / — list employees
router.get('/', requirePermission('VIEW_EMPLOYEES'), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const { status, search, department, employee_type, is_manager, page = 1, limit = 50 } = req.query;

    let query = db('employees');

    if (status) query = query.where('status', status);
    if (department) query = query.where('department', department);
    if (employee_type) query = query.where('employee_type', employee_type);

    // Filter: only employees with at least one active in-charge assignment
    if (is_manager === 'true' || is_manager === '1') {
      const managerIds = await db('employee_location_assignments')
        .where('role', 'in_charge')
        .whereNull('assigned_to')
        .distinct('employee_id')
        .pluck('employee_id');
      query = query.whereIn('id', managerIds.length > 0 ? managerIds : [0]);
    }
    if (search) {
      query = query.where(function () {
        this.where('full_name', 'like', `%${search}%`)
          .orWhere('employee_code', 'like', `%${search}%`)
          .orWhere('phone', 'like', `%${search}%`)
          .orWhere('email', 'like', `%${search}%`);
      });
    }

    // Count
    const [{ total }] = await query.clone().count('* as total');

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const employees = await query
      .orderBy('created_at', 'desc')
      .limit(parseInt(limit))
      .offset(offset);

    // Enrich with in-charge location count (active assignments only)
    const empIds = employees.map(e => e.id);
    let inChargeMap = {};
    if (empIds.length > 0) {
      const counts = await db('employee_location_assignments')
        .whereIn('employee_id', empIds)
        .where('role', 'in_charge')
        .whereNull('assigned_to')
        .groupBy('employee_id')
        .select('employee_id', db.raw('COUNT(*) as count'));
      counts.forEach(c => { inChargeMap[c.employee_id] = parseInt(c.count); });
    }

    const enriched = employees.map(e => ({
      ...e,
      in_charge_count: inChargeMap[e.id] || 0
    }));

    res.json({
      success: true,
      data: enriched,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    logger.error('Error fetching employees', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to fetch employees' });
  }
});

// GET /:id — single employee with addresses and in-charge locations
router.get('/:id', requirePermission('VIEW_EMPLOYEES'), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const employee = await db('employees').where('id', req.params.id).first();
    if (!employee) return res.status(404).json({ success: false, error: 'Employee not found' });

    const addresses = await db('employee_addresses').where('employee_id', employee.id);

    // Fetch current in-charge locations for the header summary
    const inChargeRows = await db('employee_location_assignments')
      .where('employee_id', employee.id)
      .where('role', 'in_charge')
      .whereNull('assigned_to');

    const inChargeLocations = await Promise.all(inChargeRows.map(async (row) => {
      const source = row.location_source || 'branch';
      if (source === 'branch') {
        const b = await db('branches').where('id', row.location_id).first();
        return b ? { id: b.id, name: b.name, code: b.code, source: 'branch' } : null;
      } else {
        const sl = await db('supplier_locations').where('id', row.location_id).first();
        return sl ? { id: sl.id, name: sl.locationName, code: sl.locationCode, source: 'supplier_location' } : null;
      }
    }));

    res.json({
      success: true,
      data: {
        ...employee,
        addresses,
        in_charge_locations: inChargeLocations.filter(Boolean)
      }
    });
  } catch (error) {
    logger.error('Error fetching employee', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to fetch employee' });
  }
});

// POST / — create employee
router.post('/', requirePermission('MANAGE_EMPLOYEES'), validate(employeeSchema), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const employeeCode = await generateEmployeeCode(db);

    const [id] = await db('employees').insert({
      ...req.body,
      employee_code: employeeCode
    });

    const created = await db('employees').where('id', id).first();
    auditLog('EMPLOYEE_CREATED', req.user.userId, { employeeId: id, code: employeeCode });

    res.status(201).json({ success: true, data: created, message: 'Employee created' });
  } catch (error) {
    logger.error('Error creating employee', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to create employee' });
  }
});

// PUT /:id — update employee
router.put('/:id', requirePermission('MANAGE_EMPLOYEES'), validate(employeeSchema), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const existing = await db('employees').where('id', req.params.id).first();
    if (!existing) return res.status(404).json({ success: false, error: 'Employee not found' });

    await db('employees').where('id', req.params.id).update({
      ...req.body,
      updated_at: db.fn.now()
    });

    const updated = await db('employees').where('id', req.params.id).first();
    auditLog('EMPLOYEE_UPDATED', req.user.userId, { employeeId: req.params.id });

    res.json({ success: true, data: updated, message: 'Employee updated' });
  } catch (error) {
    logger.error('Error updating employee', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to update employee' });
  }
});

// DELETE /:id — soft delete (set status = terminated)
router.delete('/:id', requirePermission('DELETE_EMPLOYEES'), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const existing = await db('employees').where('id', req.params.id).first();
    if (!existing) return res.status(404).json({ success: false, error: 'Employee not found' });

    await db('employees').where('id', req.params.id).update({
      status: 'terminated',
      updated_at: db.fn.now()
    });

    auditLog('EMPLOYEE_TERMINATED', req.user.userId, { employeeId: req.params.id });
    res.json({ success: true, message: 'Employee deactivated' });
  } catch (error) {
    logger.error('Error deleting employee', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to deactivate employee' });
  }
});

// ============================================================================
// Addresses — nested under employee
// ============================================================================

// PUT /:id/addresses — upsert addresses (batch)
router.put('/:id/addresses', requirePermission('MANAGE_EMPLOYEES'), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const employee = await db('employees').where('id', req.params.id).first();
    if (!employee) return res.status(404).json({ success: false, error: 'Employee not found' });

    const { addresses } = req.body;
    if (!Array.isArray(addresses)) {
      return res.status(400).json({ success: false, error: 'addresses must be an array' });
    }

    // Validate each address
    for (const addr of addresses) {
      const { error } = addressSchema.validate(addr);
      if (error) return res.status(400).json({ success: false, error: error.details[0].message });
    }

    // Upsert: delete existing then insert (within transaction)
    await db.transaction(async (trx) => {
      await trx('employee_addresses').where('employee_id', req.params.id).delete();
      if (addresses.length > 0) {
        await trx('employee_addresses').insert(
          addresses.map(a => ({ ...a, employee_id: req.params.id }))
        );
      }
    });

    const updated = await db('employee_addresses').where('employee_id', req.params.id);
    res.json({ success: true, data: updated, message: 'Addresses updated' });
  } catch (error) {
    logger.error('Error updating addresses', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to update addresses' });
  }
});

// ============================================================================
// Documents — nested under employee
// ============================================================================

// GET /:id/documents
router.get('/:id/documents', requirePermission('VIEW_EMPLOYEES'), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const docs = await db('employee_documents')
      .where('employee_id', req.params.id)
      .orderBy('created_at', 'desc');

    // Enrich with expiry status
    const now = new Date();
    const enriched = docs.map(doc => {
      if (!doc.expiry_date) return { ...doc, expiryStatus: null, daysRemaining: null };
      const expiry = new Date(doc.expiry_date);
      const daysRemaining = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
      let expiryStatus = 'valid';
      if (daysRemaining <= 0) expiryStatus = 'expired';
      else if (daysRemaining <= EXPIRY_THRESHOLDS_DAYS[2]) expiryStatus = 'critical';
      else if (daysRemaining <= EXPIRY_THRESHOLDS_DAYS[1]) expiryStatus = 'warning';
      else if (daysRemaining <= EXPIRY_THRESHOLDS_DAYS[0]) expiryStatus = 'notice';
      return { ...doc, expiryStatus, daysRemaining };
    });

    res.json({ success: true, data: enriched });
  } catch (error) {
    logger.error('Error fetching documents', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to fetch documents' });
  }
});

// POST /:id/documents
router.post('/:id/documents', requirePermission('MANAGE_EMPLOYEES'), validate(documentSchema), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const employee = await db('employees').where('id', req.params.id).first();
    if (!employee) return res.status(404).json({ success: false, error: 'Employee not found' });

    const [id] = await db('employee_documents').insert({
      ...req.body,
      employee_id: req.params.id
    });

    const created = await db('employee_documents').where('id', id).first();
    auditLog('EMPLOYEE_DOCUMENT_ADDED', req.user.userId, {
      employeeId: req.params.id,
      documentType: req.body.document_type
    });

    res.status(201).json({ success: true, data: created, message: 'Document added' });
  } catch (error) {
    logger.error('Error adding document', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to add document' });
  }
});

// PUT /:id/documents/:docId
router.put('/:id/documents/:docId', requirePermission('MANAGE_EMPLOYEES'), validate(documentSchema), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const doc = await db('employee_documents')
      .where({ id: req.params.docId, employee_id: req.params.id })
      .first();
    if (!doc) return res.status(404).json({ success: false, error: 'Document not found' });

    await db('employee_documents').where('id', req.params.docId).update({
      ...req.body,
      updated_at: db.fn.now()
    });

    const updated = await db('employee_documents').where('id', req.params.docId).first();
    res.json({ success: true, data: updated, message: 'Document updated' });
  } catch (error) {
    logger.error('Error updating document', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to update document' });
  }
});

// ============================================================================
// Location Assignments
// ============================================================================

// GET /:id/location-assignments
router.get('/:id/location-assignments', requirePermission('VIEW_EMPLOYEES'), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const rows = await db('employee_location_assignments')
      .where('employee_id', req.params.id)
      .orderBy('assigned_from', 'desc');

    // Enrich with location details from the correct source table
    const enriched = await Promise.all(rows.map(async (row) => {
      const source = row.location_source || 'branch';
      let locationDetails = { locationName: 'Unknown Location', locationCode: null, locationAddress: null };

      if (source === 'branch') {
        const branch = await db('branches').where('id', row.location_id).first();
        if (branch) {
          locationDetails = {
            locationName: branch.name,
            locationCode: branch.code,
            locationAddress: branch.address
          };
        }
      } else {
        const sl = await db('supplier_locations').where('id', row.location_id).first();
        if (sl) {
          locationDetails = {
            locationName: sl.locationName,
            locationCode: sl.locationCode,
            locationAddress: sl.address
          };
        }
      }

      return { ...row, ...locationDetails };
    }));

    res.json({ success: true, data: enriched });
  } catch (error) {
    logger.error('Error fetching location assignments', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to fetch assignments' });
  }
});

// POST /:id/location-assignments
router.post('/:id/location-assignments', requirePermission('MANAGE_EMPLOYEES'), validate(locationAssignmentSchema), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const employee = await db('employees').where('id', req.params.id).first();
    if (!employee) return res.status(404).json({ success: false, error: 'Employee not found' });

    const { location_id, location_source = 'branch' } = req.body;

    // Verify location exists in the correct source table
    const table = location_source === 'branch' ? 'branches' : 'supplier_locations';
    const location = await db(table).where('id', location_id).first();
    if (!location) return res.status(404).json({ success: false, error: `Location not found in ${table}` });

    const [id] = await db('employee_location_assignments').insert({
      ...req.body,
      employee_id: req.params.id
    });

    const created = await db('employee_location_assignments').where('id', id).first();
    const locationName = location_source === 'branch' ? location.name : location.locationName;
    const locationCode = location_source === 'branch' ? location.code : location.locationCode;

    auditLog('EMPLOYEE_LOCATION_ASSIGNED', req.user.userId, {
      employeeId: req.params.id,
      locationId: location_id,
      locationSource: location_source,
      role: req.body.role
    });

    res.status(201).json({
      success: true,
      data: { ...created, locationName, locationCode },
      message: 'Location assigned'
    });
  } catch (error) {
    logger.error('Error assigning location', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to assign location' });
  }
});

// DELETE /:id/location-assignments/:assignId
router.delete('/:id/location-assignments/:assignId', requirePermission('MANAGE_EMPLOYEES'), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const assignment = await db('employee_location_assignments')
      .where({ id: req.params.assignId, employee_id: req.params.id })
      .first();
    if (!assignment) return res.status(404).json({ success: false, error: 'Assignment not found' });

    await db('employee_location_assignments').where('id', req.params.assignId).delete();

    auditLog('EMPLOYEE_LOCATION_UNASSIGNED', req.user.userId, {
      employeeId: req.params.id,
      assignmentId: req.params.assignId
    });

    res.json({ success: true, message: 'Assignment removed' });
  } catch (error) {
    logger.error('Error removing assignment', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to remove assignment' });
  }
});

module.exports = router;
