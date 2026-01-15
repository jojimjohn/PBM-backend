const express = require('express');
const { validate, validateParams, sanitize } = require('../middleware/validation');
const { requirePermission } = require('../middleware/auth');
const { logger, auditLog } = require('../utils/logger');
const { getDbConnection } = require('../config/database');
const { uploadMultipleToS3, requireFiles } = require('../middleware/upload');
const storageService = require('../services/storageService');
const { supplierAttachments } = require('../repositories/AttachmentRepository');
const Joi = require('joi');

const router = express.Router();

// Apply sanitization to all routes
router.use(sanitize);

// Supplier validation schema - Based on UPDATED database schema
const supplierSchema = Joi.object({
  // Core fields that exist in database
  code: Joi.string().max(50).optional(), // Now exists in database
  name: Joi.string().min(2).max(200).required().trim(),
  email: Joi.string().email().max(255).allow('').optional(),
  phone: Joi.string().max(20).allow('').optional(),
  address: Joi.string().allow('').optional(),
  city: Joi.string().max(100).allow('').optional(), // Added city field
  region_id: Joi.number().integer().positive().allow(null).optional(),
  vatRegistration: Joi.string().max(50).allow('').optional(),
  contactPerson: Joi.string().max(100).allow('').optional(),
  businessRegistration: Joi.string().max(100).allow('').optional(), // Now exists in database
  nationalId: Joi.string().max(50).allow('').optional(), // Now exists in database
  taxNumber: Joi.string().max(50).allow('').optional(), // Now exists in database
  specialization: Joi.alternatives().try(
    Joi.string().max(100).allow('').optional(),
    Joi.array().items(Joi.alternatives().try(Joi.string(), Joi.number())).optional()
  ),
  creditBalance: Joi.number().min(0).precision(2).default(0),
  paymentTermDays: Joi.number().integer().min(0).default(0),
  bankName: Joi.string().max(100).allow('').optional(), // Now exists in database
  accountNumber: Joi.string().max(50).allow('').optional(), // Now exists in database
  iban: Joi.string().max(50).allow('').optional(), // Now exists in database
  notes: Joi.string().allow('').optional(),
  isActive: Joi.boolean().default(true),
  
  // Frontend nested objects (will be transformed to flat structure)
  contact: Joi.object({
    phone: Joi.string().max(20).allow('').optional(),
    email: Joi.string().email().max(255).allow('').optional(),
    vatRegistrationNumber: Joi.string().max(50).allow('').optional(),
    address: Joi.object({
      street: Joi.string().allow('').optional(),
      city: Joi.string().allow('').optional(),
      region: Joi.string().allow('').optional(),
      country: Joi.string().allow('').optional()
    }).optional()
  }).optional(),
  
  bankDetails: Joi.object({
    bankName: Joi.string().max(100).allow('').optional(),
    accountNumber: Joi.string().max(50).allow('').optional(),
    iban: Joi.string().max(50).allow('').optional()
  }).optional(),
  
  // Frontend-only fields (will be ignored during transformation)
  id: Joi.alternatives().try(Joi.number(), Joi.string()).optional(),
  type: Joi.string().allow('').optional(),
  street: Joi.string().allow('').optional(),
  city: Joi.string().allow('').optional(),
  region: Joi.string().allow('').optional(),
  vatRegistrationNumber: Joi.string().allow('').optional(),
  collectionAreas: Joi.array().optional(),
  category: Joi.string().allow('').optional(), // Frontend-only field - ignore
  status: Joi.string().allow('').optional(),
  paymentTerms: Joi.number().integer().min(0).optional(),
  createdAt: Joi.string().isoDate().optional(),
  lastTransaction: Joi.string().isoDate().allow(null).optional(),
  performance: Joi.object().optional(),
  purchaseHistory: Joi.object().optional()
});

// GET /api/suppliers - List all suppliers
router.get('/', requirePermission('VIEW_SUPPLIERS'), async (req, res) => {
  try {
    const { companyId } = req.user;
    const db = getDbConnection(companyId);
    
    const { 
      page = 1, 
      limit = 50, 
      search = '', 
      specialization = '',
      isActive = ''
    } = req.query;

    const offset = (page - 1) * limit;
    
    let query = db('suppliers').select('*');

    // Search filter
    if (search) {
      query = query.where(function() {
        this.where('name', 'like', `%${search}%`)
            .orWhere('email', 'like', `%${search}%`)
            .orWhere('phone', 'like', `%${search}%`)
            .orWhere('contactPerson', 'like', `%${search}%`);
      });
    }

    // Specialization filter
    if (specialization) {
      query = query.where('specialization', specialization);
    }

    // Active status filter
    if (isActive !== '') {
      query = query.where('isActive', isActive === 'true');
    }

    // Get total count for pagination
    const totalQuery = query.clone();
    const [{ total }] = await totalQuery.count('* as total');

    // Get paginated results
    const suppliers = await query
      .orderBy('name', 'asc')
      .limit(limit)
      .offset(offset);

    auditLog('SUPPLIERS_VIEWED', req.user.userId, {
      companyId,
      count: suppliers.length,
      filters: { search, specialization, isActive }
    });

    res.json({
      success: true,
      data: suppliers,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(total),
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    logger.error('Error fetching suppliers', { 
      error: error.message, 
      userId: req.user.userId,
      companyId: req.user.companyId
    });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch suppliers'
    });
  }
});

// GET /api/suppliers/:id - Get specific supplier
router.get('/:id', 
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  requirePermission('VIEW_SUPPLIERS'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      const supplier = await db('suppliers')
        .where({ id })
        .first();

      if (!supplier) {
        return res.status(404).json({
          success: false,
          error: 'Supplier not found'
        });
      }

      auditLog('SUPPLIER_VIEWED', req.user.userId, {
        supplierId: id,
        supplierName: supplier.name
      });

      res.json({
        success: true,
        data: supplier
      });

    } catch (error) {
      logger.error('Error fetching supplier', { 
        error: error.message, 
        supplierId: req.params.id,
        userId: req.user.userId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch supplier'
      });
    }
  }
);

// POST /api/suppliers - Create new supplier
router.post('/', 
  validate(supplierSchema),
  requirePermission('MANAGE_SUPPLIERS'),
  async (req, res) => {
    try {
      console.log('Creating supplier - raw request body:', JSON.stringify(req.body, null, 2));
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      // Check if supplier with same code already exists (if code provided)
      if (req.body.code) {
        const existingSupplierByCode = await db('suppliers')
          .where({ code: req.body.code })
          .first();

        if (existingSupplierByCode) {
          return res.status(400).json({
            success: false,
            error: 'Supplier with this code already exists'
          });
        }
      }

      // Check if supplier with same email already exists (if email provided)
      if (req.body.email) {
        const existingSupplier = await db('suppliers')
          .where({ email: req.body.email })
          .first();

        if (existingSupplier) {
          return res.status(400).json({
            success: false,
            error: 'Supplier with this email already exists'
          });
        }
      }

      // Transform frontend data to match UPDATED database schema
      const supplierData = {
        code: req.body.code || null,
        name: req.body.name,
        email: req.body.email || req.body.contact?.email || null,
        phone: req.body.phone || req.body.contact?.phone || null,
        address: req.body.address || (req.body.contact?.address ? 
          [req.body.contact.address.street, req.body.contact.address.region, req.body.contact.address.country]
          .filter(Boolean).join(', ') : null),
        city: req.body.city || req.body.contact?.address?.city || null,
        region_id: req.body.region_id || null,
        vatRegistration: req.body.vatRegistration || req.body.contact?.vatRegistrationNumber || null,
        contactPerson: req.body.contactPerson || null,
        businessRegistration: req.body.businessRegistration || null,
        nationalId: req.body.nationalId || null,
        taxNumber: req.body.taxNumber || null,
        specialization: Array.isArray(req.body.specialization) ? 
          req.body.specialization.map(s => s.toString()).join(',') : 
          (req.body.specialization || null),
        creditBalance: req.body.creditBalance || 0,
        paymentTermDays: req.body.paymentTerms || req.body.paymentTermDays || 0,
        bankName: req.body.bankName || req.body.bankDetails?.bankName || null,
        accountNumber: req.body.accountNumber || req.body.bankDetails?.accountNumber || null,
        iban: req.body.iban || req.body.bankDetails?.iban || null,
        notes: req.body.notes || null,
        isActive: req.body.isActive !== false,
        created_at: new Date(),
        updated_at: new Date()
      };

      console.log('Transformed supplier data for DB insertion:', JSON.stringify(supplierData, null, 2));
      const [supplierId] = await db('suppliers').insert(supplierData);

      const newSupplier = await db('suppliers')
        .where({ id: supplierId })
        .first();

      // Auto-create main supplier location (only for Al Ramrami / oil trading company)
      if (companyId === 'al-ramrami') {
        try {
          const cleanName = (newSupplier.name || 'SUP').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
          const prefix = cleanName.substring(0, 3).padEnd(3, 'X');
          const mainLocationCode = `${prefix}-MAIN-001`;

          // Check if location code already exists
          const existingLocation = await db('supplier_locations')
            .where({ locationCode: mainLocationCode })
            .first();

          if (!existingLocation) {
            const mainLocationData = {
              supplierId: supplierId,
              locationName: `${newSupplier.name} - Main Location`,
              locationCode: mainLocationCode,
              address: newSupplier.address || '',
              contactPerson: newSupplier.contactPerson || '',
              contactPhone: newSupplier.phone || '',
              region_id: newSupplier.region_id || null,
              isActive: true,
              notes: 'Auto-generated main location',
              created_at: new Date(),
              updated_at: new Date()
            };

            await db('supplier_locations').insert(mainLocationData);

            logger.info('Main supplier location auto-created', {
              supplierId,
              supplierName: newSupplier.name,
              locationCode: mainLocationCode,
              companyId
            });
          }
        } catch (locationError) {
          // Log the error but don't fail supplier creation
          logger.warn('Failed to auto-create main supplier location', {
            supplierId,
            error: locationError.message
          });
        }
      }

      auditLog('SUPPLIER_CREATED', req.user.userId, {
        supplierId,
        supplierName: newSupplier.name,
        specialization: newSupplier.specialization
      });

      logger.info('Supplier created', {
        supplierId,
        supplierName: newSupplier.name,
        createdBy: req.user.userId
      });

      res.status(201).json({
        success: true,
        message: 'Supplier created successfully',
        data: newSupplier
      });

    } catch (error) {
      logger.error('Error creating supplier', { 
        error: error.message, 
        userId: req.user.userId,
        supplierData: req.body
      });
      res.status(500).json({
        success: false,
        error: 'Failed to create supplier'
      });
    }
  }
);

// PUT /api/suppliers/:id - Update supplier
router.put('/:id',
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  validate(supplierSchema),
  requirePermission('MANAGE_SUPPLIERS'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      // Check if supplier exists
      const existingSupplier = await db('suppliers')
        .where({ id })
        .first();

      if (!existingSupplier) {
        return res.status(404).json({
          success: false,
          error: 'Supplier not found'
        });
      }

      // Check if email is being changed to an existing one
      if (req.body.email && req.body.email !== existingSupplier.email) {
        const duplicateSupplier = await db('suppliers')
          .where({ email: req.body.email })
          .where('id', '!=', id)
          .first();

        if (duplicateSupplier) {
          return res.status(400).json({
            success: false,
            error: 'Supplier with this email already exists'
          });
        }
      }

      // Transform frontend data to match UPDATED database schema
      const updateData = {
        code: req.body.code || null,
        name: req.body.name,
        email: req.body.email || req.body.contact?.email || null,
        phone: req.body.phone || req.body.contact?.phone || null,
        address: req.body.address || (req.body.contact?.address ? 
          [req.body.contact.address.street, req.body.contact.address.region, req.body.contact.address.country]
          .filter(Boolean).join(', ') : null),
        city: req.body.city || req.body.contact?.address?.city || null,
        region_id: req.body.region_id || null,
        vatRegistration: req.body.vatRegistration || req.body.contact?.vatRegistrationNumber || null,
        contactPerson: req.body.contactPerson || null,
        businessRegistration: req.body.businessRegistration || null,
        nationalId: req.body.nationalId || null,
        taxNumber: req.body.taxNumber || null,
        specialization: Array.isArray(req.body.specialization) ? 
          req.body.specialization.map(s => s.toString()).join(',') : 
          (req.body.specialization || null),
        creditBalance: req.body.creditBalance || 0,
        paymentTermDays: req.body.paymentTerms || req.body.paymentTermDays || 0,
        bankName: req.body.bankName || req.body.bankDetails?.bankName || null,
        accountNumber: req.body.accountNumber || req.body.bankDetails?.accountNumber || null,
        iban: req.body.iban || req.body.bankDetails?.iban || null,
        notes: req.body.notes || null,
        isActive: req.body.isActive !== false,
        updated_at: new Date()
      };

      await db('suppliers')
        .where({ id })
        .update(updateData);

      const updatedSupplier = await db('suppliers')
        .where({ id })
        .first();

      auditLog('SUPPLIER_UPDATED', req.user.userId, {
        supplierId: id,
        supplierName: updatedSupplier.name,
        changes: Object.keys(req.body)
      });

      logger.info('Supplier updated', {
        supplierId: id,
        supplierName: updatedSupplier.name,
        updatedBy: req.user.userId
      });

      res.json({
        success: true,
        message: 'Supplier updated successfully',
        data: updatedSupplier
      });

    } catch (error) {
      logger.error('Error updating supplier', { 
        error: error.message, 
        supplierId: req.params.id,
        userId: req.user.userId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to update supplier'
      });
    }
  }
);

// DELETE /api/suppliers/:id - Delete supplier
router.delete('/:id',
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  requirePermission('MANAGE_SUPPLIERS'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      // Check if supplier exists
      const supplier = await db('suppliers')
        .where({ id })
        .first();

      if (!supplier) {
        return res.status(404).json({
          success: false,
          error: 'Supplier not found'
        });
      }

      // Check if supplier has any dependencies (prevent deletion if has linked data)
      const [
        orderCount,
        locationCount,
        contractCount,
        calloutCount,
        collectionOrderCount
      ] = await Promise.all([
        db('purchase_orders').where({ supplierId: id }).count('* as count').first(),
        db('supplier_locations').where({ supplierId: id, isActive: true }).count('* as count').first(),
        db('contracts').where({ supplierId: id }).whereIn('status', ['active', 'pending']).count('* as count').first(),
        db('collection_callouts').where({ supplierId: id }).count('* as count').first(),
        db('collection_orders').where({ supplierId: id }).count('* as count').first()
      ]);

      const dependencies = [];
      if (orderCount.count > 0) dependencies.push(`${orderCount.count} purchase order(s)`);
      if (locationCount.count > 0) dependencies.push(`${locationCount.count} active location(s)`);
      if (contractCount.count > 0) dependencies.push(`${contractCount.count} active/pending contract(s)`);
      if (calloutCount.count > 0) dependencies.push(`${calloutCount.count} collection callout(s)`);
      if (collectionOrderCount.count > 0) dependencies.push(`${collectionOrderCount.count} collection order(s)`);

      if (dependencies.length > 0) {
        // Soft delete when dependencies exist
        await db('suppliers')
          .where({ id })
          .update({ 
            isActive: false,
            updated_at: new Date()
          });

        auditLog('SUPPLIER_DEACTIVATED', req.user.userId, {
          supplierId: id,
          supplierName: supplier.name,
          reason: `Has dependencies: ${dependencies.join(', ')}`
        });

        logger.info('Supplier deactivated due to dependencies', {
          supplierId: id,
          supplierName: supplier.name,
          dependencies: dependencies,
          deactivatedBy: req.user.userId
        });

        return res.json({
          success: true,
          message: `Supplier deactivated due to existing dependencies: ${dependencies.join(', ')}`
        });
      }

      // Hard delete when no dependencies exist
      await db('suppliers')
        .where({ id })
        .del();

      auditLog('SUPPLIER_DELETED', req.user.userId, {
        supplierId: id,
        supplierName: supplier.name,
        deletionType: 'hard_delete'
      });

      logger.info('Supplier permanently deleted', {
        supplierId: id,
        supplierName: supplier.name,
        deletedBy: req.user.userId
      });

      res.json({
        success: true,
        message: 'Supplier deleted successfully'
      });

    } catch (error) {
      logger.error('Error deleting supplier', { 
        error: error.message, 
        supplierId: req.params.id,
        userId: req.user.userId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to delete supplier'
      });
    }
  }
);

// ============================================================================
// ATTACHMENT ROUTES (S3/MinIO)
// ============================================================================

// POST /api/suppliers/:id/attachments - Upload attachments to supplier
router.post('/:id/attachments',
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  requirePermission('MANAGE_SUPPLIERS'),
  uploadMultipleToS3,
  requireFiles,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { companyId, userId } = req.user;
      const db = getDbConnection(companyId);

      // Check if supplier exists
      const supplier = await db('suppliers').where({ id }).first();

      if (!supplier) {
        // Delete uploaded S3 files if supplier doesn't exist
        if (req.files && req.files.length > 0) {
          await Promise.all(req.files.map(file =>
            storageService.deleteFile(file.key).catch(err =>
              logger.warn('Failed to delete orphaned S3 file', { key: file.key, error: err.message })
            )
          ));
        }
        return res.status(404).json({
          success: false,
          error: 'Supplier not found'
        });
      }

      // Save attachment metadata to database
      const savedAttachments = [];
      for (const file of req.files) {
        const attachment = await supplierAttachments.create(db, {
          supplier_id: id,
          file_key: file.key,
          file_name: file.originalname,
          file_size: file.size,
          mime_type: file.mimetype,
          uploaded_by: userId
        });
        savedAttachments.push(attachment);
      }

      auditLog('SUPPLIER_ATTACHMENTS_UPLOADED', userId, {
        supplierId: id,
        supplierName: supplier.name,
        filesCount: req.files.length,
        attachmentIds: savedAttachments.map(a => a.id)
      });

      res.json({
        success: true,
        data: savedAttachments,
        message: `${req.files.length} file(s) uploaded successfully`
      });

    } catch (error) {
      logger.error('Error uploading supplier attachments', {
        error: error.message,
        supplierId: req.params.id,
        userId: req.user.userId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to upload attachments'
      });
    }
  }
);

// GET /api/suppliers/:id/attachments - Get attachments for supplier
router.get('/:id/attachments',
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  requirePermission('VIEW_SUPPLIERS'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      // Verify supplier exists
      const supplier = await db('suppliers').where({ id }).first();

      if (!supplier) {
        return res.status(404).json({
          success: false,
          error: 'Supplier not found'
        });
      }

      // Get attachments from repository
      const attachments = await supplierAttachments.findByReferenceId(db, id);

      // Generate presigned URLs for each attachment
      const attachmentsWithUrls = await Promise.all(
        attachments.map(async (attachment) => {
          try {
            const url = await storageService.getPresignedUrl(attachment.storageKey);
            return { ...attachment, url };
          } catch (err) {
            logger.warn('Failed to generate presigned URL', {
              attachmentId: attachment.id,
              fileKey: attachment.storageKey,
              error: err.message
            });
            return { ...attachment, url: null };
          }
        })
      );

      res.json({
        success: true,
        data: attachmentsWithUrls
      });

    } catch (error) {
      logger.error('Error fetching supplier attachments', {
        error: error.message,
        supplierId: req.params.id,
        userId: req.user.userId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch attachments'
      });
    }
  }
);

// DELETE /api/suppliers/:id/attachments/:fileId - Delete attachment from supplier
router.delete('/:id/attachments/:fileId',
  validateParams(Joi.object({
    id: Joi.number().integer().positive().required(),
    fileId: Joi.number().integer().positive().required()
  })),
  requirePermission('MANAGE_SUPPLIERS'),
  async (req, res) => {
    try {
      const { id, fileId } = req.params;
      const { companyId, userId } = req.user;
      const db = getDbConnection(companyId);

      // Verify supplier exists
      const supplier = await db('suppliers').where({ id }).first();

      if (!supplier) {
        return res.status(404).json({
          success: false,
          error: 'Supplier not found'
        });
      }

      // Get attachment record from repository
      const attachment = await supplierAttachments.findById(db, fileId);

      if (!attachment || attachment.supplier_id !== parseInt(id)) {
        return res.status(404).json({
          success: false,
          error: 'Attachment not found'
        });
      }

      // Delete file from S3
      await storageService.deleteFile(attachment.file_key);

      // Delete record from database
      await supplierAttachments.delete(db, fileId);

      auditLog('SUPPLIER_ATTACHMENT_DELETED', userId, {
        supplierId: id,
        supplierName: supplier.name,
        attachmentId: fileId,
        fileName: attachment.file_name
      });

      res.json({
        success: true,
        message: 'Attachment deleted successfully'
      });

    } catch (error) {
      logger.error('Error deleting supplier attachment', {
        error: error.message,
        supplierId: req.params.id,
        fileId: req.params.fileId,
        userId: req.user.userId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to delete attachment'
      });
    }
  }
);

module.exports = router;