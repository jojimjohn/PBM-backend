/**
 * E-Invoicing Routes — Oman Tax Authority compliance
 *
 * Endpoints:
 *   POST /api/einvoicing/:salesOrderId/generate — create invoice metadata (UUID, hash, TLV, number)
 *   GET  /api/einvoicing/:salesOrderId/xml      — download UBL 2.1 XML
 *   GET  /api/einvoicing/:salesOrderId/pdf      — download PDF with QR
 *   GET  /api/einvoicing/:salesOrderId/qr       — raw QR image (PNG)
 */
const express = require('express');
const { requirePermission } = require('../middleware/auth');
const { logger, auditLog } = require('../utils/logger');
const { getDbConnection } = require('../config/database');
const { buildInvoiceXml, generateUuid } = require('../services/ublInvoiceService');
const { buildInvoiceTlv } = require('../services/invoiceQrService');
const { renderInvoicePdf } = require('../templates/invoicePdf');
const { qrDataUrl } = require('../utils/pdfGenerator');

const router = express.Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SELLER_SETTING_KEYS = [
  'company.name', 'company.cr_number', 'company.vat_registration',
  'company.address', 'company.city'
];

/**
 * Fetch company seller info from system_settings
 */
async function getSellerInfo(db, companyId) {
  const rows = await db('system_settings')
    .where('company_id', companyId)
    .whereIn('setting_key', SELLER_SETTING_KEYS);

  const map = {};
  rows.forEach(r => { map[r.setting_key] = r.setting_value; });

  return {
    name: map['company.name'] || (companyId === 'al-ramrami' ? 'Al Ramrami Trading Enterprises' : 'Pride Muscat International LLC'),
    vatRegistration: map['company.vat_registration'] || '',
    crNumber: map['company.cr_number'] || '',
    address: map['company.address'] || '',
    city: map['company.city'] || 'Muscat',
    countryCode: 'OM'
  };
}

/**
 * Generate next sequential invoice number: INV-YYYY-NNNNN (per company per year).
 */
async function nextInvoiceNumber(db) {
  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;
  const last = await db('sales_orders')
    .where('invoiceNumber', 'like', `${prefix}%`)
    .orderBy('invoiceNumber', 'desc')
    .first('invoiceNumber');

  let seq = 1;
  if (last && last.invoiceNumber) {
    const match = last.invoiceNumber.match(/-(\d+)$/);
    if (match) seq = parseInt(match[1], 10) + 1;
  }
  return `${prefix}${String(seq).padStart(5, '0')}`;
}

/**
 * Fetch the last invoice's hash for the hash chain (OTA compliance).
 */
async function getPreviousHash(db) {
  const row = await db('sales_orders')
    .whereNotNull('invoice_hash')
    .orderBy('id', 'desc')
    .first('invoice_hash');
  return row ? row.invoice_hash : null;
}

/**
 * Assemble the invoice data payload from a sales order.
 */
async function assembleInvoiceData(db, salesOrderId) {
  const order = await db('sales_orders as s')
    .leftJoin('customers as c', 'c.id', 's.customerId')
    .where('s.id', salesOrderId)
    .select(
      's.*',
      'c.name as customerName',
      'c.vatRegistration as customerVat',
      'c.contactPerson as customerContact',
      'c.address as customerAddress',
      'c.city as customerCity'
    )
    .first();

  if (!order) return null;

  const items = await db('sales_order_items as si')
    .leftJoin('materials as m', 'm.id', 'si.materialId')
    .where('si.salesOrderId', salesOrderId)
    .select(
      'si.*',
      'm.name as materialName',
      'm.unit as materialUnit'
    );

  return { order, items };
}

// ============================================================================
// POST /:salesOrderId/generate — generate invoice metadata (UUID, hash, TLV)
// ============================================================================
router.post('/:salesOrderId/generate', requirePermission('CREATE_INVOICES'), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const orderId = parseInt(req.params.salesOrderId);

    const data = await assembleInvoiceData(db, orderId);
    if (!data) return res.status(404).json({ success: false, error: 'Sales order not found' });

    const { order } = data;

    // Skip if already generated (idempotent)
    if (order.invoice_uuid && order.invoice_hash) {
      return res.json({
        success: true,
        message: 'Invoice already generated',
        data: {
          invoiceNumber: order.invoiceNumber,
          invoiceUuid: order.invoice_uuid,
          invoiceHash: order.invoice_hash,
          qrCodeTlv: order.qr_code_tlv
        }
      });
    }

    const seller = await getSellerInfo(db, req.user.companyId);
    if (!seller.vatRegistration) {
      return res.status(400).json({
        success: false,
        error: 'Company VAT registration not set. Please configure compliance settings.'
      });
    }

    // Assign invoice number if missing
    const invoiceNumber = order.invoiceNumber || await nextInvoiceNumber(db);
    const uuid = generateUuid();
    const previousHash = await getPreviousHash(db);
    const issueDate = order.orderDate || new Date().toISOString().split('T')[0];
    const timestamp = new Date().toISOString();

    // Build UBL XML
    const { xml, hash } = buildInvoiceXml({
      invoice: {
        invoiceNumber,
        invoiceUuid: uuid,
        issueDate,
        dueDate: order.dueDate,
        currency: order.currency || 'OMR',
        vatRate: 5,
        subtotal: order.subtotal,
        taxAmount: order.taxAmount,
        totalAmount: order.totalAmount,
        previousHash
      },
      seller,
      buyer: {
        name: order.customerName,
        vatRegistration: order.customerVat,
        address: order.customerAddress,
        city: order.customerCity,
        countryCode: 'OM'
      },
      lines: (data.items || []).map(i => ({
        description: i.materialName || i.description || 'Item',
        quantity: parseFloat(i.quantity || 0),
        unit: i.materialUnit || 'EA',
        unitPrice: parseFloat(i.unitPrice || 0),
        taxRate: 5,
        lineTotal: parseFloat(i.totalAmount || i.lineTotal || (i.quantity * i.unitPrice) || 0)
      }))
    });

    // Build TLV QR
    const { tlvBase64 } = buildInvoiceTlv({
      sellerName: seller.name,
      sellerVat: seller.vatRegistration,
      timestamp,
      totalWithVat: parseFloat(order.totalAmount || 0),
      vatTotal: parseFloat(order.taxAmount || 0)
    });

    // Persist on sales_orders
    await db('sales_orders').where('id', orderId).update({
      invoiceNumber,
      invoice_uuid: uuid,
      invoice_hash: hash,
      previous_invoice_hash: previousHash,
      qr_code_tlv: tlvBase64,
      invoiceGeneratedAt: db.fn.now(),
      invoiceGeneratedBy: req.user.userId
    });

    auditLog('EINVOICE_GENERATED', req.user.userId, {
      salesOrderId: orderId,
      invoiceNumber,
      invoiceUuid: uuid,
      hash
    });

    res.json({
      success: true,
      message: 'E-invoice generated',
      data: {
        invoiceNumber,
        invoiceUuid: uuid,
        invoiceHash: hash,
        previousHash,
        qrCodeTlv: tlvBase64
      }
    });
  } catch (error) {
    logger.error('E-invoice generation error', { error: error.message, stack: error.stack });
    res.status(500).json({ success: false, error: 'Failed to generate e-invoice', detail: error.message });
  }
});

// ============================================================================
// GET /:salesOrderId/xml — download UBL 2.1 XML
// ============================================================================
router.get('/:salesOrderId/xml', requirePermission('VIEW_INVOICES'), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const data = await assembleInvoiceData(db, req.params.salesOrderId);
    if (!data) return res.status(404).json({ success: false, error: 'Sales order not found' });

    const { order } = data;
    if (!order.invoice_uuid) {
      return res.status(400).json({ success: false, error: 'Invoice not yet generated. Call /generate first.' });
    }

    const seller = await getSellerInfo(db, req.user.companyId);
    const { xml } = buildInvoiceXml({
      invoice: {
        invoiceNumber: order.invoiceNumber,
        invoiceUuid: order.invoice_uuid,
        issueDate: order.orderDate,
        dueDate: order.dueDate,
        currency: order.currency || 'OMR',
        vatRate: 5,
        subtotal: order.subtotal,
        taxAmount: order.taxAmount,
        totalAmount: order.totalAmount,
        previousHash: order.previous_invoice_hash
      },
      seller,
      buyer: {
        name: order.customerName,
        vatRegistration: order.customerVat,
        address: order.customerAddress,
        city: order.customerCity,
        countryCode: 'OM'
      },
      lines: (data.items || []).map(i => ({
        description: i.materialName || i.description || 'Item',
        quantity: parseFloat(i.quantity || 0),
        unit: i.materialUnit || 'EA',
        unitPrice: parseFloat(i.unitPrice || 0),
        taxRate: 5,
        lineTotal: parseFloat(i.totalAmount || i.lineTotal || (i.quantity * i.unitPrice) || 0)
      }))
    });

    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Disposition', `attachment; filename="invoice-${order.invoiceNumber}.xml"`);
    res.send(xml);
  } catch (error) {
    logger.error('E-invoice XML error', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to generate XML', detail: error.message });
  }
});

// ============================================================================
// GET /:salesOrderId/pdf — PDF with embedded QR code
// ============================================================================
router.get('/:salesOrderId/pdf', requirePermission('VIEW_INVOICES'), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const data = await assembleInvoiceData(db, req.params.salesOrderId);
    if (!data) return res.status(404).json({ success: false, error: 'Sales order not found' });

    const { order } = data;
    if (!order.invoice_uuid) {
      return res.status(400).json({ success: false, error: 'Invoice not yet generated. Call /generate first.' });
    }

    const seller = await getSellerInfo(db, req.user.companyId);

    const pdfData = {
      invoice: {
        invoiceNumber: order.invoiceNumber,
        invoiceUuid: order.invoice_uuid,
        issueDate: order.orderDate,
        dueDate: order.dueDate,
        currency: order.currency || 'OMR',
        vatRate: 5,
        subtotal: parseFloat(order.subtotal || 0),
        taxAmount: parseFloat(order.taxAmount || 0),
        totalAmount: parseFloat(order.totalAmount || 0),
        notes: order.notes,
        paymentTerms: order.paymentTermsDays
      },
      seller,
      buyer: {
        name: order.customerName,
        vatRegistration: order.customerVat,
        contactPerson: order.customerContact,
        address: order.customerAddress
      },
      lines: (data.items || []).map(i => ({
        description: i.materialName || i.description || 'Item',
        quantity: parseFloat(i.quantity || 0),
        unitPrice: parseFloat(i.unitPrice || 0),
        taxRate: 5,
        lineTotal: parseFloat(i.totalAmount || i.lineTotal || (i.quantity * i.unitPrice) || 0)
      })),
      tlvBase64: order.qr_code_tlv
    };

    auditLog('EINVOICE_PDF_DOWNLOADED', req.user.userId, {
      salesOrderId: order.id,
      invoiceNumber: order.invoiceNumber
    });

    await renderInvoicePdf(res, pdfData);
  } catch (error) {
    logger.error('E-invoice PDF error', { error: error.message, stack: error.stack });
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: 'Failed to generate PDF', detail: error.message });
    }
  }
});

// ============================================================================
// GET /:salesOrderId/qr — raw QR code image
// ============================================================================
router.get('/:salesOrderId/qr', requirePermission('VIEW_INVOICES'), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const row = await db('sales_orders').where('id', req.params.salesOrderId)
      .select('qr_code_tlv').first();

    if (!row || !row.qr_code_tlv) {
      return res.status(404).json({ success: false, error: 'QR not available. Generate invoice first.' });
    }

    const dataUrl = await qrDataUrl(row.qr_code_tlv);
    const base64 = dataUrl.split(',')[1];
    const buffer = Buffer.from(base64, 'base64');

    res.setHeader('Content-Type', 'image/png');
    res.send(buffer);
  } catch (error) {
    logger.error('E-invoice QR error', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to generate QR' });
  }
});

module.exports = router;
