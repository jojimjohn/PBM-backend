const express = require('express');
const { validate, validateParams, sanitize } = require('../middleware/validation');
const { requirePermission } = require('../middleware/auth');
const { logger, auditLog } = require('../utils/logger');
const { getDbConnection } = require('../config/database');
const { uploadSingle, deleteFile } = require('../middleware/upload');
const Joi = require('joi');

const router = express.Router();

// Apply sanitization to all routes
router.use(sanitize);

// Purchase invoice validation schema
const purchaseInvoiceSchema = Joi.object({
  invoiceNumber: Joi.string().trim().required(),
  purchaseOrderId: Joi.number().integer().positive().required(),
  supplierId: Joi.number().integer().positive().required(),
  branchId: Joi.number().integer().positive().allow(null).optional(),
  invoiceDate: Joi.date().required(),
  dueDate: Joi.date().allow(null).optional(),
  invoiceAmount: Joi.number().min(0.01).precision(2).required(),
  paymentTermsDays: Joi.number().integer().min(0).default(0),
  notes: Joi.string().allow('').allow(null).optional()
}).options({ stripUnknown: true });

// Payment recording schema
const paymentSchema = Joi.object({
  amount: Joi.number().min(0.01).precision(2).required(),
  paymentDate: Joi.date().default(() => new Date()),
  paymentMethod: Joi.string().valid('cash', 'bank_transfer', 'cheque', 'card').default('bank_transfer'),
  reference: Joi.string().allow('').optional(),
  notes: Joi.string().allow('').allow(null).optional()
}).options({ stripUnknown: true });

// GET /api/purchase-invoices - List all purchase invoices
router.get('/', requirePermission('VIEW_PURCHASE'), async (req, res) => {
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

    // Convert DECIMAL strings to numbers
    const formattedInvoices = invoices.map(invoice => ({
      ...invoice,
      invoice_amount: parseFloat(invoice.invoice_amount) || 0,
      paid_amount: parseFloat(invoice.paid_amount) || 0,
      balance_due: parseFloat(invoice.balance_due) || 0
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

      // Convert DECIMAL strings to numbers
      const formattedInvoice = {
        ...invoice,
        invoice_amount: parseFloat(invoice.invoice_amount) || 0,
        paid_amount: parseFloat(invoice.paid_amount) || 0,
        balance_due: parseFloat(invoice.balance_due) || 0,
        orderTotalAmount: parseFloat(invoice.orderTotalAmount) || 0
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

// POST /api/purchase-invoices - Create new invoice from PO
router.post('/',
  validate(purchaseInvoiceSchema),
  requirePermission('CREATE_PURCHASE'),
  async (req, res) => {
    try {
      const { companyId, userId } = req.user;
      const db = getDbConnection(companyId);
      const invoiceData = req.body;

      // Verify purchase order exists
      const purchaseOrder = await db('purchase_orders')
        .where({ id: invoiceData.purchaseOrderId })
        .first();

      if (!purchaseOrder) {
        return res.status(404).json({
          success: false,
          error: 'Purchase order not found'
        });
      }

      // Check if invoice number already exists
      const existingInvoice = await db('purchase_invoices')
        .where({ invoice_number: invoiceData.invoiceNumber })
        .first();

      if (existingInvoice) {
        return res.status(400).json({
          success: false,
          error: 'Invoice number already exists'
        });
      }

      // Calculate due date if not provided
      let dueDate = invoiceData.dueDate;
      if (!dueDate && invoiceData.paymentTermsDays > 0) {
        const invoiceDate = new Date(invoiceData.invoiceDate);
        dueDate = new Date(invoiceDate);
        dueDate.setDate(dueDate.getDate() + invoiceData.paymentTermsDays);
      }

      // Create invoice
      const [invoiceId] = await db('purchase_invoices').insert({
        invoice_number: invoiceData.invoiceNumber,
        purchase_order_id: invoiceData.purchaseOrderId,
        supplier_id: invoiceData.supplierId,
        branch_id: invoiceData.branchId || purchaseOrder.branch_id,
        invoice_date: invoiceData.invoiceDate,
        due_date: dueDate,
        payment_status: 'unpaid',
        invoice_amount: invoiceData.invoiceAmount,
        paid_amount: 0,
        payment_terms_days: invoiceData.paymentTermsDays || 0,
        notes: invoiceData.notes,
        created_by: userId,
        created_at: new Date(),
        updated_at: new Date()
      });

      auditLog('PURCHASE_INVOICE_CREATED', userId, {
        invoiceId,
        invoiceNumber: invoiceData.invoiceNumber,
        purchaseOrderId: invoiceData.purchaseOrderId,
        orderNumber: purchaseOrder.orderNumber,
        amount: invoiceData.invoiceAmount
      });

      res.json({
        success: true,
        data: { id: invoiceId },
        message: 'Purchase invoice created successfully'
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

// PUT /api/purchase-invoices/:id - Update invoice
router.put('/:id',
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  validate(purchaseInvoiceSchema.fork(['purchaseOrderId', 'supplierId'], (schema) => schema.optional())),
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

      // Update invoice
      await db('purchase_invoices')
        .where({ id })
        .update({
          ...updateData,
          updated_at: new Date()
        });

      auditLog('PURCHASE_INVOICE_UPDATED', userId, {
        invoiceId: id,
        invoiceNumber: invoice.invoice_number,
        changes: updateData
      });

      res.json({
        success: true,
        message: 'Purchase invoice updated successfully'
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
      const { amount, paymentDate, paymentMethod, reference, notes } = req.body;

      await db.transaction(async (trx) => {
        // Get invoice
        const invoice = await trx('purchase_invoices')
          .where({ id })
          .first();

        if (!invoice) {
          throw new Error('Invoice not found');
        }

        // Calculate new paid amount and balance
        const currentPaid = parseFloat(invoice.paid_amount) || 0;
        const invoiceAmount = parseFloat(invoice.invoice_amount);
        const balanceDue = invoiceAmount - currentPaid;

        if (amount > balanceDue) {
          throw new Error(`Payment amount (${amount}) exceeds balance due (${balanceDue})`);
        }

        const newPaidAmount = currentPaid + amount;
        const newBalance = invoiceAmount - newPaidAmount;

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

        // Create transaction record for payment
        await trx('transactions').insert({
          transactionNumber: `INV-PAY-${invoice.invoice_number}-${Date.now()}`,
          transactionType: 'payment',
          referenceId: id,
          referenceType: 'purchase_invoice',
          amount: amount,
          transactionDate: paymentDate,
          description: `Payment for invoice ${invoice.invoice_number}${reference ? ` (Ref: ${reference})` : ''}`,
          notes: notes || '',
          createdBy: userId,
          created_at: new Date(),
          updated_at: new Date()
        });

        auditLog('PURCHASE_INVOICE_PAYMENT_RECORDED', userId, {
          invoiceId: id,
          invoiceNumber: invoice.invoice_number,
          paymentAmount: amount,
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
