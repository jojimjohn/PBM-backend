/**
 * Multi-Factor Authentication (MFA) Utility
 *
 * Implements TOTP (Time-based One-Time Password) using RFC 6238.
 * Compatible with Google Authenticator, Authy, Microsoft Authenticator, etc.
 *
 * Features:
 * - TOTP secret generation
 * - QR code generation for authenticator app setup
 * - Code verification with time drift tolerance
 * - Backup codes for account recovery
 */

const { authenticator } = require('otplib');
const QRCode = require('qrcode');
const crypto = require('crypto');
const { logger } = require('./logger');

// Configuration
const APP_NAME = process.env.MFA_APP_NAME || 'PBM System';
const BACKUP_CODE_COUNT = 10;
const BACKUP_CODE_LENGTH = 8;

// Configure otplib
authenticator.options = {
  digits: 6,           // 6-digit codes
  step: 30,            // 30-second window
  window: 1            // Allow 1 step before/after for clock drift
};

/**
 * Generate a new TOTP secret for a user
 * @returns {string} Base32-encoded secret
 */
const generateSecret = () => {
  return authenticator.generateSecret();
};

/**
 * Generate TOTP URI for authenticator apps
 * @param {string} secret - Base32-encoded secret
 * @param {string} email - User's email (used as account name)
 * @returns {string} otpauth:// URI
 */
const generateTotpUri = (secret, email) => {
  return authenticator.keyuri(email, APP_NAME, secret);
};

/**
 * Generate QR code as data URL for authenticator app setup
 * @param {string} secret - Base32-encoded secret
 * @param {string} email - User's email
 * @returns {Promise<string>} Data URL for QR code image
 */
const generateQRCode = async (secret, email) => {
  try {
    const uri = generateTotpUri(secret, email);
    const qrDataUrl = await QRCode.toDataURL(uri, {
      width: 256,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#ffffff'
      }
    });
    return qrDataUrl;
  } catch (error) {
    logger.error('Failed to generate QR code', { error: error.message });
    throw new Error('Failed to generate QR code');
  }
};

/**
 * Verify a TOTP code
 * @param {string} code - 6-digit code from authenticator app
 * @param {string} secret - User's TOTP secret
 * @returns {boolean} True if code is valid
 */
const verifyCode = (code, secret) => {
  if (!code || !secret) {
    return false;
  }

  try {
    // Remove any spaces/dashes user might have entered
    const cleanCode = code.replace(/[\s-]/g, '');

    return authenticator.verify({
      token: cleanCode,
      secret: secret
    });
  } catch (error) {
    logger.error('TOTP verification error', { error: error.message });
    return false;
  }
};

/**
 * Generate backup codes for account recovery
 * @returns {Object} { codes: string[], hashedCodes: string[] }
 */
const generateBackupCodes = () => {
  const codes = [];
  const hashedCodes = [];

  for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
    // Generate random code (e.g., "ABCD-1234")
    const part1 = crypto.randomBytes(2).toString('hex').toUpperCase();
    const part2 = crypto.randomBytes(2).toString('hex').toUpperCase();
    const code = `${part1}-${part2}`;

    codes.push(code);

    // Store hashed version in database
    const hash = crypto.createHash('sha256').update(code).digest('hex');
    hashedCodes.push(hash);
  }

  return { codes, hashedCodes };
};

/**
 * Verify a backup code
 * @param {string} code - Backup code entered by user
 * @param {string[]} hashedCodes - Array of hashed backup codes from database
 * @returns {Object} { valid: boolean, usedIndex?: number }
 */
const verifyBackupCode = (code, hashedCodes) => {
  if (!code || !hashedCodes || !Array.isArray(hashedCodes)) {
    return { valid: false };
  }

  // Clean up input
  const cleanCode = code.toUpperCase().replace(/[\s]/g, '');

  // Hash the input code
  const inputHash = crypto.createHash('sha256').update(cleanCode).digest('hex');

  // Find matching hash
  const index = hashedCodes.findIndex(hash => hash === inputHash);

  if (index !== -1) {
    return { valid: true, usedIndex: index };
  }

  return { valid: false };
};

/**
 * Encrypt MFA secret for database storage
 * Uses AES-256-GCM for authenticated encryption
 * @param {string} secret - Plain text secret
 * @returns {string} Encrypted secret (iv:authTag:ciphertext)
 */
const encryptSecret = (secret) => {
  const encryptionKey = process.env.MFA_ENCRYPTION_KEY;

  if (!encryptionKey || encryptionKey.length < 32) {
    logger.warn('MFA_ENCRYPTION_KEY not set or too short, storing secret as-is');
    return secret; // Fallback for development
  }

  try {
    const key = crypto.scryptSync(encryptionKey, 'mfa-salt', 32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

    let encrypted = cipher.update(secret, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');

    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  } catch (error) {
    logger.error('Failed to encrypt MFA secret', { error: error.message });
    throw new Error('Encryption failed');
  }
};

/**
 * Decrypt MFA secret from database
 * @param {string} encryptedSecret - Encrypted secret (iv:authTag:ciphertext)
 * @returns {string} Decrypted secret
 */
const decryptSecret = (encryptedSecret) => {
  const encryptionKey = process.env.MFA_ENCRYPTION_KEY;

  if (!encryptionKey || encryptionKey.length < 32) {
    return encryptedSecret; // Fallback for development
  }

  // Check if it's actually encrypted (has the right format)
  if (!encryptedSecret.includes(':')) {
    return encryptedSecret; // Not encrypted, return as-is
  }

  try {
    const [ivHex, authTagHex, encrypted] = encryptedSecret.split(':');
    const key = crypto.scryptSync(encryptionKey, 'mfa-salt', 32);
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    logger.error('Failed to decrypt MFA secret', { error: error.message });
    throw new Error('Decryption failed');
  }
};

/**
 * Generate current TOTP code (for testing only)
 * @param {string} secret - Base32-encoded secret
 * @returns {string} Current 6-digit code
 */
const generateCurrentCode = (secret) => {
  return authenticator.generate(secret);
};

module.exports = {
  generateSecret,
  generateTotpUri,
  generateQRCode,
  verifyCode,
  generateBackupCodes,
  verifyBackupCode,
  encryptSecret,
  decryptSecret,
  generateCurrentCode, // For testing
  APP_NAME
};
