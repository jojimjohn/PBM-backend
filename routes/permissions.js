/**
 * Permissions Routes
 *
 * API endpoints for permission management and configuration.
 * These endpoints provide the permission catalog for the UI.
 */

const express = require('express');
const router = express.Router();
const { authenticateToken, requirePermission } = require('../middleware/auth');
const {
  PERMISSIONS,
  MODULES,
  getAllPermissionKeys,
  getPermissionsByModule,
  getPermission,
  isValidPermission,
  validatePermissions
} = require('../config/permissions');

/**
 * GET /permissions
 * Get all permissions grouped by module
 *
 * Returns permissions organized for the Permission Matrix UI component.
 * Each module contains its permissions with labels and descriptions.
 */
router.get('/', authenticateToken, async (req, res) => {
  try {
    const permissionsByModule = getPermissionsByModule();

    res.json({
      success: true,
      data: {
        modules: permissionsByModule,
        totalPermissions: getAllPermissionKeys().length,
        totalModules: Object.keys(MODULES).length
      }
    });
  } catch (error) {
    console.error('Error fetching permissions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch permissions'
    });
  }
});

/**
 * GET /permissions/all
 * Get flat list of all permission keys
 *
 * Useful for role assignment dropdowns and validation.
 */
router.get('/all', authenticateToken, async (req, res) => {
  try {
    const allKeys = getAllPermissionKeys();
    const allPermissions = allKeys.map(key => ({
      key,
      ...PERMISSIONS[key]
    }));

    res.json({
      success: true,
      data: allPermissions
    });
  } catch (error) {
    console.error('Error fetching all permissions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch permissions'
    });
  }
});

/**
 * GET /permissions/modules
 * Get list of all modules
 *
 * Returns module metadata for UI organization.
 */
router.get('/modules', authenticateToken, async (req, res) => {
  try {
    const modules = Object.values(MODULES)
      .sort((a, b) => a.order - b.order);

    res.json({
      success: true,
      data: modules
    });
  } catch (error) {
    console.error('Error fetching modules:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch modules'
    });
  }
});

/**
 * GET /permissions/:key
 * Get single permission details
 */
router.get('/:key', authenticateToken, async (req, res) => {
  try {
    const { key } = req.params;
    const permission = getPermission(key);

    if (!permission) {
      return res.status(404).json({
        success: false,
        error: 'Permission not found'
      });
    }

    res.json({
      success: true,
      data: permission
    });
  } catch (error) {
    console.error('Error fetching permission:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch permission'
    });
  }
});

/**
 * POST /permissions/validate
 * Validate a list of permission keys
 *
 * Useful before saving role permissions to ensure all keys are valid.
 */
router.post('/validate', authenticateToken, requirePermission('VIEW_ROLES'), async (req, res) => {
  try {
    const { permissions } = req.body;

    if (!Array.isArray(permissions)) {
      return res.status(400).json({
        success: false,
        error: 'Permissions must be an array'
      });
    }

    const result = validatePermissions(permissions);

    res.json({
      success: true,
      data: {
        valid: result.valid,
        invalidKeys: result.invalidKeys,
        validCount: permissions.length - result.invalidKeys.length,
        totalProvided: permissions.length
      }
    });
  } catch (error) {
    console.error('Error validating permissions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to validate permissions'
    });
  }
});

module.exports = router;
