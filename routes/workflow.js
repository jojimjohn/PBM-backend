/**
 * Workflow Management Routes
 *
 * Provides unified workflow status tracking and pending action management
 * across all business processes: Collections → WCN → PO → Bills → Payments
 */

const express = require('express');
const router = express.Router();
const Joi = require('joi');
const { authenticateToken, requirePermission } = require('../middleware/auth');
const { validate } = require('../middleware/validation');
const { getDbConnection } = require('../config/database');
const { logger } = require('../utils/logger');

// Apply authentication to all workflow routes
router.use(authenticateToken);

/**
 * GET /api/workflow/pending-actions
 *
 * Returns unified list of pending actions across all workflows
 * Grouped by urgency (high/normal) with actionable next steps
 */
router.get('/pending-actions',
  requirePermission('VIEW_PURCHASE'),
  async (req, res) => {
    const { companyId, user } = req;

    try {
      const db = getDbConnection(companyId);
      const pendingActions = {
        high: [],
        normal: [],
        stats: {
          totalPending: 0,
          highPriority: 0,
          normalPriority: 0
        }
      };

      // 1. WCNs Pending Finalization (High Priority if >2 days)
      const pendingWCNs = await db('collection_orders as co')
        .leftJoin('contracts as c', 'co.contractId', 'c.id')
        .leftJoin('suppliers as s', 'c.supplierId', 's.id')
        .select(
          'co.id',
          'co.orderNumber',
          'co.status',
          'co.completedAt',
          'co.is_finalized',
          'co.wcn_number',
          'c.contractNumber',
          's.name as supplierName',
          db.raw('DATEDIFF(NOW(), co.completedAt) as daysPending')
        )
        .where('co.status', 'completed')
        .where('co.is_finalized', 0)
        .whereNotNull('co.completedAt')
        .orderBy('co.completedAt', 'asc');

      pendingWCNs.forEach(wcn => {
        const action = {
          type: 'wcn_finalization',
          entityType: 'collection',
          entityId: wcn.id,
          entityNumber: wcn.orderNumber,
          title: `Finalize WCN for Collection ${wcn.orderNumber}`,
          description: `Completed ${wcn.daysPending} days ago - Inventory not yet updated`,
          urgency: wcn.daysPending >= 2 ? 'high' : 'normal',
          daysPending: wcn.daysPending,
          metadata: {
            contractNumber: wcn.contractNumber,
            supplierName: wcn.supplierName,
            completedAt: wcn.completedAt
          },
          actionLabel: 'Finalize WCN',
          actionRoute: `/purchase?tab=collections&action=finalize&id=${wcn.id}`
        };

        if (action.urgency === 'high') {
          pendingActions.high.push(action);
          pendingActions.stats.highPriority++;
        } else {
          pendingActions.normal.push(action);
          pendingActions.stats.normalPriority++;
        }
        pendingActions.stats.totalPending++;
      });

      // 2. Purchase Orders Awaiting Receipt
      const pendingReceipt = await db('purchase_orders as po')
        .leftJoin('suppliers as s', 'po.supplierId', 's.id')
        .select(
          'po.id',
          'po.orderNumber',
          'po.status',
          'po.source_type',
          'po.orderDate',
          'po.expectedDeliveryDate',
          'po.totalAmount',
          's.name as supplierName',
          db.raw('DATEDIFF(NOW(), po.orderDate) as daysPending'),
          db.raw('DATEDIFF(po.expectedDeliveryDate, NOW()) as daysUntilExpected')
        )
        .whereIn('po.status', ['approved', 'sent'])
        .orderBy('po.expectedDeliveryDate', 'asc');

      pendingReceipt.forEach(po => {
        const isOverdue = po.daysUntilExpected < 0;
        const action = {
          type: 'po_receipt',
          entityType: 'purchase_order',
          entityId: po.id,
          entityNumber: po.orderNumber,
          title: `Receive Purchase Order ${po.orderNumber}`,
          description: isOverdue
            ? `Overdue by ${Math.abs(po.daysUntilExpected)} days`
            : `Expected in ${po.daysUntilExpected} days`,
          urgency: isOverdue ? 'high' : 'normal',
          daysPending: po.daysPending,
          metadata: {
            supplierName: po.supplierName,
            totalAmount: po.totalAmount,
            expectedDeliveryDate: po.expectedDeliveryDate,
            sourceType: po.source_type
          },
          actionLabel: 'Mark as Received',
          actionRoute: `/purchase?tab=orders&action=receive&id=${po.id}`
        };

        if (action.urgency === 'high') {
          pendingActions.high.push(action);
          pendingActions.stats.highPriority++;
        } else {
          pendingActions.normal.push(action);
          pendingActions.stats.normalPriority++;
        }
        pendingActions.stats.totalPending++;
      });

      // 3. Received POs Without Company Bills
      const pendingBills = await db('purchase_orders as po')
        .leftJoin('suppliers as s', 'po.supplierId', 's.id')
        .leftJoin('purchase_invoices as pi', function() {
          this.on('po.id', '=', 'pi.purchase_order_id')
            .andOn('pi.bill_type', '=', db.raw('?', ['company']))
        })
        .select(
          'po.id',
          'po.orderNumber',
          'po.status',
          'po.source_type',
          'po.totalAmount',
          's.name as supplierName',
          'po.actualDeliveryDate',
          db.raw('DATEDIFF(NOW(), po.actualDeliveryDate) as daysPending')
        )
        .whereIn('po.status', ['received', 'completed'])
        .whereNull('pi.id') // No company bill exists
        .orderBy('po.actualDeliveryDate', 'asc');

      pendingBills.forEach(po => {
        const action = {
          type: 'generate_bill',
          entityType: 'purchase_order',
          entityId: po.id,
          entityNumber: po.orderNumber,
          title: `Generate Company Bill for ${po.orderNumber}`,
          description: `Received ${po.daysPending} days ago - No bill generated`,
          urgency: po.daysPending >= 3 ? 'high' : 'normal',
          daysPending: po.daysPending,
          metadata: {
            supplierName: po.supplierName,
            totalAmount: po.totalAmount,
            sourceType: po.source_type,
            actualDeliveryDate: po.actualDeliveryDate
          },
          actionLabel: 'Generate Bill',
          actionRoute: `/purchase?tab=orders&action=generate-bill&id=${po.id}`
        };

        if (action.urgency === 'high') {
          pendingActions.high.push(action);
          pendingActions.stats.highPriority++;
        } else {
          pendingActions.normal.push(action);
          pendingActions.stats.normalPriority++;
        }
        pendingActions.stats.totalPending++;
      });

      // 4. Invoices with Upcoming/Overdue Payments (if bill has dueDate)
      const pendingPayments = await db('purchase_invoices as pi')
        .leftJoin('purchase_orders as po', 'pi.purchase_order_id', 'po.id')
        .leftJoin('suppliers as s', 'pi.supplier_id', 's.id')
        .select(
          'pi.id',
          'pi.invoice_number',
          'pi.bill_type',
          'pi.invoice_amount',
          'pi.due_date',
          'pi.payment_status',
          's.name as supplierName',
          'po.orderNumber',
          db.raw('DATEDIFF(pi.due_date, NOW()) as daysUntilDue'),
          db.raw('DATEDIFF(NOW(), pi.due_date) as daysOverdue')
        )
        .where('pi.payment_status', '!=', 'paid')
        .whereNotNull('pi.due_date')
        .where(function() {
          this.where('pi.due_date', '<=', db.raw('DATE_ADD(NOW(), INTERVAL 7 DAY)'))
        })
        .orderBy('pi.due_date', 'asc');

      pendingPayments.forEach(invoice => {
        const isOverdue = invoice.daysOverdue > 0;
        const action = {
          type: 'record_payment',
          entityType: 'invoice',
          entityId: invoice.id,
          entityNumber: invoice.invoice_number,
          title: `Payment ${isOverdue ? 'Overdue' : 'Due Soon'} - ${invoice.invoice_number}`,
          description: isOverdue
            ? `Overdue by ${invoice.daysOverdue} days - OMR ${invoice.invoice_amount}`
            : `Due in ${invoice.daysUntilDue} days - OMR ${invoice.invoice_amount}`,
          urgency: isOverdue || invoice.daysUntilDue <= 2 ? 'high' : 'normal',
          daysPending: isOverdue ? invoice.daysOverdue : -invoice.daysUntilDue,
          metadata: {
            supplierName: invoice.supplierName,
            totalAmount: invoice.invoice_amount,
            billType: invoice.bill_type,
            poNumber: invoice.orderNumber,
            dueDate: invoice.due_date
          },
          actionLabel: 'Record Payment',
          actionRoute: `/purchase?tab=orders&action=record-payment&invoice=${invoice.id}`
        };

        if (action.urgency === 'high') {
          pendingActions.high.push(action);
          pendingActions.stats.highPriority++;
        } else {
          pendingActions.normal.push(action);
          pendingActions.stats.normalPriority++;
        }
        pendingActions.stats.totalPending++;
      });

      // 5. Contracts Expiring Soon (if contracts exist)
      if (companyId === 'al-ramrami') {
        const expiringContracts = await db('contracts as c')
          .leftJoin('suppliers as s', 'c.supplierId', 's.id')
          .select(
            'c.id',
            'c.contractNumber',
            'c.status',
            'c.endDate',
            's.name as supplierName',
            db.raw('DATEDIFF(c.endDate, NOW()) as daysUntilExpiry')
          )
          .where('c.status', 'active')
          .where('c.endDate', '<=', db.raw('DATE_ADD(NOW(), INTERVAL 30 DAY)'))
          .orderBy('c.endDate', 'asc');

        expiringContracts.forEach(contract => {
          const action = {
            type: 'contract_renewal',
            entityType: 'contract',
            entityId: contract.id,
            entityNumber: contract.contractNumber,
            title: `Contract Expiring - ${contract.contractNumber}`,
            description: `Expires in ${contract.daysUntilExpiry} days - ${contract.supplierName}`,
            urgency: contract.daysUntilExpiry <= 7 ? 'high' : 'normal',
            daysPending: 30 - contract.daysUntilExpiry, // Days since entered 30-day window
            metadata: {
              supplierName: contract.supplierName,
              endDate: contract.endDate,
              daysUntilExpiry: contract.daysUntilExpiry
            },
            actionLabel: 'Review Contract',
            actionRoute: `/contracts?action=view&id=${contract.id}`
          };

          if (action.urgency === 'high') {
            pendingActions.high.push(action);
            pendingActions.stats.highPriority++;
          } else {
            pendingActions.normal.push(action);
            pendingActions.stats.normalPriority++;
          }
          pendingActions.stats.totalPending++;
        });
      }

      // Sort by days pending (most urgent first)
      pendingActions.high.sort((a, b) => b.daysPending - a.daysPending);
      pendingActions.normal.sort((a, b) => b.daysPending - a.daysPending);

      logger.info(`Retrieved pending actions for company ${companyId}: ${pendingActions.stats.totalPending} total (${pendingActions.stats.highPriority} high priority)`, {
        companyId,
        userId: user.id
      });

      res.json({
        success: true,
        data: pendingActions
      });

    } catch (error) {
      logger.error('Error retrieving pending actions:', {
        error: error.message,
        stack: error.stack,
        companyId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve pending actions',
        message: error.message
      });
    }
  }
);

/**
 * GET /api/workflow/activity
 *
 * Returns recent activity feed across all workflows
 * Shows last 50 actions: WCN finalizations, PO receipts, bills, payments
 */
router.get('/activity',
  requirePermission('VIEW_PURCHASE'),
  async (req, res) => {
    const { companyId, user } = req;
    const limit = parseInt(req.query.limit) || 50;

    try {
      const db = getDbConnection(companyId);
      const activities = [];

      // 1. Recent WCN Finalizations
      const recentWCNs = await db('collection_orders as co')
        .leftJoin('contracts as c', 'co.contractId', 'c.id')
        .leftJoin('suppliers as s', 'c.supplierId', 's.id')
        .leftJoin('purchase_orders as po', 'co.purchase_order_id', 'po.id')
        .leftJoin('users as u', 'co.finalized_by', 'u.id')
        .select(
          'co.id',
          'co.orderNumber',
          'co.wcn_number',
          'co.finalized_at as timestamp',
          'co.purchase_order_id',
          'po.orderNumber as poNumber',
          's.name as supplierName',
          'u.name as userName',
          db.raw("'wcn_finalization' as activityType")
        )
        .where('co.is_finalized', 1)
        .whereNotNull('co.finalized_at')
        .orderBy('co.finalized_at', 'desc')
        .limit(limit);

      recentWCNs.forEach(wcn => {
        activities.push({
          type: 'wcn_finalization',
          timestamp: wcn.timestamp,
          entityType: 'collection',
          entityId: wcn.id,
          entityNumber: wcn.orderNumber,
          title: `WCN ${wcn.wcn_number} finalized`,
          description: `Auto-generated PO ${wcn.poNumber} | ${wcn.supplierName}`,
          user: wcn.userName,
          icon: 'check-circle',
          route: `/purchase?tab=collections&id=${wcn.id}`
        });
      });

      // 2. Recent PO Receipts
      const recentReceipts = await db('purchase_orders as po')
        .leftJoin('suppliers as s', 'po.supplierId', 's.id')
        .select(
          'po.id',
          'po.orderNumber',
          'po.source_type',
          'po.actualDeliveryDate as timestamp',
          'po.totalAmount',
          's.name as supplierName',
          db.raw("'po_receipt' as activityType")
        )
        .whereIn('po.status', ['received', 'completed'])
        .whereNotNull('po.actualDeliveryDate')
        .orderBy('po.actualDeliveryDate', 'desc')
        .limit(limit);

      recentReceipts.forEach(po => {
        activities.push({
          type: 'po_receipt',
          timestamp: po.timestamp,
          entityType: 'purchase_order',
          entityId: po.id,
          entityNumber: po.orderNumber,
          title: `PO ${po.orderNumber} received`,
          description: `OMR ${po.totalAmount} | ${po.supplierName} | ${po.source_type === 'wcn_auto' ? 'Auto-generated' : 'Manual'}`,
          icon: 'package',
          route: `/purchase?tab=orders&id=${po.id}`
        });
      });

      // 3. Recent Bill Generations
      const recentBills = await db('purchase_invoices as pi')
        .leftJoin('purchase_orders as po', 'pi.purchase_order_id', 'po.id')
        .leftJoin('suppliers as s', 'pi.supplier_id', 's.id')
        .select(
          'pi.id',
          'pi.invoice_number',
          'pi.bill_type',
          'pi.invoice_date as timestamp',
          'pi.invoice_amount',
          'po.orderNumber',
          's.name as supplierName',
          db.raw("'bill_generation' as activityType")
        )
        .orderBy('pi.invoice_date', 'desc')
        .limit(limit);

      recentBills.forEach(bill => {
        activities.push({
          type: 'bill_generation',
          timestamp: bill.timestamp,
          entityType: 'invoice',
          entityId: bill.id,
          entityNumber: bill.invoice_number,
          title: `${bill.bill_type === 'company' ? 'Company' : 'Vendor'} Bill ${bill.invoice_number}`,
          description: `OMR ${bill.invoice_amount} | PO ${bill.orderNumber} | ${bill.supplierName}`,
          icon: 'file-text',
          route: `/purchase?tab=orders&invoice=${bill.id}`
        });
      });

      // 4. Recent Payments
      const recentPayments = await db('purchase_invoices as pi')
        .leftJoin('suppliers as s', 'pi.supplier_id', 's.id')
        .select(
          'pi.id',
          'pi.invoice_number',
          'pi.updated_at as timestamp',
          'pi.invoice_amount',
          's.name as supplierName',
          db.raw("'payment' as activityType")
        )
        .where('pi.payment_status', 'paid')
        .whereNotNull('pi.updated_at')
        .orderBy('pi.updated_at', 'desc')
        .limit(limit);

      recentPayments.forEach(payment => {
        activities.push({
          type: 'payment',
          timestamp: payment.timestamp,
          entityType: 'invoice',
          entityId: payment.id,
          entityNumber: payment.invoice_number,
          title: `Payment processed - ${payment.invoice_number}`,
          description: `OMR ${payment.invoice_amount} paid to ${payment.supplierName}`,
          icon: 'dollar-sign',
          route: `/purchase?tab=orders&invoice=${payment.id}`
        });
      });

      // Sort all activities by timestamp descending
      activities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

      // Limit to requested count
      const limitedActivities = activities.slice(0, limit);

      logger.info(`Retrieved activity feed for company ${companyId}: ${limitedActivities.length} activities`, {
        companyId,
        userId: user.id
      });

      res.json({
        success: true,
        data: {
          activities: limitedActivities,
          total: limitedActivities.length
        }
      });

    } catch (error) {
      logger.error('Error retrieving activity feed:', {
        error: error.message,
        stack: error.stack,
        companyId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve activity feed',
        message: error.message
      });
    }
  }
);

/**
 * GET /api/workflow/stats
 *
 * Returns quick workflow statistics for dashboard widgets
 */
router.get('/stats',
  requirePermission('VIEW_PURCHASE'),
  async (req, res) => {
    const { companyId } = req;

    try {
      const db = getDbConnection(companyId);
      const stats = {};

      // Collections stats
      const collectionsStats = await db('collection_orders')
        .select(
          db.raw('COUNT(*) as total'),
          db.raw('SUM(CASE WHEN status = "completed" AND is_finalized = 0 THEN 1 ELSE 0 END) as pendingWCN'),
          db.raw('SUM(CASE WHEN is_finalized = 1 THEN 1 ELSE 0 END) as finalized')
        )
        .first();

      stats.collections = {
        total: collectionsStats.total || 0,
        pendingWCN: collectionsStats.pendingWCN || 0,
        finalized: collectionsStats.finalized || 0
      };

      // Purchase Orders stats
      const poStats = await db('purchase_orders')
        .select(
          db.raw('COUNT(*) as total'),
          db.raw('SUM(CASE WHEN status IN ("approved", "sent") THEN 1 ELSE 0 END) as pendingReceipt'),
          db.raw('SUM(CASE WHEN status IN ("received", "completed") THEN 1 ELSE 0 END) as received'),
          db.raw('SUM(CASE WHEN source_type = "wcn_auto" THEN 1 ELSE 0 END) as autoGenerated')
        )
        .first();

      stats.purchaseOrders = {
        total: poStats.total || 0,
        pendingReceipt: poStats.pendingReceipt || 0,
        received: poStats.received || 0,
        autoGenerated: poStats.autoGenerated || 0
      };

      // Invoices stats
      const invoiceStats = await db('purchase_invoices')
        .select(
          db.raw('COUNT(*) as total'),
          db.raw('SUM(CASE WHEN payment_status != "paid" THEN 1 ELSE 0 END) as unpaid'),
          db.raw('SUM(invoice_amount) as totalValue'),
          db.raw('SUM(CASE WHEN payment_status != "paid" THEN invoice_amount ELSE 0 END) as outstandingAmount')
        )
        .first();

      stats.invoices = {
        total: invoiceStats.total || 0,
        unpaid: invoiceStats.unpaid || 0,
        totalValue: invoiceStats.totalValue || 0,
        outstandingAmount: invoiceStats.outstandingAmount || 0
      };

      // Contracts stats (Al Ramrami only)
      if (companyId === 'al-ramrami') {
        const contractStats = await db('contracts')
          .select(
            db.raw('COUNT(*) as total'),
            db.raw('SUM(CASE WHEN status = "active" THEN 1 ELSE 0 END) as active'),
            db.raw('SUM(CASE WHEN status = "active" AND endDate <= DATE_ADD(NOW(), INTERVAL 30 DAY) THEN 1 ELSE 0 END) as expiringSoon')
          )
          .first();

        stats.contracts = {
          total: contractStats.total || 0,
          active: contractStats.active || 0,
          expiringSoon: contractStats.expiringSoon || 0
        };
      }

      res.json({
        success: true,
        data: stats
      });

    } catch (error) {
      logger.error('Error retrieving workflow stats:', {
        error: error.message,
        stack: error.stack,
        companyId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve workflow stats',
        message: error.message
      });
    }
  }
);

module.exports = router;
