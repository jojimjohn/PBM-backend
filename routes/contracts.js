const express = require('express');
const { validate, validateParams, sanitize } = require('../middleware/validation');
const { requirePermission } = require('../middleware/auth');
const { logger, auditLog } = require('../utils/logger');
const { getDbConnection } = require('../config/database');
const Joi = require('joi');

const router = express.Router();

// Apply sanitization to all routes
router.use(sanitize);

// Contract validation schema - Supplier-based contracts
const contractSchema = Joi.object({
  contractNumber: Joi.string().max(100).required().trim(),
  contractRef: Joi.string().max(100).allow('').optional().trim(),
  supplierId: Joi.number().integer().positive().required(),
  supplierName: Joi.string().max(200).required().trim(),
  contractTitle: Joi.string().max(200).required().trim(),
  contractType: Joi.string().valid('waste_management', 'oil_supply', 'scrap_collection', 'material_supply').required(),
  startDate: Joi.date().required(),
  endDate: Joi.date().greater(Joi.ref('startDate')).required(),
  status: Joi.string().valid('active', 'expired', 'pending', 'cancelled').default('active'),
  paymentTerms: Joi.string().allow('').optional(),
  specialTerms: Joi.string().allow('').optional(),
  totalValue: Joi.number().min(0).precision(2).optional(),
  currency: Joi.string().length(3).default('OMR'),
  locations: Joi.array().items(Joi.object({
    id: Joi.string().optional(),
    locationName: Joi.string().required(),
    locationCode: Joi.string().required(),
    address: Joi.string().required(),
    contactPerson: Joi.string().required(),
    contactPhone: Joi.string().required(),
    materials: Joi.array().items(Joi.object({
      materialId: Joi.string().required(),
      materialName: Joi.string().required(),
      materialType: Joi.string().required(),
      unit: Joi.string().required(),
      rate: Joi.number().min(0).required(),
      currency: Joi.string().length(3).default('OMR'),
      minimumQuantity: Joi.number().min(0).default(0),
      maximumQuantity: Joi.number().min(0).default(0)
    })).min(1)
  })).min(1).required(),
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
      supplierId = ''
    } = req.query;

    const offset = (page - 1) * limit;
    
    let query = db('contracts')
      .leftJoin('suppliers', 'contracts.supplierId', 'suppliers.id')
      .select(
        'contracts.*',
        'suppliers.name as supplierName',
        'suppliers.type as supplierBusinessType',
        'contracts.status'
      );

    // Search filter
    if (search) {
      query = query.where(function() {
        this.where('contracts.contractNumber', 'like', `%${search}%`)
            .orWhere('contracts.contractRef', 'like', `%${search}%`)
            .orWhere('suppliers.name', 'like', `%${search}%`)
            .orWhere('contracts.contractTitle', 'like', `%${search}%`)
            .orWhere('contracts.specialTerms', 'like', `%${search}%`);
      });
    }

    // Status filter
    if (status) {
      query = query.where('contracts.status', status);
    }

    // Supplier filter
    if (supplierId) {
      query = query.where('contracts.supplierId', supplierId);
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
      filters: { search, status, supplierId }
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
        .leftJoin('suppliers', 'contracts.supplierId', 'suppliers.id')
        .select(
          'contracts.*',
          'suppliers.name as supplierName',
          'suppliers.type as supplierBusinessType',
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
        supplierName: contract.supplierName
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

      // Validate supplier exists
      const supplier = await db('suppliers')
        .where({ id: req.body.supplierId, isActive: true })
        .first();

      if (!supplier) {
        return res.status(400).json({
          success: false,
          error: 'Supplier not found or inactive'
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

      // Extract locations for separate handling
      const { locations, ...contractFields } = req.body;
      
      const contractData = {
        ...contractFields,
        createdBy: req.user.userId,
        created_at: new Date(),
        updated_at: new Date()
      };

      // Use transaction to create contract and locations
      const result = await db.transaction(async (trx) => {
        // Insert main contract
        const [contractId] = await trx('contracts').insert(contractData);
        
        // Insert contract locations and their materials
        if (locations && locations.length > 0) {
          for (const location of locations) {
            const { materials, ...locationFields } = location;
            
            const locationData = {
              ...locationFields,
              contractId: contractId,
              supplierId: req.body.supplierId,
              supplierName: req.body.supplierName,
              created_at: new Date(),
              updated_at: new Date()
            };
            
            const [locationId] = await trx('contract_locations').insert(locationData);
            
            // Insert material rates for this location
            if (materials && materials.length > 0) {
              const materialRates = materials.map(material => ({
                contractId: contractId,
                locationId: locationId,
                materialId: material.materialId,
                materialName: material.materialName,
                materialType: material.materialType,
                unit: material.unit,
                rate: material.rate,
                currency: material.currency || 'OMR',
                minimumQuantity: material.minimumQuantity || 0,
                maximumQuantity: material.maximumQuantity || 0,
                created_at: new Date(),
                updated_at: new Date()
              }));
              
              await trx('contract_material_rates').insert(materialRates);
            }
          }
        }
        
        return contractId;
      });
      
      const newContract = await db('contracts')
        .leftJoin('suppliers', 'contracts.supplierId', 'suppliers.id')
        .select(
          'contracts.*',
          'suppliers.name as supplierName'
        )
        .where('contracts.id', result)
        .first();

      auditLog('CONTRACT_CREATED', req.user.userId, {
        contractId: result,
        contractNumber: newContract.contractNumber,
        supplierName: newContract.supplierName,
        locationsCount: locations?.length || 0
      });

      logger.info('Contract created', {
        contractId: result,
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

// GET /api/contracts/:id/pricing/:materialId - Get contract pricing for material
router.get('/:id/pricing/:materialId',
  validateParams(Joi.object({ 
    id: Joi.number().integer().positive().required(),
    materialId: Joi.number().integer().positive().required()
  })),
  requirePermission('VIEW_CONTRACTS'),
  async (req, res) => {
    try {
      const { id, materialId } = req.params;
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      const rate = await db('contract_rates')
        .leftJoin('materials', 'contract_rates.materialId', 'materials.id')
        .select(
          'contract_rates.*',
          'materials.name as materialName',
          'materials.code as materialCode',
          'materials.standardPrice',
          'materials.unit'
        )
        .where({
          'contract_rates.contractId': id,
          'contract_rates.materialId': materialId,
          'contract_rates.isActive': true
        })
        .first();

      if (!rate) {
        return res.status(404).json({
          success: false,
          error: 'Contract pricing not found for this material'
        });
      }

      res.json({
        success: true,
        data: rate
      });

    } catch (error) {
      logger.error('Error fetching contract pricing', { 
        error: error.message, 
        contractId: req.params.id,
        materialId: req.params.materialId,
        userId: req.user.userId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch contract pricing'
      });
    }
  }
);

// PUT /api/contracts/:id/pricing/:materialId - Update contract pricing for material
router.put('/:id/pricing/:materialId',
  validateParams(Joi.object({ 
    id: Joi.number().integer().positive().required(),
    materialId: Joi.number().integer().positive().required()
  })),
  validate(contractRateSchema.fork(['contractId'], schema => schema.optional())),
  requirePermission('MANAGE_CONTRACTS'),
  async (req, res) => {
    try {
      const { id, materialId } = req.params;
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      // Verify contract exists
      const contract = await db('contracts').where({ id }).first();
      if (!contract) {
        return res.status(404).json({
          success: false,
          error: 'Contract not found'
        });
      }

      // Verify material exists
      const material = await db('materials')
        .where({ id: materialId, isActive: true })
        .first();

      if (!material) {
        return res.status(400).json({
          success: false,
          error: 'Material not found or inactive'
        });
      }

      // Check if rate exists
      const existingRate = await db('contract_rates')
        .where({ 
          contractId: id, 
          materialId: materialId,
          isActive: true
        })
        .first();

      const rateData = {
        ...req.body,
        contractId: id,
        materialId: materialId,
        updated_at: new Date()
      };

      let result;
      if (existingRate) {
        // Update existing rate
        await db('contract_rates')
          .where({ id: existingRate.id })
          .update(rateData);
        
        result = await db('contract_rates')
          .leftJoin('materials', 'contract_rates.materialId', 'materials.id')
          .select(
            'contract_rates.*',
            'materials.name as materialName',
            'materials.code as materialCode'
          )
          .where('contract_rates.id', existingRate.id)
          .first();

        auditLog('CONTRACT_RATE_UPDATED', req.user.userId, {
          contractId: id,
          rateId: existingRate.id,
          materialName: result.materialName
        });
      } else {
        // Create new rate
        rateData.created_at = new Date();
        const [rateId] = await db('contract_rates').insert(rateData);
        
        result = await db('contract_rates')
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
          materialName: result.materialName
        });
      }

      res.json({
        success: true,
        message: 'Contract pricing updated successfully',
        data: result
      });

    } catch (error) {
      logger.error('Error updating contract pricing', { 
        error: error.message, 
        contractId: req.params.id,
        materialId: req.params.materialId,
        userId: req.user.userId,
        pricingData: req.body
      });
      res.status(500).json({
        success: false,
        error: 'Failed to update contract pricing'
      });
    }
  }
);

module.exports = router;