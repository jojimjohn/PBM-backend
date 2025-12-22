const express = require('express');
const { validate, validateParams, sanitize } = require('../middleware/validation');
const { requirePermission } = require('../middleware/auth');
const { logger, auditLog } = require('../utils/logger');
const { getDbConnection } = require('../config/database');
const Joi = require('joi');

const router = express.Router();

// Apply sanitization to all routes
router.use(sanitize);

// Supplier Location validation schema
const supplierLocationSchema = Joi.object({
  supplierId: Joi.number().integer().positive().required(),
  locationName: Joi.string().min(2).max(200).required().trim(),
  locationCode: Joi.string().max(50).optional().trim(), // Made optional - will auto-generate if not provided
  address: Joi.string().allow('').optional(),
  contactPerson: Joi.string().max(100).allow('').optional(),
  contactPhone: Joi.string().max(20).allow('').optional(),
  coordinates: Joi.string().max(50).allow('').optional(),
  region_id: Joi.number().integer().positive().optional(),
  isActive: Joi.boolean().default(true),
  notes: Joi.string().allow('').optional()
});

// Helper function to generate unique location code
async function generateLocationCode(db, supplierId, supplierName) {
  // Create base code from supplier name (first 3 chars uppercase)
  const cleanName = (supplierName || 'SUP').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  const prefix = cleanName.substring(0, 3).padEnd(3, 'X');

  // Count existing locations for this supplier
  const existingCount = await db('supplier_locations')
    .where({ supplierId })
    .count('* as count')
    .first();

  const sequence = (existingCount.count || 0) + 1;
  const code = `${prefix}-LOC-${String(sequence).padStart(3, '0')}`;

  return code;
}

// GET /api/supplier-locations - List all supplier locations
router.get('/', requirePermission('VIEW_SUPPLIERS'), async (req, res) => {
  try {
    const { companyId } = req.user;
    const db = getDbConnection(companyId);
    
    const { 
      page = 1, 
      limit = 50, 
      search = '', 
      supplierId = '',
      isActive = ''
    } = req.query;

    const offset = (page - 1) * limit;
    
    let query = db('supplier_locations')
      .leftJoin('suppliers', 'supplier_locations.supplierId', 'suppliers.id')
      .leftJoin('regions', 'supplier_locations.region_id', 'regions.id')
      .select(
        'supplier_locations.*',
        'suppliers.name as supplierName',
        'regions.name as regionName',
        'regions.governorate as regionGovernorate'
      );

    // Search filter
    if (search) {
      query = query.where(function() {
        this.where('supplier_locations.locationName', 'like', `%${search}%`)
            .orWhere('supplier_locations.locationCode', 'like', `%${search}%`)
            .orWhere('suppliers.name', 'like', `%${search}%`)
            .orWhere('supplier_locations.contactPerson', 'like', `%${search}%`);
      });
    }

    // Supplier filter
    if (supplierId) {
      query = query.where('supplier_locations.supplierId', supplierId);
    }

    // Active status filter
    if (isActive !== '') {
      query = query.where('supplier_locations.isActive', isActive === 'true');
    }

    // Get total count for pagination
    const totalQuery = query.clone();
    const [{ total }] = await totalQuery.count('* as total');

    // Get paginated results
    const locations = await query
      .orderBy('suppliers.name', 'asc')
      .orderBy('supplier_locations.locationName', 'asc')
      .limit(limit)
      .offset(offset);

    auditLog('SUPPLIER_LOCATIONS_VIEWED', req.user.userId, {
      companyId,
      count: locations.length,
      filters: { search, supplierId, isActive }
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
    logger.error('Error fetching supplier locations', { 
      error: error.message, 
      userId: req.user.userId,
      companyId: req.user.companyId
    });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch supplier locations'
    });
  }
});

// GET /api/supplier-locations/:id - Get specific supplier location
router.get('/:id', 
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  requirePermission('VIEW_SUPPLIERS'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      const location = await db('supplier_locations')
        .leftJoin('suppliers', 'supplier_locations.supplierId', 'suppliers.id')
        .leftJoin('regions', 'supplier_locations.region_id', 'regions.id')
        .select(
          'supplier_locations.*',
          'suppliers.name as supplierName',
          'regions.name as regionName',
          'regions.governorate as regionGovernorate'
        )
        .where('supplier_locations.id', id)
        .first();

      if (!location) {
        return res.status(404).json({
          success: false,
          error: 'Supplier location not found'
        });
      }

      auditLog('SUPPLIER_LOCATION_VIEWED', req.user.userId, {
        locationId: id,
        locationName: location.locationName,
        supplierName: location.supplierName
      });

      res.json({
        success: true,
        data: location
      });

    } catch (error) {
      logger.error('Error fetching supplier location', { 
        error: error.message, 
        locationId: req.params.id,
        userId: req.user.userId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch supplier location'
      });
    }
  }
);

// POST /api/supplier-locations - Create new supplier location
router.post('/',
  validate(supplierLocationSchema),
  requirePermission('MANAGE_SUPPLIERS'),
  async (req, res) => {
    try {
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      // Check if supplier exists
      const supplier = await db('suppliers')
        .where({ id: req.body.supplierId })
        .first();

      if (!supplier) {
        return res.status(400).json({
          success: false,
          error: 'Supplier not found'
        });
      }

      // Auto-generate location code if not provided
      let locationCode = req.body.locationCode;
      if (!locationCode || locationCode.trim() === '') {
        locationCode = await generateLocationCode(db, req.body.supplierId, supplier.name);
      }

      // Check if location code already exists globally (to prevent duplicates)
      const existingByCode = await db('supplier_locations')
        .where({ locationCode })
        .first();

      if (existingByCode) {
        return res.status(400).json({
          success: false,
          error: `Location code "${locationCode}" already exists. Please use a different code.`
        });
      }

      // Check if this supplier already has a location with the same name
      const existingByName = await db('supplier_locations')
        .where({
          supplierId: req.body.supplierId,
          locationName: req.body.locationName
        })
        .first();

      if (existingByName) {
        return res.status(400).json({
          success: false,
          error: 'A location with this name already exists for this supplier'
        });
      }

      const locationData = {
        ...req.body,
        locationCode, // Use the generated or provided code
        created_at: new Date(),
        updated_at: new Date()
      };

      const [locationId] = await db('supplier_locations').insert(locationData);
      
      const newLocation = await db('supplier_locations')
        .leftJoin('suppliers', 'supplier_locations.supplierId', 'suppliers.id')
        .leftJoin('regions', 'supplier_locations.region_id', 'regions.id')
        .select(
          'supplier_locations.*',
          'suppliers.name as supplierName',
          'regions.name as regionName'
        )
        .where('supplier_locations.id', locationId)
        .first();

      auditLog('SUPPLIER_LOCATION_CREATED', req.user.userId, {
        locationId,
        locationName: newLocation.locationName,
        supplierName: newLocation.supplierName,
        locationCode: newLocation.locationCode
      });

      logger.info('Supplier location created', {
        locationId,
        locationName: newLocation.locationName,
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

// PUT /api/supplier-locations/:id - Update supplier location
router.put('/:id',
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  validate(supplierLocationSchema),
  requirePermission('MANAGE_SUPPLIERS'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      // Check if location exists
      const existingLocation = await db('supplier_locations')
        .where({ id })
        .first();

      if (!existingLocation) {
        return res.status(404).json({
          success: false,
          error: 'Supplier location not found'
        });
      }

      // Check if location code is being changed to an existing one
      if (req.body.locationCode && 
          (req.body.locationCode !== existingLocation.locationCode || 
           req.body.supplierId !== existingLocation.supplierId)) {
        const duplicateLocation = await db('supplier_locations')
          .where({ 
            supplierId: req.body.supplierId,
            locationCode: req.body.locationCode 
          })
          .where('id', '!=', id)
          .first();

        if (duplicateLocation) {
          return res.status(400).json({
            success: false,
            error: 'Location code already exists for this supplier'
          });
        }
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
        .leftJoin('regions', 'supplier_locations.region_id', 'regions.id')
        .select(
          'supplier_locations.*',
          'suppliers.name as supplierName',
          'regions.name as regionName'
        )
        .where('supplier_locations.id', id)
        .first();

      auditLog('SUPPLIER_LOCATION_UPDATED', req.user.userId, {
        locationId: id,
        locationName: updatedLocation.locationName,
        supplierName: updatedLocation.supplierName,
        changes: Object.keys(req.body)
      });

      logger.info('Supplier location updated', {
        locationId: id,
        locationName: updatedLocation.locationName,
        updatedBy: req.user.userId
      });

      res.json({
        success: true,
        message: 'Supplier location updated successfully',
        data: updatedLocation
      });

    } catch (error) {
      logger.error('Error updating supplier location', { 
        error: error.message, 
        locationId: req.params.id,
        userId: req.user.userId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to update supplier location'
      });
    }
  }
);

// DELETE /api/supplier-locations/:id - Delete supplier location
router.delete('/:id',
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  requirePermission('MANAGE_SUPPLIERS'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      // Check if location exists
      const location = await db('supplier_locations')
        .leftJoin('suppliers', 'supplier_locations.supplierId', 'suppliers.id')
        .select('supplier_locations.*', 'suppliers.name as supplierName')
        .where('supplier_locations.id', id)
        .first();

      if (!location) {
        return res.status(404).json({
          success: false,
          error: 'Supplier location not found'
        });
      }

      // Check if location has any dependencies (prevent deletion)
      const dependencies = [];

      try {
        // Check multiple tables for dependencies
        const tableChecks = await Promise.all([
          db.schema.hasTable('collection_orders'),
          db.schema.hasTable('contract_location_rates'),
          db.schema.hasTable('collection_callouts'),
          db.schema.hasTable('contracts'),
          db.schema.hasTable('purchase_orders')
        ]);

        // Check collection_orders
        if (tableChecks[0]) {
          const orderCount = await db('collection_orders').where({ locationId: id }).count('* as count').first();
          if (orderCount.count > 0) {
            dependencies.push(`${orderCount.count} collection order(s)`);
          }
        }

        // Check contract_location_rates
        if (tableChecks[1]) {
          const contractRateCount = await db('contract_location_rates').where({ locationId: id }).count('* as count').first();
          if (contractRateCount.count > 0) {
            dependencies.push(`${contractRateCount.count} contract rate(s)`);
          }
        }

        // Check collection_callouts
        if (tableChecks[2]) {
          const calloutCount = await db('collection_callouts').where({ locationId: id }).count('* as count').first();
          if (calloutCount.count > 0) {
            dependencies.push(`${calloutCount.count} callout(s)`);
          }
        }

        // Check contracts (if location is associated with contracts)
        if (tableChecks[3]) {
          const contractCount = await db('contracts')
            .where({ supplierId: location.supplierId })
            .whereIn('status', ['active', 'pending'])
            .count('* as count')
            .first();
          if (contractCount.count > 0) {
            // Only block if this is the only location for the supplier
            const locationCount = await db('supplier_locations')
              .where({ supplierId: location.supplierId, isActive: true })
              .count('* as count')
              .first();
            if (locationCount.count <= 1) {
              dependencies.push(`${contractCount.count} active contract(s) (last location for supplier)`);
            }
          }
        }

        // Check purchase_orders (if linked via supplier)
        if (tableChecks[4]) {
          const poCount = await db('purchase_orders')
            .where({ supplierId: location.supplierId, locationId: id })
            .count('* as count')
            .first();
          if (poCount.count > 0) {
            dependencies.push(`${poCount.count} purchase order(s)`);
          }
        }

        logger.info('SUPPLIER LOCATION DEPENDENCY CHECK', {
          locationId: id,
          locationName: location.locationName,
          supplierName: location.supplierName,
          dependencies,
          willHardDelete: dependencies.length === 0
        });
      } catch (error) {
        logger.warn('Error checking dependencies, blocking deletion for safety', {
          locationId: id,
          error: error.message
        });
        dependencies.push('Unable to verify dependencies');
      }

      if (dependencies.length > 0) {
        // Soft delete when dependencies exist
        await db('supplier_locations')
          .where({ id })
          .update({
            isActive: false,
            updated_at: new Date()
          });

        const dependencyList = dependencies.join(', ');

        auditLog('SUPPLIER_LOCATION_DEACTIVATED', req.user.userId, {
          locationId: id,
          locationName: location.locationName,
          supplierName: location.supplierName,
          reason: `Has dependencies: ${dependencyList}`
        });

        logger.info('Supplier location deactivated due to dependencies', {
          locationId: id,
          locationName: location.locationName,
          dependencies,
          deactivatedBy: req.user.userId
        });

        return res.json({
          success: true,
          message: `Location deactivated due to existing dependencies: ${dependencyList}`
        });
      }

      // Hard delete when no dependencies exist
      await db('supplier_locations')
        .where({ id })
        .del();

      auditLog('SUPPLIER_LOCATION_DELETED', req.user.userId, {
        locationId: id,
        locationName: location.locationName,
        supplierName: location.supplierName,
        deletionType: 'hard_delete'
      });

      logger.info('Supplier location permanently deleted', {
        locationId: id,
        locationName: location.locationName,
        deletedBy: req.user.userId
      });

      res.json({
        success: true,
        message: 'Supplier location deleted successfully'
      });

    } catch (error) {
      logger.error('Error deleting supplier location', { 
        error: error.message, 
        locationId: req.params.id,
        userId: req.user.userId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to delete supplier location'
      });
    }
  }
);

module.exports = router;