/**
 * PDF Generator Utilities
 *
 * Shared helpers for building compliance documents (WCN manifests, e-invoices).
 * Built on pdfkit — a pure-JS PDF library. No Chromium needed.
 *
 * Design notes:
 * - All helpers mutate the doc in place (no return) — matches pdfkit's chainable API
 * - Colors are kept minimal (black/gray/accent) for professional output
 * - Fonts default to Helvetica (built into pdfkit, no external font files needed)
 * - All positions are in points (1pt = 1/72 inch). A4 page = 595 x 842 pts.
 */
const QRCode = require('qrcode');

// Design tokens — keep document styling consistent
const COLORS = {
  black: '#000000',
  dark: '#1f2937',
  mid: '#6b7280',
  light: '#d1d5db',
  faint: '#f3f4f6',
  accent: '#0ea5e9',
  danger: '#dc2626'
};

const FONT = {
  regular: 'Helvetica',
  bold: 'Helvetica-Bold',
  oblique: 'Helvetica-Oblique'
};

const PAGE = {
  width: 595,       // A4 width in points
  height: 842,      // A4 height in points
  margin: 40
};

/**
 * Draw the document header (company name + document title + WCN/invoice number + QR).
 *
 * @param {PDFDocument} doc
 * @param {Object} opts - { companyName, documentTitle, documentNumber, subtitle, qrDataUrl }
 */
function drawDocumentHeader(doc, opts) {
  const { companyName, documentTitle, documentNumber, subtitle, qrDataUrl } = opts;
  const y = PAGE.margin;

  // Left: company name + title
  doc.fillColor(COLORS.dark).font(FONT.bold).fontSize(16).text(companyName, PAGE.margin, y);
  doc.moveDown(0.2);
  doc.fillColor(COLORS.black).font(FONT.bold).fontSize(14).text(documentTitle);
  if (subtitle) {
    doc.fillColor(COLORS.mid).font(FONT.regular).fontSize(9).text(subtitle);
  }
  doc.fillColor(COLORS.black).font(FONT.bold).fontSize(11).text(`No: ${documentNumber}`);

  // Right: QR code (70x70 pts)
  if (qrDataUrl) {
    try {
      // qrDataUrl is a data URL like 'data:image/png;base64,...'
      const base64 = qrDataUrl.split(',')[1];
      const buffer = Buffer.from(base64, 'base64');
      doc.image(buffer, PAGE.width - PAGE.margin - 70, y, { width: 70, height: 70 });
    } catch (e) {
      // If QR fails, skip silently
    }
  }

  // Horizontal rule
  const ruleY = y + 80;
  doc.moveTo(PAGE.margin, ruleY)
    .lineTo(PAGE.width - PAGE.margin, ruleY)
    .strokeColor(COLORS.light).lineWidth(1).stroke();

  // Position cursor below the rule
  doc.y = ruleY + 12;
  doc.x = PAGE.margin;
}

/**
 * Draw a section title bar (dark background with white text).
 */
function drawSectionTitle(doc, title) {
  const y = doc.y;
  doc.rect(PAGE.margin, y, PAGE.width - 2 * PAGE.margin, 20).fill(COLORS.dark);
  doc.fillColor('white').font(FONT.bold).fontSize(10)
    .text(title.toUpperCase(), PAGE.margin + 8, y + 6);
  doc.fillColor(COLORS.black);
  doc.y = y + 26;
  doc.x = PAGE.margin;
}

/**
 * Draw a two-column key/value grid.
 *
 * @param {PDFDocument} doc
 * @param {Array<[string, string]>} rows - array of [label, value]
 * @param {Object} opts - { columns: 2, labelWidth: 110 }
 */
function drawKeyValueGrid(doc, rows, opts = {}) {
  const { columns = 2, labelWidth = 110 } = opts;
  const rowHeight = 16;
  const colWidth = (PAGE.width - 2 * PAGE.margin) / columns;

  const startY = doc.y;
  let currentCol = 0;
  let currentRow = 0;

  for (const [label, value] of rows) {
    const x = PAGE.margin + currentCol * colWidth;
    const y = startY + currentRow * rowHeight;

    doc.fillColor(COLORS.mid).font(FONT.regular).fontSize(8)
      .text(label, x, y, { width: labelWidth - 4 });
    doc.fillColor(COLORS.black).font(FONT.bold).fontSize(9)
      .text(value || '—', x + labelWidth, y, { width: colWidth - labelWidth - 8, ellipsis: true });

    currentCol++;
    if (currentCol >= columns) {
      currentCol = 0;
      currentRow++;
    }
  }

  // Move cursor below the last row
  const finalRows = currentCol > 0 ? currentRow + 1 : currentRow;
  doc.y = startY + finalRows * rowHeight + 8;
  doc.x = PAGE.margin;
}

/**
 * Draw a table with borders.
 *
 * @param {PDFDocument} doc
 * @param {Object} spec - { columns: [{ key, label, width, align }], rows: [...] }
 */
function drawTable(doc, spec) {
  const { columns, rows } = spec;
  const tableWidth = PAGE.width - 2 * PAGE.margin;
  const headerHeight = 22;
  const rowHeight = 18;

  let y = doc.y;

  // Header background
  doc.rect(PAGE.margin, y, tableWidth, headerHeight).fill(COLORS.faint);
  let x = PAGE.margin;
  for (const col of columns) {
    const colWidth = typeof col.width === 'number' ? col.width : tableWidth / columns.length;
    doc.fillColor(COLORS.dark).font(FONT.bold).fontSize(8)
      .text(col.label.toUpperCase(), x + 4, y + 7, {
        width: colWidth - 8,
        align: col.align || 'left'
      });
    x += colWidth;
  }
  y += headerHeight;

  // Rows
  doc.fillColor(COLORS.black);
  for (const row of rows) {
    // Alternate row shading
    const rowIndex = rows.indexOf(row);
    if (rowIndex % 2 === 1) {
      doc.rect(PAGE.margin, y, tableWidth, rowHeight).fill('#fafbfc');
    }

    x = PAGE.margin;
    for (const col of columns) {
      const colWidth = typeof col.width === 'number' ? col.width : tableWidth / columns.length;
      const value = row[col.key] ?? '—';
      doc.fillColor(COLORS.black).font(FONT.regular).fontSize(9)
        .text(String(value), x + 4, y + 5, {
          width: colWidth - 8,
          align: col.align || 'left',
          ellipsis: true
        });
      x += colWidth;
    }
    y += rowHeight;
  }

  // Outer border
  doc.rect(PAGE.margin, doc.y, tableWidth, y - doc.y).strokeColor(COLORS.light).lineWidth(0.5).stroke();

  doc.y = y + 10;
  doc.x = PAGE.margin;
}

/**
 * Draw a signature block: three labeled dotted lines for handover signing.
 *
 * @param {PDFDocument} doc
 * @param {Array<{label: string, nameHint: string}>} signatories
 */
function drawSignatureBlocks(doc, signatories) {
  const blockWidth = (PAGE.width - 2 * PAGE.margin) / signatories.length;
  const y = doc.y + 10;
  const lineY = y + 40;

  signatories.forEach((s, i) => {
    const x = PAGE.margin + i * blockWidth;

    // Dotted line for signature
    doc.strokeColor(COLORS.mid).lineWidth(0.8).dash(2, { space: 2 });
    doc.moveTo(x + 10, lineY).lineTo(x + blockWidth - 10, lineY).stroke();
    doc.undash();

    // Label below
    doc.fillColor(COLORS.dark).font(FONT.bold).fontSize(9)
      .text(s.label, x + 10, lineY + 4, { width: blockWidth - 20, align: 'center' });
    doc.fillColor(COLORS.mid).font(FONT.regular).fontSize(7)
      .text(s.nameHint, x + 10, lineY + 18, { width: blockWidth - 20, align: 'center' });
  });

  doc.y = lineY + 40;
  doc.x = PAGE.margin;
}

/**
 * Draw the footer on every page (page number + generation timestamp + verification URL).
 */
function drawFooter(doc, verifyUrl) {
  const footerY = PAGE.height - 30;
  doc.fillColor(COLORS.mid).font(FONT.regular).fontSize(7);

  // Left: generated timestamp
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  doc.text(`Generated: ${now} UTC`, PAGE.margin, footerY);

  // Center: verification URL
  if (verifyUrl) {
    doc.text(`Verify: ${verifyUrl}`, PAGE.margin, footerY, {
      width: PAGE.width - 2 * PAGE.margin, align: 'center'
    });
  }

  // Right: page number
  const range = doc.bufferedPageRange();
  const pageNum = range.start + (doc._pageBufferStart || 0) + 1;
  doc.text(`Page ${pageNum}`, PAGE.margin, footerY, {
    width: PAGE.width - 2 * PAGE.margin, align: 'right'
  });
}

/**
 * Generate a QR code as a data URL. Returns null on error.
 */
async function qrDataUrl(content, options = {}) {
  try {
    return await QRCode.toDataURL(content, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 200,
      ...options
    });
  } catch (err) {
    return null;
  }
}

/**
 * Generate a QR code from TLV-encoded binary content (for OTA e-invoicing).
 * Returns a data URL PNG.
 */
async function qrFromTlvBase64(tlvBase64) {
  return await qrDataUrl(tlvBase64, { errorCorrectionLevel: 'M', width: 200 });
}

/**
 * Stream a PDF document to an Express response.
 * Sets the correct Content-Type + Content-Disposition headers.
 *
 * @param {PDFDocument} doc - pdfkit document instance
 * @param {Response} res - Express response
 * @param {string} filename
 */
function streamPdfToResponse(doc, res, filename) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  doc.pipe(res);
  doc.end();
}

module.exports = {
  COLORS,
  FONT,
  PAGE,
  drawDocumentHeader,
  drawSectionTitle,
  drawKeyValueGrid,
  drawTable,
  drawSignatureBlocks,
  drawFooter,
  qrDataUrl,
  qrFromTlvBase64,
  streamPdfToResponse
};
