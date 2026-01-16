/**
 * Redis Configuration Module
 *
 * Provides Redis connectivity for:
 * - Token blacklist (secure logout)
 * - Session storage (timeout tracking)
 * - Rate limiting persistence
 *
 * SECURITY: Redis is REQUIRED in production for secure token revocation.
 * In development, falls back to in-memory storage with warnings.
 *
 * RESILIENCE: Automatically falls back to in-memory when Redis disconnects.
 */

const Redis = require('ioredis');
const { logger } = require('../utils/logger');

// Redis connection configuration
const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  db: parseInt(process.env.REDIS_DB) || 0,
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  retryStrategy: (times) => {
    if (times > 3) {
      logger.error('Redis connection failed after 3 retries');
      return null; // Stop retrying
    }
    return Math.min(times * 200, 2000); // Exponential backoff
  },
  reconnectOnError: (err) => {
    const targetErrors = ['READONLY', 'ECONNRESET', 'ECONNREFUSED'];
    return targetErrors.some(e => err.message.includes(e));
  }
};

/**
 * In-Memory Fallback for Development
 * WARNING: NOT SUITABLE FOR PRODUCTION
 * - Data lost on server restart
 * - No persistence across instances
 * - Token blacklist won't work in clustered environments
 */
class InMemoryFallback {
  constructor() {
    this.store = new Map();
    this.expirations = new Map();
    this._loggedWarning = false;
  }

  _logWarning() {
    if (!this._loggedWarning) {
      logger.warn('⚠️  Using in-memory Redis fallback. NOT SUITABLE FOR PRODUCTION!');
      this._loggedWarning = true;
    }
  }

  async get(key) {
    this._logWarning();
    this._checkExpiration(key);
    return this.store.get(key) || null;
  }

  async set(key, value, exMode, exValue) {
    this._logWarning();
    this.store.set(key, value);
    if (exMode === 'EX' && exValue) {
      const expireAt = Date.now() + (exValue * 1000);
      this.expirations.set(key, expireAt);
      setTimeout(() => this._expire(key), exValue * 1000);
    }
    return 'OK';
  }

  async setex(key, seconds, value) {
    return this.set(key, value, 'EX', seconds);
  }

  async del(key) {
    this.store.delete(key);
    this.expirations.delete(key);
    return 1;
  }

  async exists(key) {
    this._checkExpiration(key);
    return this.store.has(key) ? 1 : 0;
  }

  async hset(key, field, value) {
    let hash = this.store.get(key);
    if (!hash || typeof hash !== 'object') {
      hash = {};
    }
    hash[field] = value;
    this.store.set(key, hash);
    return 1;
  }

  async hget(key, field) {
    const hash = this.store.get(key);
    return hash && typeof hash === 'object' ? hash[field] : null;
  }

  async hgetall(key) {
    const hash = this.store.get(key);
    return hash && typeof hash === 'object' ? hash : null;
  }

  async hdel(key, field) {
    const hash = this.store.get(key);
    if (hash && typeof hash === 'object') {
      delete hash[field];
      return 1;
    }
    return 0;
  }

  async expire(key, seconds) {
    if (this.store.has(key)) {
      const expireAt = Date.now() + (seconds * 1000);
      this.expirations.set(key, expireAt);
      setTimeout(() => this._expire(key), seconds * 1000);
      return 1;
    }
    return 0;
  }

  async ttl(key) {
    const expireAt = this.expirations.get(key);
    if (!expireAt) return -1;
    const remaining = Math.ceil((expireAt - Date.now()) / 1000);
    return remaining > 0 ? remaining : -2;
  }

  async keys(pattern) {
    // Simple pattern matching (only supports * wildcard)
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    return Array.from(this.store.keys()).filter(key => regex.test(key));
  }

  async ping() {
    return 'PONG';
  }

  _checkExpiration(key) {
    const expireAt = this.expirations.get(key);
    if (expireAt && Date.now() > expireAt) {
      this._expire(key);
    }
  }

  _expire(key) {
    this.store.delete(key);
    this.expirations.delete(key);
  }

  // Connection status methods
  get status() {
    return 'ready';
  }

  disconnect() {
    this.store.clear();
    this.expirations.clear();
  }

  quit() {
    return this.disconnect();
  }
}

/**
 * Resilient Redis Wrapper
 * Automatically falls back to in-memory when Redis is unavailable
 *
 * OPTIMIZATION (Jan 2026): Skip Redis connection entirely in development mode
 * to avoid timeout delays and unnecessary network attempts.
 */
class ResilientRedisClient {
  constructor() {
    this.redisClient = null;
    this.fallback = new InMemoryFallback();
    this.isRedisConnected = false;
    this.useInMemory = false;

    this._initializeRedis();
  }

  _initializeRedis() {
    // DEVELOPMENT MODE: Skip Redis entirely - use in-memory immediately
    // This prevents connection timeout delays and unnecessary network attempts
    const isDevelopment = process.env.NODE_ENV !== 'production';
    const forceRedis = process.env.FORCE_REDIS === 'true'; // Override for testing Redis locally

    if (isDevelopment && !forceRedis && !process.env.REDIS_URL) {
      logger.info('📦 Development mode: Using in-memory storage (Redis skipped)');
      this.useInMemory = true;
      this.isRedisConnected = false;
      return; // Skip Redis connection entirely
    }

    try {
      // Use URL if provided (for cloud Redis like Railway, Render, etc.)
      if (process.env.REDIS_URL) {
        this.redisClient = new Redis(process.env.REDIS_URL, {
          maxRetriesPerRequest: redisConfig.maxRetriesPerRequest,
          enableReadyCheck: redisConfig.enableReadyCheck,
          retryStrategy: redisConfig.retryStrategy,
          lazyConnect: true
        });
      } else {
        this.redisClient = new Redis({
          ...redisConfig,
          lazyConnect: true
        });
      }

      this.redisClient.on('connect', () => {
        logger.info('✅ Redis connection established');
      });

      this.redisClient.on('ready', () => {
        this.isRedisConnected = true;
        this.useInMemory = false;
        logger.info('✅ Redis client ready');
      });

      this.redisClient.on('error', (err) => {
        this.isRedisConnected = false;
        logger.error('❌ Redis error:', { error: err.message });

        if (process.env.NODE_ENV === 'production') {
          logger.error('CRITICAL: Redis unavailable - using fallback. Token blacklist may be incomplete!');
        }
      });

      this.redisClient.on('close', () => {
        this.isRedisConnected = false;
        logger.warn('Redis connection closed - falling back to in-memory');
      });

      this.redisClient.on('reconnecting', () => {
        logger.info('Redis reconnecting...');
      });

      // Attempt connection
      this.redisClient.connect().then(() => {
        return this.redisClient.ping();
      }).then(() => {
        logger.info('✅ Redis ping successful');
        this.isRedisConnected = true;
        this.useInMemory = false;
      }).catch((err) => {
        logger.error('❌ Redis connection failed:', { error: err.message });
        this.isRedisConnected = false;

        if (process.env.NODE_ENV !== 'production') {
          logger.warn('Using in-memory fallback for development');
          this.useInMemory = true;
        } else {
          logger.error('CRITICAL: Redis required in production!');
        }
      });

    } catch (error) {
      logger.error('❌ Redis initialization failed:', { error: error.message });
      this.isRedisConnected = false;

      if (process.env.NODE_ENV !== 'production') {
        this.useInMemory = true;
      }
    }
  }

  /**
   * Get the appropriate client (Redis or fallback)
   */
  _getClient() {
    // If Redis is connected and ready, use it
    if (this.isRedisConnected && this.redisClient && this.redisClient.status === 'ready') {
      return this.redisClient;
    }

    // In development, use fallback
    if (process.env.NODE_ENV !== 'production') {
      return this.fallback;
    }

    // In production, still try Redis but log warning
    if (this.redisClient) {
      return this.redisClient;
    }

    // Last resort fallback
    logger.warn('Using in-memory fallback (Redis unavailable)');
    return this.fallback;
  }

  // Proxy methods to the active client
  async get(key) {
    try {
      return await this._getClient().get(key);
    } catch (error) {
      logger.error('Redis get failed, using fallback', { error: error.message });
      return await this.fallback.get(key);
    }
  }

  async set(key, value, ...args) {
    try {
      return await this._getClient().set(key, value, ...args);
    } catch (error) {
      logger.error('Redis set failed, using fallback', { error: error.message });
      return await this.fallback.set(key, value, ...args);
    }
  }

  async setex(key, seconds, value) {
    try {
      return await this._getClient().setex(key, seconds, value);
    } catch (error) {
      logger.error('Redis setex failed, using fallback', { error: error.message });
      return await this.fallback.setex(key, seconds, value);
    }
  }

  async del(key) {
    try {
      return await this._getClient().del(key);
    } catch (error) {
      logger.error('Redis del failed, using fallback', { error: error.message });
      return await this.fallback.del(key);
    }
  }

  async exists(key) {
    try {
      return await this._getClient().exists(key);
    } catch (error) {
      logger.error('Redis exists failed, using fallback', { error: error.message });
      return await this.fallback.exists(key);
    }
  }

  async hset(key, field, value) {
    try {
      return await this._getClient().hset(key, field, value);
    } catch (error) {
      logger.error('Redis hset failed, using fallback', { error: error.message });
      return await this.fallback.hset(key, field, value);
    }
  }

  async hget(key, field) {
    try {
      return await this._getClient().hget(key, field);
    } catch (error) {
      logger.error('Redis hget failed, using fallback', { error: error.message });
      return await this.fallback.hget(key, field);
    }
  }

  async hgetall(key) {
    try {
      return await this._getClient().hgetall(key);
    } catch (error) {
      logger.error('Redis hgetall failed, using fallback', { error: error.message });
      return await this.fallback.hgetall(key);
    }
  }

  async hdel(key, field) {
    try {
      return await this._getClient().hdel(key, field);
    } catch (error) {
      logger.error('Redis hdel failed, using fallback', { error: error.message });
      return await this.fallback.hdel(key, field);
    }
  }

  async expire(key, seconds) {
    try {
      return await this._getClient().expire(key, seconds);
    } catch (error) {
      logger.error('Redis expire failed, using fallback', { error: error.message });
      return await this.fallback.expire(key, seconds);
    }
  }

  async ttl(key) {
    try {
      return await this._getClient().ttl(key);
    } catch (error) {
      logger.error('Redis ttl failed, using fallback', { error: error.message });
      return await this.fallback.ttl(key);
    }
  }

  async keys(pattern) {
    try {
      return await this._getClient().keys(pattern);
    } catch (error) {
      logger.error('Redis keys failed, using fallback', { error: error.message });
      return await this.fallback.keys(pattern);
    }
  }

  async ping() {
    try {
      const client = this._getClient();
      if (client === this.fallback) {
        return 'PONG (in-memory)';
      }
      return await client.ping();
    } catch (error) {
      return 'PONG (fallback)';
    }
  }

  get status() {
    if (this.isRedisConnected && this.redisClient?.status === 'ready') {
      return 'ready';
    }
    return 'fallback';
  }

  disconnect() {
    if (this.redisClient) {
      this.redisClient.disconnect();
    }
    this.fallback.disconnect();
  }

  quit() {
    if (this.redisClient) {
      return this.redisClient.quit();
    }
    return this.fallback.quit();
  }
}

// Create resilient Redis client instance
const redis = new ResilientRedisClient();

/**
 * Check if Redis is connected
 * @returns {boolean}
 */
const isRedisConnected = () => {
  return redis.isRedisConnected;
};

/**
 * Get Redis client status
 * @returns {object}
 */
const getRedisStatus = () => ({
  connected: redis.isRedisConnected,
  type: redis.isRedisConnected ? 'redis' : 'in-memory-fallback',
  status: redis.status
});

module.exports = {
  redis,
  isRedisConnected,
  getRedisStatus,
  InMemoryFallback
};
