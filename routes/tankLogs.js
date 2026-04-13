const express = require('express');
const { validate, sanitize } = require('../middleware/validation');
const { requirePermission } = require('../middleware/auth');
const { logger, auditLog } = require('../utils/logger');
const { getDbConnection } = require('../config/database');
const Joi = require('joi');

const router = express.Router();
router.use(sanitize);

// ---------------------------------------------------------------------------
// Joi Schemas
// ---------------------------------------------------------------------------
const collectionEntrySchema = Joi.object({
  vehicle_id: Joi.number().integer().positive().allow(null),
  vehicle_plate: Joi.string().max(20).allow('', null).trim().uppercase(),
  collected_quantity: Joi.number().min(0).precision(3).required(),
  collection_order_id: Joi.number().integer().positive().allow(null),
  notes: Joi.string().allow('', null).trim()
});

const tankLogSchema = Joi.object({
  log_date: Joi.date().max('now').required(),
  tank_id: Joi.number().integer().positive().required(),
  opening_stock: Joi.number().min(0).precision(3).required(),
  closing_stock: Joi.number().min(0).precision(3).required(),
  sales: Joi.number().min(0).precision(3).default(0),
  client_type: Joi.string().valid('others', 'cash_customer', 'mixed').allow(null),
  notes: Joi.string().allow('', null).trim(),
  updated_at: Joi.string().allow(null), // For optimistic locking
  collections: Joi.array().items(collectionEntrySchema).default([])
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Get net_closing_stock for a tank on a given date.
 * Returns null if no log exists for that date.
 */
async function getPreviousDayNetClosing(db, tankId, date) {
  const prevDate = new Date(date);
  prevDate.setDate(prevDate.getDate() - 1);
  const prevStr = prevDate.toISOString().split('T')[0];

  const prev = await db('tank_daily_log')
    .where({ tank_id: tankId, log_date: prevStr })
    .select(db.raw('(closing_stock - sales) as net_closing_stock'))
    .first();

  return prev ? parseFloat(prev.net_closing_stock) : null;
}

// ============================================================================
// GET /api/tank-logs?date=YYYY-MM-DD
// Returns all active tanks with their log for the given date,
// plus previous day's net closing stock for opening stock auto-population
// ============================================================================
router.get('/', requirePermission('VIEW_TANK_LOGS'), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const date = req.query.date || new Date().toISOString().split('T')[0];

    // Get all active tanks
    const tanks = await db('storage_tanks').where('is_active', true).orderBy('tank_number');

    // Get logs for this date
    const logs = await db('tank_daily_log as l')
      .leftJoin('users as u', 'u.id', 'l.created_by')
      .where('l.log_date', date)
      .select(
        'l.*',
        db.raw('(l.closing_stock - l.sales) as net_closing_stock'),
        'u.name as created_by_name'
      );

    // Get collections for each log
    const logIds = logs.map(l => l.id).filter(Boolean);
    let collections = [];
    if (logIds.length > 0) {
      collections = await db('tank_daily_collections as c')
        .leftJoin('vehicles as v', 'v.id', 'c.vehicle_id')
        .whereIn('c.tank_daily_log_id', logIds)
        .select('c.*', 'v.vehicle_plate as master_plate', 'v.make', 'v.model');
    }

    // Get previous day's net closing for each tank (opening stock hint)
    const prevDate = new Date(date);
    prevDate.setDate(prevDate.getDate() - 1);
    const prevStr = prevDate.toISOString().split('T')[0];

    const prevLogs = await db('tank_daily_log')
      .where('log_date', prevStr)
      .select('tank_id', db.raw('(closing_stock - sales) as prev_net_closing'));

    const prevMap = {};
    prevLogs.forEach(p => { prevMap[p.tank_id] = parseFloat(p.prev_net_closing); });

    // Merge tanks with their logs
    const result = tanks.map(tank => {
      const log = logs.find(l => l.tank_id === tank.id) || null;
      const tankCollections = log
        ? collections.filter(c => c.tank_daily_log_id === log.id)
        : [];

      return {
        tank,
        log,
        collections: tankCollections,
        prev_net_closing: prevMap[tank.id] ?? null
      };
    });

    res.json({ success: true, data: result, date });
  } catch (error) {
    logger.error('Error fetching tank logs', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to fetch tank logs' });
  }
});

// ============================================================================
// POST /api/tank-logs — Upsert a daily log entry (one per tank per day)
// Supports optimistic locking via updated_at comparison
// ============================================================================
router.post('/', requirePermission('MANAGE_TANK_LOGS'), validate(tankLogSchema), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const { log_date, tank_id, opening_stock, closing_stock, sales, client_type, notes, updated_at, collections } = req.body;

    const dateStr = new Date(log_date).toISOString().split('T')[0];

    // Prevent future dates
    const today = new Date().toISOString().split('T')[0];
    if (dateStr > today) {
      return res.status(400).json({ success: false, error: 'Cannot create log for future dates' });
    }

    // Verify tank exists
    const tank = await db('storage_tanks').where('id', tank_id).first();
    if (!tank) return res.status(404).json({ success: false, error: 'Tank not found' });

    // Check for existing log (for optimistic locking)
    const existing = await db('tank_daily_log').where({ log_date: dateStr, tank_id }).first();

    if (existing && updated_at) {
      // Optimistic locking: reject if another user has saved since we loaded
      const existingUpdatedAt = existing.updated_at;
      if (existingUpdatedAt && existingUpdatedAt !== updated_at) {
        return res.status(409).json({
          success: false,
          error: 'This record was modified by another user. Please reload and try again.',
          code: 'CONFLICT'
        });
      }
    }

    let logId;

    await db.transaction(async (trx) => {
      if (existing) {
        // Update existing
        await trx('tank_daily_log').where('id', existing.id).update({
          opening_stock, closing_stock, sales, client_type, notes,
          updated_at: trx.fn.now()
        });
        logId = existing.id;

        // Replace collections
        await trx('tank_daily_collections').where('tank_daily_log_id', logId).delete();
      } else {
        // Insert new
        const [id] = await trx('tank_daily_log').insert({
          log_date: dateStr, tank_id, opening_stock, closing_stock, sales,
          client_type, notes, created_by: req.user.userId
        });
        logId = id;
      }

      // Insert collections
      if (collections && collections.length > 0) {
        await trx('tank_daily_collections').insert(
          collections.map(c => ({
            tank_daily_log_id: logId,
            vehicle_id: c.vehicle_id || null,
            vehicle_plate: c.vehicle_plate ? c.vehicle_plate.toUpperCase() : null,
            collected_quantity: c.collected_quantity,
            collection_order_id: c.collection_order_id || null,
            notes: c.notes || null
          }))
        );
      }
    });

    // Return the saved log
    const saved = await db('tank_daily_log')
      .where('id', logId)
      .select('*', db.raw('(closing_stock - sales) as net_closing_stock'))
      .first();

    const savedCollections = await db('tank_daily_collections')
      .where('tank_daily_log_id', logId);

    auditLog('TANK_LOG_SAVED', req.user.userId, { logId, date: dateStr, tankId: tank_id });

    res.json({
      success: true,
      data: { log: saved, collections: savedCollections },
      message: existing ? 'Tank log updated' : 'Tank log created'
    });
  } catch (error) {
    logger.error('Error saving tank log', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to save tank log' });
  }
});

// ============================================================================
// GET /api/tank-logs/:tankId/history?from=YYYY-MM-DD&to=YYYY-MM-DD
// Date range history for a single tank
// ============================================================================
router.get('/:tankId/history', requirePermission('VIEW_TANK_LOGS'), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const { tankId } = req.params;
    const { from, to } = req.query;

    if (!from || !to) {
      return res.status(400).json({ success: false, error: 'from and to query params required' });
    }

    const tank = await db('storage_tanks').where('id', tankId).first();
    if (!tank) return res.status(404).json({ success: false, error: 'Tank not found' });

    const logs = await db('tank_daily_log')
      .where('tank_id', tankId)
      .whereBetween('log_date', [from, to])
      .select('*', db.raw('(closing_stock - sales) as net_closing_stock'))
      .orderBy('log_date', 'asc');

    // Get collections for all logs
    const logIds = logs.map(l => l.id);
    let collections = [];
    if (logIds.length > 0) {
      collections = await db('tank_daily_collections')
        .whereIn('tank_daily_log_id', logIds)
        .orderBy('created_at', 'asc');
    }

    const logsWithCollections = logs.map(log => ({
      ...log,
      collections: collections.filter(c => c.tank_daily_log_id === log.id)
    }));

    res.json({ success: true, data: { tank, logs: logsWithCollections } });
  } catch (error) {
    logger.error('Error fetching tank history', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to fetch history' });
  }
});

module.exports = router;
