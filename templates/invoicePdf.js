/**
 * E-Invoice PDF Template
 *
 * Generates a tax invoice PDF matching OTA e-invoicing expectations:
 *   - Company details (seller)
 *   - Customer details (buyer) with VAT reg
 *   - Invoice metadata (UUID, number, date)
 *   - Line items with tax breakdown
 *   - QR code (bottom right) containing TLV-encoded summary
 *   - Totals (subtotal, VAT, grand total)
 */
const PDFDocument = require('pdfkit');
const {
  PAGE, COLORS, FONT,
  drawDocumentHeader, drawSectionTitle, drawKeyValueGrid,
  drawTable, drawFooter, qrDataUrl,
  streamPdfToResponse
} = require('../utils/pdfGenerator');

function fmtOmr(n) {
  return `${parseFloat(n || 0).toFixed(3)} OMR`;
}

function fmtDate(d) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return String(d);
  }
}

/**
 * Render an e-invoice PDF.
 *
 * @param {Response} res
 * @param {Object} data - { invoice, seller, buyer, lines, tlvBase64 }
 */
async function renderInvoicePdf(res, data) {
  const { invoice, seller, buyer, lines, tlvBase64 } = data;
  const filename = `Invoice-${invoice.invoiceNumber}.pdf`;

  // QR code from TLV payload
  const qrUrl = await qrDataUrl(tlvBase64);

  const doc = new PDFDocument({
    size: 'A4',
    margin: PAGE.margin,
    bufferPages: true,
    info: {
      Title: `Tax Invoice ${invoice.invoiceNumber}`,
      Author: seller.name || 'PBM',
      Subject: 'VAT Invoice — OTA E-Invoicing',
      Creator: 'PBM E-Invoicing Module'
    }
  });

  // ---------- HEADER ----------
  drawDocumentHeader(doc, {
    companyName: seller.name || 'Company Name',
    documentTitle: 'TAX INVOICE',
    documentNumber: invoice.invoiceNumber,
    subtitle: 'VAT Invoice per Oman Tax Authority e-invoicing standard',
    qrDataUrl: qrUrl
  });

  // ---------- SELLER ----------
  drawSectionTitle(doc, 'Seller (From)');
  drawKeyValueGrid(doc, [
    ['Name', seller.name || '—'],
    ['VAT Reg.', seller.vatRegistration || '—'],
    ['CR Number', seller.crNumber || '—'],
    ['Address', seller.address || '—']
  ]);

  // ---------- BUYER ----------
  drawSectionTitle(doc, 'Buyer (Bill To)');
  drawKeyValueGrid(doc, [
    ['Name', buyer.name || '—'],
    ['VAT Reg.', buyer.vatRegistration || '—'],
    ['Contact', buyer.contactPerson || '—'],
    ['Address', buyer.address || '—']
  ]);

  // ---------- INVOICE META ----------
  drawSectionTitle(doc, 'Invoice Details');
  drawKeyValueGrid(doc, [
    ['Invoice Number', invoice.invoiceNumber],
    ['Invoice UUID', invoice.invoiceUuid || '—'],
    ['Issue Date', fmtDate(invoice.issueDate)],
    ['Due Date', fmtDate(invoice.dueDate)],
    ['Payment Terms', invoice.paymentTerms ? `${invoice.paymentTerms} days` : '—'],
    ['Currency', invoice.currency || 'OMR']
  ]);

  // ---------- LINE ITEMS ----------
  drawSectionTitle(doc, 'Items');
  drawTable(doc, {
    columns: [
      { key: 'sn', label: '#', width: 28, align: 'center' },
      { key: 'desc', label: 'Description', width: 220 },
      { key: 'qty', label: 'Qty', width: 60, align: 'right' },
      { key: 'price', label: 'Unit Price', width: 75, align: 'right' },
      { key: 'tax', label: 'VAT%', width: 50, align: 'right' },
      { key: 'total', label: 'Line Total', width: 82, align: 'right' }
    ],
    rows: (lines || []).map((l, i) => ({
      sn: i + 1,
      desc: l.description || '—',
      qty: parseFloat(l.quantity || 0).toFixed(3),
      price: parseFloat(l.unitPrice || 0).toFixed(3),
      tax: `${l.taxRate ?? 5}%`,
      total: parseFloat(l.lineTotal || 0).toFixed(3)
    }))
  });

  // ---------- TOTALS ----------
  const totalsY = doc.y + 6;
  const totalsX = PAGE.width - PAGE.margin - 220;
  const totalsWidth = 220;

  doc.rect(totalsX, totalsY, totalsWidth, 70).fill(COLORS.faint);

  doc.fillColor(COLORS.dark).font(FONT.regular).fontSize(9);
  doc.text('Subtotal (excl. VAT):', totalsX + 10, totalsY + 10, { width: 140, align: 'left' });
  doc.text(fmtOmr(invoice.subtotal), totalsX + 10, totalsY + 10, { width: totalsWidth - 20, align: 'right' });

  doc.text(`VAT (${invoice.vatRate || 5}%):`, totalsX + 10, totalsY + 28, { width: 140 });
  doc.text(fmtOmr(invoice.taxAmount), totalsX + 10, totalsY + 28, { width: totalsWidth - 20, align: 'right' });

  doc.fillColor(COLORS.black).font(FONT.bold).fontSize(11);
  doc.text('Grand Total:', totalsX + 10, totalsY + 48, { width: 140 });
  doc.text(fmtOmr(invoice.totalAmount), totalsX + 10, totalsY + 48, { width: totalsWidth - 20, align: 'right' });

  doc.y = totalsY + 90;

  // ---------- NOTES / TERMS ----------
  if (invoice.notes) {
    doc.fillColor(COLORS.mid).font(FONT.bold).fontSize(8).text('NOTES', PAGE.margin, doc.y);
    doc.fillColor(COLORS.black).font(FONT.regular).fontSize(9)
      .text(invoice.notes, PAGE.margin, doc.y + 4, { width: PAGE.width - 2 * PAGE.margin });
  }

  // ---------- FOOTER ON EVERY PAGE ----------
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    drawFooter(doc, `Invoice UUID: ${invoice.invoiceUuid || ''}`);
  }

  streamPdfToResponse(doc, res, filename);
}

module.exports = { renderInvoicePdf };
