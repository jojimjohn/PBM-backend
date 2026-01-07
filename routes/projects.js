const express = require('express');
const router = express.Router();
const { getDbConnection } = require('../config/database');
const { requirePermission } = require('../middleware/auth');
const { validate } = require('../middleware/validation');
const { getRepositoryFactory } = require('../repositories/RepositoryFactory');
const Joi = require('joi');
const winston = require('winston');

// Validation schemas
const projectSchema = Joi.object({
  code: Joi.string().max(50).required()
    .pattern(/^[A-Z0-9_-]+$/)
    .messages({
      'string.pattern.base': 'Project code must contain only uppercase letters, numbers, underscores, and hyphens'
    }),
  name: Joi.string().max(200).required(),
  description: Joi.string().max(2000).allow(null, '').optional(),
  status: Joi.string().valid('active', 'closed', 'on_hold', 'pending').default('active'),
  start_date: Joi.date().iso().allow(null).optional(),
  end_date: Joi.date().iso().allow(null).optional()
    .when('start_date', {
      is: Joi.exist(),
      then: Joi.date().min(Joi.ref('start_date'))
    })
});

const updateProjectSchema = projectSchema.fork(['code'], (schema) => schema.optional());

const userAssignmentSchema = Joi.object({
  userId: Joi.number().integer().positive().required(),
  roleInProject: Joi.string().valid('lead', 'contributor', 'viewer').default('contributor')
});

const bulkAssignmentSchema = Joi.object({
  userIds: Joi.array().items(Joi.number().integer().positive()).min(1).required(),
  roleInProject: Joi.string().valid('lead', 'contributor', 'viewer').default('contributor')
});

const statusUpdateSchema = Joi.object({
  status: Joi.string().valid('active', 'closed', 'on_hold', 'pending').required()
});

// GET /projects - List all projects with filtering and pagination
router.get('/', requirePermission('VIEW_PROJECTS'), async (req, res) => {
  try {
    const repositoryFactory = getRepositoryFactory(req.user.companyId);
    const projectsRepository = repositoryFactory.getProjectsRepository();

    const filters = {
      status: req.query.status,
      code: req.query.code,
      name: req.query.name,
      search: req.query.search
    };

    const pagination = {
      page: req.query.page || 1,
      limit: req.query.limit || 50,
      orderBy: req.query.orderBy || 'created_at',
      orderDirection: req.query.orderDirection || 'desc'
    };

    const result = await projectsRepository.findAllWithDetails(filters, pagination);

    winston.info('Projects retrieved', {
      companyId: req.user.companyId,
      userId: req.user.userId,
      count: result.data.length
    });

    res.json({
      success: true,
      data: result.data,
      pagination: result.pagination
    });

  } catch (error) {
    winston.error('Error fetching projects', {
      error: error.message,
      companyId: req.user.companyId,
      userId: req.user.userId
    });

    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// GET /projects/statistics - Get project statistics
router.get('/statistics', requirePermission('VIEW_PROJECTS'), async (req, res) => {
  try {
    const repositoryFactory = getRepositoryFactory(req.user.companyId);
    const projectsRepository = repositoryFactory.getProjectsRepository();

    const stats = await projectsRepository.getStatistics();

    res.json({
      success: true,
      data: stats
    });

  } catch (error) {
    winston.error('Error fetching project statistics', {
      error: error.message,
      companyId: req.user.companyId
    });

    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// GET /projects/my-projects - Get projects for current user
router.get('/my-projects', async (req, res) => {
  try {
    const repositoryFactory = getRepositoryFactory(req.user.companyId);
    const projectsRepository = repositoryFactory.getProjectsRepository();

    const projects = await projectsRepository.getProjectsForUser(req.user.userId, {
      activeOnly: req.query.activeOnly !== 'false'
    });

    res.json({
      success: true,
      data: projects
    });

  } catch (error) {
    winston.error('Error fetching user projects', {
      error: error.message,
      companyId: req.user.companyId,
      userId: req.user.userId
    });

    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// GET /projects/:id - Get specific project with details
router.get('/:id', requirePermission('VIEW_PROJECTS'), async (req, res) => {
  try {
    const repositoryFactory = getRepositoryFactory(req.user.companyId);
    const projectsRepository = repositoryFactory.getProjectsRepository();

    const project = await projectsRepository.findByIdWithDetails(parseInt(req.params.id));

    if (!project) {
      return res.status(404).json({
        success: false,
        error: 'Project not found'
      });
    }

    res.json({
      success: true,
      data: project
    });

  } catch (error) {
    winston.error('Error fetching project', {
      error: error.message,
      projectId: req.params.id,
      companyId: req.user.companyId
    });

    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// POST /projects - Create new project
router.post('/', requirePermission('MANAGE_PROJECTS'), validate(projectSchema), async (req, res) => {
  try {
    const repositoryFactory = getRepositoryFactory(req.user.companyId);
    const projectsRepository = repositoryFactory.getProjectsRepository();

    // Check if code already exists
    const existing = await projectsRepository.findByCode(req.body.code);
    if (existing) {
      return res.status(400).json({
        success: false,
        error: 'A project with this code already exists'
      });
    }

    const project = await projectsRepository.create(req.body, req.user.userId);

    winston.info('Project created', {
      projectId: project.id,
      code: project.code,
      companyId: req.user.companyId,
      userId: req.user.userId
    });

    res.status(201).json({
      success: true,
      data: project,
      message: 'Project created successfully'
    });

  } catch (error) {
    winston.error('Error creating project', {
      error: error.message,
      companyId: req.user.companyId,
      userId: req.user.userId
    });

    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// PUT /projects/:id - Update project
router.put('/:id', requirePermission('MANAGE_PROJECTS'), validate(updateProjectSchema), async (req, res) => {
  try {
    const repositoryFactory = getRepositoryFactory(req.user.companyId);
    const projectsRepository = repositoryFactory.getProjectsRepository();
    const projectId = parseInt(req.params.id);

    // Check project exists
    const existing = await projectsRepository.findByIdWithDetails(projectId);
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Project not found'
      });
    }

    // If updating code, check it's unique
    if (req.body.code && req.body.code !== existing.code) {
      const codeExists = await projectsRepository.findByCode(req.body.code);
      if (codeExists) {
        return res.status(400).json({
          success: false,
          error: 'A project with this code already exists'
        });
      }
    }

    await projectsRepository.update(projectId, req.body, req.user.userId);

    const updated = await projectsRepository.findByIdWithDetails(projectId);

    winston.info('Project updated', {
      projectId,
      companyId: req.user.companyId,
      userId: req.user.userId
    });

    res.json({
      success: true,
      data: updated,
      message: 'Project updated successfully'
    });

  } catch (error) {
    winston.error('Error updating project', {
      error: error.message,
      projectId: req.params.id,
      companyId: req.user.companyId
    });

    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// PATCH /projects/:id/status - Update project status
router.patch('/:id/status', requirePermission('MANAGE_PROJECTS'), validate(statusUpdateSchema), async (req, res) => {
  try {
    const repositoryFactory = getRepositoryFactory(req.user.companyId);
    const projectsRepository = repositoryFactory.getProjectsRepository();
    const projectId = parseInt(req.params.id);

    const rowsAffected = await projectsRepository.updateStatus(projectId, req.body.status);

    if (rowsAffected === 0) {
      return res.status(404).json({
        success: false,
        error: 'Project not found'
      });
    }

    winston.info('Project status updated', {
      projectId,
      newStatus: req.body.status,
      companyId: req.user.companyId,
      userId: req.user.userId
    });

    res.json({
      success: true,
      message: `Project status updated to ${req.body.status}`
    });

  } catch (error) {
    winston.error('Error updating project status', {
      error: error.message,
      projectId: req.params.id,
      companyId: req.user.companyId
    });

    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// DELETE /projects/:id - Delete project (soft delete by setting status to 'closed')
router.delete('/:id', requirePermission('MANAGE_PROJECTS'), async (req, res) => {
  try {
    const repositoryFactory = getRepositoryFactory(req.user.companyId);
    const projectsRepository = repositoryFactory.getProjectsRepository();
    const projectId = parseInt(req.params.id);

    // Check if project exists
    const existing = await projectsRepository.findByIdWithDetails(projectId);
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Project not found'
      });
    }

    // Prevent deletion of GENERAL project
    if (existing.code === 'GENERAL') {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete the default General project'
      });
    }

    // Soft delete by setting status to closed
    await projectsRepository.updateStatus(projectId, 'closed');

    winston.info('Project deleted (closed)', {
      projectId,
      companyId: req.user.companyId,
      userId: req.user.userId
    });

    res.json({
      success: true,
      message: 'Project closed successfully'
    });

  } catch (error) {
    winston.error('Error deleting project', {
      error: error.message,
      projectId: req.params.id,
      companyId: req.user.companyId
    });

    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// ============================================
// User Assignment Endpoints
// ============================================

// GET /projects/:id/users - Get users assigned to a project
router.get('/:id/users', requirePermission('VIEW_PROJECTS'), async (req, res) => {
  try {
    const repositoryFactory = getRepositoryFactory(req.user.companyId);
    const projectsRepository = repositoryFactory.getProjectsRepository();

    const users = await projectsRepository.getUsersForProject(parseInt(req.params.id));

    res.json({
      success: true,
      data: users
    });

  } catch (error) {
    winston.error('Error fetching project users', {
      error: error.message,
      projectId: req.params.id,
      companyId: req.user.companyId
    });

    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// POST /projects/:id/users - Assign user to project
router.post('/:id/users', requirePermission('MANAGE_PROJECTS'), validate(userAssignmentSchema), async (req, res) => {
  try {
    const repositoryFactory = getRepositoryFactory(req.user.companyId);
    const projectsRepository = repositoryFactory.getProjectsRepository();
    const projectId = parseInt(req.params.id);

    // Verify project exists
    const project = await projectsRepository.findByIdWithDetails(projectId);
    if (!project) {
      return res.status(404).json({
        success: false,
        error: 'Project not found'
      });
    }

    // Verify user exists and belongs to same company
    const db = getDbConnection(req.user.companyId);
    const user = await db('users').where('id', req.body.userId).first();
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    const result = await projectsRepository.assignUser(
      projectId,
      req.body.userId,
      req.body.roleInProject || 'contributor',
      req.user.userId
    );

    winston.info('User assigned to project', {
      projectId,
      userId: req.body.userId,
      roleInProject: req.body.roleInProject,
      assignedBy: req.user.userId,
      action: result.created ? 'created' : 'updated'
    });

    res.status(result.created ? 201 : 200).json({
      success: true,
      data: result,
      message: result.created ? 'User assigned to project' : 'User assignment updated'
    });

  } catch (error) {
    winston.error('Error assigning user to project', {
      error: error.message,
      projectId: req.params.id,
      companyId: req.user.companyId
    });

    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// POST /projects/:id/users/bulk - Bulk assign users to project
router.post('/:id/users/bulk', requirePermission('MANAGE_PROJECTS'), validate(bulkAssignmentSchema), async (req, res) => {
  try {
    const repositoryFactory = getRepositoryFactory(req.user.companyId);
    const projectsRepository = repositoryFactory.getProjectsRepository();
    const projectId = parseInt(req.params.id);

    // Verify project exists
    const project = await projectsRepository.findByIdWithDetails(projectId);
    if (!project) {
      return res.status(404).json({
        success: false,
        error: 'Project not found'
      });
    }

    const result = await projectsRepository.bulkAssignUsers(
      projectId,
      req.body.userIds,
      req.body.roleInProject || 'contributor',
      req.user.userId
    );

    winston.info('Bulk user assignment to project', {
      projectId,
      assigned: result.assigned,
      updated: result.updated,
      assignedBy: req.user.userId
    });

    res.json({
      success: true,
      data: result,
      message: `${result.assigned} users assigned, ${result.updated} updated`
    });

  } catch (error) {
    winston.error('Error bulk assigning users to project', {
      error: error.message,
      projectId: req.params.id,
      companyId: req.user.companyId
    });

    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// DELETE /projects/:id/users/:userId - Remove user from project
router.delete('/:id/users/:userId', requirePermission('MANAGE_PROJECTS'), async (req, res) => {
  try {
    const repositoryFactory = getRepositoryFactory(req.user.companyId);
    const projectsRepository = repositoryFactory.getProjectsRepository();
    const projectId = parseInt(req.params.id);
    const userId = parseInt(req.params.userId);

    // Prevent removing user from GENERAL project
    const project = await projectsRepository.findByIdWithDetails(projectId);
    if (project && project.code === 'GENERAL') {
      return res.status(400).json({
        success: false,
        error: 'Cannot remove users from the default General project'
      });
    }

    const result = await projectsRepository.removeUserAssignment(projectId, userId);

    if (!result.removed) {
      return res.status(404).json({
        success: false,
        error: 'User assignment not found'
      });
    }

    winston.info('User removed from project', {
      projectId,
      userId,
      removedBy: req.user.userId
    });

    res.json({
      success: true,
      message: 'User removed from project'
    });

  } catch (error) {
    winston.error('Error removing user from project', {
      error: error.message,
      projectId: req.params.id,
      userId: req.params.userId,
      companyId: req.user.companyId
    });

    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// GET /projects/:id/check-access/:userId - Check if user has access to project
router.get('/:id/check-access/:userId', async (req, res) => {
  try {
    const repositoryFactory = getRepositoryFactory(req.user.companyId);
    const projectsRepository = repositoryFactory.getProjectsRepository();

    const hasAccess = await projectsRepository.hasUserAccess(
      parseInt(req.params.id),
      parseInt(req.params.userId)
    );

    const role = hasAccess
      ? await projectsRepository.getUserRole(parseInt(req.params.id), parseInt(req.params.userId))
      : null;

    res.json({
      success: true,
      data: {
        hasAccess,
        role
      }
    });

  } catch (error) {
    winston.error('Error checking project access', {
      error: error.message,
      projectId: req.params.id,
      userId: req.params.userId
    });

    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

module.exports = router;
