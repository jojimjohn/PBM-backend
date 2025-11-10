const express = require('express');
const { validate, validateParams, sanitize } = require('../middleware/validation');
const { requirePermission } = require('../middleware/auth');
const { logger, auditLog } = require('../utils/logger');
const { getDbConnection } = require('../config/database');
const Joi = require('joi');

const router = express.Router();

// Apply sanitization to all routes
router.use(sanitize);

// Amendment creation validation schema
const amendmentSchema = Joi.object({
  originalOrderId: Joi.number().integer().positive().required(),
  reason: Joi.string().trim().min(10).max(1000).required(),
  changesSummary: Joi.object().optional(),
  // Updated PO fields (all amendable fields)
  orderDate: Joi.alternatives().try(Joi.date(), Joi.string().allow('').allow(null)).optional(),
  vendorId: Joi.number().integer().positive().allow(null).allow('').optional(),
  branchId: Joi.number().integer().positive().allow(null).allow('').optional(),
  paymentTerms: Joi.string().valid('immediate', 'net_30', 'net_60', 'net_90', 'advance', 'cod').optional(),
  expectedDeliveryDate: Joi.alternatives().try(Joi.date(), Joi.string().allow('').allow(null)).optional(),
  shippingCost: Joi.number().min(0).precision(3).optional(),
  notes: Joi.string().allow('').allow(null).optional(),
  items: Joi.array().items(Joi.object({
    id: Joi.number().integer().positive().optional(), // Existing item ID (for updates)
    materialId: Joi.number().integer().positive().required(),
    quantity: Joi.number().min(0.001).precision(3).required(),
    rate: Joi.number().min(0).precision(3).required(),
    amount: Joi.number().min(0).precision(3).required()
  })).optional()
}).options({ stripUnknown: true });

// Amendment approval schema
const approvalSchema = Joi.object({
  status: Joi.string().valid('approved', 'rejected').required(),
  notes: Joi.string().trim().allow('').optional()
}).options({ stripUnknown: true });

// GET /api/purchase-order-amendments - List all amendments
router.get('/', requirePermission('VIEW_PURCHASE'), async (req, res) => {
  try {
    const { companyId } = req.user;
    const db = getDbConnection(companyId);

    const {
      page = 1,
      limit = 50,
      originalOrderId = '',
      status = ''
    } = req.query;

    const offset = (page - 1) * limit;

    let query = db('purchase_order_amendments')
      .leftJoin('purchase_orders as original', 'purchase_order_amendments.original_order_id', 'original.id')
      .leftJoin('users as creator', 'purchase_order_amendments.amended_by', 'creator.id')
      .leftJoin('users as approver', 'purchase_order_amendments.approved_by', 'approver.id')
      .select(
        'purchase_order_amendments.*',
        'original.orderNumber as originalOrderNumber',
        db.raw('CONCAT(creator.firstName, " ", creator.lastName) as createdByName'),
        db.raw('CONCAT(approver.firstName, " ", approver.lastName) as approvedByName')
      );

    // Filter by original order
    if (originalOrderId) {
      query = query.where('purchase_order_amendments.original_order_id', originalOrderId);
    }

    // Filter by status
    if (status) {
      query = query.where('purchase_order_amendments.status', status);
    }

    // Get total count for pagination
    const totalQuery = query.clone();
    const [{ total }] = await totalQuery.count('* as total');

    // Get paginated results
    const amendments = await query
      .orderBy('purchase_order_amendments.amendment_date', 'desc')
      .orderBy('purchase_order_amendments.id', 'desc')
      .limit(limit)
      .offset(offset);

    // Parse JSON fields and convert DECIMAL to numbers
    const formattedAmendments = amendments.map(amendment => ({
      ...amendment,
      changes_summary: amendment.changes_summary
        ? (typeof amendment.changes_summary === 'string'
          ? JSON.parse(amendment.changes_summary)
          : amendment.changes_summary)
        : {},
      previous_total: parseFloat(amendment.previous_total) || 0,
      new_total: parseFloat(amendment.new_total) || 0
    }));

    res.json({
      success: true,
      data: formattedAmendments,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(total),
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    logger.error('Error fetching purchase order amendments', {
      error: error.message,
      userId: req.user.userId,
      companyId: req.user.companyId
    });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch purchase order amendments'
    });
  }
});

// GET /api/purchase-order-amendments/:id - Get specific amendment
router.get('/:id',
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  requirePermission('VIEW_PURCHASE'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      const amendment = await db('purchase_order_amendments')
        .leftJoin('purchase_orders as original', 'purchase_order_amendments.original_order_id', 'original.id')
        .leftJoin('users as creator', 'purchase_order_amendments.amended_by', 'creator.id')
        .leftJoin('users as approver', 'purchase_order_amendments.approved_by', 'approver.id')
        .select(
          'purchase_order_amendments.*',
          'original.orderNumber as originalOrderNumber',
          'original.totalAmount as originalTotalAmount',
          db.raw('CONCAT(creator.firstName, " ", creator.lastName) as createdByName'),
          db.raw('CONCAT(approver.firstName, " ", approver.lastName) as approvedByName')
        )
        .where('purchase_order_amendments.id', id)
        .first();

      if (!amendment) {
        return res.status(404).json({
          success: false,
          error: 'Amendment not found'
        });
      }

      // Parse JSON and convert DECIMAL
      const formattedAmendment = {
        ...amendment,
        changes_summary: amendment.changes_summary
          ? (typeof amendment.changes_summary === 'string'
            ? JSON.parse(amendment.changes_summary)
            : amendment.changes_summary)
          : {},
        previous_total: parseFloat(amendment.previous_total) || 0,
        new_total: parseFloat(amendment.new_total) || 0,
        originalTotalAmount: parseFloat(amendment.originalTotalAmount) || 0,
        amendedTotalAmount: parseFloat(amendment.amendedTotalAmount) || 0
      };

      res.json({
        success: true,
        data: formattedAmendment
      });

    } catch (error) {
      logger.error('Error fetching purchase order amendment', {
        error: error.message,
        amendmentId: req.params.id,
        userId: req.user.userId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch purchase order amendment'
      });
    }
  }
);

// POST /api/purchase-order-amendments - Create amendment proposal (doesn't create new PO)
router.post('/',
  validate(amendmentSchema),
  requirePermission('CREATE_PURCHASE'),
  async (req, res) => {
    try {
      const { companyId, userId } = req.user;
      const db = getDbConnection(companyId);
      const { originalOrderId, reason, changesSummary, ...proposedChanges } = req.body;

      // Start transaction
      await db.transaction(async (trx) => {
        // Get original order
        const originalOrder = await trx('purchase_orders')
          .where({ id: originalOrderId })
          .first();

        if (!originalOrder) {
          throw new Error('Original purchase order not found');
        }

        // Check if order can be amended (only draft can be edited, others need amendments)
        if (originalOrder.status === 'draft') {
          throw new Error('Draft orders can be edited directly. Use the Edit button instead.');
        }

        if (originalOrder.status === 'cancelled') {
          throw new Error('Cannot amend a cancelled purchase order');
        }

        // Check for pending amendment
        const pendingAmendment = await trx('purchase_order_amendments')
          .where({ original_order_id: originalOrderId, status: 'pending' })
          .first();

        if (pendingAmendment) {
          throw new Error('There is already a pending amendment for this purchase order');
        }

        // Get current amendment number
        const amendments = await trx('purchase_order_amendments')
          .where({ original_order_id: originalOrderId })
          .count('* as count')
          .first();

        const amendmentNumber = parseInt(amendments.count) + 1;

        // Get VAT rate from system settings
        const vatSetting = await trx('system_settings')
          .where({ company_id: req.user.companyId, setting_key: 'vat_rate_percentage' })
          .first();
        const taxPercent = vatSetting ? parseFloat(vatSetting.setting_value) : 5; // Default to 5 if not found

        // Calculate proposed totals
        let proposedSubtotal = parseFloat(originalOrder.subtotal);
        let proposedTaxAmount = parseFloat(originalOrder.taxAmount);
        let proposedTotalAmount = parseFloat(originalOrder.totalAmount);

        if (proposedChanges.items && proposedChanges.items.length > 0) {
          proposedSubtotal = proposedChanges.items.reduce((sum, item) =>
            sum + parseFloat(item.amount || 0), 0
          );
          proposedTaxAmount = (proposedSubtotal * taxPercent) / 100;
          proposedTotalAmount = proposedSubtotal + proposedTaxAmount +
            parseFloat(proposedChanges.shippingCost || originalOrder.shippingCost);
        } else if (proposedChanges.shippingCost) {
          proposedTotalAmount = proposedSubtotal + proposedTaxAmount +
            parseFloat(proposedChanges.shippingCost);
        }

        // Store proposed changes in JSON format
        const changesData = {
          orderDate: proposedChanges.orderDate || originalOrder.orderDate,
          supplierId: proposedChanges.vendorId || originalOrder.supplierId, // Map vendorId -> supplierId
          branch_id: proposedChanges.branchId || originalOrder.branch_id, // Map branchId -> branch_id
          paymentTerms: proposedChanges.paymentTerms || originalOrder.paymentTerms,
          expectedDeliveryDate: proposedChanges.expectedDeliveryDate || originalOrder.expectedDeliveryDate,
          shippingCost: proposedChanges.shippingCost || originalOrder.shippingCost,
          notes: proposedChanges.notes || originalOrder.notes,
          items: proposedChanges.items || null,
          subtotal: proposedSubtotal,
          taxAmount: proposedTaxAmount,
          totalAmount: proposedTotalAmount
        };

        // Create amendment record (NO new PO created - just the proposal)
        const [amendmentId] = await trx('purchase_order_amendments').insert({
          original_order_id: originalOrderId,
          amended_order_id: null, // No separate PO - will update original when approved
          amendment_number: amendmentNumber,
          amendment_date: new Date(),
          amended_by: userId,
          reason,
          changes_summary: JSON.stringify({
            ...changesSummary,
            proposed_changes: changesData
          }),
          previous_total: parseFloat(originalOrder.totalAmount),
          new_total: proposedTotalAmount,
          status: 'pending',
          created_at: new Date()
        });

        auditLog('PURCHASE_ORDER_AMENDMENT_CREATED', userId, {
          amendmentId,
          originalOrderId,
          originalOrderNumber: originalOrder.orderNumber,
          amendmentNumber,
          reason,
          previousTotal: originalOrder.totalAmount,
          newTotal: proposedTotalAmount
        });

        res.json({
          success: true,
          data: {
            amendmentId,
            amendmentNumber
          },
          message: 'Amendment proposal created successfully. Awaiting approval.'
        });
      });

    } catch (error) {
      logger.error('Error creating purchase order amendment', {
        error: error.message,
        userId: req.user.userId,
        body: req.body
      });
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to create purchase order amendment'
      });
    }
  }
);

// PUT /api/purchase-order-amendments/:id/approve - Approve or reject amendment
router.put('/:id/approve',
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  validate(approvalSchema),
  requirePermission('APPROVE_PURCHASE'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { status, notes } = req.body;
      const { companyId, userId } = req.user;
      const db = getDbConnection(companyId);

      await db.transaction(async (trx) => {
        // Get amendment
        const amendment = await trx('purchase_order_amendments')
          .where({ id })
          .first();

        if (!amendment) {
          throw new Error('Amendment not found');
        }

        if (amendment.status !== 'pending') {
          throw new Error('Amendment has already been processed');
        }

        // Update amendment status
        await trx('purchase_order_amendments')
          .where({ id })
          .update({
            status,
            approved_by: userId,
            approved_at: new Date()
          });

        if (status === 'approved') {
          // Parse proposed changes from amendment
          const changesSummary = typeof amendment.changes_summary === 'string'
            ? JSON.parse(amendment.changes_summary)
            : amendment.changes_summary;
          const proposedChanges = changesSummary.proposed_changes;

          if (!proposedChanges) {
            throw new Error('No proposed changes found in amendment');
          }

          // Get original order
          const originalOrder = await trx('purchase_orders')
            .where({ id: amendment.original_order_id })
            .first();

          // Apply changes to original PO (map to database field names)
          const updateData = {
            orderDate: proposedChanges.orderDate,
            supplierId: proposedChanges.supplierId, // Database uses supplierId
            branch_id: proposedChanges.branch_id, // Database uses branch_id
            paymentTerms: proposedChanges.paymentTerms,
            expectedDeliveryDate: proposedChanges.expectedDeliveryDate,
            shippingCost: proposedChanges.shippingCost,
            subtotal: proposedChanges.subtotal,
            taxAmount: proposedChanges.taxAmount,
            totalAmount: proposedChanges.totalAmount,
            notes: `${originalOrder.notes || ''}\n[Amendment #${amendment.amendment_number} applied: ${amendment.reason}]`.trim(),
            updated_at: new Date()
          };

          await trx('purchase_orders')
            .where({ id: amendment.original_order_id })
            .update(updateData);

          // Update items if changed
          if (proposedChanges.items && proposedChanges.items.length > 0) {
            // Delete old items
            await trx('purchase_order_items')
              .where({ purchaseOrderId: amendment.original_order_id })
              .del();

            // Insert new items
            const itemsData = proposedChanges.items.map(item => ({
              purchaseOrderId: amendment.original_order_id,
              materialId: parseInt(item.materialId),
              quantityOrdered: parseFloat(item.quantity),
              quantityReceived: 0,
              unitPrice: parseFloat(item.rate),
              totalPrice: parseFloat(item.amount),
              notes: item.notes || '',
              created_at: new Date(),
              updated_at: new Date()
            }));

            await trx('purchase_order_items').insert(itemsData);
          }

          auditLog('PURCHASE_ORDER_AMENDMENT_APPROVED', userId, {
            amendmentId: id,
            originalOrderId: amendment.original_order_id,
            amendmentNumber: amendment.amendment_number,
            previousTotal: amendment.previous_total,
            newTotal: amendment.new_total,
            notes
          });
        } else {
          // Rejected - original order unchanged, just log
          auditLog('PURCHASE_ORDER_AMENDMENT_REJECTED', userId, {
            amendmentId: id,
            originalOrderId: amendment.original_order_id,
            amendmentNumber: amendment.amendment_number,
            notes
          });
        }

        res.json({
          success: true,
          message: `Amendment ${status} successfully`
        });
      });

    } catch (error) {
      logger.error('Error approving/rejecting purchase order amendment', {
        error: error.message,
        amendmentId: req.params.id,
        userId: req.user.userId,
        status: req.body.status
      });
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to process amendment approval'
      });
    }
  }
);

module.exports = router;
