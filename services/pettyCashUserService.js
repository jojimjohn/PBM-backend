/**
 * Petty Cash User Service
 *
 * Handles automatic creation and management of petty cash user accounts.
 * Supports the "user-first" workflow where PC accounts are created during
 * system user registration and activated when a card is assigned.
 *
 * Key Features:
 * - Auto-create PC user when system user is registered
 * - Deferred PIN generation (PIN created only when card is assigned)
 * - Link existing PC users to cards
 * - Deactivate PC user when system user is deactivated
 *
 * Requirements: 4B.1, 4B.3, 4B.7, 4B.8
 */

const bcrypt = require('bcrypt');
const { getDbConnection } = require('../config/database');
const { generateQrToken } = require('../utils/pettyCashQr');
const { generateSecurePin, generatePinPair } = require('../utils/pinGenerator');
const { logger, auditLog } = require('../utils/logger');

const BCRYPT_ROUNDS = 12;

/**
 * Create a petty cash user from a system user
 *
 * Creates an inactive PC user record when a new system user is registered.
 * The PC user will be activated and assigned a PIN when a card is assigned.
 *
 * @param {number} userId - System user ID
 * @param {string} companyId - Company identifier
 * @param {object} options - Additional options
 * @param {string} options.name - User's display name (optional, fetched from user if not provided)
 * @param {string} options.phone - User's phone number (optional)
 * @param {string} options.department - User's department (optional)
 * @param {string} options.employeeId - Employee ID (optional)
 * @param {number} options.createdBy - ID of admin creating the record (optional)
 * @param {object} options.trx - Knex transaction object (optional, for ACID compliance)
 * @returns {Promise<object>} Created petty cash user record
 */
const createFromSystemUser = async (userId, companyId, options = {}) => {
  const db = options.trx || getDbConnection(companyId);

  try {
    // Check if PC user already exists for this system user
    const existing = await db('petty_cash_users')
      .where({ user_id: userId })
      .first();

    if (existing) {
      logger.warn('Petty cash user already exists for system user', {
        userId,
        pettyCashUserId: existing.id,
        companyId,
      });
      return { existing: true, pettyCashUser: existing };
    }

    // Get system user details if name not provided
    let userName = options.name;
    let userPhone = options.phone;
    let userDepartment = options.department;

    if (!userName) {
      const systemUser = await db('users')
        .where({ id: userId })
        .select('firstName', 'lastName', 'phone', 'department')
        .first();

      if (!systemUser) {
        throw new Error(`System user not found: ${userId}`);
      }

      userName = `${systemUser.firstName} ${systemUser.lastName}`.trim();
      userPhone = userPhone || systemUser.phone;
      userDepartment = userDepartment || systemUser.department;
    }

    // Generate QR token (unique identifier for portal access)
    const qrToken = generateQrToken();

    // Create inactive PC user (no PIN yet - will be set when card is assigned)
    const [pettyCashUserId] = await db('petty_cash_users').insert({
      user_id: userId,
      card_id: null, // No card assigned yet
      name: userName,
      phone: userPhone || null,
      department: userDepartment || null,
      employee_id: options.employeeId || null,
      pin_hash: null, // PIN will be set when card is assigned
      qr_token: qrToken,
      is_active: false, // Inactive until card is assigned
      created_from: 'user_registration',
      auto_created: true,
      created_by: options.createdBy || null,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    const pettyCashUser = await db('petty_cash_users')
      .where({ id: pettyCashUserId })
      .first();

    logger.info('Petty cash user created from system user', {
      pettyCashUserId,
      userId,
      companyId,
      createdFrom: 'user_registration',
    });

    auditLog('PETTY_CASH_USER_AUTO_CREATED', options.createdBy || userId, {
      pettyCashUserId,
      userId,
      companyId,
      createdFrom: 'user_registration',
    });

    return {
      existing: false,
      pettyCashUser,
      message: 'Petty cash account created. PIN will be generated when a card is assigned.',
    };
  } catch (error) {
    logger.error('Failed to create petty cash user from system user', {
      userId,
      companyId,
      error: error.message,
    });
    throw error;
  }
};

/**
 * Find petty cash user by system user ID
 *
 * @param {number} userId - System user ID
 * @param {string} companyId - Company identifier
 * @returns {Promise<object|null>} Petty cash user or null
 */
const findByUserId = async (userId, companyId) => {
  const db = getDbConnection(companyId);

  const pettyCashUser = await db('petty_cash_users')
    .where({ user_id: userId })
    .first();

  return pettyCashUser || null;
};

/**
 * Find petty cash user by ID
 *
 * @param {number} pettyCashUserId - Petty cash user ID
 * @param {string} companyId - Company identifier
 * @returns {Promise<object|null>} Petty cash user or null
 */
const findById = async (pettyCashUserId, companyId) => {
  const db = getDbConnection(companyId);

  const pettyCashUser = await db('petty_cash_users')
    .where({ id: pettyCashUserId })
    .first();

  return pettyCashUser || null;
};

/**
 * Activate petty cash user and link to card
 *
 * When a card is assigned to a user who already has a PC account,
 * this activates the account, links the card, and generates a PIN.
 *
 * @param {number} pettyCashUserId - Petty cash user ID
 * @param {number} cardId - Card ID to link
 * @param {string} companyId - Company identifier
 * @param {object} options - Additional options
 * @param {number} options.activatedBy - ID of admin activating the account
 * @param {object} options.trx - Knex transaction object (optional)
 * @returns {Promise<object>} Result with generated PIN (one-time display)
 */
const activateAndLinkCard = async (pettyCashUserId, cardId, companyId, options = {}) => {
  const db = options.trx || getDbConnection(companyId);

  try {
    // Get current PC user
    const pettyCashUser = await db('petty_cash_users')
      .where({ id: pettyCashUserId })
      .first();

    if (!pettyCashUser) {
      throw new Error(`Petty cash user not found: ${pettyCashUserId}`);
    }

    // Verify card exists and is active
    const card = await db('petty_cash_cards')
      .where({ id: cardId })
      .first();

    if (!card) {
      throw new Error(`Petty cash card not found: ${cardId}`);
    }

    if (card.status !== 'active') {
      throw new Error(`Card is not active: ${card.status}`);
    }

    // Check if card is already assigned to another PC user
    const existingAssignment = await db('petty_cash_users')
      .where({ card_id: cardId })
      .whereNot({ id: pettyCashUserId })
      .first();

    if (existingAssignment) {
      throw new Error(`Card is already assigned to another user: ${existingAssignment.name}`);
    }

    // Generate new PIN
    const { plain: generatedPin, hashed: pinHash } = await generatePinPair(4, BCRYPT_ROUNDS);

    // Update PC user: link card, set PIN, activate
    await db('petty_cash_users')
      .where({ id: pettyCashUserId })
      .update({
        card_id: cardId,
        pin_hash: pinHash,
        is_active: true,
        updated_at: db.fn.now(),
      });

    // Update card with assigned user
    await db('petty_cash_cards')
      .where({ id: cardId })
      .update({
        assignedTo: pettyCashUser.user_id,
        staffName: pettyCashUser.name,
        department: pettyCashUser.department,
        updated_at: db.fn.now(),
      });

    logger.info('Petty cash user activated and linked to card', {
      pettyCashUserId,
      cardId,
      companyId,
    });

    auditLog('PETTY_CASH_USER_ACTIVATED', options.activatedBy, {
      pettyCashUserId,
      cardId,
      companyId,
      action: 'card_linked',
    });

    return {
      success: true,
      pettyCashUserId,
      cardId,
      generatedPin, // One-time display - must be shown to user immediately
      message: 'Petty cash account activated. Please provide the PIN to the user securely.',
    };
  } catch (error) {
    logger.error('Failed to activate petty cash user', {
      pettyCashUserId,
      cardId,
      companyId,
      error: error.message,
    });
    throw error;
  }
};

/**
 * Deactivate petty cash user when system user is deactivated
 *
 * @param {number} userId - System user ID
 * @param {string} companyId - Company identifier
 * @param {object} options - Additional options
 * @param {number} options.deactivatedBy - ID of admin deactivating
 * @param {string} options.reason - Deactivation reason
 * @param {object} options.trx - Knex transaction object (optional)
 * @returns {Promise<object>} Result
 */
const deactivateByUserId = async (userId, companyId, options = {}) => {
  const db = options.trx || getDbConnection(companyId);

  try {
    // Find PC user linked to this system user
    const pettyCashUser = await db('petty_cash_users')
      .where({ user_id: userId })
      .first();

    if (!pettyCashUser) {
      logger.debug('No petty cash user found for system user', { userId, companyId });
      return { found: false, message: 'No petty cash account to deactivate' };
    }

    if (!pettyCashUser.is_active) {
      logger.debug('Petty cash user already inactive', {
        pettyCashUserId: pettyCashUser.id,
        userId,
      });
      return { found: true, alreadyInactive: true };
    }

    // Deactivate PC user
    await db('petty_cash_users')
      .where({ id: pettyCashUser.id })
      .update({
        is_active: false,
        deactivation_reason: options.reason || 'System user deactivated',
        deactivated_at: db.fn.now(),
        deactivated_by: options.deactivatedBy || null,
        updated_at: db.fn.now(),
      });

    logger.info('Petty cash user deactivated with system user', {
      pettyCashUserId: pettyCashUser.id,
      userId,
      companyId,
    });

    auditLog('PETTY_CASH_USER_DEACTIVATED', options.deactivatedBy || userId, {
      pettyCashUserId: pettyCashUser.id,
      userId,
      companyId,
      reason: options.reason || 'System user deactivated',
    });

    return {
      found: true,
      deactivated: true,
      pettyCashUserId: pettyCashUser.id,
    };
  } catch (error) {
    logger.error('Failed to deactivate petty cash user', {
      userId,
      companyId,
      error: error.message,
    });
    throw error;
  }
};

/**
 * Reactivate petty cash user when system user is reactivated
 *
 * @param {number} userId - System user ID
 * @param {string} companyId - Company identifier
 * @param {object} options - Additional options
 * @param {number} options.reactivatedBy - ID of admin reactivating
 * @param {object} options.trx - Knex transaction object (optional)
 * @returns {Promise<object>} Result
 */
const reactivateByUserId = async (userId, companyId, options = {}) => {
  const db = options.trx || getDbConnection(companyId);

  try {
    const pettyCashUser = await db('petty_cash_users')
      .where({ user_id: userId })
      .first();

    if (!pettyCashUser) {
      return { found: false };
    }

    if (pettyCashUser.is_active) {
      return { found: true, alreadyActive: true };
    }

    // Only reactivate if they have a card assigned
    if (!pettyCashUser.card_id) {
      logger.debug('Cannot reactivate PC user without card', {
        pettyCashUserId: pettyCashUser.id,
        userId,
      });
      return {
        found: true,
        reactivated: false,
        reason: 'No card assigned - assign a card to activate',
      };
    }

    await db('petty_cash_users')
      .where({ id: pettyCashUser.id })
      .update({
        is_active: true,
        deactivation_reason: null,
        deactivated_at: null,
        deactivated_by: null,
        updated_at: db.fn.now(),
      });

    logger.info('Petty cash user reactivated with system user', {
      pettyCashUserId: pettyCashUser.id,
      userId,
      companyId,
    });

    return {
      found: true,
      reactivated: true,
      pettyCashUserId: pettyCashUser.id,
    };
  } catch (error) {
    logger.error('Failed to reactivate petty cash user', {
      userId,
      companyId,
      error: error.message,
    });
    throw error;
  }
};

/**
 * Get or create petty cash user for a system user
 *
 * Utility method that either finds existing PC user or creates a new one.
 * Useful for card assignment flow.
 *
 * @param {number} userId - System user ID
 * @param {string} companyId - Company identifier
 * @param {object} options - Additional options
 * @returns {Promise<object>} Petty cash user (existing or new)
 */
const getOrCreate = async (userId, companyId, options = {}) => {
  const existing = await findByUserId(userId, companyId);

  if (existing) {
    return { existing: true, pettyCashUser: existing };
  }

  return createFromSystemUser(userId, companyId, options);
};

module.exports = {
  createFromSystemUser,
  findByUserId,
  findById,
  activateAndLinkCard,
  deactivateByUserId,
  reactivateByUserId,
  getOrCreate,
};
