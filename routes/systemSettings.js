const express = require('express');
const router = express.Router();
const { getDbConnection } = require('../config/database');
const { requirePermission } = require('../middleware/auth');
const { logger } = require('../utils/logger');

// GET /api/system-settings - Get all system settings for the company
router.get('/', async (req, res) => {
  try {
    const { companyId } = req.user;
    const db = getDbConnection(companyId);

    const settings = await db('system_settings')
      .where({ company_id: companyId })
      .orderBy('category', 'asc')
      .orderBy('setting_key', 'asc');

    res.json({
      success: true,
      data: settings
    });

  } catch (error) {
    logger.error('Error fetching system settings', {
      error: error.message,
      companyId: req.user.companyId,
      userId: req.user.id
    });

    res.status(500).json({
      success: false,
      error: 'Failed to fetch system settings'
    });
  }
});

// GET /api/system-settings/:key - Get specific setting by key
router.get('/:key', async (req, res) => {
  try {
    const { companyId } = req.user;
    const { key } = req.params;
    const db = getDbConnection(companyId);

    const setting = await db('system_settings')
      .where({ company_id: companyId, setting_key: key })
      .first();

    if (!setting) {
      return res.status(404).json({
        success: false,
        error: 'Setting not found'
      });
    }

    res.json({
      success: true,
      data: setting
    });

  } catch (error) {
    logger.error('Error fetching system setting', {
      error: error.message,
      key: req.params.key,
      companyId: req.user.companyId,
      userId: req.user.id
    });

    res.status(500).json({
      success: false,
      error: 'Failed to fetch setting'
    });
  }
});

// PUT /api/system-settings/:key - Update setting
router.put('/:key', requirePermission('MANAGE_SETTINGS'), async (req, res) => {
  try {
    const { companyId, userId } = req.user;
    const { key } = req.params;
    const { setting_value } = req.body;
    const db = getDbConnection(companyId);

    // Check if setting exists
    const existingSetting = await db('system_settings')
      .where({ company_id: companyId, setting_key: key })
      .first();

    if (!existingSetting) {
      return res.status(404).json({
        success: false,
        error: 'Setting not found'
      });
    }

    // Check if setting is editable
    if (!existingSetting.is_editable) {
      return res.status(403).json({
        success: false,
        error: 'This setting cannot be modified'
      });
    }

    // Update setting
    await db('system_settings')
      .where({ company_id: companyId, setting_key: key })
      .update({
        setting_value,
        updated_at: new Date()
      });

    logger.info('System setting updated', {
      key,
      oldValue: existingSetting.setting_value,
      newValue: setting_value,
      companyId,
      userId
    });

    res.json({
      success: true,
      message: 'Setting updated successfully'
    });

  } catch (error) {
    logger.error('Error updating system setting', {
      error: error.message,
      key: req.params.key,
      companyId: req.user.companyId,
      userId: req.user.id
    });

    res.status(500).json({
      success: false,
      error: 'Failed to update setting'
    });
  }
});

module.exports = router;
