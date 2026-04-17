/**
 * Public Compliance Routes — NO authentication required
 *
 * These endpoints are accessible via QR code scans by regulators, inspectors,
 * or anyone verifying the authenticity of a WCN manifest. They return only
 * minimal public data (WCN number, dates, verification status) — never
 * sensitive business data.
 */
const express = require('express');
const { logger } = require('../utils/logger');
const { alRamramiDb, prideMuscatDb } = require('../config/database');

const router = express.Router();

// GET /api/compliance-public/wcn/verify/:wcn — public verification
router.get('/wcn/verify/:wcn', async (req, res) => {
  try {
    const wcnNumber = req.params.wcn;

    // Check both tenant databases since the scanner doesn't know which company
    for (const getDb of [alRamramiDb, prideMuscatDb]) {
      const db = typeof getDb === 'function' ? getDb() : getDb;
      if (!db) continue;

      try {
        const co = await db('collection_orders')
          .where('wcn_number', wcnNumber)
          .where('is_finalized', 1)
          .select('wcn_number', 'wcn_date', 'scheduledDate')
          .first();

        if (co) {
          return res.json({
            success: true,
            data: {
              verified: true,
              wcn_number: co.wcn_number,
              issued_date: co.wcn_date,
              collection_date: co.scheduledDate
            }
          });
        }
      } catch (e) {
        // continue to next db
      }
    }

    res.json({ success: true, data: { verified: false, reason: 'WCN not found or not finalized' } });
  } catch (error) {
    logger.error('Public WCN verify error', { error: error.message });
    res.status(500).json({ success: false, error: 'Verification failed' });
  }
});

module.exports = router;
