/**
 * Petty Cash QR Code Utilities
 *
 * Generates secure QR tokens and QR code images for petty cash users.
 *
 * QR Flow:
 * 1. Admin creates petty cash user -> generates unique qr_token
 * 2. QR code contains URL: {PORTAL_URL}/pc-portal?token={qr_token}
 * 3. User scans QR -> opens portal -> enters PIN -> authenticated
 *
 * Security:
 * - 64-char hex token = 256 bits entropy (practically unguessable)
 * - Token is tied to specific card/user
 * - Can be regenerated if compromised
 */

const crypto = require('crypto');
const QRCode = require('qrcode');

// Get portal base URL from environment or request origin
// Priority: Explicit env var > Request origin > Default localhost
const getPortalBaseUrl = (requestOrigin = null) => {
  // If explicit portal URL is set, always use it
  if (process.env.PETTY_CASH_PORTAL_URL) {
    return process.env.PETTY_CASH_PORTAL_URL;
  }

  // If FRONTEND_URL is set, use it
  if (process.env.FRONTEND_URL) {
    return process.env.FRONTEND_URL;
  }

  // If we have a request origin (from where the admin is accessing), use that
  // This handles dynamic port scenarios during development
  if (requestOrigin) {
    return requestOrigin;
  }

  // Default fallback
  return 'http://localhost:3000';
};

/**
 * Generate a cryptographically secure QR token
 * Returns a 64-character hexadecimal string (256 bits of entropy)
 *
 * @returns {string} 64-char hex string
 */
const generateQrToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

/**
 * Generate a QR code as a data URL (base64 PNG)
 * The QR code contains a URL that directs to the petty cash portal
 *
 * @param {string} qrToken - The unique token for this user
 * @param {string} companyId - Company identifier (for URL routing)
 * @param {object} options - QR code generation options
 * @param {string} options.requestOrigin - Optional origin from the request to use as base URL
 * @returns {Promise<string>} Data URL of the QR code image
 */
const generateQRCodeDataUrl = async (qrToken, companyId, options = {}) => {
  const portalUrl = getPortalBaseUrl(options.requestOrigin);

  // URL format: /pc-portal?token=xxx&company=yyy
  // Company is included to help with multi-tenant routing
  const url = `${portalUrl}/pc-portal?token=${qrToken}&company=${encodeURIComponent(companyId)}`;

  const qrOptions = {
    type: 'image/png',
    width: options.width || 300,
    margin: options.margin || 2,
    color: {
      dark: options.darkColor || '#000000',
      light: options.lightColor || '#ffffff',
    },
    errorCorrectionLevel: options.errorCorrection || 'M', // Medium error correction
  };

  try {
    const dataUrl = await QRCode.toDataURL(url, qrOptions);
    return dataUrl;
  } catch (error) {
    throw new Error(`Failed to generate QR code: ${error.message}`);
  }
};

/**
 * Generate a QR code as a Buffer (for saving to file or sending as binary)
 *
 * @param {string} qrToken - The unique token for this user
 * @param {string} companyId - Company identifier
 * @param {object} options - QR code generation options
 * @param {string} options.requestOrigin - Optional origin from the request to use as base URL
 * @returns {Promise<Buffer>} PNG buffer of the QR code
 */
const generateQRCodeBuffer = async (qrToken, companyId, options = {}) => {
  const portalUrl = getPortalBaseUrl(options.requestOrigin);
  const url = `${portalUrl}/pc-portal?token=${qrToken}&company=${encodeURIComponent(companyId)}`;

  const qrOptions = {
    type: 'png',
    width: options.width || 300,
    margin: options.margin || 2,
    color: {
      dark: options.darkColor || '#000000',
      light: options.lightColor || '#ffffff',
    },
    errorCorrectionLevel: options.errorCorrection || 'M',
  };

  try {
    const buffer = await QRCode.toBuffer(url, qrOptions);
    return buffer;
  } catch (error) {
    throw new Error(`Failed to generate QR code buffer: ${error.message}`);
  }
};

/**
 * Generate the portal URL for a given token
 * (For display in admin UI or manual linking)
 *
 * @param {string} qrToken - The unique token
 * @param {string} companyId - Company identifier
 * @param {string} requestOrigin - Optional origin from the request to use as base URL
 * @returns {string} The full portal URL
 */
const getPortalUrl = (qrToken, companyId, requestOrigin = null) => {
  const portalUrl = getPortalBaseUrl(requestOrigin);
  return `${portalUrl}/pc-portal?token=${qrToken}&company=${encodeURIComponent(companyId)}`;
};

/**
 * Validate a QR token format
 * Must be exactly 64 hexadecimal characters
 *
 * @param {string} token - Token to validate
 * @returns {boolean} Whether the token is valid format
 */
const isValidTokenFormat = (token) => {
  if (!token || typeof token !== 'string') {
    return false;
  }
  return /^[a-f0-9]{64}$/i.test(token);
};

module.exports = {
  generateQrToken,
  generateQRCodeDataUrl,
  generateQRCodeBuffer,
  getPortalUrl,
  isValidTokenFormat,
};
