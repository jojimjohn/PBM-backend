/**
 * Session Timeout Middleware
 *
 * Enforces configurable inactivity timeout for security.
 * Tracks last activity per user in Redis with sliding window.
 * Timeout is configurable per-company via system_settings table.
 *
 * SECURITY: This is defense-in-depth on top of JWT expiration.
 * Even if a token is valid, the session can timeout due to inactivity.
 */

const { redis } = require('../config/redis');
const { logger, auditLog } = require('../utils/logger');
const { getDbConnection } = require('../config/database');

// Default session configuration (can be overridden via database or environment)
const DEFAULT_SESSION_TIMEOUT_MINUTES = parseInt(process.env.SESSION_TIMEOUT_MINUTES) || 30;
const SESSION_KEY_PREFIX = 'session:activity:';
const TIMEOUT_CACHE_KEY_PREFIX = 'session:timeout:';
const TIMEOUT_CACHE_TTL = 300; // Cache timeout setting for 5 minutes

// Legacy export for backward compatibility
const SESSION_TIMEOUT_MINUTES = DEFAULT_SESSION_TIMEOUT_MINUTES;
const SESSION_TIMEOUT_MS = SESSION_TIMEOUT_MINUTES * 60 * 1000;

/**
 * Get session key for a user
 */
const getSessionKey = (userId) => `${SESSION_KEY_PREFIX}${userId}`;

/**
 * Get timeout cache key for a company
 */
const getTimeoutCacheKey = (companyId) => `${TIMEOUT_CACHE_KEY_PREFIX}${companyId}`;

/**
 * Get session timeout for a company (with caching)
 * Reads from database system_settings, caches in Redis for performance
 */
const getSessionTimeoutForCompany = async (companyId) => {
  try {
    // Try to get from Redis cache first
    const cacheKey = getTimeoutCacheKey(companyId);
    const cachedTimeout = await redis.get(cacheKey);

    if (cachedTimeout) {
      return parseInt(cachedTimeout, 10);
    }

    // Fetch from database
    const db = getDbConnection(companyId);
    const setting = await db('system_settings')
      .where({ company_id: companyId, setting_key: 'session_timeout_minutes' })
      .first();

    const timeoutMinutes = setting ? parseInt(setting.setting_value, 10) : DEFAULT_SESSION_TIMEOUT_MINUTES;

    // Cache the value
    await redis.setex(cacheKey, TIMEOUT_CACHE_TTL, timeoutMinutes.toString());

    return timeoutMinutes;
  } catch (error) {
    logger.warn('Failed to get session timeout from database, using default', {
      companyId,
      error: error.message
    });
    return DEFAULT_SESSION_TIMEOUT_MINUTES;
  }
};

/**
 * Clear session timeout cache for a company
 * Called when admin updates the timeout setting
 */
const clearSessionTimeoutCache = async (companyId) => {
  try {
    const cacheKey = getTimeoutCacheKey(companyId);
    await redis.del(cacheKey);
    logger.debug('Session timeout cache cleared', { companyId });
  } catch (error) {
    logger.warn('Failed to clear session timeout cache', {
      companyId,
      error: error.message
    });
  }
};

/**
 * Session timeout middleware
 * Checks and updates last activity timestamp
 * Uses per-company configurable timeout from database
 *
 * ACTIVITY TRACKING RULES:
 * All HTTP methods (including GET) count as user activity, EXCEPT for specific
 * passive endpoints that are polled automatically by the frontend.
 *
 * This ensures users who are actively searching/viewing records don't get
 * unexpectedly logged out.
 *
 * Explicit exclusions (automated polling endpoints):
 * - /auth/session/status - Used by frontend to check remaining time
 * - /auth/session/extend - Manually extends session (handled separately)
 * - /auth/session/heartbeat - Heartbeat pings
 */
const PASSIVE_ENDPOINTS = [
  '/api/auth/session/status',
  '/api/auth/session/extend',
  '/api/auth/session/heartbeat'
];

// Methods that indicate user activity (all methods count as activity)
const ACTIVE_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];

const checkSessionTimeout = async (req, res, next) => {
  // Skip if no authenticated user
  if (!req.user || !req.user.userId) {
    return next();
  }

  const userId = req.user.userId;
  const companyId = req.user.companyId || 'al-ramrami';
  const sessionKey = getSessionKey(userId);

  // Determine if this request should count as "activity"
  // 1. Must be an active method (POST/PUT/DELETE/PATCH)
  // 2. Must not be a passive endpoint
  const isActiveMethod = ACTIVE_METHODS.includes(req.method.toUpperCase());
  const isPassiveEndpoint = PASSIVE_ENDPOINTS.some(ep => req.originalUrl.startsWith(ep));
  const shouldUpdateActivity = isActiveMethod && !isPassiveEndpoint;

  try {
    // Get the configurable timeout for this company
    const timeoutMinutes = await getSessionTimeoutForCompany(companyId);
    const timeoutMs = timeoutMinutes * 60 * 1000;

    // Get last activity timestamp
    const lastActivityStr = await redis.get(sessionKey);
    const now = Date.now();

    if (lastActivityStr) {
      const lastActivity = parseInt(lastActivityStr, 10);
      const inactiveTime = now - lastActivity;

      // Check if session has timed out
      if (inactiveTime > timeoutMs) {
        auditLog('SESSION_TIMEOUT', userId, {
          email: req.user.email,
          inactiveMinutes: Math.round(inactiveTime / 60000),
          configuredTimeout: timeoutMinutes,
          companyId,
          ip: req.ip,
          endpoint: req.originalUrl
        });

        // Clear session activity
        await redis.del(sessionKey);

        // Clear auth cookies
        res.clearCookie('accessToken', { path: '/' });
        res.clearCookie('refreshToken', { path: '/api/auth/refresh' });
        res.clearCookie('csrf-token', { path: '/' });

        return res.status(401).json({
          success: false,
          error: 'Session timed out due to inactivity',
          code: 'SESSION_TIMEOUT',
          timeoutMinutes: timeoutMinutes
        });
      }
    }

    // Update last activity timestamp (sliding window)
    // All HTTP methods count as activity EXCEPT for passive endpoints
    // (session status checks, heartbeats, etc.)
    // TTL slightly longer than timeout to allow for grace period
    if (shouldUpdateActivity) {
      await redis.setex(sessionKey, timeoutMinutes * 60 + 60, now.toString());
    } else if (!lastActivityStr) {
      // Session doesn't exist and this is a passive endpoint
      // Initialize the session anyway to prevent spurious logouts
      // This handles cases like:
      // - Server restart (in-memory fallback loses data)
      // - Redis restart/flush
      // - User's first request being to a passive endpoint
      logger.info('Initializing session from passive endpoint (no existing session)', {
        userId,
        companyId,
        endpoint: req.originalUrl
      });
      await redis.setex(sessionKey, timeoutMinutes * 60 + 60, now.toString());
    }

    // Add session info to request for frontend use
    req.sessionInfo = {
      lastActivity: lastActivityStr ? parseInt(lastActivityStr, 10) : now,
      timeoutMinutes: timeoutMinutes,
      expiresAt: (lastActivityStr ? parseInt(lastActivityStr, 10) : now) + timeoutMs
    };

    next();
  } catch (error) {
    logger.error('Session timeout check failed', {
      userId,
      companyId,
      error: error.message
    });

    // On Redis failure, allow request through but log it
    // The token blacklist will still protect against revoked tokens
    next();
  }
};

/**
 * Get session status for a user
 * Used by frontend to show timeout warning
 * @param {number} userId - User ID
 * @param {string} companyId - Company ID for per-company timeout
 * @param {boolean} autoInitialize - If true, initialize session if missing (default: true)
 */
const getSessionStatus = async (userId, companyId = 'al-ramrami', autoInitialize = true) => {
  if (!userId) return null;

  try {
    const sessionKey = getSessionKey(userId);
    const lastActivityStr = await redis.get(sessionKey);

    // Get per-company timeout
    const timeoutMinutes = await getSessionTimeoutForCompany(companyId);
    const timeoutMs = timeoutMinutes * 60 * 1000;

    if (!lastActivityStr) {
      // Session key doesn't exist in Redis - this could happen if:
      // 1. Redis was restarted/flushed
      // 2. initializeSession failed
      // 3. In-memory fallback was being used and server restarted
      // 4. Key expired (session actually timed out)
      //
      // IMPORTANT: If user is authenticated (JWT is valid), this is likely
      // a Redis/server restart scenario, NOT a timeout. Auto-initialize
      // the session to prevent spurious logouts.
      if (autoInitialize) {
        logger.info('Session key not found, auto-initializing for authenticated user', {
          userId,
          companyId,
          sessionKey
        });

        // Initialize a fresh session
        const initialized = await initializeSession(userId, companyId);

        if (initialized) {
          // Return active status with full timeout remaining
          return {
            active: true,
            lastActivity: Date.now(),
            remainingMs: timeoutMs,
            remainingMinutes: timeoutMinutes,
            timeoutMinutes: timeoutMinutes,
            wasReinitialized: true
          };
        }
      }

      // Auto-initialize disabled or failed - return inactive
      logger.warn('Session key not found in Redis', { userId, companyId, sessionKey });
      return { active: false, timeoutMinutes };
    }

    const lastActivity = parseInt(lastActivityStr, 10);
    const now = Date.now();
    const remainingMs = timeoutMs - (now - lastActivity);

    return {
      active: remainingMs > 0,
      lastActivity,
      remainingMs: Math.max(0, remainingMs),
      remainingMinutes: Math.max(0, Math.ceil(remainingMs / 60000)),
      timeoutMinutes: timeoutMinutes
    };
  } catch (error) {
    logger.error('Failed to get session status', { userId, companyId, error: error.message });
    return null;
  }
};

/**
 * Extend session (for "Stay logged in" button)
 * @param {number} userId - User ID
 * @param {string} companyId - Company ID for per-company timeout
 */
const extendSession = async (userId, companyId = 'al-ramrami') => {
  if (!userId) return false;

  try {
    const sessionKey = getSessionKey(userId);
    const now = Date.now();

    // Get per-company timeout for TTL
    const timeoutMinutes = await getSessionTimeoutForCompany(companyId);

    await redis.setex(sessionKey, timeoutMinutes * 60 + 60, now.toString());

    logger.info('Session extended', { userId, companyId, timeoutMinutes });
    return true;
  } catch (error) {
    logger.error('Failed to extend session', { userId, companyId, error: error.message });
    return false;
  }
};

/**
 * Clear session (on logout)
 */
const clearSession = async (userId) => {
  if (!userId) return false;

  try {
    const sessionKey = getSessionKey(userId);
    await redis.del(sessionKey);
    return true;
  } catch (error) {
    logger.error('Failed to clear session', { userId, error: error.message });
    return false;
  }
};

/**
 * Initialize session (on login)
 * @param {number} userId - User ID
 * @param {string} companyId - Company ID for per-company timeout
 */
const initializeSession = async (userId, companyId = 'al-ramrami') => {
  if (!userId) {
    logger.warn('initializeSession called without userId');
    return false;
  }

  try {
    const sessionKey = getSessionKey(userId);
    const now = Date.now();

    // Get per-company timeout for TTL
    const timeoutMinutes = await getSessionTimeoutForCompany(companyId);
    const ttl = timeoutMinutes * 60 + 60; // TTL in seconds

    await redis.setex(sessionKey, ttl, now.toString());

    // Verify the key was set correctly
    const verification = await redis.get(sessionKey);
    if (!verification) {
      logger.error('Session key was not persisted to Redis!', { userId, sessionKey });
      return false;
    }

    logger.info('Session initialized successfully', {
      userId,
      companyId,
      timeoutMinutes,
      ttlSeconds: ttl,
      sessionKey,
      timestamp: now
    });
    return true;
  } catch (error) {
    logger.error('Failed to initialize session', { userId, companyId, error: error.message, stack: error.stack });
    return false;
  }
};

module.exports = {
  checkSessionTimeout,
  getSessionStatus,
  extendSession,
  clearSession,
  initializeSession,
  clearSessionTimeoutCache,
  getSessionTimeoutForCompany,
  SESSION_TIMEOUT_MINUTES,
  SESSION_TIMEOUT_MS,
  DEFAULT_SESSION_TIMEOUT_MINUTES
};
