/**
 * Role Hierarchy Utility (Task 27)
 *
 * Enforces role hierarchy in user management operations.
 * Users can only manage users of lower rank than themselves.
 *
 * Role Levels (higher number = more privilege):
 * - SUPER_ADMIN: 5 (can manage all)
 * - COMPANY_ADMIN: 4 (can manage company users)
 * - MANAGER: 3 (can manage staff)
 * - SALES_STAFF/PURCHASE_STAFF/ACCOUNTS_STAFF: 1 (lowest, cannot manage)
 */

const { logger } = require('./logger');

// Role level definitions (higher = more privilege)
const ROLE_LEVELS = {
  'super-admin': 5,
  'company-admin': 4,
  'manager': 3,
  'sales-staff': 1,
  'purchase-staff': 1,
  'accounts-staff': 1
};

// Minimum level required to manage users
const MIN_MANAGEMENT_LEVEL = 3; // Manager and above

/**
 * Get the privilege level for a role
 * @param {string} role - Role identifier
 * @returns {number} Role level (1-5, or 0 if invalid)
 */
const getRoleLevel = (role) => {
  if (!role) return 0;

  // Normalize: lowercase, trim, and convert underscores to hyphens
  // This handles both 'SUPER_ADMIN' (database) and 'super-admin' (code) formats
  const normalizedRole = role.toLowerCase().trim().replace(/_/g, '-');
  return ROLE_LEVELS[normalizedRole] || 0;
};

/**
 * Check if actor can manage target based on role hierarchy
 *
 * Rules:
 * 1. Super Admin can manage anyone except other Super Admins
 * 2. Company Admin can manage Manager and below (in their company)
 * 3. Manager can manage staff-level users (in their company)
 * 4. Staff cannot manage anyone
 *
 * @param {string} actorRole - Role of the user performing the action
 * @param {string} targetRole - Role of the user being managed
 * @returns {boolean} True if actor can manage target
 */
const canManageRole = (actorRole, targetRole) => {
  const actorLevel = getRoleLevel(actorRole);
  const targetLevel = getRoleLevel(targetRole);

  // Must have minimum level to manage anyone
  if (actorLevel < MIN_MANAGEMENT_LEVEL) {
    return false;
  }

  // Cannot manage users at same level or above
  // Exception: Super Admin can manage Company Admins, but not other Super Admins
  if (actorLevel <= targetLevel) {
    return false;
  }

  return true;
};

/**
 * Check if user can assign a specific role to someone
 * Users can only assign roles below their own level
 *
 * @param {string} actorRole - Role of the user assigning
 * @param {string} roleToAssign - Role being assigned
 * @returns {boolean} True if actor can assign this role
 */
const canAssignRole = (actorRole, roleToAssign) => {
  const actorLevel = getRoleLevel(actorRole);
  const assignLevel = getRoleLevel(roleToAssign);

  // Must have minimum level to assign roles
  if (actorLevel < MIN_MANAGEMENT_LEVEL) {
    return false;
  }

  // Can only assign roles below own level
  if (assignLevel >= actorLevel) {
    return false;
  }

  return true;
};

/**
 * Get list of roles that can be assigned by actor
 * @param {string} actorRole - Role of the user assigning
 * @returns {string[]} Array of assignable role identifiers
 */
const getAssignableRoles = (actorRole) => {
  const actorLevel = getRoleLevel(actorRole);

  if (actorLevel < MIN_MANAGEMENT_LEVEL) {
    return [];
  }

  // Return roles below actor's level
  return Object.entries(ROLE_LEVELS)
    .filter(([_, level]) => level < actorLevel)
    .map(([role, _]) => role)
    .sort((a, b) => getRoleLevel(b) - getRoleLevel(a)); // Sort by level descending
};

/**
 * Get list of roles that can be managed by actor
 * @param {string} actorRole - Role of the user managing
 * @returns {string[]} Array of manageable role identifiers
 */
const getManageableRoles = (actorRole) => {
  // Same as assignable for now, but could differ in future
  return getAssignableRoles(actorRole);
};

/**
 * Check if actor has permission to manage users
 * @param {string} actorRole - Role of the user
 * @returns {boolean} True if actor can manage users
 */
const canManageUsers = (actorRole) => {
  return getRoleLevel(actorRole) >= MIN_MANAGEMENT_LEVEL;
};

/**
 * Validate role change operation
 * Returns detailed validation result
 *
 * @param {Object} params - Validation parameters
 * @param {string} params.actorRole - Role of user making the change
 * @param {string} params.targetCurrentRole - Current role of target user
 * @param {string} params.targetNewRole - New role being assigned
 * @returns {{ valid: boolean, reason: string }}
 */
const validateRoleChange = ({ actorRole, targetCurrentRole, targetNewRole }) => {
  const actorLevel = getRoleLevel(actorRole);
  const currentLevel = getRoleLevel(targetCurrentRole);
  const newLevel = getRoleLevel(targetNewRole);

  // Check actor can manage users
  if (actorLevel < MIN_MANAGEMENT_LEVEL) {
    return {
      valid: false,
      reason: 'Insufficient privileges to manage users'
    };
  }

  // Check actor can manage target's current role
  if (currentLevel >= actorLevel) {
    return {
      valid: false,
      reason: 'Cannot modify user with same or higher role'
    };
  }

  // Check actor can assign new role
  if (newLevel >= actorLevel) {
    return {
      valid: false,
      reason: 'Cannot assign role equal to or higher than your own'
    };
  }

  // Prevent demotion to same level
  if (newLevel === currentLevel) {
    return {
      valid: true,
      reason: 'Role unchanged'
    };
  }

  // Log role changes for audit
  if (newLevel !== currentLevel) {
    logger.info('Role change validated', {
      actorRole,
      targetCurrentRole,
      targetNewRole,
      isPromotion: newLevel > currentLevel
    });
  }

  return {
    valid: true,
    reason: newLevel > currentLevel ? 'Promotion' : 'Demotion'
  };
};

/**
 * Get human-readable role name
 * @param {string} role - Role identifier
 * @returns {string} Display name
 */
const getRoleDisplayName = (role) => {
  const displayNames = {
    'super-admin': 'Super Administrator',
    'company-admin': 'Company Administrator',
    'manager': 'Manager',
    'sales-staff': 'Sales Staff',
    'purchase-staff': 'Purchase Staff',
    'accounts-staff': 'Accounts Staff'
  };

  return displayNames[role?.toLowerCase()] || role || 'Unknown';
};

/**
 * Check if role is valid
 * @param {string} role - Role to validate
 * @returns {boolean} True if valid role
 */
const isValidRole = (role) => {
  if (!role) return false;
  // Normalize same as getRoleLevel
  const normalizedRole = role.toLowerCase().trim().replace(/_/g, '-');
  return Object.hasOwn(ROLE_LEVELS, normalizedRole);
};

/**
 * Normalize a role to kebab-case format
 * @param {string} role - Role identifier
 * @returns {string} Normalized role
 */
const normalizeRole = (role) => {
  if (!role) return '';
  return role.toLowerCase().trim().replace(/_/g, '-');
};

module.exports = {
  getRoleLevel,
  normalizeRole,
  canManageRole,
  canAssignRole,
  getAssignableRoles,
  getManageableRoles,
  canManageUsers,
  validateRoleChange,
  getRoleDisplayName,
  isValidRole,
  ROLE_LEVELS,
  MIN_MANAGEMENT_LEVEL
};
