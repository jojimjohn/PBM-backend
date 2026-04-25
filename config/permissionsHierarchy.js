/**
 * Permission Hierarchy — MANAGE_X implies its module's CRUD permissions.
 */

const permissionsHierarchy = {
  MANAGE_USERS:          { implies: ['VIEW_USERS',   'CREATE_USERS',   'EDIT_USERS',   'DELETE_USERS']   },
  MANAGE_ROLES:          { implies: ['VIEW_ROLES']   },
  MANAGE_COMPANIES:      { implies: ['VIEW_COMPANIES', 'SWITCH_COMPANIES'] },
  MANAGE_SUPPLIERS:      { implies: ['VIEW_SUPPLIERS',   'CREATE_SUPPLIERS',   'EDIT_SUPPLIERS',   'DELETE_SUPPLIERS']   },
  MANAGE_CUSTOMERS:      { implies: ['VIEW_CUSTOMERS',   'CREATE_CUSTOMERS',   'EDIT_CUSTOMERS',   'DELETE_CUSTOMERS']   },
  MANAGE_MATERIALS:      { implies: ['VIEW_MATERIALS',   'CREATE_MATERIALS',   'EDIT_MATERIALS',   'DELETE_MATERIALS']   },
  MANAGE_INVENTORY:      { implies: ['VIEW_INVENTORY',   'EDIT_INVENTORY']   },
  MANAGE_CONTRACTS:      { implies: ['VIEW_CONTRACTS',   'CREATE_CONTRACTS',   'EDIT_CONTRACTS',   'DELETE_CONTRACTS']   },
  MANAGE_COLLECTIONS:    { implies: ['VIEW_COLLECTIONS', 'CREATE_COLLECTIONS', 'EDIT_COLLECTIONS', 'DELETE_COLLECTIONS'] },
  MANAGE_SALES:          { implies: ['VIEW_SALES',       'CREATE_SALES',       'EDIT_SALES',       'DELETE_SALES']       },
  MANAGE_PURCHASE:       { implies: ['VIEW_PURCHASE',    'CREATE_PURCHASE',    'EDIT_PURCHASE',    'DELETE_PURCHASE']    },
  MANAGE_WASTAGE:        { implies: ['VIEW_WASTAGE',     'CREATE_WASTAGE',     'EDIT_WASTAGE',     'DELETE_WASTAGE']     },
  MANAGE_PETTY_CASH:     { implies: ['VIEW_PETTY_CASH',  'CREATE_PETTY_CASH',  'EDIT_PETTY_CASH',  'DELETE_PETTY_CASH']  },
  MANAGE_FINANCE:        { implies: ['VIEW_FINANCE',     'CREATE_FINANCE',     'EDIT_FINANCE',     'DELETE_FINANCE']     },
  MANAGE_INVOICES:       { implies: ['VIEW_INVOICES',    'CREATE_INVOICES',    'EDIT_INVOICES',    'DELETE_INVOICES']    },
  MANAGE_BANKING:        { implies: ['VIEW_BANKING',     'CREATE_BANKING',     'EDIT_BANKING',     'DELETE_BANKING']     },
  MANAGE_REPORTS:        { implies: ['VIEW_REPORTS']   },
  MANAGE_SETTINGS:       { implies: ['VIEW_SETTINGS',  'MANAGE_BACKUPS']   },
  MANAGE_PROJECTS:       { implies: ['VIEW_PROJECTS',    'CREATE_PROJECTS',    'EDIT_PROJECTS',    'DELETE_PROJECTS']    },
  MANAGE_EMPLOYEES:      { implies: ['VIEW_EMPLOYEES',   'CREATE_EMPLOYEES',   'EDIT_EMPLOYEES',   'DELETE_EMPLOYEES']   },
  MANAGE_VEHICLES:       { implies: ['VIEW_VEHICLES',    'CREATE_VEHICLES',    'EDIT_VEHICLES',    'DELETE_VEHICLES']    },
  MANAGE_TANK_LOGS:      { implies: ['VIEW_TANK_LOGS',   'CREATE_TANK_LOGS',   'EDIT_TANK_LOGS',   'DELETE_TANK_LOGS']   },
  MANAGE_EXPENSE_SHEETS: { implies: ['VIEW_EXPENSE_SHEETS','CREATE_EXPENSE_SHEETS','EDIT_EXPENSE_SHEETS','DELETE_EXPENSE_SHEETS'] },
};

/**
 * Check if userPermissions grants requiredPermission (hierarchically).
 */
function hasPermission(userPermissions, requiredPermission) {
  if (!Array.isArray(userPermissions) || !requiredPermission) return false;
  if (userPermissions.includes(requiredPermission)) return true;
  // Check if any held permission implies the required one
  for (const held of userPermissions) {
    if (permissionsHierarchy[held]?.implies?.includes(requiredPermission)) return true;
  }
  return false;
}

function hasAnyPermission(userPermissions, requiredPermissions) {
  return requiredPermissions.some(p => hasPermission(userPermissions, p));
}

function hasAllPermissions(userPermissions, requiredPermissions) {
  return requiredPermissions.every(p => hasPermission(userPermissions, p));
}

module.exports = { permissionsHierarchy, hasPermission, hasAnyPermission, hasAllPermissions };
