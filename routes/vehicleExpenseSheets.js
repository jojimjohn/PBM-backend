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
const EXPENSE_CATEGORIES = ['fuel', 'food', 'medical', 'vehicle_repair', 'water', 'material_purchase', 'other'];

// ---------------------------------------------------------------------------
// Joi Schemas
// ---------------------------------------------------------------------------
const transferSchema = Joi.object({
  from_person: Joi.string().max(100).required().trim(),
  amount: Joi.number().min(0).precision(3).required(),
  transfer_type: Joi.string().max(50).allow('', null).trim()
});

const expenseItemSchema = Joi.object({
  id: Joi.number().integer().positive().allow(null).optional(),
  expense_category: Joi.string().valid(...EXPENSE_CATEGORIES).required(),
  description: Joi.string().max(255).allow('', null).trim(),
  amount: Joi.number().min(0).precision(3).required(),
  receipt_path: Joi.string().max(500).allow('', null).trim()
});

const sheetSchema = Joi.object({
  sheet_date: Joi.date().required(),
  vehicle_id: Joi.number().integer().positive().allow(null),
  vehicle_plate: Joi.string().max(20).required().trim().uppercase(),
  driver_employee_id: Joi.number().integer().positive().allow(null),
  helper_employee_id: Joi.number().integer().positive().allow(null),
  advance_given: Joi.number().min(0).precision(3).default(0),
  old_balance: Joi.number().precision(3).default(0),
  external_transfers: Joi.array().items(transferSchema).default([]),
  tank_id: Joi.number().integer().positive().allow(null),
  density_notes: Joi.string().allow('', null).trim(),
  notes: Joi.string().allow('', null).trim(),
  items: Joi.array().items(expenseItemSchema).default([])
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute totals for a sheet.
 * closing_balance = (old_balance + advance_given + sum(transfers)) - total_expenses
 */
function computeTotals(sheet, items, transfers) {
  const transferTotal = (transfers || []).reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);
  const totalAvailable = parseFloat(sheet.old_balance || 0) + parseFloat(sheet.advance_given || 0) + transferTotal;
  const totalExpenses = items.reduce((s, item) => s + (parseFloat(item.amount) || 0), 0);
  const closingBalance = totalAvailable - totalExpenses;
  return { transferTotal, totalAvailable, totalExpenses, closingBalance };
}

// ============================================================================
// GET /carry-forward?vehiclePlate=&date=
// Returns closing_balance from the most recent CLOSED sheet for this vehicle
// Must be BEFORE /:id route
// ============================================================================
router.get('/carry-forward', requirePermission('VIEW_EXPENSE_SHEETS'), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const { vehiclePlate, date } = req.query;
    if (!vehiclePlate) return res.status(400).json({ success: false, error: 'vehiclePlate required' });

    const dateStr = date || new Date().toISOString().split('T')[0];

    // Find the most recent closed/approved sheet for this vehicle BEFORE the given date
    const prev = await db('vehicle_daily_expense_sheets')
      .where('vehicle_plate', vehiclePlate.toUpperCase())
      .where('sheet_date', '<', dateStr)
      .whereIn('status', ['approved', 'closed'])
      .orderBy('sheet_date', 'desc')
      .first();

    if (!prev) {
      return res.json({ success: true, data: { closing_balance: 0, from_date: null } });
    }

    // Recalculate closing balance from stored data
    const items = await db('vehicle_daily_expense_items').where('sheet_id', prev.id);
    let transfers = [];
    try { transfers = typeof prev.external_transfers === 'string' ? JSON.parse(prev.external_transfers) : (prev.external_transfers || []); } catch { transfers = []; }
    const { closingBalance } = computeTotals(prev, items, transfers);

    res.json({
      success: true,
      data: { closing_balance: closingBalance, from_date: prev.sheet_date }
    });
  } catch (error) {
    logger.error('Error fetching carry-forward', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to fetch carry-forward' });
  }
});

// ============================================================================
// GET / — list sheets with filters
// ============================================================================
router.get('/', requirePermission('VIEW_EXPENSE_SHEETS'), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const { date, from, to, vehiclePlate, status, page = 1, limit = 50 } = req.query;

    let query = db('vehicle_daily_expense_sheets as s')
      .leftJoin('employees as drv', 'drv.id', 's.driver_employee_id')
      .leftJoin('employees as hlp', 'hlp.id', 's.helper_employee_id')
      .leftJoin('vehicles as v', 'v.id', 's.vehicle_id')
      .leftJoin('storage_tanks as t', 't.id', 's.tank_id')
      .select(
        's.*',
        'drv.full_name as driver_name',
        'hlp.full_name as helper_name',
        'v.make as vehicle_make', 'v.model as vehicle_model',
        't.tank_number'
      );

    if (date) query = query.where('s.sheet_date', date);
    if (from && to) query = query.whereBetween('s.sheet_date', [from, to]);
    if (vehiclePlate) query = query.where('s.vehicle_plate', vehiclePlate.toUpperCase());
    if (status) query = query.where('s.status', status);

    const [{ total }] = await query.clone().count('* as total');
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const sheets = await query.orderBy('s.sheet_date', 'desc').limit(parseInt(limit)).offset(offset);

    // Enrich with computed closing_balance
    const enriched = sheets.map(sheet => {
      let transfers = [];
      try { transfers = typeof sheet.external_transfers === 'string' ? JSON.parse(sheet.external_transfers) : (sheet.external_transfers || []); } catch { transfers = []; }
      const transferTotal = transfers.reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);
      const totalAvailable = parseFloat(sheet.old_balance || 0) + parseFloat(sheet.advance_given || 0) + transferTotal;
      const closingBalance = totalAvailable - parseFloat(sheet.total_expenses || 0);
      return { ...sheet, external_transfers: transfers, total_available: totalAvailable, closing_balance: closingBalance };
    });

    res.json({
      success: true,
      data: enriched,
      pagination: { page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / parseInt(limit)) }
    });
  } catch (error) {
    logger.error('Error fetching expense sheets', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to fetch expense sheets' });
  }
});

// ============================================================================
// GET /:id — full detail with items
// ============================================================================
router.get('/:id', requirePermission('VIEW_EXPENSE_SHEETS'), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);

    const sheet = await db('vehicle_daily_expense_sheets as s')
      .leftJoin('employees as drv', 'drv.id', 's.driver_employee_id')
      .leftJoin('employees as hlp', 'hlp.id', 's.helper_employee_id')
      .leftJoin('vehicles as v', 'v.id', 's.vehicle_id')
      .leftJoin('storage_tanks as t', 't.id', 's.tank_id')
      .leftJoin('users as u', 'u.id', 's.created_by')
      .leftJoin('users as approver', 'approver.id', 's.approved_by')
      .where('s.id', req.params.id)
      .select(
        's.*',
        'drv.full_name as driver_name', 'drv.employee_code as driver_code',
        'hlp.full_name as helper_name', 'hlp.employee_code as helper_code',
        'v.make as vehicle_make', 'v.model as vehicle_model',
        't.tank_number',
        'u.name as created_by_name',
        'approver.name as approved_by_name'
      )
      .first();

    if (!sheet) return res.status(404).json({ success: false, error: 'Expense sheet not found' });

    const items = await db('vehicle_daily_expense_items').where('sheet_id', sheet.id).orderBy('created_at');

    let transfers = [];
    try { transfers = typeof sheet.external_transfers === 'string' ? JSON.parse(sheet.external_transfers) : (sheet.external_transfers || []); } catch { transfers = []; }

    const { totalAvailable, totalExpenses, closingBalance } = computeTotals(sheet, items, transfers);

    res.json({
      success: true,
      data: {
        ...sheet,
        external_transfers: transfers,
        items,
        total_available: totalAvailable,
        total_expenses: totalExpenses,
        closing_balance: closingBalance
      }
    });
  } catch (error) {
    logger.error('Error fetching expense sheet', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to fetch expense sheet' });
  }
});

// ============================================================================
// POST / — create new sheet
// ============================================================================
router.post('/', requirePermission('MANAGE_EXPENSE_SHEETS'), validate(sheetSchema), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const { items, external_transfers, ...sheetData } = req.body;

    sheetData.vehicle_plate = sheetData.vehicle_plate.toUpperCase();
    sheetData.external_transfers = JSON.stringify(external_transfers || []);
    sheetData.created_by = req.user.userId;

    // Compute total_expenses
    const totalExp = (items || []).reduce((s, item) => s + (parseFloat(item.amount) || 0), 0);
    sheetData.total_expenses = totalExp;

    let sheetId;
    await db.transaction(async (trx) => {
      const [id] = await trx('vehicle_daily_expense_sheets').insert(sheetData);
      sheetId = id;

      if (items && items.length > 0) {
        await trx('vehicle_daily_expense_items').insert(
          items.map(item => ({
            sheet_id: sheetId,
            expense_category: item.expense_category,
            description: item.description || null,
            amount: item.amount,
            receipt_path: item.receipt_path || null
          }))
        );
      }
    });

    auditLog('EXPENSE_SHEET_CREATED', req.user.userId, { sheetId, date: sheetData.sheet_date, plate: sheetData.vehicle_plate });
    res.status(201).json({ success: true, data: { id: sheetId }, message: 'Expense sheet created' });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, error: 'A sheet already exists for this vehicle on this date' });
    }
    logger.error('Error creating expense sheet', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to create expense sheet' });
  }
});

// ============================================================================
// PUT /:id — update sheet (add expenses, adjust advance, etc.)
// Only allowed when status is 'open'
// ============================================================================
router.put('/:id', requirePermission('MANAGE_EXPENSE_SHEETS'), validate(sheetSchema), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const existing = await db('vehicle_daily_expense_sheets').where('id', req.params.id).first();
    if (!existing) return res.status(404).json({ success: false, error: 'Sheet not found' });

    if (existing.status !== 'open') {
      return res.status(400).json({ success: false, error: `Cannot edit sheet with status '${existing.status}'. Only open sheets can be edited.` });
    }

    const { items, external_transfers, ...sheetData } = req.body;
    sheetData.vehicle_plate = sheetData.vehicle_plate.toUpperCase();
    sheetData.external_transfers = JSON.stringify(external_transfers || []);
    sheetData.updated_at = db.fn.now();

    // Recompute total_expenses on every save
    const totalExp = (items || []).reduce((s, item) => s + (parseFloat(item.amount) || 0), 0);
    sheetData.total_expenses = totalExp;

    // Don't overwrite these fields
    delete sheetData.status;
    delete sheetData.approved_by;
    delete sheetData.approved_at;
    delete sheetData.created_by;

    await db.transaction(async (trx) => {
      await trx('vehicle_daily_expense_sheets').where('id', req.params.id).update(sheetData);

      // Replace items
      await trx('vehicle_daily_expense_items').where('sheet_id', req.params.id).delete();
      if (items && items.length > 0) {
        await trx('vehicle_daily_expense_items').insert(
          items.map(item => ({
            sheet_id: parseInt(req.params.id),
            expense_category: item.expense_category,
            description: item.description || null,
            amount: item.amount,
            receipt_path: item.receipt_path || null
          }))
        );
      }
    });

    auditLog('EXPENSE_SHEET_UPDATED', req.user.userId, { sheetId: req.params.id });
    res.json({ success: true, message: 'Expense sheet updated' });
  } catch (error) {
    logger.error('Error updating expense sheet', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to update expense sheet' });
  }
});

// ============================================================================
// POST /:id/submit — driver submits end-of-day
// ============================================================================
router.post('/:id/submit', requirePermission('MANAGE_EXPENSE_SHEETS'), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const sheet = await db('vehicle_daily_expense_sheets').where('id', req.params.id).first();
    if (!sheet) return res.status(404).json({ success: false, error: 'Sheet not found' });

    if (sheet.status !== 'open') {
      return res.status(400).json({ success: false, error: 'Only open sheets can be submitted' });
    }

    await db('vehicle_daily_expense_sheets').where('id', req.params.id).update({
      status: 'submitted',
      updated_at: db.fn.now()
    });

    auditLog('EXPENSE_SHEET_SUBMITTED', req.user.userId, { sheetId: req.params.id });
    res.json({ success: true, message: 'Expense sheet submitted for approval' });
  } catch (error) {
    logger.error('Error submitting expense sheet', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to submit' });
  }
});

// ============================================================================
// POST /:id/approve — manager approves
// ============================================================================
router.post('/:id/approve', requirePermission('APPROVE_EXPENSE_SHEETS'), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const sheet = await db('vehicle_daily_expense_sheets').where('id', req.params.id).first();
    if (!sheet) return res.status(404).json({ success: false, error: 'Sheet not found' });

    if (sheet.status !== 'submitted') {
      return res.status(400).json({ success: false, error: 'Only submitted sheets can be approved' });
    }

    await db('vehicle_daily_expense_sheets').where('id', req.params.id).update({
      status: 'approved',
      approved_by: req.user.userId,
      approved_at: new Date(),
      updated_at: db.fn.now()
    });

    auditLog('EXPENSE_SHEET_APPROVED', req.user.userId, { sheetId: req.params.id });
    res.json({ success: true, message: 'Expense sheet approved' });
  } catch (error) {
    logger.error('Error approving expense sheet', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to approve' });
  }
});

module.exports = router;
