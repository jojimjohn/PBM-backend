const express = require('express');
const { requirePermission } = require('../middleware/auth');
const { logger } = require('../utils/logger');
const { getDbConnection } = require('../config/database');

const router = express.Router();

// Helper: safely run a DB query, return default on error (with logging)
async function safeQuery(fn, defaultValue, context = 'query') {
  try {
    return await fn();
  } catch (err) {
    logger.warn(`Dashboard ${context} failed (returning default)`, { error: err.message });
    return defaultValue;
  }
}

// Helper: get today / month / year date ranges
function getDateRanges() {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const yearStart = new Date(now.getFullYear(), 0, 1).toISOString().split('T')[0];
  return { today, monthStart, yearStart };
}

// Guard: all dashboard routes require a company context in the JWT
router.use((req, res, next) => {
  if (!req.user?.companyId) {
    return res.status(400).json({ success: false, error: 'Company context required' });
  }
  next();
});

// ============================================================================
// EXECUTIVE DASHBOARD
// ============================================================================
router.get('/executive', requirePermission('VIEW_REPORTS'), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const { today, monthStart, yearStart } = getDateRanges();

    const todayRev = await safeQuery(
      () => db('sales_orders').where('orderDate', today).whereNot('status', 'cancelled').sum('totalAmount as total').first(),
      { total: 0 }, 'today revenue'
    );
    const mtdRev = await safeQuery(
      () => db('sales_orders').whereBetween('orderDate', [monthStart, today]).whereNot('status', 'cancelled').sum('totalAmount as total').first(),
      { total: 0 }, 'mtd revenue'
    );
    const ytdRev = await safeQuery(
      () => db('sales_orders').whereBetween('orderDate', [yearStart, today]).whereNot('status', 'cancelled').sum('totalAmount as total').first(),
      { total: 0 }, 'ytd revenue'
    );
    const mtdCogs = await safeQuery(
      () => db('purchase_orders').whereBetween('orderDate', [monthStart, today]).whereNot('status', 'cancelled').sum('totalAmount as total').first(),
      { total: 0 }, 'mtd cogs'
    );
    const receivables = await safeQuery(
      () => db('sales_orders').whereIn('paymentStatus', ['pending', 'partial', 'overdue']).whereNot('status', 'cancelled').sum('totalAmount as total').first(),
      { total: 0 }, 'receivables'
    );

    const topCustomers = await safeQuery(
      () => db('sales_orders as s')
        .leftJoin('customers as c', 'c.id', 's.customerId')
        .whereBetween('s.orderDate', [monthStart, today])
        .whereNot('s.status', 'cancelled')
        .select('c.id', 'c.name', db.raw('SUM(s.totalAmount) as total'), db.raw('COUNT(s.id) as orderCount'))
        .groupBy('c.id', 'c.name')
        .orderBy('total', 'desc')
        .limit(5),
      [], 'top customers'
    );

    const topSuppliers = await safeQuery(
      () => db('purchase_orders as p')
        .leftJoin('suppliers as sup', 'sup.id', 'p.supplierId')
        .whereBetween('p.orderDate', [monthStart, today])
        .whereNot('p.status', 'cancelled')
        .select('sup.id', 'sup.name', db.raw('SUM(p.totalAmount) as total'), db.raw('COUNT(p.id) as orderCount'))
        .groupBy('sup.id', 'sup.name')
        .orderBy('total', 'desc')
        .limit(5),
      [], 'top suppliers'
    );

    let vehicleStats = { active: 0, inactive: 0, under_maintenance: 0 };
    await safeQuery(
      async () => {
        const stats = await db('vehicles').groupBy('status').select('status', db.raw('COUNT(*) as count'));
        stats.forEach(s => { if (vehicleStats[s.status] !== undefined) vehicleStats[s.status] = parseInt(s.count); });
        return null;
      },
      null, 'vehicles status'
    );

    const pendingWcn = await safeQuery(
      () => db('collection_orders').where('status', 'completed').where('is_finalized', 0).count('id as count').first(),
      { count: 0 }, 'pending wcn'
    );

    const expiringDocs = await safeQuery(
      async () => {
        const future = new Date(); future.setDate(future.getDate() + 30);
        const futureStr = future.toISOString().split('T')[0];
        const r = await db('employee_documents').whereNotNull('expiry_date').where('expiry_date', '<=', futureStr).count('id as count').first();
        return r;
      },
      { count: 0 }, 'expiring docs'
    );

    const sixMonthsAgo = new Date(); sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const trendFrom = sixMonthsAgo.toISOString().split('T')[0];
    const revenueTrend = await safeQuery(
      () => db('sales_orders')
        .whereBetween('orderDate', [trendFrom, today])
        .whereNot('status', 'cancelled')
        .select(db.raw("DATE_FORMAT(orderDate, '%Y-%m') as month"), db.raw('SUM(totalAmount) as revenue'))
        .groupBy('month')
        .orderBy('month', 'asc'),
      [], 'revenue trend'
    );

    const mtdRevenueValue = parseFloat(mtdRev.total || 0);
    const mtdCogsValue = parseFloat(mtdCogs.total || 0);

    res.json({
      success: true,
      data: {
        kpis: {
          todayRevenue: parseFloat(todayRev.total || 0),
          mtdRevenue: mtdRevenueValue,
          ytdRevenue: parseFloat(ytdRev.total || 0),
          mtdCogs: mtdCogsValue,
          mtdGrossProfit: parseFloat((mtdRevenueValue - mtdCogsValue).toFixed(3)),
          outstandingReceivables: parseFloat(receivables.total || 0),
          pendingWcn: parseInt(pendingWcn.count || 0),
          expiringDocuments: parseInt(expiringDocs.count || 0)
        },
        topCustomers: topCustomers.map(c => ({ ...c, total: parseFloat(c.total || 0), orderCount: parseInt(c.orderCount || 0) })),
        topSuppliers: topSuppliers.map(s => ({ ...s, total: parseFloat(s.total || 0), orderCount: parseInt(s.orderCount || 0) })),
        vehicles: vehicleStats,
        revenueTrend: revenueTrend.map(r => ({ month: r.month, revenue: parseFloat(r.revenue || 0) }))
      }
    });
  } catch (error) {
    logger.error('Executive dashboard error', { error: error.message, stack: error.stack });
    res.status(500).json({ success: false, error: 'Failed to load executive dashboard', detail: error.message });
  }
});

// ============================================================================
// OPERATIONS DASHBOARD
// ============================================================================
router.get('/operations', requirePermission('VIEW_REPORTS'), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const { today } = getDateRanges();

    // Today's schedule — try with joins first, fall back to simple query if columns don't exist
    const todaySchedule = await safeQuery(
      async () => {
        // Check if the new FK columns exist by trying the full query
        return await db('collection_orders as co')
          .leftJoin('employees as drv', 'drv.id', 'co.driver_employee_id')
          .leftJoin('vehicles as v', 'v.id', 'co.vehicle_id')
          .where('co.scheduledDate', today)
          .select(
            'co.id', 'co.orderNumber', 'co.status', 'co.is_finalized',
            'co.driverName', 'co.vehiclePlate',
            'drv.full_name as driver_full_name',
            'v.make as vehicle_make', 'v.model as vehicle_model'
          )
          .orderBy('co.id');
      },
      // Fallback: just collection_orders without joins
      await safeQuery(
        () => db('collection_orders').where('scheduledDate', today)
          .select('id', 'orderNumber', 'status', 'is_finalized', 'driverName', 'vehiclePlate')
          .orderBy('id'),
        [], 'today schedule fallback'
      ),
      'today schedule with joins'
    );

    const pendingWcn = await safeQuery(
      () => db('collection_orders').where('status', 'completed').where('is_finalized', 0).count('id as count').first(),
      { count: 0 }, 'pending wcn'
    );

    const pendingWastage = await safeQuery(
      async () => {
        const c = await db('wastages').where('status', 'pending').count('id as count').first();
        return parseInt(c.count || 0);
      },
      0, 'pending wastage'
    );

    const pendingExpenseSheets = await safeQuery(
      async () => {
        const c = await db('vehicle_daily_expense_sheets').where('status', 'submitted').count('id as count').first();
        return parseInt(c.count || 0);
      },
      0, 'pending expense sheets'
    );

    const pendingPettyCash = await safeQuery(
      async () => {
        const c = await db('petty_cash_expenses').where('status', 'pending').count('id as count').first();
        return parseInt(c.count || 0);
      },
      0, 'pending petty cash'
    );

    let vehicles = { active: 0, inactive: 0, under_maintenance: 0, total: 0 };
    await safeQuery(
      async () => {
        const stats = await db('vehicles').groupBy('status').select('status', db.raw('COUNT(*) as count'));
        stats.forEach(s => {
          if (vehicles[s.status] !== undefined) vehicles[s.status] = parseInt(s.count);
          vehicles.total += parseInt(s.count);
        });
      },
      null, 'vehicles'
    );

    const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
    const weekStr = weekAgo.toISOString().split('T')[0];
    const driverProductivity = await safeQuery(
      async () => {
        // Try with employees join
        return await db('collection_orders as co')
          .leftJoin('employees as drv', 'drv.id', 'co.driver_employee_id')
          .whereBetween('co.scheduledDate', [weekStr, today])
          .where('co.is_finalized', 1)
          .select(
            db.raw('COALESCE(drv.full_name, co.driverName) as driver_name'),
            db.raw('COUNT(co.id) as collections'),
            db.raw('SUM(co.totalValue) as totalValue')
          )
          .groupBy('driver_name')
          .orderBy('collections', 'desc')
          .limit(10);
      },
      // Fallback: just by driverName string
      await safeQuery(
        () => db('collection_orders')
          .whereBetween('scheduledDate', [weekStr, today])
          .where('is_finalized', 1)
          .whereNotNull('driverName')
          .select(
            db.raw('driverName as driver_name'),
            db.raw('COUNT(id) as collections'),
            db.raw('SUM(totalValue) as totalValue')
          )
          .groupBy('driverName')
          .orderBy('collections', 'desc')
          .limit(10),
        [], 'driver productivity fallback'
      ),
      'driver productivity'
    );

    res.json({
      success: true,
      data: {
        todaySchedule,
        pendingApprovals: {
          wcn: parseInt(pendingWcn.count || 0),
          wastage: pendingWastage,
          expenseSheets: pendingExpenseSheets,
          pettyCash: pendingPettyCash,
          total: parseInt(pendingWcn.count || 0) + pendingWastage + pendingExpenseSheets + pendingPettyCash
        },
        vehicles,
        driverProductivity: driverProductivity.map(d => ({
          driver_name: d.driver_name || 'Unknown',
          collections: parseInt(d.collections || 0),
          totalValue: parseFloat(d.totalValue || 0)
        }))
      }
    });
  } catch (error) {
    logger.error('Operations dashboard error', { error: error.message, stack: error.stack });
    res.status(500).json({ success: false, error: 'Failed to load operations dashboard', detail: error.message });
  }
});

// ============================================================================
// ACCOUNTANT DASHBOARD
// ============================================================================
router.get('/accountant', requirePermission('VIEW_REPORTS'), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const { today, monthStart } = getDateRanges();

    const unpaid = await safeQuery(
      () => db('sales_orders as s')
        .leftJoin('customers as c', 'c.id', 's.customerId')
        .whereIn('s.paymentStatus', ['pending', 'partial', 'overdue'])
        .whereNot('s.status', 'cancelled')
        .select('s.id', 's.orderNumber', 's.orderDate', 's.totalAmount', 's.paymentStatus', 'c.name as customerName'),
      [], 'unpaid sales orders'
    );

    const now = new Date();
    const buckets = { current: 0, bucket_31_60: 0, bucket_61_90: 0, bucket_90_plus: 0 };
    const overdueList = [];
    unpaid.forEach(o => {
      const age = Math.floor((now - new Date(o.orderDate)) / (1000 * 60 * 60 * 24));
      const amt = parseFloat(o.totalAmount || 0);
      if (age <= 30) buckets.current += amt;
      else if (age <= 60) buckets.bucket_31_60 += amt;
      else if (age <= 90) buckets.bucket_61_90 += amt;
      else { buckets.bucket_90_plus += amt; overdueList.push({ ...o, ageDays: age }); }
    });

    const mtdOutputVat = await safeQuery(
      () => db('sales_orders').whereBetween('orderDate', [monthStart, today]).whereNot('status', 'cancelled').sum('taxAmount as total').first(),
      { total: 0 }, 'mtd output vat'
    );
    const mtdInputVat = await safeQuery(
      () => db('purchase_orders').whereBetween('orderDate', [monthStart, today]).whereNot('status', 'cancelled').sum('taxAmount as total').first(),
      { total: 0 }, 'mtd input vat'
    );

    const pendingPettyCash = await safeQuery(
      async () => {
        const c = await db('petty_cash_expenses').where('status', 'pending').count('id as count').first();
        return parseInt(c.count || 0);
      },
      0, 'pending petty cash (accountant)'
    );

    const pendingExpenseSheets = await safeQuery(
      async () => {
        const c = await db('vehicle_daily_expense_sheets').where('status', 'submitted').count('id as count').first();
        return parseInt(c.count || 0);
      },
      0, 'pending expense sheets (accountant)'
    );

    const todayReceipts = await safeQuery(
      async () => {
        const r = await db('bank_transactions').where('transactionDate', today).where('transactionType', 'credit').sum('amount as total').first();
        return parseFloat(r.total || 0);
      },
      0, 'today receipts'
    );
    const todayPayments = await safeQuery(
      async () => {
        const r = await db('bank_transactions').where('transactionDate', today).where('transactionType', 'debit').sum('amount as total').first();
        return parseFloat(r.total || 0);
      },
      0, 'today payments'
    );

    res.json({
      success: true,
      data: {
        receivables: {
          total: parseFloat(Object.values(buckets).reduce((s, v) => s + v, 0).toFixed(3)),
          buckets: {
            current: parseFloat(buckets.current.toFixed(3)),
            bucket_31_60: parseFloat(buckets.bucket_31_60.toFixed(3)),
            bucket_61_90: parseFloat(buckets.bucket_61_90.toFixed(3)),
            bucket_90_plus: parseFloat(buckets.bucket_90_plus.toFixed(3))
          },
          overdueList: overdueList.slice(0, 10)
        },
        vat: {
          mtdOutputVat: parseFloat(mtdOutputVat.total || 0),
          mtdInputVat: parseFloat(mtdInputVat.total || 0),
          mtdNetVat: parseFloat((mtdOutputVat.total || 0) - (mtdInputVat.total || 0))
        },
        pendingApprovals: {
          pettyCash: pendingPettyCash,
          expenseSheets: pendingExpenseSheets,
          total: pendingPettyCash + pendingExpenseSheets
        },
        todayCashFlow: {
          receipts: todayReceipts,
          payments: todayPayments,
          net: todayReceipts - todayPayments
        }
      }
    });
  } catch (error) {
    logger.error('Accountant dashboard error', { error: error.message, stack: error.stack });
    res.status(500).json({ success: false, error: 'Failed to load accountant dashboard', detail: error.message });
  }
});

// ============================================================================
// SALES DASHBOARD
// ============================================================================
router.get('/sales', requirePermission('VIEW_REPORTS'), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const { today, monthStart, yearStart } = getDateRanges();

    const todaySales = await safeQuery(
      async () => {
        const total = await db('sales_orders').where('orderDate', today).whereNot('status', 'cancelled').sum('totalAmount as total').first();
        const count = await db('sales_orders').where('orderDate', today).whereNot('status', 'cancelled').count('id as count').first();
        return { total: parseFloat(total.total || 0), count: parseInt(count.count || 0) };
      },
      { total: 0, count: 0 }, 'today sales'
    );

    const mtdSales = await safeQuery(
      async () => {
        const total = await db('sales_orders').whereBetween('orderDate', [monthStart, today]).whereNot('status', 'cancelled').sum('totalAmount as total').first();
        const count = await db('sales_orders').whereBetween('orderDate', [monthStart, today]).whereNot('status', 'cancelled').count('id as count').first();
        return { total: parseFloat(total.total || 0), count: parseInt(count.count || 0) };
      },
      { total: 0, count: 0 }, 'mtd sales'
    );

    const ytdSales = await safeQuery(
      async () => {
        const total = await db('sales_orders').whereBetween('orderDate', [yearStart, today]).whereNot('status', 'cancelled').sum('totalAmount as total').first();
        const count = await db('sales_orders').whereBetween('orderDate', [yearStart, today]).whereNot('status', 'cancelled').count('id as count').first();
        return { total: parseFloat(total.total || 0), count: parseInt(count.count || 0) };
      },
      { total: 0, count: 0 }, 'ytd sales'
    );

    const unpaidInv = await safeQuery(
      async () => {
        const total = await db('sales_orders').whereIn('paymentStatus', ['pending', 'partial', 'overdue']).whereNot('status', 'cancelled').sum('totalAmount as total').first();
        const count = await db('sales_orders').whereIn('paymentStatus', ['pending', 'partial', 'overdue']).whereNot('status', 'cancelled').count('id as count').first();
        return { total: parseFloat(total.total || 0), count: parseInt(count.count || 0) };
      },
      { total: 0, count: 0 }, 'unpaid invoices'
    );

    const topCustomers = await safeQuery(
      () => db('sales_orders as s')
        .leftJoin('customers as c', 'c.id', 's.customerId')
        .whereBetween('s.orderDate', [yearStart, today])
        .whereNot('s.status', 'cancelled')
        .select('c.id', 'c.name', db.raw('SUM(s.totalAmount) as total'), db.raw('COUNT(s.id) as orderCount'))
        .groupBy('c.id', 'c.name')
        .orderBy('total', 'desc')
        .limit(5),
      [], 'top customers (sales)'
    );

    const recentSales = await safeQuery(
      () => db('sales_orders as s')
        .leftJoin('customers as c', 'c.id', 's.customerId')
        .whereNot('s.status', 'cancelled')
        .select('s.id', 's.orderNumber', 's.orderDate', 's.totalAmount', 's.paymentStatus', 'c.name as customerName')
        .orderBy('s.orderDate', 'desc')
        .orderBy('s.id', 'desc')
        .limit(10),
      [], 'recent sales'
    );

    const lowStock = await safeQuery(
      () => db('inventory as i')
        .leftJoin('materials as m', 'm.id', 'i.materialId')
        .whereRaw('i.quantity <= i.minimumStockLevel')
        .where('i.minimumStockLevel', '>', 0)
        .select('m.name', 'i.quantity', 'i.minimumStockLevel')
        .limit(10),
      [], 'low stock'
    );

    res.json({
      success: true,
      data: {
        sales: {
          todayTotal: todaySales.total,
          todayCount: todaySales.count,
          mtdTotal: mtdSales.total,
          mtdCount: mtdSales.count,
          ytdTotal: ytdSales.total,
          ytdCount: ytdSales.count
        },
        pendingInvoices: {
          total: unpaidInv.total,
          count: unpaidInv.count
        },
        topCustomers: topCustomers.map(c => ({ ...c, total: parseFloat(c.total || 0), orderCount: parseInt(c.orderCount || 0) })),
        recentSales: recentSales.map(s => ({ ...s, totalAmount: parseFloat(s.totalAmount || 0) })),
        lowStock: lowStock.map(l => ({ ...l, quantity: parseFloat(l.quantity || 0), minimumStockLevel: parseFloat(l.minimumStockLevel || 0) }))
      }
    });
  } catch (error) {
    logger.error('Sales dashboard error', { error: error.message, stack: error.stack });
    res.status(500).json({ success: false, error: 'Failed to load sales dashboard', detail: error.message });
  }
});

module.exports = router;
