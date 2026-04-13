# Permission Refactoring Guide

## Overview

This guide demonstrates how to refactor backend routes to use the new hierarchical permission system with ownership-scoped permissions (OWN vs ALL variants).

**Reference Implementation**: `backend/routes/purchaseOrders.js` - Complete working example

---

## Step 1: Import Required Functions

At the top of your route file, import both `requirePermission` and `requireAnyPermission`:

```javascript
const { requirePermission, requireAnyPermission } = require('../middleware/auth');
```

---

## Step 2: Add Ownership Helper Function

After `router.use(sanitize)`, add this reusable helper function:

```javascript
/**
 * Check if user has permission to access a resource
 * @param {object} resource - The resource object (must have 'createdBy' field)
 * @param {number} userId - The requesting user's ID
 * @param {array} permissions - The user's permissions array
 * @param {string} permissionType - Type of permission ('EDIT', 'DELETE', 'VIEW')
 * @returns {boolean} - True if user has access, false otherwise
 */
const checkResourceOwnership = (resource, userId, permissions, permissionType = 'EDIT') => {
  const { hasPermission } = require('../config/permissionsHierarchy');

  // If user has the _ALL variant, they can access any resource
  const allPermission = `${permissionType}_[RESOURCE_NAME]_ALL`;
  if (hasPermission(permissions, allPermission)) {
    return true;
  }

  // If user has the _OWN variant, check ownership
  const ownPermission = `${permissionType}_[RESOURCE_NAME]_OWN`;
  if (hasPermission(permissions, ownPermission)) {
    return resource.createdBy === userId;
  }

  return false;
};
```

**Replace `[RESOURCE_NAME]` with your resource type**: PURCHASE, SALES, EXPENSE, WASTAGE, COLLECTION, etc.

---

## Step 3: Update CREATE Endpoints

### Before:
```javascript
router.post('/',
  requirePermission('CREATE_PURCHASE'),
  async (req, res) => {
    const { userId } = req.user;
    // ... create logic
    orderData.createdBy = userId; // ✅ Make sure createdBy is set!
  }
);
```

### After:
```javascript
router.post('/',
  requireAnyPermission(['CREATE_PURCHASE_ALL', 'CREATE_PURCHASE_OWN']),
  async (req, res) => {
    const { userId } = req.user;
    // ... create logic
    orderData.createdBy = userId; // ✅ Make sure createdBy is set!
  }
);
```

**Note**: For CREATE operations, ownership is implicit (user creates their own resource), so no additional check needed.

---

## Step 4: Update EDIT/UPDATE Endpoints

### Before:
```javascript
router.put('/:id',
  requirePermission('EDIT_PURCHASE'),
  async (req, res) => {
    const { companyId, userId } = req.user;
    const db = getDbConnection(companyId);

    const existing = await db('purchase_orders').where({ id }).first();
    if (!existing) {
      return res.status(404).json({ error: 'Not found' });
    }

    // ... update logic
  }
);
```

### After:
```javascript
router.put('/:id',
  requireAnyPermission(['EDIT_PURCHASE_ALL', 'EDIT_PURCHASE_OWN']),
  async (req, res) => {
    const { companyId, userId, permissions } = req.user; // ✅ Add permissions
    const db = getDbConnection(companyId);

    const existing = await db('purchase_orders').where({ id }).first();
    if (!existing) {
      return res.status(404).json({ error: 'Not found' });
    }

    // ✅ Add ownership check
    if (!checkResourceOwnership(existing, userId, permissions, 'EDIT')) {
      auditLog('PERMISSION_DENIED', userId, {
        reason: 'Attempted to edit another user\'s resource',
        resourceId: id,
        resourceCreatedBy: existing.createdBy,
        requestedBy: userId
      });

      return res.status(403).json({
        success: false,
        error: 'You can only edit your own resources'
      });
    }

    // ... update logic
  }
);
```

---

## Step 5: Update DELETE Endpoints

Same pattern as EDIT endpoints, but use `DELETE_*_ALL` and `DELETE_*_OWN` permissions:

```javascript
router.delete('/:id',
  requireAnyPermission(['DELETE_PURCHASE_ALL', 'DELETE_PURCHASE_OWN']),
  async (req, res) => {
    const { companyId, userId, permissions } = req.user;
    const db = getDbConnection(companyId);

    const existing = await db('purchase_orders').where({ id }).first();
    if (!existing) {
      return res.status(404).json({ error: 'Not found' });
    }

    // ✅ Add ownership check
    if (!checkResourceOwnership(existing, userId, permissions, 'DELETE')) {
      return res.status(403).json({
        success: false,
        error: 'You can only delete your own resources'
      });
    }

    await db('purchase_orders').where({ id }).delete();
    res.json({ success: true });
  }
);
```

---

## Step 6: Update VIEW Endpoints (Listing)

For listing endpoints that return multiple resources:

### Before:
```javascript
router.get('/',
  requirePermission('VIEW_PURCHASE'),
  async (req, res) => {
    const { companyId } = req.user;
    const db = getDbConnection(companyId);

    const items = await db('purchase_orders'); // ❌ Shows all
    res.json({ data: items });
  }
);
```

### After:
```javascript
router.get('/',
  requireAnyPermission(['VIEW_PURCHASE_ALL', 'VIEW_PURCHASE_OWN']),
  async (req, res) => {
    const { companyId, userId, permissions } = req.user;
    const db = getDbConnection(companyId);
    const { hasPermission } = require('../config/permissionsHierarchy');

    let query = db('purchase_orders');

    // ✅ Filter by ownership if user only has _OWN permission
    if (!hasPermission(permissions, 'VIEW_PURCHASE_ALL')) {
      query = query.where('createdBy', userId);
    }

    const items = await query;
    res.json({ data: items });
  }
);
```

---

## Step 7: Update VIEW Endpoints (Single Resource)

For endpoints that return a single resource by ID:

```javascript
router.get('/:id',
  requireAnyPermission(['VIEW_PURCHASE_ALL', 'VIEW_PURCHASE_OWN']),
  async (req, res) => {
    const { id } = req.params;
    const { companyId, userId, permissions } = req.user;
    const db = getDbConnection(companyId);

    const item = await db('purchase_orders').where({ id }).first();
    if (!item) {
      return res.status(404).json({ error: 'Not found' });
    }

    // ✅ Add ownership check
    if (!checkResourceOwnership(item, userId, permissions, 'VIEW')) {
      return res.status(403).json({
        success: false,
        error: 'You can only view your own resources'
      });
    }

    res.json({ data: item });
  }
);
```

---

## Step 8: Update Approval Endpoints

Approval permissions are **always *_ALL** (no _OWN variant) because approval is an administrative operation:

```javascript
router.post('/:id/approve',
  requirePermission('APPROVE_PURCHASE'), // ✅ No _ALL/_OWN variants
  async (req, res) => {
    // ... approval logic
  }
);
```

**No ownership check needed** - approval always operates on any resource.

---

## Step 9: Special Case - Attachments with File Cleanup

When uploading files, clean up S3/storage if permission check fails:

```javascript
router.post('/:id/attachments',
  requireAnyPermission(['EDIT_PURCHASE_ALL', 'EDIT_PURCHASE_OWN']),
  uploadMultipleToS3, // File upload middleware runs BEFORE ownership check
  requireFiles,
  async (req, res) => {
    const { id } = req.params;
    const { companyId, userId, permissions } = req.user;
    const db = getDbConnection(companyId);

    const order = await db('purchase_orders').where({ id }).first();

    if (!order) {
      // ✅ Clean up uploaded files if resource doesn't exist
      if (req.files && req.files.length > 0) {
        await Promise.all(req.files.map(file =>
          storageService.deleteFile(file.key).catch(err =>
            logger.warn('Failed to delete orphaned file', { key: file.key })
          )
        ));
      }
      return res.status(404).json({ error: 'Not found' });
    }

    // ✅ Clean up uploaded files if user lacks permission
    if (!checkResourceOwnership(order, userId, permissions, 'EDIT')) {
      if (req.files && req.files.length > 0) {
        await Promise.all(req.files.map(file =>
          storageService.deleteFile(file.key).catch(err =>
            logger.warn('Failed to delete unauthorized file', { key: file.key })
          )
        ));
      }

      return res.status(403).json({
        success: false,
        error: 'You can only modify your own resources'
      });
    }

    // ... save attachment metadata
  }
);
```

---

## Step 10: Update Related Operations (Add Items, etc.)

Operations that modify an existing resource (like adding items to an order) should use EDIT permissions:

```javascript
router.post('/:id/items',
  requireAnyPermission(['EDIT_PURCHASE_ALL', 'EDIT_PURCHASE_OWN']),
  async (req, res) => {
    const { id } = req.params;
    const { companyId, userId, permissions } = req.user;
    const db = getDbConnection(companyId);

    const order = await db('purchase_orders').where({ id }).first();
    if (!order) {
      return res.status(404).json({ error: 'Not found' });
    }

    // ✅ Add ownership check
    if (!checkResourceOwnership(order, userId, permissions, 'EDIT')) {
      return res.status(403).json({
        success: false,
        error: 'You can only modify your own resources'
      });
    }

    // ... add item logic
  }
);
```

---

## Common Patterns

### Pattern 1: createdBy Field Required

All tables that need ownership checking **MUST have a `createdBy` field**:

```sql
ALTER TABLE your_table ADD COLUMN createdBy INT UNSIGNED NOT NULL;
ALTER TABLE your_table ADD CONSTRAINT fk_your_table_created_by
  FOREIGN KEY (createdBy) REFERENCES users(id);
```

### Pattern 2: Permission Naming Convention

Follow this convention strictly:

```
{ACTION}_{RESOURCE}_{SCOPE}

Examples:
- VIEW_PURCHASE_ALL, VIEW_PURCHASE_OWN
- EDIT_EXPENSE_ALL, EDIT_EXPENSE_OWN
- DELETE_WASTAGE_ALL, DELETE_WASTAGE_OWN
- CREATE_SALES_ALL, CREATE_SALES_OWN
- APPROVE_PURCHASE (no _ALL/_OWN for approval operations)
- RECEIVE_PURCHASE (no _ALL/_OWN for receiving operations)
```

### Pattern 3: Audit Logging

Always log permission denials for security auditing:

```javascript
if (!checkResourceOwnership(resource, userId, permissions, 'EDIT')) {
  auditLog('PERMISSION_DENIED', userId, {
    reason: 'Attempted to edit another user\'s resource',
    resourceId: id,
    resourceType: 'purchase_order', // Specify resource type
    resourceCreatedBy: resource.createdBy,
    requestedBy: userId,
    endpoint: req.originalUrl
  });

  return res.status(403).json({
    success: false,
    error: 'You can only edit your own resources'
  });
}
```

---

## Testing Checklist

After refactoring a route file, test these scenarios:

- [ ] **User with *_ALL permission** can access/modify any resource
- [ ] **User with *_OWN permission** can access/modify their own resources
- [ ] **User with *_OWN permission** gets 403 when accessing others' resources
- [ ] **User without permission** gets 403 for all operations
- [ ] **Hierarchical permissions work** (e.g., MANAGE_PURCHASE grants EDIT_PURCHASE_ALL)
- [ ] **Audit logs record** all permission denials
- [ ] **File cleanup works** when attachment upload fails permission check
- [ ] **Filtering works correctly** in list endpoints (OWN users see only their resources)

---

## Module-Specific Notes

### Purchase Orders
- **File**: `backend/routes/purchaseOrders.js` ✅ **COMPLETED** (reference implementation)
- Special permission: `RECEIVE_PURCHASE` (no OWN variant)
- Approval: `APPROVE_PURCHASE` (no OWN variant)

### Sales Orders
- **File**: `backend/routes/salesOrders.js`
- Use: `CREATE_SALES_ALL/OWN`, `EDIT_SALES_ALL/OWN`, `DELETE_SALES_ALL/OWN`
- Special permission: `APPROVE_SALES` (no OWN variant)
- Special permission: `GENERATE_SALES_INVOICE` (no OWN variant)

### Expenses
- **File**: `backend/routes/expenses.js`
- Use: `CREATE_EXPENSE_ALL/OWN`, `EDIT_EXPENSE_ALL/OWN`, `DELETE_EXPENSE_ALL/OWN`
- Special permission: `APPROVE_EXPENSE_ALL/OWN` (approval can be scoped!)

### Petty Cash Expenses
- **File**: `backend/routes/pettyCashExpenses.js`
- Use: `CREATE_PETTY_CASH_EXPENSE_ALL/OWN`, `EDIT_PETTY_CASH_EXPENSE_ALL/OWN`
- Special permission: `APPROVE_PETTY_CASH_EXPENSE` (no OWN variant)
- Card ownership: Check `assignedTo` field for card operations

### Wastage
- **File**: `backend/routes/wastages.js`
- Use: `CREATE_WASTAGE_ALL/OWN`, `EDIT_WASTAGE_ALL/OWN`, `DELETE_WASTAGE_ALL/OWN`
- Special permission: `APPROVE_WASTAGE` (no OWN variant)

### Collections
- **File**: `backend/routes/collectionOrders.js`
- Use: `CREATE_COLLECTIONS`, `EDIT_COLLECTIONS_ALL/OWN`
- Special permissions: `APPROVE_COLLECTIONS`, `FINALIZE_WCN` (no OWN variants)

### Contracts
- **File**: `backend/routes/contracts.js`
- Use: `CREATE_CONTRACTS`, `EDIT_CONTRACTS_ALL/OWN`
- Special permission: `APPROVE_CONTRACTS` (no OWN variant)

### Customers & Suppliers
- **Files**: `backend/routes/customers.js`, `backend/routes/suppliers.js`
- Use: `EDIT_CUSTOMERS_ALL/OWN`, `EDIT_SUPPLIERS_ALL/OWN`
- No CREATE_OWN variants - creating customers/suppliers is typically unrestricted

---

## Priority Order for Refactoring

Refactor routes in this order based on usage frequency and impact:

1. ✅ **Purchase Orders** (COMPLETED - reference implementation)
2. **Sales Orders** (`salesOrders.js`)
3. **Petty Cash Expenses** (`pettyCashExpenses.js`)
4. **Expenses** (`expenses.js`)
5. **Wastages** (`wastages.js`)
6. **Collection Orders** (`collectionOrders.js`)
7. **Contracts** (`contracts.js`)
8. **Customers** (`customers.js`)
9. **Suppliers** (`suppliers.js`)
10. **Materials** (`materials.js`)

---

## Questions?

- **Reference**: `backend/routes/purchaseOrders.js` - Complete working example
- **Permission Tree**: `backend/config/permissionsHierarchy.js`
- **Permission Definitions**: `backend/config/permissionsComplete.js`
- **Middleware**: `backend/middleware/auth.js`

**Last Updated**: November 15, 2025
