/**
 * Permissions Configuration — Simplified source of truth.
 * Each module: MANAGE_X (implies all), VIEW_X, CREATE_X, EDIT_X, DELETE_X.
 */

const MODULES = {
  users:          { key: 'users',          label: 'User Management',      order: 1 },
  roles:          { key: 'roles',          label: 'Role Management',      order: 2 },
  companies:      { key: 'companies',      label: 'Company Management',   order: 3 },
  suppliers:      { key: 'suppliers',      label: 'Suppliers',            order: 4 },
  customers:      { key: 'customers',      label: 'Customers',            order: 5 },
  materials:      { key: 'materials',      label: 'Materials',            order: 6 },
  inventory:      { key: 'inventory',      label: 'Inventory',            order: 7 },
  contracts:      { key: 'contracts',      label: 'Contracts',            order: 8 },
  collections:    { key: 'collections',    label: 'Collections & WCN',    order: 9 },
  sales:          { key: 'sales',          label: 'Sales',                order: 10 },
  purchase:       { key: 'purchase',       label: 'Purchase & POs',       order: 11 },
  wastage:        { key: 'wastage',        label: 'Wastage',              order: 12 },
  petty_cash:     { key: 'petty_cash',     label: 'Petty Cash',           order: 13 },
  finance:        { key: 'finance',        label: 'Finance',              order: 14 },
  invoices:       { key: 'invoices',       label: 'Invoices',             order: 15 },
  banking:        { key: 'banking',        label: 'Banking',              order: 16 },
  reports:        { key: 'reports',        label: 'Reports',              order: 17 },
  settings:       { key: 'settings',       label: 'Settings',             order: 18 },
  projects:       { key: 'projects',       label: 'Projects',             order: 19 },
  employees:      { key: 'employees',      label: 'Employees',            order: 20 },
  vehicles:       { key: 'vehicles',       label: 'Vehicles',             order: 21 },
  tank_logs:      { key: 'tank_logs',      label: 'Tank Logs',            order: 22 },
  expense_sheets: { key: 'expense_sheets', label: 'Expense Sheets',       order: 23 },
};

// Build permissions for a module: MANAGE + CRUD
function buildModulePerms(moduleKey, actions = ['MANAGE','VIEW','CREATE','EDIT','DELETE']) {
  const mod = MODULES[moduleKey];
  return actions.reduce((acc, action) => {
    const key = `${action}_${moduleKey.toUpperCase()}`;
    acc[key] = { key, label: `${action[0]+action.slice(1).toLowerCase()} ${mod.label}`, description: '', module: moduleKey };
    return acc;
  }, {});
}

const PERMISSIONS = {
  ...buildModulePerms('users'),
  ...buildModulePerms('roles',          ['MANAGE','VIEW']),
  ...buildModulePerms('companies',      ['MANAGE','VIEW']),
  ...buildModulePerms('suppliers'),
  ...buildModulePerms('customers'),
  ...buildModulePerms('materials'),
  ...buildModulePerms('inventory',      ['MANAGE','VIEW','EDIT']),
  ...buildModulePerms('contracts'),
  ...buildModulePerms('collections'),
  ...buildModulePerms('sales'),
  ...buildModulePerms('purchase'),
  ...buildModulePerms('wastage'),
  ...buildModulePerms('petty_cash'),
  ...buildModulePerms('finance'),
  ...buildModulePerms('invoices'),
  ...buildModulePerms('banking'),
  ...buildModulePerms('reports',        ['MANAGE','VIEW']),
  ...buildModulePerms('settings',       ['MANAGE','VIEW']),
  ...buildModulePerms('projects'),
  ...buildModulePerms('employees'),
  ...buildModulePerms('vehicles'),
  ...buildModulePerms('tank_logs'),
  ...buildModulePerms('expense_sheets'),
  // standalone entries
  MANAGE_BACKUPS:    { key: 'MANAGE_BACKUPS',    label: 'Manage Backups',    description: '', module: 'settings' },
  SWITCH_COMPANIES:  { key: 'SWITCH_COMPANIES',  label: 'Switch Companies',  description: '', module: 'companies' },
};

function getAllPermissionKeys() {
  return Object.keys(PERMISSIONS);
}

function getPermissionsByModule() {
  const grouped = {};
  Object.values(PERMISSIONS).forEach(permission => {
    const moduleKey = permission.module;
    if (!grouped[moduleKey]) {
      grouped[moduleKey] = { ...MODULES[moduleKey], permissions: [] };
    }
    grouped[moduleKey].permissions.push({ key: permission.key, label: permission.label, description: permission.description });
  });
  return Object.values(grouped).sort((a, b) => a.order - b.order);
}

function getPermission(key) { return PERMISSIONS[key] || null; }

function isValidPermission(key) { return key in PERMISSIONS; }

function validatePermissions(permissions) {
  if (!Array.isArray(permissions)) return { valid: false, invalidKeys: [] };
  const invalidKeys = permissions.filter(p => !isValidPermission(p));
  return { valid: invalidKeys.length === 0, invalidKeys };
}

module.exports = { PERMISSIONS, MODULES, getAllPermissionKeys, getPermissionsByModule, getPermission, isValidPermission, validatePermissions };
