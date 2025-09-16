const express = require('express');
const { validate, validateParams, sanitize } = require('../middleware/validation');
const { requirePermission } = require('../middleware/auth');
const { logger, auditLog } = require('../utils/logger');
const { getDbConnection } = require('../config/database');
const Joi = require('joi');

const router = express.Router();

// Apply sanitization to all routes
router.use(sanitize);

// Supplier Location validation schema (no supplierName - use foreign key)
const supplierLocationSchema = Joi.object({
  supplierId: Joi.number().integer().positive().required(),
  locationName: Joi.string().max(200).required().trim(),
  locationCode: Joi.string().max(10).required().trim(),
  address: Joi.string().allow('').optional(),
  contactPerson: Joi.string().max(100).allow('').optional(),
  contactPhone: Joi.string().max(20).allow('').optional(),
  coordinates: Joi.string().max(50).allow('').optional(),
  isActive: Joi.boolean().default(true),
  notes: Joi.string().allow('').optional()
});

// Contract-Location Link validation schema
const contractLocationLinkSchema = Joi.object({
  supplierId: Joi.number().integer().positive().required(),
  locationId: Joi.number().integer().positive().required(),
  isActive: Joi.boolean().default(true)
});

// Contract Location Rate validation schema
const contractLocationRateSchema = Joi.object({
  supplierId: Joi.number().integer().positive().required(),
  locationId: Joi.number().integer().positive().required(),
  materialId: Joi.number().integer().positive().required(),
  rateType: Joi.string().valid('fixed_rate', 'discount_percentage', 'minimum_price_guarantee', 'free', 'we_pay').required(),
  contractRate: Joi.number().min(0).precision(3).optional(),
  discountPercentage: Joi.number().min(0).max(100).precision(2).optional(),
  minimumPrice: Joi.number().min(0).precision(3).optional(),
  paymentDirection: Joi.string().valid('we_receive', 'we_pay').default('we_receive'),
  unit: Joi.string().max(20).required(),
  minimumQuantity: Joi.number().min(0).precision(3).default(0),
  maximumQuantity: Joi.number().min(0).precision(3).optional(),
  description: Joi.string().allow('').optional(),
  isActive: Joi.boolean().default(true)
});

// GET /api/contract-locations - List all supplier locations (renamed for compatibility)
router.get('/', requirePermission('VIEW_SUPPLIERS'), async (req, res) => {
  try {
    const { companyId } = req.user;
    const db = getDbConnection(companyId);
    
    const { 
      supplierId = '',
      isActive = '',
      page = 1,
      limit = 50,
      search = ''
    } = req.query;

    let query = db('supplier_locations')
      .leftJoin('suppliers', 'supplier_locations.supplierId', 'suppliers.id')
      .select(
        'supplier_locations.*',
        'suppliers.name as supplierName'
      );

    // Filter by supplier
    if (supplierId) {
      query = query.where('supplier_locations.supplierId', supplierId);
    }

    // Filter by active status
    if (isActive !== '') {
      query = query.where('supplier_locations.isActive', isActive === 'true');
    }

    // Search filter
    if (search) {
      query = query.where(function() {
        this.where('supplier_locations.locationName', 'like', `%${search}%`)
            .orWhere('supplier_locations.locationCode', 'like', `%${search}%`)
            .orWhere('suppliers.name', 'like', `%${search}%`);
      });
    }

    // Get total count for pagination
    const totalQuery = query.clone();
    const [{ total }] = await totalQuery.count('* as total');

    // Get paginated results
    const locations = await query
      .orderBy('suppliers.name')
      .orderBy('supplier_locations.locationName')
      .limit(limit)
      .offset((page - 1) * limit);

    auditLog('SUPPLIER_LOCATIONS_VIEWED', req.user.userId, {
      companyId,
      count: locations.length,
      supplierId
    });

    res.json({
      success: true,
      data: locations,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(total),
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    logger.error('Error fetching contract locations', { 
      error: error.message, 
      userId: req.user.userId,
      companyId: req.user.companyId
    });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch contract locations'
    });
  }
});

// GET /api/contract-locations/:id - Get specific location with rates
router.get('/:id', 
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  requirePermission('VIEW_CONTRACTS'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      // Get location details
      const location = await db('supplier_locations')
        .leftJoin('suppliers', 'supplier_locations.supplierId', 'suppliers.id')
        .select(
          'supplier_locations.*',
          'suppliers.name as supplierName',
          'suppliers.contactPerson as supplierContactPerson',
          'suppliers.phone as supplierPhone'
        )
        .where('supplier_locations.id', id)
        .first();

      if (!location) {
        return res.status(404).json({
          success: false,
          error: 'Contract location not found'
        });
      }

      // Get location rates
      const rates = await db('contract_location_rates')
        .leftJoin('materials', 'contract_location_rates.materialId', 'materials.id')
        .select(
          'contract_location_rates.*',
          'materials.name as materialName',
          'materials.code as materialCode',
          'materials.category as materialCategory',
          'materials.standardPrice'
        )
        .where('contract_location_rates.locationId', id)
        .where('contract_location_rates.isActive', true)
        .orderBy('materials.name');

      auditLog('SUPPLIER_LOCATION_VIEWED', req.user.userId, {
        locationId: id,
        locationName: location.locationName,
        supplierName: location.supplierName
      });

      res.json({
        success: true,
        data: {
          ...location,
          rates
        }
      });

    } catch (error) {
      logger.error('Error fetching contract location', { 
        error: error.message, 
        locationId: req.params.id,
        userId: req.user.userId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch contract location'
      });
    }
  }
);

// POST /api/contract-locations - Create new contract location (or supplier location)
// POST /api/contract-locations - Create supplier collection location
router.post('/', 
  validate(supplierLocationSchema),
  requirePermission('MANAGE_SUPPLIERS'),
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

      // Check if location code already exists for this supplier
      const existingLocation = await db('supplier_locations')
        .where({ 
          supplierId: req.body.supplierId,
          locationCode: req.body.locationCode 
        })
        .first();

      if (existingLocation) {
        return res.status(400).json({
          success: false,
          error: 'Location code already exists for this supplier'
        });
      }

      logger.info('Creating supplier location', {
        supplierId: req.body.supplierId,
        locationName: req.body.locationName,
        locationCode: req.body.locationCode
      });

      // Remove supplierName from request body since we use foreign key
      const { supplierName, ...cleanLocationData } = req.body;

      const locationData = {
        ...cleanLocationData,
        created_at: new Date(),
        updated_at: new Date()
      };

      const [locationId] = await db('supplier_locations').insert(locationData);
      
      // Get the created supplier location with supplier details
      const newLocation = await db('supplier_locations')
        .leftJoin('suppliers', 'supplier_locations.supplierId', 'suppliers.id')
        .select(
          'supplier_locations.*',
          'suppliers.name as supplierName'
          // Removed: 'suppliers.businessType as supplierBusinessType' - column doesn't exist
        )
        .where('supplier_locations.id', locationId)
        .first();

      auditLog('SUPPLIER_LOCATION_CREATED', req.user.userId, {
        locationId,
        locationName: newLocation.locationName,
        locationCode: newLocation.locationCode,
        supplierId: newLocation.supplierId,
        supplierName: newLocation.supplierName
      });

      logger.info('Supplier location created', {
        locationId,
        locationName: newLocation.locationName,
        locationCode: newLocation.locationCode,
        supplierId: newLocation.supplierId,
        createdBy: req.user.userId
      });

      res.status(201).json({
        success: true,
        message: 'Supplier location created successfully',
        data: newLocation
      });

    } catch (error) {
      logger.error('Error creating supplier location', { 
        error: error.message, 
        userId: req.user.userId,
        locationData: req.body
      });
      res.status(500).json({
        success: false,
        error: 'Failed to create supplier location'
      });
    }
  }
);

// PUT /api/contract-locations/:id - Update contract location
router.put('/:id',
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  validate(supplierLocationSchema.fork(['supplierId'], schema => schema.optional())),
  requirePermission('MANAGE_SUPPLIERS'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      const location = await db('supplier_locations')
        .where({ id })
        .first();

      if (!location) {
        return res.status(404).json({
          success: false,
          error: 'Contract location not found'
        });
      }

      const updateData = {
        ...req.body,
        updated_at: new Date()
      };

      await db('supplier_locations')
        .where({ id })
        .update(updateData);

      const updatedLocation = await db('supplier_locations')
        .leftJoin('suppliers', 'supplier_locations.supplierId', 'suppliers.id')
        .select(
          'supplier_locations.*',
          'suppliers.name as supplierName'
        )
        .where('supplier_locations.id', id)
        .first();

      auditLog('SUPPLIER_LOCATION_UPDATED', req.user.userId, {
        locationId: id,
        locationName: updatedLocation.locationName,
        supplierName: updatedLocation.supplierName
      });

      res.json({
        success: true,
        message: 'Supplier location updated successfully',
        data: updatedLocation
      });

    } catch (error) {
      logger.error('Error updating contract location', { 
        error: error.message, 
        locationId: req.params.id,
        userId: req.user.userId,
        updateData: req.body
      });
      res.status(500).json({
        success: false,
        error: 'Failed to update contract location'
      });
    }
  }
);

// POST /api/contract-locations/:id/rates - Add rate to location
router.post('/:id/rates',
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  validate(contractLocationRateSchema.fork(['supplierId', 'locationId'], schema => schema.optional())),
  requirePermission('MANAGE_SUPPLIERS'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      // Verify location exists
      const location = await db('supplier_locations')
        .leftJoin('suppliers', 'supplier_locations.supplierId', 'suppliers.id')
        .select('supplier_locations.*', 'suppliers.name as supplierName')
        .where('supplier_locations.id', id)
        .first();

      if (!location) {
        return res.status(404).json({
          success: false,
          error: 'Contract location not found'
        });
      }

      // Verify material exists
      const material = await db('materials')
        .where({ id: req.body.materialId })
        .first();

      if (!material) {
        return res.status(400).json({
          success: false,
          error: 'Material not found'
        });
      }

      // Check if rate already exists for this material at this location
      const existingRate = await db('contract_location_rates')
        .where({ 
          supplierId: location.supplierId,
          locationId: id, 
          materialId: req.body.materialId,
          isActive: true
        })
        .first();

      if (existingRate) {
        return res.status(400).json({
          success: false,
          error: 'Rate already exists for this material at this location'
        });
      }

      const rateData = {
        ...req.body,
        supplierId: location.supplierId,
        locationId: id,
        created_at: new Date(),
        updated_at: new Date()
      };

      const [rateId] = await db('contract_location_rates').insert(rateData);
      
      const newRate = await db('contract_location_rates')
        .leftJoin('materials', 'contract_location_rates.materialId', 'materials.id')
        .select(
          'contract_location_rates.*',
          'materials.name as materialName',
          'materials.code as materialCode'
        )
        .where('contract_location_rates.id', rateId)
        .first();

      auditLog('CONTRACT_LOCATION_RATE_CREATED', req.user.userId, {
        locationId: id,
        rateId,
        materialName: newRate.materialName,
        rateType: newRate.rateType,
        contractNumber: location.contractNumber
      });

      res.status(201).json({
        success: true,
        message: 'Location rate added successfully',
        data: newRate
      });

    } catch (error) {
      logger.error('Error creating location rate', { 
        error: error.message, 
        locationId: req.params.id,
        userId: req.user.userId,
        rateData: req.body
      });
      res.status(500).json({
        success: false,
        error: 'Failed to create location rate'
      });
    }
  }
);

// GET /api/contract-locations/:locationId/rates/:materialId - Get specific location rate
router.get('/:locationId/rates/:materialId',
  validateParams(Joi.object({ 
    locationId: Joi.number().integer().positive().required(),
    materialId: Joi.number().integer().positive().required()
  })),
  requirePermission('VIEW_CONTRACTS'),
  async (req, res) => {
    try {
      const { locationId, materialId } = req.params;
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      // Get material standard price
      const material = await db('materials')
        .select('standardPrice', 'name', 'code', 'unit')
        .where('id', materialId)
        .first();

      if (!material) {
        return res.status(404).json({
          success: false,
          error: 'Material not found'
        });
      }

      // Get location rate
      const locationRate = await db('contract_location_rates')
        .leftJoin('supplier_locations', 'contract_location_rates.locationId', 'supplier_locations.id')
        .leftJoin('contracts', 'contract_location_rates.supplierId', 'contracts.id')
        .select(
          'contract_location_rates.*',
          'supplier_locations.locationName',
          'suppliers.name as supplierName',
          'contracts.endDate as contractEndDate'
        )
        .where('contract_location_rates.locationId', locationId)
        .where('contract_location_rates.materialId', materialId)
        .where('contracts.status', 'active')
        .where('contracts.startDate', '<=', new Date())
        .where('contracts.endDate', '>=', new Date())
        .where('contract_location_rates.isActive', true)
        .first();

      if (!locationRate) {
        return res.json({
          success: true,
          data: {
            hasLocationRate: false,
            standardPrice: material.standardPrice,
            effectivePrice: material.standardPrice,
            material,
            paymentDirection: 'we_receive'
          }
        });
      }

      // Calculate effective price based on rate type
      let effectivePrice = material.standardPrice;
      let savings = 0;
      let savingsPercentage = 0;

      switch (locationRate.rateType) {
        case 'fixed_rate':
          effectivePrice = locationRate.contractRate;
          if (locationRate.paymentDirection === 'we_receive') {
            savings = locationRate.contractRate - material.standardPrice; // Positive if we get more than standard
          } else {
            savings = material.standardPrice - locationRate.contractRate; // Positive if we pay less than standard
          }
          savingsPercentage = material.standardPrice > 0 ? (Math.abs(savings) / material.standardPrice) * 100 : 0;
          break;
        
        case 'discount_percentage':
          effectivePrice = material.standardPrice * (1 + locationRate.discountPercentage / 100);
          savings = effectivePrice - material.standardPrice;
          savingsPercentage = locationRate.discountPercentage;
          break;
        
        case 'minimum_price_guarantee':
          effectivePrice = Math.max(material.standardPrice, locationRate.contractRate);
          savings = effectivePrice - material.standardPrice;
          savingsPercentage = material.standardPrice > 0 ? (savings / material.standardPrice) * 100 : 0;
          break;

        case 'free':
          effectivePrice = 0;
          savings = material.standardPrice;
          savingsPercentage = 100;
          break;

        case 'we_pay':
          effectivePrice = -Math.abs(locationRate.contractRate); // Negative value for expenses
          savings = material.standardPrice + Math.abs(locationRate.contractRate); // Cost to us
          break;
      }

      res.json({
        success: true,
        data: {
          hasLocationRate: true,
          standardPrice: material.standardPrice,
          effectivePrice: parseFloat(effectivePrice.toFixed(3)),
          savings: parseFloat(savings.toFixed(3)),
          savingsPercentage: parseFloat(savingsPercentage.toFixed(2)),
          locationRate,
          material,
          paymentDirection: locationRate.paymentDirection,
          isExpiringSoon: new Date(locationRate.contractEndDate) < new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        }
      });

    } catch (error) {
      logger.error('Error fetching location rate', { 
        error: error.message, 
        locationId: req.params.locationId,
        materialId: req.params.materialId,
        userId: req.user.userId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch location rate'
      });
    }
  }
);

module.exports = router;