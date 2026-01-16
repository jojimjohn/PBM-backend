/**
 * Project Filter Middleware - OPTIMIZED (Jan 2026)
 *
 * PERFORMANCE FIXES:
 * 1. Schema check cached at startup (not on every request)
 * 2. User permissions cached in Redis (hierarchy level + project IDs)
 * 3. JWT claims used when available (no DB lookup needed)
 * 4. All debug logging changed from INFO to DEBUG
 * 5. Cache invalidation on user/role changes
 *
 * Usage:
 * - Apply to routes that need project-based filtering
 * - Routes can check req.projectFilter for filtering data
 * - Admins can view all projects or select specific ones
 */

const { getDbConnection } = require('../config/database');
const { redis, isRedisConnected } = require('../config/redis');
const { logger } = require('../utils/logger');

// Role hierarchy levels - Admins (Company Admin: 9, Super Admin: 10) can view all projects
const ADMIN_HIERARCHY_LEVEL = 9;

// Cache configuration
const PERMISSION_CACHE_PREFIX = 'user:permissions:';
const PERMISSION_CACHE_TTL = 300; // 5 minutes
const SCHEMA_CACHE_PREFIX = 'schema:user_projects:';
const SCHEMA_CACHE_TTL = 3600; // 1 hour (schema rarely changes)

// In-memory cache for schema checks (doesn't need Redis - same across all requests)
const schemaCache = new Map();

// Legacy role hierarchy mapping (for systems without roles table)
const LEGACY_ROLE_HIERARCHY = {
  'super-admin': 10,
  'company-admin': 9,
  'manager': 5,
  'sales-staff': 3,
  'purchase-staff': 3,
  'accounts-staff': 3,
  'SUPER_ADMIN': 10,
  'COMPANY_ADMIN': 9,
  'MANAGER': 5,
  'SALES_STAFF': 3,
  'PURCHASE_STAFF': 3,
  'ACCOUNTS_STAFF': 3
};

/**
 * Check if user_projects table exists (cached)
 * Schema doesn't change at runtime, so we cache indefinitely in memory
 */
async function checkSchemaExists(db, companyId) {
  const cacheKey = `schema:${companyId}`;

  // Check in-memory cache first (fastest)
  if (schemaCache.has(cacheKey)) {
    return schemaCache.get(cacheKey);
  }

  // Check Redis cache (for multi-process environments)
  if (isRedisConnected()) {
    try {
      const cached = await redis.get(`${SCHEMA_CACHE_PREFIX}${companyId}`);
      if (cached !== null) {
        const exists = cached === 'true';
        schemaCache.set(cacheKey, exists);
        return exists;
      }
    } catch (e) {
      logger.debug('Redis schema cache miss', { companyId });
    }
  }

  // Query database (only once per company per server lifetime)
  const exists = await db.schema.hasTable('user_projects');

  // Cache in memory
  schemaCache.set(cacheKey, exists);

  // Cache in Redis for other processes
  if (isRedisConnected()) {
    try {
      await redis.setex(`${SCHEMA_CACHE_PREFIX}${companyId}`, SCHEMA_CACHE_TTL, exists.toString());
    } catch (e) {
      logger.debug('Failed to cache schema in Redis', { companyId });
    }
  }

  logger.debug('Schema check performed (will be cached)', { companyId, exists });
  return exists;
}

/**
 * Get user permissions from cache or database
 * Returns: { hierarchyLevel, canViewAll, projectIds }
 */
async function getUserPermissions(db, userId, companyId, jwtClaims = {}) {
  const cacheKey = `${PERMISSION_CACHE_PREFIX}${companyId}:${userId}`;

  // 1. Try JWT claims first (already validated, no network call needed)
  if (jwtClaims.hierarchyLevel !== undefined) {
    const hierarchyLevel = jwtClaims.hierarchyLevel;
    const canViewAll = hierarchyLevel >= ADMIN_HIERARCHY_LEVEL;

    // For admins, we don't need project IDs
    if (canViewAll) {
      return { hierarchyLevel, canViewAll, projectIds: null };
    }

    // For non-admins, we still need project IDs from cache/DB
    // But at least we saved the hierarchy lookup
  }

  // 2. Try Redis cache
  if (isRedisConnected()) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        const permissions = JSON.parse(cached);
        logger.debug('User permissions from cache', { userId, companyId });
        return permissions;
      }
    } catch (e) {
      logger.debug('Redis permission cache miss', { userId, companyId });
    }
  }

  // 3. Fetch from database
  const permissions = await fetchUserPermissionsFromDB(db, userId);

  // 4. Cache in Redis
  if (isRedisConnected()) {
    try {
      await redis.setex(cacheKey, PERMISSION_CACHE_TTL, JSON.stringify(permissions));
      logger.debug('Cached user permissions in Redis', { userId, companyId, ttl: PERMISSION_CACHE_TTL });
    } catch (e) {
      logger.debug('Failed to cache permissions in Redis', { userId, companyId });
    }
  }

  return permissions;
}

/**
 * Fetch user permissions from database (called only on cache miss)
 */
async function fetchUserPermissionsFromDB(db, userId) {
  // Get hierarchy level
  let hierarchyLevel = 0;

  try {
    // Try roles table first
    const userWithRole = await db('users')
      .leftJoin('roles', 'users.role_id', 'roles.id')
      .select('roles.hierarchy_level', 'users.role')
      .where('users.id', userId)
      .first();

    if (userWithRole?.hierarchy_level) {
      hierarchyLevel = userWithRole.hierarchy_level;
    } else if (userWithRole?.role) {
      // Fallback to legacy role mapping
      hierarchyLevel = LEGACY_ROLE_HIERARCHY[userWithRole.role] || 0;
    }
  } catch (error) {
    logger.warn('Error fetching user hierarchy', { userId, error: error.message });
  }

  const canViewAll = hierarchyLevel >= ADMIN_HIERARCHY_LEVEL;

  // Admins don't need project IDs
  if (canViewAll) {
    return { hierarchyLevel, canViewAll, projectIds: null };
  }

  // Get user's assigned projects
  let projectIds = [];
  try {
    const userProjects = await db('user_projects')
      .select('project_id')
      .where('user_id', userId);
    projectIds = userProjects.map(p => p.project_id);
  } catch (error) {
    logger.warn('Error fetching user projects', { userId, error: error.message });
  }

  return { hierarchyLevel, canViewAll, projectIds };
}

/**
 * Clear permission cache for a user (call when user's role or projects change)
 */
async function clearUserPermissionCache(userId, companyId) {
  if (!isRedisConnected()) return;

  const cacheKey = `${PERMISSION_CACHE_PREFIX}${companyId}:${userId}`;
  try {
    await redis.del(cacheKey);
    logger.debug('Cleared user permission cache', { userId, companyId });
  } catch (e) {
    logger.warn('Failed to clear permission cache', { userId, companyId, error: e.message });
  }
}

/**
 * Clear all permission caches for a company (call on role changes)
 */
async function clearCompanyPermissionCache(companyId) {
  if (!isRedisConnected()) return;

  try {
    const pattern = `${PERMISSION_CACHE_PREFIX}${companyId}:*`;
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
      logger.debug('Cleared company permission caches', { companyId, count: keys.length });
    }
  } catch (e) {
    logger.warn('Failed to clear company permission cache', { companyId, error: e.message });
  }
}

/**
 * Project filter middleware - OPTIMIZED
 *
 * Injects project filtering info into req.projectFilter:
 * - projectIds: Array of project IDs user can access (null = all projects)
 * - selectedProjectId: Specific project selected via query param (if any)
 * - canViewAll: Boolean indicating if user can view all projects
 * - isFiltered: Boolean indicating if filtering should be applied
 */
const projectFilter = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const { userId, companyId, role } = req.user;
    const db = getDbConnection(companyId);

    // Debug logging (changed from INFO to DEBUG)
    logger.debug('ProjectFilter middleware - Input:', {
      userId,
      role,
      queryProjectId: req.query.project_id,
      path: req.path
    });

    // OPTIMIZATION: Check schema from cache (not DB on every request)
    const tableExists = await checkSchemaExists(db, companyId);
    if (!tableExists) {
      req.projectFilter = {
        projectIds: null,
        selectedProjectId: null,
        canViewAll: true,
        isFiltered: false
      };
      return next();
    }

    // OPTIMIZATION: Get permissions from cache (not DB on every request)
    const permissions = await getUserPermissions(db, userId, companyId, req.user);
    const { canViewAll, projectIds } = permissions;

    // Check for project_id query parameter
    const selectedProjectId = req.query.project_id || req.query.projectId || null;

    // If "all" is selected and user is admin, don't filter
    if (selectedProjectId === 'all' && canViewAll) {
      req.projectFilter = {
        projectIds: null,
        selectedProjectId: null,
        canViewAll: true,
        isFiltered: false
      };
      logger.debug('ProjectFilter - Admin selected ALL');
      return next();
    }

    // If specific project is selected, validate and use it
    if (selectedProjectId && selectedProjectId !== 'all') {
      const projectId = parseInt(selectedProjectId, 10);

      if (canViewAll) {
        req.projectFilter = {
          projectIds: [projectId],
          selectedProjectId: projectId,
          canViewAll: true,
          isFiltered: true
        };
        logger.debug('ProjectFilter - Admin selected specific project', { projectId });
        return next();
      }

      // For non-admin, verify they have access
      if (!projectIds || !projectIds.includes(projectId)) {
        return res.status(403).json({
          success: false,
          error: 'Access to selected project denied'
        });
      }

      req.projectFilter = {
        projectIds: [projectId],
        selectedProjectId: projectId,
        canViewAll: false,
        isFiltered: true
      };
      logger.debug('ProjectFilter - Non-admin selected specific project', { projectId });
      return next();
    }

    // No specific project selected
    if (canViewAll) {
      req.projectFilter = {
        projectIds: null,
        selectedProjectId: null,
        canViewAll: true,
        isFiltered: false
      };
      logger.debug('ProjectFilter - Admin with no selection');
      return next();
    }

    // Non-admin: use cached project IDs
    if (!projectIds || projectIds.length === 0) {
      req.projectFilter = {
        projectIds: [],
        selectedProjectId: null,
        canViewAll: false,
        isFiltered: true
      };
      return next();
    }

    req.projectFilter = {
      projectIds,
      selectedProjectId: null,
      canViewAll: false,
      isFiltered: true
    };

    logger.debug('ProjectFilter middleware - Result:', {
      projectIdsCount: projectIds.length,
      canViewAll,
      isFiltered: true
    });

    next();
  } catch (error) {
    logger.error('Project filter middleware error', {
      error: error.message,
      userId: req.user?.userId,
      stack: error.stack
    });

    // On error, default to no filtering
    req.projectFilter = {
      projectIds: null,
      selectedProjectId: null,
      canViewAll: false,
      isFiltered: false
    };
    next();
  }
};

/**
 * Helper function to apply project filter to a Knex query builder
 */
const applyProjectFilter = (query, projectFilter, projectColumn = 'project_id') => {
  // Debug logging (changed from INFO to DEBUG)
  logger.debug('applyProjectFilter called:', {
    isFiltered: projectFilter?.isFiltered,
    projectIdsCount: projectFilter?.projectIds?.length,
    selectedProjectId: projectFilter?.selectedProjectId
  });

  if (!projectFilter || !projectFilter.isFiltered) {
    return query;
  }

  if (projectFilter.projectIds === null) {
    return query;
  }

  if (projectFilter.projectIds.length === 0) {
    logger.debug('applyProjectFilter - User has no projects, returning empty');
    return query.whereRaw('1 = 0');
  }

  // Strict mode when specific project selected
  if (projectFilter.selectedProjectId) {
    logger.debug('applyProjectFilter - Applying strict filter');
    return query.whereIn(projectColumn, projectFilter.projectIds);
  }

  // Include NULLs when viewing all user's projects
  logger.debug('applyProjectFilter - Applying inclusive filter with NULLs');
  return query.where(function() {
    this.whereIn(projectColumn, projectFilter.projectIds)
      .orWhereNull(projectColumn);
  });
};

/**
 * Strict project filter (excludes NULL project_id records)
 */
const applyStrictProjectFilter = (query, projectFilter, projectColumn = 'project_id') => {
  if (!projectFilter || !projectFilter.isFiltered) {
    return query;
  }

  if (projectFilter.projectIds === null) {
    return query;
  }

  if (projectFilter.projectIds.length === 0) {
    return query.whereRaw('1 = 0');
  }

  return query.whereIn(projectColumn, projectFilter.projectIds);
};

module.exports = {
  projectFilter,
  applyProjectFilter,
  applyStrictProjectFilter,
  clearUserPermissionCache,
  clearCompanyPermissionCache,
  // Export for testing
  checkSchemaExists,
  getUserPermissions
};
