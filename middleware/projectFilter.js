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

// Role hierarchy levels - Admins (Company Admin: 9, Super Admin: 10) can view all projects
// Managers (5) and below are restricted to assigned projects
const ADMIN_HIERARCHY_LEVEL = 9;

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

    // Debug logging
    logger.info('ProjectFilter middleware - Input:', {
      userId,
      role,
      queryProjectId: req.query.project_id,
      path: req.path
    });

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
      logger.info('ProjectFilter - Admin selected ALL:', { projectFilter: req.projectFilter });
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
        logger.info('ProjectFilter - Admin selected specific project:', { projectFilter: req.projectFilter });
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
      logger.info('ProjectFilter - Non-admin selected specific project:', { projectFilter: req.projectFilter });
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
      logger.info('ProjectFilter - Admin with no selection:', { projectFilter: req.projectFilter });
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

    // Debug logging - final result
    logger.info('ProjectFilter middleware - Result:', {
      projectFilter: req.projectFilter,
      userId
    });

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
 * Helper to get user's hierarchy level from roles table
 */
async function getUserHierarchyLevel(db, userId) {
  try {
    // Look up user's role_id and get hierarchy_level from roles table
    const userWithRole = await db('users')
      .leftJoin('roles', 'users.role_id', 'roles.id')
      .select('roles.hierarchy_level', 'roles.name as roleName')
      .where('users.id', userId)
      .first();

    if (!userWithRole || !userWithRole.hierarchy_level) {
      // Fallback: try legacy role column mapping
      const user = await db('users')
        .select('role')
        .where('id', userId)
        .first();

      if (!user) return 0;

      // Legacy mapping for backwards compatibility
      const roleHierarchy = {
        'super-admin': 10,
        'company-admin': 9,
        'manager': 5,
        'sales-staff': 3,
        'purchase-staff': 3,
        'accounts-staff': 3,
        // Also support screaming snake case (old format)
        'SUPER_ADMIN': 10,
        'COMPANY_ADMIN': 9,
        'MANAGER': 5,
        'SALES_STAFF': 3,
        'PURCHASE_STAFF': 3,
        'ACCOUNTS_STAFF': 3
      };

      return roleHierarchy[user.role] || 0;
    }

    return userWithRole.hierarchy_level;
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
 *
 * Behavior:
 * - When a SPECIFIC project is selected: show ONLY records with that project_id (strict mode)
 * - When NO project is selected (viewing all): include records with NULL project_id
 * - This ensures new projects don't show unrelated data
 */
const applyProjectFilter = (query, projectFilter, projectColumn = 'project_id') => {
  // Debug logging - using info level to ensure visibility
  logger.info('applyProjectFilter called:', {
    isFiltered: projectFilter?.isFiltered,
    projectIds: projectFilter?.projectIds,
    selectedProjectId: projectFilter?.selectedProjectId,
    column: projectColumn
  });

  if (!projectFilter || !projectFilter.isFiltered) {
    logger.info('applyProjectFilter - NOT filtering (isFiltered=false or no filter)');
    return query;
  }

  if (projectFilter.projectIds === null) {
    // No filter - show all
    logger.info('applyProjectFilter - NOT filtering (projectIds=null)');
    return query;
  }

  if (projectFilter.projectIds.length === 0) {
    // User has no projects - show nothing
    logger.info('applyProjectFilter - User has no projects, returning EMPTY');
    return query.whereRaw('1 = 0');
  }

  // When a SPECIFIC project is selected, use strict filtering (exclude NULLs)
  // This ensures new projects don't show data from other projects
  if (projectFilter.selectedProjectId) {
    // Strict mode: only matching project_id, no NULLs
    logger.info('applyProjectFilter - Applying STRICT filter:', {
      column: projectColumn,
      projectIds: projectFilter.projectIds
    });
    return query.whereIn(projectColumn, projectFilter.projectIds);
  }

  // When viewing multiple projects (no specific selection), include NULLs
  // This helps users see "unassigned" records that need project assignment
  logger.info('applyProjectFilter - Applying inclusive filter with NULLs');
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
