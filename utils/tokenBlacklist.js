/**
 * Token Blacklist Utility - Production-Grade Implementation
 *
 * Manages token revocation for secure logout and user deactivation.
 * Uses Redis with automatic TTL expiration matching token lifetime.
 *
 * SECURITY FEATURES:
 * - Single token blacklisting (logout)
 * - User-wide token invalidation (force logout, deactivation)
 * - Redis session clearing on force logout
 * - Automatic cleanup via Redis TTL
 * - Hash-based storage for efficiency
 * - Refresh token mutex WITH OWNER VERIFICATION (Lua script)
 */

const crypto = require('crypto');
const { redis, isRedisConnected } = require('../config/redis');
const { logger } = require('./logger');
const {
  isProduction,
  TOKEN_CONFIG,
  REDIS_KEYS,
  REDIS_FAIL_MODE,
  getSessionKey,
  getRefreshLockKey,
} = require('../config/sessionConfig');

// Key prefixes (from centralized config)
const TOKEN_PREFIX = REDIS_KEYS.TOKEN_BLACKLIST;
const USER_LOGOUT_PREFIX = REDIS_KEYS.USER_FORCE_LOGOUT;

// Default TTL matches refresh token lifetime
const DEFAULT_TTL_SECONDS = TOKEN_CONFIG.BLACKLIST_TTL_SECONDS;

// Refresh lock configuration
const REFRESH_LOCK_TTL_SECONDS = 10; // Lock expires after 10 seconds

/**
 * Lua script for atomic compare-and-delete
 * Only deletes the lock if the value matches (owner verification)
 * Returns 1 if deleted, 0 if not (lock was stolen or expired)
 */
const RELEASE_LOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
else
    return 0
end
`;

/**
 * SCAN-based key counting (production-safe alternative to KEYS)
 * Uses cursor-based iteration to avoid blocking Redis
 *
 * @param {string} pattern - Key pattern to match
 * @param {boolean} deleteKeys - If true, delete keys as we find them
 * @returns {Promise<number>} - Count of keys found/deleted
 */
const scanKeys = async (pattern, deleteKeys = false) => {
  let cursor = '0';
  let count = 0;

  do {
    // SCAN returns [newCursor, [keys...]]
    const [newCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    cursor = newCursor;

    if (keys.length > 0) {
      count += keys.length;
      if (deleteKeys) {
        // FIXED: Use array form instead of spread to avoid stack overflow
        // with large key sets (SCAN COUNT is a hint, not a guarantee)
        // ioredis supports: redis.del(keys) where keys is an array
        await redis.del(keys);
      }
    }
  } while (cursor !== '0');

  return count;
};

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
 * Generate a unique lock owner ID
 * Combines process ID, random string, and timestamp for uniqueness
 * @returns {string} - Unique owner ID
 */
const generateLockOwnerId = () => {
  return `${process.pid}-${crypto.randomBytes(8).toString('hex')}-${Date.now()}`;
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

    if (!isRedisConnected()) {
      logger.warn('Redis not connected - cannot blacklist token');
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

    if (!isRedisConnected()) {
      // Configurable fail mode
      if (REDIS_FAIL_MODE.MODE === 'closed' && isProduction) {
        logger.error('Redis not connected in production - rejecting request');
        return true; // Fail closed = treat as blacklisted
      }
      logger.warn('Redis not connected - cannot check blacklist, allowing through');
      return false;
    }

    try {
      const tokenHash = hashToken(token);
      const key = `${TOKEN_PREFIX}${tokenHash}`;

      const result = await redis.exists(key);
      return result === 1;
    } catch (error) {
      logger.error('Failed to check token blacklist', { error: error.message });

      // Configurable fail mode
      if (REDIS_FAIL_MODE.MODE === 'closed' && isProduction) {
        logger.error('Redis failure in production - rejecting request (fail-closed)');
        return true;
      }

      logger.warn('Redis failure - allowing request through (fail-open)');
      return false;
    }
  },

  /**
   * Blacklist all tokens for a user (force logout)
   * Stores a timestamp - any token issued before this time is invalid
   * Also clears the user's Redis session to ensure complete logout
   *
   * @param {number} userId - User ID to force logout
   * @returns {Promise<boolean>} - Success status
   */
  async blacklistAllUserTokens(userId) {
    if (!userId) {
      logger.warn('Attempted to blacklist tokens for empty userId');
      return false;
    }

    // Always clear dev session store (works even without Redis)
    try {
      const { forceLogoutSession } = require('../middleware/sessionTimeout');
      await forceLogoutSession(userId);
    } catch (e) {
      logger.warn('Could not clear dev session store', { userId, error: e.message });
    }

    if (!isRedisConnected()) {
      logger.warn('Redis not connected - force logout only cleared dev session');
      return true; // Partial success
    }

    try {
      const timestamp = Date.now();

      // Use Redis transaction for atomicity
      const multi = redis.multi();

      // 1. Store the logout timestamp - tokens issued before this are invalid
      const logoutKey = `${USER_LOGOUT_PREFIX}${userId}`;
      multi.setex(logoutKey, DEFAULT_TTL_SECONDS, timestamp.toString());

      // 2. Clear the user's Redis session
      const sessionKey = getSessionKey(userId);
      multi.del(sessionKey);

      // 3. Clear any refresh locks for this user
      const lockKey = getRefreshLockKey(userId);
      multi.del(lockKey);

      await multi.exec();

      logger.info('All tokens blacklisted and session cleared for user', {
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

    if (!isRedisConnected()) {
      if (REDIS_FAIL_MODE.MODE === 'closed' && isProduction) {
        logger.error('Redis not connected in production - rejecting request');
        return true;
      }
      return false;
    }

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

      if (REDIS_FAIL_MODE.MODE === 'closed' && isProduction) {
        return true; // Fail closed
      }
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

    if (!isRedisConnected()) {
      logger.warn('Redis not connected - cannot clear force logout');
      return false;
    }

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
   * Acquire a mutex lock for token refresh WITH OWNER VERIFICATION
   * Prevents race conditions when multiple requests try to refresh simultaneously
   *
   * @param {number} userId - User ID
   * @returns {Promise<{acquired: boolean, ownerId?: string}>}
   */
  async acquireRefreshLock(userId) {
    if (!userId) return { acquired: false };

    if (!isRedisConnected()) {
      // In development without Redis, we can't do distributed locking
      // Return a fake owner ID for consistency
      logger.debug('Redis not connected - skipping refresh lock (dev mode)');
      return { acquired: true, ownerId: 'dev-mode-no-lock' };
    }

    try {
      const lockKey = getRefreshLockKey(userId);
      const ownerId = generateLockOwnerId();

      // SET NX (only set if not exists) with expiration
      // This is atomic and prevents race conditions
      const result = await redis.set(lockKey, ownerId, 'EX', REFRESH_LOCK_TTL_SECONDS, 'NX');

      if (result === 'OK') {
        logger.debug('Refresh lock acquired', { userId, ownerId: ownerId.substring(0, 16) });
        return { acquired: true, ownerId };
      } else {
        logger.debug('Refresh lock already held', { userId });
        return { acquired: false };
      }
    } catch (error) {
      logger.error('Failed to acquire refresh lock', { userId, error: error.message });
      // On error, allow through to avoid blocking all refreshes
      return { acquired: true, ownerId: 'error-fallback' };
    }
  },

  /**
   * Release the refresh lock WITH OWNER VERIFICATION
   * Only releases if we still own the lock (prevents stealing)
   *
   * @param {number} userId - User ID
   * @param {string} ownerId - Owner ID from acquireRefreshLock
   * @returns {Promise<{released: boolean, reason?: string}>} - Result with reason for failure
   */
  async releaseRefreshLock(userId, ownerId) {
    if (!userId || !ownerId) return { released: false, reason: 'INVALID_PARAMS' };

    // Skip for dev mode or error fallback
    if (ownerId === 'dev-mode-no-lock' || ownerId === 'error-fallback') {
      return { released: true, reason: 'DEV_MODE' };
    }

    if (!isRedisConnected()) {
      return { released: true, reason: 'REDIS_DISCONNECTED' };
    }

    try {
      const lockKey = getRefreshLockKey(userId);

      // Use Lua script for atomic compare-and-delete
      const result = await redis.eval(RELEASE_LOCK_SCRIPT, 1, lockKey, ownerId);

      if (result === 1) {
        logger.debug('Refresh lock released', { userId });
        return { released: true };
      } else {
        // Lock was stolen or expired - this is important to know!
        logger.warn('Refresh lock was not ours to release (expired or stolen)', {
          userId,
          ownerId: ownerId.substring(0, 16)
        });
        return { released: false, reason: 'LOCK_STOLEN_OR_EXPIRED' };
      }
    } catch (error) {
      // IMPORTANT: Distinguish Redis error from lock theft
      logger.error('Redis error while releasing refresh lock', { userId, error: error.message });
      return { released: false, reason: 'REDIS_ERROR' };
    }
  },

  /**
   * Execute a function with refresh lock (with owner verification)
   * Ensures only one refresh operation runs at a time per user
   *
   * IMPORTANT: This function does NOT use try/finally with return inside try block
   * because JavaScript captures return values BEFORE finally runs, which would
   * cause lockStolen to always be false.
   *
   * @param {number} userId - User ID
   * @param {Function} fn - Async function to execute
   * @returns {Promise<{success: boolean, result?: any, reason?: string, lockStolen?: boolean}>}
   */
  async withRefreshLock(userId, fn) {
    const lockResult = await this.acquireRefreshLock(userId);

    if (!lockResult.acquired) {
      return {
        success: false,
        reason: 'REFRESH_IN_PROGRESS',
        lockStolen: false
      };
    }

    const ownerId = lockResult.ownerId;
    let lockStolen = false;
    let fnResult;
    let fnError = null;

    // Execute the function and capture result/error
    try {
      fnResult = await fn();
    } catch (error) {
      fnError = error;
    }

    // ALWAYS release lock after function completes (success or failure)
    // This runs BEFORE we return, so lockStolen can be correctly set
    const releaseResult = await this.releaseRefreshLock(userId, ownerId);

    if (!releaseResult.released) {
      if (releaseResult.reason === 'LOCK_STOLEN_OR_EXPIRED') {
        lockStolen = true;
        logger.warn('Lock was stolen during refresh operation - result may be stale', { userId });
      } else if (releaseResult.reason === 'REDIS_ERROR') {
        // Don't set lockStolen for Redis errors - it's a different issue
        logger.error('Redis error during lock release - lock may persist until TTL', { userId });
      }
    }

    // Now return or throw AFTER cleanup is complete
    if (fnError) {
      // Attach lockStolen to the error for caller awareness
      // DEFENSIVE: Only attach if fnError is an object (handles throw "string" edge case)
      if (fnError !== null && typeof fnError === 'object') {
        fnError.lockStolen = lockStolen;
      }
      throw fnError;
    }

    return {
      success: true,
      result: fnResult,
      lockStolen
    };
  },

  /**
   * Get blacklist statistics (for monitoring)
   * FIXED: Uses SCAN instead of KEYS for production safety
   *
   * @returns {Promise<object>} - Stats object
   */
  async getStats() {
    if (!isRedisConnected()) {
      return {
        blacklistedTokens: -1,
        forceLogoutUsers: -1,
        activeLocks: -1,
        redisConnected: false,
        error: 'Redis not connected'
      };
    }

    try {
      // Use SCAN-based counting (non-blocking, production-safe)
      const [blacklistedTokens, forceLogoutUsers, activeLocks] = await Promise.all([
        scanKeys(`${TOKEN_PREFIX}*`),
        scanKeys(`${USER_LOGOUT_PREFIX}*`),
        scanKeys(`${REDIS_KEYS.REFRESH_LOCK}*`)
      ]);

      return {
        blacklistedTokens,
        forceLogoutUsers,
        activeLocks,
        redisConnected: true
      };
    } catch (error) {
      logger.error('Failed to get blacklist stats', { error: error.message });
      return {
        blacklistedTokens: -1,
        forceLogoutUsers: -1,
        activeLocks: -1,
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
  },

  /**
   * Cleanup all locks (for graceful shutdown)
   * FIXED: Uses SCAN instead of KEYS for production safety
   * NOTE: Lock TTL is only 10 seconds, so this is optional - locks auto-expire
   *
   * @returns {Promise<number>} - Number of locks cleared
   */
  async clearAllLocks() {
    if (!isRedisConnected()) {
      return 0;
    }

    try {
      // Use SCAN with delete (non-blocking, production-safe)
      const count = await scanKeys(`${REDIS_KEYS.REFRESH_LOCK}*`, true);
      if (count > 0) {
        logger.info('Cleared refresh locks on shutdown', { count });
      }
      return count;
    } catch (error) {
      // Not critical - locks have 10s TTL and will auto-expire
      logger.warn('Failed to clear locks on shutdown (will auto-expire)', { error: error.message });
      return 0;
    }
  }
};

module.exports = tokenBlacklist;
