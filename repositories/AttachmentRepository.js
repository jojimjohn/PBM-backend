/**
 * AttachmentRepository
 *
 * Generic repository for managing file attachments across all modules.
 * Unlike BaseRepository, this class is stateless and accepts the database
 * connection as a parameter, enabling transactional operations.
 *
 * Usage:
 * const attachmentRepo = new AttachmentRepository('sales_order_attachments', 'sales_order_id');
 * const attachments = await attachmentRepo.findByReferenceId(db, salesOrderId);
 */

const winston = require('winston');

class AttachmentRepository {
  /**
   * Create a new AttachmentRepository instance
   * @param {string} tableName - The attachment table name (e.g., 'sales_order_attachments')
   * @param {string} foreignKeyColumn - The foreign key column name (e.g., 'sales_order_id')
   */
  constructor(tableName, foreignKeyColumn) {
    this.tableName = tableName;
    this.foreignKeyColumn = foreignKeyColumn;
  }

  /**
   * Create a new attachment record
   * @param {Object} db - Knex database connection or transaction
   * @param {Object} data - Attachment data
   * @param {number} data.referenceId - Parent record ID (maps to foreignKeyColumn)
   * @param {string} data.storageKey - S3 storage key
   * @param {string} data.originalFilename - Original filename
   * @param {string} [data.contentType] - MIME type
   * @param {number} [data.fileSize] - File size in bytes
   * @param {number} [data.uploadedBy] - User ID who uploaded
   * @returns {Promise<Object>} Created attachment with id
   */
  async create(db, data) {
    try {
      const { referenceId, storageKey, originalFilename, contentType, fileSize, uploadedBy } = data;

      const insertData = {
        [this.foreignKeyColumn]: referenceId,
        storage_key: storageKey,
        original_filename: originalFilename,
        content_type: contentType || null,
        file_size: fileSize || null,
        uploaded_by: uploadedBy || null,
        uploaded_at: new Date(),
        is_archived: false,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const [id] = await db(this.tableName).insert(insertData);

      winston.info(`[AttachmentRepository] Attachment created`, {
        table: this.tableName,
        id,
        referenceId,
        storageKey,
      });

      return {
        id,
        ...insertData,
        referenceId, // Include for convenience
      };
    } catch (error) {
      winston.error(`[AttachmentRepository] Error creating attachment`, {
        table: this.tableName,
        error: error.message,
        data,
      });
      throw error;
    }
  }

  /**
   * Find all attachments for a parent record
   * @param {Object} db - Knex database connection or transaction
   * @param {number} referenceId - Parent record ID
   * @param {Object} [options] - Query options
   * @param {boolean} [options.includeArchived=false] - Include archived attachments
   * @param {string} [options.orderBy='uploaded_at'] - Order by column
   * @param {string} [options.orderDirection='desc'] - Order direction
   * @returns {Promise<Array>} Array of attachments with uploader details
   */
  async findByReferenceId(db, referenceId, options = {}) {
    try {
      const {
        includeArchived = false,
        orderBy = 'uploaded_at',
        orderDirection = 'desc',
      } = options;

      let query = db(this.tableName)
        .select(
          `${this.tableName}.id`,
          `${this.tableName}.${this.foreignKeyColumn} as referenceId`,
          `${this.tableName}.storage_key as storageKey`,
          `${this.tableName}.original_filename as originalFilename`,
          `${this.tableName}.content_type as contentType`,
          `${this.tableName}.file_size as fileSize`,
          `${this.tableName}.uploaded_by as uploadedBy`,
          `${this.tableName}.uploaded_at as uploadedAt`,
          `${this.tableName}.is_archived as isArchived`,
          db.raw("CONCAT(users.firstName, ' ', users.lastName) as uploaderName")
        )
        .leftJoin('users', `${this.tableName}.uploaded_by`, 'users.id')
        .where(`${this.tableName}.${this.foreignKeyColumn}`, referenceId);

      if (!includeArchived) {
        query = query.where(`${this.tableName}.is_archived`, false);
      }

      const attachments = await query.orderBy(`${this.tableName}.${orderBy}`, orderDirection);

      return attachments;
    } catch (error) {
      winston.error(`[AttachmentRepository] Error finding attachments`, {
        table: this.tableName,
        referenceId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Find a single attachment by ID
   * @param {Object} db - Knex database connection or transaction
   * @param {number} id - Attachment ID
   * @returns {Promise<Object|null>} Attachment record or null
   */
  async findById(db, id) {
    try {
      const attachment = await db(this.tableName)
        .select(
          `${this.tableName}.id`,
          `${this.tableName}.${this.foreignKeyColumn} as referenceId`,
          `${this.tableName}.storage_key as storageKey`,
          `${this.tableName}.original_filename as originalFilename`,
          `${this.tableName}.content_type as contentType`,
          `${this.tableName}.file_size as fileSize`,
          `${this.tableName}.uploaded_by as uploadedBy`,
          `${this.tableName}.uploaded_at as uploadedAt`,
          `${this.tableName}.is_archived as isArchived`,
          db.raw("CONCAT(users.firstName, ' ', users.lastName) as uploaderName")
        )
        .leftJoin('users', `${this.tableName}.uploaded_by`, 'users.id')
        .where(`${this.tableName}.id`, id)
        .first();

      return attachment || null;
    } catch (error) {
      winston.error(`[AttachmentRepository] Error finding attachment by ID`, {
        table: this.tableName,
        id,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Delete an attachment by ID
   * @param {Object} db - Knex database connection or transaction
   * @param {number} id - Attachment ID
   * @returns {Promise<Object|null>} Deleted attachment data (for S3 cleanup) or null if not found
   */
  async delete(db, id) {
    try {
      // First get the attachment to return storage key for S3 cleanup
      const attachment = await db(this.tableName)
        .select('id', 'storage_key as storageKey', `${this.foreignKeyColumn} as referenceId`)
        .where('id', id)
        .first();

      if (!attachment) {
        return null;
      }

      await db(this.tableName).where('id', id).del();

      winston.info(`[AttachmentRepository] Attachment deleted`, {
        table: this.tableName,
        id,
        storageKey: attachment.storageKey,
      });

      return attachment;
    } catch (error) {
      winston.error(`[AttachmentRepository] Error deleting attachment`, {
        table: this.tableName,
        id,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Delete all attachments for a parent record
   * @param {Object} db - Knex database connection or transaction
   * @param {number} referenceId - Parent record ID
   * @returns {Promise<Array>} Array of deleted attachments (with storage keys for S3 cleanup)
   */
  async deleteByReferenceId(db, referenceId) {
    try {
      // First get all attachments to return storage keys for S3 cleanup
      const attachments = await db(this.tableName)
        .select('id', 'storage_key as storageKey')
        .where(this.foreignKeyColumn, referenceId);

      if (attachments.length === 0) {
        return [];
      }

      await db(this.tableName).where(this.foreignKeyColumn, referenceId).del();

      winston.info(`[AttachmentRepository] All attachments deleted for reference`, {
        table: this.tableName,
        referenceId,
        count: attachments.length,
      });

      return attachments;
    } catch (error) {
      winston.error(`[AttachmentRepository] Error deleting attachments by reference`, {
        table: this.tableName,
        referenceId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Archive an attachment (soft delete)
   * @param {Object} db - Knex database connection or transaction
   * @param {number} id - Attachment ID
   * @returns {Promise<boolean>} True if archived successfully
   */
  async archive(db, id) {
    try {
      const rowsAffected = await db(this.tableName)
        .where('id', id)
        .update({
          is_archived: true,
          updated_at: new Date(),
        });

      if (rowsAffected === 0) {
        return false;
      }

      winston.info(`[AttachmentRepository] Attachment archived`, {
        table: this.tableName,
        id,
      });

      return true;
    } catch (error) {
      winston.error(`[AttachmentRepository] Error archiving attachment`, {
        table: this.tableName,
        id,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Count attachments for a parent record
   * @param {Object} db - Knex database connection or transaction
   * @param {number} referenceId - Parent record ID
   * @param {boolean} [includeArchived=false] - Include archived in count
   * @returns {Promise<number>} Number of attachments
   */
  async countByReferenceId(db, referenceId, includeArchived = false) {
    try {
      let query = db(this.tableName)
        .where(this.foreignKeyColumn, referenceId);

      if (!includeArchived) {
        query = query.where('is_archived', false);
      }

      const [{ count }] = await query.count('* as count');
      return parseInt(count, 10);
    } catch (error) {
      winston.error(`[AttachmentRepository] Error counting attachments`, {
        table: this.tableName,
        referenceId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get table name
   * @returns {string}
   */
  getTableName() {
    return this.tableName;
  }

  /**
   * Get foreign key column name
   * @returns {string}
   */
  getForeignKeyColumn() {
    return this.foreignKeyColumn;
  }
}

/**
 * Pre-configured repository instances for each module
 * Usage: const { salesOrderAttachments } = require('./repositories/AttachmentRepository');
 */
const salesOrderAttachments = new AttachmentRepository('sales_order_attachments', 'sales_order_id');
const purchaseOrderAttachments = new AttachmentRepository('purchase_order_attachments', 'purchase_order_id');
const customerAttachments = new AttachmentRepository('customer_attachments', 'customer_id');
const supplierAttachments = new AttachmentRepository('supplier_attachments', 'supplier_id');
const contractAttachments = new AttachmentRepository('contract_attachments', 'contract_id');
const materialAttachments = new AttachmentRepository('material_attachments', 'material_id');
const wastageAttachments = new AttachmentRepository('wastage_attachments', 'wastage_id');
const projectAttachments = new AttachmentRepository('project_attachments', 'project_id');
const bankTransactionAttachments = new AttachmentRepository('bank_transaction_attachments', 'bank_transaction_id');
const collectionExpenseAttachments = new AttachmentRepository('collection_expense_attachments', 'collection_expense_id');

module.exports = {
  AttachmentRepository,
  // Pre-configured instances
  salesOrderAttachments,
  purchaseOrderAttachments,
  customerAttachments,
  supplierAttachments,
  contractAttachments,
  materialAttachments,
  wastageAttachments,
  projectAttachments,
  bankTransactionAttachments,
  collectionExpenseAttachments,
};
