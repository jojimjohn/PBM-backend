/**
 * Token Blacklist Utility
 *
 * Manages token revocation for secure logout and user deactivation.
 * Uses Redis with automatic TTL expiration matching token lifetime.
 *
 * Features:
 * - Single token blacklisting (logout)
 * - User-wide token invalidation (force logout, deactivation)
 * - Automatic cleanup via Redis TTL
 * - Hash-based storage for efficiency
 */

const crypto = require('crypto');
const { redis, isRedisConnected } = require('../config/redis');
const { logger } = require('./logger');

/**
 * SECURITY CONFIGURATION
 *
 * REDIS_FAIL_MODE controls behavior when Redis is unavailable:
 * - 'open': Allow requests through (availability > security) - DEFAULT for dev
 * - 'closed': Reject all requests (security > availability) - RECOMMENDED for production
 *
 * Set via environment variable: REDIS_FAIL_MODE=closed
 */
const REDIS_FAIL_MODE = process.env.REDIS_FAIL_MODE ||
  (process.env.NODE_ENV === 'production' ? 'closed' : 'open');

// Key prefixes for Redis
const TOKEN_PREFIX = 'blacklist:token:';
const USER_LOGOUT_PREFIX = 'blacklist:user:';

// Default TTL matches refresh token lifetime (7 days)
const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

/**
 * Hash a token for storage
 * We don't store raw tokens - hash them for security
 * @param {string} token - JWT token
 * @returns {string} - SHA256 hash
 */
const hashToken = (token) => {
  return crypto.createHash('sha256').update(token).digest('hex');
};

/**
 * Token Blacklist API
 */
const tokenBlacklist = {
  /**
   * Add a single token to the blacklist
   * Called on logout to invalidate the current token
   *
   * @param {string} token - JWT token to blacklist
   * @param {number} expiresInSeconds - TTL (should match token's remaining lifetime)
   * @returns {Promise<boolean>} - Success status
   */
  async blacklistToken(token, expiresInSeconds = DEFAULT_TTL_SECONDS) {
    if (!token) {
      logger.warn('Attempted to blacklist empty token');
      return false;
    }

    try {
      const tokenHash = hashToken(token);
      const key = `${TOKEN_PREFIX}${tokenHash}`;

      await redis.setex(key, expiresInSeconds, 'revoked');

      logger.info('Token blacklisted', {
        tokenHash: tokenHash.substring(0, 8) + '...',
        ttl: expiresInSeconds
      });

      return true;
    } catch (error) {
      logger.error('Failed to blacklist token', { error: error.message });
      return false;
    }
  },

  /**
   * Check if a token is blacklisted
   * Called on every authenticated request
   *
   * @param {string} token - JWT token to check
   * @returns {Promise<boolean>} - True if blacklisted
   */
  async isBlacklisted(token) {
    if (!token) return false;

    try {
      const tokenHash = hashToken(token);
      const key = `${TOKEN_PREFIX}${tokenHash}`;

      const result = await redis.exists(key);
      return result === 1;
    } catch (error) {
      logger.error('Failed to check token blacklist', { error: error.message });

      // SECURITY: Configurable fail mode
      if (REDIS_FAIL_MODE === 'closed') {
        logger.error('REDIS_FAIL_MODE=closed: Rejecting request due to Redis failure');
        // Return true = "token is blacklisted" = request rejected
        return true;
      }

      // Fail open: allow request through (but this is logged)
      logger.warn('REDIS_FAIL_MODE=open: Allowing request despite Redis failure');
      return false;
    }
  },

  /**
   * Blacklist all tokens for a user (force logout)
   * Stores a timestamp - any token issued before this time is invalid
   *
   * @param {number} userId - User ID to force logout
   * @returns {Promise<boolean>} - Success status
   */
  async blacklistAllUserTokens(userId) {
    if (!userId) {
      logger.warn('Attempted to blacklist tokens for empty userId');
      return false;
    }

    try {
      const key = `${USER_LOGOUT_PREFIX}${userId}`;
      const timestamp = Date.now();

      // Store the logout timestamp - tokens issued before this are invalid
      await redis.setex(key, DEFAULT_TTL_SECONDS, timestamp.toString());

      logger.info('All tokens blacklisted for user', {
        userId,
        logoutTimestamp: new Date(timestamp).toISOString()
      });

      return true;
    } catch (error) {
      logger.error('Failed to blacklist user tokens', {
        userId,
        error: error.message
      });
      return false;
    }
  },

  /**
   * Check if a user was force logged out after a token was issued
   * Called on every authenticated request (after individual token check)
   *
   * @param {number} userId - User ID
   * @param {number} tokenIssuedAt - Token's iat claim (Unix timestamp in seconds)
   * @returns {Promise<boolean>} - True if force logout occurred after token issuance
   */
  async wasForceLoggedOut(userId, tokenIssuedAt) {
    if (!userId || !tokenIssuedAt) return false;

    try {
      const key = `${USER_LOGOUT_PREFIX}${userId}`;
      const logoutTimestamp = await redis.get(key);

      if (!logoutTimestamp) {
        return false; // No force logout recorded
      }

      // Convert token iat (seconds) to milliseconds for comparison
      const tokenIssuedAtMs = tokenIssuedAt * 1000;
      const logoutMs = parseInt(logoutTimestamp, 10);

      // Token is invalid if it was issued before the force logout
      const isInvalid = tokenIssuedAtMs < logoutMs;

      if (isInvalid) {
        logger.debug('Token rejected - issued before force logout', {
          userId,
          tokenIssued: new Date(tokenIssuedAtMs).toISOString(),
          forceLogout: new Date(logoutMs).toISOString()
        });
      }

      return isInvalid;
    } catch (error) {
      logger.error('Failed to check force logout status', {
        userId,
        error: error.message
      });

      // SECURITY: Configurable fail mode
      if (REDIS_FAIL_MODE === 'closed') {
        logger.error('REDIS_FAIL_MODE=closed: Rejecting request due to Redis failure');
        return true; // Assume force logged out = reject request
      }

      logger.warn('REDIS_FAIL_MODE=open: Allowing request despite Redis failure');
      return false;
    }
  },

  /**
   * Clear force logout status for a user
   * Called when admin wants to allow user to login again
   *
   * @param {number} userId - User ID
   * @returns {Promise<boolean>} - Success status
   */
  async clearForceLogout(userId) {
    if (!userId) return false;

    try {
      const key = `${USER_LOGOUT_PREFIX}${userId}`;
      await redis.del(key);

      logger.info('Force logout cleared for user', { userId });
      return true;
    } catch (error) {
      logger.error('Failed to clear force logout', {
        userId,
        error: error.message
      });
      return false;
    }
  },

  /**
   * Get blacklist statistics (for monitoring)
   *
   * @returns {Promise<object>} - Stats object
   */
  async getStats() {
    try {
      const tokenKeys = await redis.keys(`${TOKEN_PREFIX}*`);
      const userKeys = await redis.keys(`${USER_LOGOUT_PREFIX}*`);

      return {
        blacklistedTokens: tokenKeys.length,
        forceLogoutUsers: userKeys.length,
        redisConnected: isRedisConnected()
      };
    } catch (error) {
      logger.error('Failed to get blacklist stats', { error: error.message });
      return {
        blacklistedTokens: -1,
        forceLogoutUsers: -1,
        redisConnected: false,
        error: error.message
      };
    }
  },

  /**
   * Check if a token is valid (not blacklisted and user not force logged out)
   * Convenience method combining both checks
   *
   * @param {string} token - JWT token
   * @param {number} userId - User ID from token
   * @param {number} tokenIssuedAt - Token's iat claim
   * @returns {Promise<{valid: boolean, reason?: string}>}
   */
  async isTokenValid(token, userId, tokenIssuedAt) {
    // Check individual token blacklist
    const isBlacklisted = await this.isBlacklisted(token);
    if (isBlacklisted) {
      return { valid: false, reason: 'TOKEN_REVOKED' };
    }

    // Check user-wide force logout
    const wasForceLoggedOut = await this.wasForceLoggedOut(userId, tokenIssuedAt);
    if (wasForceLoggedOut) {
      return { valid: false, reason: 'FORCE_LOGOUT' };
    }

    return { valid: true };
  }
};

module.exports = tokenBlacklist;
