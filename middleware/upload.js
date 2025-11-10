const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { logger } = require('../utils/logger');

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

module.exports = {
  uploadSingle: handleUploadError(uploadSingle),
  uploadMultiple: handleUploadError(uploadMultiple),
  deleteFile,
  getFilePath,
  fileExists,
  ALLOWED_FILE_TYPES,
  MAX_FILE_SIZE
};
