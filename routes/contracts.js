const express = require('express');
const { validate, validateParams, sanitize } = require('../middleware/validation');
const { requirePermission } = require('../middleware/auth');
const { logger, auditLog } = require('../utils/logger');
const { getDbConnection } = require('../config/database');
const Joi = require('joi');

const router = express.Router();

// Apply sanitization to all routes
router.use(sanitize);

// Contract validation schema
const contractSchema = Joi.object({
  customerId: Joi.number().integer().positive().required(),
  contractNumber: Joi.string().max(100).required().trim(),
  title: Joi.string().max(200).required().trim(),
  startDate: Joi.date().required(),
  endDate: Joi.date().greater(Joi.ref('startDate')).required(),
  status: Joi.string().valid('draft', 'active', 'expired', 'terminated', 'renewed').default('draft'),
  totalValue: Joi.number().min(0).precision(2).optional(),
  currency: Joi.string().length(3).default('OMR'),
  terms: Joi.string().allow('').optional(),
  notes: Joi.string().allow('').optional(),
  createdBy: Joi.number().integer().positive().optional()
});

// Contract rate validation schema
const contractRateSchema = Joi.object({
  contractId: Joi.number().integer().positive().required(),
  materialId: Joi.number().integer().positive().required(),
  rateType: Joi.string().valid('fixed_rate', 'discount_percentage', 'minimum_price_guarantee').required(),
  contractRate: Joi.number().min(0).precision(3).required(),
  discountPercentage: Joi.number().min(0).max(100).precision(2).optional(),
  minimumPrice: Joi.number().min(0).precision(3).optional(),
  description: Joi.string().allow('').optional(),
  isActive: Joi.boolean().default(true)
});

// GET /api/contracts - List all contracts
router.get('/', requirePermission('VIEW_CONTRACTS'), async (req, res) => {
  try {
    const { companyId } = req.user;
    const db = getDbConnection(companyId);
    
    const { 
      page = 1, 
      limit = 50, 
      search = '', 
      status = '',
      customerId = ''
    } = req.query;

    const offset = (page - 1) * limit;
    
    let query = db('contracts')
      .leftJoin('customers', 'contracts.customerId', 'customers.id')
      .select(
        'contracts.*',
        'customers.name as customerName',
        'customers.customerType',
        'contracts.status'
      );

    // Search filter
    if (search) {
      query = query.where(function() {
        this.where('contracts.contractNumber', 'like', `%${search}%`)
            .orWhere('customers.name', 'like', `%${search}%`)
            .orWhere('contracts.terms', 'like', `%${search}%`);
      });
    }

    // Status filter
    if (status) {
      query = query.where('contracts.status', status);
    }

    // Customer filter
    if (customerId) {
      query = query.where('contracts.customerId', customerId);
    }

    // Status filter
    if (status) {
      switch(status) {
        case 'active':
          query = query.where('contracts.startDate', '<=', new Date())
                      .where('contracts.endDate', '>=', new Date())
                      .where('contracts.isActive', true);
          break;
        case 'expired':
          query = query.where('contracts.endDate', '<', new Date());
          break;
        case 'upcoming':
          query = query.where('contracts.startDate', '>', new Date())
                      .where('contracts.isActive', true);
          break;
      }
    }

    // Get total count for pagination
    const totalQuery = query.clone();
    const [{ total }] = await totalQuery.count('* as total');

    // Get paginated results
    const contracts = await query
      .orderBy('contracts.endDate', 'desc')
      .orderBy('contracts.startDate', 'desc')
      .limit(limit)
      .offset(offset);

    auditLog('CONTRACTS_VIEWED', req.user.userId, {
      companyId,
      count: contracts.length,
      filters: { search, status, customerId }
    });

    res.json({
      success: true,
      data: contracts,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(total),
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    logger.error('Error fetching contracts', { 
      error: error.message, 
      userId: req.user.userId,
      companyId: req.user.companyId
    });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch contracts'
    });
  }
});

// GET /api/contracts/:id - Get specific contract with rates
router.get('/:id', 
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  requirePermission('VIEW_CONTRACTS'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      // Get contract details
      const contract = await db('contracts')
        .leftJoin('customers', 'contracts.customerId', 'customers.id')
        .select(
          'contracts.*',
          'customers.name as customerName',
          'customers.customerType',
          'contracts.status'
        )
        .where('contracts.id', id)
        .first();

      if (!contract) {
        return res.status(404).json({
          success: false,
          error: 'Contract not found'
        });
      }

      // Get contract rates
      const rates = await db('contract_rates')
        .leftJoin('materials', 'contract_rates.materialId', 'materials.id')
        .select(
          'contract_rates.*',
          'materials.name as materialName',
          'materials.code as materialCode',
          'materials.standardPrice',
          'materials.unit'
        )
        .where('contract_rates.contractId', id)
        .where('contract_rates.isActive', true);

      auditLog('CONTRACT_VIEWED', req.user.userId, {
        contractId: id,
        contractNumber: contract.contractNumber,
        customerName: contract.customerName
      });

      res.json({
        success: true,
        data: {
          ...contract,
          rates
        }
      });

    } catch (error) {
      logger.error('Error fetching contract', { 
        error: error.message, 
        contractId: req.params.id,
        userId: req.user.userId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch contract'
      });
    }
  }
);

// POST /api/contracts - Create new contract
router.post('/', 
  validate(contractSchema),
  requirePermission('MANAGE_CONTRACTS'),
  async (req, res) => {
    try {
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      // Validate customer exists
      const customer = await db('customers')
        .where({ id: req.body.customerId, isActive: true })
        .first();

      if (!customer) {
        return res.status(400).json({
          success: false,
          error: 'Customer not found or inactive'
        });
      }

      // Check if contract number already exists
      const existingContract = await db('contracts')
        .where({ contractNumber: req.body.contractNumber })
        .first();

      if (existingContract) {
        return res.status(400).json({
          success: false,
          error: 'Contract with this number already exists'
        });
      }

      const contractData = {
        ...req.body,
        createdBy: req.user.userId,
        created_at: new Date(),
        updated_at: new Date()
      };

      const [contractId] = await db('contracts').insert(contractData);
      
      const newContract = await db('contracts')
        .leftJoin('customers', 'contracts.customerId', 'customers.id')
        .select(
          'contracts.*',
          'customers.name as customerName'
        )
        .where('contracts.id', contractId)
        .first();

      auditLog('CONTRACT_CREATED', req.user.userId, {
        contractId,
        contractNumber: newContract.contractNumber,
        customerName: newContract.customerName
      });

      logger.info('Contract created', {
        contractId,
        contractNumber: newContract.contractNumber,
        createdBy: req.user.userId
      });

      res.status(201).json({
        success: true,
        message: 'Contract created successfully',
        data: newContract
      });

    } catch (error) {
      logger.error('Error creating contract', { 
        error: error.message, 
        userId: req.user.userId,
        contractData: req.body
      });
      res.status(500).json({
        success: false,
        error: 'Failed to create contract'
      });
    }
  }
);

// POST /api/contracts/:id/rates - Add rate to contract
router.post('/:id/rates',
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  validate(contractRateSchema.fork('contractId', schema => schema.optional())),
  requirePermission('MANAGE_CONTRACTS'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      // Verify contract exists
      const contract = await db('contracts')
        .where({ id })
        .first();

      if (!contract) {
        return res.status(404).json({
          success: false,
          error: 'Contract not found or inactive'
        });
      }

      // Verify material exists
      const material = await db('materials')
        .where({ id: req.body.materialId, isActive: true })
        .first();

      if (!material) {
        return res.status(400).json({
          success: false,
          error: 'Material not found or inactive'
        });
      }

      // Check if rate already exists for this material in this contract
      const existingRate = await db('contract_rates')
        .where({ 
          contractId: id, 
          materialId: req.body.materialId,
          isActive: true
        })
        .first();

      if (existingRate) {
        return res.status(400).json({
          success: false,
          error: 'Rate already exists for this material in this contract'
        });
      }

      const rateData = {
        ...req.body,
        contractId: id,
        created_at: new Date(),
        updated_at: new Date()
      };

      const [rateId] = await db('contract_rates').insert(rateData);
      
      const newRate = await db('contract_rates')
        .leftJoin('materials', 'contract_rates.materialId', 'materials.id')
        .select(
          'contract_rates.*',
          'materials.name as materialName',
          'materials.code as materialCode'
        )
        .where('contract_rates.id', rateId)
        .first();

      auditLog('CONTRACT_RATE_CREATED', req.user.userId, {
        contractId: id,
        rateId,
        materialName: newRate.materialName,
        rateType: newRate.rateType,
        rate: newRate.contractRate
      });

      res.status(201).json({
        success: true,
        message: 'Contract rate added successfully',
        data: newRate
      });

    } catch (error) {
      logger.error('Error creating contract rate', { 
        error: error.message, 
        contractId: req.params.id,
        userId: req.user.userId,
        rateData: req.body
      });
      res.status(500).json({
        success: false,
        error: 'Failed to create contract rate'
      });
    }
  }
);

module.exports = router;