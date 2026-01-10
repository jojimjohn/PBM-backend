const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { logger } = require('../utils/logger');
const {
  MAX_FILE_SIZE: S3_MAX_FILE_SIZE,
  ALLOWED_MIME_TYPES,
  isValidFileType,
} = require('../config/s3.config');

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Allowed file types (MIME types)
const ALLOWED_FILE_TYPES = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png'
};

// Maximum file size (5MB)
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB in bytes

/**
 * Configure multer storage with dynamic destination
 */
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // Determine subdirectory based on upload type
    const type = req.params.type || req.body.type || 'general';
    const subDir = path.join(uploadsDir, type);

    // Create subdirectory if it doesn't exist
    if (!fs.existsSync(subDir)) {
      fs.mkdirSync(subDir, { recursive: true });
    }

    cb(null, subDir);
  },
  filename: function (req, file, cb) {
    // Generate unique filename: type-id-timestamp-random-original
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    const nameWithoutExt = path.basename(file.originalname, ext);
    const sanitizedName = nameWithoutExt.replace(/[^a-zA-Z0-9_-]/g, '_');

    const filename = `${sanitizedName}-${uniqueSuffix}${ext}`;
    cb(null, filename);
  }
});

/**
 * File filter to validate file types
 */
const fileFilter = (req, file, cb) => {
  const mimeType = file.mimetype;

  if (ALLOWED_FILE_TYPES[mimeType]) {
    // Accept file
    cb(null, true);
  } else {
    // Reject file with error
    cb(new Error(`Invalid file type. Only PDF, JPG, and PNG files are allowed. Received: ${mimeType}`), false);
  }
};

/**
 * Base multer configuration
 */
const upload = multer({
  storage: storage,
  limits: {
    fileSize: MAX_FILE_SIZE
  },
  fileFilter: fileFilter
});

/**
 * Single file upload middleware
 * Usage: upload.single('attachment')
 */
const uploadSingle = upload.single('attachment');

/**
 * Multiple file upload middleware (max 5 files)
 * Usage: upload.multiple('attachments')
 */
const uploadMultiple = upload.array('attachments', 5);

/**
 * Error handling wrapper for upload middleware
 */
const handleUploadError = (uploadMiddleware) => {
  return (req, res, next) => {
    uploadMiddleware(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        // Multer-specific errors
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            success: false,
            error: `File size exceeds maximum limit of ${MAX_FILE_SIZE / (1024 * 1024)}MB`
          });
        } else if (err.code === 'LIMIT_FILE_COUNT') {
          return res.status(400).json({
            success: false,
            error: 'Too many files uploaded. Maximum 5 files allowed.'
          });
        } else {
          return res.status(400).json({
            success: false,
            error: `Upload error: ${err.message}`
          });
        }
      } else if (err) {
        // Custom errors (e.g., file type validation)
        return res.status(400).json({
          success: false,
          error: err.message
        });
      }

      // No error, proceed
      next();
    });
  };
};

/**
 * Delete file from uploads directory
 */
const deleteFile = (filePath) => {
  try {
    const fullPath = path.join(uploadsDir, filePath);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
      logger.info('File deleted successfully', { filePath });
      return true;
    }
    return false;
  } catch (error) {
    logger.error('Error deleting file', { filePath, error: error.message });
    return false;
  }
};

/**
 * Get file path for download
 */
const getFilePath = (filePath) => {
  return path.join(uploadsDir, filePath);
};

/**
 * Check if file exists
 */
const fileExists = (filePath) => {
  const fullPath = path.join(uploadsDir, filePath);
  return fs.existsSync(fullPath);
};

// ============================================================================
// S3/MinIO Memory Storage Upload Middleware
// ============================================================================
// These middleware functions use memory storage instead of disk storage,
// allowing files to be uploaded directly to S3/MinIO after processing.
// ============================================================================

/**
 * File filter for S3 uploads - validates MIME type
 */
const s3FileFilter = (req, file, cb) => {
  if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPG, PNG, and PDF files are allowed.'), false);
  }
};

/**
 * Multer configuration for S3 uploads (memory storage)
 * Files are stored in memory buffer for direct S3 upload
 */
const s3Upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: S3_MAX_FILE_SIZE,
  },
  fileFilter: s3FileFilter,
});

/**
 * Single file upload middleware for S3
 * File available as req.file with buffer property
 * @param {string} fieldName - Form field name (default: 'file')
 */
const createS3SingleUpload = (fieldName = 'file') => s3Upload.single(fieldName);

/**
 * Multiple file upload middleware for S3
 * Files available as req.files array with buffer properties
 * @param {string} fieldName - Form field name (default: 'files')
 * @param {number} maxCount - Maximum number of files (default: 5)
 */
const createS3MultipleUpload = (fieldName = 'files', maxCount = 5) => s3Upload.array(fieldName, maxCount);

/**
 * Pre-configured S3 single upload middleware (field: 'file')
 */
const uploadSingleToS3 = s3Upload.single('file');

/**
 * Pre-configured S3 multiple upload middleware (field: 'files', max: 5)
 */
const uploadMultipleToS3 = s3Upload.array('files', 5);

/**
 * Error handling wrapper for S3 upload middleware
 * Returns user-friendly error messages for common upload errors
 */
const handleS3UploadError = (uploadMiddleware) => {
  return (req, res, next) => {
    uploadMiddleware(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        // Multer-specific errors
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            success: false,
            error: `File size exceeds maximum limit of ${S3_MAX_FILE_SIZE / (1024 * 1024)}MB`,
          });
        } else if (err.code === 'LIMIT_FILE_COUNT') {
          return res.status(400).json({
            success: false,
            error: 'Too many files uploaded',
          });
        } else if (err.code === 'LIMIT_UNEXPECTED_FILE') {
          return res.status(400).json({
            success: false,
            error: 'Unexpected file field',
          });
        } else {
          return res.status(400).json({
            success: false,
            error: `Upload error: ${err.message}`,
          });
        }
      } else if (err) {
        // Custom errors (e.g., file type validation)
        return res.status(400).json({
          success: false,
          error: err.message,
        });
      }

      // No error, proceed to next middleware
      next();
    });
  };
};

/**
 * Middleware to validate file was actually uploaded
 * Use after upload middleware to ensure file exists
 */
const requireFile = (req, res, next) => {
  if (!req.file && (!req.files || req.files.length === 0)) {
    return res.status(400).json({
      success: false,
      error: 'No file uploaded. Please select a file to upload.',
    });
  }
  next();
};

/**
 * Middleware to validate multiple files were uploaded
 * @param {number} minFiles - Minimum required files (default: 1)
 */
const requireFiles = (minFiles = 1) => {
  return (req, res, next) => {
    if (!req.files || req.files.length < minFiles) {
      return res.status(400).json({
        success: false,
        error: `At least ${minFiles} file(s) required. Please select files to upload.`,
      });
    }
    next();
  };
};

module.exports = {
  // Disk storage uploads (legacy - saves to local uploads/ folder)
  uploadSingle: handleUploadError(uploadSingle),
  uploadMultiple: handleUploadError(uploadMultiple),
  deleteFile,
  getFilePath,
  fileExists,
  ALLOWED_FILE_TYPES,
  MAX_FILE_SIZE,

  // S3/MinIO memory storage uploads (recommended for new code)
  uploadSingleToS3: handleS3UploadError(uploadSingleToS3),
  uploadMultipleToS3: handleS3UploadError(uploadMultipleToS3),
  createS3SingleUpload,
  createS3MultipleUpload,
  handleS3UploadError,
  requireFile,
  requireFiles,
  S3_MAX_FILE_SIZE,
};
