/**
 * Session Timeout Middleware
 *
 * Enforces 30-minute inactivity timeout for security.
 * Tracks last activity per user in Redis with sliding window.
 *
 * SECURITY: This is defense-in-depth on top of JWT expiration.
 * Even if a token is valid, the session can timeout due to inactivity.
 */

const { redis } = require('../config/redis');
const { logger, auditLog } = require('../utils/logger');

// Session configuration (can be overridden via environment)
const SESSION_TIMEOUT_MINUTES = parseInt(process.env.SESSION_TIMEOUT_MINUTES) || 30;
const SESSION_TIMEOUT_MS = SESSION_TIMEOUT_MINUTES * 60 * 1000;
const SESSION_KEY_PREFIX = 'session:activity:';

/**
 * Get session key for a user
 */
const getSessionKey = (userId) => `${SESSION_KEY_PREFIX}${userId}`;

/**
 * Session timeout middleware
 * Checks and updates last activity timestamp
 */
const checkSessionTimeout = async (req, res, next) => {
  // Skip if no authenticated user
  if (!req.user || !req.user.userId) {
    return next();
  }

  const userId = req.user.userId;
  const sessionKey = getSessionKey(userId);

  try {
    // Get last activity timestamp
    const lastActivityStr = await redis.get(sessionKey);
    const now = Date.now();

    if (lastActivityStr) {
      const lastActivity = parseInt(lastActivityStr, 10);
      const inactiveTime = now - lastActivity;

      // Check if session has timed out
      if (inactiveTime > SESSION_TIMEOUT_MS) {
        auditLog('SESSION_TIMEOUT', userId, {
          email: req.user.email,
          inactiveMinutes: Math.round(inactiveTime / 60000),
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
          timeoutMinutes: SESSION_TIMEOUT_MINUTES
        });
      }
    }

    // Update last activity timestamp (sliding window)
    // TTL slightly longer than timeout to allow for grace period
    await redis.setex(sessionKey, SESSION_TIMEOUT_MINUTES * 60 + 60, now.toString());

    // Add session info to request for frontend use
    req.sessionInfo = {
      lastActivity: now,
      timeoutMinutes: SESSION_TIMEOUT_MINUTES,
      expiresAt: now + SESSION_TIMEOUT_MS
    };

    next();
  } catch (error) {
    logger.error('Session timeout check failed', {
      userId,
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
 */
const getSessionStatus = async (userId) => {
  if (!userId) return null;

  try {
    const sessionKey = getSessionKey(userId);
    const lastActivityStr = await redis.get(sessionKey);

    if (!lastActivityStr) {
      return { active: false };
    }

    const lastActivity = parseInt(lastActivityStr, 10);
    const now = Date.now();
    const remainingMs = SESSION_TIMEOUT_MS - (now - lastActivity);

    return {
      active: remainingMs > 0,
      lastActivity,
      remainingMs: Math.max(0, remainingMs),
      remainingMinutes: Math.max(0, Math.ceil(remainingMs / 60000)),
      timeoutMinutes: SESSION_TIMEOUT_MINUTES
    };
  } catch (error) {
    logger.error('Failed to get session status', { userId, error: error.message });
    return null;
  }
};

/**
 * Extend session (for "Stay logged in" button)
 */
const extendSession = async (userId) => {
  if (!userId) return false;

  try {
    const sessionKey = getSessionKey(userId);
    const now = Date.now();

    await redis.setex(sessionKey, SESSION_TIMEOUT_MINUTES * 60 + 60, now.toString());

    logger.info('Session extended', { userId });
    return true;
  } catch (error) {
    logger.error('Failed to extend session', { userId, error: error.message });
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
 */
const initializeSession = async (userId) => {
  if (!userId) return false;

  try {
    const sessionKey = getSessionKey(userId);
    const now = Date.now();

    await redis.setex(sessionKey, SESSION_TIMEOUT_MINUTES * 60 + 60, now.toString());

    logger.debug('Session initialized', { userId });
    return true;
  } catch (error) {
    logger.error('Failed to initialize session', { userId, error: error.message });
    return false;
  }
};

module.exports = {
  checkSessionTimeout,
  getSessionStatus,
  extendSession,
  clearSession,
  initializeSession,
  SESSION_TIMEOUT_MINUTES,
  SESSION_TIMEOUT_MS
};
