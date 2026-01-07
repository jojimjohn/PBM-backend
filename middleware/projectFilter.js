/**
 * Project Filter Middleware
 *
 * Loads user's assigned projects and injects project filtering capability
 * into the request object for downstream route handlers.
 *
 * Usage:
 * - Apply to routes that need project-based filtering
 * - Routes can check req.projectFilter for filtering data
 * - Admins can view all projects or select specific ones
 */

const { getDbConnection } = require('../config/database');
const { logger } = require('../utils/logger');

// Role hierarchy levels (matching frontend config)
const ADMIN_HIERARCHY_LEVEL = 5;

/**
 * Project filter middleware
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

    // Check if user_projects table exists
    const tableExists = await db.schema.hasTable('user_projects');
    if (!tableExists) {
      // Projects feature not enabled, bypass filtering
      req.projectFilter = {
        projectIds: null,
        selectedProjectId: null,
        canViewAll: true,
        isFiltered: false
      };
      return next();
    }

    // Get user's hierarchy level from role
    const hierarchyLevel = await getUserHierarchyLevel(db, userId);
    const canViewAll = hierarchyLevel >= ADMIN_HIERARCHY_LEVEL;

    // Check for project_id query parameter (explicit project selection)
    const selectedProjectId = req.query.project_id || req.query.projectId || null;

    // If "all" is selected and user is admin, don't filter
    if (selectedProjectId === 'all' && canViewAll) {
      req.projectFilter = {
        projectIds: null,
        selectedProjectId: null,
        canViewAll: true,
        isFiltered: false
      };
      return next();
    }

    // If specific project is selected, validate access and use it
    if (selectedProjectId && selectedProjectId !== 'all') {
      const projectId = parseInt(selectedProjectId, 10);

      if (canViewAll) {
        // Admin can view any project
        req.projectFilter = {
          projectIds: [projectId],
          selectedProjectId: projectId,
          canViewAll: true,
          isFiltered: true
        };
        return next();
      }

      // For non-admin, verify they have access to the selected project
      const hasAccess = await db('user_projects')
        .where({ user_id: userId, project_id: projectId })
        .first();

      if (!hasAccess) {
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
      return next();
    }

    // No specific project selected - load user's assigned projects
    if (canViewAll) {
      // Admin with no selection - show all
      req.projectFilter = {
        projectIds: null,
        selectedProjectId: null,
        canViewAll: true,
        isFiltered: false
      };
      return next();
    }

    // Non-admin: get assigned projects
    const userProjects = await db('user_projects')
      .select('project_id')
      .where('user_id', userId);

    const projectIds = userProjects.map(p => p.project_id);

    // If user has no projects assigned, they see nothing
    if (projectIds.length === 0) {
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

    next();
  } catch (error) {
    logger.error('Project filter middleware error', {
      error: error.message,
      userId: req.user?.userId,
      stack: error.stack
    });

    // On error, default to no filtering for admins, empty for others
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
 * Helper to get user's hierarchy level
 */
async function getUserHierarchyLevel(db, userId) {
  try {
    const user = await db('users')
      .select('role')
      .where('id', userId)
      .first();

    if (!user) return 0;

    // Map roles to hierarchy levels (matching frontend ROLE_HIERARCHY)
    const roleHierarchy = {
      'SUPER_ADMIN': 6,
      'COMPANY_ADMIN': 5,
      'MANAGER': 4,
      'SALES_STAFF': 3,
      'PURCHASE_STAFF': 3,
      'ACCOUNTS_STAFF': 3
    };

    return roleHierarchy[user.role] || 0;
  } catch (error) {
    logger.error('Error getting user hierarchy level', { error: error.message, userId });
    return 0;
  }
}

/**
 * Helper function to apply project filter to a Knex query builder
 *
 * @param {Knex.QueryBuilder} query - The Knex query builder
 * @param {Object} projectFilter - The req.projectFilter object
 * @param {string} projectColumn - The column name for project_id (default: 'project_id')
 * @returns {Knex.QueryBuilder} - Modified query with project filter applied
 */
const applyProjectFilter = (query, projectFilter, projectColumn = 'project_id') => {
  if (!projectFilter || !projectFilter.isFiltered) {
    return query;
  }

  if (projectFilter.projectIds === null) {
    // No filter - show all
    return query;
  }

  if (projectFilter.projectIds.length === 0) {
    // User has no projects - show nothing
    return query.whereRaw('1 = 0');
  }

  // Filter by allowed project IDs
  // Include records with NULL project_id OR matching project_id
  return query.where(function() {
    this.whereIn(projectColumn, projectFilter.projectIds)
      .orWhereNull(projectColumn);
  });
};

/**
 * Optional middleware for routes that should NOT filter null project_id records
 * (strict mode - only show records with explicit project assignment)
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

  // Strict mode: only matching project IDs, exclude NULLs
  return query.whereIn(projectColumn, projectFilter.projectIds);
};

module.exports = {
  projectFilter,
  applyProjectFilter,
  applyStrictProjectFilter
};
