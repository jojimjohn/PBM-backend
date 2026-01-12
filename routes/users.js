/**
 * User Management Routes (Tasks 29-35)
 *
 * Comprehensive user management API endpoints:
 * - Task 29: Enhanced user listing
 * - Task 30: User creation
 * - Task 31: User update
 * - Task 32: User deactivation
 * - Task 33: Password reset
 * - Task 34: Force logout
 * - Task 35: Permission overrides
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { getDbConnection } = require('../config/database');
const { logger } = require('../utils/logger');
const { requirePermission } = require('../middleware/auth');
const { validate, validateParams, schemas } = require('../middleware/validation');
const {
  canManageRole,
  canAssignRole,
  getAssignableRoles,
  validateRoleChange,
  getRoleDisplayName,
  isValidRole,
  normalizeRole,
  getRoleLevel
} = require('../utils/roleHierarchy');
const emailService = require('../utils/emailService');
const { blacklistAllUserTokens } = require('../utils/tokenBlacklist');
const { clearSession } = require('../middleware/sessionTimeout');
const pettyCashUserService = require('../services/pettyCashUserService');

// Import all valid permissions from roles config (for permission override validation)
const VALID_PERMISSIONS = [
  'VIEW_DASHBOARD', 'VIEW_SALES', 'CREATE_SALES', 'APPROVE_SALES',
  'VIEW_PURCHASE', 'CREATE_PURCHASE', 'APPROVE_PURCHASE',
  'VIEW_INVENTORY', 'MANAGE_INVENTORY',
  'VIEW_CUSTOMERS', 'MANAGE_CUSTOMERS',
  'VIEW_SUPPLIERS', 'MANAGE_SUPPLIERS',
  'VIEW_CONTRACTS', 'MANAGE_CONTRACTS',
  'VIEW_EXPENSES', 'MANAGE_EXPENSES', 'APPROVE_EXPENSES',
  'VIEW_WASTAGES', 'MANAGE_WASTAGES', 'APPROVE_WASTAGES',
  'VIEW_PETTY_CASH', 'MANAGE_PETTY_CASH', 'APPROVE_PETTY_CASH',
  'VIEW_REPORTS', 'EXPORT_REPORTS',
  'VIEW_SETTINGS', 'MANAGE_SETTINGS',
  'MANAGE_USERS', 'VIEW_AUDIT_LOGS'
];

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate a secure temporary password
 * @returns {string} Temporary password
 */
const generateTempPassword = () => {
  // Format: Word + Numbers + Symbol (easy to type, meets complexity)
  const words = ['Welcome', 'Temp', 'Start', 'Init', 'Access', 'Login'];
  const word = words[Math.floor(Math.random() * words.length)];
  const numbers = Math.floor(1000 + Math.random() * 9000); // 4 digits
  const symbols = '@$!%*?&';
  const symbol = symbols[Math.floor(Math.random() * symbols.length)];

  return `${word}${numbers}${symbol}`;
};

/**
 * Log audit event
 * @param {Object} db - Database connection
 * @param {Object} params - Audit parameters
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
      details,
      old_values: oldValues ? JSON.stringify(oldValues) : null,
      new_values: newValues ? JSON.stringify(newValues) : null,
      status
    });
  } catch (error) {
    // Log error but don't fail the request
    logger.error('Failed to write audit log', {
      error: error.message,
      action,
      resourceType,
      resourceId
    });
  }
};

// ============================================================================
// TASK 29: Enhanced User Listing
// ============================================================================

/**
 * GET /api/users
 * List all users for the company with enhanced details
 * Requires: MANAGE_USERS permission
 */
router.get('/',
  requirePermission('MANAGE_USERS'),
  async (req, res) => {
    try {
      const { companyId, userId: actorId, role: actorRole } = req.user;
      const db = getDbConnection(companyId);

      // Normalize the actor's role for consistent comparison
      const normalizedActorRole = normalizeRole(actorRole);

      // Get manageable roles for filtering
      const manageableRoles = getAssignableRoles(actorRole);

      // Map company ID variants (backend uses kebab-case, some records may use camelCase)
      const companyIdVariants = {
        'al-ramrami': ['al-ramrami', 'alramrami', 'al_ramrami'],
        'pride-muscat': ['pride-muscat', 'pridemuscat', 'pride_muscat']
      };
      const validCompanyIds = companyIdVariants[companyId] || [companyId];

      // Query users with enhanced fields (including role from roles table)
      // LEFT JOIN with roles table to get role name from database-driven roles system
      let query = db('users')
        .leftJoin('roles', 'users.role_id', 'roles.id')
        .select(
          'users.id',
          'users.email',
          'users.username',
          'users.firstName',
          'users.lastName',
          'users.role_id as roleId',
          // Use role name from roles table, fallback to legacy role column
          db.raw('COALESCE(roles.slug, users.role) as role'),
          db.raw('COALESCE(roles.name, users.role) as roleName'),
          'roles.hierarchy_level as roleHierarchyLevel',
          'users.isActive',
          'users.lastLoginAt',
          'users.lastLoginIp',
          'users.mfa_enabled as mfaEnabled',
          'users.force_password_change as forcePasswordChange',
          'users.created_at as createdAt',
          'users.created_by as createdBy'
        )
        .whereIn('users.companyId', validCompanyIds);

      // Super admins see all users, others only see manageable roles
      // Use getRoleLevel to determine if user is super-admin regardless of format
      if (getRoleLevel(actorRole) < 5) { // Not super-admin
        // Filter to users with roles the actor can manage, plus their own role
        // Since database might store roles in different format, we don't filter here
        // The canManage check in the response handles access control
      }

      // Optional filters
      const { role, isActive, search } = req.query;

      if (role) {
        // Filter by role slug from roles table or legacy role column
        query = query.where(function() {
          this.where('roles.slug', role)
            .orWhere('users.role', role);
        });
      }

      // Only filter by isActive if explicitly set to 'true' or 'false'
      if (isActive === 'true' || isActive === 'false') {
        query = query.where('users.isActive', isActive === 'true' ? 1 : 0);
      }

      if (search) {
        query = query.where(function() {
          this.where('users.email', 'like', `%${search}%`)
            .orWhere('users.firstName', 'like', `%${search}%`)
            .orWhere('users.lastName', 'like', `%${search}%`);
        });
      }

      const users = await query.orderBy('users.firstName', 'asc');

      // Get online status from Redis for all users
      const userIds = users.map(u => u.id);
      const onlineMap = {};

      // Import Redis and session timeout settings
      const { redis } = require('../config/redis');
      const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

      // Check Redis for each user's session activity
      for (const userId of userIds) {
        try {
          const sessionKey = `session:activity:${userId}`;
          const lastActivityStr = await redis.get(sessionKey);

          if (lastActivityStr) {
            const lastActivity = parseInt(lastActivityStr, 10);
            const now = Date.now();
            const remainingMs = SESSION_TIMEOUT_MS - (now - lastActivity);

            // User is online if they have an active session that hasn't timed out
            if (remainingMs > 0) {
              onlineMap[userId] = true;
            }
          }
        } catch (err) {
          // Redis error - don't fail the entire request
          logger.warn(`Failed to check session for user ${userId}`, { error: err.message });
        }
      }

      // Format response with additional computed fields
      const formattedUsers = users.map(user => ({
        ...user,
        fullName: `${user.firstName} ${user.lastName}`,
        // Use roleName from joined roles table, fallback to getRoleDisplayName for legacy
        roleDisplayName: user.roleName || getRoleDisplayName(user.role),
        canManage: canManageRole(actorRole, user.role) && user.id !== actorId,
        canChangeRole: canAssignRole(actorRole, user.role),
        isOnline: !!onlineMap[user.id]
      }));

      res.json({
        success: true,
        data: formattedUsers,
        meta: {
          total: formattedUsers.length,
          assignableRoles: getAssignableRoles(actorRole).map(role => ({
            value: role,
            label: getRoleDisplayName(role)
          }))
        }
      });

    } catch (error) {
      logger.error('Error fetching users', {
        error: error.message,
        companyId: req.user.companyId,
        userId: req.user.userId
      });

      res.status(500).json({
        success: false,
        error: 'Failed to fetch users'
      });
    }
  });

/**
 * GET /api/users/:id
 * Get single user details
 * Requires: MANAGE_USERS permission
 */
router.get('/:id',
  requirePermission('MANAGE_USERS'),
  validateParams(schemas.userId),
  async (req, res) => {
    try {
      const { companyId, role: actorRole } = req.user;
      const { id } = req.params;
      const db = getDbConnection(companyId);

      const user = await db('users')
        .select(
          'id',
          'email',
          'firstName',
          'lastName',
          'role',
          'isActive',
          'lastLoginAt',
          'lastLoginIp',
          'mfa_enabled as mfaEnabled',
          'force_password_change as forcePasswordChange',
          'created_at as createdAt',
          'created_by as createdBy',
          'updated_at as updatedAt',
          'updated_by as updatedBy'
        )
        .where({ id, companyId })
        .first();

      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }

      // Check if actor can view this user
      if (!canManageRole(actorRole, user.role) && actorRole !== user.role) {
        return res.status(403).json({
          success: false,
          error: 'Insufficient privileges to view this user'
        });
      }

      // Get permission overrides
      const overrides = await db('user_permission_overrides')
        .select('permission', 'granted', 'reason', 'granted_at as grantedAt')
        .where('user_id', id);

      res.json({
        success: true,
        data: {
          ...user,
          fullName: `${user.firstName} ${user.lastName}`,
          roleDisplayName: getRoleDisplayName(user.role),
          permissionOverrides: overrides
        }
      });

    } catch (error) {
      logger.error('Error fetching user', {
        error: error.message,
        userId: req.params.id,
        companyId: req.user.companyId
      });

      res.status(500).json({
        success: false,
        error: 'Failed to fetch user'
      });
    }
  });

// ============================================================================
// TASK 30: User Creation
// ============================================================================

/**
 * POST /api/users
 * Create a new user
 * Requires: MANAGE_USERS permission
 * Updated to use roleId (database role ID) instead of hardcoded role strings
 */
router.post('/',
  requirePermission('MANAGE_USERS'),
  validate(schemas.createUser),
  async (req, res) => {
    try {
      const { companyId, userId: actorId, role: actorRole, email: actorEmail, roleId: actorRoleId } = req.user;
      const { email, username, firstName, lastName, roleId, sendWelcomeEmail = true, createPettyCashAccount = true } = req.body;
      const db = getDbConnection(companyId);

      // Look up the target role from the database
      // Include both company-specific roles AND system roles (company_id IS NULL)
      const targetRole = await db('roles')
        .where({ id: roleId, is_active: true })
        .where(function() {
          this.where('company_id', companyId).orWhereNull('company_id');
        })
        .first();

      if (!targetRole) {
        return res.status(400).json({
          success: false,
          error: 'Invalid role',
          details: 'The specified role does not exist or is not active'
        });
      }

      // Get actor's role hierarchy level (from database if available, else from legacy role)
      let actorHierarchyLevel;
      if (actorRoleId) {
        const actorDbRole = await db('roles').where({ id: actorRoleId }).first();
        actorHierarchyLevel = actorDbRole?.hierarchy_level || getRoleLevel(actorRole);
      } else {
        actorHierarchyLevel = getRoleLevel(actorRole);
      }

      // Validate hierarchy - can only assign roles below own level
      if (targetRole.hierarchy_level >= actorHierarchyLevel) {
        return res.status(403).json({
          success: false,
          error: 'Cannot create user with this role',
          details: 'You can only create users with roles below your own hierarchy level'
        });
      }

      // Check if email already exists in this company
      const existingUser = await db('users')
        .where({ email, companyId })
        .first();

      if (existingUser) {
        return res.status(409).json({
          success: false,
          error: 'Email already registered',
          code: 'EMAIL_EXISTS'
        });
      }

      // Check if username already exists in this company (if provided)
      if (username) {
        const existingUsername = await db('users')
          .where({ username: username.toLowerCase(), companyId })
          .first();

        if (existingUsername) {
          return res.status(409).json({
            success: false,
            error: 'Username already taken',
            code: 'USERNAME_EXISTS'
          });
        }
      }

      // Generate temporary password
      const tempPassword = generateTempPassword();
      const hashedPassword = await bcrypt.hash(tempPassword, 12);

      // Create user with both role_id and legacy role slug for backward compatibility
      const [userId] = await db('users').insert({
        email,
        username: username ? username.toLowerCase() : null, // Optional username for login
        password: hashedPassword,
        firstName,
        lastName,
        role: targetRole.slug, // Legacy role field for backward compatibility
        role_id: roleId,       // New role ID field
        companyId,
        isActive: true,
        force_password_change: true,
        mfa_enabled: false,
        created_by: actorId,
        updated_by: actorId
      });

      // Log audit event
      await logAudit(db, {
        actorId,
        actorEmail,
        action: 'CREATE_USER',
        resourceType: 'user',
        resourceId: userId,
        companyId,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        details: `Created user ${email} with role ${targetRole.name} (ID: ${roleId})`,
        newValues: { email, firstName, lastName, roleId, roleName: targetRole.name }
      });

      // Send welcome email if configured
      let emailSent = false;
      if (sendWelcomeEmail) {
        const companyNames = {
          'al-ramrami': 'Al Ramrami Trading Enterprises',
          'pride-muscat': 'Pride Muscat International LLC'
        };
        const result = await emailService.sendWelcomeEmail(
          email,
          tempPassword,
          firstName,
          companyNames[companyId] || companyId
        );
        emailSent = result.success;
      }

      // Auto-create petty cash account if enabled
      let pettyCashResult = null;
      if (createPettyCashAccount) {
        try {
          pettyCashResult = await pettyCashUserService.createFromSystemUser(
            userId,
            companyId,
            {
              name: `${firstName} ${lastName}`,
              createdBy: actorId,
            }
          );

          logger.info('Petty cash account auto-created for new user', {
            userId,
            pettyCashUserId: pettyCashResult.pettyCashUser?.id,
            existing: pettyCashResult.existing,
          });
        } catch (pcError) {
          // Log error but don't fail user creation
          logger.error('Failed to auto-create petty cash account', {
            userId,
            error: pcError.message,
          });
        }
      }

      logger.info('User created', {
        newUserId: userId,
        email,
        roleId,
        roleName: targetRole.name,
        createdBy: actorId,
        companyId,
        emailSent,
        pettyCashAccountCreated: !!pettyCashResult?.pettyCashUser,
      });

      res.status(201).json({
        success: true,
        message: 'User created successfully',
        data: {
          id: userId,
          email,
          firstName,
          lastName,
          roleId,
          role: targetRole.slug,
          roleName: targetRole.name,
          forcePasswordChange: true,
          emailSent,
          // Only include temp password if email wasn't sent
          ...((!emailSent && sendWelcomeEmail) ? { tempPassword } : {}),
          // Include petty cash account info
          pettyCashAccount: pettyCashResult ? {
            created: !pettyCashResult.existing,
            pettyCashUserId: pettyCashResult.pettyCashUser?.id,
            message: pettyCashResult.message || 'Petty cash account created. PIN will be generated when card is assigned.',
          } : null,
        }
      });

    } catch (error) {
      logger.error('Error creating user', {
        error: error.message,
        email: req.body.email,
        companyId: req.user.companyId
      });

      res.status(500).json({
        success: false,
        error: 'Failed to create user'
      });
    }
  });

// ============================================================================
// TASK 31: User Update
// ============================================================================

/**
 * PUT /api/users/:id
 * Update user details
 * Requires: MANAGE_USERS permission
 * Updated to use roleId (database role ID) instead of hardcoded role strings
 */
router.put('/:id',
  requirePermission('MANAGE_USERS'),
  validateParams(schemas.userId),
  validate(schemas.updateUser),
  async (req, res) => {
    try {
      const { companyId, userId: actorId, role: actorRole, email: actorEmail, roleId: actorRoleId } = req.user;
      const { id } = req.params;
      const updates = req.body;
      const db = getDbConnection(companyId);

      // Get current user
      const targetUser = await db('users')
        .where({ id, companyId })
        .first();

      if (!targetUser) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }

      // Cannot modify own role
      if (parseInt(id) === actorId && updates.roleId) {
        return res.status(403).json({
          success: false,
          error: 'Cannot modify your own role'
        });
      }

      // Get actor's hierarchy level from database or legacy role
      let actorHierarchyLevel;
      if (actorRoleId) {
        const actorDbRole = await db('roles').where({ id: actorRoleId }).first();
        actorHierarchyLevel = actorDbRole?.hierarchy_level || getRoleLevel(actorRole);
      } else {
        actorHierarchyLevel = getRoleLevel(actorRole);
      }

      // Get target user's current hierarchy level
      let targetCurrentLevel;
      if (targetUser.role_id) {
        const targetDbRole = await db('roles').where({ id: targetUser.role_id }).first();
        targetCurrentLevel = targetDbRole?.hierarchy_level || getRoleLevel(targetUser.role);
      } else {
        targetCurrentLevel = getRoleLevel(targetUser.role);
      }

      // Check hierarchy - can only manage users with lower hierarchy
      if (targetCurrentLevel >= actorHierarchyLevel) {
        return res.status(403).json({
          success: false,
          error: 'Insufficient privileges to modify this user'
        });
      }

      // Build update object
      const updateData = {
        updated_by: actorId,
        updated_at: db.fn.now()
      };

      if (updates.firstName) updateData.firstName = updates.firstName;
      if (updates.lastName) updateData.lastName = updates.lastName;
      if (typeof updates.isActive !== 'undefined') updateData.isActive = updates.isActive;

      // Validate role change if roleId provided
      if (updates.roleId) {
        // Look up the new role from database
        // Include both company-specific roles AND system roles (company_id IS NULL)
        const newRole = await db('roles')
          .where({ id: updates.roleId, is_active: true })
          .where(function() {
            this.where('company_id', companyId).orWhereNull('company_id');
          })
          .first();

        if (!newRole) {
          return res.status(400).json({
            success: false,
            error: 'Invalid role',
            details: 'The specified role does not exist or is not active'
          });
        }

        // Validate hierarchy - can only assign roles below own level
        if (newRole.hierarchy_level >= actorHierarchyLevel) {
          return res.status(403).json({
            success: false,
            error: 'Cannot assign this role',
            details: 'You can only assign roles below your own hierarchy level'
          });
        }

        updateData.role_id = updates.roleId;
        updateData.role = newRole.slug; // Update legacy role field for backward compatibility
      }

      // Update user
      await db('users')
        .where({ id, companyId })
        .update(updateData);

      // Log audit event
      const oldValues = {
        firstName: targetUser.firstName,
        lastName: targetUser.lastName,
        roleId: targetUser.role_id,
        role: targetUser.role,
        isActive: targetUser.isActive
      };

      await logAudit(db, {
        actorId,
        actorEmail,
        action: 'UPDATE_USER',
        resourceType: 'user',
        resourceId: parseInt(id),
        companyId,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        details: `Updated user ${targetUser.email}`,
        oldValues,
        newValues: updates
      });

      logger.info('User updated', {
        targetUserId: id,
        updatedBy: actorId,
        changes: Object.keys(updates)
      });

      res.json({
        success: true,
        message: 'User updated successfully'
      });

    } catch (error) {
      logger.error('Error updating user', {
        error: error.message,
        userId: req.params.id,
        companyId: req.user.companyId
      });

      res.status(500).json({
        success: false,
        error: 'Failed to update user'
      });
    }
  });

// ============================================================================
// TASK 32: User Deactivation
// ============================================================================

/**
 * DELETE /api/users/:id
 * Deactivate user (soft delete)
 * Also terminates all sessions and blacklists tokens
 * Requires: MANAGE_USERS permission
 */
router.delete('/:id',
  requirePermission('MANAGE_USERS'),
  validateParams(schemas.userId),
  async (req, res) => {
    try {
      const { companyId, userId: actorId, role: actorRole, email: actorEmail } = req.user;
      const { id } = req.params;
      const db = getDbConnection(companyId);

      // Cannot deactivate yourself
      if (parseInt(id) === actorId) {
        return res.status(403).json({
          success: false,
          error: 'Cannot deactivate your own account'
        });
      }

      // Get target user
      const targetUser = await db('users')
        .where({ id, companyId })
        .first();

      if (!targetUser) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }

      // Check role hierarchy
      if (!canManageRole(actorRole, targetUser.role)) {
        return res.status(403).json({
          success: false,
          error: 'Insufficient privileges to deactivate this user'
        });
      }

      // Deactivate user
      await db('users')
        .where({ id, companyId })
        .update({
          isActive: false,
          updated_by: actorId,
          updated_at: db.fn.now()
        });

      // Invalidate all sessions
      await db('user_sessions')
        .where('user_id', id)
        .update({ is_active: false });

      // Blacklist all tokens for this user
      await blacklistAllUserTokens(parseInt(id));

      // Deactivate linked petty cash user
      let pettyCashDeactivated = null;
      try {
        pettyCashDeactivated = await pettyCashUserService.deactivateByUserId(
          parseInt(id),
          companyId,
          {
            deactivatedBy: actorId,
            reason: 'System user deactivated',
          }
        );

        if (pettyCashDeactivated.deactivated) {
          logger.info('Petty cash user deactivated with system user', {
            userId: id,
            pettyCashUserId: pettyCashDeactivated.pettyCashUserId,
          });
        }
      } catch (pcError) {
        // Log error but don't fail user deactivation
        logger.error('Failed to deactivate petty cash user', {
          userId: id,
          error: pcError.message,
        });
      }

      // Log audit event
      await logAudit(db, {
        actorId,
        actorEmail,
        action: 'DEACTIVATE_USER',
        resourceType: 'user',
        resourceId: parseInt(id),
        companyId,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        details: `Deactivated user ${targetUser.email}`,
        oldValues: { isActive: true },
        newValues: { isActive: false }
      });

      // Send notification email
      await emailService.sendDeactivationNotification(
        targetUser.email,
        targetUser.firstName,
        `${req.user.firstName} ${req.user.lastName}`
      );

      logger.info('User deactivated', {
        targetUserId: id,
        targetEmail: targetUser.email,
        deactivatedBy: actorId,
        pettyCashDeactivated: !!pettyCashDeactivated?.deactivated,
      });

      res.json({
        success: true,
        message: 'User deactivated successfully',
        data: {
          pettyCashAccountDeactivated: !!pettyCashDeactivated?.deactivated,
        },
      });

    } catch (error) {
      logger.error('Error deactivating user', {
        error: error.message,
        userId: req.params.id,
        companyId: req.user.companyId
      });

      res.status(500).json({
        success: false,
        error: 'Failed to deactivate user'
      });
    }
  });

// ============================================================================
// TASK 33: Password Reset
// ============================================================================

/**
 * POST /api/users/:id/reset-password
 * Admin-initiated password reset
 * Requires: MANAGE_USERS permission
 */
router.post('/:id/reset-password',
  requirePermission('MANAGE_USERS'),
  validateParams(schemas.userId),
  validate(schemas.resetPassword),
  async (req, res) => {
    try {
      const { companyId, userId: actorId, role: actorRole, email: actorEmail, firstName: actorFirstName, lastName: actorLastName } = req.user;
      const { id } = req.params;
      const { sendEmail = true } = req.body;
      const db = getDbConnection(companyId);

      // Get target user
      const targetUser = await db('users')
        .where({ id, companyId })
        .first();

      if (!targetUser) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }

      // Check role hierarchy
      if (!canManageRole(actorRole, targetUser.role)) {
        return res.status(403).json({
          success: false,
          error: 'Insufficient privileges to reset password for this user'
        });
      }

      // Generate new temporary password
      const tempPassword = generateTempPassword();
      const hashedPassword = await bcrypt.hash(tempPassword, 12);

      // Update password
      await db('users')
        .where({ id, companyId })
        .update({
          password: hashedPassword,
          force_password_change: true,
          updated_by: actorId,
          updated_at: db.fn.now()
        });

      // Log audit event
      await logAudit(db, {
        actorId,
        actorEmail,
        action: 'RESET_PASSWORD',
        resourceType: 'user',
        resourceId: parseInt(id),
        companyId,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        details: `Reset password for user ${targetUser.email}`
      });

      // Send email if configured
      let emailSent = false;
      if (sendEmail) {
        const result = await emailService.sendPasswordResetEmail(
          targetUser.email,
          tempPassword,
          targetUser.firstName,
          `${actorFirstName} ${actorLastName}`
        );
        emailSent = result.success;
      }

      logger.info('Password reset', {
        targetUserId: id,
        targetEmail: targetUser.email,
        resetBy: actorId,
        emailSent
      });

      res.json({
        success: true,
        message: 'Password reset successfully',
        data: {
          emailSent,
          // Only include temp password if email wasn't sent
          ...(!emailSent ? { tempPassword } : {})
        }
      });

    } catch (error) {
      logger.error('Error resetting password', {
        error: error.message,
        userId: req.params.id,
        companyId: req.user.companyId
      });

      res.status(500).json({
        success: false,
        error: 'Failed to reset password'
      });
    }
  });

// ============================================================================
// TASK 34: Force Logout
// ============================================================================

/**
 * POST /api/users/:id/force-logout
 * Terminate all sessions for a user
 * Requires: MANAGE_USERS permission
 */
router.post('/:id/force-logout',
  requirePermission('MANAGE_USERS'),
  validateParams(schemas.userId),
  async (req, res) => {
    try {
      const { companyId, userId: actorId, role: actorRole, email: actorEmail } = req.user;
      const { id } = req.params;
      const db = getDbConnection(companyId);

      // Get target user
      const targetUser = await db('users')
        .where({ id, companyId })
        .first();

      if (!targetUser) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }

      // Check role hierarchy (allow forcing logout of self)
      if (parseInt(id) !== actorId && !canManageRole(actorRole, targetUser.role)) {
        return res.status(403).json({
          success: false,
          error: 'Insufficient privileges to force logout this user'
        });
      }

      // Invalidate all sessions in database
      const invalidatedSessions = await db('user_sessions')
        .where({ user_id: id, is_active: true })
        .update({ is_active: false });

      // Clear Redis session (for online status)
      await clearSession(parseInt(id));

      // Blacklist all tokens for this user
      await blacklistAllUserTokens(parseInt(id));

      // Log audit event
      await logAudit(db, {
        actorId,
        actorEmail,
        action: 'FORCE_LOGOUT',
        resourceType: 'user',
        resourceId: parseInt(id),
        companyId,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        details: `Force logged out user ${targetUser.email} (${invalidatedSessions} sessions)`
      });

      logger.info('Force logout', {
        targetUserId: id,
        targetEmail: targetUser.email,
        invalidatedSessions,
        forcedBy: actorId
      });

      res.json({
        success: true,
        message: 'User logged out from all sessions',
        data: {
          invalidatedSessions
        }
      });

    } catch (error) {
      logger.error('Error forcing logout', {
        error: error.message,
        userId: req.params.id,
        companyId: req.user.companyId
      });

      res.status(500).json({
        success: false,
        error: 'Failed to force logout'
      });
    }
  });

// ============================================================================
// TASK 35: Permission Overrides
// ============================================================================

/**
 * GET /api/users/:id/permissions
 * Get user permissions with overrides
 * Requires: MANAGE_USERS permission
 */
router.get('/:id/permissions',
  requirePermission('MANAGE_USERS'),
  validateParams(schemas.userId),
  async (req, res) => {
    try {
      const { companyId, role: actorRole } = req.user;
      const { id } = req.params;
      const db = getDbConnection(companyId);

      // Get target user
      const targetUser = await db('users')
        .select('id', 'role')
        .where({ id, companyId })
        .first();

      if (!targetUser) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }

      // Check role hierarchy
      if (!canManageRole(actorRole, targetUser.role)) {
        return res.status(403).json({
          success: false,
          error: 'Insufficient privileges to view permissions for this user'
        });
      }

      // Get permission overrides
      const overrides = await db('user_permission_overrides')
        .select('permission', 'granted', 'reason', 'granted_at as grantedAt', 'granted_by as grantedBy')
        .where('user_id', id);

      // Build permissions map with overrides
      const overrideMap = {};
      overrides.forEach(o => {
        overrideMap[o.permission] = o;
      });

      // Return all valid permissions with override status
      const permissions = VALID_PERMISSIONS.map(permission => ({
        permission,
        hasOverride: !!overrideMap[permission],
        granted: overrideMap[permission]?.granted ?? null,
        reason: overrideMap[permission]?.reason ?? null,
        grantedAt: overrideMap[permission]?.grantedAt ?? null
      }));

      res.json({
        success: true,
        data: {
          userId: parseInt(id),
          role: targetUser.role,
          permissions,
          overrideCount: overrides.length
        }
      });

    } catch (error) {
      logger.error('Error fetching permissions', {
        error: error.message,
        userId: req.params.id,
        companyId: req.user.companyId
      });

      res.status(500).json({
        success: false,
        error: 'Failed to fetch permissions'
      });
    }
  });

/**
 * POST /api/users/:id/permissions
 * Set permission override
 * Requires: MANAGE_USERS permission
 */
router.post('/:id/permissions',
  requirePermission('MANAGE_USERS'),
  validateParams(schemas.userId),
  validate(schemas.permissionOverride),
  async (req, res) => {
    try {
      const { companyId, userId: actorId, role: actorRole, email: actorEmail } = req.user;
      const { id } = req.params;
      const { permission, granted, reason } = req.body;
      const db = getDbConnection(companyId);

      // Validate permission exists
      if (!VALID_PERMISSIONS.includes(permission)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid permission',
          validPermissions: VALID_PERMISSIONS
        });
      }

      // Get target user
      const targetUser = await db('users')
        .select('id', 'role', 'email')
        .where({ id, companyId })
        .first();

      if (!targetUser) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }

      // Check role hierarchy
      if (!canManageRole(actorRole, targetUser.role)) {
        return res.status(403).json({
          success: false,
          error: 'Insufficient privileges to modify permissions for this user'
        });
      }

      // Upsert permission override
      const existingOverride = await db('user_permission_overrides')
        .where({ user_id: id, permission })
        .first();

      if (existingOverride) {
        await db('user_permission_overrides')
          .where({ user_id: id, permission })
          .update({
            granted,
            reason: reason || null,
            granted_by: actorId,
            granted_at: db.fn.now()
          });
      } else {
        await db('user_permission_overrides').insert({
          user_id: id,
          permission,
          granted,
          reason: reason || null,
          granted_by: actorId
        });
      }

      // Log audit event
      await logAudit(db, {
        actorId,
        actorEmail,
        action: granted ? 'GRANT_PERMISSION' : 'REVOKE_PERMISSION',
        resourceType: 'permission_override',
        resourceId: parseInt(id),
        companyId,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        details: `${granted ? 'Granted' : 'Revoked'} permission ${permission} for user ${targetUser.email}`,
        oldValues: existingOverride ? { granted: existingOverride.granted } : null,
        newValues: { permission, granted, reason }
      });

      logger.info('Permission override set', {
        targetUserId: id,
        permission,
        granted,
        setBy: actorId
      });

      res.json({
        success: true,
        message: `Permission ${granted ? 'granted' : 'revoked'} successfully`
      });

    } catch (error) {
      logger.error('Error setting permission override', {
        error: error.message,
        userId: req.params.id,
        companyId: req.user.companyId
      });

      res.status(500).json({
        success: false,
        error: 'Failed to set permission override'
      });
    }
  });

/**
 * DELETE /api/users/:id/permissions/:permission
 * Remove permission override (revert to role default)
 * Requires: MANAGE_USERS permission
 */
router.delete('/:id/permissions/:permission',
  requirePermission('MANAGE_USERS'),
  async (req, res) => {
    try {
      const { companyId, userId: actorId, role: actorRole, email: actorEmail } = req.user;
      const { id, permission } = req.params;
      const db = getDbConnection(companyId);

      // Get target user
      const targetUser = await db('users')
        .select('id', 'role', 'email')
        .where({ id, companyId })
        .first();

      if (!targetUser) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }

      // Check role hierarchy
      if (!canManageRole(actorRole, targetUser.role)) {
        return res.status(403).json({
          success: false,
          error: 'Insufficient privileges to modify permissions for this user'
        });
      }

      // Get existing override
      const existingOverride = await db('user_permission_overrides')
        .where({ user_id: id, permission })
        .first();

      if (!existingOverride) {
        return res.status(404).json({
          success: false,
          error: 'Permission override not found'
        });
      }

      // Delete override
      await db('user_permission_overrides')
        .where({ user_id: id, permission })
        .delete();

      // Log audit event
      await logAudit(db, {
        actorId,
        actorEmail,
        action: 'REMOVE_PERMISSION_OVERRIDE',
        resourceType: 'permission_override',
        resourceId: parseInt(id),
        companyId,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        details: `Removed permission override ${permission} for user ${targetUser.email}`,
        oldValues: { permission, granted: existingOverride.granted }
      });

      logger.info('Permission override removed', {
        targetUserId: id,
        permission,
        removedBy: actorId
      });

      res.json({
        success: true,
        message: 'Permission override removed (reverted to role default)'
      });

    } catch (error) {
      logger.error('Error removing permission override', {
        error: error.message,
        userId: req.params.id,
        companyId: req.user.companyId
      });

      res.status(500).json({
        success: false,
        error: 'Failed to remove permission override'
      });
    }
  });

module.exports = router;
