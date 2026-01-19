const express = require('express');
const router = express.Router();
const { getDbConnection } = require('../config/database');
const { requirePermission } = require('../middleware/auth');
const { logger } = require('../utils/logger');

// ============================================================================
// IMPORTANT: Route order matters in Express!
// Specific routes (like /user/preferences, /security/session-timeout) must come
// BEFORE generic parameter routes (like /:key) to avoid being caught incorrectly.
// ============================================================================

// ============================================================================
// User Preferences Routes (MUST come before /:key)
// User-specific settings stored with key pattern: user_{userId}_{settingName}
// ============================================================================

/**
 * GET /api/system-settings/user/preferences
 * Get all user preferences for the current user
 */
router.get('/user/preferences', async (req, res) => {
  try {
    const { companyId, userId } = req.user;
    const db = getDbConnection(companyId);

    const preferences = await db('system_settings')
      .where({ company_id: companyId })
      .where('setting_key', 'like', `user_${userId}_%`)
      .select('setting_key', 'setting_value', 'setting_type');

    // Transform to key-value object
    const preferencesMap = {};
    preferences.forEach(pref => {
      // Extract preference name from key (e.g., 'user_5_theme' -> 'theme')
      const prefName = pref.setting_key.replace(`user_${userId}_`, '');
      preferencesMap[prefName] = pref.setting_value;
    });

    res.json({
      success: true,
      data: preferencesMap
    });

  } catch (error) {
    logger.error('Error fetching user preferences', {
      error: error.message,
      companyId: req.user.companyId,
      userId: req.user.userId
    });

    res.status(500).json({
      success: false,
      error: 'Failed to fetch user preferences'
    });
  }
});

/**
 * GET /api/system-settings/user/preferences/:key
 * Get a specific user preference
 */
router.get('/user/preferences/:key', async (req, res) => {
  try {
    const { companyId, userId } = req.user;
    const { key } = req.params;
    const db = getDbConnection(companyId);

    const settingKey = `user_${userId}_${key}`;
    const setting = await db('system_settings')
      .where({ company_id: companyId, setting_key: settingKey })
      .first();

    if (!setting) {
      return res.json({
        success: true,
        data: null // Preference not set yet
      });
    }

    res.json({
      success: true,
      data: {
        key,
        value: setting.setting_value
      }
    });

  } catch (error) {
    logger.error('Error fetching user preference', {
      error: error.message,
      key: req.params.key,
      companyId: req.user.companyId,
      userId: req.user.userId
    });

    res.status(500).json({
      success: false,
      error: 'Failed to fetch user preference'
    });
  }
});

/**
 * PUT /api/system-settings/user/preferences/:key
 * Update or create a user preference
 * No special permission required - users can manage their own preferences
 */
router.put('/user/preferences/:key', async (req, res) => {
  try {
    const { companyId, userId, email } = req.user;
    const { key } = req.params;
    const { value } = req.body;
    const db = getDbConnection(companyId);

    // Validate key (only allow specific preference keys)
    const allowedKeys = ['theme', 'language', 'date_format', 'time_format', 'sidebar_collapsed', 'notifications_enabled'];
    if (!allowedKeys.includes(key)) {
      return res.status(400).json({
        success: false,
        error: `Invalid preference key. Allowed: ${allowedKeys.join(', ')}`
      });
    }

    // Validate theme value
    if (key === 'theme' && !['light', 'dark'].includes(value)) {
      return res.status(400).json({
        success: false,
        error: 'Theme must be "light" or "dark"'
      });
    }

    const settingKey = `user_${userId}_${key}`;

    // Check if preference exists
    const existing = await db('system_settings')
      .where({ company_id: companyId, setting_key: settingKey })
      .first();

    if (existing) {
      // Update existing preference
      await db('system_settings')
        .where({ company_id: companyId, setting_key: settingKey })
        .update({
          setting_value: value,
          updated_at: new Date()
        });
    } else {
      // Create new preference
      await db('system_settings').insert({
        company_id: companyId,
        setting_key: settingKey,
        setting_value: value,
        setting_type: 'string',
        category: 'user_preference',
        description: `User preference: ${key} for user ${userId}`,
        is_editable: true,
        created_at: new Date(),
        updated_at: new Date()
      });
    }

    logger.info('User preference updated', {
      key,
      value,
      companyId,
      userId,
      email
    });

    res.json({
      success: true,
      message: 'Preference saved successfully',
      data: { key, value }
    });

  } catch (error) {
    logger.error('Error updating user preference', {
      error: error.message,
      key: req.params.key,
      companyId: req.user.companyId,
      userId: req.user.userId
    });

    res.status(500).json({
      success: false,
      error: 'Failed to update preference'
    });
  }
});

/**
 * PUT /api/system-settings/user/preferences
 * Bulk update user preferences
 */
router.put('/user/preferences', async (req, res) => {
  try {
    const { companyId, userId, email } = req.user;
    const { preferences } = req.body;
    const db = getDbConnection(companyId);

    if (!preferences || typeof preferences !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'Preferences object is required'
      });
    }

    const allowedKeys = ['theme', 'language', 'date_format', 'time_format', 'sidebar_collapsed', 'notifications_enabled'];
    const updates = [];

    for (const [key, value] of Object.entries(preferences)) {
      if (!allowedKeys.includes(key)) continue;

      // Validate theme value
      if (key === 'theme' && !['light', 'dark'].includes(value)) continue;

      const settingKey = `user_${userId}_${key}`;

      const existing = await db('system_settings')
        .where({ company_id: companyId, setting_key: settingKey })
        .first();

      if (existing) {
        await db('system_settings')
          .where({ company_id: companyId, setting_key: settingKey })
          .update({
            setting_value: value,
            updated_at: new Date()
          });
      } else {
        await db('system_settings').insert({
          company_id: companyId,
          setting_key: settingKey,
          setting_value: value,
          setting_type: 'string',
          category: 'user_preference',
          description: `User preference: ${key} for user ${userId}`,
          is_editable: true,
          created_at: new Date(),
          updated_at: new Date()
        });
      }

      updates.push(key);
    }

    logger.info('User preferences bulk updated', {
      updatedKeys: updates,
      companyId,
      userId,
      email
    });

    res.json({
      success: true,
      message: 'Preferences saved successfully',
      data: { updated: updates }
    });

  } catch (error) {
    logger.error('Error bulk updating user preferences', {
      error: error.message,
      companyId: req.user.companyId,
      userId: req.user.userId
    });

    res.status(500).json({
      success: false,
      error: 'Failed to update preferences'
    });
  }
});

// ============================================================================
// Security Settings Routes (MUST come before /:key)
// ============================================================================

/**
 * GET /api/system-settings/security/session-timeout
 * Get session timeout setting for the company
 * Returns default of 30 minutes if not configured
 */
router.get('/security/session-timeout', async (req, res) => {
  try {
    const { companyId } = req.user;
    const db = getDbConnection(companyId);

    const setting = await db('system_settings')
      .where({ company_id: companyId, setting_key: 'session_timeout_minutes' })
      .first();

    const timeoutMinutes = setting ? parseInt(setting.setting_value, 10) : 30;

    res.json({
      success: true,
      data: {
        sessionTimeoutMinutes: timeoutMinutes,
        warningMinutes: Math.min(5, Math.floor(timeoutMinutes / 6)), // Warning at 1/6th of timeout, max 5 min
        isDefault: !setting
      }
    });

  } catch (error) {
    logger.error('Error fetching session timeout setting', {
      error: error.message,
      companyId: req.user.companyId
    });

    res.status(500).json({
      success: false,
      error: 'Failed to fetch session timeout setting'
    });
  }
});

/**
 * PUT /api/system-settings/security/session-timeout
 * Update session timeout setting
 * Requires MANAGE_SETTINGS permission
 *
 * @body {number} timeoutMinutes - Session timeout in minutes (10-120)
 */
router.put('/security/session-timeout', requirePermission('MANAGE_SETTINGS'), async (req, res) => {
  try {
    const { companyId, userId, email } = req.user;
    const { timeoutMinutes } = req.body;
    const db = getDbConnection(companyId);

    // Validate timeout value
    const parsedTimeout = parseInt(timeoutMinutes, 10);
    if (isNaN(parsedTimeout) || parsedTimeout < 10 || parsedTimeout > 120) {
      return res.status(400).json({
        success: false,
        error: 'Session timeout must be between 10 and 120 minutes'
      });
    }

    // Check if setting exists
    const existingSetting = await db('system_settings')
      .where({ company_id: companyId, setting_key: 'session_timeout_minutes' })
      .first();

    if (existingSetting) {
      // Update existing setting
      await db('system_settings')
        .where({ company_id: companyId, setting_key: 'session_timeout_minutes' })
        .update({
          setting_value: parsedTimeout.toString(),
          updated_at: new Date()
        });
    } else {
      // Create new setting
      await db('system_settings').insert({
        company_id: companyId,
        category: 'security',
        setting_key: 'session_timeout_minutes',
        setting_value: parsedTimeout.toString(),
        description: 'Session timeout in minutes before user is automatically logged out due to inactivity',
        is_editable: true,
        created_at: new Date(),
        updated_at: new Date()
      });
    }

    logger.info('Session timeout setting updated', {
      oldValue: existingSetting?.setting_value || '30',
      newValue: parsedTimeout,
      companyId,
      userId,
      email
    });

    // Clear session timeout cache (if implemented)
    try {
      const { clearSessionTimeoutCache } = require('../middleware/sessionTimeout');
      if (clearSessionTimeoutCache) {
        clearSessionTimeoutCache(companyId);
      }
    } catch (e) {
      // Middleware might not exist
    }

    res.json({
      success: true,
      message: 'Session timeout updated successfully',
      data: {
        sessionTimeoutMinutes: parsedTimeout
      }
    });

  } catch (error) {
    logger.error('Error updating session timeout setting', {
      error: error.message,
      companyId: req.user.companyId,
      userId: req.user.userId
    });

    res.status(500).json({
      success: false,
      error: 'Failed to update session timeout setting'
    });
  }
});

// ============================================================================
// Generic System Settings Routes (MUST come AFTER specific routes)
// ============================================================================

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
      userId: req.user.userId
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
      userId: req.user.userId
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
      userId: req.user.userId
    });

    res.status(500).json({
      success: false,
      error: 'Failed to update setting'
    });
  }
});

module.exports = router;
