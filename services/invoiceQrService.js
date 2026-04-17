/**
 * Invoice QR Service — TLV-encoded QR for OTA e-invoicing
 *
 * Produces a TLV (Tag-Length-Value) binary blob matching the structure
 * expected by Oman Tax Authority (modeled on Saudi ZATCA Phase 1):
 *
 *   Tag 1 — Seller name (UTF-8)
 *   Tag 2 — Seller VAT registration number (UTF-8)
 *   Tag 3 — Invoice timestamp (ISO 8601 UTF-8)
 *   Tag 4 — Invoice total with VAT (UTF-8, e.g. "120.450")
 *   Tag 5 — VAT total (UTF-8, e.g. "20.450")
 *
 * Each field is encoded as:
 *   [1 byte tag] [1 byte length] [N bytes value]
 *
 * All fields are concatenated into a single Buffer, then base64-encoded
 * for use as QR content.
 */

/**
 * Build a single TLV field Buffer.
 * @param {number} tag - 1-255
 * @param {string} value - UTF-8 string
 * @returns {Buffer}
 */
function encodeTlvField(tag, value) {
  const valueBuffer = Buffer.from(String(value ?? ''), 'utf8');
  const header = Buffer.from([tag, valueBuffer.length]);
  return Buffer.concat([header, valueBuffer]);
}

/**
 * Build the full TLV payload for an e-invoice.
 *
 * @param {Object} invoice - { sellerName, sellerVat, timestamp, totalWithVat, vatTotal }
 * @returns {{ tlvBase64: string, tlvBuffer: Buffer }}
 */
function buildInvoiceTlv(invoice) {
  const { sellerName, sellerVat, timestamp, totalWithVat, vatTotal } = invoice;

  const buffers = [
    encodeTlvField(1, sellerName || ''),
    encodeTlvField(2, sellerVat || ''),
    encodeTlvField(3, timestamp || new Date().toISOString()),
    encodeTlvField(4, typeof totalWithVat === 'number' ? totalWithVat.toFixed(3) : String(totalWithVat || '0.000')),
    encodeTlvField(5, typeof vatTotal === 'number' ? vatTotal.toFixed(3) : String(vatTotal || '0.000'))
  ];

  const tlvBuffer = Buffer.concat(buffers);
  return {
    tlvBase64: tlvBuffer.toString('base64'),
    tlvBuffer
  };
}

/**
 * Decode TLV base64 back to the 5 fields. Useful for verification endpoints.
 * @param {string} tlvBase64
 * @returns {Object|null} Decoded fields or null on error
 */
function decodeInvoiceTlv(tlvBase64) {
  try {
    const buffer = Buffer.from(tlvBase64, 'base64');
    const fields = {};
    let offset = 0;

    while (offset < buffer.length) {
      const tag = buffer[offset];
      const length = buffer[offset + 1];
      const value = buffer.subarray(offset + 2, offset + 2 + length).toString('utf8');
      fields[`tag${tag}`] = value;
      offset += 2 + length;
    }

    return {
      sellerName: fields.tag1,
      sellerVat: fields.tag2,
      timestamp: fields.tag3,
      totalWithVat: fields.tag4,
      vatTotal: fields.tag5
    };
  } catch {
    return null;
  }
}

module.exports = { buildInvoiceTlv, decodeInvoiceTlv, encodeTlvField };
