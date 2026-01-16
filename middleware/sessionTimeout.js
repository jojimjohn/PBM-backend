/**
 * Session Timeout Middleware - Production-Grade Implementation
 *
 * ARCHITECTURE:
 * - Development mode: In-memory session tracking (JWT timestamps) - Redis not required
 * - Production mode: Redis-based session tracking with atomic operations
 *
 * SECURITY PRINCIPLES:
 * - No session resurrection - expired sessions STAY expired
 * - Atomic Redis operations prevent TOCTOU vulnerabilities
 * - Proper timestamp validation prevents overflow attacks
 * - Centralized configuration eliminates magic numbers
 *
 * Timeout is configurable per-company via system_settings table.
 */

const { redis, isRedisConnected } = require('../config/redis');
const { logger, auditLog } = require('../utils/logger');
const { getDbConnection } = require('../config/database');
const {
  isProduction,
  isDevelopment,
  SESSION_CONFIG,
  SESSION_ERROR_CODES,
  REDIS_FAIL_MODE,
  getSessionKey,
  getTimeoutCacheKey,
  validateTimestamp,
  isPassiveEndpoint,
  isSessionExtensionEndpoint,
} = require('../config/sessionConfig');

// ============================================================================
// DEVELOPMENT MODE SESSION STORE
// ============================================================================

// Maximum sessions to store (prevents unbounded memory growth)
const MAX_DEV_SESSIONS = 10000;

/**
 * In-memory session store for development mode
 * Structure: Map<userId, { startTime: number, companyId: string }>
 * FIXED: Added size limit and async overlap prevention
 */
class DevSessionStore {
  constructor() {
    this.sessions = new Map();
    this.cleanupInterval = null;
    this.isCleanupRunning = false; // Prevents async overlap
    // Don't auto-start cleanup - let it be conditionally started
    // This prevents running cleanup in production where DevSessionStore isn't used
  }

  /**
   * Start periodic cleanup of expired sessions
   * Call this only in development mode
   * Prevents memory leak from abandoned sessions
   */
  startCleanup() {
    if (this.cleanupInterval) return;

    // NOTE: Removed redundant isProduction check - already checked at module level

    this.cleanupInterval = setInterval(async () => {
      // Prevent overlapping async cleanups
      if (this.isCleanupRunning) {
        logger.debug('Skipping cleanup - previous run still in progress');
        return;
      }
      this.isCleanupRunning = true;
      try {
        await this.cleanupExpiredSessions();
      } finally {
        this.isCleanupRunning = false;
      }
    }, SESSION_CONFIG.DEV_CLEANUP_INTERVAL_MS);

    // Don't prevent process exit
    this.cleanupInterval.unref();

    logger.debug('Dev session cleanup started', {
      intervalMs: SESSION_CONFIG.DEV_CLEANUP_INTERVAL_MS
    });
  }

  /**
   * Clean up all expired sessions
   * OPTIMIZED: Batches sessions by companyId to avoid N+1 database queries
   */
  async cleanupExpiredSessions() {
    const now = Date.now();
    let cleanedCount = 0;

    // OPTIMIZATION: Group sessions by companyId to batch database lookups
    const sessionsByCompany = new Map();
    for (const [userId, session] of this.sessions.entries()) {
      const companyId = session.companyId || 'al-ramrami';
      if (!sessionsByCompany.has(companyId)) {
        sessionsByCompany.set(companyId, []);
      }
      sessionsByCompany.get(companyId).push({ userId, session });
    }

    // Process each company batch with ONE database lookup per company
    for (const [companyId, sessions] of sessionsByCompany.entries()) {
      let timeoutMinutes;
      try {
        // ONE database call per company instead of per session
        timeoutMinutes = await getSessionTimeoutForCompanyInternal(companyId);
      } catch (error) {
        // On error, use default timeout
        logger.warn('Failed to get timeout for company during cleanup', {
          companyId,
          error: error.message
        });
        timeoutMinutes = SESSION_CONFIG.DEFAULT_TIMEOUT_MINUTES;
      }

      const timeoutMs = timeoutMinutes * 60 * 1000;

      // Check each session in this company batch
      for (const { userId, session } of sessions) {
        const elapsed = now - session.startTime;
        if (elapsed > timeoutMs) {
          this.sessions.delete(userId);
          cleanedCount++;
        }
      }
    }

    if (cleanedCount > 0) {
      logger.debug('Dev session cleanup completed', {
        cleaned: cleanedCount,
        remaining: this.sessions.size,
        companiesProcessed: sessionsByCompany.size
      });
    }
  }

  /**
   * Get session for a user
   * @param {number} userId
   * @returns {{ startTime: number, companyId: string } | undefined}
   */
  get(userId) {
    return this.sessions.get(userId);
  }

  /**
   * Set/update session for a user
   * FIXED: Enforces size limit to prevent unbounded memory growth
   * @param {number} userId
   * @param {number} startTime
   * @param {string} companyId
   */
  set(userId, startTime, companyId) {
    // If at max capacity and this is a new user, evict oldest session
    if (this.sessions.size >= MAX_DEV_SESSIONS && !this.sessions.has(userId)) {
      // Find and delete the oldest session (LRU-style)
      let oldestUserId = null;
      let oldestTime = Infinity;
      for (const [uid, session] of this.sessions.entries()) {
        if (session.startTime < oldestTime) {
          oldestTime = session.startTime;
          oldestUserId = uid;
        }
      }
      if (oldestUserId !== null) {
        this.sessions.delete(oldestUserId);
        logger.debug('Evicted oldest session due to size limit', {
          evictedUserId: oldestUserId,
          currentSize: this.sessions.size
        });
      }
    }
    this.sessions.set(userId, { startTime, companyId });
  }

  /**
   * Delete session for a user
   * @param {number} userId
   */
  delete(userId) {
    this.sessions.delete(userId);
  }

  /**
   * Check if session exists
   * @param {number} userId
   * @returns {boolean}
   */
  has(userId) {
    return this.sessions.has(userId);
  }

  /**
   * Get session count (for monitoring)
   * @returns {number}
   */
  get size() {
    return this.sessions.size;
  }

  /**
   * Stop cleanup (for graceful shutdown)
   */
  stopCleanup() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

const devSessionStore = new DevSessionStore();

// Only start cleanup in development mode - production uses Redis
if (isDevelopment) {
  devSessionStore.startCleanup();
}

// ============================================================================
// SESSION TIMEOUT CACHE
// ============================================================================

/**
 * In-memory cache for session timeout settings
 * Used in development or when Redis is unavailable
 */
const timeoutSettingsCache = new Map();
const IN_MEMORY_CACHE_TTL = SESSION_CONFIG.TIMEOUT_CACHE_TTL_SECONDS * 1000;

/**
 * Get session timeout for a company (with caching)
 * Reads from database, caches result for performance
 * @param {string} companyId - Company ID
 * @returns {Promise<number>} Timeout in minutes
 */
const getSessionTimeoutForCompanyInternal = async (companyId) => {
  try {
    // Check cache first
    if (isProduction && isRedisConnected()) {
      // Production: Use Redis cache
      const cacheKey = getTimeoutCacheKey(companyId);
      const cachedTimeout = await redis.get(cacheKey);

      if (cachedTimeout) {
        return parseInt(cachedTimeout, 10);
      }
    } else {
      // Development/fallback: Use in-memory cache
      const cached = timeoutSettingsCache.get(companyId);
      if (cached && (Date.now() - cached.cachedAt) < IN_MEMORY_CACHE_TTL) {
        return cached.timeout;
      }
    }

    // Fetch from database
    const db = getDbConnection(companyId);
    const setting = await db('system_settings')
      .where({ company_id: companyId, setting_key: 'session_timeout_minutes' })
      .first();

    // FIXED: Validate parsed value is a positive number (handles NaN, negative, null)
    let timeoutMinutes = SESSION_CONFIG.DEFAULT_TIMEOUT_MINUTES;
    if (setting && setting.setting_value) {
      const parsed = parseInt(setting.setting_value, 10);
      if (!isNaN(parsed) && parsed > 0) {
        timeoutMinutes = parsed;
      } else {
        logger.warn('Invalid session timeout value in database, using default', {
          companyId,
          rawValue: setting.setting_value,
          usingDefault: SESSION_CONFIG.DEFAULT_TIMEOUT_MINUTES
        });
      }
    }

    // Cache the value
    if (isProduction && isRedisConnected()) {
      const cacheKey = getTimeoutCacheKey(companyId);
      await redis.setex(cacheKey, SESSION_CONFIG.TIMEOUT_CACHE_TTL_SECONDS, timeoutMinutes.toString());
    } else {
      timeoutSettingsCache.set(companyId, {
        timeout: timeoutMinutes,
        cachedAt: Date.now()
      });
    }

    logger.debug('Session timeout loaded from database', { companyId, timeoutMinutes });
    return timeoutMinutes;
  } catch (error) {
    logger.warn('Failed to get session timeout from database, using default', {
      companyId,
      error: error.message
    });
    return SESSION_CONFIG.DEFAULT_TIMEOUT_MINUTES;
  }
};

// Export wrapper for external use
const getSessionTimeoutForCompany = getSessionTimeoutForCompanyInternal;

/**
 * Clear session timeout cache for a company
 * Called when admin updates the timeout setting
 * @param {string} companyId - Company ID
 */
const clearSessionTimeoutCache = async (companyId) => {
  // Always clear in-memory cache
  timeoutSettingsCache.delete(companyId);

  // Also clear Redis cache if connected
  if (isRedisConnected()) {
    try {
      const cacheKey = getTimeoutCacheKey(companyId);
      await redis.del(cacheKey);
    } catch (error) {
      logger.warn('Failed to clear Redis session timeout cache', {
        companyId,
        error: error.message
      });
    }
  }

  logger.debug('Session timeout cache cleared', { companyId });
};

// ============================================================================
// SESSION ERROR HELPER
// ============================================================================

/**
 * Create a standardized session error response
 * @param {Response} res - Express response
 * @param {string} code - Error code from SESSION_ERROR_CODES
 * @param {string} message - Human-readable message
 * @param {number} timeoutMinutes - Configured timeout
 * @returns {Response}
 */
const sendSessionError = (res, code, message, timeoutMinutes = null) => {
  // Clear authentication cookies
  res.clearCookie('accessToken', { path: '/' });
  res.clearCookie('refreshToken', { path: '/api/auth/refresh' });
  res.clearCookie('csrf-token', { path: '/' });

  return res.status(401).json({
    success: false,
    error: message,
    code: code,
    ...(timeoutMinutes && { timeoutMinutes })
  });
};

// ============================================================================
// DEVELOPMENT MODE SESSION HANDLING
// ============================================================================

/**
 * Handle session timeout check in development mode
 * Uses in-memory storage since Redis is not available locally
 * @param {Request} req - Express request
 * @param {Response} res - Express response
 * @param {Function} next - Next middleware
 */
const handleDevModeSession = async (req, res, next) => {
  const userId = req.user.userId;
  const companyId = req.user.companyId || 'al-ramrami';

  const timeoutMinutes = await getSessionTimeoutForCompanyInternal(companyId);
  const timeoutMs = timeoutMinutes * 60 * 1000;
  const now = Date.now();

  // Get existing session
  let session = devSessionStore.get(userId);

  // If no session exists, this is a problem - session should be initialized on login
  if (!session) {
    // For passive/extension endpoints, allow through but report no session
    if (isPassiveEndpoint(req.originalUrl) || isSessionExtensionEndpoint(req.originalUrl)) {
      req.sessionInfo = {
        active: false,
        reason: SESSION_ERROR_CODES.NO_SESSION,
        timeoutMinutes: timeoutMinutes,
        mode: 'development'
      };
      return next();
    }

    // STRICT: No session resurrection in development either
    // If we reach here, it means login didn't initialize session properly
    logger.warn('No dev session found - possible bug in login flow', {
      userId,
      companyId,
      endpoint: req.originalUrl
    });

    return sendSessionError(
      res,
      SESSION_ERROR_CODES.NO_SESSION,
      'Session not found. Please log in again.',
      timeoutMinutes
    );
  }

  // Validate timestamp to prevent attacks
  const timestampValidation = validateTimestamp(session.startTime);
  if (!timestampValidation.valid) {
    logger.warn('Invalid session timestamp in dev mode', {
      userId,
      reason: timestampValidation.reason,
      startTime: session.startTime
    });
    devSessionStore.delete(userId);
    return sendSessionError(
      res,
      SESSION_ERROR_CODES.INVALID_TIMESTAMP,
      'Session corrupted. Please log in again.',
      timeoutMinutes
    );
  }

  // Calculate remaining time
  const elapsed = now - session.startTime;
  const remainingMs = Math.max(0, timeoutMs - elapsed);

  // Check if session has expired
  if (remainingMs <= 0) {
    devSessionStore.delete(userId);

    auditLog('SESSION_TIMEOUT', userId, {
      email: req.user.email,
      elapsedMinutes: Math.round(elapsed / 60000),
      configuredTimeout: timeoutMinutes,
      companyId,
      mode: 'development'
    });

    return sendSessionError(
      res,
      SESSION_ERROR_CODES.SESSION_TIMEOUT,
      'Session timed out due to inactivity',
      timeoutMinutes
    );
  }

  // Session is valid - attach info to request
  req.sessionInfo = {
    active: true,
    lastActivity: session.startTime,
    timeoutMinutes: timeoutMinutes,
    remainingMs: remainingMs,
    remainingMinutes: Math.ceil(remainingMs / 60000),
    expiresAt: session.startTime + timeoutMs,
    mode: 'development'
  };

  next();
};

// ============================================================================
// PRODUCTION MODE SESSION HANDLING (REDIS)
// ============================================================================

/**
 * Handle session timeout check in production mode using Redis
 * Uses atomic operations to prevent TOCTOU vulnerabilities
 * @param {Request} req - Express request
 * @param {Response} res - Express response
 * @param {Function} next - Next middleware
 */
const handleProductionSession = async (req, res, next) => {
  const userId = req.user.userId;
  const companyId = req.user.companyId || 'al-ramrami';
  const sessionKey = getSessionKey(userId);

  // Check endpoint type
  const passiveEndpoint = isPassiveEndpoint(req.originalUrl);
  const extensionEndpoint = isSessionExtensionEndpoint(req.originalUrl);
  const shouldUpdateActivity = !passiveEndpoint;

  try {
    const timeoutMinutes = await getSessionTimeoutForCompanyInternal(companyId);
    const timeoutMs = timeoutMinutes * 60 * 1000;
    const ttlSeconds = timeoutMinutes * 60 + 60; // TTL with 60s buffer
    const now = Date.now();

    // Use Redis transaction for atomic read-check-update
    // This prevents TOCTOU race conditions
    const result = await redis.multi()
      .get(sessionKey)
      .exec();

    const lastActivityStr = result[0][1];

    if (!lastActivityStr) {
      // NO SESSION EXISTS - Handle based on endpoint type
      if (passiveEndpoint || extensionEndpoint) {
        req.sessionInfo = {
          active: false,
          reason: SESSION_ERROR_CODES.NO_SESSION,
          timeoutMinutes: timeoutMinutes,
          mode: 'production'
        };
        return next();
      }

      // STRICT MODE: No session resurrection
      // If there's no session, user must log in again
      logger.info('No Redis session found - rejecting request', {
        userId,
        companyId,
        endpoint: req.originalUrl
      });

      return sendSessionError(
        res,
        SESSION_ERROR_CODES.NO_SESSION,
        'Session not found. Please log in again.',
        timeoutMinutes
      );
    }

    // Session exists - validate and check timeout
    const lastActivity = parseInt(lastActivityStr, 10);

    // Validate timestamp
    const timestampValidation = validateTimestamp(lastActivity);
    if (!timestampValidation.valid) {
      logger.warn('Invalid session timestamp in Redis', {
        userId,
        reason: timestampValidation.reason,
        lastActivity
      });

      await redis.del(sessionKey);
      return sendSessionError(
        res,
        SESSION_ERROR_CODES.INVALID_TIMESTAMP,
        'Session corrupted. Please log in again.',
        timeoutMinutes
      );
    }

    const inactiveTime = now - lastActivity;
    const remainingMs = timeoutMs - inactiveTime;

    // Check if session has timed out
    if (remainingMs <= 0) {
      // Session expired
      await redis.del(sessionKey);

      auditLog('SESSION_TIMEOUT', userId, {
        email: req.user.email,
        inactiveMinutes: Math.round(inactiveTime / 60000),
        configuredTimeout: timeoutMinutes,
        companyId,
        ip: req.ip,
        endpoint: req.originalUrl,
        mode: 'production'
      });

      // Allow extension endpoint through to handle gracefully
      if (extensionEndpoint) {
        req.sessionInfo = {
          active: false,
          reason: SESSION_ERROR_CODES.SESSION_TIMEOUT,
          timeoutMinutes: timeoutMinutes,
          mode: 'production'
        };
        return next();
      }

      return sendSessionError(
        res,
        SESSION_ERROR_CODES.SESSION_TIMEOUT,
        'Session timed out due to inactivity',
        timeoutMinutes
      );
    }

    // Session is valid - update activity if not passive endpoint
    if (shouldUpdateActivity) {
      // Atomic update with new timestamp and TTL
      await redis.setex(sessionKey, ttlSeconds, now.toString());
    }

    // Attach session info to request
    req.sessionInfo = {
      active: true,
      lastActivity: shouldUpdateActivity ? now : lastActivity,
      timeoutMinutes: timeoutMinutes,
      remainingMs: Math.max(0, remainingMs),
      remainingMinutes: Math.max(0, Math.ceil(remainingMs / 60000)),
      expiresAt: lastActivity + timeoutMs,
      mode: 'production'
    };

    next();
  } catch (error) {
    logger.error('Redis session check failed', {
      userId,
      companyId,
      error: error.message
    });

    // PRODUCTION: Fail closed - reject request when Redis is down
    if (REDIS_FAIL_MODE.STRICT_SESSION_IN_PRODUCTION) {
      logger.error('Redis failure in production - rejecting request (fail-closed mode)');

      return sendSessionError(
        res,
        SESSION_ERROR_CODES.REDIS_ERROR,
        'Session service temporarily unavailable. Please try again.',
        null
      );
    }

    // Development fallback - allow through but log
    logger.warn('Redis failure - allowing request through (fail-open mode)');
    req.sessionInfo = {
      active: true,
      timeoutMinutes: SESSION_CONFIG.DEFAULT_TIMEOUT_MINUTES,
      mode: 'fallback',
      error: error.message
    };
    next();
  }
};

// ============================================================================
// MAIN MIDDLEWARE
// ============================================================================

/**
 * Session timeout middleware
 * Routes to development or production handler based on environment
 */
const checkSessionTimeout = async (req, res, next) => {
  // Skip if no authenticated user
  if (!req.user || !req.user.userId) {
    return next();
  }

  // Route to appropriate handler based on environment and Redis availability
  if (isDevelopment || !isRedisConnected()) {
    return handleDevModeSession(req, res, next);
  } else {
    return handleProductionSession(req, res, next);
  }
};

// ============================================================================
// SESSION MANAGEMENT FUNCTIONS
// ============================================================================

/**
 * Get session status for a user
 * @param {number} userId - User ID
 * @param {string} companyId - Company ID
 * @param {object} jwtClaims - Optional JWT claims for dev mode initialization
 * @returns {Promise<object|null>} Session status or null on error
 */
const getSessionStatus = async (userId, companyId = 'al-ramrami', jwtClaims = null) => {
  if (!userId) return null;

  const timeoutMinutes = await getSessionTimeoutForCompanyInternal(companyId);
  const timeoutMs = timeoutMinutes * 60 * 1000;
  const now = Date.now();

  // Development mode
  if (isDevelopment || !isRedisConnected()) {
    const session = devSessionStore.get(userId);

    if (!session) {
      return {
        active: false,
        reason: SESSION_ERROR_CODES.NO_SESSION,
        timeoutMinutes: timeoutMinutes,
        mode: 'development'
      };
    }

    const elapsed = now - session.startTime;
    const remainingMs = Math.max(0, timeoutMs - elapsed);
    const active = remainingMs > 0;

    if (!active) {
      devSessionStore.delete(userId);
    }

    return {
      active,
      remainingMs,
      remainingMinutes: active ? Math.ceil(remainingMs / 60000) : 0,
      timeoutMinutes: timeoutMinutes,
      sessionStart: session.startTime,
      mode: 'development'
    };
  }

  // Production mode (Redis)
  try {
    const sessionKey = getSessionKey(userId);
    const lastActivityStr = await redis.get(sessionKey);

    if (!lastActivityStr) {
      return {
        active: false,
        reason: SESSION_ERROR_CODES.NO_SESSION,
        timeoutMinutes: timeoutMinutes,
        mode: 'production'
      };
    }

    const lastActivity = parseInt(lastActivityStr, 10);
    const remainingMs = timeoutMs - (now - lastActivity);
    const active = remainingMs > 0;

    return {
      active,
      lastActivity,
      remainingMs: Math.max(0, remainingMs),
      remainingMinutes: Math.max(0, Math.ceil(remainingMs / 60000)),
      timeoutMinutes: timeoutMinutes,
      mode: 'production'
    };
  } catch (error) {
    logger.error('Failed to get session status', { userId, companyId, error: error.message });
    return null;
  }
};

/**
 * Extend session explicitly (for "Stay logged in" button)
 * @param {number} userId - User ID
 * @param {string} companyId - Company ID
 * @returns {Promise<boolean>} Success status
 */
const extendSession = async (userId, companyId = 'al-ramrami') => {
  if (!userId) return false;

  const now = Date.now();

  // Development mode
  if (isDevelopment || !isRedisConnected()) {
    const session = devSessionStore.get(userId);
    if (!session) {
      logger.warn('Cannot extend non-existent dev session', { userId });
      return false;
    }

    devSessionStore.set(userId, now, companyId);
    logger.info('Dev session extended', { userId, companyId });
    return true;
  }

  // Production mode (Redis)
  try {
    const sessionKey = getSessionKey(userId);

    // Verify session exists before extending
    const exists = await redis.exists(sessionKey);
    if (!exists) {
      logger.warn('Cannot extend non-existent Redis session', { userId });
      return false;
    }

    const timeoutMinutes = await getSessionTimeoutForCompanyInternal(companyId);
    const ttlSeconds = timeoutMinutes * 60 + 60;

    await redis.setex(sessionKey, ttlSeconds, now.toString());

    logger.info('Session extended', { userId, companyId, timeoutMinutes });
    return true;
  } catch (error) {
    logger.error('Failed to extend session', { userId, companyId, error: error.message });
    return false;
  }
};

/**
 * Initialize session (called on login)
 * @param {number} userId - User ID
 * @param {string} companyId - Company ID
 * @returns {Promise<boolean>} Success status
 */
const initializeSession = async (userId, companyId = 'al-ramrami') => {
  if (!userId) {
    logger.warn('initializeSession called without userId');
    return false;
  }

  const now = Date.now();

  // Development mode
  if (isDevelopment || !isRedisConnected()) {
    devSessionStore.set(userId, now, companyId);
    logger.info('Dev session initialized', { userId, companyId });
    return true;
  }

  // Production mode (Redis)
  try {
    const sessionKey = getSessionKey(userId);
    const timeoutMinutes = await getSessionTimeoutForCompanyInternal(companyId);
    const ttlSeconds = timeoutMinutes * 60 + 60;

    await redis.setex(sessionKey, ttlSeconds, now.toString());

    // Verify session was created
    const verification = await redis.get(sessionKey);
    if (!verification) {
      logger.error('Session key was not persisted to Redis!', { userId, sessionKey });
      return false;
    }

    logger.info('Session initialized', {
      userId,
      companyId,
      timeoutMinutes,
      ttlSeconds
    });
    return true;
  } catch (error) {
    logger.error('Failed to initialize session', { userId, companyId, error: error.message });
    return false;
  }
};

/**
 * Clear session (called on logout)
 * @param {number} userId - User ID
 * @returns {Promise<boolean>} Success status
 */
const clearSession = async (userId) => {
  if (!userId) return false;

  // Development mode
  if (isDevelopment || !isRedisConnected()) {
    devSessionStore.delete(userId);
    logger.debug('Dev session cleared', { userId });
    return true;
  }

  // Production mode (Redis)
  try {
    const sessionKey = getSessionKey(userId);
    await redis.del(sessionKey);
    logger.debug('Session cleared', { userId });
    return true;
  } catch (error) {
    logger.error('Failed to clear session', { userId, error: error.message });
    return false;
  }
};

/**
 * Force clear all sessions for a user (called from tokenBlacklist)
 * This ensures both JWT blacklist AND Redis session are invalidated
 * @param {number} userId - User ID
 * @returns {Promise<boolean>} Success status
 */
const forceLogoutSession = async (userId) => {
  if (!userId) return false;

  // Always clear dev session store
  devSessionStore.delete(userId);

  // Clear Redis session if available
  if (isRedisConnected()) {
    try {
      const sessionKey = getSessionKey(userId);
      await redis.del(sessionKey);
      logger.info('Force logout: Redis session cleared', { userId });
    } catch (error) {
      logger.error('Force logout: Failed to clear Redis session', {
        userId,
        error: error.message
      });
      // Don't return false - the JWT blacklist is more important
    }
  }

  return true;
};

// ============================================================================
// EXPORTS
// ============================================================================

// Legacy exports for backward compatibility
const SESSION_TIMEOUT_MINUTES = SESSION_CONFIG.DEFAULT_TIMEOUT_MINUTES;
const SESSION_TIMEOUT_MS = SESSION_TIMEOUT_MINUTES * 60 * 1000;
const DEFAULT_SESSION_TIMEOUT_MINUTES = SESSION_CONFIG.DEFAULT_TIMEOUT_MINUTES;

module.exports = {
  // Main middleware
  checkSessionTimeout,

  // Session management functions
  getSessionStatus,
  extendSession,
  clearSession,
  initializeSession,
  forceLogoutSession,

  // Configuration management
  clearSessionTimeoutCache,
  getSessionTimeoutForCompany,

  // Legacy exports (backward compatibility)
  SESSION_TIMEOUT_MINUTES,
  SESSION_TIMEOUT_MS,
  DEFAULT_SESSION_TIMEOUT_MINUTES,

  // For testing
  _devSessionStore: devSessionStore,
};
