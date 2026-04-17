/**
 * WCN Manifest PDF Template (Oman MD 18/2017)
 *
 * Generates a Waste Transfer Manifest PDF matching the requirements of
 * Oman's Ministerial Decision No. 18/2017.
 *
 * Required sections:
 *   1. Document header (identification)
 *   2. Waste Generator (supplier) — name, CR, VAT, address
 *   3. Waste Transporter (driver + vehicle)
 *   4. Waste Receiver (our company + environmental permit)
 *   5. Waste Description Table (materials, qty, classification)
 *   6. Dates (collection, transport, receipt)
 *   7. Signatures (dotted lines for all three parties)
 *   8. Footer with verification QR
 */
const PDFDocument = require('pdfkit');
const {
  PAGE, COLORS, FONT,
  drawDocumentHeader, drawSectionTitle, drawKeyValueGrid,
  drawTable, drawSignatureBlocks, drawFooter, qrDataUrl,
  streamPdfToResponse
} = require('../utils/pdfGenerator');

/**
 * Format a date string as DD-MMM-YYYY
 */
function fmtDate(d) {
  if (!d) return '—';
  try {
    const date = new Date(d);
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return String(d);
  }
}

function fmtQty(q, unit) {
  if (q === null || q === undefined) return '—';
  return `${parseFloat(q).toFixed(3)}${unit ? ' ' + unit : ''}`;
}

/**
 * Render a WCN manifest PDF to the response.
 *
 * @param {Response} res - Express response
 * @param {Object} data - { wcn, generator, transporter, receiver, items, verifyUrl }
 */
async function renderWcnManifest(res, data) {
  const { wcn, generator, transporter, receiver, items, verifyUrl } = data;
  const filename = `WCN-Manifest-${wcn.wcn_number}.pdf`;

  // Build the QR code up-front
  const qrUrl = await qrDataUrl(verifyUrl);

  // Create the PDF document
  const doc = new PDFDocument({
    size: 'A4',
    margin: PAGE.margin,
    bufferPages: true,
    info: {
      Title: `Waste Transfer Manifest ${wcn.wcn_number}`,
      Author: receiver.name || 'PBM',
      Subject: 'Waste Consignment Note — MD 18/2017',
      Creator: 'PBM Compliance Module'
    }
  });

  // ---------- 1. HEADER ----------
  drawDocumentHeader(doc, {
    companyName: receiver.name || 'Company Name',
    documentTitle: 'WASTE TRANSFER MANIFEST',
    documentNumber: wcn.wcn_number,
    subtitle: 'Issued under Oman Ministerial Decision No. 18/2017 — Environmental Regulations',
    qrDataUrl: qrUrl
  });

  // ---------- 2. GENERATOR (supplier) ----------
  drawSectionTitle(doc, '1. Waste Generator (Producer)');
  drawKeyValueGrid(doc, [
    ['Name', generator.name || '—'],
    ['CR Number', generator.cr || '—'],
    ['VAT Reg.', generator.vat || '—'],
    ['Contact Person', generator.contactPerson || '—'],
    ['Phone', generator.phone || '—'],
    ['Email', generator.email || '—'],
    ['Address', generator.address || '—'],
    ['Location', generator.locationName || '—']
  ]);

  // ---------- 3. TRANSPORTER ----------
  drawSectionTitle(doc, '2. Waste Transporter');
  drawKeyValueGrid(doc, [
    ['Driver Name', transporter.driverName || '—'],
    ['Driver ID / Badge', transporter.driverId || '—'],
    ['Driver Phone', transporter.driverPhone || '—'],
    ['Vehicle Reg.', transporter.vehiclePlate || '—'],
    ['Vehicle Type', transporter.vehicleType || '—'],
    ['Vehicle Make/Model', transporter.vehicleDetails || '—']
  ]);

  // ---------- 4. RECEIVER (our company) ----------
  drawSectionTitle(doc, '3. Waste Receiver / Treatment Facility');
  drawKeyValueGrid(doc, [
    ['Facility Name', receiver.name || '—'],
    ['CR Number', receiver.cr || '—'],
    ['VAT Reg.', receiver.vat || '—'],
    ['Environmental Permit #', receiver.environmentalPermit || '—'],
    ['Treatment Method', receiver.treatmentMethod || 'Collection & Processing'],
    ['Authorized Signatory', receiver.signatory || '—']
  ]);

  // ---------- 5. WASTE DESCRIPTION ----------
  drawSectionTitle(doc, '4. Waste Description');

  const tableColumns = [
    { key: 'serial', label: '#', width: 28, align: 'center' },
    { key: 'material', label: 'Material', width: 170 },
    { key: 'category', label: 'Category', width: 110 },
    { key: 'quantity', label: 'Qty', width: 80, align: 'right' },
    { key: 'grade', label: 'Grade', width: 50, align: 'center' },
    { key: 'condition', label: 'Condition', width: 77 }
  ];

  const tableRows = (items || []).map((item, i) => ({
    serial: i + 1,
    material: item.materialName || '—',
    category: item.category || '—',
    quantity: fmtQty(item.verifiedQuantity ?? item.collectedQuantity, item.unit),
    grade: item.qualityGrade || '—',
    condition: item.materialCondition || '—'
  }));

  drawTable(doc, { columns: tableColumns, rows: tableRows });

  // Total quantity row
  const totalQty = (items || []).reduce((s, it) => s + parseFloat(it.verifiedQuantity ?? it.collectedQuantity ?? 0), 0);
  const totalItems = (items || []).length;
  doc.fillColor(COLORS.dark).font(FONT.bold).fontSize(9)
    .text(`Total Items: ${totalItems}       Total Quantity: ${totalQty.toFixed(3)}`, PAGE.margin, doc.y, {
      width: PAGE.width - 2 * PAGE.margin, align: 'right'
    });
  doc.y += 14;

  // ---------- 6. DATES ----------
  drawSectionTitle(doc, '5. Dates');
  drawKeyValueGrid(doc, [
    ['Collection Date', fmtDate(wcn.scheduledDate)],
    ['Transport Date', fmtDate(wcn.scheduledDate)],
    ['Receipt Date (WCN Finalized)', fmtDate(wcn.wcn_date)],
    ['Finalized By', wcn.finalizedByName || '—']
  ]);

  // ---------- Notes ----------
  if (wcn.notes || wcn.rectification_notes) {
    drawSectionTitle(doc, '6. Notes & Remarks');
    doc.fillColor(COLORS.black).font(FONT.regular).fontSize(9);
    if (wcn.notes) {
      doc.text(wcn.notes, PAGE.margin, doc.y, { width: PAGE.width - 2 * PAGE.margin });
      doc.y += 6;
    }
    if (wcn.rectification_notes) {
      doc.fillColor(COLORS.danger).font(FONT.bold).fontSize(8).text('Rectification Notes:', PAGE.margin, doc.y);
      doc.fillColor(COLORS.black).font(FONT.regular).fontSize(9)
        .text(wcn.rectification_notes, PAGE.margin + 80, doc.y, { width: PAGE.width - 2 * PAGE.margin - 80 });
    }
    doc.y += 10;
  }

  // ---------- 7. SIGNATURES ----------
  // Ensure we have enough room for signatures; add page if needed
  if (doc.y > PAGE.height - 140) doc.addPage();
  drawSectionTitle(doc, '7. Chain of Custody — Signatures');
  drawSignatureBlocks(doc, [
    { label: 'Generator', nameHint: generator.contactPerson || 'Authorized signatory' },
    { label: 'Transporter', nameHint: transporter.driverName || 'Driver signature' },
    { label: 'Receiver', nameHint: receiver.signatory || 'Facility acceptor' }
  ]);

  // ---------- 8. FOOTER (on every page) ----------
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    drawFooter(doc, verifyUrl);
  }

  streamPdfToResponse(doc, res, filename);
}

module.exports = { renderWcnManifest };
