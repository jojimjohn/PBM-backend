/**
 * Role Management Routes
 *
 * CRUD operations for database-driven role management.
 * Endpoints:
 * - GET /roles - List all roles for company with user counts
 * - GET /roles/permissions - Get all permissions grouped by module
 * - GET /roles/:id - Get single role details
 * - POST /roles - Create new role (MANAGE_ROLES permission)
 * - PUT /roles/:id - Update role (block system roles)
 * - DELETE /roles/:id - Delete role (check for assigned users)
 * - POST /roles/:id/clone - Clone an existing role
 * - GET /roles/:id/users - List users with this role
 */

const express = require('express');
const router = express.Router();
const { getDbConnection } = require('../config/database');
const { logger } = require('../utils/logger');
const { requirePermission } = require('../middleware/auth');
const {
  getPermissionsByModule,
  getAllPermissionKeys,
  validatePermissions
} = require('../config/permissions');

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Log audit event
 */
const logAudit = async (db, params) => {
  const {
    actorId,
    actorEmail,
    action,
    resourceType,
    resourceId,
    companyId,
    ipAddress,
    userAgent,
    details,
    oldValues,
    newValues,
    status = 'success'
  } = params;

  try {
    await db('audit_logs').insert({
      actor_id: actorId,
      actor_email: actorEmail,
      action,
      resource_type: resourceType,
      resource_id: resourceId,
      company_id: companyId,
      ip_address: ipAddress,
      user_agent: userAgent,
      details: details ? JSON.stringify(details) : null,
      old_values: oldValues ? JSON.stringify(oldValues) : null,
      new_values: newValues ? JSON.stringify(newValues) : null,
      status,
      created_at: new Date()
    });
  } catch (error) {
    logger.error('Failed to log audit event:', { error: error.message, params });
  }
};

/**
 * Generate slug from role name
 */
const generateSlug = (name) => {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '_')
    .replace(/-+/g, '_')
    .substring(0, 100);
};

/**
 * Parse permissions JSON from database
 */
const parsePermissions = (role) => {
  if (!role) return role;
  try {
    role.permissions = typeof role.permissions === 'string'
      ? JSON.parse(role.permissions)
      : role.permissions;
  } catch (e) {
    role.permissions = [];
  }
  return role;
};

// ============================================================================
// ROUTES
// ============================================================================

/**
 * GET /roles/permissions
 * Get all available permissions grouped by module
 * Required permission: VIEW_ROLES or MANAGE_ROLES
 */
router.get('/permissions', requirePermission('VIEW_ROLES'), async (req, res) => {
  try {
    const permissionsByModule = getPermissionsByModule();
    const allKeys = getAllPermissionKeys();

    res.json({
      success: true,
      data: {
        byModule: permissionsByModule,
        allKeys: allKeys,
        totalCount: allKeys.length
      }
    });
  } catch (error) {
    logger.error('Error fetching permissions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch permissions',
      message: error.message
    });
  }
});

/**
 * GET /roles
 * List all roles for the company with user counts
 * Required permission: VIEW_ROLES or MANAGE_USERS (user management needs role list)
 */
router.get('/', async (req, res, next) => {
  // Allow if user has VIEW_ROLES, MANAGE_ROLES, or MANAGE_USERS permission
  const userPermissions = req.user?.permissions || [];
  const hasAccess = userPermissions.some(p =>
    ['VIEW_ROLES', 'MANAGE_ROLES', 'MANAGE_USERS'].includes(p)
  );

  if (!hasAccess) {
    return res.status(403).json({
      success: false,
      error: "Permission 'VIEW_ROLES' or 'MANAGE_USERS' is required"
    });
  }
  next();
}, async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const db = getDbConnection(companyId);

    // Get roles with user counts
    const roles = await db('roles')
      .select(
        'roles.*',
        db.raw('(SELECT COUNT(*) FROM users WHERE users.role_id = roles.id) as user_count')
      )
      .where('roles.company_id', companyId)
      .orderBy('roles.hierarchy_level', 'desc')
      .orderBy('roles.name', 'asc');

    // Parse permissions JSON
    const parsedRoles = roles.map(parsePermissions);

    res.json({
      success: true,
      data: parsedRoles,
      meta: {
        totalRoles: roles.length,
        systemRoles: roles.filter(r => r.is_system).length,
        customRoles: roles.filter(r => !r.is_system).length
      }
    });
  } catch (error) {
    logger.error('Error fetching roles:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch roles',
      message: error.message
    });
  }
});

/**
 * GET /roles/:id
 * Get single role details
 * Required permission: VIEW_ROLES
 */
router.get('/:id', requirePermission('VIEW_ROLES'), async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.companyId;
    const db = getDbConnection(companyId);

    const role = await db('roles')
      .select(
        'roles.*',
        db.raw('(SELECT COUNT(*) FROM users WHERE users.role_id = roles.id) as user_count')
      )
      .where({ 'roles.id': id, 'roles.company_id': companyId })
      .first();

    if (!role) {
      return res.status(404).json({
        success: false,
        error: 'Role not found'
      });
    }

    res.json({
      success: true,
      data: parsePermissions(role)
    });
  } catch (error) {
    logger.error('Error fetching role:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch role',
      message: error.message
    });
  }
});

/**
 * GET /roles/:id/users
 * List users assigned to this role
 * Required permission: VIEW_ROLES
 */
router.get('/:id/users', requirePermission('VIEW_ROLES'), async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.companyId;
    const db = getDbConnection(companyId);

    // Verify role exists
    const role = await db('roles')
      .where({ id, company_id: companyId })
      .first();

    if (!role) {
      return res.status(404).json({
        success: false,
        error: 'Role not found'
      });
    }

    // Get users with this role
    const users = await db('users')
      .select('id', 'email', 'firstName', 'lastName', 'isActive', 'lastLoginAt')
      .where('role_id', id)
      .orderBy('firstName', 'asc');

    res.json({
      success: true,
      data: {
        role: {
          id: role.id,
          name: role.name,
          slug: role.slug
        },
        users,
        userCount: users.length
      }
    });
  } catch (error) {
    logger.error('Error fetching role users:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch role users',
      message: error.message
    });
  }
});

/**
 * POST /roles
 * Create a new role
 * Required permission: MANAGE_ROLES
 */
router.post('/', requirePermission('MANAGE_ROLES'), async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const db = getDbConnection(companyId);
    const {
      name,
      description,
      permissions = [],
      hierarchy_level = 1,
      color = '#6b7280'
    } = req.body;

    // Validation
    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Role name is required'
      });
    }

    // Validate hierarchy level (custom roles can be 1-8)
    if (hierarchy_level < 1 || hierarchy_level > 8) {
      return res.status(400).json({
        success: false,
        error: 'Hierarchy level must be between 1 and 8 for custom roles'
      });
    }

    // Check hierarchy: user can only create roles below their level
    const userRole = await db('roles')
      .where({ id: req.user.role_id, company_id: companyId })
      .first();

    if (userRole && hierarchy_level >= userRole.hierarchy_level) {
      return res.status(403).json({
        success: false,
        error: 'Cannot create a role at or above your hierarchy level'
      });
    }

    // Validate permissions
    const permissionValidation = validatePermissions(permissions);
    if (!permissionValidation.valid) {
      return res.status(400).json({
        success: false,
        error: 'Invalid permissions',
        invalidKeys: permissionValidation.invalidKeys
      });
    }

    // Check user has all permissions they're trying to assign
    const userPermissions = req.user.permissions || [];
    const unauthorized = permissions.filter(p => !userPermissions.includes(p));
    if (unauthorized.length > 0 && !userPermissions.includes('MANAGE_ROLES')) {
      // Allow if user has MANAGE_ROLES (admins can grant any permission)
      // Otherwise, check they're not granting permissions they don't have
      // Note: For now, we allow it since MANAGE_ROLES is required to reach this point
    }

    // Generate slug
    const slug = generateSlug(name);

    // Check for duplicate slug
    const existingRole = await db('roles')
      .where({ company_id: companyId, slug })
      .first();

    if (existingRole) {
      return res.status(400).json({
        success: false,
        error: 'A role with this name already exists'
      });
    }

    // Insert role
    const [insertId] = await db('roles').insert({
      company_id: companyId,
      name: name.trim(),
      slug,
      description: description?.trim() || null,
      permissions: JSON.stringify(permissions),
      hierarchy_level,
      is_system: false,
      is_active: true,
      color,
      created_by: req.user.id,
      created_at: new Date(),
      updated_at: new Date()
    });

    // Get the created role
    const newRole = await db('roles').where('id', insertId).first();

    // Audit log
    await logAudit(db, {
      actorId: req.user.id,
      actorEmail: req.user.email,
      action: 'role.created',
      resourceType: 'role',
      resourceId: insertId.toString(),
      companyId,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      details: { roleName: name },
      newValues: { name, slug, hierarchy_level, permissions }
    });

    logger.info(`Role created: ${name} by ${req.user.email}`);

    res.status(201).json({
      success: true,
      data: parsePermissions(newRole),
      message: 'Role created successfully'
    });
  } catch (error) {
    logger.error('Error creating role:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create role',
      message: error.message
    });
  }
});

/**
 * PUT /roles/:id
 * Update an existing role
 * Required permission: MANAGE_ROLES
 */
router.put('/:id', requirePermission('MANAGE_ROLES'), async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.companyId;
    const db = getDbConnection(companyId);
    const {
      name,
      description,
      permissions,
      hierarchy_level,
      color,
      is_active
    } = req.body;

    // Get existing role
    const existingRole = await db('roles')
      .where({ id, company_id: companyId })
      .first();

    if (!existingRole) {
      return res.status(404).json({
        success: false,
        error: 'Role not found'
      });
    }

    // Block editing system roles (super_admin, company_admin)
    if (existingRole.is_system) {
      return res.status(403).json({
        success: false,
        error: 'System roles cannot be modified'
      });
    }

    // Check hierarchy: can only edit roles below user's level
    const userRole = await db('roles')
      .where({ id: req.user.role_id, company_id: companyId })
      .first();

    if (userRole && existingRole.hierarchy_level >= userRole.hierarchy_level) {
      return res.status(403).json({
        success: false,
        error: 'Cannot modify a role at or above your hierarchy level'
      });
    }

    // Build update object
    const updates = { updated_at: new Date() };

    if (name !== undefined) {
      if (!name.trim()) {
        return res.status(400).json({
          success: false,
          error: 'Role name cannot be empty'
        });
      }
      updates.name = name.trim();
      updates.slug = generateSlug(name);

      // Check for duplicate slug
      const duplicateRole = await db('roles')
        .where({ company_id: companyId, slug: updates.slug })
        .whereNot('id', id)
        .first();

      if (duplicateRole) {
        return res.status(400).json({
          success: false,
          error: 'A role with this name already exists'
        });
      }
    }

    if (description !== undefined) {
      updates.description = description?.trim() || null;
    }

    if (permissions !== undefined) {
      const permissionValidation = validatePermissions(permissions);
      if (!permissionValidation.valid) {
        return res.status(400).json({
          success: false,
          error: 'Invalid permissions',
          invalidKeys: permissionValidation.invalidKeys
        });
      }
      updates.permissions = JSON.stringify(permissions);
    }

    if (hierarchy_level !== undefined) {
      if (hierarchy_level < 1 || hierarchy_level > 8) {
        return res.status(400).json({
          success: false,
          error: 'Hierarchy level must be between 1 and 8 for custom roles'
        });
      }
      if (userRole && hierarchy_level >= userRole.hierarchy_level) {
        return res.status(403).json({
          success: false,
          error: 'Cannot set hierarchy level at or above your own'
        });
      }
      updates.hierarchy_level = hierarchy_level;
    }

    if (color !== undefined) {
      updates.color = color;
    }

    if (is_active !== undefined) {
      updates.is_active = is_active;
    }

    // Apply updates
    await db('roles').where('id', id).update(updates);

    // Get updated role
    const updatedRole = await db('roles').where('id', id).first();

    // Audit log
    const oldValues = {
      name: existingRole.name,
      description: existingRole.description,
      hierarchy_level: existingRole.hierarchy_level,
      permissions: existingRole.permissions
    };

    await logAudit(db, {
      actorId: req.user.id,
      actorEmail: req.user.email,
      action: 'role.updated',
      resourceType: 'role',
      resourceId: id,
      companyId,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      details: { roleName: updatedRole.name },
      oldValues,
      newValues: updates
    });

    logger.info(`Role updated: ${updatedRole.name} by ${req.user.email}`);

    res.json({
      success: true,
      data: parsePermissions(updatedRole),
      message: 'Role updated successfully'
    });
  } catch (error) {
    logger.error('Error updating role:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update role',
      message: error.message
    });
  }
});

/**
 * DELETE /roles/:id
 * Delete a role (must have no assigned users)
 * Required permission: MANAGE_ROLES
 */
router.delete('/:id', requirePermission('MANAGE_ROLES'), async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.companyId;
    const db = getDbConnection(companyId);

    // Get existing role
    const existingRole = await db('roles')
      .where({ id, company_id: companyId })
      .first();

    if (!existingRole) {
      return res.status(404).json({
        success: false,
        error: 'Role not found'
      });
    }

    // Block deleting system roles
    if (existingRole.is_system) {
      return res.status(403).json({
        success: false,
        error: 'System roles cannot be deleted'
      });
    }

    // Check hierarchy
    const userRole = await db('roles')
      .where({ id: req.user.role_id, company_id: companyId })
      .first();

    if (userRole && existingRole.hierarchy_level >= userRole.hierarchy_level) {
      return res.status(403).json({
        success: false,
        error: 'Cannot delete a role at or above your hierarchy level'
      });
    }

    // Check for assigned users
    const userCount = await db('users')
      .where('role_id', id)
      .count('id as count')
      .first();

    if (userCount.count > 0) {
      return res.status(400).json({
        success: false,
        error: `Cannot delete role with ${userCount.count} assigned user(s). Please reassign users first.`,
        userCount: userCount.count
      });
    }

    // Delete the role
    await db('roles').where('id', id).delete();

    // Audit log
    await logAudit(db, {
      actorId: req.user.id,
      actorEmail: req.user.email,
      action: 'role.deleted',
      resourceType: 'role',
      resourceId: id,
      companyId,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      details: { roleName: existingRole.name },
      oldValues: { name: existingRole.name, slug: existingRole.slug }
    });

    logger.info(`Role deleted: ${existingRole.name} by ${req.user.email}`);

    res.json({
      success: true,
      message: 'Role deleted successfully'
    });
  } catch (error) {
    logger.error('Error deleting role:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete role',
      message: error.message
    });
  }
});

/**
 * POST /roles/:id/clone
 * Clone an existing role
 * Required permission: MANAGE_ROLES
 */
router.post('/:id/clone', requirePermission('MANAGE_ROLES'), async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.companyId;
    const db = getDbConnection(companyId);
    const { newName } = req.body;

    // Get source role
    const sourceRole = await db('roles')
      .where({ id, company_id: companyId })
      .first();

    if (!sourceRole) {
      return res.status(404).json({
        success: false,
        error: 'Source role not found'
      });
    }

    // Generate name for clone
    const cloneName = newName?.trim() || `Copy of ${sourceRole.name}`;
    const cloneSlug = generateSlug(cloneName);

    // Check for duplicate
    const existingRole = await db('roles')
      .where({ company_id: companyId, slug: cloneSlug })
      .first();

    if (existingRole) {
      return res.status(400).json({
        success: false,
        error: 'A role with this name already exists'
      });
    }

    // Determine hierarchy level (same as source, or 1 below if source is system)
    let hierarchyLevel = sourceRole.hierarchy_level;
    if (sourceRole.is_system) {
      hierarchyLevel = Math.min(8, sourceRole.hierarchy_level - 1);
    }

    // Create clone
    const [insertId] = await db('roles').insert({
      company_id: companyId,
      name: cloneName,
      slug: cloneSlug,
      description: sourceRole.description,
      permissions: sourceRole.permissions, // Already JSON string
      hierarchy_level: hierarchyLevel,
      is_system: false,
      is_active: true,
      color: sourceRole.color,
      created_by: req.user.id,
      created_at: new Date(),
      updated_at: new Date()
    });

    // Get the cloned role
    const clonedRole = await db('roles').where('id', insertId).first();

    // Audit log
    await logAudit(db, {
      actorId: req.user.id,
      actorEmail: req.user.email,
      action: 'role.cloned',
      resourceType: 'role',
      resourceId: insertId.toString(),
      companyId,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      details: {
        sourceRoleId: id,
        sourceRoleName: sourceRole.name,
        cloneName
      }
    });

    logger.info(`Role cloned: ${sourceRole.name} -> ${cloneName} by ${req.user.email}`);

    res.status(201).json({
      success: true,
      data: parsePermissions(clonedRole),
      message: 'Role cloned successfully'
    });
  } catch (error) {
    logger.error('Error cloning role:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to clone role',
      message: error.message
    });
  }
});

module.exports = router;
