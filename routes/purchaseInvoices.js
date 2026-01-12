const express = require('express');
const { validate, validateParams, sanitize } = require('../middleware/validation');
const { requirePermission } = require('../middleware/auth');
const { projectFilter, applyProjectFilter } = require('../middleware/projectFilter');
const { logger, auditLog } = require('../utils/logger');
const { getDbConnection } = require('../config/database');
const { uploadSingle, deleteFile } = require('../middleware/upload');
const Joi = require('joi');

const router = express.Router();

// Apply sanitization to all routes
router.use(sanitize);

// Bill type prefixes for clear differentiation
const BILL_PREFIXES = {
  company: 'CB-',  // Company Bill
  vendor: 'VB-'    // Vendor Bill
};

/**
 * Ensure invoice number has correct bill type prefix
 * @param {string} invoiceNumber - The invoice number (may or may not have prefix)
 * @param {string} billType - 'company' or 'vendor'
 * @returns {string} Invoice number with correct prefix
 */
function ensureBillPrefix(invoiceNumber, billType) {
  const prefix = BILL_PREFIXES[billType] || '';
  const otherPrefix = billType === 'company' ? BILL_PREFIXES.vendor : BILL_PREFIXES.company;

  // Remove any existing prefix first (in case user entered wrong one)
  let cleanNumber = invoiceNumber;
  if (cleanNumber.startsWith(BILL_PREFIXES.company)) {
    cleanNumber = cleanNumber.substring(BILL_PREFIXES.company.length);
  } else if (cleanNumber.startsWith(BILL_PREFIXES.vendor)) {
    cleanNumber = cleanNumber.substring(BILL_PREFIXES.vendor.length);
  }

  return prefix + cleanNumber;
}

/**
 * Generate next invoice number for a given bill type
 * Format: VB-YYYY-NNNNN or CB-YYYY-NNNNN
 * @param {Object} db - Database connection
 * @param {string} billType - 'company' or 'vendor'
 * @returns {Promise<string>} Generated invoice number
 */
async function generateInvoiceNumber(db, billType) {
  const prefix = BILL_PREFIXES[billType] || '';
  const year = new Date().getFullYear();
  const yearPrefix = `${prefix}${year}-`;

  // Find the highest number for this year and bill type
  const lastInvoice = await db('purchase_invoices')
    .where('invoice_number', 'like', `${yearPrefix}%`)
    .orderByRaw('CAST(SUBSTRING(invoice_number, ?) AS UNSIGNED) DESC', [yearPrefix.length + 1])
    .first();

  let nextNumber = 1;
  if (lastInvoice) {
    // Extract the number part after the year prefix
    const lastNumber = lastInvoice.invoice_number.substring(yearPrefix.length);
    const parsed = parseInt(lastNumber, 10);
    if (!isNaN(parsed)) {
      nextNumber = parsed + 1;
    }
  }

  // Format with leading zeros (5 digits)
  return `${yearPrefix}${String(nextNumber).padStart(5, '0')}`;
}

// Purchase invoice validation schema
const purchaseInvoiceSchema = Joi.object({
  // Invoice number: required for company bills, optional for vendor bills (auto-generated)
  invoiceNumber: Joi.string().trim().when('billType', {
    is: 'vendor',
    then: Joi.string().trim().optional().allow('', null),
    otherwise: Joi.string().trim().required()
  }),
  billType: Joi.string().valid('company', 'vendor').default('company'),
  purchaseOrderId: Joi.number().integer().positive().when('billType', {
    is: 'company',
    then: Joi.number().integer().positive().required(),
    otherwise: Joi.optional().allow(null)
  }),
  // Vendor bills can link to either POs (legacy) or Company Bills (new workflow)
  coversPurchaseOrders: Joi.array().items(Joi.number().integer().positive()).min(1).when('billType', {
    is: 'vendor',
    then: Joi.array().items(Joi.number().integer().positive()).min(1).optional(),
    otherwise: Joi.forbidden()
  }),
  coversCompanyBills: Joi.array().items(Joi.number().integer().positive()).min(1).when('billType', {
    is: 'vendor',
    then: Joi.array().items(Joi.number().integer().positive()).min(1).optional(),
    otherwise: Joi.forbidden()
  }),
  supplierId: Joi.number().integer().positive().required(),
  branchId: Joi.number().integer().positive().allow(null).optional(),
  invoiceDate: Joi.date().required(),
  dueDate: Joi.date().allow(null).optional(),
  invoiceAmount: Joi.number().min(0.01).precision(2).required(),
  paymentTermsDays: Joi.number().integer().min(0).default(0),
  notes: Joi.string().allow('').allow(null).optional()
}).options({ stripUnknown: true });

// Company bill status update schema
const companyBillStatusSchema = Joi.object({
  status: Joi.string().valid('draft', 'sent').required()
}).options({ stripUnknown: true });

// Payment recording schema
const paymentSchema = Joi.object({
  amount: Joi.number().min(0.01).precision(2).required(),
  paymentDate: Joi.date().default(() => new Date()),
  paymentMethod: Joi.string().valid('cash', 'bank_transfer', 'cheque', 'card').default('bank_transfer'),
  reference: Joi.string().allow('').optional(),
  notes: Joi.string().allow('').allow(null).optional(),
  bankAccountId: Joi.number().integer().positive().allow(null).optional()
}).options({ stripUnknown: true });

// GET /api/purchase-invoices - List all purchase invoices
router.get('/', requirePermission('VIEW_PURCHASE'), projectFilter, async (req, res) => {
  try {
    const { companyId } = req.user;
    const db = getDbConnection(companyId);

    const {
      page = 1,
      limit = 50,
      search = '',
      supplierId = '',
      purchaseOrderId = '',
      paymentStatus = '',
      billStatus = '',  // For company bills: draft/sent
      billType = '',
      fromDate = '',
      toDate = ''
    } = req.query;

    const offset = (page - 1) * limit;

    let query = db('purchase_invoices')
      .leftJoin('purchase_orders', 'purchase_invoices.purchase_order_id', 'purchase_orders.id')
      .leftJoin('suppliers', 'purchase_invoices.supplier_id', 'suppliers.id')
      .leftJoin('branches', 'purchase_invoices.branch_id', 'branches.id')
      .select(
        'purchase_invoices.*',
        'purchase_orders.orderNumber',
        'suppliers.name as supplierName',
        'branches.name as branchName'
      );

    // Apply project filter (filters by purchase_invoices.project_id)
    query = applyProjectFilter(query, req.projectFilter, 'purchase_invoices.project_id');

    // Search filter
    if (search) {
      query = query.where(function() {
        this.where('purchase_invoices.invoice_number', 'like', `%${search}%`)
            .orWhere('purchase_orders.orderNumber', 'like', `%${search}%`)
            .orWhere('suppliers.name', 'like', `%${search}%`);
      });
    }

    // Supplier filter
    if (supplierId) {
      query = query.where('purchase_invoices.supplier_id', supplierId);
    }

    // Purchase order filter
    if (purchaseOrderId) {
      query = query.where('purchase_invoices.purchase_order_id', purchaseOrderId);
    }

    // Payment status filter
    if (paymentStatus) {
      query = query.where('purchase_invoices.payment_status', paymentStatus);
    }

    // Bill type filter (company or vendor)
    if (billType) {
      query = query.where('purchase_invoices.bill_type', billType);
    }

    // Bill status filter (for company bills: draft/sent)
    if (billStatus) {
      query = query.where('purchase_invoices.bill_status', billStatus);
    }

    // Date range filter
    if (fromDate) {
      query = query.where('purchase_invoices.invoice_date', '>=', fromDate);
    }
    if (toDate) {
      query = query.where('purchase_invoices.invoice_date', '<=', toDate);
    }

    // Get total count for pagination
    const totalQuery = query.clone();
    const [{ total }] = await totalQuery.count('* as total');

    // Get paginated results
    const invoices = await query
      .orderBy('purchase_invoices.invoice_date', 'desc')
      .orderBy('purchase_invoices.id', 'desc')
      .limit(limit)
      .offset(offset);

    // Convert DECIMAL strings to numbers and parse JSON fields
    // Note: MySQL JSON columns may be auto-parsed by Knex, so check typeof first
    const formattedInvoices = invoices.map(invoice => ({
      ...invoice,
      invoice_amount: parseFloat(invoice.invoice_amount) || 0,
      paid_amount: parseFloat(invoice.paid_amount) || 0,
      balance_due: parseFloat(invoice.balance_due) || 0,
      covers_purchase_orders: invoice.covers_purchase_orders
        ? (typeof invoice.covers_purchase_orders === 'string'
            ? JSON.parse(invoice.covers_purchase_orders)
            : invoice.covers_purchase_orders)
        : null,
      covers_company_bills: invoice.covers_company_bills
        ? (typeof invoice.covers_company_bills === 'string'
            ? JSON.parse(invoice.covers_company_bills)
            : invoice.covers_company_bills)
        : null
    }));

    res.json({
      success: true,
      data: formattedInvoices,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(total),
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    logger.error('Error fetching purchase invoices', {
      error: error.message,
      userId: req.user.userId,
      companyId: req.user.companyId
    });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch purchase invoices'
    });
  }
});

// GET /api/purchase-invoices/:id - Get specific invoice
router.get('/:id',
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  requirePermission('VIEW_PURCHASE'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      const invoice = await db('purchase_invoices')
        .leftJoin('purchase_orders', 'purchase_invoices.purchase_order_id', 'purchase_orders.id')
        .leftJoin('suppliers', 'purchase_invoices.supplier_id', 'suppliers.id')
        .leftJoin('branches', 'purchase_invoices.branch_id', 'branches.id')
        .leftJoin('users', 'purchase_invoices.created_by', 'users.id')
        .select(
          'purchase_invoices.*',
          'purchase_orders.orderNumber',
          'purchase_orders.orderDate',
          'purchase_orders.totalAmount as orderTotalAmount',
          'suppliers.name as supplierName',
          'suppliers.phone as supplierPhone',
          'suppliers.address as supplierAddress',
          'branches.name as branchName',
          'users.name as createdByName'
        )
        .where('purchase_invoices.id', id)
        .first();

      if (!invoice) {
        return res.status(404).json({
          success: false,
          error: 'Invoice not found'
        });
      }

      // Convert DECIMAL strings to numbers and parse JSON fields
      // Note: MySQL JSON columns may be auto-parsed by Knex, so check typeof first
      const formattedInvoice = {
        ...invoice,
        invoice_amount: parseFloat(invoice.invoice_amount) || 0,
        paid_amount: parseFloat(invoice.paid_amount) || 0,
        balance_due: parseFloat(invoice.balance_due) || 0,
        orderTotalAmount: parseFloat(invoice.orderTotalAmount) || 0,
        covers_purchase_orders: invoice.covers_purchase_orders
          ? (typeof invoice.covers_purchase_orders === 'string'
              ? JSON.parse(invoice.covers_purchase_orders)
              : invoice.covers_purchase_orders)
          : null,
        covers_company_bills: invoice.covers_company_bills
          ? (typeof invoice.covers_company_bills === 'string'
              ? JSON.parse(invoice.covers_company_bills)
              : invoice.covers_company_bills)
          : null
      };

      res.json({
        success: true,
        data: formattedInvoice
      });

    } catch (error) {
      logger.error('Error fetching purchase invoice', {
        error: error.message,
        invoiceId: req.params.id,
        userId: req.user.userId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch purchase invoice'
      });
    }
  }
);

// POST /api/purchase-invoices - Create new invoice (company or vendor bill)
router.post('/',
  validate(purchaseInvoiceSchema),
  requirePermission('CREATE_PURCHASE'),
  async (req, res) => {
    try {
      const { companyId, userId } = req.user;
      const db = getDbConnection(companyId);
      const invoiceData = req.body;
      const billType = invoiceData.billType || 'company';

      // Generate or format invoice number based on bill type
      let invoiceNumber;
      if (billType === 'vendor') {
        // Vendor bills: always auto-generate invoice number
        invoiceNumber = await generateInvoiceNumber(db, billType);
      } else {
        // Company bills: use provided number with prefix
        invoiceNumber = ensureBillPrefix(invoiceData.invoiceNumber, billType);
      }

      // Check if invoice number already exists
      const existingInvoice = await db('purchase_invoices')
        .where({ invoice_number: invoiceNumber })
        .first();

      if (existingInvoice) {
        return res.status(400).json({
          success: false,
          error: 'Invoice number already exists'
        });
      }

      let purchaseOrder = null;
      let branchId = invoiceData.branchId;
      let purchaseOrders = [];

      if (billType === 'company') {
        // Company bill: Single PO
        purchaseOrder = await db('purchase_orders')
          .where({ id: invoiceData.purchaseOrderId })
          .first();

        if (!purchaseOrder) {
          return res.status(404).json({
            success: false,
            error: 'Purchase order not found'
          });
        }

        // Verify supplier matches
        if (purchaseOrder.supplierId !== invoiceData.supplierId) {
          return res.status(400).json({
            success: false,
            error: 'Purchase order supplier does not match invoice supplier'
          });
        }

        branchId = branchId || purchaseOrder.branch_id;

      } else if (billType === 'vendor') {
        // Vendor bill: Can link to Company Bills (new) or POs (legacy)
        const hasCompanyBills = invoiceData.coversCompanyBills && invoiceData.coversCompanyBills.length > 0;
        const hasPurchaseOrders = invoiceData.coversPurchaseOrders && invoiceData.coversPurchaseOrders.length > 0;

        if (!hasCompanyBills && !hasPurchaseOrders) {
          return res.status(400).json({
            success: false,
            error: 'Vendor bill must cover at least one company bill'
          });
        }

        // New workflow: Link to company bills
        if (hasCompanyBills) {
          // Fetch all company bills
          const companyBills = await db('purchase_invoices')
            .whereIn('id', invoiceData.coversCompanyBills)
            .where('bill_type', 'company')
            .select('*');

          if (companyBills.length !== invoiceData.coversCompanyBills.length) {
            return res.status(404).json({
              success: false,
              error: 'One or more company bills not found'
            });
          }

          // Verify all company bills belong to same supplier
          const uniqueSuppliers = [...new Set(companyBills.map(cb => cb.supplier_id))];
          if (uniqueSuppliers.length > 1) {
            return res.status(400).json({
              success: false,
              error: 'All company bills must belong to the same supplier'
            });
          }

          if (uniqueSuppliers[0] !== invoiceData.supplierId) {
            return res.status(400).json({
              success: false,
              error: 'Company bills supplier does not match invoice supplier'
            });
          }

          // Check that company bills are not already linked to another vendor bill
          const existingVendorBills = await db('purchase_invoices')
            .where('bill_type', 'vendor')
            .whereNotNull('covers_company_bills')
            .select('id', 'invoice_number', 'covers_company_bills');

          const alreadyLinkedIds = new Set();
          existingVendorBills.forEach(vb => {
            const covered = typeof vb.covers_company_bills === 'string'
              ? JSON.parse(vb.covers_company_bills)
              : vb.covers_company_bills;
            if (Array.isArray(covered)) {
              covered.forEach(id => alreadyLinkedIds.add(id));
            }
          });

          const conflictingBills = invoiceData.coversCompanyBills.filter(id => alreadyLinkedIds.has(id));
          if (conflictingBills.length > 0) {
            return res.status(400).json({
              success: false,
              error: `Some company bills are already linked to another vendor bill`
            });
          }

          // Use first company bill's branch if not specified
          branchId = branchId || companyBills[0].branch_id;

        } else if (hasPurchaseOrders) {
          // Legacy workflow: Link to POs directly
          purchaseOrders = await db('purchase_orders')
            .whereIn('id', invoiceData.coversPurchaseOrders)
            .select('*');

          if (purchaseOrders.length !== invoiceData.coversPurchaseOrders.length) {
            return res.status(404).json({
              success: false,
              error: 'One or more purchase orders not found'
            });
          }

          // Verify all POs belong to same supplier
          const uniqueSuppliers = [...new Set(purchaseOrders.map(po => po.supplierId))];
          if (uniqueSuppliers.length > 1) {
            return res.status(400).json({
              success: false,
              error: 'All purchase orders must belong to the same supplier'
            });
          }

          if (uniqueSuppliers[0] !== invoiceData.supplierId) {
            return res.status(400).json({
              success: false,
              error: 'Purchase orders supplier does not match invoice supplier'
            });
          }

          // Use first PO's branch if not specified
          branchId = branchId || purchaseOrders[0].branch_id;
        }
      }

      // Calculate due date if not provided
      let dueDate = invoiceData.dueDate;
      if (!dueDate && invoiceData.paymentTermsDays > 0) {
        const invoiceDate = new Date(invoiceData.invoiceDate);
        dueDate = new Date(invoiceDate);
        dueDate.setDate(dueDate.getDate() + invoiceData.paymentTermsDays);
      }

      // Determine project_id from linked PO or company bills
      let projectId = null;
      if (billType === 'company' && purchaseOrder) {
        projectId = purchaseOrder.project_id;
      } else if (billType === 'vendor') {
        // For vendor bills, get project_id from first linked company bill or PO
        if (invoiceData.coversCompanyBills && invoiceData.coversCompanyBills.length > 0) {
          const firstCompanyBill = await db('purchase_invoices')
            .where('id', invoiceData.coversCompanyBills[0])
            .select('project_id')
            .first();
          projectId = firstCompanyBill?.project_id || null;
        } else if (purchaseOrders.length > 0) {
          projectId = purchaseOrders[0].project_id;
        }
      }

      // Create invoice
      const [invoiceId] = await db('purchase_invoices').insert({
        invoice_number: invoiceNumber,  // Uses prefixed invoice number (CB-/VB-)
        bill_type: billType,
        purchase_order_id: billType === 'company' ? invoiceData.purchaseOrderId : null,
        covers_purchase_orders: billType === 'vendor' && invoiceData.coversPurchaseOrders
          ? JSON.stringify(invoiceData.coversPurchaseOrders)
          : null,
        covers_company_bills: billType === 'vendor' && invoiceData.coversCompanyBills
          ? JSON.stringify(invoiceData.coversCompanyBills)
          : null,
        supplier_id: invoiceData.supplierId,
        branch_id: branchId,
        project_id: projectId,  // Inherit project from linked PO
        invoice_date: invoiceData.invoiceDate,
        due_date: dueDate,
        payment_status: billType === 'vendor' ? 'unpaid' : null,  // Only vendor bills have payment_status
        bill_status: billType === 'company' ? 'draft' : null,      // Company bills start as draft
        invoice_amount: invoiceData.invoiceAmount,
        paid_amount: 0,
        payment_terms_days: invoiceData.paymentTermsDays || 0,
        notes: invoiceData.notes,
        created_by: userId,
        created_at: new Date(),
        updated_at: new Date()
      });

      const auditData = {
        invoiceId,
        invoiceNumber: invoiceNumber,  // Uses prefixed invoice number
        billType,
        amount: invoiceData.invoiceAmount
      };

      if (billType === 'company') {
        auditData.purchaseOrderId = invoiceData.purchaseOrderId;
        auditData.orderNumber = purchaseOrder.orderNumber;
      } else {
        auditData.coversPurchaseOrders = invoiceData.coversPurchaseOrders;
        auditData.purchaseOrderCount = purchaseOrders.length;
      }

      auditLog('PURCHASE_INVOICE_CREATED', userId, auditData);

      res.json({
        success: true,
        data: { id: invoiceId },
        message: `${billType === 'company' ? 'Company' : 'Vendor'} invoice created successfully`
      });

    } catch (error) {
      logger.error('Error creating purchase invoice', {
        error: error.message,
        userId: req.user.userId,
        body: req.body
      });
      res.status(500).json({
        success: false,
        error: 'Failed to create purchase invoice'
      });
    }
  }
);

// Vendor bill update validation schema
const vendorBillUpdateSchema = Joi.object({
  invoiceDate: Joi.date().optional(),
  dueDate: Joi.date().allow(null).optional(),
  invoiceAmount: Joi.number().min(0.01).precision(3).optional(),
  coversPurchaseOrders: Joi.array().items(Joi.number().integer().positive()).min(1).optional(),
  notes: Joi.string().allow('').allow(null).optional()
}).options({ stripUnknown: true });

// PUT /api/purchase-invoices/:id - Update invoice (with vendor bill validation)
router.put('/:id',
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  requirePermission('CREATE_PURCHASE'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { companyId, userId } = req.user;
      const db = getDbConnection(companyId);
      const updateData = req.body;

      // Check if invoice exists
      const invoice = await db('purchase_invoices')
        .where({ id })
        .first();

      if (!invoice) {
        return res.status(404).json({
          success: false,
          error: 'Invoice not found'
        });
      }

      // Don't allow updating fully paid invoices
      if (invoice.payment_status === 'paid') {
        return res.status(400).json({
          success: false,
          error: 'Cannot update a fully paid invoice'
        });
      }

      // === VENDOR BILL SPECIFIC VALIDATION ===
      if (invoice.bill_type === 'vendor') {
        // Validate schema for vendor bill updates
        const { error: validationError } = vendorBillUpdateSchema.validate(updateData);
        if (validationError) {
          return res.status(400).json({
            success: false,
            error: validationError.details[0].message
          });
        }

        // If updating covered POs, perform validation
        if (updateData.coversPurchaseOrders && Array.isArray(updateData.coversPurchaseOrders)) {
          const newPOIds = updateData.coversPurchaseOrders;

          // Get all vendor bills that cover POs (excluding current bill)
          const otherVendorBills = await db('purchase_invoices')
            .where('bill_type', 'vendor')
            .whereNot('id', id)
            .whereNotNull('covers_purchase_orders');

          // Build set of PO IDs already linked to OTHER vendor bills
          const linkedPOIds = new Set();
          otherVendorBills.forEach(vb => {
            const covered = typeof vb.covers_purchase_orders === 'string'
              ? JSON.parse(vb.covers_purchase_orders)
              : vb.covers_purchase_orders;
            if (Array.isArray(covered)) {
              covered.forEach(poId => linkedPOIds.add(poId));
            }
          });

          // Check if any selected POs are already linked to other vendor bills
          const conflictingPOs = newPOIds.filter(poId => linkedPOIds.has(poId));
          if (conflictingPOs.length > 0) {
            // Get PO numbers for better error message
            const conflictingPODetails = await db('purchase_orders')
              .whereIn('id', conflictingPOs)
              .select('id', 'orderNumber');

            return res.status(400).json({
              success: false,
              error: `The following POs are already linked to another vendor bill: ${conflictingPODetails.map(po => po.orderNumber).join(', ')}`
            });
          }

          // Verify all POs exist and belong to the same supplier
          const selectedPOs = await db('purchase_orders')
            .whereIn('id', newPOIds)
            .select('id', 'orderNumber', 'supplierId', 'status', 'totalAmount');

          if (selectedPOs.length !== newPOIds.length) {
            return res.status(400).json({
              success: false,
              error: 'One or more selected purchase orders do not exist'
            });
          }

          // Check all POs belong to the bill's supplier
          const billSupplierId = invoice.supplier_id;
          const wrongSupplierPOs = selectedPOs.filter(po => po.supplierId !== billSupplierId);
          if (wrongSupplierPOs.length > 0) {
            return res.status(400).json({
              success: false,
              error: `The following POs belong to a different supplier: ${wrongSupplierPOs.map(po => po.orderNumber).join(', ')}`
            });
          }

          // Check all POs are in valid status (received or completed)
          const invalidStatusPOs = selectedPOs.filter(po => !['received', 'completed'].includes(po.status));
          if (invalidStatusPOs.length > 0) {
            return res.status(400).json({
              success: false,
              error: `The following POs are not in received/completed status: ${invalidStatusPOs.map(po => `${po.orderNumber} (${po.status})`).join(', ')}`
            });
          }

          // Convert to JSON string for storage
          updateData.covers_purchase_orders = JSON.stringify(newPOIds);
          delete updateData.coversPurchaseOrders; // Remove camelCase version
        }
      }

      // === BUILD UPDATE OBJECT ===
      const updateFields = {
        updated_at: new Date()
      };

      // Map camelCase to snake_case for allowed fields
      if (updateData.invoiceDate) updateFields.invoice_date = updateData.invoiceDate;
      if (updateData.dueDate !== undefined) updateFields.due_date = updateData.dueDate;
      if (updateData.invoiceAmount !== undefined) updateFields.invoice_amount = updateData.invoiceAmount;
      if (updateData.covers_purchase_orders) updateFields.covers_purchase_orders = updateData.covers_purchase_orders;
      if (updateData.notes !== undefined) updateFields.notes = updateData.notes;

      // Recalculate payment status if invoice amount changed
      if (updateFields.invoice_amount !== undefined) {
        const paidAmount = parseFloat(invoice.paid_amount) || 0;
        const newAmount = parseFloat(updateFields.invoice_amount);
        const newBalance = newAmount - paidAmount;

        if (newBalance <= 0.001) {
          updateFields.payment_status = 'paid';
        } else if (paidAmount > 0) {
          updateFields.payment_status = 'partial';
        } else {
          updateFields.payment_status = 'unpaid';
        }
      }

      // Update invoice
      await db('purchase_invoices')
        .where({ id })
        .update(updateFields);

      // Fetch updated invoice
      const updatedInvoice = await db('purchase_invoices')
        .leftJoin('suppliers', 'purchase_invoices.supplier_id', 'suppliers.id')
        .where('purchase_invoices.id', id)
        .select(
          'purchase_invoices.*',
          'suppliers.name as supplierName'
        )
        .first();

      auditLog('PURCHASE_INVOICE_UPDATED', userId, {
        invoiceId: id,
        invoiceNumber: invoice.invoice_number,
        billType: invoice.bill_type,
        changes: updateFields
      });

      logger.info('Purchase invoice updated', {
        invoiceId: id,
        invoiceNumber: invoice.invoice_number,
        billType: invoice.bill_type,
        userId
      });

      res.json({
        success: true,
        message: `${invoice.bill_type === 'vendor' ? 'Vendor' : 'Company'} bill updated successfully`,
        data: updatedInvoice
      });

    } catch (error) {
      logger.error('Error updating purchase invoice', {
        error: error.message,
        invoiceId: req.params.id,
        userId: req.user.userId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to update purchase invoice'
      });
    }
  }
);

// POST /api/purchase-invoices/:id/payment - Record payment
router.post('/:id/payment',
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  validate(paymentSchema),
  requirePermission('CREATE_PURCHASE'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { companyId, userId } = req.user;
      const db = getDbConnection(companyId);
      const { amount, paymentDate, paymentMethod, reference, notes, bankAccountId } = req.body;

      await db.transaction(async (trx) => {
        // Get invoice
        const invoice = await trx('purchase_invoices')
          .where({ id })
          .first();

        if (!invoice) {
          throw new Error('Invoice not found');
        }

        // Business Rule: Company bills cannot be paid directly
        // They should only be marked as paid when their linked vendor bill is paid
        if (invoice.bill_type === 'company') {
          // Check if this company bill's PO is covered by a vendor bill
          const vendorBill = await trx('purchase_invoices')
            .where('bill_type', 'vendor')
            .whereRaw(`JSON_CONTAINS(covers_purchase_orders, ?)`, [JSON.stringify(invoice.purchase_order_id)])
            .first();

          if (!vendorBill) {
            throw new Error('Cannot record payment on a company bill without a linked vendor bill. Please create a vendor bill first, then pay that instead.');
          } else {
            throw new Error(`This company bill is linked to vendor bill ${vendorBill.invoice_number}. Please record payment on the vendor bill instead.`);
          }
        }

        // Calculate new paid amount and balance
        // Use toFixed(3) to avoid floating-point precision issues (e.g., 0.38999999999987267 instead of 0.39)
        const currentPaid = parseFloat((parseFloat(invoice.paid_amount) || 0).toFixed(3));
        const invoiceAmount = parseFloat(parseFloat(invoice.invoice_amount).toFixed(3));
        const balanceDue = parseFloat((invoiceAmount - currentPaid).toFixed(3));
        const paymentAmount = parseFloat(parseFloat(amount).toFixed(3));

        // Allow small tolerance for floating-point comparison (0.001)
        if (paymentAmount > balanceDue + 0.001) {
          throw new Error(`Payment amount (${paymentAmount}) exceeds balance due (${balanceDue})`);
        }

        // If payment is within tolerance of balance, pay exact balance to avoid tiny remainders
        const effectivePayment = paymentAmount >= balanceDue ? balanceDue : paymentAmount;

        const newPaidAmount = parseFloat((currentPaid + effectivePayment).toFixed(3));
        const newBalance = parseFloat((invoiceAmount - newPaidAmount).toFixed(3));

        // Determine new payment status
        let paymentStatus = 'partial';
        if (newBalance === 0) {
          paymentStatus = 'paid';
        } else if (newBalance === invoiceAmount) {
          paymentStatus = 'unpaid';
        } else if (new Date(invoice.due_date) < new Date() && newBalance > 0) {
          paymentStatus = 'overdue';
        }

        // Update invoice with new paid amount (balance_due is computed column)
        await trx('purchase_invoices')
          .where({ id })
          .update({
            paid_amount: newPaidAmount,
            payment_status: paymentStatus,
            updated_at: new Date()
          });

        // Note: Company bills now use bill_status (draft/sent) instead of payment_status
        // They no longer track payment status since only vendor bills are payable
        // The old cascade logic to update company bills is removed in the new workflow

        // Create transaction record for payment (use effectivePayment for precision)
        await trx('transactions').insert({
          transactionNumber: `INV-PAY-${invoice.invoice_number}-${Date.now()}`,
          transactionType: 'payment',
          referenceId: id,
          referenceType: 'purchase_invoice',
          amount: effectivePayment,
          transactionDate: paymentDate,
          description: `Payment for invoice ${invoice.invoice_number}${reference ? ` (Ref: ${reference})` : ''}`,
          notes: notes || '',
          createdBy: userId,
          created_at: new Date(),
          updated_at: new Date()
        });

        // If bank account is specified, create a bank transaction (withdrawal)
        if (bankAccountId && paymentMethod === 'bank_transfer') {
          // Get supplier name for description
          const supplier = await trx('suppliers')
            .where({ id: invoice.supplier_id })
            .select('name')
            .first();

          // Create bank transaction (withdrawal for paying supplier)
          await trx('bank_transactions').insert({
            account_id: bankAccountId,
            transaction_type: 'withdrawal',
            amount: effectivePayment,
            transaction_date: paymentDate,
            description: `Payment to ${supplier?.name || 'Supplier'} - Invoice ${invoice.invoice_number}`,
            reference_type: 'purchase_invoice',
            reference_id: id,
            category: 'supplier_payment',
            reconciled: false,
            notes: notes || '',
            created_by: userId,
            created_at: new Date(),
            updated_at: new Date()
          });

          // Update bank account balance
          await trx('bank_accounts')
            .where({ id: bankAccountId })
            .decrement('current_balance', effectivePayment);

          logger.info('Bank transaction created for invoice payment', {
            invoiceId: id,
            bankAccountId,
            amount: effectivePayment
          });
        }

        auditLog('PURCHASE_INVOICE_PAYMENT_RECORDED', userId, {
          invoiceId: id,
          invoiceNumber: invoice.invoice_number,
          paymentAmount: effectivePayment,
          paymentMethod,
          reference,
          newPaidAmount,
          newBalance,
          paymentStatus
        });

        res.json({
          success: true,
          data: {
            paidAmount: newPaidAmount,
            balanceDue: newBalance,
            paymentStatus
          },
          message: 'Payment recorded successfully'
        });
      });

    } catch (error) {
      logger.error('Error recording invoice payment', {
        error: error.message,
        invoiceId: req.params.id,
        userId: req.user.userId,
        paymentAmount: req.body.amount
      });
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to record payment'
      });
    }
  }
);

// DELETE /api/purchase-invoices/:id - Delete invoice
router.delete('/:id',
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  requirePermission('DELETE_PURCHASE'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { companyId, userId } = req.user;
      const db = getDbConnection(companyId);

      // Get invoice
      const invoice = await db('purchase_invoices')
        .where({ id })
        .first();

      if (!invoice) {
        return res.status(404).json({
          success: false,
          error: 'Invoice not found'
        });
      }

      // Don't allow deleting invoices with payments
      if (parseFloat(invoice.paid_amount) > 0) {
        return res.status(400).json({
          success: false,
          error: 'Cannot delete an invoice with recorded payments'
        });
      }

      // Delete invoice
      await db('purchase_invoices')
        .where({ id })
        .del();

      // Delete attachment file if exists
      if (invoice.attachment) {
        deleteFile(`invoices/${invoice.attachment}`);
      }

      auditLog('PURCHASE_INVOICE_DELETED', userId, {
        invoiceId: id,
        invoiceNumber: invoice.invoice_number
      });

      res.json({
        success: true,
        message: 'Purchase invoice deleted successfully'
      });

    } catch (error) {
      logger.error('Error deleting purchase invoice', {
        error: error.message,
        invoiceId: req.params.id,
        userId: req.user.userId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to delete purchase invoice'
      });
    }
  }
);

// PUT /api/purchase-invoices/:id/status - Update company bill status (draft → sent)
router.put('/:id/status',
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  validate(companyBillStatusSchema),
  requirePermission('CREATE_PURCHASE'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { companyId, userId } = req.user;
      const db = getDbConnection(companyId);
      const { status } = req.body;

      // Get the invoice
      const invoice = await db('purchase_invoices')
        .where({ id })
        .first();

      if (!invoice) {
        return res.status(404).json({
          success: false,
          error: 'Invoice not found'
        });
      }

      // Only company bills have bill_status
      if (invoice.bill_type !== 'company') {
        return res.status(400).json({
          success: false,
          error: 'Only company bills can have their status updated. Vendor bills use payment_status instead.'
        });
      }

      // Update the bill_status
      await db('purchase_invoices')
        .where({ id })
        .update({
          bill_status: status,
          updated_at: new Date()
        });

      auditLog('COMPANY_BILL_STATUS_UPDATED', userId, {
        invoiceId: id,
        invoiceNumber: invoice.invoice_number,
        oldStatus: invoice.bill_status,
        newStatus: status
      });

      logger.info('Company bill status updated', {
        invoiceId: id,
        invoiceNumber: invoice.invoice_number,
        oldStatus: invoice.bill_status,
        newStatus: status,
        userId
      });

      res.json({
        success: true,
        message: `Company bill status updated to "${status}"`,
        data: { bill_status: status }
      });

    } catch (error) {
      logger.error('Error updating company bill status', {
        error: error.message,
        invoiceId: req.params.id,
        userId: req.user.userId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to update company bill status'
      });
    }
  }
);

// GET /api/purchase-invoices/unlinked-company-bills - Get company bills available for linking
// Returns company bills with status 'sent' that are not linked to any vendor bill
router.get('/unlinked-company-bills',
  requirePermission('VIEW_PURCHASE'),
  async (req, res) => {
    try {
      const { companyId } = req.user;
      const db = getDbConnection(companyId);
      const { supplierId } = req.query;

      // Get all vendor bills with covers_company_bills
      const vendorBills = await db('purchase_invoices')
        .where('bill_type', 'vendor')
        .whereNotNull('covers_company_bills')
        .select('covers_company_bills');

      // Build set of already linked company bill IDs
      const linkedIds = new Set();
      vendorBills.forEach(vb => {
        const covered = typeof vb.covers_company_bills === 'string'
          ? JSON.parse(vb.covers_company_bills)
          : vb.covers_company_bills;
        if (Array.isArray(covered)) {
          covered.forEach(id => linkedIds.add(id));
        }
      });

      // Get company bills that are 'sent' and not linked
      let query = db('purchase_invoices')
        .leftJoin('purchase_orders', 'purchase_invoices.purchase_order_id', 'purchase_orders.id')
        .leftJoin('suppliers', 'purchase_invoices.supplier_id', 'suppliers.id')
        .where('purchase_invoices.bill_type', 'company')
        .where('purchase_invoices.bill_status', 'sent')
        .select(
          'purchase_invoices.id',
          'purchase_invoices.invoice_number',
          'purchase_invoices.invoice_amount',
          'purchase_invoices.invoice_date',
          'purchase_invoices.supplier_id',
          'purchase_invoices.purchase_order_id',
          'purchase_invoices.bill_status',
          'purchase_orders.orderNumber',
          'suppliers.name as supplierName'
        );

      // Filter by supplier if provided
      if (supplierId) {
        query = query.where('purchase_invoices.supplier_id', supplierId);
      }

      const companyBills = await query.orderBy('purchase_invoices.invoice_date', 'desc');

      // Filter out already linked bills
      const unlinkedBills = companyBills
        .filter(cb => !linkedIds.has(cb.id))
        .map(cb => ({
          ...cb,
          invoice_amount: parseFloat(cb.invoice_amount) || 0
        }));

      res.json({
        success: true,
        data: unlinkedBills
      });

    } catch (error) {
      logger.error('Error fetching unlinked company bills', {
        error: error.message,
        userId: req.user.userId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch unlinked company bills'
      });
    }
  }
);

// POST /api/purchase-invoices/reset-orphan-payments - Reset payments on orphan company bills
// Company bills without vendor bills should not have been paid directly
router.post('/reset-orphan-payments',
  requirePermission('CREATE_PURCHASE'),
  async (req, res) => {
    try {
      const { companyId, userId } = req.user;
      const db = getDbConnection(companyId);

      // Find all company bills with payments
      const companyBillsWithPayments = await db('purchase_invoices')
        .where('bill_type', 'company')
        .where('paid_amount', '>', 0)
        .select('id', 'invoice_number', 'purchase_order_id', 'invoice_amount', 'paid_amount', 'payment_status');

      // Get all vendor bills to check which company bills are linked
      const vendorBills = await db('purchase_invoices')
        .where('bill_type', 'vendor')
        .whereNotNull('covers_purchase_orders')
        .select('id', 'invoice_number', 'covers_purchase_orders');

      // Build a set of PO IDs that are covered by vendor bills
      const coveredPOIds = new Set();
      vendorBills.forEach(vb => {
        const covered = typeof vb.covers_purchase_orders === 'string'
          ? JSON.parse(vb.covers_purchase_orders)
          : vb.covers_purchase_orders;
        if (Array.isArray(covered)) {
          covered.forEach(poId => coveredPOIds.add(poId));
        }
      });

      // Find orphan company bills (those with payments but no linked vendor bill)
      const orphanBillsToReset = companyBillsWithPayments.filter(cb =>
        !coveredPOIds.has(cb.purchase_order_id)
      );

      const resets = [];

      for (const bill of orphanBillsToReset) {
        await db('purchase_invoices')
          .where({ id: bill.id })
          .update({
            paid_amount: 0,
            payment_status: 'unpaid',
            updated_at: new Date()
          });

        resets.push({
          id: bill.id,
          invoiceNumber: bill.invoice_number,
          oldPaidAmount: parseFloat(bill.paid_amount),
          oldStatus: bill.payment_status,
          newPaidAmount: 0,
          newStatus: 'unpaid'
        });
      }

      auditLog('ORPHAN_COMPANY_BILLS_RESET', userId, {
        totalCompanyBillsWithPayments: companyBillsWithPayments.length,
        orphanBillsReset: resets.length,
        resets
      });

      logger.info('Orphan company bills reset completed', {
        userId,
        companyId,
        reset: resets.length
      });

      res.json({
        success: true,
        data: {
          checked: companyBillsWithPayments.length,
          reset: resets.length,
          details: resets
        },
        message: `Reset payments on ${resets.length} orphan company bill(s)`
      });

    } catch (error) {
      logger.error('Error resetting orphan company bill payments', {
        error: error.message,
        userId: req.user.userId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to reset orphan company bill payments'
      });
    }
  }
);

// POST /api/purchase-invoices/sync-prefixes - Add bill type prefixes to existing invoices
// This adds CB-/VB- prefix to invoices that don't have them
router.post('/sync-prefixes',
  requirePermission('CREATE_PURCHASE'),
  async (req, res) => {
    try {
      const { companyId, userId } = req.user;
      const db = getDbConnection(companyId);

      // Find all invoices without proper prefix
      const allInvoices = await db('purchase_invoices')
        .select('id', 'invoice_number', 'bill_type');

      const updates = [];

      for (const invoice of allInvoices) {
        const expectedPrefix = BILL_PREFIXES[invoice.bill_type] || '';
        const hasCorrectPrefix = invoice.invoice_number.startsWith(expectedPrefix);
        const hasOtherPrefix = invoice.invoice_number.startsWith(BILL_PREFIXES.company) ||
                               invoice.invoice_number.startsWith(BILL_PREFIXES.vendor);

        if (!hasCorrectPrefix) {
          const newInvoiceNumber = ensureBillPrefix(invoice.invoice_number, invoice.bill_type);

          // Check if new number already exists
          const existing = await db('purchase_invoices')
            .where({ invoice_number: newInvoiceNumber })
            .whereNot({ id: invoice.id })
            .first();

          if (!existing) {
            await db('purchase_invoices')
              .where({ id: invoice.id })
              .update({
                invoice_number: newInvoiceNumber,
                updated_at: new Date()
              });

            updates.push({
              id: invoice.id,
              oldNumber: invoice.invoice_number,
              newNumber: newInvoiceNumber,
              billType: invoice.bill_type
            });
          } else {
            logger.warn('Skipped prefix update - duplicate would occur', {
              invoiceId: invoice.id,
              oldNumber: invoice.invoice_number,
              newNumber: newInvoiceNumber
            });
          }
        }
      }

      auditLog('PURCHASE_INVOICES_PREFIX_SYNC', userId, {
        invoicesChecked: allInvoices.length,
        invoicesUpdated: updates.length,
        updates
      });

      logger.info('Invoice prefix sync completed', {
        userId,
        companyId,
        updated: updates.length
      });

      res.json({
        success: true,
        data: {
          checked: allInvoices.length,
          updated: updates.length,
          details: updates
        },
        message: `Added prefix to ${updates.length} invoice(s)`
      });

    } catch (error) {
      logger.error('Error syncing invoice prefixes', {
        error: error.message,
        userId: req.user.userId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to sync invoice prefixes'
      });
    }
  }
);

// POST /api/purchase-invoices/sync-status - Sync payment status for all invoices
// This fixes any data inconsistencies where balance=0 but status!='paid'
router.post('/sync-status',
  requirePermission('CREATE_PURCHASE'),
  async (req, res) => {
    try {
      const { companyId, userId } = req.user;
      const db = getDbConnection(companyId);

      // Find all invoices where status doesn't match balance
      const inconsistentInvoices = await db('purchase_invoices')
        .whereRaw(`
          (payment_status != 'paid' AND paid_amount >= invoice_amount) OR
          (payment_status = 'paid' AND paid_amount < invoice_amount) OR
          (payment_status = 'unpaid' AND paid_amount > 0 AND paid_amount < invoice_amount)
        `)
        .select('id', 'invoice_number', 'invoice_amount', 'paid_amount', 'payment_status', 'due_date');

      const updates = [];

      for (const invoice of inconsistentInvoices) {
        const invoiceAmount = parseFloat(invoice.invoice_amount) || 0;
        const paidAmount = parseFloat(invoice.paid_amount) || 0;
        const balance = invoiceAmount - paidAmount;

        let correctStatus;
        if (balance <= 0.001) { // Use small tolerance for floating-point
          correctStatus = 'paid';
        } else if (paidAmount <= 0.001) {
          // Check if overdue
          if (invoice.due_date && new Date(invoice.due_date) < new Date()) {
            correctStatus = 'overdue';
          } else {
            correctStatus = 'unpaid';
          }
        } else {
          // Partially paid
          if (invoice.due_date && new Date(invoice.due_date) < new Date()) {
            correctStatus = 'overdue';
          } else {
            correctStatus = 'partial';
          }
        }

        if (correctStatus !== invoice.payment_status) {
          await db('purchase_invoices')
            .where({ id: invoice.id })
            .update({
              payment_status: correctStatus,
              updated_at: new Date()
            });

          updates.push({
            id: invoice.id,
            invoiceNumber: invoice.invoice_number,
            oldStatus: invoice.payment_status,
            newStatus: correctStatus,
            balance: balance
          });
        }
      }

      auditLog('PURCHASE_INVOICES_STATUS_SYNC', userId, {
        invoicesChecked: inconsistentInvoices.length,
        invoicesFixed: updates.length,
        fixes: updates
      });

      logger.info('Payment status sync completed', {
        userId,
        companyId,
        fixed: updates.length
      });

      res.json({
        success: true,
        data: {
          checked: inconsistentInvoices.length,
          fixed: updates.length,
          details: updates
        },
        message: `Synced ${updates.length} invoice(s) payment status`
      });

    } catch (error) {
      logger.error('Error syncing invoice payment status', {
        error: error.message,
        userId: req.user.userId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to sync payment status'
      });
    }
  }
);

// POST /api/purchase-invoices/:id/attachment - Upload invoice attachment
router.post('/:id/attachment',
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  requirePermission('CREATE_PURCHASE'),
  (req, res, next) => {
    req.params.type = 'invoices';
    next();
  },
  uploadSingle,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { companyId, userId } = req.user;
      const db = getDbConnection(companyId);

      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: 'No file uploaded'
        });
      }

      // Update invoice with attachment filename
      await db('purchase_invoices')
        .where({ id })
        .update({
          attachment: `invoices/${req.file.filename}`,
          updated_at: new Date()
        });

      res.json({
        success: true,
        data: {
          filename: req.file.filename,
          originalName: req.file.originalname,
          path: `invoices/${req.file.filename}`
        },
        message: 'Invoice attachment uploaded successfully'
      });

    } catch (error) {
      logger.error('Error uploading invoice attachment', {
        error: error.message,
        invoiceId: req.params.id,
        userId: req.user.userId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to upload invoice attachment'
      });
    }
  }
);

module.exports = router;
