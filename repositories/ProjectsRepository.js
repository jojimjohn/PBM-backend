const BaseRepository = require('./BaseRepository');

/**
 * Projects Repository
 * Handles project-specific database operations including user assignments
 *
 * Projects enable multi-project access control where users can be assigned
 * to specific projects and all transactions filtered by project.
 */
class ProjectsRepository extends BaseRepository {
  constructor(companyId) {
    super('projects', companyId);
  }

  /**
   * Find all projects with creator details and user count
   * @param {Object} filters - Filter criteria
   * @param {Object} pagination - Pagination options
   */
  async findAllWithDetails(filters = {}, pagination = {}) {
    try {
      const { page = 1, limit = 50, orderBy = 'created_at', orderDirection = 'desc' } = pagination;
      const offset = (page - 1) * limit;

      let query = this.db(this.tableName)
        .select(
          'projects.*',
          'users.firstName as creatorFirstName',
          'users.lastName as creatorLastName',
          this.db.raw('(SELECT COUNT(*) FROM user_projects WHERE user_projects.project_id = projects.id) as userCount')
        )
        .leftJoin('users', 'projects.created_by', 'users.id')
        .where('projects.company_id', this.companyId);

      // Apply filters
      if (filters.status) {
        query = query.where('projects.status', filters.status);
      }
      if (filters.code) {
        query = query.where('projects.code', 'like', `%${filters.code}%`);
      }
      if (filters.name) {
        query = query.where('projects.name', 'like', `%${filters.name}%`);
      }
      if (filters.search) {
        query = query.where(function() {
          this.where('projects.code', 'like', `%${filters.search}%`)
            .orWhere('projects.name', 'like', `%${filters.search}%`);
        });
      }

      // Get total count
      const countQuery = this.db(this.tableName)
        .where('company_id', this.companyId);

      if (filters.status) {
        countQuery.where('status', filters.status);
      }

      const [{ count }] = await countQuery.count('id as count');

      // Get paginated results
      const projects = await query
        .orderBy(`projects.${orderBy}`, orderDirection)
        .limit(limit)
        .offset(offset);

      return {
        data: projects,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: count,
          pages: Math.ceil(count / limit)
        }
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Find project by ID with full details
   * @param {number} id - Project ID
   */
  async findByIdWithDetails(id) {
    try {
      const project = await this.db(this.tableName)
        .select(
          'projects.*',
          'users.firstName as creatorFirstName',
          'users.lastName as creatorLastName'
        )
        .leftJoin('users', 'projects.created_by', 'users.id')
        .where('projects.id', id)
        .where('projects.company_id', this.companyId)
        .first();

      if (!project) {
        return null;
      }

      // Get assigned users
      const assignedUsers = await this.getUsersForProject(id);
      project.assignedUsers = assignedUsers;

      return project;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Find project by code (unique within company)
   * @param {string} code - Project code
   */
  async findByCode(code) {
    try {
      return await this.db(this.tableName)
        .where({
          company_id: this.companyId,
          code: code
        })
        .first();
    } catch (error) {
      throw error;
    }
  }

  /**
   * Create project with company ID
   * @param {Object} data - Project data
   * @param {number} userId - Creating user ID
   */
  async create(data, userId) {
    try {
      const projectData = {
        ...data,
        company_id: this.companyId,
        created_by: userId,
        created_at: new Date(),
        updated_at: new Date()
      };

      const [id] = await this.db(this.tableName).insert(projectData);

      return { id, ...projectData };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get all projects for a specific user
   * @param {number} userId - User ID
   * @param {Object} options - Query options
   */
  async getProjectsForUser(userId, options = {}) {
    try {
      let query = this.db(this.tableName)
        .select(
          'projects.*',
          'user_projects.role_in_project',
          'user_projects.assigned_at'
        )
        .innerJoin('user_projects', 'projects.id', 'user_projects.project_id')
        .where('user_projects.user_id', userId)
        .where('projects.company_id', this.companyId);

      // Filter by status if specified
      if (options.status) {
        query = query.where('projects.status', options.status);
      }

      // Only active projects by default
      if (options.activeOnly !== false) {
        query = query.where('projects.status', 'active');
      }

      return await query.orderBy('projects.name', 'asc');
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get all users assigned to a project
   * @param {number} projectId - Project ID
   */
  async getUsersForProject(projectId) {
    try {
      return await this.db('user_projects')
        .select(
          'users.id',
          'users.firstName',
          'users.lastName',
          'users.email',
          'users.role',
          'user_projects.role_in_project',
          'user_projects.assigned_at',
          'assigner.firstName as assignerFirstName',
          'assigner.lastName as assignerLastName'
        )
        .innerJoin('users', 'user_projects.user_id', 'users.id')
        .leftJoin('users as assigner', 'user_projects.assigned_by', 'assigner.id')
        .where('user_projects.project_id', projectId)
        .orderBy('users.firstName', 'asc');
    } catch (error) {
      throw error;
    }
  }

  /**
   * Assign a user to a project
   * @param {number} projectId - Project ID
   * @param {number} userId - User ID to assign
   * @param {string} roleInProject - Role in project (lead, contributor, viewer)
   * @param {number} assignedBy - User ID who is assigning
   */
  async assignUser(projectId, userId, roleInProject = 'contributor', assignedBy) {
    try {
      // Check if already assigned
      const existing = await this.db('user_projects')
        .where({
          project_id: projectId,
          user_id: userId
        })
        .first();

      if (existing) {
        // Update role if already assigned
        await this.db('user_projects')
          .where({
            project_id: projectId,
            user_id: userId
          })
          .update({
            role_in_project: roleInProject,
            assigned_by: assignedBy,
            assigned_at: new Date()
          });

        return { updated: true, projectId, userId, roleInProject };
      }

      // Insert new assignment
      await this.db('user_projects').insert({
        project_id: projectId,
        user_id: userId,
        role_in_project: roleInProject,
        assigned_by: assignedBy,
        assigned_at: new Date()
      });

      return { created: true, projectId, userId, roleInProject };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Remove user from project
   * @param {number} projectId - Project ID
   * @param {number} userId - User ID to remove
   */
  async removeUserAssignment(projectId, userId) {
    try {
      const deleted = await this.db('user_projects')
        .where({
          project_id: projectId,
          user_id: userId
        })
        .delete();

      return { removed: deleted > 0, projectId, userId };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Bulk assign users to a project
   * @param {number} projectId - Project ID
   * @param {Array} userIds - Array of user IDs
   * @param {string} roleInProject - Role for all users
   * @param {number} assignedBy - Assigning user ID
   */
  async bulkAssignUsers(projectId, userIds, roleInProject = 'contributor', assignedBy) {
    try {
      const results = [];

      for (const userId of userIds) {
        const result = await this.assignUser(projectId, userId, roleInProject, assignedBy);
        results.push(result);
      }

      return {
        projectId,
        assigned: results.filter(r => r.created).length,
        updated: results.filter(r => r.updated).length,
        total: results.length
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Check if user has access to a project
   * @param {number} projectId - Project ID
   * @param {number} userId - User ID
   */
  async hasUserAccess(projectId, userId) {
    try {
      const assignment = await this.db('user_projects')
        .where({
          project_id: projectId,
          user_id: userId
        })
        .first();

      return !!assignment;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get user's role in a project
   * @param {number} projectId - Project ID
   * @param {number} userId - User ID
   */
  async getUserRole(projectId, userId) {
    try {
      const assignment = await this.db('user_projects')
        .select('role_in_project')
        .where({
          project_id: projectId,
          user_id: userId
        })
        .first();

      return assignment ? assignment.role_in_project : null;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Update project status
   * @param {number} id - Project ID
   * @param {string} status - New status
   */
  async updateStatus(id, status) {
    try {
      return await this.db(this.tableName)
        .where('id', id)
        .where('company_id', this.companyId)
        .update({
          status,
          updated_at: new Date()
        });
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get project statistics
   */
  async getStatistics() {
    try {
      const stats = await this.db(this.tableName)
        .select('status')
        .count('* as count')
        .where('company_id', this.companyId)
        .groupBy('status');

      const total = stats.reduce((sum, s) => sum + parseInt(s.count), 0);

      return {
        total,
        byStatus: stats.reduce((acc, s) => {
          acc[s.status] = parseInt(s.count);
          return acc;
        }, {})
      };
    } catch (error) {
      throw error;
    }
  }
}

module.exports = ProjectsRepository;
