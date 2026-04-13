/**
 * Complete Permissions Configuration
 * Comprehensive permission definitions with ownership scoping and hierarchy
 *
 * This file replaces backend/config/permissions.js with the full hierarchical permission system
 *
 * Permission Naming Convention:
 * - {RESOURCE}_{ACTION}_{SCOPE}
 * - MANAGE_* permissions are kept for backward compatibility and map to all sub-permissions
 * - *_ALL permissions include *_OWN permissions via hierarchy
 */

const PERMISSIONS = {
  // ============================================================================
  // USER MANAGEMENT (7 permissions)
  // ============================================================================
  MANAGE_USERS: {
    key: 'MANAGE_USERS',
    label: 'Manage Users',
    description: 'Full user management - create, edit, delete, assign roles',
    module: 'users',
    category: 'admin'
  },
  VIEW_USERS: {
    key: 'VIEW_USERS',
    label: 'View Users',
    description: 'View user list and profiles',
    module: 'users',
    category: 'admin'
  },
  CREATE_USERS: {
    key: 'CREATE_USERS',
    label: 'Create Users',
    description: 'Create new user accounts',
    module: 'users',
    category: 'admin'
  },
  EDIT_USERS: {
    key: 'EDIT_USERS',
    label: 'Edit Users',
    description: 'Edit user accounts',
    module: 'users',
    category: 'admin'
  },
  DELETE_USERS: {
    key: 'DELETE_USERS',
    label: 'Delete Users',
    description: 'Deactivate or delete user accounts',
    module: 'users',
    category: 'admin'
  },
  ASSIGN_ROLES: {
    key: 'ASSIGN_ROLES',
    label: 'Assign Roles',
    description: 'Assign roles to users within hierarchy limits',
    module: 'users',
    category: 'admin'
  },

  // ============================================================================
  // ROLE MANAGEMENT (6 permissions)
  // ============================================================================
  MANAGE_ROLES: {
    key: 'MANAGE_ROLES',
    label: 'Manage Roles',
    description: 'Full role management - create, edit, delete roles',
    module: 'users',
    category: 'admin'
  },
  VIEW_ROLES: {
    key: 'VIEW_ROLES',
    label: 'View Roles',
    description: 'View role definitions and permissions',
    module: 'users',
    category: 'admin'
  },
  CREATE_ROLES: {
    key: 'CREATE_ROLES',
    label: 'Create Roles',
    description: 'Create custom roles',
    module: 'users',
    category: 'admin'
  },
  EDIT_ROLES: {
    key: 'EDIT_ROLES',
    label: 'Edit Roles',
    description: 'Modify role definitions',
    module: 'users',
    category: 'admin'
  },
  DELETE_ROLES: {
    key: 'DELETE_ROLES',
    label: 'Delete Roles',
    description: 'Delete custom roles',
    module: 'users',
    category: 'admin'
  },
  MANAGE_ROLE_PERMISSIONS: {
    key: 'MANAGE_ROLE_PERMISSIONS',
    label: 'Manage Role Permissions',
    description: 'Assign permissions to roles',
    module: 'users',
    category: 'admin'
  },

  // ============================================================================
  // COMPANY & SETTINGS (12 permissions)
  // ============================================================================
  MANAGE_COMPANIES: {
    key: 'MANAGE_COMPANIES',
    label: 'Manage Companies',
    description: 'Full company configuration access',
    module: 'company',
    category: 'admin'
  },
  VIEW_COMPANIES: {
    key: 'VIEW_COMPANIES',
    label: 'View Companies',
    description: 'View company information',
    module: 'company',
    category: 'admin'
  },
  SWITCH_COMPANIES: {
    key: 'SWITCH_COMPANIES',
    label: 'Switch Companies',
    description: 'Switch between multiple companies (Super Admin)',
    module: 'company',
    category: 'admin'
  },
  MANAGE_SETTINGS: {
    key: 'MANAGE_SETTINGS',
    label: 'Manage Settings',
    description: 'Full system settings access',
    module: 'system',
    category: 'admin'
  },
  VIEW_SETTINGS: {
    key: 'VIEW_SETTINGS',
    label: 'View Settings',
    description: 'View system settings',
    module: 'system',
    category: 'admin'
  },
  EDIT_SETTINGS: {
    key: 'EDIT_SETTINGS',
    label: 'Edit Settings',
    description: 'Modify system settings',
    module: 'system',
    category: 'admin'
  },
  MANAGE_BRANCHES: {
    key: 'MANAGE_BRANCHES',
    label: 'Manage Branches',
    description: 'Create and manage branches',
    module: 'system',
    category: 'admin'
  },
  MANAGE_EXPENSE_CATEGORIES: {
    key: 'MANAGE_EXPENSE_CATEGORIES',
    label: 'Manage Expense Categories',
    description: 'Create and manage expense categories',
    module: 'finance',
    category: 'finance'
  },
  CONFIGURE_VAT: {
    key: 'CONFIGURE_VAT',
    label: 'Configure VAT',
    description: 'Configure VAT rates',
    module: 'finance',
    category: 'finance'
  },
  CONFIGURE_SECURITY: {
    key: 'CONFIGURE_SECURITY',
    label: 'Configure Security',
    description: 'Configure security settings (MFA, session timeout)',
    module: 'system',
    category: 'admin'
  },

  // ============================================================================
  // BANKING (11 permissions)
  // ============================================================================
  MANAGE_BANKING: {
    key: 'MANAGE_BANKING',
    label: 'Manage Banking',
    description: 'Full banking module access',
    module: 'banking',
    category: 'finance'
  },
  VIEW_BANKING: {
    key: 'VIEW_BANKING',
    label: 'View Banking',
    description: 'View bank accounts and transactions',
    module: 'banking',
    category: 'finance'
  },
  CREATE_BANK_ACCOUNTS: {
    key: 'CREATE_BANK_ACCOUNTS',
    label: 'Create Bank Accounts',
    description: 'Create new bank accounts',
    module: 'banking',
    category: 'finance'
  },
  EDIT_BANK_ACCOUNTS: {
    key: 'EDIT_BANK_ACCOUNTS',
    label: 'Edit Bank Accounts',
    description: 'Edit bank account details',
    module: 'banking',
    category: 'finance'
  },
  DELETE_BANK_ACCOUNTS: {
    key: 'DELETE_BANK_ACCOUNTS',
    label: 'Delete Bank Accounts',
    description: 'Delete bank accounts',
    module: 'banking',
    category: 'finance'
  },
  CREATE_TRANSACTIONS: {
    key: 'CREATE_TRANSACTIONS',
    label: 'Create Transactions',
    description: 'Create bank transactions',
    module: 'banking',
    category: 'finance'
  },
  EDIT_TRANSACTIONS: {
    key: 'EDIT_TRANSACTIONS',
    label: 'Edit Transactions',
    description: 'Edit bank transactions',
    module: 'banking',
    category: 'finance'
  },
  DELETE_TRANSACTIONS: {
    key: 'DELETE_TRANSACTIONS',
    label: 'Delete Transactions',
    description: 'Delete bank transactions',
    module: 'banking',
    category: 'finance'
  },
  RECONCILE_ACCOUNTS: {
    key: 'RECONCILE_ACCOUNTS',
    label: 'Reconcile Accounts',
    description: 'Reconcile bank statements',
    module: 'banking',
    category: 'finance'
  },

  // ============================================================================
  // CUSTOMER MANAGEMENT (8 permissions)
  // ============================================================================
  MANAGE_CUSTOMERS: {
    key: 'MANAGE_CUSTOMERS',
    label: 'Manage Customers',
    description: 'Full customer management access',
    module: 'customers',
    category: 'sales'
  },
  VIEW_CUSTOMERS: {
    key: 'VIEW_CUSTOMERS',
    label: 'View Customers',
    description: 'View customer list and details',
    module: 'customers',
    category: 'sales'
  },
  CREATE_CUSTOMERS: {
    key: 'CREATE_CUSTOMERS',
    label: 'Create Customers',
    description: 'Create new customers',
    module: 'customers',
    category: 'sales'
  },
  EDIT_CUSTOMERS_ALL: {
    key: 'EDIT_CUSTOMERS_ALL',
    label: 'Edit All Customers',
    description: 'Edit any customer',
    module: 'customers',
    category: 'sales'
  },
  EDIT_CUSTOMERS_OWN: {
    key: 'EDIT_CUSTOMERS_OWN',
    label: 'Edit Own Customers',
    description: 'Edit customers created by you',
    module: 'customers',
    category: 'sales'
  },
  DELETE_CUSTOMERS: {
    key: 'DELETE_CUSTOMERS',
    label: 'Delete Customers',
    description: 'Delete or deactivate customers',
    module: 'customers',
    category: 'sales'
  },
  TOGGLE_CUSTOMER_STATUS: {
    key: 'TOGGLE_CUSTOMER_STATUS',
    label: 'Toggle Customer Status',
    description: 'Activate/deactivate customers',
    module: 'customers',
    category: 'sales'
  },

  // ============================================================================
  // SUPPLIER MANAGEMENT (10 permissions)
  // ============================================================================
  MANAGE_SUPPLIERS: {
    key: 'MANAGE_SUPPLIERS',
    label: 'Manage Suppliers',
    description: 'Full supplier management access',
    module: 'suppliers',
    category: 'purchase'
  },
  VIEW_SUPPLIERS: {
    key: 'VIEW_SUPPLIERS',
    label: 'View Suppliers',
    description: 'View supplier list and details',
    module: 'suppliers',
    category: 'purchase'
  },
  CREATE_SUPPLIERS: {
    key: 'CREATE_SUPPLIERS',
    label: 'Create Suppliers',
    description: 'Create new suppliers',
    module: 'suppliers',
    category: 'purchase'
  },
  EDIT_SUPPLIERS_ALL: {
    key: 'EDIT_SUPPLIERS_ALL',
    label: 'Edit All Suppliers',
    description: 'Edit any supplier',
    module: 'suppliers',
    category: 'purchase'
  },
  EDIT_SUPPLIERS_OWN: {
    key: 'EDIT_SUPPLIERS_OWN',
    label: 'Edit Own Suppliers',
    description: 'Edit suppliers created by you',
    module: 'suppliers',
    category: 'purchase'
  },
  DELETE_SUPPLIERS: {
    key: 'DELETE_SUPPLIERS',
    label: 'Delete Suppliers',
    description: 'Delete suppliers',
    module: 'suppliers',
    category: 'purchase'
  },
  MANAGE_SUPPLIER_LOCATIONS: {
    key: 'MANAGE_SUPPLIER_LOCATIONS',
    label: 'Manage Supplier Locations',
    description: 'Manage supplier locations',
    module: 'suppliers',
    category: 'purchase'
  },
  MANAGE_VENDORS: {
    key: 'MANAGE_VENDORS',
    label: 'Manage Vendors',
    description: 'Full vendor management',
    module: 'suppliers',
    category: 'purchase'
  },
  VIEW_VENDORS: {
    key: 'VIEW_VENDORS',
    label: 'View Vendors',
    description: 'View vendor list',
    module: 'suppliers',
    category: 'purchase'
  },

  // ============================================================================
  // MATERIAL & INVENTORY (12 permissions)
  // ============================================================================
  MANAGE_MATERIALS: {
    key: 'MANAGE_MATERIALS',
    label: 'Manage Materials',
    description: 'Full materials management',
    module: 'inventory',
    category: 'inventory'
  },
  VIEW_MATERIALS: {
    key: 'VIEW_MATERIALS',
    label: 'View Materials',
    description: 'View materials list',
    module: 'inventory',
    category: 'inventory'
  },
  CREATE_MATERIALS: {
    key: 'CREATE_MATERIALS',
    label: 'Create Materials',
    description: 'Create new materials',
    module: 'inventory',
    category: 'inventory'
  },
  EDIT_MATERIALS: {
    key: 'EDIT_MATERIALS',
    label: 'Edit Materials',
    description: 'Edit material details',
    module: 'inventory',
    category: 'inventory'
  },
  DELETE_MATERIALS: {
    key: 'DELETE_MATERIALS',
    label: 'Delete Materials',
    description: 'Delete materials',
    module: 'inventory',
    category: 'inventory'
  },
  MANAGE_MATERIAL_COMPOSITIONS: {
    key: 'MANAGE_MATERIAL_COMPOSITIONS',
    label: 'Manage Material Compositions',
    description: 'Manage composite materials',
    module: 'inventory',
    category: 'inventory'
  },
  MANAGE_INVENTORY: {
    key: 'MANAGE_INVENTORY',
    label: 'Manage Inventory',
    description: 'Full inventory management',
    module: 'inventory',
    category: 'inventory'
  },
  VIEW_INVENTORY: {
    key: 'VIEW_INVENTORY',
    label: 'View Inventory',
    description: 'View stock levels and details',
    module: 'inventory',
    category: 'inventory'
  },
  UPDATE_STOCK: {
    key: 'UPDATE_STOCK',
    label: 'Update Stock',
    description: 'Adjust stock quantities',
    module: 'inventory',
    category: 'inventory'
  },
  VIEW_BATCHES: {
    key: 'VIEW_BATCHES',
    label: 'View Batches',
    description: 'View FIFO batch information',
    module: 'inventory',
    category: 'inventory'
  },
  VIEW_STOCK_MOVEMENTS: {
    key: 'VIEW_STOCK_MOVEMENTS',
    label: 'View Stock Movements',
    description: 'View stock movement history',
    module: 'inventory',
    category: 'inventory'
  },
  CREATE_STOCK_REPORTS: {
    key: 'CREATE_STOCK_REPORTS',
    label: 'Create Stock Reports',
    description: 'Generate stock reports',
    module: 'inventory',
    category: 'inventory'
  },

  // ============================================================================
  // SALES MANAGEMENT (14 permissions)
  // ============================================================================
  MANAGE_SALES: {
    key: 'MANAGE_SALES',
    label: 'Manage Sales',
    description: 'Full sales management',
    module: 'sales',
    category: 'sales'
  },
  VIEW_SALES: {
    key: 'VIEW_SALES',
    label: 'View Sales',
    description: 'View sales orders',
    module: 'sales',
    category: 'sales'
  },
  CREATE_SALES_ALL: {
    key: 'CREATE_SALES_ALL',
    label: 'Create Sales (Any)',
    description: 'Create sales orders for any customer',
    module: 'sales',
    category: 'sales'
  },
  CREATE_SALES_OWN: {
    key: 'CREATE_SALES_OWN',
    label: 'Create Sales (Own)',
    description: 'Create sales orders (own only)',
    module: 'sales',
    category: 'sales'
  },
  EDIT_SALES_ALL: {
    key: 'EDIT_SALES_ALL',
    label: 'Edit Sales (Any)',
    description: 'Edit any sales order',
    module: 'sales',
    category: 'sales'
  },
  EDIT_SALES_OWN: {
    key: 'EDIT_SALES_OWN',
    label: 'Edit Sales (Own)',
    description: 'Edit own sales orders',
    module: 'sales',
    category: 'sales'
  },
  DELETE_SALES_ALL: {
    key: 'DELETE_SALES_ALL',
    label: 'Delete Sales (Any)',
    description: 'Delete any sales order',
    module: 'sales',
    category: 'sales'
  },
  DELETE_SALES_OWN: {
    key: 'DELETE_SALES_OWN',
    label: 'Delete Sales (Own)',
    description: 'Delete own sales orders',
    module: 'sales',
    category: 'sales'
  },
  APPROVE_SALES: {
    key: 'APPROVE_SALES',
    label: 'Approve Sales',
    description: 'Approve pending sales orders',
    module: 'sales',
    category: 'sales'
  },
  GENERATE_SALES_INVOICE: {
    key: 'GENERATE_SALES_INVOICE',
    label: 'Generate Sales Invoice',
    description: 'Generate invoices from sales orders',
    module: 'sales',
    category: 'sales'
  },

  // ============================================================================
  // PURCHASE MANAGEMENT (20 permissions)
  // ============================================================================
  MANAGE_PURCHASE: {
    key: 'MANAGE_PURCHASE',
    label: 'Manage Purchase',
    description: 'Full purchase management',
    module: 'purchase',
    category: 'purchase'
  },
  VIEW_PURCHASE: {
    key: 'VIEW_PURCHASE',
    label: 'View Purchase',
    description: 'View purchase orders',
    module: 'purchase',
    category: 'purchase'
  },
  CREATE_PURCHASE_ALL: {
    key: 'CREATE_PURCHASE_ALL',
    label: 'Create Purchase (Any)',
    description: 'Create purchase orders for any supplier',
    module: 'purchase',
    category: 'purchase'
  },
  CREATE_PURCHASE_OWN: {
    key: 'CREATE_PURCHASE_OWN',
    label: 'Create Purchase (Own)',
    description: 'Create purchase orders (own only)',
    module: 'purchase',
    category: 'purchase'
  },
  EDIT_PURCHASE_ALL: {
    key: 'EDIT_PURCHASE_ALL',
    label: 'Edit Purchase (Any)',
    description: 'Edit any purchase order',
    module: 'purchase',
    category: 'purchase'
  },
  EDIT_PURCHASE_OWN: {
    key: 'EDIT_PURCHASE_OWN',
    label: 'Edit Purchase (Own)',
    description: 'Edit own purchase orders',
    module: 'purchase',
    category: 'purchase'
  },
  DELETE_PURCHASE_ALL: {
    key: 'DELETE_PURCHASE_ALL',
    label: 'Delete Purchase (Any)',
    description: 'Delete any purchase order',
    module: 'purchase',
    category: 'purchase'
  },
  DELETE_PURCHASE_OWN: {
    key: 'DELETE_PURCHASE_OWN',
    label: 'Delete Purchase (Own)',
    description: 'Delete own purchase orders',
    module: 'purchase',
    category: 'purchase'
  },
  APPROVE_PURCHASE: {
    key: 'APPROVE_PURCHASE',
    label: 'Approve Purchase',
    description: 'Approve pending purchase orders',
    module: 'purchase',
    category: 'purchase'
  },
  RECEIVE_PURCHASE: {
    key: 'RECEIVE_PURCHASE',
    label: 'Receive Purchase',
    description: 'Receive goods and update inventory',
    module: 'purchase',
    category: 'purchase'
  },
  MANAGE_PURCHASE_AMENDMENTS: {
    key: 'MANAGE_PURCHASE_AMENDMENTS',
    label: 'Manage Purchase Amendments',
    description: 'Create and manage purchase order amendments',
    module: 'purchase',
    category: 'purchase'
  },
  VIEW_UNBILLED_PURCHASES: {
    key: 'VIEW_UNBILLED_PURCHASES',
    label: 'View Unbilled Purchases',
    description: 'View unbilled purchase orders',
    module: 'purchase',
    category: 'purchase'
  },

  // Purchase Order variants (legacy compatibility)
  VIEW_PURCHASE_ORDER: {
    key: 'VIEW_PURCHASE_ORDER',
    label: 'View Purchase Order',
    description: 'View purchase orders',
    module: 'purchase',
    category: 'purchase'
  },
  CREATE_PURCHASE_ORDER: {
    key: 'CREATE_PURCHASE_ORDER',
    label: 'Create Purchase Order',
    description: 'Create purchase orders',
    module: 'purchase',
    category: 'purchase'
  },
  EDIT_PURCHASE_ORDER: {
    key: 'EDIT_PURCHASE_ORDER',
    label: 'Edit Purchase Order',
    description: 'Edit purchase orders',
    module: 'purchase',
    category: 'purchase'
  },
  DELETE_PURCHASE_ORDER: {
    key: 'DELETE_PURCHASE_ORDER',
    label: 'Delete Purchase Order',
    description: 'Delete purchase orders',
    module: 'purchase',
    category: 'purchase'
  },
  APPROVE_PURCHASE_ORDER: {
    key: 'APPROVE_PURCHASE_ORDER',
    label: 'Approve Purchase Order',
    description: 'Approve purchase orders',
    module: 'purchase',
    category: 'purchase'
  },

  // ============================================================================
  // CONTRACT MANAGEMENT (12 permissions)
  // ============================================================================
  MANAGE_CONTRACTS: {
    key: 'MANAGE_CONTRACTS',
    label: 'Manage Contracts',
    description: 'Full contract management',
    module: 'contracts',
    category: 'purchase'
  },
  VIEW_CONTRACTS: {
    key: 'VIEW_CONTRACTS',
    label: 'View Contracts',
    description: 'View contracts',
    module: 'contracts',
    category: 'purchase'
  },
  CREATE_CONTRACTS: {
    key: 'CREATE_CONTRACTS',
    label: 'Create Contracts',
    description: 'Create new contracts',
    module: 'contracts',
    category: 'purchase'
  },
  EDIT_CONTRACTS_ALL: {
    key: 'EDIT_CONTRACTS_ALL',
    label: 'Edit Contracts (Any)',
    description: 'Edit any contract',
    module: 'contracts',
    category: 'purchase'
  },
  EDIT_CONTRACTS_OWN: {
    key: 'EDIT_CONTRACTS_OWN',
    label: 'Edit Contracts (Own)',
    description: 'Edit own contracts',
    module: 'contracts',
    category: 'purchase'
  },
  DELETE_CONTRACTS: {
    key: 'DELETE_CONTRACTS',
    label: 'Delete Contracts',
    description: 'Delete contracts',
    module: 'contracts',
    category: 'purchase'
  },
  APPROVE_CONTRACTS: {
    key: 'APPROVE_CONTRACTS',
    label: 'Approve Contracts',
    description: 'Approve pending contracts',
    module: 'contracts',
    category: 'purchase'
  },
  MANAGE_CONTRACT_LOCATIONS: {
    key: 'MANAGE_CONTRACT_LOCATIONS',
    label: 'Manage Contract Locations',
    description: 'Manage contract locations',
    module: 'contracts',
    category: 'purchase'
  },
  MANAGE_CONTRACT_RATES: {
    key: 'MANAGE_CONTRACT_RATES',
    label: 'Manage Contract Rates',
    description: 'Manage contract material rates',
    module: 'contracts',
    category: 'purchase'
  },

  // ============================================================================
  // COLLECTIONS MANAGEMENT (12 permissions)
  // ============================================================================
  MANAGE_COLLECTIONS: {
    key: 'MANAGE_COLLECTIONS',
    label: 'Manage Collections',
    description: 'Full collections management',
    module: 'collections',
    category: 'purchase'
  },
  VIEW_COLLECTIONS: {
    key: 'VIEW_COLLECTIONS',
    label: 'View Collections',
    description: 'View collection orders',
    module: 'collections',
    category: 'purchase'
  },
  CREATE_COLLECTIONS: {
    key: 'CREATE_COLLECTIONS',
    label: 'Create Collections',
    description: 'Create collection orders',
    module: 'collections',
    category: 'purchase'
  },
  EDIT_COLLECTIONS_ALL: {
    key: 'EDIT_COLLECTIONS_ALL',
    label: 'Edit Collections (Any)',
    description: 'Edit any collection order',
    module: 'collections',
    category: 'purchase'
  },
  EDIT_COLLECTIONS_OWN: {
    key: 'EDIT_COLLECTIONS_OWN',
    label: 'Edit Collections (Own)',
    description: 'Edit own collection orders',
    module: 'collections',
    category: 'purchase'
  },
  DELETE_COLLECTIONS: {
    key: 'DELETE_COLLECTIONS',
    label: 'Delete Collections',
    description: 'Delete collection orders',
    module: 'collections',
    category: 'purchase'
  },
  APPROVE_COLLECTIONS: {
    key: 'APPROVE_COLLECTIONS',
    label: 'Approve Collections',
    description: 'Approve/finalize collections',
    module: 'collections',
    category: 'purchase'
  },
  FINALIZE_WCN: {
    key: 'FINALIZE_WCN',
    label: 'Finalize WCN',
    description: 'Finalize waste consignment notes',
    module: 'collections',
    category: 'purchase'
  },
  CREATE_CALLOUTS: {
    key: 'CREATE_CALLOUTS',
    label: 'Create Callouts',
    description: 'Create collection callouts',
    module: 'collections',
    category: 'purchase'
  },

  // ============================================================================
  // WASTAGE MANAGEMENT (12 permissions)
  // ============================================================================
  MANAGE_WASTAGE: {
    key: 'MANAGE_WASTAGE',
    label: 'Manage Wastage',
    description: 'Full wastage management',
    module: 'wastage',
    category: 'inventory'
  },
  VIEW_WASTAGE: {
    key: 'VIEW_WASTAGE',
    label: 'View Wastage',
    description: 'View wastage records',
    module: 'wastage',
    category: 'inventory'
  },
  CREATE_WASTAGE_ALL: {
    key: 'CREATE_WASTAGE_ALL',
    label: 'Create Wastage (Any)',
    description: 'Create wastage records for any material',
    module: 'wastage',
    category: 'inventory'
  },
  CREATE_WASTAGE_OWN: {
    key: 'CREATE_WASTAGE_OWN',
    label: 'Create Wastage (Own)',
    description: 'Create own wastage records',
    module: 'wastage',
    category: 'inventory'
  },
  EDIT_WASTAGE_ALL: {
    key: 'EDIT_WASTAGE_ALL',
    label: 'Edit Wastage (Any)',
    description: 'Edit any wastage record',
    module: 'wastage',
    category: 'inventory'
  },
  EDIT_WASTAGE_OWN: {
    key: 'EDIT_WASTAGE_OWN',
    label: 'Edit Wastage (Own)',
    description: 'Edit own wastage records',
    module: 'wastage',
    category: 'inventory'
  },
  DELETE_WASTAGE_ALL: {
    key: 'DELETE_WASTAGE_ALL',
    label: 'Delete Wastage (Any)',
    description: 'Delete any wastage record',
    module: 'wastage',
    category: 'inventory'
  },
  DELETE_WASTAGE_OWN: {
    key: 'DELETE_WASTAGE_OWN',
    label: 'Delete Wastage (Own)',
    description: 'Delete own wastage records',
    module: 'wastage',
    category: 'inventory'
  },
  APPROVE_WASTAGE: {
    key: 'APPROVE_WASTAGE',
    label: 'Approve Wastage',
    description: 'Approve wastage records',
    module: 'wastage',
    category: 'inventory'
  },

  // ============================================================================
  // FINANCIAL MANAGEMENT (18 permissions)
  // ============================================================================
  MANAGE_FINANCIALS: {
    key: 'MANAGE_FINANCIALS',
    label: 'Manage Financials',
    description: 'Full financial management',
    module: 'finance',
    category: 'finance'
  },
  VIEW_FINANCIALS: {
    key: 'VIEW_FINANCIALS',
    label: 'View Financials',
    description: 'View financial data',
    module: 'finance',
    category: 'finance'
  },
  VIEW_PROFIT_LOSS: {
    key: 'VIEW_PROFIT_LOSS',
    label: 'View Profit & Loss',
    description: 'View P&L reports',
    module: 'finance',
    category: 'finance'
  },
  VIEW_BALANCE_SHEET: {
    key: 'VIEW_BALANCE_SHEET',
    label: 'View Balance Sheet',
    description: 'View balance sheet',
    module: 'finance',
    category: 'finance'
  },
  VIEW_CASH_FLOW: {
    key: 'VIEW_CASH_FLOW',
    label: 'View Cash Flow',
    description: 'View cash flow statements',
    module: 'finance',
    category: 'finance'
  },

  // Expense Management
  MANAGE_EXPENSES_ALL: {
    key: 'MANAGE_EXPENSES_ALL',
    label: 'Manage All Expenses',
    description: 'Full expense management',
    module: 'finance',
    category: 'finance'
  },
  VIEW_EXPENSES: {
    key: 'VIEW_EXPENSES',
    label: 'View Expenses',
    description: 'View expense records',
    module: 'finance',
    category: 'finance'
  },
  CREATE_EXPENSE_ALL: {
    key: 'CREATE_EXPENSE_ALL',
    label: 'Create Expense (Any)',
    description: 'Create expenses for any user',
    module: 'finance',
    category: 'finance'
  },
  CREATE_EXPENSE_OWN: {
    key: 'CREATE_EXPENSE_OWN',
    label: 'Create Expense (Own)',
    description: 'Create own expenses',
    module: 'finance',
    category: 'finance'
  },
  EDIT_EXPENSE_ALL: {
    key: 'EDIT_EXPENSE_ALL',
    label: 'Edit Expense (Any)',
    description: 'Edit any expense',
    module: 'finance',
    category: 'finance'
  },
  EDIT_EXPENSE_OWN: {
    key: 'EDIT_EXPENSE_OWN',
    label: 'Edit Expense (Own)',
    description: 'Edit own expenses',
    module: 'finance',
    category: 'finance'
  },
  DELETE_EXPENSE_ALL: {
    key: 'DELETE_EXPENSE_ALL',
    label: 'Delete Expense (Any)',
    description: 'Delete any expense',
    module: 'finance',
    category: 'finance'
  },
  DELETE_EXPENSE_OWN: {
    key: 'DELETE_EXPENSE_OWN',
    label: 'Delete Expense (Own)',
    description: 'Delete own expenses',
    module: 'finance',
    category: 'finance'
  },
  APPROVE_EXPENSE_ALL: {
    key: 'APPROVE_EXPENSE_ALL',
    label: 'Approve Expense (Any)',
    description: 'Approve any expense',
    module: 'finance',
    category: 'finance'
  },
  APPROVE_EXPENSE_OWN: {
    key: 'APPROVE_EXPENSE_OWN',
    label: 'Approve Expense (Own)',
    description: 'Approve own expenses (self-approval)',
    module: 'finance',
    category: 'finance'
  },

  // Legacy expense permissions (for backward compatibility)
  MANAGE_EXPENSES: {
    key: 'MANAGE_EXPENSES',
    label: 'Manage Expenses',
    description: 'Legacy - use MANAGE_EXPENSES_ALL',
    module: 'finance',
    category: 'finance'
  },
  APPROVE_EXPENSES: {
    key: 'APPROVE_EXPENSES',
    label: 'Approve Expenses',
    description: 'Legacy - use APPROVE_EXPENSE_ALL',
    module: 'finance',
    category: 'finance'
  },
  CREATE_EXPENSE: {
    key: 'CREATE_EXPENSE',
    label: 'Create Expense',
    description: 'Legacy - use CREATE_EXPENSE_OWN or CREATE_EXPENSE_ALL',
    module: 'finance',
    category: 'finance'
  },
  APPROVE_EXPENSE: {
    key: 'APPROVE_EXPENSE',
    label: 'Approve Expense',
    description: 'Legacy - use APPROVE_EXPENSE_ALL',
    module: 'finance',
    category: 'finance'
  },

  // ============================================================================
  // PETTY CASH MANAGEMENT (25 permissions)
  // ============================================================================
  MANAGE_PETTY_CASH: {
    key: 'MANAGE_PETTY_CASH',
    label: 'Manage Petty Cash',
    description: 'Full petty cash management',
    module: 'petty_cash',
    category: 'finance'
  },
  VIEW_PETTY_CASH: {
    key: 'VIEW_PETTY_CASH',
    label: 'View Petty Cash',
    description: 'View petty cash cards and expenses',
    module: 'petty_cash',
    category: 'finance'
  },

  // Card Management
  MANAGE_PETTY_CASH_CARDS: {
    key: 'MANAGE_PETTY_CASH_CARDS',
    label: 'Manage Petty Cash Cards',
    description: 'Full card management',
    module: 'petty_cash',
    category: 'finance'
  },
  CREATE_PETTY_CASH_CARD: {
    key: 'CREATE_PETTY_CASH_CARD',
    label: 'Create Petty Cash Card',
    description: 'Create new petty cash cards',
    module: 'petty_cash',
    category: 'finance'
  },
  EDIT_PETTY_CASH_CARD: {
    key: 'EDIT_PETTY_CASH_CARD',
    label: 'Edit Petty Cash Card',
    description: 'Edit card details',
    module: 'petty_cash',
    category: 'finance'
  },
  DELETE_PETTY_CASH_CARD: {
    key: 'DELETE_PETTY_CASH_CARD',
    label: 'Delete Petty Cash Card',
    description: 'Delete petty cash cards',
    module: 'petty_cash',
    category: 'finance'
  },
  RELOAD_CARD: {
    key: 'RELOAD_CARD',
    label: 'Reload Card',
    description: 'Add funds to petty cash cards',
    module: 'petty_cash',
    category: 'finance'
  },
  SUSPEND_CARD: {
    key: 'SUSPEND_CARD',
    label: 'Suspend Card',
    description: 'Suspend petty cash cards',
    module: 'petty_cash',
    category: 'finance'
  },
  ACTIVATE_CARD: {
    key: 'ACTIVATE_CARD',
    label: 'Activate Card',
    description: 'Activate petty cash cards',
    module: 'petty_cash',
    category: 'finance'
  },

  // User Management
  MANAGE_PETTY_CASH_USERS: {
    key: 'MANAGE_PETTY_CASH_USERS',
    label: 'Manage Petty Cash Users',
    description: 'Full petty cash user management',
    module: 'petty_cash',
    category: 'finance'
  },
  CREATE_PETTY_CASH_USER: {
    key: 'CREATE_PETTY_CASH_USER',
    label: 'Create Petty Cash User',
    description: 'Register new petty cash users',
    module: 'petty_cash',
    category: 'finance'
  },
  EDIT_PETTY_CASH_USER_ALL: {
    key: 'EDIT_PETTY_CASH_USER_ALL',
    label: 'Edit Petty Cash User (Any)',
    description: 'Edit any petty cash user',
    module: 'petty_cash',
    category: 'finance'
  },
  EDIT_PETTY_CASH_USER_OWN: {
    key: 'EDIT_PETTY_CASH_USER_OWN',
    label: 'Edit Petty Cash User (Own)',
    description: 'Edit own petty cash user profile',
    module: 'petty_cash',
    category: 'finance'
  },
  DELETE_PETTY_CASH_USER: {
    key: 'DELETE_PETTY_CASH_USER',
    label: 'Delete Petty Cash User',
    description: 'Delete petty cash users',
    module: 'petty_cash',
    category: 'finance'
  },
  ASSIGN_PETTY_CASH_CARD: {
    key: 'ASSIGN_PETTY_CASH_CARD',
    label: 'Assign Petty Cash Card',
    description: 'Assign cards to users',
    module: 'petty_cash',
    category: 'finance'
  },

  // Expense Management
  CREATE_PETTY_CASH_EXPENSE_ALL: {
    key: 'CREATE_PETTY_CASH_EXPENSE_ALL',
    label: 'Create Petty Cash Expense (Any)',
    description: 'Create expense for any user',
    module: 'petty_cash',
    category: 'finance'
  },
  CREATE_PETTY_CASH_EXPENSE_OWN: {
    key: 'CREATE_PETTY_CASH_EXPENSE_OWN',
    label: 'Create Petty Cash Expense (Own)',
    description: 'Create own petty cash expense',
    module: 'petty_cash',
    category: 'finance'
  },
  EDIT_PETTY_CASH_EXPENSE_ALL: {
    key: 'EDIT_PETTY_CASH_EXPENSE_ALL',
    label: 'Edit Petty Cash Expense (Any)',
    description: 'Edit any petty cash expense',
    module: 'petty_cash',
    category: 'finance'
  },
  EDIT_PETTY_CASH_EXPENSE_OWN: {
    key: 'EDIT_PETTY_CASH_EXPENSE_OWN',
    label: 'Edit Petty Cash Expense (Own)',
    description: 'Edit own petty cash expense',
    module: 'petty_cash',
    category: 'finance'
  },
  DELETE_PETTY_CASH_EXPENSE_ALL: {
    key: 'DELETE_PETTY_CASH_EXPENSE_ALL',
    label: 'Delete Petty Cash Expense (Any)',
    description: 'Delete any petty cash expense',
    module: 'petty_cash',
    category: 'finance'
  },
  DELETE_PETTY_CASH_EXPENSE_OWN: {
    key: 'DELETE_PETTY_CASH_EXPENSE_OWN',
    label: 'Delete Petty Cash Expense (Own)',
    description: 'Delete own petty cash expense',
    module: 'petty_cash',
    category: 'finance'
  },
  APPROVE_PETTY_CASH_EXPENSE: {
    key: 'APPROVE_PETTY_CASH_EXPENSE',
    label: 'Approve Petty Cash Expense',
    description: 'Approve petty cash expenses',
    module: 'petty_cash',
    category: 'finance'
  },
  VIEW_EXPENSE_REPORTS: {
    key: 'VIEW_EXPENSE_REPORTS',
    label: 'View Expense Reports',
    description: 'View petty cash expense reports',
    module: 'petty_cash',
    category: 'finance'
  },

  // ============================================================================
  // INVOICE MANAGEMENT (10 permissions)
  // ============================================================================
  MANAGE_INVOICES: {
    key: 'MANAGE_INVOICES',
    label: 'Manage Invoices',
    description: 'Full invoice management',
    module: 'invoices',
    category: 'sales'
  },
  VIEW_INVOICES: {
    key: 'VIEW_INVOICES',
    label: 'View Invoices',
    description: 'View invoices',
    module: 'invoices',
    category: 'sales'
  },
  CREATE_INVOICES_ALL: {
    key: 'CREATE_INVOICES_ALL',
    label: 'Create Invoices (Any)',
    description: 'Create invoices for any order',
    module: 'invoices',
    category: 'sales'
  },
  CREATE_INVOICES_OWN: {
    key: 'CREATE_INVOICES_OWN',
    label: 'Create Invoices (Own)',
    description: 'Create invoices for own orders',
    module: 'invoices',
    category: 'sales'
  },
  EDIT_INVOICES_ALL: {
    key: 'EDIT_INVOICES_ALL',
    label: 'Edit Invoices (Any)',
    description: 'Edit any invoice',
    module: 'invoices',
    category: 'sales'
  },
  EDIT_INVOICES_OWN: {
    key: 'EDIT_INVOICES_OWN',
    label: 'Edit Invoices (Own)',
    description: 'Edit own invoices',
    module: 'invoices',
    category: 'sales'
  },
  DELETE_INVOICES: {
    key: 'DELETE_INVOICES',
    label: 'Delete Invoices',
    description: 'Delete invoices',
    module: 'invoices',
    category: 'sales'
  },
  SEND_INVOICES: {
    key: 'SEND_INVOICES',
    label: 'Send Invoices',
    description: 'Send invoices to customers',
    module: 'invoices',
    category: 'sales'
  },
  RECORD_PAYMENT: {
    key: 'RECORD_PAYMENT',
    label: 'Record Payment',
    description: 'Record invoice payments',
    module: 'invoices',
    category: 'sales'
  },

  // Legacy invoice permissions
  CREATE_INVOICES: {
    key: 'CREATE_INVOICES',
    label: 'Create Invoices',
    description: 'Legacy - use CREATE_INVOICES_OWN or CREATE_INVOICES_ALL',
    module: 'invoices',
    category: 'sales'
  },
  EDIT_INVOICES: {
    key: 'EDIT_INVOICES',
    label: 'Edit Invoices',
    description: 'Legacy - use EDIT_INVOICES_OWN or EDIT_INVOICES_ALL',
    module: 'invoices',
    category: 'sales'
  },

  // ============================================================================
  // REPORTING & ANALYTICS (6 permissions)
  // ============================================================================
  MANAGE_REPORTS: {
    key: 'MANAGE_REPORTS',
    label: 'Manage Reports',
    description: 'Full reporting access',
    module: 'reports',
    category: 'reporting'
  },
  VIEW_REPORTS: {
    key: 'VIEW_REPORTS',
    label: 'View Reports',
    description: 'View available reports',
    module: 'reports',
    category: 'reporting'
  },
  EXPORT_REPORTS: {
    key: 'EXPORT_REPORTS',
    label: 'Export Reports',
    description: 'Export reports to CSV/PDF',
    module: 'reports',
    category: 'reporting'
  },
  CREATE_CUSTOM_REPORTS: {
    key: 'CREATE_CUSTOM_REPORTS',
    label: 'Create Custom Reports',
    description: 'Build custom report queries',
    module: 'reports',
    category: 'reporting'
  },
  VIEW_ANALYTICS_DASHBOARD: {
    key: 'VIEW_ANALYTICS_DASHBOARD',
    label: 'View Analytics Dashboard',
    description: 'View analytics and KPIs',
    module: 'reports',
    category: 'reporting'
  },
  VIEW_WCNS: {
    key: 'VIEW_WCNS',
    label: 'View WCNs',
    description: 'View WCN register report',
    module: 'reports',
    category: 'reporting'
  },

  // ============================================================================
  // PROJECT MANAGEMENT (9 permissions)
  // ============================================================================
  MANAGE_PROJECTS: {
    key: 'MANAGE_PROJECTS',
    label: 'Manage Projects',
    description: 'Full project management',
    module: 'projects',
    category: 'admin'
  },
  VIEW_PROJECTS: {
    key: 'VIEW_PROJECTS',
    label: 'View Projects',
    description: 'View project list',
    module: 'projects',
    category: 'admin'
  },
  CREATE_PROJECTS: {
    key: 'CREATE_PROJECTS',
    label: 'Create Projects',
    description: 'Create new projects',
    module: 'projects',
    category: 'admin'
  },
  EDIT_PROJECTS: {
    key: 'EDIT_PROJECTS',
    label: 'Edit Projects',
    description: 'Edit project details',
    module: 'projects',
    category: 'admin'
  },
  DELETE_PROJECTS: {
    key: 'DELETE_PROJECTS',
    label: 'Delete Projects',
    description: 'Delete projects',
    module: 'projects',
    category: 'admin'
  },
  ASSIGN_PROJECT_USERS: {
    key: 'ASSIGN_PROJECT_USERS',
    label: 'Assign Project Users',
    description: 'Assign users to projects',
    module: 'projects',
    category: 'admin'
  },
  VIEW_PROJECT_ATTACHMENTS: {
    key: 'VIEW_PROJECT_ATTACHMENTS',
    label: 'View Project Attachments',
    description: 'View project files',
    module: 'projects',
    category: 'admin'
  },
  MANAGE_PROJECT_ATTACHMENTS: {
    key: 'MANAGE_PROJECT_ATTACHMENTS',
    label: 'Manage Project Attachments',
    description: 'Upload/delete project files',
    module: 'projects',
    category: 'admin'
  },

  // ============================================================================
  // AUDIT & SYSTEM (3 permissions)
  // ============================================================================
  VIEW_AUDIT_LOGS: {
    key: 'VIEW_AUDIT_LOGS',
    label: 'View Audit Logs',
    description: 'View system audit trail',
    module: 'system',
    category: 'admin'
  },
  VIEW_DASHBOARD: {
    key: 'VIEW_DASHBOARD',
    label: 'View Dashboard',
    description: 'View main dashboard',
    module: 'system',
    category: 'general'
  },
};

// ============================================================================
// PERMISSION GROUPS (For UI Organization)
// ============================================================================
const PERMISSION_GROUPS = {
  admin: {
    label: 'Administration',
    color: 'red',
    permissions: Object.values(PERMISSIONS).filter(p => p.category === 'admin')
  },
  sales: {
    label: 'Sales',
    color: 'green',
    permissions: Object.values(PERMISSIONS).filter(p => p.category === 'sales')
  },
  purchase: {
    label: 'Purchase',
    color: 'blue',
    permissions: Object.values(PERMISSIONS).filter(p => p.category === 'purchase')
  },
  inventory: {
    label: 'Inventory',
    color: 'purple',
    permissions: Object.values(PERMISSIONS).filter(p => p.category === 'inventory')
  },
  finance: {
    label: 'Finance',
    color: 'amber',
    permissions: Object.values(PERMISSIONS).filter(p => p.category === 'finance')
  },
  reporting: {
    label: 'Reporting',
    color: 'cyan',
    permissions: Object.values(PERMISSIONS).filter(p => p.category === 'reporting')
  },
  general: {
    label: 'General',
    color: 'gray',
    permissions: Object.values(PERMISSIONS).filter(p => p.category === 'general')
  }
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get all permission keys
 */
function getAllPermissionKeys() {
  return Object.keys(PERMISSIONS);
}

/**
 * Get permissions by module
 */
function getPermissionsByModule(module) {
  return Object.values(PERMISSIONS).filter(p => p.module === module);
}

/**
 * Get permissions by category
 */
function getPermissionsByCategory(category) {
  return Object.values(PERMISSIONS).filter(p => p.category === category);
}

/**
 * Check if a permission exists
 */
function isValidPermission(permissionKey) {
  return PERMISSIONS.hasOwnProperty(permissionKey);
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  PERMISSIONS,
  PERMISSION_GROUPS,
  getAllPermissionKeys,
  getPermissionsByModule,
  getPermissionsByCategory,
  isValidPermission
};
