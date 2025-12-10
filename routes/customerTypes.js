const express = require('express');
const router = express.Router();
const { getDbConnection } = require('../config/database');
const { logger } = require('../utils/logger');

// GET /api/customer-types - Get all active customer types
router.get('/', async (req, res) => {
  try {
    const { companyId } = req.user;
    const db = getDbConnection(companyId);

    const types = await db('customer_types')
      .where({ is_active: true })
      .orderBy('sort_order', 'asc')
      .orderBy('name', 'asc');

    res.json({
      success: true,
      data: types
    });

  } catch (error) {
    logger.error('Error fetching customer types', {
      error: error.message,
      companyId: req.user.companyId,
      userId: req.user.id
    });

    res.status(500).json({
      success: false,
      error: 'Failed to fetch customer types'
    });
  }
});

module.exports = router;
