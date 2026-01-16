/**
 * Session Configuration - Single Source of Truth
 *
 * All session-related constants and configuration in one place.
 * Environment variables override defaults for production flexibility.
 */

// Environment detection - standardized across all modules
const NODE_ENV = process.env.NODE_ENV || 'development';
const isProduction = NODE_ENV === 'production';
const isDevelopment = !isProduction;

// Session timeout configuration
const SESSION_CONFIG = {
  // Default timeout (can be overridden per-company in database)
  DEFAULT_TIMEOUT_MINUTES: parseInt(process.env.SESSION_TIMEOUT_MINUTES) || 30,

  // Warning threshold - show warning this many minutes before timeout
  WARNING_THRESHOLD_MINUTES: parseInt(process.env.SESSION_WARNING_MINUTES) || 5,

  // Cache TTL for company-specific timeout settings (seconds)
  TIMEOUT_CACHE_TTL_SECONDS: parseInt(process.env.SESSION_CACHE_TTL) || 300,

  // Development session cleanup interval (milliseconds)
  DEV_CLEANUP_INTERVAL_MS: 5 * 60 * 1000, // Every 5 minutes

  // Maximum session age for validation (prevents future timestamp attacks)
  MAX_SESSION_AGE_MS: 24 * 60 * 60 * 1000, // 24 hours
};

// Token configuration
const TOKEN_CONFIG = {
  // Access token lifetime
  ACCESS_TOKEN_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '15m',
  ACCESS_TOKEN_MAX_AGE_MS: 15 * 60 * 1000,

  // Refresh token lifetime
  REFRESH_TOKEN_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  REFRESH_TOKEN_MAX_AGE_MS: 7 * 24 * 60 * 60 * 1000,

  // Blacklist TTL matches refresh token lifetime
  BLACKLIST_TTL_SECONDS: 7 * 24 * 60 * 60,
};

// Redis key prefixes - centralized for consistency
const REDIS_KEYS = {
  SESSION_ACTIVITY: 'session:activity:',
  SESSION_TIMEOUT_CACHE: 'session:timeout:',
  TOKEN_BLACKLIST: 'blacklist:token:',
  USER_FORCE_LOGOUT: 'blacklist:user:',
  REFRESH_LOCK: 'lock:refresh:',
};

// Endpoints configuration
const ENDPOINTS = {
  // Passive endpoints that do NOT update session activity
  PASSIVE: [
    '/api/auth/session/status',
    '/api/auth/session/heartbeat',
    '/api/health',
    '/health',
  ],

  // Endpoints that can explicitly extend sessions
  SESSION_EXTENSION: [
    '/api/auth/session/extend',
  ],
};

// Redis failure mode configuration
const REDIS_FAIL_MODE = {
  // 'open' = allow requests through (availability > security) - for dev
  // 'closed' = reject requests (security > availability) - for production
  MODE: process.env.REDIS_FAIL_MODE || (isProduction ? 'closed' : 'open'),

  // Whether to log Redis failures (always true, but can be silenced)
  LOG_FAILURES: true,

  // Whether session timeout should reject on Redis failure in production
  STRICT_SESSION_IN_PRODUCTION: isProduction,
};

// Error codes for consistent error handling
const SESSION_ERROR_CODES = {
  NO_SESSION: 'NO_SESSION',
  SESSION_TIMEOUT: 'SESSION_TIMEOUT',
  SESSION_INVALID: 'SESSION_INVALID',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_REVOKED: 'TOKEN_REVOKED',
  FORCE_LOGOUT: 'FORCE_LOGOUT',
  REDIS_ERROR: 'REDIS_ERROR',
  INVALID_TIMESTAMP: 'INVALID_TIMESTAMP',
};

/**
 * Get session key for Redis
 * @param {number} userId - User ID
 * @returns {string} Redis key
 */
const getSessionKey = (userId) => `${REDIS_KEYS.SESSION_ACTIVITY}${userId}`;

/**
 * Get timeout cache key for Redis
 * @param {string} companyId - Company ID
 * @returns {string} Redis key
 */
const getTimeoutCacheKey = (companyId) => `${REDIS_KEYS.SESSION_TIMEOUT_CACHE}${companyId}`;

/**
 * Get refresh lock key for Redis (mutex)
 * @param {number} userId - User ID
 * @returns {string} Redis key
 */
const getRefreshLockKey = (userId) => `${REDIS_KEYS.REFRESH_LOCK}${userId}`;

/**
 * Validate a timestamp is reasonable (not in future, not too old)
 * @param {number} timestamp - Timestamp in milliseconds
 * @param {number} maxAgeMs - Maximum age in milliseconds
 * @returns {{valid: boolean, reason?: string}}
 */
const validateTimestamp = (timestamp, maxAgeMs = SESSION_CONFIG.MAX_SESSION_AGE_MS) => {
  const now = Date.now();

  // Check for future timestamp (clock skew attack or corruption)
  if (timestamp > now + 60000) { // Allow 1 minute clock skew
    return { valid: false, reason: 'FUTURE_TIMESTAMP' };
  }

  // Check for timestamp too old
  if (now - timestamp > maxAgeMs) {
    return { valid: false, reason: 'TIMESTAMP_TOO_OLD' };
  }

  // Check for obviously invalid timestamp (before year 2020)
  if (timestamp < 1577836800000) { // Jan 1, 2020
    return { valid: false, reason: 'INVALID_TIMESTAMP' };
  }

  return { valid: true };
};

/**
 * Check if an endpoint is passive (should not update session activity)
 * @param {string} url - Request URL
 * @returns {boolean}
 */
const isPassiveEndpoint = (url) => {
  return ENDPOINTS.PASSIVE.some(ep => url.startsWith(ep));
};

/**
 * Check if an endpoint can extend sessions
 * @param {string} url - Request URL
 * @returns {boolean}
 */
const isSessionExtensionEndpoint = (url) => {
  return ENDPOINTS.SESSION_EXTENSION.some(ep => url.startsWith(ep));
};

module.exports = {
  // Environment
  NODE_ENV,
  isProduction,
  isDevelopment,

  // Configuration objects
  SESSION_CONFIG,
  TOKEN_CONFIG,
  REDIS_KEYS,
  ENDPOINTS,
  REDIS_FAIL_MODE,
  SESSION_ERROR_CODES,

  // Helper functions
  getSessionKey,
  getTimeoutCacheKey,
  getRefreshLockKey,
  validateTimestamp,
  isPassiveEndpoint,
  isSessionExtensionEndpoint,
};
