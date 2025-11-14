const express = require('express');
const router = express.Router();
const { uploadSingle, uploadMultiple } = require('../middleware/upload');
const { authenticateToken, requirePermission } = require('../middleware/auth');
const { getDbConnection } = require('../config/database');
const path = require('path');
const fs = require('fs').promises;
const { logger } = require('../utils/logger');

/**
 * Upload Routes
 *
 * Handles file upload operations for various entities:
 * - Purchase Orders (multiple attachments)
 * - Sales Orders (multiple attachments)
 * - Contracts (multiple attachments)
 * - Purchase Invoices (single attachment)
 * - Petty Cash Receipts (single attachment)
 */

// ===========================
// MULTIPLE FILE UPLOADS
// ===========================

/**
 * POST /api/uploads/purchase-orders/:id/attachments
 * Upload multiple attachments to a purchase order
 */
router.post('/purchase-orders/:id/attachments',
  authenticateToken,
  requirePermission('CREATE_PURCHASE'),
  (req, res, next) => {
    req.params.type = 'purchase-orders';
    next();
  },
  uploadMultiple,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { companyId, userId } = req.user;
      const db = getDbConnection(companyId);

      // Get existing attachments
      const po = await db('purchase_orders').where({ id }).first();
      if (!po) {
        return res.status(404).json({
          success: false,
          error: 'Purchase order not found'
        });
      }

      // Parse attachments (handle both string and object from DB)
      let existingAttachments = [];
      if (po.attachments) {
        if (typeof po.attachments === 'string') {
          existingAttachments = JSON.parse(po.attachments);
        } else if (Array.isArray(po.attachments)) {
          existingAttachments = po.attachments;
        }
      }

      // Add new files
      const newFiles = req.files.map(file => ({
        filename: file.filename,
        originalName: file.originalname,
        path: `purchase-orders/${file.filename}`,
        size: file.size,
        mimetype: file.mimetype,
        uploadedAt: new Date().toISOString(),
        uploadedBy: userId
      }));

      const allAttachments = [...existingAttachments, ...newFiles];

      // Update database - manually serialize to JSON string
      await db('purchase_orders')
        .where({ id })
        .update({
          attachments: JSON.stringify(allAttachments),
          updated_at: db.fn.now()
        });

      logger.info(`Uploaded ${newFiles.length} file(s) to PO ${id}`, { userId, companyId });

      res.json({
        success: true,
        data: newFiles,
        message: `${newFiles.length} file(s) uploaded successfully`
      });
    } catch (error) {
      logger.error('Error uploading PO attachments:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to upload attachments'
      });
    }
  }
);

/**
 * POST /api/uploads/sales-orders/:id/attachments
 * Upload multiple attachments to a sales order
 */
router.post('/sales-orders/:id/attachments',
  authenticateToken,
  requirePermission('CREATE_SALE'),
  (req, res, next) => {
    req.params.type = 'sales-orders';
    next();
  },
  uploadMultiple,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { companyId, userId } = req.user;
      const db = getDbConnection(companyId);

      // Get existing attachments
      const so = await db('sales_orders').where({ id }).first();
      if (!so) {
        return res.status(404).json({
          success: false,
          error: 'Sales order not found'
        });
      }

      // Parse attachments (handle both string and object from DB)
      let existingAttachments = [];
      if (so.attachments) {
        if (typeof so.attachments === 'string') {
          existingAttachments = JSON.parse(so.attachments);
        } else if (Array.isArray(so.attachments)) {
          existingAttachments = so.attachments;
        }
      }

      // Add new files
      const newFiles = req.files.map(file => ({
        filename: file.filename,
        originalName: file.originalname,
        path: `sales-orders/${file.filename}`,
        size: file.size,
        mimetype: file.mimetype,
        uploadedAt: new Date().toISOString(),
        uploadedBy: userId
      }));

      const allAttachments = [...existingAttachments, ...newFiles];

      // Update database - manually serialize to JSON string
      await db('sales_orders')
        .where({ id })
        .update({
          attachments: JSON.stringify(allAttachments),
          updated_at: db.fn.now()
        });

      logger.info(`Uploaded ${newFiles.length} file(s) to SO ${id}`, { userId, companyId });

      res.json({
        success: true,
        data: newFiles,
        message: `${newFiles.length} file(s) uploaded successfully`
      });
    } catch (error) {
      logger.error('Error uploading SO attachments:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to upload attachments'
      });
    }
  }
);

/**
 * POST /api/uploads/contracts/:id/attachments
 * Upload multiple attachments to a contract
 */
router.post('/contracts/:id/attachments',
  authenticateToken,
  requirePermission('CREATE_CONTRACT'),
  (req, res, next) => {
    req.params.type = 'contracts';
    next();
  },
  uploadMultiple,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { companyId, userId } = req.user;
      const db = getDbConnection(companyId);

      // Get existing attachments
      const contract = await db('contracts').where({ id }).first();
      if (!contract) {
        return res.status(404).json({
          success: false,
          error: 'Contract not found'
        });
      }

      // Parse attachments (handle both string and object from DB)
      let existingAttachments = [];
      if (contract.attachments) {
        if (typeof contract.attachments === 'string') {
          existingAttachments = JSON.parse(contract.attachments);
        } else if (Array.isArray(contract.attachments)) {
          existingAttachments = contract.attachments;
        }
      }

      // Add new files
      const newFiles = req.files.map(file => ({
        filename: file.filename,
        originalName: file.originalname,
        path: `contracts/${file.filename}`,
        size: file.size,
        mimetype: file.mimetype,
        uploadedAt: new Date().toISOString(),
        uploadedBy: userId
      }));

      const allAttachments = [...existingAttachments, ...newFiles];

      // Update database - manually serialize to JSON string
      await db('contracts')
        .where({ id })
        .update({
          attachments: JSON.stringify(allAttachments),
          updated_at: db.fn.now()
        });

      logger.info(`Uploaded ${newFiles.length} file(s) to Contract ${id}`, { userId, companyId });

      res.json({
        success: true,
        data: newFiles,
        message: `${newFiles.length} file(s) uploaded successfully`
      });
    } catch (error) {
      logger.error('Error uploading contract attachments:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to upload attachments'
      });
    }
  }
);

// ===========================
// SINGLE FILE UPLOADS
// ===========================

/**
 * POST /api/uploads/invoices/:id/attachment
 * Upload single attachment to a purchase invoice
 */
router.post('/invoices/:id/attachment',
  authenticateToken,
  requirePermission('CREATE_PURCHASE'),
  (req, res, next) => {
    req.params.type = 'invoices';
    next();
  },
  uploadSingle,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { companyId, userId } = req.user;
      const db = getDbConnection(companyId);

      // Check if invoice exists
      const invoice = await db('purchase_invoices').where({ id }).first();
      if (!invoice) {
        return res.status(404).json({
          success: false,
          error: 'Invoice not found'
        });
      }

      // Delete old file if exists
      if (invoice.attachment) {
        const oldFilePath = path.join(__dirname, '../uploads', invoice.attachment);
        try {
          await fs.unlink(oldFilePath);
        } catch (err) {
          logger.warn('Old invoice attachment not found on disk:', oldFilePath);
        }
      }

      // Update database with new file
      const filePath = `invoices/${req.file.filename}`;
      await db('purchase_invoices')
        .where({ id })
        .update({
          attachment: filePath,
          updated_at: db.fn.now()
        });

      logger.info(`Uploaded attachment to Invoice ${id}`, { userId, companyId });

      res.json({
        success: true,
        data: {
          filename: req.file.filename,
          path: filePath,
          size: req.file.size
        },
        message: 'File uploaded successfully'
      });
    } catch (error) {
      logger.error('Error uploading invoice attachment:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to upload attachment'
      });
    }
  }
);

/**
 * POST /api/uploads/receipts/:id/attachment
 * Upload single receipt to a petty cash expense
 */
router.post('/receipts/:id/attachment',
  authenticateToken,
  requirePermission('CREATE_EXPENSE'),
  (req, res, next) => {
    req.params.type = 'receipts';
    next();
  },
  uploadSingle,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { companyId, userId } = req.user;
      const db = getDbConnection(companyId);

      // Check if expense exists
      const expense = await db('petty_cash_expenses').where({ id }).first();
      if (!expense) {
        return res.status(404).json({
          success: false,
          error: 'Expense not found'
        });
      }

      // Delete old file if exists
      if (expense.receipt) {
        const oldFilePath = path.join(__dirname, '../uploads', expense.receipt);
        try {
          await fs.unlink(oldFilePath);
        } catch (err) {
          logger.warn('Old receipt not found on disk:', oldFilePath);
        }
      }

      // Update database with new file
      const filePath = `receipts/${req.file.filename}`;
      await db('petty_cash_expenses')
        .where({ id })
        .update({
          receipt: filePath,
          updated_at: db.fn.now()
        });

      logger.info(`Uploaded receipt to Expense ${id}`, { userId, companyId });

      res.json({
        success: true,
        data: {
          filename: req.file.filename,
          path: filePath,
          size: req.file.size
        },
        message: 'Receipt uploaded successfully'
      });
    } catch (error) {
      logger.error('Error uploading receipt:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to upload receipt'
      });
    }
  }
);

// ===========================
// DELETE OPERATIONS
// ===========================

/**
 * DELETE /api/uploads/:entity/:id/attachments/:filename
 * Delete an attachment from multiple-file entities
 */
router.delete('/:entity/:id/attachments/:filename',
  authenticateToken,
  requirePermission('EDIT_PURCHASE'),
  async (req, res) => {
    try {
      const { entity, id, filename } = req.params;
      const { companyId, userId } = req.user;
      const db = getDbConnection(companyId);

      // Map entity to table name
      const tableMap = {
        'purchase-orders': 'purchase_orders',
        'sales-orders': 'sales_orders',
        'contracts': 'contracts'
      };

      const tableName = tableMap[entity];
      if (!tableName) {
        return res.status(400).json({
          success: false,
          error: 'Invalid entity type'
        });
      }

      // Get record
      const record = await db(tableName).where({ id }).first();
      if (!record) {
        return res.status(404).json({
          success: false,
          error: 'Record not found'
        });
      }

      // Parse attachments (handle both string and object from DB)
      let attachments = [];
      if (record.attachments) {
        if (typeof record.attachments === 'string') {
          attachments = JSON.parse(record.attachments);
        } else if (Array.isArray(record.attachments)) {
          attachments = record.attachments;
        }
      }
      const fileToDelete = attachments.find(a => a.filename === filename);

      if (!fileToDelete) {
        return res.status(404).json({
          success: false,
          error: 'File not found'
        });
      }

      // Delete from filesystem
      const filePath = path.join(__dirname, '../uploads', fileToDelete.path);
      try {
        await fs.unlink(filePath);
      } catch (err) {
        logger.warn('File not found on disk:', filePath);
      }

      // Update database - manually serialize to JSON string
      const updatedAttachments = attachments.filter(a => a.filename !== filename);
      await db(tableName)
        .where({ id })
        .update({
          attachments: JSON.stringify(updatedAttachments),
          updated_at: db.fn.now()
        });

      logger.info(`Deleted attachment from ${entity} ${id}`, { userId, companyId, filename });

      res.json({
        success: true,
        message: 'File deleted successfully'
      });
    } catch (error) {
      logger.error('Error deleting attachment:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to delete attachment'
      });
    }
  }
);

/**
 * DELETE /api/uploads/:entity/:id/attachment
 * Delete single attachment from single-file entities
 */
router.delete('/:entity/:id/attachment',
  authenticateToken,
  requirePermission('EDIT_PURCHASE'),
  async (req, res) => {
    try {
      const { entity, id } = req.params;
      const { companyId, userId } = req.user;
      const db = getDbConnection(companyId);

      // Map entity to table name and column
      const entityConfig = {
        'invoices': { table: 'purchase_invoices', column: 'attachment' },
        'receipts': { table: 'petty_cash_expenses', column: 'receipt' }
      };

      const config = entityConfig[entity];
      if (!config) {
        return res.status(400).json({
          success: false,
          error: 'Invalid entity type'
        });
      }

      // Get record
      const record = await db(config.table).where({ id }).first();
      if (!record) {
        return res.status(404).json({
          success: false,
          error: 'Record not found'
        });
      }

      const filePath = record[config.column];
      if (!filePath) {
        return res.status(404).json({
          success: false,
          error: 'No file attached'
        });
      }

      // Delete from filesystem
      const fullPath = path.join(__dirname, '../uploads', filePath);
      try {
        await fs.unlink(fullPath);
      } catch (err) {
        logger.warn('File not found on disk:', fullPath);
      }

      // Update database
      await db(config.table)
        .where({ id })
        .update({
          [config.column]: null,
          updated_at: db.fn.now()
        });

      logger.info(`Deleted ${config.column} from ${entity} ${id}`, { userId, companyId });

      res.json({
        success: true,
        message: 'File deleted successfully'
      });
    } catch (error) {
      logger.error('Error deleting file:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to delete file'
      });
    }
  }
);

// ===========================
// FILE SERVING
// ===========================

/**
 * GET /api/uploads/:type/:filename
 * Serve uploaded files (public access - files are already secure by obscurity)
 *
 * Note: Authentication removed to allow direct browser access via <a> tags
 * Security: Files are named with unique timestamps and UUIDs, not publicly listed
 */
router.get('/:type/:filename',
  async (req, res) => {
    try {
      const { type, filename } = req.params;
      const filePath = path.join(__dirname, '../uploads', type, filename);

      // Check file exists
      await fs.access(filePath);

      // Send file
      res.sendFile(filePath);
    } catch (error) {
      logger.error('Error serving file:', error);
      res.status(404).json({
        success: false,
        error: 'File not found'
      });
    }
  }
);

module.exports = router;
