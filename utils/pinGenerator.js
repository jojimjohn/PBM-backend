/**
 * PIN Generator Utility
 *
 * Generates cryptographically secure PINs for petty cash users.
 * Uses crypto.randomInt() for secure random number generation.
 *
 * Security Features:
 * - Uses Node.js crypto module for secure randomness
 * - Preserves leading zeros (returns string)
 * - Configurable length (4-6 digits)
 */

const crypto = require('crypto');

/**
 * Generate a cryptographically secure PIN
 *
 * @param {number} length - PIN length (default: 4, range: 4-6)
 * @returns {string} PIN with leading zeros preserved
 *
 * @example
 * generateSecurePin()     // "0472"
 * generateSecurePin(6)    // "038291"
 */
const generateSecurePin = (length = 4) => {
  // Validate length
  if (length < 4 || length > 6) {
    throw new Error('PIN length must be between 4 and 6 digits');
  }

  // Calculate range: 10^length (e.g., 10000 for 4 digits)
  const max = Math.pow(10, length);

  // Generate secure random integer in range [0, max)
  const randomNumber = crypto.randomInt(0, max);

  // Convert to string and pad with leading zeros
  return randomNumber.toString().padStart(length, '0');
};

/**
 * Validate PIN format
 *
 * @param {string} pin - PIN to validate
 * @param {number} length - Expected length (default: 4)
 * @returns {boolean} True if valid format
 */
const isValidPinFormat = (pin, length = 4) => {
  if (!pin || typeof pin !== 'string') {
    return false;
  }

  // Must be exactly `length` digits
  const pattern = new RegExp(`^\\d{${length}}$`);
  return pattern.test(pin);
};

/**
 * Generate a temporary PIN for display (one-time view)
 * Returns both the plain PIN (for display) and hashed version (for storage)
 *
 * @param {number} length - PIN length (default: 4)
 * @param {number} rounds - bcrypt rounds for hashing (default: 12)
 * @returns {Promise<{plain: string, hashed: string}>} PIN pair
 */
const generatePinPair = async (length = 4, rounds = 12) => {
  const bcrypt = require('bcrypt');

  const plain = generateSecurePin(length);
  const hashed = await bcrypt.hash(plain, rounds);

  return { plain, hashed };
};

module.exports = {
  generateSecurePin,
  isValidPinFormat,
  generatePinPair,
};
