/**
 * Permissions Configuration
 *
 * Central source of truth for all permission definitions.
 * Permissions are grouped by module for organized display in the UI.
 */

// All permission definitions with metadata
const PERMISSIONS = {
  // User Management
  MANAGE_USERS: {
    key: 'MANAGE_USERS',
    label: 'Manage Users',
    description: 'Create, edit, and deactivate user accounts',
    module: 'users'
  },
  VIEW_USERS: {
    key: 'VIEW_USERS',
    label: 'View Users',
    description: 'View user list and profiles',
    module: 'users'
  },
  ASSIGN_ROLES: {
    key: 'ASSIGN_ROLES',
    label: 'Assign Roles',
    description: 'Assign roles to users within hierarchy limits',
    module: 'users'
  },
  MANAGE_ROLES: {
    key: 'MANAGE_ROLES',
    label: 'Manage Roles',
    description: 'Create, edit, and delete custom roles',
    module: 'users'
  },
  VIEW_ROLES: {
    key: 'VIEW_ROLES',
    label: 'View Roles',
    description: 'View role definitions and permissions',
    module: 'users'
  },

  // Company Management
  MANAGE_COMPANIES: {
    key: 'MANAGE_COMPANIES',
    label: 'Manage Companies',
    description: 'Full company configuration access',
    module: 'company'
  },
  VIEW_COMPANIES: {
    key: 'VIEW_COMPANIES',
    label: 'View Companies',
    description: 'View company information',
    module: 'company'
  },
  SWITCH_COMPANIES: {
    key: 'SWITCH_COMPANIES',
    label: 'Switch Companies',
    description: 'Switch between multiple companies',
    module: 'company'
  },

  // Customer Management
  MANAGE_CUSTOMERS: {
    key: 'MANAGE_CUSTOMERS',
    label: 'Manage Customers',
    description: 'Create, edit, and delete customers',
    module: 'customers'
  },
  VIEW_CUSTOMERS: {
    key: 'VIEW_CUSTOMERS',
    label: 'View Customers',
    description: 'View customer list and details',
    module: 'customers'
  },

  // Supplier Management
  MANAGE_SUPPLIERS: {
    key: 'MANAGE_SUPPLIERS',
    label: 'Manage Suppliers',
    description: 'Create, edit, and delete suppliers',
    module: 'suppliers'
  },
  VIEW_SUPPLIERS: {
    key: 'VIEW_SUPPLIERS',
    label: 'View Suppliers',
    description: 'View supplier list and details',
    module: 'suppliers'
  },

  // Vendor Management
  MANAGE_VENDORS: {
    key: 'MANAGE_VENDORS',
    label: 'Manage Vendors',
    description: 'Create, edit, and delete vendors',
    module: 'suppliers'
  },
  VIEW_VENDORS: {
    key: 'VIEW_VENDORS',
    label: 'View Vendors',
    description: 'View vendor list and details',
    module: 'suppliers'
  },

  // Inventory Management
  MANAGE_INVENTORY: {
    key: 'MANAGE_INVENTORY',
    label: 'Manage Inventory',
    description: 'Full inventory management access',
    module: 'inventory'
  },
  VIEW_INVENTORY: {
    key: 'VIEW_INVENTORY',
    label: 'View Inventory',
    description: 'View inventory levels and materials',
    module: 'inventory'
  },
  UPDATE_STOCK: {
    key: 'UPDATE_STOCK',
    label: 'Update Stock',
    description: 'Adjust inventory quantities',
    module: 'inventory'
  },

  // Sales Management
  CREATE_SALES: {
    key: 'CREATE_SALES',
    label: 'Create Sales',
    description: 'Create new sales orders',
    module: 'sales'
  },
  VIEW_SALES: {
    key: 'VIEW_SALES',
    label: 'View Sales',
    description: 'View sales orders and history',
    module: 'sales'
  },
  EDIT_SALES: {
    key: 'EDIT_SALES',
    label: 'Edit Sales',
    description: 'Modify existing sales orders',
    module: 'sales'
  },
  DELETE_SALES: {
    key: 'DELETE_SALES',
    label: 'Delete Sales',
    description: 'Delete sales orders',
    module: 'sales'
  },
  APPROVE_SALES: {
    key: 'APPROVE_SALES',
    label: 'Approve Sales',
    description: 'Approve pending sales orders',
    module: 'sales'
  },

  // Purchase Management
  CREATE_PURCHASE: {
    key: 'CREATE_PURCHASE',
    label: 'Create Purchase',
    description: 'Create new purchase records',
    module: 'purchase'
  },
  VIEW_PURCHASE: {
    key: 'VIEW_PURCHASE',
    label: 'View Purchase',
    description: 'View purchase records',
    module: 'purchase'
  },
  EDIT_PURCHASE: {
    key: 'EDIT_PURCHASE',
    label: 'Edit Purchase',
    description: 'Modify purchase records',
    module: 'purchase'
  },
  DELETE_PURCHASE: {
    key: 'DELETE_PURCHASE',
    label: 'Delete Purchase',
    description: 'Delete purchase records',
    module: 'purchase'
  },
  APPROVE_PURCHASE: {
    key: 'APPROVE_PURCHASE',
    label: 'Approve Purchase',
    description: 'Approve pending purchase orders',
    module: 'purchase'
  },

  // Purchase Order Management
  CREATE_PURCHASE_ORDER: {
    key: 'CREATE_PURCHASE_ORDER',
    label: 'Create Purchase Order',
    description: 'Create new purchase orders',
    module: 'purchase'
  },
  VIEW_PURCHASE_ORDER: {
    key: 'VIEW_PURCHASE_ORDER',
    label: 'View Purchase Orders',
    description: 'View purchase order details',
    module: 'purchase'
  },
  EDIT_PURCHASE_ORDER: {
    key: 'EDIT_PURCHASE_ORDER',
    label: 'Edit Purchase Order',
    description: 'Modify purchase orders',
    module: 'purchase'
  },
  DELETE_PURCHASE_ORDER: {
    key: 'DELETE_PURCHASE_ORDER',
    label: 'Delete Purchase Order',
    description: 'Delete purchase orders',
    module: 'purchase'
  },
  APPROVE_PURCHASE_ORDER: {
    key: 'APPROVE_PURCHASE_ORDER',
    label: 'Approve Purchase Order',
    description: 'Approve pending purchase orders',
    module: 'purchase'
  },

  // Contract Management
  MANAGE_CONTRACTS: {
    key: 'MANAGE_CONTRACTS',
    label: 'Manage Contracts',
    description: 'Create, edit, and delete contracts',
    module: 'contracts'
  },
  VIEW_CONTRACTS: {
    key: 'VIEW_CONTRACTS',
    label: 'View Contracts',
    description: 'View contract details',
    module: 'contracts'
  },
  APPROVE_CONTRACTS: {
    key: 'APPROVE_CONTRACTS',
    label: 'Approve Contracts',
    description: 'Approve pending contracts',
    module: 'contracts'
  },

  // Collections Management
  VIEW_COLLECTIONS: {
    key: 'VIEW_COLLECTIONS',
    label: 'View Collections',
    description: 'View collection orders and callouts',
    module: 'collections'
  },
  CREATE_COLLECTIONS: {
    key: 'CREATE_COLLECTIONS',
    label: 'Create Collections',
    description: 'Create collection orders and callouts',
    module: 'collections'
  },
  EDIT_COLLECTIONS: {
    key: 'EDIT_COLLECTIONS',
    label: 'Edit Collections',
    description: 'Modify collection orders',
    module: 'collections'
  },
  DELETE_COLLECTIONS: {
    key: 'DELETE_COLLECTIONS',
    label: 'Delete Collections',
    description: 'Delete collection orders',
    module: 'collections'
  },
  APPROVE_COLLECTIONS: {
    key: 'APPROVE_COLLECTIONS',
    label: 'Approve Collections',
    description: 'Approve and finalize collections',
    module: 'collections'
  },

  // Financial Management
  VIEW_FINANCIALS: {
    key: 'VIEW_FINANCIALS',
    label: 'View Financials',
    description: 'View financial summaries',
    module: 'finance'
  },
  MANAGE_EXPENSES: {
    key: 'MANAGE_EXPENSES',
    label: 'Manage Expenses',
    description: 'Record and manage expenses',
    module: 'finance'
  },
  APPROVE_EXPENSES: {
    key: 'APPROVE_EXPENSES',
    label: 'Approve Expenses',
    description: 'Approve pending expenses',
    module: 'finance'
  },
  MANAGE_PETTY_CASH: {
    key: 'MANAGE_PETTY_CASH',
    label: 'Manage Petty Cash',
    description: 'Manage petty cash cards and funds',
    module: 'finance'
  },
  VIEW_PROFIT_LOSS: {
    key: 'VIEW_PROFIT_LOSS',
    label: 'View Profit/Loss',
    description: 'View profit and loss reports',
    module: 'finance'
  },
  VIEW_EXPENSES: {
    key: 'VIEW_EXPENSES',
    label: 'View Expenses',
    description: 'View all expense records and categories',
    module: 'finance'
  },
  MANAGE_EXPENSE_CATEGORIES: {
    key: 'MANAGE_EXPENSE_CATEGORIES',
    label: 'Manage Expense Categories',
    description: 'Create, edit, and manage expense categories',
    module: 'finance'
  },

  // Petty Cash Management
  VIEW_PETTY_CASH: {
    key: 'VIEW_PETTY_CASH',
    label: 'View Petty Cash',
    description: 'View petty cash cards and expenses',
    module: 'petty_cash'
  },
  CREATE_EXPENSE: {
    key: 'CREATE_EXPENSE',
    label: 'Create Expense',
    description: 'Submit petty cash expenses',
    module: 'petty_cash'
  },
  APPROVE_EXPENSE: {
    key: 'APPROVE_EXPENSE',
    label: 'Approve Expense',
    description: 'Approve petty cash expenses',
    module: 'petty_cash'
  },
  RELOAD_CARD: {
    key: 'RELOAD_CARD',
    label: 'Reload Card',
    description: 'Add funds to petty cash cards',
    module: 'petty_cash'
  },
  VIEW_EXPENSE_REPORTS: {
    key: 'VIEW_EXPENSE_REPORTS',
    label: 'View Expense Reports',
    description: 'View detailed expense reports',
    module: 'petty_cash'
  },

  // Invoice Management
  CREATE_INVOICES: {
    key: 'CREATE_INVOICES',
    label: 'Create Invoices',
    description: 'Generate new invoices',
    module: 'invoices'
  },
  VIEW_INVOICES: {
    key: 'VIEW_INVOICES',
    label: 'View Invoices',
    description: 'View invoice details',
    module: 'invoices'
  },
  EDIT_INVOICES: {
    key: 'EDIT_INVOICES',
    label: 'Edit Invoices',
    description: 'Modify existing invoices',
    module: 'invoices'
  },

  // Wastage Management
  VIEW_WASTAGE: {
    key: 'VIEW_WASTAGE',
    label: 'View Wastage',
    description: 'View wastage records',
    module: 'wastage'
  },
  CREATE_WASTAGE: {
    key: 'CREATE_WASTAGE',
    label: 'Create Wastage',
    description: 'Record wastage incidents',
    module: 'wastage'
  },
  EDIT_WASTAGE: {
    key: 'EDIT_WASTAGE',
    label: 'Edit Wastage',
    description: 'Modify wastage records',
    module: 'wastage'
  },
  DELETE_WASTAGE: {
    key: 'DELETE_WASTAGE',
    label: 'Delete Wastage',
    description: 'Delete wastage records',
    module: 'wastage'
  },
  APPROVE_WASTAGE: {
    key: 'APPROVE_WASTAGE',
    label: 'Approve Wastage',
    description: 'Approve wastage for inventory adjustment',
    module: 'wastage'
  },

  // Reporting
  VIEW_REPORTS: {
    key: 'VIEW_REPORTS',
    label: 'View Reports',
    description: 'Access standard reports',
    module: 'reports'
  },
  EXPORT_REPORTS: {
    key: 'EXPORT_REPORTS',
    label: 'Export Reports',
    description: 'Export reports to PDF/Excel',
    module: 'reports'
  },
  CREATE_CUSTOM_REPORTS: {
    key: 'CREATE_CUSTOM_REPORTS',
    label: 'Create Custom Reports',
    description: 'Build custom report templates',
    module: 'reports'
  },

  // System Settings
  MANAGE_SETTINGS: {
    key: 'MANAGE_SETTINGS',
    label: 'Manage Settings',
    description: 'Configure system settings',
    module: 'system'
  },
  VIEW_AUDIT_LOGS: {
    key: 'VIEW_AUDIT_LOGS',
    label: 'View Audit Logs',
    description: 'Access system audit trail',
    module: 'system'
  },

  // Project Management
  VIEW_PROJECTS: {
    key: 'VIEW_PROJECTS',
    label: 'View Projects',
    description: 'View project list and details',
    module: 'projects'
  },
  MANAGE_PROJECTS: {
    key: 'MANAGE_PROJECTS',
    label: 'Manage Projects',
    description: 'Create, edit, and manage projects',
    module: 'projects'
  }
};

// Module definitions with display information
const MODULES = {
  users: {
    key: 'users',
    label: 'User Management',
    icon: 'users',
    order: 1
  },
  company: {
    key: 'company',
    label: 'Company Management',
    icon: 'building',
    order: 2
  },
  customers: {
    key: 'customers',
    label: 'Customers',
    icon: 'user-check',
    order: 3
  },
  suppliers: {
    key: 'suppliers',
    label: 'Suppliers & Vendors',
    icon: 'truck',
    order: 4
  },
  inventory: {
    key: 'inventory',
    label: 'Inventory',
    icon: 'package',
    order: 5
  },
  sales: {
    key: 'sales',
    label: 'Sales',
    icon: 'shopping-cart',
    order: 6
  },
  purchase: {
    key: 'purchase',
    label: 'Purchase',
    icon: 'shopping-bag',
    order: 7
  },
  contracts: {
    key: 'contracts',
    label: 'Contracts',
    icon: 'file-text',
    order: 8
  },
  collections: {
    key: 'collections',
    label: 'Collections',
    icon: 'clipboard-list',
    order: 9
  },
  finance: {
    key: 'finance',
    label: 'Finance',
    icon: 'dollar-sign',
    order: 10
  },
  petty_cash: {
    key: 'petty_cash',
    label: 'Petty Cash',
    icon: 'credit-card',
    order: 11
  },
  invoices: {
    key: 'invoices',
    label: 'Invoices',
    icon: 'file-invoice',
    order: 12
  },
  wastage: {
    key: 'wastage',
    label: 'Wastage',
    icon: 'trash-2',
    order: 13
  },
  reports: {
    key: 'reports',
    label: 'Reports',
    icon: 'bar-chart',
    order: 14
  },
  system: {
    key: 'system',
    label: 'System',
    icon: 'settings',
    order: 15
  },
  projects: {
    key: 'projects',
    label: 'Projects',
    icon: 'folder',
    order: 16
  }
};

/**
 * Get all permissions as a flat array of keys
 */
function getAllPermissionKeys() {
  return Object.keys(PERMISSIONS);
}

/**
 * Get permissions grouped by module
 * Returns array sorted by module order, each with permissions array
 */
function getPermissionsByModule() {
  const grouped = {};

  // Group permissions by module
  Object.values(PERMISSIONS).forEach(permission => {
    const moduleKey = permission.module;
    if (!grouped[moduleKey]) {
      grouped[moduleKey] = {
        ...MODULES[moduleKey],
        permissions: []
      };
    }
    grouped[moduleKey].permissions.push({
      key: permission.key,
      label: permission.label,
      description: permission.description
    });
  });

  // Convert to array and sort by module order
  return Object.values(grouped)
    .sort((a, b) => a.order - b.order);
}

/**
 * Get a single permission definition by key
 */
function getPermission(key) {
  return PERMISSIONS[key] || null;
}

/**
 * Validate if a permission key exists
 */
function isValidPermission(key) {
  return key in PERMISSIONS;
}

/**
 * Validate array of permission keys
 */
function validatePermissions(permissionKeys) {
  const invalid = permissionKeys.filter(key => !isValidPermission(key));
  return {
    valid: invalid.length === 0,
    invalidKeys: invalid
  };
}

module.exports = {
  PERMISSIONS,
  MODULES,
  getAllPermissionKeys,
  getPermissionsByModule,
  getPermission,
  isValidPermission,
  validatePermissions
};
