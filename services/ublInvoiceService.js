/**
 * UBL 2.1 Invoice Service
 *
 * Generates Universal Business Language (UBL 2.1) XML for sales invoices.
 * This is the format expected by Oman Tax Authority (OTA) for e-invoicing,
 * which tracks Saudi ZATCA Phase 1 specifications.
 *
 * Produces a minimum-viable UBL Invoice document with:
 *   - AccountingSupplierParty (seller)
 *   - AccountingCustomerParty (buyer)
 *   - InvoiceLine items
 *   - Tax totals
 *   - Legal monetary total
 *   - UUID, IssueDate, InvoiceTypeCode
 *
 * Signed XML (XAdES-BES) is NOT produced here — that's Phase 5.
 */
const { create } = require('xmlbuilder2');
const crypto = require('crypto');

/**
 * Generate an invoice UUID (RFC 4122 v4) if not already assigned.
 */
function generateUuid() {
  return crypto.randomUUID();
}

/**
 * Compute SHA-256 hash of the XML content.
 * Used for the invoice hash chain that OTA expects.
 */
function computeXmlHash(xmlString) {
  return crypto.createHash('sha256').update(xmlString, 'utf8').digest('hex');
}

/**
 * Build a UBL 2.1 Invoice XML string.
 *
 * @param {Object} opts
 * @param {Object} opts.invoice - { invoiceNumber, invoiceUuid, issueDate, dueDate, subtotal, taxAmount, totalAmount, previousHash }
 * @param {Object} opts.seller  - { name, vatRegistration, crNumber, address, city, countryCode }
 * @param {Object} opts.buyer   - { name, vatRegistration, address, city, countryCode }
 * @param {Array}  opts.lines   - [{ description, quantity, unit, unitPrice, taxRate, lineTotal }]
 * @returns {{ xml: string, hash: string, uuid: string }}
 */
function buildInvoiceXml(opts) {
  const { invoice, seller, buyer, lines } = opts;
  const uuid = invoice.invoiceUuid || generateUuid();
  const issueDate = (invoice.issueDate || new Date()).toString().substring(0, 10);
  const currency = invoice.currency || 'OMR';
  const vatRate = invoice.vatRate || 5;

  // Root Invoice element with standard UBL namespaces
  const doc = create({ version: '1.0', encoding: 'UTF-8' })
    .ele('Invoice', {
      xmlns: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
      'xmlns:cac': 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
      'xmlns:cbc': 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2'
    });

  doc.ele('cbc:ProfileID').txt('reporting:1.0');
  doc.ele('cbc:ID').txt(invoice.invoiceNumber);
  doc.ele('cbc:UUID').txt(uuid);
  doc.ele('cbc:IssueDate').txt(issueDate);
  if (invoice.dueDate) {
    doc.ele('cbc:DueDate').txt(String(invoice.dueDate).substring(0, 10));
  }
  doc.ele('cbc:InvoiceTypeCode', { name: '0100000' }).txt('388'); // 388 = Commercial invoice
  doc.ele('cbc:DocumentCurrencyCode').txt(currency);
  doc.ele('cbc:TaxCurrencyCode').txt(currency);

  // Previous invoice hash (optional — for hash chain)
  if (invoice.previousHash) {
    const extension = doc.ele('cac:AdditionalDocumentReference');
    extension.ele('cbc:ID').txt('PIH');
    extension.ele('cac:Attachment')
      .ele('cbc:EmbeddedDocumentBinaryObject', { mimeCode: 'text/plain' })
      .txt(invoice.previousHash);
  }

  // ---------- Seller ----------
  const sellerNode = doc.ele('cac:AccountingSupplierParty').ele('cac:Party');
  const sellerTax = sellerNode.ele('cac:PartyTaxScheme');
  sellerTax.ele('cbc:CompanyID').txt(seller.vatRegistration || '');
  sellerTax.ele('cac:TaxScheme').ele('cbc:ID').txt('VAT');
  const sellerLegal = sellerNode.ele('cac:PartyLegalEntity');
  sellerLegal.ele('cbc:RegistrationName').txt(seller.name || '');
  if (seller.crNumber) {
    sellerLegal.ele('cbc:CompanyID').txt(seller.crNumber);
  }
  if (seller.address) {
    const addr = sellerNode.ele('cac:PostalAddress');
    addr.ele('cbc:StreetName').txt(seller.address);
    if (seller.city) addr.ele('cbc:CityName').txt(seller.city);
    addr.ele('cac:Country').ele('cbc:IdentificationCode').txt(seller.countryCode || 'OM');
  }

  // ---------- Buyer ----------
  const buyerNode = doc.ele('cac:AccountingCustomerParty').ele('cac:Party');
  if (buyer.vatRegistration) {
    const buyerTax = buyerNode.ele('cac:PartyTaxScheme');
    buyerTax.ele('cbc:CompanyID').txt(buyer.vatRegistration);
    buyerTax.ele('cac:TaxScheme').ele('cbc:ID').txt('VAT');
  }
  buyerNode.ele('cac:PartyLegalEntity').ele('cbc:RegistrationName').txt(buyer.name || '');
  if (buyer.address) {
    const addr = buyerNode.ele('cac:PostalAddress');
    addr.ele('cbc:StreetName').txt(buyer.address);
    if (buyer.city) addr.ele('cbc:CityName').txt(buyer.city);
    addr.ele('cac:Country').ele('cbc:IdentificationCode').txt(buyer.countryCode || 'OM');
  }

  // ---------- Tax Total ----------
  const taxTotal = doc.ele('cac:TaxTotal');
  taxTotal.ele('cbc:TaxAmount', { currencyID: currency }).txt(Number(invoice.taxAmount || 0).toFixed(2));

  const taxSubtotal = taxTotal.ele('cac:TaxSubtotal');
  taxSubtotal.ele('cbc:TaxableAmount', { currencyID: currency }).txt(Number(invoice.subtotal || 0).toFixed(2));
  taxSubtotal.ele('cbc:TaxAmount', { currencyID: currency }).txt(Number(invoice.taxAmount || 0).toFixed(2));
  const cat = taxSubtotal.ele('cac:TaxCategory');
  cat.ele('cbc:ID').txt('S'); // S = Standard rate
  cat.ele('cbc:Percent').txt(String(vatRate));
  cat.ele('cac:TaxScheme').ele('cbc:ID').txt('VAT');

  // ---------- Monetary Total ----------
  const mt = doc.ele('cac:LegalMonetaryTotal');
  mt.ele('cbc:LineExtensionAmount', { currencyID: currency }).txt(Number(invoice.subtotal || 0).toFixed(2));
  mt.ele('cbc:TaxExclusiveAmount', { currencyID: currency }).txt(Number(invoice.subtotal || 0).toFixed(2));
  mt.ele('cbc:TaxInclusiveAmount', { currencyID: currency }).txt(Number(invoice.totalAmount || 0).toFixed(2));
  mt.ele('cbc:PayableAmount', { currencyID: currency }).txt(Number(invoice.totalAmount || 0).toFixed(2));

  // ---------- Invoice Lines ----------
  (lines || []).forEach((line, idx) => {
    const ln = doc.ele('cac:InvoiceLine');
    ln.ele('cbc:ID').txt(String(idx + 1));
    ln.ele('cbc:InvoicedQuantity', { unitCode: line.unit || 'EA' }).txt(Number(line.quantity || 0).toFixed(3));
    ln.ele('cbc:LineExtensionAmount', { currencyID: currency }).txt(Number(line.lineTotal || 0).toFixed(2));

    const lineTax = ln.ele('cac:TaxTotal');
    const lineTaxAmount = (Number(line.lineTotal || 0) * (line.taxRate || vatRate) / 100);
    lineTax.ele('cbc:TaxAmount', { currencyID: currency }).txt(lineTaxAmount.toFixed(2));
    lineTax.ele('cbc:RoundingAmount', { currencyID: currency }).txt((Number(line.lineTotal || 0) + lineTaxAmount).toFixed(2));

    const item = ln.ele('cac:Item');
    item.ele('cbc:Name').txt(line.description || 'Item');
    const itemTaxCat = item.ele('cac:ClassifiedTaxCategory');
    itemTaxCat.ele('cbc:ID').txt('S');
    itemTaxCat.ele('cbc:Percent').txt(String(line.taxRate || vatRate));
    itemTaxCat.ele('cac:TaxScheme').ele('cbc:ID').txt('VAT');

    const price = ln.ele('cac:Price');
    price.ele('cbc:PriceAmount', { currencyID: currency }).txt(Number(line.unitPrice || 0).toFixed(3));
  });

  const xml = doc.end({ prettyPrint: true });
  const hash = computeXmlHash(xml);
  return { xml, hash, uuid };
}

module.exports = { buildInvoiceXml, computeXmlHash, generateUuid };
