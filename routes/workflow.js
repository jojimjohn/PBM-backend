/**
 * Workflow Management Routes
 *
 * Provides unified workflow status tracking and pending action management
 * across ALL business processes:
 * - Collections → WCN → PO → Bills → Payments
 * - Contracts (expiring, renewals)
 * - Inventory (low stock alerts)
 * - Petty Cash (card expiry, pending approvals)
 * - Wastage (pending approvals)
 * - Sales Orders (pending delivery, payments)
 * - Banking (unreconciled transactions)
 */

const express = require('express');
const router = express.Router();
const { authenticateToken, requirePermission } = require('../middleware/auth');
const { getDbConnection } = require('../config/database');
const { logger } = require('../utils/logger');
const { projectFilter, applyProjectFilter } = require('../middleware/projectFilter');

// Apply authentication to all workflow routes
router.use(authenticateToken);

/**
 * GET /api/workflow/pending-actions
 *
 * Returns unified list of pending actions across ALL workflows
 * Grouped by urgency (high/normal) with actionable next steps
 * Filtered by user's permissions - only shows tasks the user can act on
 */
router.get('/pending-actions',
  // Apply project filter middleware for project-based task filtering
  projectFilter,
  // No strict permission required - we filter based on user's actual permissions
  async (req, res) => {
    const user = req.user;
    const companyId = user.companyId;
    const userPermissions = user.permissions || [];
    const userRole = user.role || '';

    // Check if user has a specific permission
    const hasPermission = (permission) => {
      // Super admins and company admins see all
      if (userRole === 'SUPER_ADMIN' || userRole === 'COMPANY_ADMIN') return true;
      return userPermissions.includes(permission);
    };

    // Map task types to required permissions
    const taskPermissionMap = {
      // Purchase tasks
      wcn_finalization: 'VIEW_PURCHASE',
      po_receipt: 'VIEW_PURCHASE',
      generate_bill: 'VIEW_PURCHASE',
      // Finance/Accounting tasks
      record_payment: 'VIEW_FINANCIALS',
      bank_reconciliation: 'VIEW_FINANCIALS',
      // Contract tasks
      contract_renewal: 'VIEW_CONTRACTS',
      // Inventory tasks
      low_stock: 'VIEW_INVENTORY',
      // Petty Cash tasks
      petty_cash_expiry: 'MANAGE_PETTY_CASH',
      petty_cash_low_balance: 'MANAGE_PETTY_CASH',
      expense_approval: 'APPROVE_EXPENSES',
      // Wastage tasks
      wastage_approval: 'APPROVE_WASTAGE',
      // Sales tasks
      sales_delivery: 'VIEW_SALES',
      customer_payment: 'VIEW_SALES'
    };

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

      // Helper function to add action (only if user has permission)
      const addAction = (action) => {
        // Check if user has permission for this task type
        const requiredPermission = taskPermissionMap[action.type];
        if (requiredPermission && !hasPermission(requiredPermission)) {
          return; // Skip this task - user doesn't have permission
        }

        if (action.urgency === 'high') {
          pendingActions.high.push(action);
          pendingActions.stats.highPriority++;
        } else {
          pendingActions.normal.push(action);
          pendingActions.stats.normalPriority++;
        }
        pendingActions.stats.totalPending++;
      };

      // ============================================
      // 1. WCNs Pending Finalization (High Priority if >2 days)
      // FIXED: Using actualEndTime instead of completedAt
      // ============================================
      let pendingWCNsQuery = db('collection_orders as co')
        .leftJoin('contracts as c', 'co.contractId', 'c.id')
        .leftJoin('suppliers as s', 'c.supplierId', 's.id')
        .select(
          'co.id',
          'co.orderNumber',
          'co.status',
          'co.actualEndTime',
          'co.is_finalized',
          'co.wcn_number',
          'c.contractNumber',
          's.name as supplierName',
          db.raw('DATEDIFF(NOW(), co.actualEndTime) as daysPending')
        )
        .where('co.status', 'completed')
        .where('co.is_finalized', 0)
        .whereNotNull('co.actualEndTime')
        .orderBy('co.actualEndTime', 'asc');
      // Apply project filter
      pendingWCNsQuery = applyProjectFilter(pendingWCNsQuery, req.projectFilter, 'co.project_id');
      const pendingWCNs = await pendingWCNsQuery;

      pendingWCNs.forEach(wcn => {
        addAction({
          type: 'wcn_finalization',
          module: 'collections',
          entityType: 'collection',
          entityId: wcn.id,
          entityNumber: wcn.orderNumber,
          title: `Finalize WCN for Collection ${wcn.orderNumber}`,
          description: `Completed ${wcn.daysPending} days ago - Inventory not yet updated`,
          urgency: wcn.daysPending >= 2 ? 'high' : 'normal',
          daysPending: wcn.daysPending || 0,
          metadata: {
            contractNumber: wcn.contractNumber,
            supplierName: wcn.supplierName,
            completedAt: wcn.actualEndTime
          },
          actionLabel: 'Finalize WCN',
          actionRoute: `/purchase?tab=collections&action=finalize&id=${wcn.id}&search=${encodeURIComponent(wcn.orderNumber)}`
        });
      });

      // ============================================
      // 2. Purchase Orders Awaiting Receipt
      // ============================================
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
        addAction({
          type: 'po_receipt',
          module: 'purchase',
          entityType: 'purchase_order',
          entityId: po.id,
          entityNumber: po.orderNumber,
          title: `Receive Purchase Order ${po.orderNumber}`,
          description: isOverdue
            ? `Overdue by ${Math.abs(po.daysUntilExpected)} days`
            : po.daysUntilExpected !== null
              ? `Expected in ${po.daysUntilExpected} days`
              : `Awaiting receipt`,
          urgency: isOverdue ? 'high' : 'normal',
          daysPending: po.daysPending || 0,
          metadata: {
            supplierName: po.supplierName,
            totalAmount: po.totalAmount,
            expectedDeliveryDate: po.expectedDeliveryDate,
            sourceType: po.source_type
          },
          actionLabel: 'Mark as Received',
          actionRoute: `/purchase?tab=orders&action=receive&id=${po.id}&search=${encodeURIComponent(po.orderNumber)}`
        });
      });

      // ============================================
      // 3. Received POs Without Company Bills
      // ============================================
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
        .whereNull('pi.id')
        .whereNotNull('po.actualDeliveryDate')
        .orderBy('po.actualDeliveryDate', 'asc');

      pendingBills.forEach(po => {
        addAction({
          type: 'generate_bill',
          module: 'purchase',
          entityType: 'purchase_order',
          entityId: po.id,
          entityNumber: po.orderNumber,
          title: `Generate Company Bill for ${po.orderNumber}`,
          description: `Received ${po.daysPending || 0} days ago - No bill generated`,
          urgency: (po.daysPending || 0) >= 3 ? 'high' : 'normal',
          daysPending: po.daysPending || 0,
          metadata: {
            supplierName: po.supplierName,
            totalAmount: po.totalAmount,
            sourceType: po.source_type,
            actualDeliveryDate: po.actualDeliveryDate
          },
          actionLabel: 'Generate Bill',
          actionRoute: `/purchase?tab=orders&action=generate-bill&id=${po.id}&search=${encodeURIComponent(po.orderNumber)}`
        });
      });

      // ============================================
      // 4. Invoices with Upcoming/Overdue Payments
      // ============================================
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
        .where('pi.due_date', '<=', db.raw('DATE_ADD(NOW(), INTERVAL 7 DAY)'))
        .orderBy('pi.due_date', 'asc');

      pendingPayments.forEach(invoice => {
        const isOverdue = invoice.daysOverdue > 0;
        addAction({
          type: 'record_payment',
          module: 'purchase',
          entityType: 'invoice',
          entityId: invoice.id,
          entityNumber: invoice.invoice_number,
          title: `Payment ${isOverdue ? 'Overdue' : 'Due Soon'} - ${invoice.invoice_number}`,
          description: isOverdue
            ? `Overdue by ${invoice.daysOverdue} days - OMR ${invoice.invoice_amount}`
            : `Due in ${invoice.daysUntilDue} days - OMR ${invoice.invoice_amount}`,
          urgency: isOverdue || invoice.daysUntilDue <= 2 ? 'high' : 'normal',
          daysPending: isOverdue ? invoice.daysOverdue : Math.abs(invoice.daysUntilDue || 0),
          metadata: {
            supplierName: invoice.supplierName,
            totalAmount: invoice.invoice_amount,
            billType: invoice.bill_type,
            poNumber: invoice.orderNumber,
            dueDate: invoice.due_date
          },
          actionLabel: 'Record Payment',
          actionRoute: `/purchase?tab=bills&action=record-payment&invoice=${invoice.id}&search=${encodeURIComponent(invoice.invoice_number)}`
        });
      });

      // ============================================
      // 5. Contracts Expiring Soon (Al Ramrami only)
      // ============================================
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
          addAction({
            type: 'contract_renewal',
            module: 'contracts',
            entityType: 'contract',
            entityId: contract.id,
            entityNumber: contract.contractNumber,
            title: `Contract Expiring - ${contract.contractNumber}`,
            description: `Expires in ${contract.daysUntilExpiry} days - ${contract.supplierName}`,
            urgency: contract.daysUntilExpiry <= 7 ? 'high' : 'normal',
            daysPending: 30 - (contract.daysUntilExpiry || 0),
            metadata: {
              supplierName: contract.supplierName,
              endDate: contract.endDate,
              daysUntilExpiry: contract.daysUntilExpiry
            },
            actionLabel: 'Review Contract',
            actionRoute: `/contracts?action=view&id=${contract.id}&search=${encodeURIComponent(contract.contractNumber)}`
          });
        });
      }

      // ============================================
      // 6. Low Stock Inventory Alerts
      // ============================================
      try {
        const lowStockItems = await db('inventory as i')
          .join('materials as m', 'i.materialId', 'm.id')
          .select(
            'i.id',
            'i.materialId',
            'm.name as materialName',
            'm.unit',
            'i.quantity',
            'i.minimumStockLevel',
            db.raw('(i.minimumStockLevel - i.quantity) as deficit')
          )
          .whereRaw('i.quantity < i.minimumStockLevel')
          .where('i.minimumStockLevel', '>', 0)
          .orderByRaw('(i.quantity / i.minimumStockLevel) ASC')
          .limit(10);

        lowStockItems.forEach(item => {
          const percentRemaining = item.minimumStockLevel > 0
            ? Math.round((item.quantity / item.minimumStockLevel) * 100)
            : 0;
          addAction({
            type: 'low_stock',
            module: 'inventory',
            entityType: 'inventory',
            entityId: item.materialId,
            entityNumber: item.materialName,
            title: `Low Stock Alert - ${item.materialName}`,
            description: `${item.quantity} ${item.unit} remaining (${percentRemaining}% of minimum)`,
            urgency: percentRemaining <= 25 ? 'high' : 'normal',
            daysPending: 0,
            metadata: {
              currentStock: item.quantity,
              minLevel: item.minimumStockLevel,
              deficit: item.deficit,
              unit: item.unit
            },
            actionLabel: 'Create PO',
            actionRoute: `/inventory?highlight=${item.materialId}&search=${encodeURIComponent(item.materialName)}`
          });
        });
      } catch (err) {
        logger.warn('Could not fetch low stock items:', err.message);
      }

      // ============================================
      // 7. Petty Cash Cards Expiring/Low Balance
      // ============================================
      try {
        const pettyCashAlerts = await db('petty_cash_cards as pcc')
          .leftJoin('users as u', 'pcc.assigned_to', 'u.id')
          .select(
            'pcc.id',
            'pcc.card_number',
            'pcc.card_name',
            'pcc.current_balance',
            'pcc.monthly_limit',
            'pcc.expiry_date',
            'pcc.status',
            db.raw('CONCAT(u.firstName, " ", u.lastName) as assignedTo'),
            db.raw('DATEDIFF(pcc.expiry_date, NOW()) as daysUntilExpiry')
          )
          .where('pcc.status', 'active')
          .where(function() {
            this.where('pcc.current_balance', '<', db.raw('pcc.monthly_limit * 0.2'))
              .orWhere('pcc.expiry_date', '<=', db.raw('DATE_ADD(NOW(), INTERVAL 30 DAY)'))
          });

        pettyCashAlerts.forEach(card => {
          const isExpiring = card.daysUntilExpiry !== null && card.daysUntilExpiry <= 30;
          const isLowBalance = card.current_balance < (card.monthly_limit * 0.2);

          if (isExpiring) {
            addAction({
              type: 'petty_cash_expiry',
              module: 'petty-cash',
              entityType: 'petty_cash_card',
              entityId: card.id,
              entityNumber: card.card_number,
              title: `Card Expiring - ${card.card_name}`,
              description: `Expires in ${card.daysUntilExpiry} days - Assigned to ${card.assignedTo || 'Unassigned'}`,
              urgency: card.daysUntilExpiry <= 7 ? 'high' : 'normal',
              daysPending: 30 - (card.daysUntilExpiry || 0),
              metadata: {
                cardName: card.card_name,
                expiryDate: card.expiry_date,
                assignedTo: card.assignedTo
              },
              actionLabel: 'Renew Card',
              actionRoute: `/petty-cash?action=renew&id=${card.id}&search=${encodeURIComponent(card.card_number)}`
            });
          }

          if (isLowBalance) {
            const balancePercent = card.monthly_limit > 0
              ? Math.round((card.current_balance / card.monthly_limit) * 100)
              : 0;
            addAction({
              type: 'petty_cash_low_balance',
              module: 'petty-cash',
              entityType: 'petty_cash_card',
              entityId: card.id,
              entityNumber: card.card_number,
              title: `Low Balance - ${card.card_name}`,
              description: `OMR ${card.current_balance} remaining (${balancePercent}% of limit)`,
              urgency: balancePercent <= 10 ? 'high' : 'normal',
              daysPending: 0,
              metadata: {
                cardName: card.card_name,
                currentBalance: card.current_balance,
                monthlyLimit: card.monthly_limit,
                assignedTo: card.assignedTo
              },
              actionLabel: 'Reload Card',
              actionRoute: `/petty-cash?action=reload&id=${card.id}&search=${encodeURIComponent(card.card_number)}`
            });
          }
        });
      } catch (err) {
        logger.warn('Could not fetch petty cash alerts:', err.message);
      }

      // ============================================
      // 8. Petty Cash Expenses Pending Approval
      // ============================================
      try {
        const pendingExpenses = await db('petty_cash_expenses as pce')
          .join('petty_cash_cards as pcc', 'pce.card_id', 'pcc.id')
          .leftJoin('users as u', 'pce.submitted_by', 'u.id')
          .select(
            'pce.id',
            'pce.expense_number',
            'pce.amount',
            'pce.category',
            'pce.description',
            'pce.created_at',
            'pcc.card_name',
            db.raw('CONCAT(u.firstName, " ", u.lastName) as submittedBy'),
            db.raw('DATEDIFF(NOW(), pce.created_at) as daysPending')
          )
          .where('pce.status', 'pending')
          .orderBy('pce.created_at', 'asc')
          .limit(10);

        pendingExpenses.forEach(expense => {
          addAction({
            type: 'expense_approval',
            module: 'petty-cash',
            entityType: 'petty_cash_expense',
            entityId: expense.id,
            entityNumber: expense.expense_number,
            title: `Expense Pending Approval - ${expense.category}`,
            description: `OMR ${expense.amount} - ${expense.description?.substring(0, 50) || 'No description'} - ${expense.submittedBy || 'Unknown'}`,
            urgency: (expense.daysPending || 0) >= 3 ? 'high' : 'normal',
            daysPending: expense.daysPending || 0,
            metadata: {
              cardName: expense.card_name,
              amount: expense.amount,
              category: expense.category,
              submittedBy: expense.submittedBy
            },
            actionLabel: 'Review',
            actionRoute: `/petty-cash?tab=expenses&action=review&id=${expense.id}&search=${encodeURIComponent(expense.expense_number || '')}`
          });
        });
      } catch (err) {
        logger.warn('Could not fetch pending expenses:', err.message);
      }

      // ============================================
      // 9. Wastage Pending Approval
      // ============================================
      try {
        const pendingWastages = await db('wastages as w')
          .leftJoin('materials as m', 'w.materialId', 'm.id')
          .leftJoin('users as u', 'w.reportedBy', 'u.id')
          .select(
            'w.id',
            'w.wastageNumber',
            'w.quantity',
            'w.wasteType',
            'w.totalCost',
            'w.wastageDate',
            db.raw('COALESCE(m.name, "Unknown Material") as materialName'),
            db.raw('COALESCE(m.unit, "units") as unit'),
            db.raw('CONCAT(COALESCE(u.firstName, ""), " ", COALESCE(u.lastName, "")) as reportedBy'),
            db.raw('DATEDIFF(NOW(), COALESCE(w.wastageDate, NOW())) as daysPending')
          )
          .where('w.status', 'pending')
          .orderBy('w.wastageDate', 'asc')
          .limit(20);

        logger.info('Pending wastages found:', { count: pendingWastages.length, userRole, hasApprovePermission: hasPermission('APPROVE_WASTAGE') });

        pendingWastages.forEach(wastage => {
          addAction({
            type: 'wastage_approval',
            module: 'wastage',
            entityType: 'wastage',
            entityId: wastage.id,
            entityNumber: wastage.wastageNumber,
            title: `Wastage Pending Approval - ${wastage.materialName}`,
            description: `${wastage.quantity} ${wastage.unit} (${wastage.wasteType}) - OMR ${parseFloat(wastage.totalCost || 0).toFixed(3)}`,
            urgency: (wastage.daysPending || 0) >= 3 ? 'high' : 'normal',
            daysPending: wastage.daysPending || 0,
            metadata: {
              materialName: wastage.materialName,
              quantity: wastage.quantity,
              wasteType: wastage.wasteType,
              totalCost: wastage.totalCost,
              reportedBy: wastage.reportedBy
            },
            actionLabel: 'Review',
            actionRoute: `/wastage?action=review&id=${wastage.id}&search=${encodeURIComponent(wastage.wastageNumber || '')}`
          });
        });
      } catch (err) {
        logger.error('Could not fetch pending wastages:', { error: err.message, stack: err.stack });
      }

      // ============================================
      // 10. Sales Orders Pending Delivery
      // ============================================
      try {
        const pendingSales = await db('sales_orders as so')
          .leftJoin('customers as c', 'so.customerId', 'c.id')
          .select(
            'so.id',
            'so.orderNumber',
            'so.status',
            'so.totalAmount',
            'so.orderDate',
            'so.expectedDeliveryDate',
            'c.name as customerName',
            db.raw('DATEDIFF(NOW(), so.orderDate) as daysPending'),
            db.raw('DATEDIFF(so.expectedDeliveryDate, NOW()) as daysUntilExpected')
          )
          .whereIn('so.status', ['confirmed', 'processing'])
          .orderBy('so.expectedDeliveryDate', 'asc')
          .limit(10);

        pendingSales.forEach(so => {
          const isOverdue = so.daysUntilExpected !== null && so.daysUntilExpected < 0;
          addAction({
            type: 'sales_delivery',
            module: 'sales',
            entityType: 'sales_order',
            entityId: so.id,
            entityNumber: so.orderNumber,
            title: `Sales Order Pending Delivery - ${so.orderNumber}`,
            description: isOverdue
              ? `Overdue by ${Math.abs(so.daysUntilExpected)} days - ${so.customerName}`
              : so.daysUntilExpected !== null
                ? `Expected in ${so.daysUntilExpected} days - ${so.customerName}`
                : `Awaiting delivery - ${so.customerName}`,
            urgency: isOverdue ? 'high' : 'normal',
            daysPending: so.daysPending || 0,
            metadata: {
              customerName: so.customerName,
              totalAmount: so.totalAmount,
              expectedDeliveryDate: so.expectedDeliveryDate
            },
            actionLabel: 'Process Delivery',
            actionRoute: `/sales?action=deliver&id=${so.id}&search=${encodeURIComponent(so.orderNumber)}`
          });
        });
      } catch (err) {
        logger.warn('Could not fetch pending sales orders:', err.message);
      }

      // ============================================
      // 11. Customer Payments Due Soon (Receivables)
      // ============================================
      try {
        const pendingReceivables = await db('sales_orders as so')
          .leftJoin('customers as c', 'so.customerId', 'c.id')
          .select(
            'so.id',
            'so.orderNumber',
            'so.totalAmount',
            'so.actualDeliveryDate',
            'c.name as customerName',
            'c.paymentTermDays',
            db.raw('DATE_ADD(so.actualDeliveryDate, INTERVAL COALESCE(c.paymentTermDays, 30) DAY) as dueDate'),
            db.raw('DATEDIFF(DATE_ADD(so.actualDeliveryDate, INTERVAL COALESCE(c.paymentTermDays, 30) DAY), NOW()) as daysUntilDue')
          )
          .where('so.status', 'delivered')
          .where('so.paymentStatus', '!=', 'paid')
          .whereNotNull('so.actualDeliveryDate')
          .havingRaw('daysUntilDue <= 7 AND daysUntilDue >= 0')
          .orderByRaw('daysUntilDue ASC')
          .limit(10);

        pendingReceivables.forEach(so => {
          addAction({
            type: 'customer_payment',
            module: 'sales',
            entityType: 'sales_order',
            entityId: so.id,
            entityNumber: so.orderNumber,
            title: `Payment Due - ${so.orderNumber}`,
            description: so.daysUntilDue <= 0
              ? `Overdue - ${so.customerName}`
              : `Due in ${so.daysUntilDue} days - ${so.customerName}`,
            urgency: so.daysUntilDue <= 2 ? 'high' : 'normal',
            daysPending: Math.max(0, 7 - so.daysUntilDue),
            metadata: {
              customerName: so.customerName,
              totalAmount: so.totalAmount,
              dueDate: so.dueDate,
              paymentTerms: so.paymentTermDays || 30
            },
            actionLabel: 'Record Payment',
            actionRoute: `/sales?action=payment&id=${so.id}&search=${encodeURIComponent(so.orderNumber)}`
          });
        });
      } catch (err) {
        logger.warn('Could not fetch pending receivables:', err.message);
      }

      // ============================================
      // 12. Bank Transactions Pending Reconciliation
      // ============================================
      try {
        const unreconciledTxns = await db('bank_transactions as bt')
          .join('bank_accounts as ba', 'bt.account_id', 'ba.id')
          .select(
            'bt.id',
            'bt.reference_number',
            'bt.transaction_type',
            'bt.amount',
            'bt.transaction_date',
            'bt.description',
            'ba.account_name',
            db.raw('DATEDIFF(NOW(), bt.transaction_date) as daysPending')
          )
          .where('bt.reconciled', 0)
          .orderBy('bt.transaction_date', 'asc')
          .limit(10);

        unreconciledTxns.forEach(txn => {
          addAction({
            type: 'bank_reconciliation',
            module: 'banking',
            entityType: 'bank_transaction',
            entityId: txn.id,
            entityNumber: txn.reference_number,
            title: `Unreconciled ${txn.transaction_type === 'deposit' ? 'Deposit' : 'Withdrawal'}`,
            description: `OMR ${txn.amount} - ${txn.account_name} - ${txn.description?.substring(0, 30) || 'No description'}`,
            urgency: (txn.daysPending || 0) >= 7 ? 'high' : 'normal',
            daysPending: txn.daysPending || 0,
            metadata: {
              accountName: txn.account_name,
              amount: txn.amount,
              transactionType: txn.transaction_type,
              transactionDate: txn.transaction_date
            },
            actionLabel: 'Reconcile',
            actionRoute: `/banking?tab=transactions&action=reconcile&id=${txn.id}&search=${encodeURIComponent(txn.reference_number || '')}`
          });
        });
      } catch (err) {
        logger.warn('Could not fetch unreconciled transactions:', err.message);
      }

      // Sort by days pending (most urgent first)
      pendingActions.high.sort((a, b) => (b.daysPending || 0) - (a.daysPending || 0));
      pendingActions.normal.sort((a, b) => (b.daysPending || 0) - (a.daysPending || 0));

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
 * Shows last N actions across ALL modules
 */
router.get('/activity',
  requirePermission('VIEW_PURCHASE'),
  async (req, res) => {
    const user = req.user;
    const companyId = user.companyId;
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
          db.raw('CONCAT(u.firstName, " ", u.lastName) as userName')
        )
        .where('co.is_finalized', 1)
        .whereNotNull('co.finalized_at')
        .orderBy('co.finalized_at', 'desc')
        .limit(limit);

      recentWCNs.forEach(wcn => {
        activities.push({
          type: 'wcn_finalization',
          module: 'collections',
          timestamp: wcn.timestamp,
          entityType: 'collection',
          entityId: wcn.id,
          entityNumber: wcn.orderNumber,
          title: `WCN ${wcn.wcn_number || wcn.orderNumber} finalized`,
          description: wcn.poNumber
            ? `Auto-generated PO ${wcn.poNumber} | ${wcn.supplierName || 'Unknown supplier'}`
            : `${wcn.supplierName || 'Unknown supplier'}`,
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
          's.name as supplierName'
        )
        .whereIn('po.status', ['received', 'completed'])
        .whereNotNull('po.actualDeliveryDate')
        .orderBy('po.actualDeliveryDate', 'desc')
        .limit(limit);

      recentReceipts.forEach(po => {
        activities.push({
          type: 'po_receipt',
          module: 'purchase',
          timestamp: po.timestamp,
          entityType: 'purchase_order',
          entityId: po.id,
          entityNumber: po.orderNumber,
          title: `PO ${po.orderNumber} received`,
          description: `OMR ${po.totalAmount || 0} | ${po.supplierName || 'Unknown'} | ${po.source_type === 'wcn_auto' ? 'Auto-generated' : 'Manual'}`,
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
          's.name as supplierName'
        )
        .orderBy('pi.invoice_date', 'desc')
        .limit(limit);

      recentBills.forEach(bill => {
        activities.push({
          type: 'bill_generation',
          module: 'purchase',
          timestamp: bill.timestamp,
          entityType: 'invoice',
          entityId: bill.id,
          entityNumber: bill.invoice_number,
          title: `${bill.bill_type === 'company' ? 'Company' : 'Vendor'} Bill ${bill.invoice_number}`,
          description: `OMR ${bill.invoice_amount || 0} | PO ${bill.orderNumber || 'N/A'} | ${bill.supplierName || 'Unknown'}`,
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
          's.name as supplierName'
        )
        .where('pi.payment_status', 'paid')
        .whereNotNull('pi.updated_at')
        .orderBy('pi.updated_at', 'desc')
        .limit(limit);

      recentPayments.forEach(payment => {
        activities.push({
          type: 'payment',
          module: 'purchase',
          timestamp: payment.timestamp,
          entityType: 'invoice',
          entityId: payment.id,
          entityNumber: payment.invoice_number,
          title: `Payment processed - ${payment.invoice_number}`,
          description: `OMR ${payment.invoice_amount || 0} paid to ${payment.supplierName || 'Unknown'}`,
          icon: 'dollar-sign',
          route: `/purchase?tab=orders&invoice=${payment.id}`
        });
      });

      // 5. Recent Wastage Approvals
      try {
        const recentWastages = await db('wastages as w')
          .join('materials as m', 'w.materialId', 'm.id')
          .leftJoin('users as u', 'w.approvedBy', 'u.id')
          .select(
            'w.id',
            'w.wastageNumber',
            'w.quantity',
            'w.wastageType',
            'w.updated_at as timestamp',
            'm.name as materialName',
            'm.unit',
            db.raw('CONCAT(u.firstName, " ", u.lastName) as approvedBy')
          )
          .where('w.status', 'approved')
          .whereNotNull('w.updated_at')
          .orderBy('w.updated_at', 'desc')
          .limit(Math.floor(limit / 5));

        recentWastages.forEach(w => {
          activities.push({
            type: 'wastage_approved',
            module: 'wastage',
            timestamp: w.timestamp,
            entityType: 'wastage',
            entityId: w.id,
            entityNumber: w.wastageNumber,
            title: `Wastage approved - ${w.materialName}`,
            description: `${w.quantity} ${w.unit} (${w.wastageType}) - By ${w.approvedBy || 'System'}`,
            icon: 'trash-2',
            route: `/wastage?id=${w.id}`
          });
        });
      } catch (err) {
        logger.warn('Could not fetch wastage activity:', err.message);
      }

      // 6. Recent Petty Cash Expenses
      try {
        const recentExpenses = await db('petty_cash_expenses as pce')
          .join('petty_cash_cards as pcc', 'pce.card_id', 'pcc.id')
          .leftJoin('users as u', 'pce.approved_by', 'u.id')
          .select(
            'pce.id',
            'pce.expense_number',
            'pce.amount',
            'pce.category',
            'pce.updated_at as timestamp',
            'pcc.card_name',
            db.raw('CONCAT(u.firstName, " ", u.lastName) as approvedBy')
          )
          .where('pce.status', 'approved')
          .whereNotNull('pce.updated_at')
          .orderBy('pce.updated_at', 'desc')
          .limit(Math.floor(limit / 5));

        recentExpenses.forEach(expense => {
          activities.push({
            type: 'expense_approved',
            module: 'petty-cash',
            timestamp: expense.timestamp,
            entityType: 'petty_cash_expense',
            entityId: expense.id,
            entityNumber: expense.expense_number,
            title: `Expense approved - ${expense.category}`,
            description: `OMR ${expense.amount} from ${expense.card_name} - By ${expense.approvedBy || 'System'}`,
            icon: 'credit-card',
            route: `/petty-cash?tab=expenses&id=${expense.id}`
          });
        });
      } catch (err) {
        logger.warn('Could not fetch expense activity:', err.message);
      }

      // 7. Recent Sales Deliveries
      try {
        const recentSales = await db('sales_orders as so')
          .leftJoin('customers as c', 'so.customerId', 'c.id')
          .select(
            'so.id',
            'so.orderNumber',
            'so.totalAmount',
            'so.updated_at as timestamp',
            'c.name as customerName'
          )
          .where('so.status', 'delivered')
          .whereNotNull('so.updated_at')
          .orderBy('so.updated_at', 'desc')
          .limit(Math.floor(limit / 5));

        recentSales.forEach(so => {
          activities.push({
            type: 'sales_delivered',
            module: 'sales',
            timestamp: so.timestamp,
            entityType: 'sales_order',
            entityId: so.id,
            entityNumber: so.orderNumber,
            title: `Sales order delivered - ${so.orderNumber}`,
            description: `OMR ${so.totalAmount || 0} to ${so.customerName || 'Unknown customer'}`,
            icon: 'truck',
            route: `/sales?id=${so.id}`
          });
        });
      } catch (err) {
        logger.warn('Could not fetch sales activity:', err.message);
      }

      // 8. Recent Bank Transactions
      try {
        const recentBankTxns = await db('bank_transactions as bt')
          .join('bank_accounts as ba', 'bt.account_id', 'ba.id')
          .select(
            'bt.id',
            'bt.reference_number',
            'bt.transaction_type',
            'bt.amount',
            'bt.transaction_date as timestamp',
            'ba.account_name'
          )
          .orderBy('bt.transaction_date', 'desc')
          .limit(Math.floor(limit / 5));

        recentBankTxns.forEach(txn => {
          activities.push({
            type: txn.transaction_type === 'deposit' ? 'bank_deposit' : 'bank_withdrawal',
            module: 'banking',
            timestamp: txn.timestamp,
            entityType: 'bank_transaction',
            entityId: txn.id,
            entityNumber: txn.reference_number,
            title: `Bank ${txn.transaction_type} - ${txn.reference_number || 'N/A'}`,
            description: `OMR ${txn.amount} | ${txn.account_name}`,
            icon: txn.transaction_type === 'deposit' ? 'arrow-down-circle' : 'arrow-up-circle',
            route: `/banking?tab=transactions&id=${txn.id}`
          });
        });
      } catch (err) {
        logger.warn('Could not fetch bank activity:', err.message);
      }

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
 * Returns comprehensive workflow statistics for dashboard widgets
 * Covers ALL modules
 */
router.get('/stats',
  requirePermission('VIEW_PURCHASE'),
  async (req, res) => {
    const companyId = req.user.companyId;

    try {
      const db = getDbConnection(companyId);
      const stats = {};

      // Collections stats
      const collectionsStats = await db('collection_orders')
        .select(
          db.raw('COUNT(*) as total'),
          db.raw('SUM(CASE WHEN status = "completed" AND is_finalized = 0 THEN 1 ELSE 0 END) as pendingWCN'),
          db.raw('SUM(CASE WHEN is_finalized = 1 THEN 1 ELSE 0 END) as finalized'),
          db.raw('SUM(CASE WHEN status IN ("scheduled", "in_transit", "collecting") THEN 1 ELSE 0 END) as inProgress')
        )
        .first();

      stats.collections = {
        total: parseInt(collectionsStats?.total) || 0,
        pendingWCN: parseInt(collectionsStats?.pendingWCN) || 0,
        finalized: parseInt(collectionsStats?.finalized) || 0,
        inProgress: parseInt(collectionsStats?.inProgress) || 0
      };

      // Purchase Orders stats
      const poStats = await db('purchase_orders')
        .select(
          db.raw('COUNT(*) as total'),
          db.raw('SUM(CASE WHEN status IN ("approved", "sent") THEN 1 ELSE 0 END) as pendingReceipt'),
          db.raw('SUM(CASE WHEN status IN ("received", "completed") THEN 1 ELSE 0 END) as received'),
          db.raw('SUM(CASE WHEN source_type = "wcn_auto" THEN 1 ELSE 0 END) as autoGenerated'),
          db.raw('SUM(CASE WHEN status = "draft" THEN 1 ELSE 0 END) as draft')
        )
        .first();

      stats.purchaseOrders = {
        total: parseInt(poStats?.total) || 0,
        pendingReceipt: parseInt(poStats?.pendingReceipt) || 0,
        received: parseInt(poStats?.received) || 0,
        autoGenerated: parseInt(poStats?.autoGenerated) || 0,
        draft: parseInt(poStats?.draft) || 0
      };

      // Invoices stats
      const invoiceStats = await db('purchase_invoices')
        .select(
          db.raw('COUNT(*) as total'),
          db.raw('SUM(CASE WHEN payment_status != "paid" THEN 1 ELSE 0 END) as unpaid'),
          db.raw('COALESCE(SUM(invoice_amount), 0) as totalValue'),
          db.raw('COALESCE(SUM(CASE WHEN payment_status != "paid" THEN invoice_amount ELSE 0 END), 0) as outstandingAmount')
        )
        .first();

      stats.invoices = {
        total: parseInt(invoiceStats?.total) || 0,
        unpaid: parseInt(invoiceStats?.unpaid) || 0,
        totalValue: parseFloat(invoiceStats?.totalValue) || 0,
        outstandingAmount: parseFloat(invoiceStats?.outstandingAmount) || 0
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
          total: parseInt(contractStats?.total) || 0,
          active: parseInt(contractStats?.active) || 0,
          expiringSoon: parseInt(contractStats?.expiringSoon) || 0
        };
      }

      // Inventory stats
      try {
        const inventoryStats = await db('inventory as i')
          .join('materials as m', 'i.materialId', 'm.id')
          .select(
            db.raw('COUNT(*) as totalItems'),
            db.raw('SUM(CASE WHEN i.quantity < i.minimumStockLevel AND i.minimumStockLevel > 0 THEN 1 ELSE 0 END) as lowStock'),
            db.raw('COALESCE(SUM(i.quantity * m.standardPrice), 0) as totalValue')
          )
          .first();

        stats.inventory = {
          totalItems: parseInt(inventoryStats?.totalItems) || 0,
          lowStock: parseInt(inventoryStats?.lowStock) || 0,
          totalValue: parseFloat(inventoryStats?.totalValue) || 0
        };
      } catch (err) {
        stats.inventory = { totalItems: 0, lowStock: 0, totalValue: 0 };
      }

      // Petty Cash stats
      try {
        const pettyCashStats = await db('petty_cash_cards')
          .select(
            db.raw('COUNT(*) as totalCards'),
            db.raw('SUM(CASE WHEN status = "active" THEN 1 ELSE 0 END) as activeCards'),
            db.raw('COALESCE(SUM(current_balance), 0) as totalBalance')
          )
          .first();

        const pendingExpensesCount = await db('petty_cash_expenses')
          .where('status', 'pending')
          .count('* as count')
          .first();

        stats.pettyCash = {
          totalCards: parseInt(pettyCashStats?.totalCards) || 0,
          activeCards: parseInt(pettyCashStats?.activeCards) || 0,
          totalBalance: parseFloat(pettyCashStats?.totalBalance) || 0,
          pendingApprovals: parseInt(pendingExpensesCount?.count) || 0
        };
      } catch (err) {
        stats.pettyCash = { totalCards: 0, activeCards: 0, totalBalance: 0, pendingApprovals: 0 };
      }

      // Wastage stats
      try {
        const wastageStats = await db('wastages')
          .select(
            db.raw('COUNT(*) as total'),
            db.raw('SUM(CASE WHEN status = "pending" THEN 1 ELSE 0 END) as pending'),
            db.raw('SUM(CASE WHEN status = "approved" THEN 1 ELSE 0 END) as approved'),
            db.raw('COALESCE(SUM(CASE WHEN status = "approved" THEN estimatedValue ELSE 0 END), 0) as totalLoss')
          )
          .first();

        stats.wastage = {
          total: parseInt(wastageStats?.total) || 0,
          pending: parseInt(wastageStats?.pending) || 0,
          approved: parseInt(wastageStats?.approved) || 0,
          totalLoss: parseFloat(wastageStats?.totalLoss) || 0
        };
      } catch (err) {
        stats.wastage = { total: 0, pending: 0, approved: 0, totalLoss: 0 };
      }

      // Sales stats
      try {
        const salesStats = await db('sales_orders')
          .select(
            db.raw('COUNT(*) as total'),
            db.raw('SUM(CASE WHEN status IN ("confirmed", "processing") THEN 1 ELSE 0 END) as pendingDelivery'),
            db.raw('SUM(CASE WHEN status = "delivered" THEN 1 ELSE 0 END) as delivered'),
            db.raw('COALESCE(SUM(totalAmount), 0) as totalRevenue')
          )
          .first();

        stats.sales = {
          total: parseInt(salesStats?.total) || 0,
          pendingDelivery: parseInt(salesStats?.pendingDelivery) || 0,
          delivered: parseInt(salesStats?.delivered) || 0,
          totalRevenue: parseFloat(salesStats?.totalRevenue) || 0
        };
      } catch (err) {
        stats.sales = { total: 0, pendingDelivery: 0, delivered: 0, totalRevenue: 0 };
      }

      // Receivables stats (customer payments owed to us)
      try {
        const receivablesStats = await db('sales_orders as so')
          .leftJoin('customers as c', 'so.customerId', 'c.id')
          .select(
            db.raw('COUNT(*) as totalDelivered'),
            db.raw('SUM(CASE WHEN so.paymentStatus != "paid" THEN so.totalAmount ELSE 0 END) as outstanding'),
            db.raw(`SUM(CASE WHEN so.paymentStatus != "paid"
              AND so.actualDeliveryDate IS NOT NULL
              AND DATE_ADD(so.actualDeliveryDate, INTERVAL COALESCE(c.paymentTermDays, 30) DAY) < NOW()
              THEN 1 ELSE 0 END) as overdueCount`),
            db.raw(`SUM(CASE WHEN so.paymentStatus != "paid"
              AND so.actualDeliveryDate IS NOT NULL
              AND DATE_ADD(so.actualDeliveryDate, INTERVAL COALESCE(c.paymentTermDays, 30) DAY) < NOW()
              THEN so.totalAmount ELSE 0 END) as overdueAmount`)
          )
          .where('so.status', 'delivered')
          .first();

        stats.receivables = {
          totalDelivered: parseInt(receivablesStats?.totalDelivered) || 0,
          outstanding: parseFloat(receivablesStats?.outstanding) || 0,
          overdueCount: parseInt(receivablesStats?.overdueCount) || 0,
          overdueAmount: parseFloat(receivablesStats?.overdueAmount) || 0
        };
      } catch (err) {
        logger.warn('Could not fetch receivables stats:', err.message);
        stats.receivables = { totalDelivered: 0, outstanding: 0, overdueCount: 0, overdueAmount: 0 };
      }

      // Banking stats
      try {
        const bankingStats = await db('bank_accounts')
          .select(
            db.raw('COUNT(*) as totalAccounts'),
            db.raw('COALESCE(SUM(current_balance), 0) as totalBalance')
          )
          .first();

        const unreconciledCount = await db('bank_transactions')
          .where('reconciled', 0)
          .count('* as count')
          .first();

        stats.banking = {
          totalAccounts: parseInt(bankingStats?.totalAccounts) || 0,
          totalBalance: parseFloat(bankingStats?.totalBalance) || 0,
          unreconciled: parseInt(unreconciledCount?.count) || 0
        };
      } catch (err) {
        stats.banking = { totalAccounts: 0, totalBalance: 0, unreconciled: 0 };
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

/**
 * GET /api/workflow/notifications
 *
 * Returns live notifications for the notification bell/dropdown
 * Condensed summary of urgent items across all modules
 */
router.get('/notifications',
  requirePermission('VIEW_PURCHASE'),
  async (req, res) => {
    const user = req.user;
    const companyId = user.companyId;
    const limit = parseInt(req.query.limit) || 10;

    try {
      const db = getDbConnection(companyId);
      const notifications = [];

      // 1. Overdue vendor bills (PAYABLES - money WE owe to suppliers)
      // Only count vendor bills as overdue (company bills are internal records)
      const overduePayables = await db('purchase_invoices')
        .where('bill_type', 'vendor')  // Only vendor bills are payable
        .where('payment_status', '!=', 'paid')
        .where('due_date', '<', db.raw('NOW()'))
        .count('* as count')
        .first();

      if (overduePayables?.count > 0) {
        notifications.push({
          type: 'overdue_payable',
          severity: 'error',
          title: `${overduePayables.count} Overdue Vendor Invoice${overduePayables.count > 1 ? 's' : ''}`,
          message: 'Vendor payments are past due date',
          route: '/purchase?tab=bills&filter=overdue',
          count: parseInt(overduePayables.count)
        });
      }

      // 2. Overdue customer receivables (RECEIVABLES - money CUSTOMERS owe to us)
      // Due date = actualDeliveryDate + customer.paymentTermDays (default 30)
      try {
        const overdueReceivables = await db('sales_orders as so')
          .leftJoin('customers as c', 'so.customerId', 'c.id')
          .where('so.status', 'delivered')
          .where('so.paymentStatus', '!=', 'paid')
          .whereNotNull('so.actualDeliveryDate')
          .whereRaw('DATE_ADD(so.actualDeliveryDate, INTERVAL COALESCE(c.paymentTermDays, 30) DAY) < NOW()')
          .count('* as count')
          .first();

        if (overdueReceivables?.count > 0) {
          notifications.push({
            type: 'overdue_receivable',
            severity: 'error',
            title: `${overdueReceivables.count} Overdue Customer Payment${overdueReceivables.count > 1 ? 's' : ''}`,
            message: 'Customer payments are past due date',
            route: '/sales?filter=overdue',
            count: parseInt(overdueReceivables.count)
          });
        }
      } catch (err) {
        logger.warn('Could not fetch overdue receivables:', err.message);
      }

      // 3. Expiring contracts (within 7 days)
      if (companyId === 'al-ramrami') {
        const expiringContracts = await db('contracts')
          .where('status', 'active')
          .where('endDate', '<=', db.raw('DATE_ADD(NOW(), INTERVAL 7 DAY)'))
          .where('endDate', '>=', db.raw('NOW()'))
          .count('* as count')
          .first();

        if (expiringContracts?.count > 0) {
          notifications.push({
            type: 'contract_expiry',
            severity: 'warning',
            title: `${expiringContracts.count} Contract${expiringContracts.count > 1 ? 's' : ''} Expiring Soon`,
            message: 'Contracts expire within 7 days',
            route: '/contracts?filter=expiring',
            count: parseInt(expiringContracts.count)
          });
        }
      }

      // 3. Pending WCN finalizations
      const pendingWCNs = await db('collection_orders')
        .where('status', 'completed')
        .where('is_finalized', 0)
        .count('* as count')
        .first();

      if (pendingWCNs?.count > 0) {
        notifications.push({
          type: 'pending_wcn',
          severity: 'info',
          title: `${pendingWCNs.count} WCN${pendingWCNs.count > 1 ? 's' : ''} Pending`,
          message: 'Collections awaiting WCN finalization',
          route: '/purchase?tab=collections&filter=pending',
          count: parseInt(pendingWCNs.count)
        });
      }

      // 4. Low stock items
      try {
        const lowStock = await db('inventory')
          .whereRaw('quantity < minimumStockLevel')
          .where('minimumStockLevel', '>', 0)
          .count('* as count')
          .first();

        if (lowStock?.count > 0) {
          notifications.push({
            type: 'low_stock',
            severity: 'warning',
            title: `${lowStock.count} Item${lowStock.count > 1 ? 's' : ''} Low Stock`,
            message: 'Inventory items below minimum level',
            route: '/inventory?filter=low-stock',
            count: parseInt(lowStock.count)
          });
        }
      } catch (err) {
        // Inventory table might not exist or have different schema
      }

      // 5. Pending expense approvals
      try {
        const pendingExpenses = await db('petty_cash_expenses')
          .where('status', 'pending')
          .count('* as count')
          .first();

        if (pendingExpenses?.count > 0) {
          notifications.push({
            type: 'expense_approval',
            severity: 'info',
            title: `${pendingExpenses.count} Expense${pendingExpenses.count > 1 ? 's' : ''} Pending`,
            message: 'Petty cash expenses awaiting approval',
            route: '/petty-cash?tab=expenses&filter=pending',
            count: parseInt(pendingExpenses.count)
          });
        }
      } catch (err) {
        // Petty cash table might not exist
      }

      // 6. Pending wastage approvals
      try {
        const pendingWastages = await db('wastages')
          .where('status', 'pending')
          .count('* as count')
          .first();

        if (pendingWastages?.count > 0) {
          notifications.push({
            type: 'wastage_approval',
            severity: 'info',
            title: `${pendingWastages.count} Wastage${pendingWastages.count > 1 ? 's' : ''} Pending`,
            message: 'Wastage records awaiting approval',
            route: '/wastage?filter=pending',
            count: parseInt(pendingWastages.count)
          });
        }
      } catch (err) {
        // Wastages table might not exist
      }

      // 7. Unreconciled bank transactions
      try {
        const unreconciled = await db('bank_transactions')
          .where('reconciled', 0)
          .count('* as count')
          .first();

        if (unreconciled?.count > 0) {
          notifications.push({
            type: 'bank_reconciliation',
            severity: 'info',
            title: `${unreconciled.count} Transaction${unreconciled.count > 1 ? 's' : ''} Unreconciled`,
            message: 'Bank transactions need reconciliation',
            route: '/banking?tab=transactions&filter=unreconciled',
            count: parseInt(unreconciled.count)
          });
        }
      } catch (err) {
        // Bank transactions table might not exist
      }

      // Sort by severity: error > warning > info
      const severityOrder = { error: 0, warning: 1, info: 2 };
      notifications.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

      res.json({
        success: true,
        data: {
          notifications: notifications.slice(0, limit),
          total: notifications.length,
          hasUrgent: notifications.some(n => n.severity === 'error')
        }
      });

    } catch (error) {
      logger.error('Error retrieving notifications:', {
        error: error.message,
        stack: error.stack,
        companyId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve notifications',
        message: error.message
      });
    }
  }
);

module.exports = router;
