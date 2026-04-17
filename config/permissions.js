/**
 * Permissions Configuration — SINGLE SOURCE OF TRUTH
 *
 * This file is the canonical catalog of every permission the backend routes enforce.
 * The role-editor UI reads from GET /roles/permissions which serializes this object.
 *
 * HOW TO ADD A NEW PERMISSION:
 *   1. Add an entry below with key, label, description, module
 *   2. Add its implies-parent (if any) in config/permissionsHierarchy.js
 *   3. Reference it via requirePermission('X') in the route
 *
 * Total perms auto-merged from old permissions.js + permissionsComplete.js.
 */

const PERMISSIONS = {
  // ──────────────────────────── User Management ────────────────────────────
  ASSIGN_ROLES: {
    key: 'ASSIGN_ROLES',
    label: "Assign Roles",
    description: "Assign roles to users within hierarchy limits",
    module: 'users'
  },
  CREATE_ROLES: {
    key: 'CREATE_ROLES',
    label: "Create Roles",
    description: "Create custom roles",
    module: 'users'
  },
  CREATE_USERS: {
    key: 'CREATE_USERS',
    label: "Create Users",
    description: "Create new user accounts",
    module: 'users'
  },
  DELETE_ROLES: {
    key: 'DELETE_ROLES',
    label: "Delete Roles",
    description: "Delete custom roles",
    module: 'users'
  },
  DELETE_USERS: {
    key: 'DELETE_USERS',
    label: "Delete Users",
    description: "Deactivate or delete user accounts",
    module: 'users'
  },
  EDIT_ROLES: {
    key: 'EDIT_ROLES',
    label: "Edit Roles",
    description: "Modify role definitions",
    module: 'users'
  },
  EDIT_USERS: {
    key: 'EDIT_USERS',
    label: "Edit Users",
    description: "Edit user accounts",
    module: 'users'
  },
  MANAGE_ROLE_PERMISSIONS: {
    key: 'MANAGE_ROLE_PERMISSIONS',
    label: "Manage Role Permissions",
    description: "Assign permissions to roles",
    module: 'users'
  },
  MANAGE_ROLES: {
    key: 'MANAGE_ROLES',
    label: "Manage Roles",
    description: "Create, edit, and delete custom roles",
    module: 'users'
  },
  MANAGE_USERS: {
    key: 'MANAGE_USERS',
    label: "Manage Users",
    description: "Create, edit, and deactivate user accounts",
    module: 'users'
  },
  VIEW_ROLES: {
    key: 'VIEW_ROLES',
    label: "View Roles",
    description: "View role definitions and permissions",
    module: 'users'
  },
  VIEW_USERS: {
    key: 'VIEW_USERS',
    label: "View Users",
    description: "View user list and profiles",
    module: 'users'
  },

  // ──────────────────────────── Company Management ────────────────────────────
  CREATE_BRANCHES: {
    key: 'CREATE_BRANCHES',
    label: "Create Branches",
    description: "Create Branches — scope/action inferred from naming",
    module: 'company'
  },
  CREATE_COMPANIES: {
    key: 'CREATE_COMPANIES',
    label: "Create Companies",
    description: "Create Companies — scope/action inferred from naming",
    module: 'company'
  },
  DELETE_BRANCHES: {
    key: 'DELETE_BRANCHES',
    label: "Delete Branches",
    description: "Delete Branches — scope/action inferred from naming",
    module: 'company'
  },
  DELETE_COMPANIES: {
    key: 'DELETE_COMPANIES',
    label: "Delete Companies",
    description: "Delete Companies — scope/action inferred from naming",
    module: 'company'
  },
  EDIT_BRANCHES: {
    key: 'EDIT_BRANCHES',
    label: "Edit Branches",
    description: "Edit Branches — scope/action inferred from naming",
    module: 'company'
  },
  EDIT_COMPANIES: {
    key: 'EDIT_COMPANIES',
    label: "Edit Companies",
    description: "Edit Companies — scope/action inferred from naming",
    module: 'company'
  },
  MANAGE_COMPANIES: {
    key: 'MANAGE_COMPANIES',
    label: "Manage Companies",
    description: "Full company configuration access",
    module: 'company'
  },
  SWITCH_COMPANIES: {
    key: 'SWITCH_COMPANIES',
    label: "Switch Companies",
    description: "Switch between multiple companies",
    module: 'company'
  },
  VIEW_COMPANIES: {
    key: 'VIEW_COMPANIES',
    label: "View Companies",
    description: "View company information",
    module: 'company'
  },

  // ──────────────────────────── Customers ────────────────────────────
  CREATE_CUSTOMERS: {
    key: 'CREATE_CUSTOMERS',
    label: "Create Customers",
    description: "Create new customers",
    module: 'customers'
  },
  DELETE_CUSTOMERS: {
    key: 'DELETE_CUSTOMERS',
    label: "Delete Customers",
    description: "Delete or deactivate customers",
    module: 'customers'
  },
  EDIT_CUSTOMERS_ALL: {
    key: 'EDIT_CUSTOMERS_ALL',
    label: "Edit All Customers",
    description: "Edit any customer",
    module: 'customers'
  },
  EDIT_CUSTOMERS_OWN: {
    key: 'EDIT_CUSTOMERS_OWN',
    label: "Edit Own Customers",
    description: "Edit customers created by you",
    module: 'customers'
  },
  MANAGE_CUSTOMERS: {
    key: 'MANAGE_CUSTOMERS',
    label: "Manage Customers",
    description: "Create, edit, and delete customers",
    module: 'customers'
  },
  TOGGLE_CUSTOMER_STATUS: {
    key: 'TOGGLE_CUSTOMER_STATUS',
    label: "Toggle Customer Status",
    description: "Activate/deactivate customers",
    module: 'customers'
  },
  VIEW_CUSTOMER_TYPES: {
    key: 'VIEW_CUSTOMER_TYPES',
    label: "View Customer Types",
    description: "View customer type categories",
    module: 'customers'
  },
  VIEW_CUSTOMERS: {
    key: 'VIEW_CUSTOMERS',
    label: "View Customers",
    description: "View customer list and details",
    module: 'customers'
  },
  VIEW_CUSTOMERS_ALL: {
    key: 'VIEW_CUSTOMERS_ALL',
    label: "View Customers All",
    description: "View Customers All — scope/action inferred from naming",
    module: 'customers'
  },
  VIEW_CUSTOMERS_OWN: {
    key: 'VIEW_CUSTOMERS_OWN',
    label: "View Customers Own",
    description: "View Customers Own — scope/action inferred from naming",
    module: 'customers'
  },

  // ──────────────────────────── Suppliers & Vendors ────────────────────────────
  CREATE_SUPPLIER_LOCATIONS: {
    key: 'CREATE_SUPPLIER_LOCATIONS',
    label: "Create Supplier Locations",
    description: "Add new supplier locations",
    module: 'suppliers'
  },
  CREATE_SUPPLIERS: {
    key: 'CREATE_SUPPLIERS',
    label: "Create Suppliers",
    description: "Create new suppliers",
    module: 'suppliers'
  },
  CREATE_VENDORS: {
    key: 'CREATE_VENDORS',
    label: "Create Vendors",
    description: "Create Vendors — scope/action inferred from naming",
    module: 'suppliers'
  },
  DELETE_SUPPLIER_LOCATIONS: {
    key: 'DELETE_SUPPLIER_LOCATIONS',
    label: "Delete Supplier Locations",
    description: "Remove supplier locations",
    module: 'suppliers'
  },
  DELETE_SUPPLIERS: {
    key: 'DELETE_SUPPLIERS',
    label: "Delete Suppliers",
    description: "Delete suppliers",
    module: 'suppliers'
  },
  DELETE_VENDORS: {
    key: 'DELETE_VENDORS',
    label: "Delete Vendors",
    description: "Delete Vendors — scope/action inferred from naming",
    module: 'suppliers'
  },
  EDIT_SUPPLIER_LOCATIONS: {
    key: 'EDIT_SUPPLIER_LOCATIONS',
    label: "Edit Supplier Locations",
    description: "Modify supplier locations",
    module: 'suppliers'
  },
  EDIT_SUPPLIERS_ALL: {
    key: 'EDIT_SUPPLIERS_ALL',
    label: "Edit All Suppliers",
    description: "Edit any supplier",
    module: 'suppliers'
  },
  EDIT_SUPPLIERS_OWN: {
    key: 'EDIT_SUPPLIERS_OWN',
    label: "Edit Own Suppliers",
    description: "Edit suppliers created by you",
    module: 'suppliers'
  },
  EDIT_VENDORS: {
    key: 'EDIT_VENDORS',
    label: "Edit Vendors",
    description: "Edit Vendors — scope/action inferred from naming",
    module: 'suppliers'
  },
  MANAGE_SUPPLIER_LOCATIONS: {
    key: 'MANAGE_SUPPLIER_LOCATIONS',
    label: "Manage Supplier Locations",
    description: "Manage supplier locations",
    module: 'suppliers'
  },
  MANAGE_SUPPLIERS: {
    key: 'MANAGE_SUPPLIERS',
    label: "Manage Suppliers",
    description: "Create, edit, and delete suppliers",
    module: 'suppliers'
  },
  MANAGE_VENDORS: {
    key: 'MANAGE_VENDORS',
    label: "Manage Vendors",
    description: "Create, edit, and delete vendors",
    module: 'suppliers'
  },
  VIEW_SUPPLIER_CONTRACTS: {
    key: 'VIEW_SUPPLIER_CONTRACTS',
    label: "View Supplier Contracts",
    description: "View supplier contract rates",
    module: 'suppliers'
  },
  VIEW_SUPPLIER_LOCATIONS: {
    key: 'VIEW_SUPPLIER_LOCATIONS',
    label: "View Supplier Locations",
    description: "View supplier addresses",
    module: 'suppliers'
  },
  VIEW_SUPPLIER_TYPES: {
    key: 'VIEW_SUPPLIER_TYPES',
    label: "View Supplier Types",
    description: "View supplier type categories",
    module: 'suppliers'
  },
  VIEW_SUPPLIERS: {
    key: 'VIEW_SUPPLIERS',
    label: "View Suppliers",
    description: "View supplier list and details",
    module: 'suppliers'
  },
  VIEW_SUPPLIERS_ALL: {
    key: 'VIEW_SUPPLIERS_ALL',
    label: "View Suppliers All",
    description: "View Suppliers All — scope/action inferred from naming",
    module: 'suppliers'
  },
  VIEW_SUPPLIERS_OWN: {
    key: 'VIEW_SUPPLIERS_OWN',
    label: "View Suppliers Own",
    description: "View Suppliers Own — scope/action inferred from naming",
    module: 'suppliers'
  },
  VIEW_VENDORS: {
    key: 'VIEW_VENDORS',
    label: "View Vendors",
    description: "View vendor list and details",
    module: 'suppliers'
  },

  // ──────────────────────────── Inventory ────────────────────────────
  ADJUST_STOCK: {
    key: 'ADJUST_STOCK',
    label: "Adjust Stock",
    description: "Adjust Stock — scope/action inferred from naming",
    module: 'inventory'
  },
  CREATE_MATERIAL_COMPOSITIONS: {
    key: 'CREATE_MATERIAL_COMPOSITIONS',
    label: "Create Material Compositions",
    description: "Define new composite materials",
    module: 'inventory'
  },
  CREATE_MATERIALS: {
    key: 'CREATE_MATERIALS',
    label: "Create Materials",
    description: "Create new materials",
    module: 'inventory'
  },
  CREATE_STOCK_REPORTS: {
    key: 'CREATE_STOCK_REPORTS',
    label: "Create Stock Reports",
    description: "Generate stock reports",
    module: 'inventory'
  },
  DELETE_MATERIAL_COMPOSITIONS: {
    key: 'DELETE_MATERIAL_COMPOSITIONS',
    label: "Delete Material Compositions",
    description: "Remove composite material definitions",
    module: 'inventory'
  },
  DELETE_MATERIALS: {
    key: 'DELETE_MATERIALS',
    label: "Delete Materials",
    description: "Delete materials",
    module: 'inventory'
  },
  EDIT_MATERIAL_COMPOSITIONS: {
    key: 'EDIT_MATERIAL_COMPOSITIONS',
    label: "Edit Material Compositions",
    description: "Modify composite material definitions",
    module: 'inventory'
  },
  EDIT_MATERIALS: {
    key: 'EDIT_MATERIALS',
    label: "Edit Materials",
    description: "Edit material details",
    module: 'inventory'
  },
  MANAGE_INVENTORY: {
    key: 'MANAGE_INVENTORY',
    label: "Manage Inventory",
    description: "Full inventory management access",
    module: 'inventory'
  },
  MANAGE_INVENTORY_BATCHES: {
    key: 'MANAGE_INVENTORY_BATCHES',
    label: "Manage Inventory Batches",
    description: "Create and manage inventory batches",
    module: 'inventory'
  },
  MANAGE_MATERIAL_COMPOSITIONS: {
    key: 'MANAGE_MATERIAL_COMPOSITIONS',
    label: "Manage Material Compositions",
    description: "Manage composite materials",
    module: 'inventory'
  },
  MANAGE_MATERIALS: {
    key: 'MANAGE_MATERIALS',
    label: "Manage Materials",
    description: "Full materials management",
    module: 'inventory'
  },
  UPDATE_STOCK: {
    key: 'UPDATE_STOCK',
    label: "Update Stock",
    description: "Adjust inventory quantities",
    module: 'inventory'
  },
  VIEW_BATCHES: {
    key: 'VIEW_BATCHES',
    label: "View Batches",
    description: "View FIFO batch information",
    module: 'inventory'
  },
  VIEW_INVENTORY: {
    key: 'VIEW_INVENTORY',
    label: "View Inventory",
    description: "View inventory levels and materials",
    module: 'inventory'
  },
  VIEW_INVENTORY_BATCHES: {
    key: 'VIEW_INVENTORY_BATCHES',
    label: "View Inventory Batches",
    description: "View inventory batch tracking records",
    module: 'inventory'
  },
  VIEW_MATERIAL_COMPOSITIONS: {
    key: 'VIEW_MATERIAL_COMPOSITIONS',
    label: "View Material Compositions",
    description: "View composite material breakdowns",
    module: 'inventory'
  },
  VIEW_MATERIALS: {
    key: 'VIEW_MATERIALS',
    label: "View Materials",
    description: "View materials list",
    module: 'inventory'
  },
  VIEW_STOCK_MOVEMENTS: {
    key: 'VIEW_STOCK_MOVEMENTS',
    label: "View Stock Movements",
    description: "View stock movement history",
    module: 'inventory'
  },

  // ──────────────────────────── Sales ────────────────────────────
  APPROVE_SALES: {
    key: 'APPROVE_SALES',
    label: "Approve Sales",
    description: "Approve pending sales orders",
    module: 'sales'
  },
  CREATE_SALE: {
    key: 'CREATE_SALE',
    label: "Create Sale",
    description: "Create Sale — backfilled from route enforcement",
    module: 'sales'
  },
  CREATE_SALES: {
    key: 'CREATE_SALES',
    label: "Create Sales",
    description: "Create new sales orders",
    module: 'sales'
  },
  CREATE_SALES_ALL: {
    key: 'CREATE_SALES_ALL',
    label: "Create Sales (Any)",
    description: "Create sales orders for any customer",
    module: 'sales'
  },
  CREATE_SALES_OWN: {
    key: 'CREATE_SALES_OWN',
    label: "Create Sales (Own)",
    description: "Create sales orders (own only)",
    module: 'sales'
  },
  DELETE_SALES: {
    key: 'DELETE_SALES',
    label: "Delete Sales",
    description: "Delete sales orders",
    module: 'sales'
  },
  DELETE_SALES_ALL: {
    key: 'DELETE_SALES_ALL',
    label: "Delete Sales (Any)",
    description: "Delete any sales order",
    module: 'sales'
  },
  DELETE_SALES_OWN: {
    key: 'DELETE_SALES_OWN',
    label: "Delete Sales (Own)",
    description: "Delete own sales orders",
    module: 'sales'
  },
  EDIT_SALES: {
    key: 'EDIT_SALES',
    label: "Edit Sales",
    description: "Modify existing sales orders",
    module: 'sales'
  },
  EDIT_SALES_ALL: {
    key: 'EDIT_SALES_ALL',
    label: "Edit Sales (Any)",
    description: "Edit any sales order",
    module: 'sales'
  },
  EDIT_SALES_OWN: {
    key: 'EDIT_SALES_OWN',
    label: "Edit Sales (Own)",
    description: "Edit own sales orders",
    module: 'sales'
  },
  GENERATE_SALES_INVOICE: {
    key: 'GENERATE_SALES_INVOICE',
    label: "Generate Sales Invoice",
    description: "Generate invoices from sales orders",
    module: 'sales'
  },
  MANAGE_SALES: {
    key: 'MANAGE_SALES',
    label: "Manage Sales",
    description: "Full sales management",
    module: 'sales'
  },
  VIEW_SALES: {
    key: 'VIEW_SALES',
    label: "View Sales",
    description: "View sales orders and history",
    module: 'sales'
  },
  VIEW_SALES_ALL: {
    key: 'VIEW_SALES_ALL',
    label: "View Sales All",
    description: "View Sales All — scope/action inferred from naming",
    module: 'sales'
  },
  VIEW_SALES_OWN: {
    key: 'VIEW_SALES_OWN',
    label: "View Sales Own",
    description: "View Sales Own — scope/action inferred from naming",
    module: 'sales'
  },

  // ──────────────────────────── Purchase ────────────────────────────
  APPROVE_AMENDMENTS: {
    key: 'APPROVE_AMENDMENTS',
    label: "Approve Amendments",
    description: "Approve purchase order amendments",
    module: 'purchase'
  },
  APPROVE_PURCHASE: {
    key: 'APPROVE_PURCHASE',
    label: "Approve Purchase",
    description: "Approve pending purchase orders",
    module: 'purchase'
  },
  APPROVE_PURCHASE_ORDER: {
    key: 'APPROVE_PURCHASE_ORDER',
    label: "Approve Purchase Order",
    description: "Approve pending purchase orders",
    module: 'purchase'
  },
  CREATE_AMENDMENTS: {
    key: 'CREATE_AMENDMENTS',
    label: "Create Amendments",
    description: "Create purchase order amendments",
    module: 'purchase'
  },
  CREATE_PO_EXPENSES: {
    key: 'CREATE_PO_EXPENSES',
    label: "Create PO Expenses",
    description: "Add expenses to purchase orders",
    module: 'purchase'
  },
  CREATE_PURCHASE: {
    key: 'CREATE_PURCHASE',
    label: "Create Purchase",
    description: "Create new purchase records",
    module: 'purchase'
  },
  CREATE_PURCHASE_ALL: {
    key: 'CREATE_PURCHASE_ALL',
    label: "Create Purchase (Any)",
    description: "Create purchase orders for any supplier",
    module: 'purchase'
  },
  CREATE_PURCHASE_EXPENSES: {
    key: 'CREATE_PURCHASE_EXPENSES',
    label: "Create Purchase Expenses",
    description: "Create Purchase Expenses — backfilled from route enforcement",
    module: 'purchase'
  },
  CREATE_PURCHASE_ORDER: {
    key: 'CREATE_PURCHASE_ORDER',
    label: "Create Purchase Order",
    description: "Create new purchase orders",
    module: 'purchase'
  },
  CREATE_PURCHASE_ORDER_ALL: {
    key: 'CREATE_PURCHASE_ORDER_ALL',
    label: "Create Purchase Order All",
    description: "Create Purchase Order All — scope/action inferred from naming",
    module: 'purchase'
  },
  CREATE_PURCHASE_ORDER_OWN: {
    key: 'CREATE_PURCHASE_ORDER_OWN',
    label: "Create Purchase Order Own",
    description: "Create Purchase Order Own — scope/action inferred from naming",
    module: 'purchase'
  },
  CREATE_PURCHASE_OWN: {
    key: 'CREATE_PURCHASE_OWN',
    label: "Create Purchase (Own)",
    description: "Create purchase orders (own only)",
    module: 'purchase'
  },
  DELETE_PO_EXPENSES_ALL: {
    key: 'DELETE_PO_EXPENSES_ALL',
    label: "Delete All PO Expenses",
    description: "Delete any purchase order expense",
    module: 'purchase'
  },
  DELETE_PO_EXPENSES_OWN: {
    key: 'DELETE_PO_EXPENSES_OWN',
    label: "Delete Own PO Expenses",
    description: "Delete only own purchase order expenses",
    module: 'purchase'
  },
  DELETE_PURCHASE: {
    key: 'DELETE_PURCHASE',
    label: "Delete Purchase",
    description: "Delete purchase records",
    module: 'purchase'
  },
  DELETE_PURCHASE_ALL: {
    key: 'DELETE_PURCHASE_ALL',
    label: "Delete Purchase (Any)",
    description: "Delete any purchase order",
    module: 'purchase'
  },
  DELETE_PURCHASE_ORDER: {
    key: 'DELETE_PURCHASE_ORDER',
    label: "Delete Purchase Order",
    description: "Delete purchase orders",
    module: 'purchase'
  },
  DELETE_PURCHASE_ORDER_ALL: {
    key: 'DELETE_PURCHASE_ORDER_ALL',
    label: "Delete Purchase Order All",
    description: "Delete Purchase Order All — scope/action inferred from naming",
    module: 'purchase'
  },
  DELETE_PURCHASE_ORDER_OWN: {
    key: 'DELETE_PURCHASE_ORDER_OWN',
    label: "Delete Purchase Order Own",
    description: "Delete Purchase Order Own — scope/action inferred from naming",
    module: 'purchase'
  },
  DELETE_PURCHASE_OWN: {
    key: 'DELETE_PURCHASE_OWN',
    label: "Delete Purchase (Own)",
    description: "Delete own purchase orders",
    module: 'purchase'
  },
  EDIT_AMENDMENTS_ALL: {
    key: 'EDIT_AMENDMENTS_ALL',
    label: "Edit All Amendments",
    description: "Edit any purchase order amendment",
    module: 'purchase'
  },
  EDIT_AMENDMENTS_OWN: {
    key: 'EDIT_AMENDMENTS_OWN',
    label: "Edit Own Amendments",
    description: "Edit only own purchase order amendments",
    module: 'purchase'
  },
  EDIT_PO_EXPENSES_ALL: {
    key: 'EDIT_PO_EXPENSES_ALL',
    label: "Edit All PO Expenses",
    description: "Edit any purchase order expense",
    module: 'purchase'
  },
  EDIT_PO_EXPENSES_OWN: {
    key: 'EDIT_PO_EXPENSES_OWN',
    label: "Edit Own PO Expenses",
    description: "Edit only own purchase order expenses",
    module: 'purchase'
  },
  EDIT_PURCHASE: {
    key: 'EDIT_PURCHASE',
    label: "Edit Purchase",
    description: "Modify purchase records",
    module: 'purchase'
  },
  EDIT_PURCHASE_ALL: {
    key: 'EDIT_PURCHASE_ALL',
    label: "Edit Purchase (Any)",
    description: "Edit any purchase order",
    module: 'purchase'
  },
  EDIT_PURCHASE_ORDER: {
    key: 'EDIT_PURCHASE_ORDER',
    label: "Edit Purchase Order",
    description: "Modify purchase orders",
    module: 'purchase'
  },
  EDIT_PURCHASE_ORDER_ALL: {
    key: 'EDIT_PURCHASE_ORDER_ALL',
    label: "Edit Purchase Order All",
    description: "Edit Purchase Order All — scope/action inferred from naming",
    module: 'purchase'
  },
  EDIT_PURCHASE_ORDER_OWN: {
    key: 'EDIT_PURCHASE_ORDER_OWN',
    label: "Edit Purchase Order Own",
    description: "Edit Purchase Order Own — scope/action inferred from naming",
    module: 'purchase'
  },
  EDIT_PURCHASE_OWN: {
    key: 'EDIT_PURCHASE_OWN',
    label: "Edit Purchase (Own)",
    description: "Edit own purchase orders",
    module: 'purchase'
  },
  MANAGE_PURCHASE: {
    key: 'MANAGE_PURCHASE',
    label: "Manage Purchase",
    description: "Full purchase management",
    module: 'purchase'
  },
  MANAGE_PURCHASE_AMENDMENTS: {
    key: 'MANAGE_PURCHASE_AMENDMENTS',
    label: "Manage Purchase Amendments",
    description: "Create and manage purchase order amendments",
    module: 'purchase'
  },
  MANAGE_PURCHASE_ORDERS: {
    key: 'MANAGE_PURCHASE_ORDERS',
    label: "Manage Purchase Orders",
    description: "Manage Purchase Orders — scope/action inferred from naming",
    module: 'purchase'
  },
  RECEIVE_PURCHASE: {
    key: 'RECEIVE_PURCHASE',
    label: "Receive Purchase",
    description: "Receive goods and update inventory",
    module: 'purchase'
  },
  VIEW_AMENDMENTS_ALL: {
    key: 'VIEW_AMENDMENTS_ALL',
    label: "View All Amendments",
    description: "View all purchase order amendments",
    module: 'purchase'
  },
  VIEW_AMENDMENTS_OWN: {
    key: 'VIEW_AMENDMENTS_OWN',
    label: "View Own Amendments",
    description: "View only own purchase order amendments",
    module: 'purchase'
  },
  VIEW_PO_EXPENSES_ALL: {
    key: 'VIEW_PO_EXPENSES_ALL',
    label: "View All PO Expenses",
    description: "View all purchase order expenses",
    module: 'purchase'
  },
  VIEW_PO_EXPENSES_OWN: {
    key: 'VIEW_PO_EXPENSES_OWN',
    label: "View Own PO Expenses",
    description: "View only own purchase order expenses",
    module: 'purchase'
  },
  VIEW_PURCHASE: {
    key: 'VIEW_PURCHASE',
    label: "View Purchase",
    description: "View purchase records",
    module: 'purchase'
  },
  VIEW_PURCHASE_ALL: {
    key: 'VIEW_PURCHASE_ALL',
    label: "View Purchase All",
    description: "View Purchase All — scope/action inferred from naming",
    module: 'purchase'
  },
  VIEW_PURCHASE_EXPENSES_ALL: {
    key: 'VIEW_PURCHASE_EXPENSES_ALL',
    label: "View Purchase Expenses All",
    description: "View Purchase Expenses All — backfilled from route enforcement",
    module: 'purchase'
  },
  VIEW_PURCHASE_ORDER: {
    key: 'VIEW_PURCHASE_ORDER',
    label: "View Purchase Orders",
    description: "View purchase order details",
    module: 'purchase'
  },
  VIEW_PURCHASE_OWN: {
    key: 'VIEW_PURCHASE_OWN',
    label: "View Purchase Own",
    description: "View Purchase Own — scope/action inferred from naming",
    module: 'purchase'
  },
  VIEW_UNBILLED_PURCHASES: {
    key: 'VIEW_UNBILLED_PURCHASES',
    label: "View Unbilled Purchases",
    description: "View unbilled purchase orders",
    module: 'purchase'
  },

  // ──────────────────────────── Contracts ────────────────────────────
  APPROVE_CONTRACTS: {
    key: 'APPROVE_CONTRACTS',
    label: "Approve Contracts",
    description: "Approve pending contracts",
    module: 'contracts'
  },
  CREATE_CONTRACT: {
    key: 'CREATE_CONTRACT',
    label: "Create Contract",
    description: "Create Contract — backfilled from route enforcement",
    module: 'contracts'
  },
  CREATE_CONTRACT_LOCATIONS: {
    key: 'CREATE_CONTRACT_LOCATIONS',
    label: "Create Contract Locations",
    description: "Add new contract locations",
    module: 'contracts'
  },
  CREATE_CONTRACTS: {
    key: 'CREATE_CONTRACTS',
    label: "Create Contracts",
    description: "Create new contracts",
    module: 'contracts'
  },
  CREATE_CONTRACTS_ALL: {
    key: 'CREATE_CONTRACTS_ALL',
    label: "Create Contracts All",
    description: "Create Contracts All — scope/action inferred from naming",
    module: 'contracts'
  },
  CREATE_CONTRACTS_OWN: {
    key: 'CREATE_CONTRACTS_OWN',
    label: "Create Contracts Own",
    description: "Create Contracts Own — scope/action inferred from naming",
    module: 'contracts'
  },
  DELETE_CONTRACTS: {
    key: 'DELETE_CONTRACTS',
    label: "Delete Contracts",
    description: "Delete contracts",
    module: 'contracts'
  },
  EDIT_CONTRACT_LOCATIONS: {
    key: 'EDIT_CONTRACT_LOCATIONS',
    label: "Edit Contract Locations",
    description: "Modify contract locations",
    module: 'contracts'
  },
  EDIT_CONTRACTS_ALL: {
    key: 'EDIT_CONTRACTS_ALL',
    label: "Edit Contracts (Any)",
    description: "Edit any contract",
    module: 'contracts'
  },
  EDIT_CONTRACTS_OWN: {
    key: 'EDIT_CONTRACTS_OWN',
    label: "Edit Contracts (Own)",
    description: "Edit own contracts",
    module: 'contracts'
  },
  MANAGE_CONTRACT_LOCATION_RATES: {
    key: 'MANAGE_CONTRACT_LOCATION_RATES',
    label: "Manage Contract Location Rates",
    description: "Update material rates for contract locations",
    module: 'contracts'
  },
  MANAGE_CONTRACT_LOCATIONS: {
    key: 'MANAGE_CONTRACT_LOCATIONS',
    label: "Manage Contract Locations",
    description: "Manage contract locations",
    module: 'contracts'
  },
  MANAGE_CONTRACT_RATES: {
    key: 'MANAGE_CONTRACT_RATES',
    label: "Manage Contract Rates",
    description: "Manage contract material rates",
    module: 'contracts'
  },
  MANAGE_CONTRACTS: {
    key: 'MANAGE_CONTRACTS',
    label: "Manage Contracts",
    description: "Create, edit, and delete contracts",
    module: 'contracts'
  },
  VIEW_CONTRACT_LOCATION_RATES: {
    key: 'VIEW_CONTRACT_LOCATION_RATES',
    label: "View Contract Location Rates",
    description: "View material rates for contract locations",
    module: 'contracts'
  },
  VIEW_CONTRACT_LOCATIONS: {
    key: 'VIEW_CONTRACT_LOCATIONS',
    label: "View Contract Locations",
    description: "View contract collection locations",
    module: 'contracts'
  },
  VIEW_CONTRACTS: {
    key: 'VIEW_CONTRACTS',
    label: "View Contracts",
    description: "View contract details",
    module: 'contracts'
  },
  VIEW_CONTRACTS_ALL: {
    key: 'VIEW_CONTRACTS_ALL',
    label: "View Contracts All",
    description: "View Contracts All — scope/action inferred from naming",
    module: 'contracts'
  },
  VIEW_CONTRACTS_OWN: {
    key: 'VIEW_CONTRACTS_OWN',
    label: "View Contracts Own",
    description: "View Contracts Own — scope/action inferred from naming",
    module: 'contracts'
  },

  // ──────────────────────────── Collections ────────────────────────────
  APPROVE_COLLECTIONS: {
    key: 'APPROVE_COLLECTIONS',
    label: "Approve Collections",
    description: "Approve and finalize collections",
    module: 'collections'
  },
  CREATE_CALLOUTS: {
    key: 'CREATE_CALLOUTS',
    label: "Create Callouts",
    description: "Create collection callouts",
    module: 'collections'
  },
  CREATE_COLLECTIONS: {
    key: 'CREATE_COLLECTIONS',
    label: "Create Collections",
    description: "Create collection orders and callouts",
    module: 'collections'
  },
  CREATE_COLLECTIONS_ALL: {
    key: 'CREATE_COLLECTIONS_ALL',
    label: "Create Collections All",
    description: "Create Collections All — scope/action inferred from naming",
    module: 'collections'
  },
  CREATE_COLLECTIONS_OWN: {
    key: 'CREATE_COLLECTIONS_OWN',
    label: "Create Collections Own",
    description: "Create Collections Own — scope/action inferred from naming",
    module: 'collections'
  },
  DELETE_COLLECTIONS: {
    key: 'DELETE_COLLECTIONS',
    label: "Delete Collections",
    description: "Delete collection orders",
    module: 'collections'
  },
  DELETE_COLLECTIONS_ALL: {
    key: 'DELETE_COLLECTIONS_ALL',
    label: "Delete Collections All",
    description: "Delete Collections All — scope/action inferred from naming",
    module: 'collections'
  },
  DELETE_COLLECTIONS_OWN: {
    key: 'DELETE_COLLECTIONS_OWN',
    label: "Delete Collections Own",
    description: "Delete Collections Own — scope/action inferred from naming",
    module: 'collections'
  },
  EDIT_CALLOUTS_ALL: {
    key: 'EDIT_CALLOUTS_ALL',
    label: "Edit Callouts All",
    description: "Edit Callouts All — scope/action inferred from naming",
    module: 'collections'
  },
  EDIT_CALLOUTS_OWN: {
    key: 'EDIT_CALLOUTS_OWN',
    label: "Edit Callouts Own",
    description: "Edit Callouts Own — scope/action inferred from naming",
    module: 'collections'
  },
  EDIT_COLLECTIONS: {
    key: 'EDIT_COLLECTIONS',
    label: "Edit Collections",
    description: "Modify collection orders",
    module: 'collections'
  },
  EDIT_COLLECTIONS_ALL: {
    key: 'EDIT_COLLECTIONS_ALL',
    label: "Edit Collections (Any)",
    description: "Edit any collection order",
    module: 'collections'
  },
  EDIT_COLLECTIONS_OWN: {
    key: 'EDIT_COLLECTIONS_OWN',
    label: "Edit Collections (Own)",
    description: "Edit own collection orders",
    module: 'collections'
  },
  FINALIZE_WCN: {
    key: 'FINALIZE_WCN',
    label: "Finalize WCN",
    description: "Finalize waste consignment notes",
    module: 'collections'
  },
  MANAGE_COLLECTIONS: {
    key: 'MANAGE_COLLECTIONS',
    label: "Manage Collections",
    description: "Full collections management",
    module: 'collections'
  },
  VIEW_CALLOUTS_ALL: {
    key: 'VIEW_CALLOUTS_ALL',
    label: "View Callouts All",
    description: "View Callouts All — scope/action inferred from naming",
    module: 'collections'
  },
  VIEW_CALLOUTS_OWN: {
    key: 'VIEW_CALLOUTS_OWN',
    label: "View Callouts Own",
    description: "View Callouts Own — scope/action inferred from naming",
    module: 'collections'
  },
  VIEW_COLLECTIONS: {
    key: 'VIEW_COLLECTIONS',
    label: "View Collections",
    description: "View collection orders and callouts",
    module: 'collections'
  },
  VIEW_COLLECTIONS_ALL: {
    key: 'VIEW_COLLECTIONS_ALL',
    label: "View Collections All",
    description: "View Collections All — scope/action inferred from naming",
    module: 'collections'
  },
  VIEW_COLLECTIONS_OWN: {
    key: 'VIEW_COLLECTIONS_OWN',
    label: "View Collections Own",
    description: "View Collections Own — scope/action inferred from naming",
    module: 'collections'
  },

  // ──────────────────────────── Finance ────────────────────────────
  APPROVE_EXPENSE_ALL: {
    key: 'APPROVE_EXPENSE_ALL',
    label: "Approve Expense (Any)",
    description: "Approve any expense",
    module: 'finance'
  },
  APPROVE_EXPENSE_OWN: {
    key: 'APPROVE_EXPENSE_OWN',
    label: "Approve Expense (Own)",
    description: "Approve own expenses (self-approval)",
    module: 'finance'
  },
  APPROVE_EXPENSES: {
    key: 'APPROVE_EXPENSES',
    label: "Approve Expenses",
    description: "Approve pending expenses",
    module: 'finance'
  },
  CONFIGURE_VAT: {
    key: 'CONFIGURE_VAT',
    label: "Configure VAT",
    description: "Configure VAT rates",
    module: 'finance'
  },
  CREATE_BANK_ACCOUNTS: {
    key: 'CREATE_BANK_ACCOUNTS',
    label: "Create Bank Accounts",
    description: "Add new bank accounts",
    module: 'finance'
  },
  CREATE_EXPENSE_ALL: {
    key: 'CREATE_EXPENSE_ALL',
    label: "Create Expense (Any)",
    description: "Create expenses for any user",
    module: 'finance'
  },
  CREATE_EXPENSE_OWN: {
    key: 'CREATE_EXPENSE_OWN',
    label: "Create Expense (Own)",
    description: "Create own expenses",
    module: 'finance'
  },
  DELETE_BANK_ACCOUNTS: {
    key: 'DELETE_BANK_ACCOUNTS',
    label: "Delete Bank Accounts",
    description: "Remove bank accounts",
    module: 'finance'
  },
  DELETE_EXPENSE_ALL: {
    key: 'DELETE_EXPENSE_ALL',
    label: "Delete Expense (Any)",
    description: "Delete any expense",
    module: 'finance'
  },
  DELETE_EXPENSE_OWN: {
    key: 'DELETE_EXPENSE_OWN',
    label: "Delete Expense (Own)",
    description: "Delete own expenses",
    module: 'finance'
  },
  EDIT_BANK_ACCOUNTS: {
    key: 'EDIT_BANK_ACCOUNTS',
    label: "Edit Bank Accounts",
    description: "Modify bank account details",
    module: 'finance'
  },
  EDIT_EXPENSE_ALL: {
    key: 'EDIT_EXPENSE_ALL',
    label: "Edit Expense (Any)",
    description: "Edit any expense",
    module: 'finance'
  },
  EDIT_EXPENSE_OWN: {
    key: 'EDIT_EXPENSE_OWN',
    label: "Edit Expense (Own)",
    description: "Edit own expenses",
    module: 'finance'
  },
  MANAGE_EXPENSE_CATEGORIES: {
    key: 'MANAGE_EXPENSE_CATEGORIES',
    label: "Manage Expense Categories",
    description: "Create, edit, and manage expense categories",
    module: 'finance'
  },
  MANAGE_EXPENSES: {
    key: 'MANAGE_EXPENSES',
    label: "Manage Expenses",
    description: "Record and manage expenses",
    module: 'finance'
  },
  MANAGE_EXPENSES_ALL: {
    key: 'MANAGE_EXPENSES_ALL',
    label: "Manage All Expenses",
    description: "Full expense management",
    module: 'finance'
  },
  MANAGE_FINANCIALS: {
    key: 'MANAGE_FINANCIALS',
    label: "Manage Financials",
    description: "Full financial management",
    module: 'finance'
  },
  VIEW_BALANCE_SHEET: {
    key: 'VIEW_BALANCE_SHEET',
    label: "View Balance Sheet",
    description: "View balance sheet",
    module: 'finance'
  },
  VIEW_BANK_ACCOUNTS: {
    key: 'VIEW_BANK_ACCOUNTS',
    label: "View Bank Accounts",
    description: "View company bank accounts",
    module: 'finance'
  },
  VIEW_CASH_FLOW: {
    key: 'VIEW_CASH_FLOW',
    label: "View Cash Flow",
    description: "View cash flow statements",
    module: 'finance'
  },
  VIEW_EXPENSE_CATEGORIES: {
    key: 'VIEW_EXPENSE_CATEGORIES',
    label: "View Expense Categories",
    description: "View expense category list",
    module: 'finance'
  },
  VIEW_EXPENSES: {
    key: 'VIEW_EXPENSES',
    label: "View Expenses",
    description: "View all expense records and categories",
    module: 'finance'
  },
  VIEW_FINANCIALS: {
    key: 'VIEW_FINANCIALS',
    label: "View Financials",
    description: "View financial summaries",
    module: 'finance'
  },
  VIEW_PROFIT_LOSS: {
    key: 'VIEW_PROFIT_LOSS',
    label: "View Profit/Loss",
    description: "View profit and loss reports",
    module: 'finance'
  },

  // ──────────────────────────── Petty Cash ────────────────────────────
  ACTIVATE_CARD: {
    key: 'ACTIVATE_CARD',
    label: "Activate Card",
    description: "Activate petty cash cards",
    module: 'petty_cash'
  },
  APPROVE_EXPENSE: {
    key: 'APPROVE_EXPENSE',
    label: "Approve Expense",
    description: "Approve petty cash expenses",
    module: 'petty_cash'
  },
  APPROVE_PETTY_CASH_EXPENSE: {
    key: 'APPROVE_PETTY_CASH_EXPENSE',
    label: "Approve Petty Cash Expense",
    description: "Approve petty cash expenses",
    module: 'petty_cash'
  },
  ASSIGN_PETTY_CASH_CARD: {
    key: 'ASSIGN_PETTY_CASH_CARD',
    label: "Assign Petty Cash Card",
    description: "Assign cards to users",
    module: 'petty_cash'
  },
  CREATE_CARDS: {
    key: 'CREATE_CARDS',
    label: "Create Cards",
    description: "Create Cards — backfilled from route enforcement",
    module: 'petty_cash'
  },
  CREATE_EXPENSE: {
    key: 'CREATE_EXPENSE',
    label: "Create Expense",
    description: "Submit petty cash expenses",
    module: 'petty_cash'
  },
  CREATE_PETTY_CASH_CARD: {
    key: 'CREATE_PETTY_CASH_CARD',
    label: "Create Petty Cash Card",
    description: "Create new petty cash cards",
    module: 'petty_cash'
  },
  CREATE_PETTY_CASH_EXPENSE_ALL: {
    key: 'CREATE_PETTY_CASH_EXPENSE_ALL',
    label: "Create Petty Cash Expense (Any)",
    description: "Create expense for any user",
    module: 'petty_cash'
  },
  CREATE_PETTY_CASH_EXPENSE_OWN: {
    key: 'CREATE_PETTY_CASH_EXPENSE_OWN',
    label: "Create Petty Cash Expense (Own)",
    description: "Create own petty cash expense",
    module: 'petty_cash'
  },
  CREATE_PETTY_CASH_USER: {
    key: 'CREATE_PETTY_CASH_USER',
    label: "Create Petty Cash User",
    description: "Register new petty cash users",
    module: 'petty_cash'
  },
  DELETE_PETTY_CASH_CARD: {
    key: 'DELETE_PETTY_CASH_CARD',
    label: "Delete Petty Cash Card",
    description: "Delete petty cash cards",
    module: 'petty_cash'
  },
  DELETE_PETTY_CASH_EXPENSE_ALL: {
    key: 'DELETE_PETTY_CASH_EXPENSE_ALL',
    label: "Delete Petty Cash Expense (Any)",
    description: "Delete any petty cash expense",
    module: 'petty_cash'
  },
  DELETE_PETTY_CASH_EXPENSE_OWN: {
    key: 'DELETE_PETTY_CASH_EXPENSE_OWN',
    label: "Delete Petty Cash Expense (Own)",
    description: "Delete own petty cash expense",
    module: 'petty_cash'
  },
  DELETE_PETTY_CASH_USER: {
    key: 'DELETE_PETTY_CASH_USER',
    label: "Delete Petty Cash User",
    description: "Delete petty cash users",
    module: 'petty_cash'
  },
  EDIT_PETTY_CASH_CARD: {
    key: 'EDIT_PETTY_CASH_CARD',
    label: "Edit Petty Cash Card",
    description: "Edit card details",
    module: 'petty_cash'
  },
  EDIT_PETTY_CASH_EXPENSE_ALL: {
    key: 'EDIT_PETTY_CASH_EXPENSE_ALL',
    label: "Edit Petty Cash Expense (Any)",
    description: "Edit any petty cash expense",
    module: 'petty_cash'
  },
  EDIT_PETTY_CASH_EXPENSE_OWN: {
    key: 'EDIT_PETTY_CASH_EXPENSE_OWN',
    label: "Edit Petty Cash Expense (Own)",
    description: "Edit own petty cash expense",
    module: 'petty_cash'
  },
  EDIT_PETTY_CASH_USER_ALL: {
    key: 'EDIT_PETTY_CASH_USER_ALL',
    label: "Edit Petty Cash User (Any)",
    description: "Edit any petty cash user",
    module: 'petty_cash'
  },
  EDIT_PETTY_CASH_USER_OWN: {
    key: 'EDIT_PETTY_CASH_USER_OWN',
    label: "Edit Petty Cash User (Own)",
    description: "Edit own petty cash user profile",
    module: 'petty_cash'
  },
  MANAGE_PETTY_CASH: {
    key: 'MANAGE_PETTY_CASH',
    label: "Manage Petty Cash",
    description: "Full petty cash management - cards, expenses, and funds",
    module: 'petty_cash'
  },
  MANAGE_PETTY_CASH_CARDS: {
    key: 'MANAGE_PETTY_CASH_CARDS',
    label: "Manage Petty Cash Cards",
    description: "Full card management",
    module: 'petty_cash'
  },
  MANAGE_PETTY_CASH_USERS: {
    key: 'MANAGE_PETTY_CASH_USERS',
    label: "Manage Petty Cash Users",
    description: "Full petty cash user management",
    module: 'petty_cash'
  },
  RELOAD_CARD: {
    key: 'RELOAD_CARD',
    label: "Reload Card",
    description: "Add funds to petty cash cards",
    module: 'petty_cash'
  },
  SUSPEND_CARD: {
    key: 'SUSPEND_CARD',
    label: "Suspend Card",
    description: "Suspend petty cash cards",
    module: 'petty_cash'
  },
  VIEW_CARDS_ALL: {
    key: 'VIEW_CARDS_ALL',
    label: "View Cards All",
    description: "View Cards All — scope/action inferred from naming",
    module: 'petty_cash'
  },
  VIEW_CARDS_ASSIGNED: {
    key: 'VIEW_CARDS_ASSIGNED',
    label: "View Cards Assigned",
    description: "View Cards Assigned — scope/action inferred from naming",
    module: 'petty_cash'
  },
  VIEW_EXPENSE_REPORTS: {
    key: 'VIEW_EXPENSE_REPORTS',
    label: "View Expense Reports",
    description: "View detailed expense reports",
    module: 'petty_cash'
  },
  VIEW_PETTY_CASH: {
    key: 'VIEW_PETTY_CASH',
    label: "View Petty Cash",
    description: "View petty cash cards and expenses",
    module: 'petty_cash'
  },
  VIEW_PETTY_CASH_EXPENSE_ALL: {
    key: 'VIEW_PETTY_CASH_EXPENSE_ALL',
    label: "View Petty Cash Expense All",
    description: "View Petty Cash Expense All — scope/action inferred from naming",
    module: 'petty_cash'
  },
  VIEW_PETTY_CASH_EXPENSE_OWN: {
    key: 'VIEW_PETTY_CASH_EXPENSE_OWN',
    label: "View Petty Cash Expense Own",
    description: "View Petty Cash Expense Own — scope/action inferred from naming",
    module: 'petty_cash'
  },

  // ──────────────────────────── Invoices ────────────────────────────
  CREATE_INVOICES: {
    key: 'CREATE_INVOICES',
    label: "Create Invoices",
    description: "Generate new invoices",
    module: 'invoices'
  },
  CREATE_INVOICES_ALL: {
    key: 'CREATE_INVOICES_ALL',
    label: "Create Invoices (Any)",
    description: "Create invoices for any order",
    module: 'invoices'
  },
  CREATE_INVOICES_OWN: {
    key: 'CREATE_INVOICES_OWN',
    label: "Create Invoices (Own)",
    description: "Create invoices for own orders",
    module: 'invoices'
  },
  DELETE_INVOICES: {
    key: 'DELETE_INVOICES',
    label: "Delete Invoices",
    description: "Delete invoices",
    module: 'invoices'
  },
  EDIT_INVOICES: {
    key: 'EDIT_INVOICES',
    label: "Edit Invoices",
    description: "Modify existing invoices",
    module: 'invoices'
  },
  EDIT_INVOICES_ALL: {
    key: 'EDIT_INVOICES_ALL',
    label: "Edit Invoices (Any)",
    description: "Edit any invoice",
    module: 'invoices'
  },
  EDIT_INVOICES_OWN: {
    key: 'EDIT_INVOICES_OWN',
    label: "Edit Invoices (Own)",
    description: "Edit own invoices",
    module: 'invoices'
  },
  MANAGE_INVOICES: {
    key: 'MANAGE_INVOICES',
    label: "Manage Invoices",
    description: "Full invoice management",
    module: 'invoices'
  },
  MANAGE_INVOICES_ALL: {
    key: 'MANAGE_INVOICES_ALL',
    label: "Manage Invoices All",
    description: "Manage Invoices All — backfilled from route enforcement",
    module: 'invoices'
  },
  RECORD_PAYMENT: {
    key: 'RECORD_PAYMENT',
    label: "Record Payment",
    description: "Record invoice payments",
    module: 'invoices'
  },
  SEND_INVOICES: {
    key: 'SEND_INVOICES',
    label: "Send Invoices",
    description: "Send invoices to customers",
    module: 'invoices'
  },
  VIEW_INVOICES: {
    key: 'VIEW_INVOICES',
    label: "View Invoices",
    description: "View invoice details",
    module: 'invoices'
  },
  VIEW_INVOICES_ALL: {
    key: 'VIEW_INVOICES_ALL',
    label: "View Invoices All",
    description: "View Invoices All — backfilled from route enforcement",
    module: 'invoices'
  },

  // ──────────────────────────── Wastage ────────────────────────────
  APPROVE_WASTAGE: {
    key: 'APPROVE_WASTAGE',
    label: "Approve Wastage",
    description: "Approve wastage for inventory adjustment",
    module: 'wastage'
  },
  CREATE_WASTAGE: {
    key: 'CREATE_WASTAGE',
    label: "Create Wastage",
    description: "Record wastage incidents",
    module: 'wastage'
  },
  CREATE_WASTAGE_ALL: {
    key: 'CREATE_WASTAGE_ALL',
    label: "Create Wastage (Any)",
    description: "Create wastage records for any material",
    module: 'wastage'
  },
  CREATE_WASTAGE_OWN: {
    key: 'CREATE_WASTAGE_OWN',
    label: "Create Wastage (Own)",
    description: "Create own wastage records",
    module: 'wastage'
  },
  DELETE_WASTAGE: {
    key: 'DELETE_WASTAGE',
    label: "Delete Wastage",
    description: "Delete wastage records",
    module: 'wastage'
  },
  DELETE_WASTAGE_ALL: {
    key: 'DELETE_WASTAGE_ALL',
    label: "Delete Wastage (Any)",
    description: "Delete any wastage record",
    module: 'wastage'
  },
  DELETE_WASTAGE_OWN: {
    key: 'DELETE_WASTAGE_OWN',
    label: "Delete Wastage (Own)",
    description: "Delete own wastage records",
    module: 'wastage'
  },
  EDIT_WASTAGE: {
    key: 'EDIT_WASTAGE',
    label: "Edit Wastage",
    description: "Modify wastage records",
    module: 'wastage'
  },
  EDIT_WASTAGE_ALL: {
    key: 'EDIT_WASTAGE_ALL',
    label: "Edit Wastage (Any)",
    description: "Edit any wastage record",
    module: 'wastage'
  },
  EDIT_WASTAGE_OWN: {
    key: 'EDIT_WASTAGE_OWN',
    label: "Edit Wastage (Own)",
    description: "Edit own wastage records",
    module: 'wastage'
  },
  MANAGE_WASTAGE: {
    key: 'MANAGE_WASTAGE',
    label: "Manage Wastage",
    description: "Full wastage management",
    module: 'wastage'
  },
  VIEW_WASTAGE: {
    key: 'VIEW_WASTAGE',
    label: "View Wastage",
    description: "View wastage records",
    module: 'wastage'
  },
  VIEW_WASTAGE_ALL: {
    key: 'VIEW_WASTAGE_ALL',
    label: "View Wastage All",
    description: "View Wastage All — scope/action inferred from naming",
    module: 'wastage'
  },
  VIEW_WASTAGE_OWN: {
    key: 'VIEW_WASTAGE_OWN',
    label: "View Wastage Own",
    description: "View Wastage Own — scope/action inferred from naming",
    module: 'wastage'
  },

  // ──────────────────────────── Reports ────────────────────────────
  CREATE_CUSTOM_REPORTS: {
    key: 'CREATE_CUSTOM_REPORTS',
    label: "Create Custom Reports",
    description: "Build custom report templates",
    module: 'reports'
  },
  EXPORT_REPORTS: {
    key: 'EXPORT_REPORTS',
    label: "Export Reports",
    description: "Export reports to PDF/Excel",
    module: 'reports'
  },
  MANAGE_REPORTS: {
    key: 'MANAGE_REPORTS',
    label: "Manage Reports",
    description: "Full reporting access",
    module: 'reports'
  },
  VIEW_ANALYTICS_DASHBOARD: {
    key: 'VIEW_ANALYTICS_DASHBOARD',
    label: "View Analytics Dashboard",
    description: "View analytics and KPIs",
    module: 'reports'
  },
  VIEW_REPORTS: {
    key: 'VIEW_REPORTS',
    label: "View Reports",
    description: "Access standard reports",
    module: 'reports'
  },
  VIEW_WCNS: {
    key: 'VIEW_WCNS',
    label: "View WCNs",
    description: "View WCN register report",
    module: 'reports'
  },

  // ──────────────────────────── System ────────────────────────────
  CONFIGURE_SECURITY: {
    key: 'CONFIGURE_SECURITY',
    label: "Configure Security",
    description: "Configure security settings (MFA, session timeout)",
    module: 'system'
  },
  EDIT_SETTINGS: {
    key: 'EDIT_SETTINGS',
    label: "Edit Settings",
    description: "Modify system settings",
    module: 'system'
  },
  MANAGE_BACKUPS: {
    key: 'MANAGE_BACKUPS',
    label: "Manage Backups",
    description: "Create, restore, and manage database backups",
    module: 'system'
  },
  MANAGE_BRANCHES: {
    key: 'MANAGE_BRANCHES',
    label: "Manage Branches",
    description: "Create and manage branches",
    module: 'system'
  },
  MANAGE_SETTINGS: {
    key: 'MANAGE_SETTINGS',
    label: "Manage Settings",
    description: "Configure system settings",
    module: 'system'
  },
  VIEW_AUDIT_LOGS: {
    key: 'VIEW_AUDIT_LOGS',
    label: "View Audit Logs",
    description: "Access system audit trail",
    module: 'system'
  },
  VIEW_BRANCHES: {
    key: 'VIEW_BRANCHES',
    label: "View Branches",
    description: "View company branches",
    module: 'system'
  },
  VIEW_DASHBOARD: {
    key: 'VIEW_DASHBOARD',
    label: "View Dashboard",
    description: "Access dashboard and workflow status",
    module: 'system'
  },
  VIEW_EXPENSE_ALL: {
    key: 'VIEW_EXPENSE_ALL',
    label: "View Expense All",
    description: "View Expense All — backfilled from route enforcement",
    module: 'system'
  },
  VIEW_MATERIALS_ALL: {
    key: 'VIEW_MATERIALS_ALL',
    label: "View Materials All",
    description: "View Materials All — backfilled from route enforcement",
    module: 'system'
  },
  VIEW_PO_EXPENSES: {
    key: 'VIEW_PO_EXPENSES',
    label: "View Po Expenses",
    description: "View Po Expenses — backfilled from route enforcement",
    module: 'system'
  },
  VIEW_SETTINGS: {
    key: 'VIEW_SETTINGS',
    label: "View Settings",
    description: "View system settings",
    module: 'system'
  },
  VIEW_TRANSACTIONS_ALL: {
    key: 'VIEW_TRANSACTIONS_ALL',
    label: "View Transactions All",
    description: "View Transactions All — backfilled from route enforcement",
    module: 'system'
  },

  // ──────────────────────────── Projects ────────────────────────────
  ASSIGN_PROJECT_USERS: {
    key: 'ASSIGN_PROJECT_USERS',
    label: "Assign Project Users",
    description: "Assign users to projects",
    module: 'projects'
  },
  CREATE_PROJECTS: {
    key: 'CREATE_PROJECTS',
    label: "Create Projects",
    description: "Create new projects",
    module: 'projects'
  },
  DELETE_PROJECTS: {
    key: 'DELETE_PROJECTS',
    label: "Delete Projects",
    description: "Delete projects",
    module: 'projects'
  },
  EDIT_PROJECTS: {
    key: 'EDIT_PROJECTS',
    label: "Edit Projects",
    description: "Edit project details",
    module: 'projects'
  },
  MANAGE_PROJECT_ATTACHMENTS: {
    key: 'MANAGE_PROJECT_ATTACHMENTS',
    label: "Manage Project Attachments",
    description: "Upload/delete project files",
    module: 'projects'
  },
  MANAGE_PROJECTS: {
    key: 'MANAGE_PROJECTS',
    label: "Manage Projects",
    description: "Create, edit, and manage projects",
    module: 'projects'
  },
  VIEW_PROJECT_ATTACHMENTS: {
    key: 'VIEW_PROJECT_ATTACHMENTS',
    label: "View Project Attachments",
    description: "View project files",
    module: 'projects'
  },
  VIEW_PROJECTS: {
    key: 'VIEW_PROJECTS',
    label: "View Projects",
    description: "View project list and details",
    module: 'projects'
  },

  // ──────────────────────────── Employees ────────────────────────────
  CREATE_EMPLOYEES: {
    key: 'CREATE_EMPLOYEES',
    label: "Create Employees",
    description: "Create Employees — scope/action inferred from naming",
    module: 'employees'
  },
  DELETE_EMPLOYEES: {
    key: 'DELETE_EMPLOYEES',
    label: "Delete Employees",
    description: "Deactivate employee records",
    module: 'employees'
  },
  EDIT_EMPLOYEES: {
    key: 'EDIT_EMPLOYEES',
    label: "Edit Employees",
    description: "Edit Employees — scope/action inferred from naming",
    module: 'employees'
  },
  MANAGE_EMPLOYEE_DOCUMENTS: {
    key: 'MANAGE_EMPLOYEE_DOCUMENTS',
    label: "Manage Employee Documents",
    description: "Manage Employee Documents — scope/action inferred from naming",
    module: 'employees'
  },
  MANAGE_EMPLOYEE_LOCATIONS: {
    key: 'MANAGE_EMPLOYEE_LOCATIONS',
    label: "Manage Employee Locations",
    description: "Manage Employee Locations — scope/action inferred from naming",
    module: 'employees'
  },
  MANAGE_EMPLOYEES: {
    key: 'MANAGE_EMPLOYEES',
    label: "Manage Employees",
    description: "Create, edit employees and manage documents/assignments",
    module: 'employees'
  },
  VIEW_EMPLOYEES: {
    key: 'VIEW_EMPLOYEES',
    label: "View Employees",
    description: "View employee records and details",
    module: 'employees'
  },

  // ──────────────────────────── Vehicles ────────────────────────────
  CREATE_VEHICLES: {
    key: 'CREATE_VEHICLES',
    label: "Create Vehicles",
    description: "Create Vehicles — scope/action inferred from naming",
    module: 'vehicles'
  },
  EDIT_VEHICLES: {
    key: 'EDIT_VEHICLES',
    label: "Edit Vehicles",
    description: "Edit Vehicles — scope/action inferred from naming",
    module: 'vehicles'
  },
  MANAGE_VEHICLE_DOCUMENTS: {
    key: 'MANAGE_VEHICLE_DOCUMENTS',
    label: "Manage Vehicle Documents",
    description: "Manage Vehicle Documents — scope/action inferred from naming",
    module: 'vehicles'
  },
  MANAGE_VEHICLE_TYPES: {
    key: 'MANAGE_VEHICLE_TYPES',
    label: "Manage Vehicle Types",
    description: "Manage vehicle type lookup table",
    module: 'vehicles'
  },
  MANAGE_VEHICLES: {
    key: 'MANAGE_VEHICLES',
    label: "Manage Vehicles",
    description: "Create, edit vehicles and manage documents",
    module: 'vehicles'
  },
  VIEW_VEHICLES: {
    key: 'VIEW_VEHICLES',
    label: "View Vehicles",
    description: "View vehicle fleet and details",
    module: 'vehicles'
  },

  // ──────────────────────────── Tank Logs ────────────────────────────
  CREATE_TANK_LOGS: {
    key: 'CREATE_TANK_LOGS',
    label: "Create Tank Logs",
    description: "Create Tank Logs — scope/action inferred from naming",
    module: 'tank_logs'
  },
  EDIT_TANK_LOGS: {
    key: 'EDIT_TANK_LOGS',
    label: "Edit Tank Logs",
    description: "Edit Tank Logs — scope/action inferred from naming",
    module: 'tank_logs'
  },
  MANAGE_STORAGE_TANKS: {
    key: 'MANAGE_STORAGE_TANKS',
    label: "Manage Storage Tanks",
    description: "Manage Storage Tanks — scope/action inferred from naming",
    module: 'tank_logs'
  },
  MANAGE_TANK_LOGS: {
    key: 'MANAGE_TANK_LOGS',
    label: "Manage Tank Logs",
    description: "Create, edit daily tank logs and manage storage tanks",
    module: 'tank_logs'
  },
  VIEW_TANK_LOGS: {
    key: 'VIEW_TANK_LOGS',
    label: "View Tank Logs",
    description: "View daily tank stock logs",
    module: 'tank_logs'
  },

  // ──────────────────────────── Expense Sheets ────────────────────────────
  APPROVE_EXPENSE_SHEETS: {
    key: 'APPROVE_EXPENSE_SHEETS',
    label: "Approve Expense Sheets",
    description: "Approve submitted expense sheets",
    module: 'expense_sheets'
  },
  CREATE_EXPENSE_SHEETS: {
    key: 'CREATE_EXPENSE_SHEETS',
    label: "Create Expense Sheets",
    description: "Create Expense Sheets — scope/action inferred from naming",
    module: 'expense_sheets'
  },
  EDIT_EXPENSE_SHEETS: {
    key: 'EDIT_EXPENSE_SHEETS',
    label: "Edit Expense Sheets",
    description: "Edit Expense Sheets — scope/action inferred from naming",
    module: 'expense_sheets'
  },
  MANAGE_EXPENSE_SHEETS: {
    key: 'MANAGE_EXPENSE_SHEETS',
    label: "Manage Expense Sheets",
    description: "Create and edit daily vehicle expense sheets",
    module: 'expense_sheets'
  },
  SUBMIT_EXPENSE_SHEETS: {
    key: 'SUBMIT_EXPENSE_SHEETS',
    label: "Submit Expense Sheets",
    description: "Submit Expense Sheets — scope/action inferred from naming",
    module: 'expense_sheets'
  },
  VIEW_EXPENSE_SHEETS: {
    key: 'VIEW_EXPENSE_SHEETS',
    label: "View Expense Sheets",
    description: "View daily vehicle expense sheets",
    module: 'expense_sheets'
  },

  // ──────────────────────────── Banking ────────────────────────────
  CREATE_BANK_TRANSACTIONS: {
    key: 'CREATE_BANK_TRANSACTIONS',
    label: "Create Bank Transactions",
    description: "Create Bank Transactions — backfilled from route enforcement",
    module: 'banking'
  },
  CREATE_TRANSACTIONS: {
    key: 'CREATE_TRANSACTIONS',
    label: "Create Transactions",
    description: "Create bank transactions",
    module: 'banking'
  },
  DELETE_BANK_TRANSACTIONS_ALL: {
    key: 'DELETE_BANK_TRANSACTIONS_ALL',
    label: "Delete Bank Transactions All",
    description: "Delete Bank Transactions All — scope/action inferred from naming",
    module: 'banking'
  },
  DELETE_BANK_TRANSACTIONS_OWN: {
    key: 'DELETE_BANK_TRANSACTIONS_OWN',
    label: "Delete Bank Transactions Own",
    description: "Delete Bank Transactions Own — scope/action inferred from naming",
    module: 'banking'
  },
  DELETE_TRANSACTIONS: {
    key: 'DELETE_TRANSACTIONS',
    label: "Delete Transactions",
    description: "Delete bank transactions",
    module: 'banking'
  },
  EDIT_BANK_TRANSACTIONS_ALL: {
    key: 'EDIT_BANK_TRANSACTIONS_ALL',
    label: "Edit Bank Transactions All",
    description: "Edit Bank Transactions All — scope/action inferred from naming",
    module: 'banking'
  },
  EDIT_BANK_TRANSACTIONS_OWN: {
    key: 'EDIT_BANK_TRANSACTIONS_OWN',
    label: "Edit Bank Transactions Own",
    description: "Edit Bank Transactions Own — scope/action inferred from naming",
    module: 'banking'
  },
  EDIT_TRANSACTIONS: {
    key: 'EDIT_TRANSACTIONS',
    label: "Edit Transactions",
    description: "Edit bank transactions",
    module: 'banking'
  },
  MANAGE_BANKING: {
    key: 'MANAGE_BANKING',
    label: "Manage Banking",
    description: "Full banking module access",
    module: 'banking'
  },
  RECONCILE_ACCOUNTS: {
    key: 'RECONCILE_ACCOUNTS',
    label: "Reconcile Accounts",
    description: "Reconcile bank statements",
    module: 'banking'
  },
  RECONCILE_BANK_TRANSACTIONS: {
    key: 'RECONCILE_BANK_TRANSACTIONS',
    label: "Reconcile Bank Transactions",
    description: "Reconcile Bank Transactions — backfilled from route enforcement",
    module: 'banking'
  },
  VIEW_BANK_TRANSACTIONS_ALL: {
    key: 'VIEW_BANK_TRANSACTIONS_ALL',
    label: "View Bank Transactions All",
    description: "View Bank Transactions All — scope/action inferred from naming",
    module: 'banking'
  },
  VIEW_BANK_TRANSACTIONS_OWN: {
    key: 'VIEW_BANK_TRANSACTIONS_OWN',
    label: "View Bank Transactions Own",
    description: "View Bank Transactions Own — scope/action inferred from naming",
    module: 'banking'
  },
  VIEW_BANKING: {
    key: 'VIEW_BANKING',
    label: "View Banking",
    description: "View bank accounts and transactions",
    module: 'banking'
  },
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
  },
  employees: {
    key: 'employees',
    label: 'Employees',
    icon: 'user-check',
    order: 17
  },
  vehicles: {
    key: 'vehicles',
    label: 'Vehicles',
    icon: 'truck',
    order: 18
  },
  tank_logs: {
    key: 'tank_logs',
    label: 'Tank Logs',
    icon: 'droplet',
    order: 19
  },
  expense_sheets: {
    key: 'expense_sheets',
    label: 'Expense Sheets',
    icon: 'receipt',
    order: 20
  },
  banking: {
    key: 'banking',
    label: 'Banking',
    icon: 'landmark',
    order: 21
  }
};

function getAllPermissionKeys() {
  return Object.keys(PERMISSIONS);
}

function getPermissionsByModule() {
  const grouped = {};
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
  return Object.values(grouped).sort((a, b) => a.order - b.order);
}

function getPermission(key) {
  return PERMISSIONS[key] || null;
}

function isValidPermission(key) {
  return key in PERMISSIONS;
}

function validatePermissions(permissionKeys) {
  const invalid = permissionKeys.filter(key => !isValidPermission(key));
  return { valid: invalid.length === 0, invalidKeys: invalid };
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
