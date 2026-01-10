/**
 * Storage Service
 *
 * Provides file storage operations using S3/MinIO backend.
 * Handles uploads, downloads (via presigned URLs), and deletions.
 */

const {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const {
  s3Client,
  BUCKET_NAME,
  MAX_FILE_SIZE,
  isS3Available,
  generateReceiptKey,
  generateAttachmentKey,
  isValidFileType,
} = require('../config/s3.config');
const { logger } = require('../utils/logger');

class StorageService {
  /**
   * Upload a file to S3
   * @param {Buffer} buffer - File buffer
   * @param {string} key - S3 object key
   * @param {string} contentType - MIME type
   * @param {Object} metadata - Additional metadata
   * @returns {Promise<{key: string, size: number, contentType: string}>}
   */
  async uploadFile(buffer, key, contentType, metadata = {}) {
    try {
      const command = new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        Metadata: {
          ...metadata,
          uploadedAt: new Date().toISOString(),
        },
      });

      await s3Client.send(command);

      logger.info(`[StorageService] File uploaded successfully: ${key}`);

      return {
        key,
        size: buffer.length,
        contentType,
      };
    } catch (error) {
      logger.error(`[StorageService] Upload failed for ${key}:`, error.message);
      throw new Error(`Failed to upload file: ${error.message}`);
    }
  }

  /**
   * Upload a petty cash receipt
   * @param {Buffer} buffer - File buffer
   * @param {string} originalName - Original filename
   * @param {string} contentType - MIME type
   * @param {string} companyId - Company identifier
   * @param {string} expenseNumber - Expense number (e.g., 'EXP-2025-0001')
   * @param {number} uploadedBy - User ID who uploaded
   * @param {string|Date} expenseDate - Expense date (for year-based folder organization)
   * @returns {Promise<{key: string, size: number, contentType: string}>}
   */
  async uploadReceipt(buffer, originalName, contentType, companyId, expenseNumber, uploadedBy, expenseDate = null) {
    // Validate file type
    if (!isValidFileType(contentType, originalName)) {
      throw new Error('Invalid file type. Only JPG, PNG, and PDF files are allowed.');
    }

    // Validate file size
    if (buffer.length > MAX_FILE_SIZE) {
      throw new Error(`File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB.`);
    }

    const key = generateReceiptKey(companyId, expenseNumber, originalName, expenseDate);

    return this.uploadFile(buffer, key, contentType, {
      originalName,
      companyId,
      expenseNumber: String(expenseNumber),
      uploadedBy: String(uploadedBy),
    });
  }

  /**
   * Upload an attachment for any module (generic version)
   *
   * @param {Buffer} buffer - File buffer
   * @param {string} originalName - Original filename
   * @param {string} contentType - MIME type
   * @param {Object} options - Upload options
   * @param {string} options.companyId - Company identifier (e.g., 'al-ramrami')
   * @param {string} options.module - Module name (e.g., 'sales-orders', 'customers')
   * @param {string} options.referenceCode - Reference code (e.g., 'SO-2025-0001', 'CUST-001')
   * @param {number|string} options.uploadedBy - User ID who uploaded
   * @param {string|Date} [options.referenceDate] - Reference date for year folder (defaults to current date)
   * @returns {Promise<{key: string, size: number, contentType: string, originalName: string}>}
   *
   * @example
   * // Upload sales order attachment
   * await storageService.uploadAttachment(buffer, 'invoice.pdf', 'application/pdf', {
   *   companyId: 'al-ramrami',
   *   module: 'sales-orders',
   *   referenceCode: 'SO-2025-0001',
   *   uploadedBy: 5
   * });
   */
  async uploadAttachment(buffer, originalName, contentType, options) {
    const { companyId, module, referenceCode, uploadedBy, referenceDate = null } = options;

    // Validate required options
    if (!companyId || !module || !referenceCode) {
      throw new Error('Missing required options: companyId, module, and referenceCode are required');
    }

    // Validate file type
    if (!isValidFileType(contentType, originalName)) {
      throw new Error('Invalid file type. Only JPG, PNG, and PDF files are allowed.');
    }

    // Validate file size
    if (buffer.length > MAX_FILE_SIZE) {
      throw new Error(`File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB.`);
    }

    const key = generateAttachmentKey(companyId, module, referenceCode, originalName, referenceDate);

    const result = await this.uploadFile(buffer, key, contentType, {
      originalName,
      companyId,
      module,
      referenceCode,
      uploadedBy: uploadedBy ? String(uploadedBy) : undefined,
    });

    return {
      ...result,
      originalName,
    };
  }

  /**
   * Generate a presigned URL for downloading a file
   * @param {string} key - S3 object key
   * @param {number} expiresIn - URL expiry in seconds (default: 1 hour)
   * @returns {Promise<string>} Presigned download URL
   */
  async getDownloadUrl(key, expiresIn = 3600) {
    try {
      const command = new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
      });

      const url = await getSignedUrl(s3Client, command, { expiresIn });

      logger.debug(`[StorageService] Generated download URL for: ${key}`);

      return url;
    } catch (error) {
      logger.error(`[StorageService] Failed to generate download URL for ${key}:`, error.message);
      throw new Error(`Failed to generate download URL: ${error.message}`);
    }
  }

  /**
   * Delete a file from S3
   * @param {string} key - S3 object key
   * @returns {Promise<boolean>} True if deleted successfully
   */
  async deleteFile(key) {
    try {
      const command = new DeleteObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
      });

      await s3Client.send(command);

      logger.info(`[StorageService] File deleted: ${key}`);

      return true;
    } catch (error) {
      logger.error(`[StorageService] Delete failed for ${key}:`, error.message);
      throw new Error(`Failed to delete file: ${error.message}`);
    }
  }

  /**
   * Check if a file exists in S3
   * @param {string} key - S3 object key
   * @returns {Promise<boolean>} True if file exists
   */
  async fileExists(key) {
    try {
      const command = new HeadObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
      });

      await s3Client.send(command);
      return true;
    } catch (error) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        return false;
      }
      logger.error(`[StorageService] Error checking file existence for ${key}:`, error.message);
      throw error;
    }
  }

  /**
   * Get file metadata from S3
   * @param {string} key - S3 object key
   * @returns {Promise<Object>} File metadata
   */
  async getFileInfo(key) {
    try {
      const command = new HeadObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
      });

      const response = await s3Client.send(command);

      return {
        key,
        size: response.ContentLength,
        contentType: response.ContentType,
        lastModified: response.LastModified,
        metadata: response.Metadata,
      };
    } catch (error) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        return null;
      }
      logger.error(`[StorageService] Error getting file info for ${key}:`, error.message);
      throw error;
    }
  }

  /**
   * Check if S3 storage is available
   * @returns {Promise<boolean>}
   */
  async isAvailable() {
    return isS3Available();
  }
}

// Export singleton instance
module.exports = new StorageService();
