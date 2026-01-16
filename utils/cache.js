/**
 * Cache Utility for PBM System
 *
 * PERFORMANCE: Provides Redis-based caching with local LRU fallback
 * Reduces database load by caching frequently accessed data
 *
 * Features:
 * - Redis primary cache with automatic failover to in-memory
 * - Configurable TTL per cache type
 * - Cache invalidation patterns
 * - Batch cache operations
 * - Cache statistics and monitoring
 */

const { redis, isRedisConnected } = require('../config/redis');
const { logger } = require('./logger');

// Cache configuration - TTL in seconds
const CACHE_CONFIG = {
  // Reference data - rarely changes
  materials: { ttl: 300, prefix: 'cache:materials' },        // 5 minutes
  categories: { ttl: 600, prefix: 'cache:categories' },      // 10 minutes
  suppliers: { ttl: 300, prefix: 'cache:suppliers' },        // 5 minutes
  customers: { ttl: 300, prefix: 'cache:customers' },        // 5 minutes

  // User/Auth data - short TTL for security
  userPermissions: { ttl: 60, prefix: 'cache:perms' },       // 1 minute
  tokenValidation: { ttl: 30, prefix: 'cache:token' },       // 30 seconds

  // Operational data - moderate TTL
  inventory: { ttl: 60, prefix: 'cache:inventory' },         // 1 minute
  inventorySummary: { ttl: 120, prefix: 'cache:inv-summary' }, // 2 minutes
  dashboardStats: { ttl: 60, prefix: 'cache:dashboard' },    // 1 minute

  // Query results - short TTL
  listQueries: { ttl: 30, prefix: 'cache:list' },            // 30 seconds
  countQueries: { ttl: 60, prefix: 'cache:count' },          // 1 minute

  // Default
  default: { ttl: 60, prefix: 'cache:default' }
};

// Local LRU cache for ultra-fast lookups (fallback + layer 1)
class LocalLRUCache {
  constructor(maxSize = 1000) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  get(key) {
    if (!this.cache.has(key)) return null;

    const item = this.cache.get(key);
    if (Date.now() > item.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    // Move to end (LRU)
    this.cache.delete(key);
    this.cache.set(key, item);

    return item.value;
  }

  set(key, value, ttlSeconds) {
    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }

    this.cache.set(key, {
      value,
      expiresAt: Date.now() + (ttlSeconds * 1000)
    });
  }

  delete(key) {
    this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
  }

  // Delete all keys matching a pattern (for invalidation)
  deletePattern(pattern) {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    let deleted = 0;
    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
        deleted++;
      }
    }
    return deleted;
  }

  get size() {
    return this.cache.size;
  }

  getStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      utilizationPercent: Math.round((this.cache.size / this.maxSize) * 100)
    };
  }
}

// Initialize local cache
const localCache = new LocalLRUCache(2000);

// Cache statistics
const stats = {
  hits: 0,
  misses: 0,
  localHits: 0,
  redisHits: 0,
  writes: 0,
  invalidations: 0
};

/**
 * Cache Service API
 */
const cacheService = {
  /**
   * Check if caching is enabled
   */
  isEnabled() {
    return process.env.CACHE_ENABLED !== 'false';
  },

  /**
   * Get a value from cache (local first, then Redis)
   * @param {string} type - Cache type from CACHE_CONFIG
   * @param {string} key - Cache key
   * @returns {Promise<any|null>}
   */
  async get(type, key) {
    if (!this.isEnabled()) return null;

    const config = CACHE_CONFIG[type] || CACHE_CONFIG.default;
    const fullKey = `${config.prefix}:${key}`;

    try {
      // Layer 1: Check local cache first (fastest)
      const localValue = localCache.get(fullKey);
      if (localValue !== null) {
        stats.hits++;
        stats.localHits++;
        return localValue;
      }

      // Layer 2: Check Redis
      if (isRedisConnected()) {
        const redisValue = await redis.get(fullKey);
        if (redisValue) {
          const parsed = JSON.parse(redisValue);
          // Backfill local cache
          localCache.set(fullKey, parsed, Math.min(config.ttl, 30));
          stats.hits++;
          stats.redisHits++;
          return parsed;
        }
      }

      stats.misses++;
      return null;
    } catch (error) {
      logger.error('Cache get error', { type, key, error: error.message });
      stats.misses++;
      return null;
    }
  },

  /**
   * Set a value in cache
   * @param {string} type - Cache type from CACHE_CONFIG
   * @param {string} key - Cache key
   * @param {any} value - Value to cache
   * @param {number} [customTtl] - Override TTL in seconds
   */
  async set(type, key, value, customTtl = null) {
    if (!this.isEnabled()) return;

    const config = CACHE_CONFIG[type] || CACHE_CONFIG.default;
    const fullKey = `${config.prefix}:${key}`;
    const ttl = customTtl || config.ttl;

    try {
      // Set in local cache
      localCache.set(fullKey, value, Math.min(ttl, 60));

      // Set in Redis
      if (isRedisConnected()) {
        await redis.setex(fullKey, ttl, JSON.stringify(value));
      }

      stats.writes++;
    } catch (error) {
      logger.error('Cache set error', { type, key, error: error.message });
    }
  },

  /**
   * Get or set pattern - fetch from cache or execute getter and cache result
   * @param {string} type - Cache type
   * @param {string} key - Cache key
   * @param {Function} getter - Async function to get data if not cached
   * @param {number} [customTtl] - Override TTL
   */
  async getOrSet(type, key, getter, customTtl = null) {
    // Try to get from cache
    const cached = await this.get(type, key);
    if (cached !== null) {
      return cached;
    }

    // Execute getter
    const value = await getter();

    // Cache the result (don't cache null/undefined)
    if (value !== null && value !== undefined) {
      await this.set(type, key, value, customTtl);
    }

    return value;
  },

  /**
   * Invalidate cache entry
   * @param {string} type - Cache type
   * @param {string} key - Cache key
   */
  async invalidate(type, key) {
    const config = CACHE_CONFIG[type] || CACHE_CONFIG.default;
    const fullKey = `${config.prefix}:${key}`;

    try {
      localCache.delete(fullKey);
      if (isRedisConnected()) {
        await redis.del(fullKey);
      }
      stats.invalidations++;
    } catch (error) {
      logger.error('Cache invalidate error', { type, key, error: error.message });
    }
  },

  /**
   * Invalidate all cache entries matching a pattern
   * @param {string} type - Cache type
   * @param {string} pattern - Pattern to match (e.g., "company:*")
   */
  async invalidatePattern(type, pattern) {
    const config = CACHE_CONFIG[type] || CACHE_CONFIG.default;
    const fullPattern = `${config.prefix}:${pattern}`;

    try {
      // Clear local cache
      const localDeleted = localCache.deletePattern(fullPattern);

      // Clear Redis
      let redisDeleted = 0;
      if (isRedisConnected()) {
        const keys = await redis.keys(fullPattern);
        if (keys.length > 0) {
          redisDeleted = await redis.del(...keys);
        }
      }

      stats.invalidations += localDeleted + redisDeleted;

      logger.debug('Cache pattern invalidated', {
        type,
        pattern,
        localDeleted,
        redisDeleted
      });
    } catch (error) {
      logger.error('Cache invalidatePattern error', { type, pattern, error: error.message });
    }
  },

  /**
   * Invalidate all cache for a company (useful after bulk operations)
   * @param {string} companyId - Company ID
   */
  async invalidateCompany(companyId) {
    const types = ['materials', 'inventory', 'inventorySummary', 'suppliers', 'customers'];
    for (const type of types) {
      await this.invalidatePattern(type, `${companyId}:*`);
    }
    logger.info('Company cache invalidated', { companyId });
  },

  /**
   * Get cache statistics
   */
  getStats() {
    const hitRate = stats.hits + stats.misses > 0
      ? Math.round((stats.hits / (stats.hits + stats.misses)) * 100)
      : 0;

    return {
      ...stats,
      hitRate: `${hitRate}%`,
      local: localCache.getStats(),
      redisConnected: isRedisConnected()
    };
  },

  /**
   * Clear all caches (use with caution)
   */
  async clearAll() {
    localCache.clear();
    if (isRedisConnected()) {
      const keys = await redis.keys('cache:*');
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    }
    logger.warn('All caches cleared');
  },

  /**
   * Batch get multiple keys
   * @param {string} type - Cache type
   * @param {string[]} keys - Array of keys
   */
  async batchGet(type, keys) {
    if (!this.isEnabled() || keys.length === 0) return {};

    const config = CACHE_CONFIG[type] || CACHE_CONFIG.default;
    const results = {};
    const missingKeys = [];

    // Check local cache first
    for (const key of keys) {
      const fullKey = `${config.prefix}:${key}`;
      const localValue = localCache.get(fullKey);
      if (localValue !== null) {
        results[key] = localValue;
        stats.hits++;
        stats.localHits++;
      } else {
        missingKeys.push(key);
      }
    }

    // Fetch missing from Redis
    if (missingKeys.length > 0 && isRedisConnected()) {
      try {
        const fullKeys = missingKeys.map(k => `${config.prefix}:${k}`);
        const redisValues = await Promise.all(
          fullKeys.map(k => redis.get(k))
        );

        missingKeys.forEach((key, i) => {
          if (redisValues[i]) {
            const parsed = JSON.parse(redisValues[i]);
            results[key] = parsed;
            // Backfill local cache
            localCache.set(`${config.prefix}:${key}`, parsed, Math.min(config.ttl, 30));
            stats.hits++;
            stats.redisHits++;
          } else {
            stats.misses++;
          }
        });
      } catch (error) {
        logger.error('Batch cache get error', { type, error: error.message });
        missingKeys.forEach(() => stats.misses++);
      }
    }

    return results;
  },

  /**
   * Batch set multiple key-value pairs
   * @param {string} type - Cache type
   * @param {Object} items - Object with key-value pairs
   */
  async batchSet(type, items) {
    if (!this.isEnabled() || Object.keys(items).length === 0) return;

    const config = CACHE_CONFIG[type] || CACHE_CONFIG.default;

    try {
      const entries = Object.entries(items);

      // Set in local cache
      for (const [key, value] of entries) {
        const fullKey = `${config.prefix}:${key}`;
        localCache.set(fullKey, value, Math.min(config.ttl, 60));
      }

      // Set in Redis using pipeline for efficiency
      if (isRedisConnected()) {
        for (const [key, value] of entries) {
          const fullKey = `${config.prefix}:${key}`;
          await redis.setex(fullKey, config.ttl, JSON.stringify(value));
        }
      }

      stats.writes += entries.length;
    } catch (error) {
      logger.error('Batch cache set error', { type, error: error.message });
    }
  }
};

/**
 * Cache middleware for Express routes
 * Usage: router.get('/endpoint', cacheMiddleware('materials', 'all'), handler)
 */
const cacheMiddleware = (type, keyGenerator) => {
  return async (req, res, next) => {
    if (!cacheService.isEnabled()) {
      return next();
    }

    // Generate cache key
    const key = typeof keyGenerator === 'function'
      ? keyGenerator(req)
      : `${req.user?.companyId || 'anon'}:${keyGenerator}`;

    // Try to get from cache
    const cached = await cacheService.get(type, key);
    if (cached !== null) {
      return res.json(cached);
    }

    // Store original json method
    const originalJson = res.json.bind(res);

    // Override json to cache the response
    res.json = async (data) => {
      // Only cache successful responses
      if (data && data.success !== false) {
        await cacheService.set(type, key, data);
      }
      return originalJson(data);
    };

    next();
  };
};

/**
 * Generate cache key from request
 */
const generateCacheKey = (req, ...parts) => {
  const companyId = req.user?.companyId || 'anon';
  const queryHash = Object.keys(req.query).length > 0
    ? Buffer.from(JSON.stringify(req.query)).toString('base64').slice(0, 20)
    : 'no-query';

  return [companyId, ...parts, queryHash].join(':');
};

module.exports = {
  cacheService,
  cacheMiddleware,
  generateCacheKey,
  CACHE_CONFIG
};
