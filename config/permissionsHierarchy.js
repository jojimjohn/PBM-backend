/**
 * Hierarchical Permission System
 *
 * This file defines the complete permission hierarchy for the PBM system.
 * Permissions follow a hierarchical structure where parent permissions
 * automatically grant all child permissions.
 *
 * Permission Naming Convention:
 * - {RESOURCE}_{ACTION}_{SCOPE}
 * - Example: PURCHASE_EDIT_OWN, PURCHASE_EDIT_ALL
 * - SCOPE can be: OWN (user's own resources) or ALL (any resource)
 *
 * Hierarchy Rules:
 * - MANAGE_* implies all operations on that resource
 * - *_ALL implies *_OWN
 * - Approval permissions are always *_ALL (no OWN variant)
 */

// ============================================================================
// PERMISSION HIERARCHY TREE
// ============================================================================

const PERMISSION_TREE = {
  // SUPER_ADMIN has all permissions automatically

  // =========================================================================
  // USER & ROLE MANAGEMENT
  // =========================================================================
  MANAGE_USERS: {
    implies: [
      'VIEW_USERS',
      'CREATE_USERS',
      'EDIT_USERS',
      'DELETE_USERS',
      'ASSIGN_ROLES'
    ]
  },

  MANAGE_ROLES: {
    implies: [
      'VIEW_ROLES',
      'CREATE_ROLES',
      'EDIT_ROLES',
      'DELETE_ROLES',
      'MANAGE_ROLE_PERMISSIONS'
    ]
  },

  // =========================================================================
  // COMPANY & SETTINGS
  // =========================================================================
  MANAGE_COMPANIES: {
    implies: [
      'VIEW_COMPANIES',
      'CREATE_COMPANIES',
      'EDIT_COMPANIES',
      'DELETE_COMPANIES',
      'SWITCH_COMPANIES'
    ]
  },

  MANAGE_SETTINGS: {
    implies: [
      'VIEW_SETTINGS',
      'EDIT_SETTINGS',
      'MANAGE_BRANCHES',
      'MANAGE_EXPENSE_CATEGORIES',
      'CONFIGURE_VAT',
      'CONFIGURE_SECURITY'
    ]
  },

  MANAGE_BANKING: {
    implies: [
      'VIEW_BANKING',
      'CREATE_BANK_ACCOUNTS',
      'EDIT_BANK_ACCOUNTS',
      'DELETE_BANK_ACCOUNTS',
      'CREATE_TRANSACTIONS',
      'EDIT_TRANSACTIONS',
      'DELETE_TRANSACTIONS',
      'RECONCILE_ACCOUNTS'
    ]
  },

  // =========================================================================
  // CUSTOMER MANAGEMENT
  // =========================================================================
  MANAGE_CUSTOMERS: {
    implies: [
      'VIEW_CUSTOMERS',
      'CREATE_CUSTOMERS',
      'EDIT_CUSTOMERS_ALL',
      'EDIT_CUSTOMERS_OWN',
      'DELETE_CUSTOMERS',
      'TOGGLE_CUSTOMER_STATUS'
    ]
  },

  EDIT_CUSTOMERS_ALL: {
    implies: ['EDIT_CUSTOMERS_OWN']
  },

  // =========================================================================
  // SUPPLIER MANAGEMENT
  // =========================================================================
  MANAGE_SUPPLIERS: {
    implies: [
      'VIEW_SUPPLIERS',
      'CREATE_SUPPLIERS',
      'EDIT_SUPPLIERS_ALL',
      'EDIT_SUPPLIERS_OWN',
      'DELETE_SUPPLIERS',
      'MANAGE_SUPPLIER_LOCATIONS'
    ]
  },

  EDIT_SUPPLIERS_ALL: {
    implies: ['EDIT_SUPPLIERS_OWN']
  },

  MANAGE_VENDORS: {
    implies: [
      'VIEW_VENDORS',
      'CREATE_VENDORS',
      'EDIT_VENDORS',
      'DELETE_VENDORS'
    ]
  },

  // =========================================================================
  // MATERIAL & INVENTORY MANAGEMENT
  // =========================================================================
  MANAGE_MATERIALS: {
    implies: [
      'VIEW_MATERIALS',
      'CREATE_MATERIALS',
      'EDIT_MATERIALS',
      'DELETE_MATERIALS',
      'MANAGE_MATERIAL_COMPOSITIONS'
    ]
  },

  MANAGE_INVENTORY: {
    implies: [
      'VIEW_INVENTORY',
      'UPDATE_STOCK',
      'ADJUST_STOCK',
      'VIEW_BATCHES',
      'VIEW_STOCK_MOVEMENTS',
      'CREATE_STOCK_REPORTS'
    ]
  },

  // =========================================================================
  // SALES MANAGEMENT
  // =========================================================================
  MANAGE_SALES: {
    implies: [
      'VIEW_SALES',
      'CREATE_SALES_ALL',
      'CREATE_SALES_OWN',
      'EDIT_SALES_ALL',
      'EDIT_SALES_OWN',
      'DELETE_SALES_ALL',
      'DELETE_SALES_OWN',
      'APPROVE_SALES',
      'GENERATE_SALES_INVOICE'
    ]
  },

  CREATE_SALES_ALL: {
    implies: ['CREATE_SALES_OWN']
  },

  EDIT_SALES_ALL: {
    implies: ['EDIT_SALES_OWN']
  },

  DELETE_SALES_ALL: {
    implies: ['DELETE_SALES_OWN']
  },

  // =========================================================================
  // PURCHASE MANAGEMENT
  // =========================================================================
  MANAGE_PURCHASE: {
    implies: [
      'VIEW_PURCHASE',
      'CREATE_PURCHASE_ALL',
      'CREATE_PURCHASE_OWN',
      'EDIT_PURCHASE_ALL',
      'EDIT_PURCHASE_OWN',
      'DELETE_PURCHASE_ALL',
      'DELETE_PURCHASE_OWN',
      'APPROVE_PURCHASE',
      'RECEIVE_PURCHASE',
      'MANAGE_PURCHASE_AMENDMENTS',
      'VIEW_UNBILLED_PURCHASES'
    ]
  },

  CREATE_PURCHASE_ALL: {
    implies: ['CREATE_PURCHASE_OWN']
  },

  EDIT_PURCHASE_ALL: {
    implies: ['EDIT_PURCHASE_OWN']
  },

  DELETE_PURCHASE_ALL: {
    implies: ['DELETE_PURCHASE_OWN']
  },

  // Purchase Order variant (legacy compatibility)
  MANAGE_PURCHASE_ORDERS: {
    implies: [
      'VIEW_PURCHASE_ORDER',
      'CREATE_PURCHASE_ORDER_ALL',
      'CREATE_PURCHASE_ORDER_OWN',
      'EDIT_PURCHASE_ORDER_ALL',
      'EDIT_PURCHASE_ORDER_OWN',
      'DELETE_PURCHASE_ORDER_ALL',
      'DELETE_PURCHASE_ORDER_OWN',
      'APPROVE_PURCHASE_ORDER'
    ]
  },

  CREATE_PURCHASE_ORDER_ALL: {
    implies: ['CREATE_PURCHASE_ORDER_OWN']
  },

  EDIT_PURCHASE_ORDER_ALL: {
    implies: ['EDIT_PURCHASE_ORDER_OWN']
  },

  DELETE_PURCHASE_ORDER_ALL: {
    implies: ['DELETE_PURCHASE_ORDER_OWN']
  },

  // =========================================================================
  // CONTRACT MANAGEMENT
  // =========================================================================
  MANAGE_CONTRACTS: {
    implies: [
      'VIEW_CONTRACTS',
      'CREATE_CONTRACTS',
      'EDIT_CONTRACTS_ALL',
      'EDIT_CONTRACTS_OWN',
      'DELETE_CONTRACTS',
      'APPROVE_CONTRACTS',
      'MANAGE_CONTRACT_LOCATIONS',
      'MANAGE_CONTRACT_RATES'
    ]
  },

  EDIT_CONTRACTS_ALL: {
    implies: ['EDIT_CONTRACTS_OWN']
  },

  // =========================================================================
  // COLLECTIONS MANAGEMENT
  // =========================================================================
  MANAGE_COLLECTIONS: {
    implies: [
      'VIEW_COLLECTIONS',
      'CREATE_COLLECTIONS',
      'EDIT_COLLECTIONS_ALL',
      'EDIT_COLLECTIONS_OWN',
      'DELETE_COLLECTIONS',
      'APPROVE_COLLECTIONS',
      'FINALIZE_WCN',
      'CREATE_CALLOUTS'
    ]
  },

  EDIT_COLLECTIONS_ALL: {
    implies: ['EDIT_COLLECTIONS_OWN']
  },

  // =========================================================================
  // WASTAGE MANAGEMENT
  // =========================================================================
  MANAGE_WASTAGE: {
    implies: [
      'VIEW_WASTAGE',
      'CREATE_WASTAGE_ALL',
      'CREATE_WASTAGE_OWN',
      'EDIT_WASTAGE_ALL',
      'EDIT_WASTAGE_OWN',
      'DELETE_WASTAGE_ALL',
      'DELETE_WASTAGE_OWN',
      'APPROVE_WASTAGE'
    ]
  },

  CREATE_WASTAGE_ALL: {
    implies: ['CREATE_WASTAGE_OWN']
  },

  EDIT_WASTAGE_ALL: {
    implies: ['EDIT_WASTAGE_OWN']
  },

  DELETE_WASTAGE_ALL: {
    implies: ['DELETE_WASTAGE_OWN']
  },

  // =========================================================================
  // FINANCIAL MANAGEMENT
  // =========================================================================
  MANAGE_FINANCIALS: {
    implies: [
      'VIEW_FINANCIALS',
      'VIEW_PROFIT_LOSS',
      'VIEW_BALANCE_SHEET',
      'VIEW_CASH_FLOW',
      'MANAGE_EXPENSES_ALL'
    ]
  },

  MANAGE_EXPENSES_ALL: {
    implies: [
      'VIEW_EXPENSES',
      'CREATE_EXPENSE_ALL',
      'CREATE_EXPENSE_OWN',
      'EDIT_EXPENSE_ALL',
      'EDIT_EXPENSE_OWN',
      'DELETE_EXPENSE_ALL',
      'DELETE_EXPENSE_OWN',
      'APPROVE_EXPENSE_ALL',
      'APPROVE_EXPENSE_OWN'
    ]
  },

  CREATE_EXPENSE_ALL: {
    implies: ['CREATE_EXPENSE_OWN']
  },

  EDIT_EXPENSE_ALL: {
    implies: ['EDIT_EXPENSE_OWN']
  },

  DELETE_EXPENSE_ALL: {
    implies: ['DELETE_EXPENSE_OWN']
  },

  APPROVE_EXPENSE_ALL: {
    implies: ['APPROVE_EXPENSE_OWN']
  },

  // =========================================================================
  // PETTY CASH MANAGEMENT
  // =========================================================================
  MANAGE_PETTY_CASH: {
    implies: [
      'VIEW_PETTY_CASH',
      'MANAGE_PETTY_CASH_CARDS',
      'MANAGE_PETTY_CASH_USERS',
      'CREATE_PETTY_CASH_EXPENSE_ALL',
      'CREATE_PETTY_CASH_EXPENSE_OWN',
      'EDIT_PETTY_CASH_EXPENSE_ALL',
      'EDIT_PETTY_CASH_EXPENSE_OWN',
      'DELETE_PETTY_CASH_EXPENSE_ALL',
      'DELETE_PETTY_CASH_EXPENSE_OWN',
      'APPROVE_PETTY_CASH_EXPENSE',
      'RELOAD_CARD',
      'VIEW_EXPENSE_REPORTS'
    ]
  },

  MANAGE_PETTY_CASH_CARDS: {
    implies: [
      'CREATE_PETTY_CASH_CARD',
      'EDIT_PETTY_CASH_CARD',
      'DELETE_PETTY_CASH_CARD',
      'RELOAD_CARD',
      'SUSPEND_CARD',
      'ACTIVATE_CARD'
    ]
  },

  MANAGE_PETTY_CASH_USERS: {
    implies: [
      'CREATE_PETTY_CASH_USER',
      'EDIT_PETTY_CASH_USER_ALL',
      'EDIT_PETTY_CASH_USER_OWN',
      'DELETE_PETTY_CASH_USER',
      'ASSIGN_PETTY_CASH_CARD'
    ]
  },

  EDIT_PETTY_CASH_USER_ALL: {
    implies: ['EDIT_PETTY_CASH_USER_OWN']
  },

  CREATE_PETTY_CASH_EXPENSE_ALL: {
    implies: ['CREATE_PETTY_CASH_EXPENSE_OWN']
  },

  EDIT_PETTY_CASH_EXPENSE_ALL: {
    implies: ['EDIT_PETTY_CASH_EXPENSE_OWN']
  },

  DELETE_PETTY_CASH_EXPENSE_ALL: {
    implies: ['DELETE_PETTY_CASH_EXPENSE_OWN']
  },

  // =========================================================================
  // INVOICE MANAGEMENT
  // =========================================================================
  MANAGE_INVOICES: {
    implies: [
      'VIEW_INVOICES',
      'CREATE_INVOICES_ALL',
      'CREATE_INVOICES_OWN',
      'EDIT_INVOICES_ALL',
      'EDIT_INVOICES_OWN',
      'DELETE_INVOICES',
      'SEND_INVOICES',
      'RECORD_PAYMENT'
    ]
  },

  CREATE_INVOICES_ALL: {
    implies: ['CREATE_INVOICES_OWN']
  },

  EDIT_INVOICES_ALL: {
    implies: ['EDIT_INVOICES_OWN']
  },

  // =========================================================================
  // REPORTING & ANALYTICS
  // =========================================================================
  MANAGE_REPORTS: {
    implies: [
      'VIEW_REPORTS',
      'EXPORT_REPORTS',
      'CREATE_CUSTOM_REPORTS',
      'VIEW_ANALYTICS_DASHBOARD'
    ]
  },

  // =========================================================================
  // PROJECT MANAGEMENT
  // =========================================================================
  MANAGE_PROJECTS: {
    implies: [
      'VIEW_PROJECTS',
      'CREATE_PROJECTS',
      'EDIT_PROJECTS',
      'DELETE_PROJECTS',
      'ASSIGN_PROJECT_USERS',
      'VIEW_PROJECT_ATTACHMENTS',
      'MANAGE_PROJECT_ATTACHMENTS'
    ]
  },

  // =========================================================================
  // AUDIT & SYSTEM
  // =========================================================================
  VIEW_AUDIT_LOGS: {
    implies: []
  },

  VIEW_DASHBOARD: {
    implies: []
  },

  // =========================================================================
  // EMPLOYEE MANAGEMENT
  // =========================================================================
  MANAGE_EMPLOYEES: {
    implies: [
      'VIEW_EMPLOYEES',
      'CREATE_EMPLOYEES',
      'EDIT_EMPLOYEES',
      'MANAGE_EMPLOYEE_DOCUMENTS',
      'MANAGE_EMPLOYEE_LOCATIONS'
    ]
  },

  DELETE_EMPLOYEES: {
    implies: []
  },

  // =========================================================================
  // VEHICLE MANAGEMENT
  // =========================================================================
  MANAGE_VEHICLES: {
    implies: [
      'VIEW_VEHICLES',
      'CREATE_VEHICLES',
      'EDIT_VEHICLES',
      'MANAGE_VEHICLE_DOCUMENTS'
    ]
  },

  MANAGE_VEHICLE_TYPES: {
    implies: ['VIEW_VEHICLES']
  },

  // =========================================================================
  // TANK LOG MANAGEMENT
  // =========================================================================
  MANAGE_TANK_LOGS: {
    implies: [
      'VIEW_TANK_LOGS',
      'CREATE_TANK_LOGS',
      'EDIT_TANK_LOGS',
      'MANAGE_STORAGE_TANKS'
    ]
  }
};

// ============================================================================
// PERMISSION CHECKING UTILITY
// ============================================================================

/**
 * Check if a user has a specific permission, considering hierarchy
 * @param {Array<string>} userPermissions - User's assigned permissions
 * @param {string} requiredPermission - Permission to check
 * @returns {boolean} - Whether user has the permission
 */
function hasPermission(userPermissions, requiredPermission) {
  if (!userPermissions || !Array.isArray(userPermissions)) {
    return false;
  }

  // Special case: SUPER_ADMIN has all permissions
  if (userPermissions.includes('SUPER_ADMIN')) {
    return true;
  }

  // Direct permission check
  if (userPermissions.includes(requiredPermission)) {
    return true;
  }

  // Hierarchical check: Does user have a parent permission that implies the required one?
  for (const userPerm of userPermissions) {
    const permissionNode = PERMISSION_TREE[userPerm];
    if (permissionNode && permissionNode.implies) {
      if (permissionNode.implies.includes(requiredPermission)) {
        return true;
      }

      // Recursive check: Does any implied permission further imply the required one?
      if (hasPermission(permissionNode.implies, requiredPermission)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Check if user has ANY of the specified permissions
 * @param {Array<string>} userPermissions - User's assigned permissions
 * @param {Array<string>} requiredPermissions - Permissions to check (user needs ANY)
 * @returns {boolean} - Whether user has at least one permission
 */
function hasAnyPermission(userPermissions, requiredPermissions) {
  if (!requiredPermissions || !Array.isArray(requiredPermissions)) {
    return false;
  }

  for (const required of requiredPermissions) {
    if (hasPermission(userPermissions, required)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if user has ALL of the specified permissions
 * @param {Array<string>} userPermissions - User's assigned permissions
 * @param {Array<string>} requiredPermissions - Permissions to check (user needs ALL)
 * @returns {boolean} - Whether user has all permissions
 */
function hasAllPermissions(userPermissions, requiredPermissions) {
  if (!requiredPermissions || !Array.isArray(requiredPermissions)) {
    return false;
  }

  for (const required of requiredPermissions) {
    if (!hasPermission(userPermissions, required)) {
      return false;
    }
  }

  return true;
}

/**
 * Get all permissions granted to a user (including implied permissions)
 * @param {Array<string>} userPermissions - User's assigned permissions
 * @returns {Array<string>} - All effective permissions
 */
function getEffectivePermissions(userPermissions) {
  if (!userPermissions || !Array.isArray(userPermissions)) {
    return [];
  }

  // Special case: SUPER_ADMIN
  if (userPermissions.includes('SUPER_ADMIN')) {
    return Object.keys(PERMISSION_TREE);
  }

  const effectivePerms = new Set(userPermissions);

  function addImpliedPermissions(permission) {
    const node = PERMISSION_TREE[permission];
    if (node && node.implies) {
      for (const implied of node.implies) {
        if (!effectivePerms.has(implied)) {
          effectivePerms.add(implied);
          addImpliedPermissions(implied); // Recursive
        }
      }
    }
  }

  for (const perm of userPermissions) {
    addImpliedPermissions(perm);
  }

  return Array.from(effectivePerms);
}

/**
 * Expand abbreviated permission list to full effective permissions
 * Useful for assigning minimal permissions to roles
 * @param {Array<string>} minimalPermissions - Minimal set of permissions
 * @returns {Array<string>} - Full expanded permission list
 */
function expandPermissions(minimalPermissions) {
  return getEffectivePermissions(minimalPermissions);
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  PERMISSION_TREE,
  hasPermission,
  hasAnyPermission,
  hasAllPermissions,
  getEffectivePermissions,
  expandPermissions
};
