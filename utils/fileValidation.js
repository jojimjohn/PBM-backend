/**
 * File Signature (Magic Bytes) Validation Utility
 *
 * Validates that uploaded files are actually what they claim to be by checking
 * their "magic bytes" - the first few bytes that identify file type.
 *
 * Why this matters:
 * - File extensions can be faked (rename malware.exe → image.jpg)
 * - MIME types from browser can be spoofed
 * - Magic bytes are embedded in the file and can't be easily faked
 *
 * Security: Prevents malicious file uploads disguised as images/PDFs
 */

const { logger } = require('./logger');

/**
 * File signatures (magic bytes) for common file types
 * Each entry: { mimeTypes: [allowed mimes], signatures: [[byte arrays]] }
 */
const FILE_SIGNATURES = {
  // JPEG images - FFD8FF followed by E0, E1, E2, E3, or DB
  jpeg: {
    mimeTypes: ['image/jpeg', 'image/jpg'],
    signatures: [
      [0xFF, 0xD8, 0xFF, 0xE0],  // JFIF
      [0xFF, 0xD8, 0xFF, 0xE1],  // EXIF
      [0xFF, 0xD8, 0xFF, 0xE2],  // Canon
      [0xFF, 0xD8, 0xFF, 0xE3],  // Samsung
      [0xFF, 0xD8, 0xFF, 0xDB],  // Raw JPEG
      [0xFF, 0xD8, 0xFF, 0xEE],  // Adobe
    ],
    extensions: ['.jpg', '.jpeg']
  },

  // PNG images
  png: {
    mimeTypes: ['image/png'],
    signatures: [
      [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]  // PNG signature
    ],
    extensions: ['.png']
  },

  // GIF images
  gif: {
    mimeTypes: ['image/gif'],
    signatures: [
      [0x47, 0x49, 0x46, 0x38, 0x37, 0x61],  // GIF87a
      [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],  // GIF89a
    ],
    extensions: ['.gif']
  },

  // WebP images
  webp: {
    mimeTypes: ['image/webp'],
    signatures: [
      // RIFF....WEBP (bytes 0-3 are RIFF, bytes 8-11 are WEBP)
      // We check RIFF at start
      [0x52, 0x49, 0x46, 0x46]  // RIFF (need to also check WEBP at offset 8)
    ],
    extensions: ['.webp'],
    extraCheck: (buffer) => {
      // Check for WEBP at offset 8
      if (buffer.length < 12) return false;
      return buffer[8] === 0x57 && buffer[9] === 0x45 &&
             buffer[10] === 0x42 && buffer[11] === 0x50;
    }
  },

  // PDF documents
  pdf: {
    mimeTypes: ['application/pdf'],
    signatures: [
      [0x25, 0x50, 0x44, 0x46, 0x2D]  // %PDF-
    ],
    extensions: ['.pdf']
  },

  // Microsoft Excel (xlsx - actually a ZIP with specific contents)
  xlsx: {
    mimeTypes: [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel'
    ],
    signatures: [
      [0x50, 0x4B, 0x03, 0x04],  // ZIP signature (xlsx is a ZIP)
      [0x50, 0x4B, 0x05, 0x06],  // Empty ZIP
      [0x50, 0x4B, 0x07, 0x08],  // Spanned ZIP
    ],
    extensions: ['.xlsx', '.xls']
  },

  // Microsoft Word (docx - actually a ZIP)
  docx: {
    mimeTypes: [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword'
    ],
    signatures: [
      [0x50, 0x4B, 0x03, 0x04],  // ZIP signature
    ],
    extensions: ['.docx', '.doc']
  },

  // CSV and text files (no magic bytes, but check for printable ASCII)
  csv: {
    mimeTypes: ['text/csv', 'text/plain', 'application/csv'],
    signatures: null,  // No magic bytes for text files
    extensions: ['.csv', '.txt'],
    textValidation: true  // Special handling for text files
  }
};

/**
 * Check if a buffer starts with a specific byte sequence
 * @param {Buffer} buffer - File buffer to check
 * @param {number[]} signature - Expected byte sequence
 * @returns {boolean} True if buffer starts with signature
 */
const matchesSignature = (buffer, signature) => {
  if (buffer.length < signature.length) {
    return false;
  }

  for (let i = 0; i < signature.length; i++) {
    if (buffer[i] !== signature[i]) {
      return false;
    }
  }

  return true;
};

/**
 * Validate file signature against claimed MIME type
 * @param {Buffer} buffer - File buffer (at least first 16 bytes)
 * @param {string} claimedMimeType - MIME type claimed by upload
 * @returns {{ valid: boolean, detectedType: string|null, reason: string }}
 */
const validateFileSignature = (buffer, claimedMimeType) => {
  // Ensure we have a buffer to check
  if (!buffer || buffer.length < 4) {
    return {
      valid: false,
      detectedType: null,
      reason: 'File too small or empty'
    };
  }

  // Normalize MIME type
  const normalizedMime = claimedMimeType?.toLowerCase().trim();

  // Find file type definition that matches claimed MIME
  let expectedType = null;
  for (const [typeName, typeDef] of Object.entries(FILE_SIGNATURES)) {
    if (typeDef.mimeTypes.includes(normalizedMime)) {
      expectedType = { name: typeName, ...typeDef };
      break;
    }
  }

  // If MIME type not in our whitelist, reject
  if (!expectedType) {
    return {
      valid: false,
      detectedType: null,
      reason: `Unsupported file type: ${normalizedMime}`
    };
  }

  // Special handling for text files (no magic bytes)
  if (expectedType.textValidation) {
    // Check if file appears to be text (printable ASCII/UTF-8)
    const isText = isLikelyTextFile(buffer);
    return {
      valid: isText,
      detectedType: isText ? expectedType.name : null,
      reason: isText ? 'Valid text file' : 'File contains non-text binary data'
    };
  }

  // Check signatures
  if (!expectedType.signatures) {
    return {
      valid: true,
      detectedType: expectedType.name,
      reason: 'No signature validation for this type'
    };
  }

  // Try to match any of the valid signatures
  for (const signature of expectedType.signatures) {
    if (matchesSignature(buffer, signature)) {
      // Run extra check if defined
      if (expectedType.extraCheck && !expectedType.extraCheck(buffer)) {
        continue;  // Try next signature
      }

      return {
        valid: true,
        detectedType: expectedType.name,
        reason: `Valid ${expectedType.name} file`
      };
    }
  }

  // No signature matched - try to detect what type it actually is
  const actualType = detectFileType(buffer);

  return {
    valid: false,
    detectedType: actualType,
    reason: actualType
      ? `File appears to be ${actualType}, not ${expectedType.name}`
      : `Invalid ${expectedType.name} file signature`
  };
};

/**
 * Try to detect file type from magic bytes
 * @param {Buffer} buffer - File buffer
 * @returns {string|null} Detected file type name or null
 */
const detectFileType = (buffer) => {
  for (const [typeName, typeDef] of Object.entries(FILE_SIGNATURES)) {
    if (!typeDef.signatures) continue;

    for (const signature of typeDef.signatures) {
      if (matchesSignature(buffer, signature)) {
        // Run extra check if defined
        if (typeDef.extraCheck && !typeDef.extraCheck(buffer)) {
          continue;
        }
        return typeName;
      }
    }
  }

  return null;
};

/**
 * Check if buffer appears to be a text file
 * @param {Buffer} buffer - File buffer
 * @returns {boolean} True if likely text file
 */
const isLikelyTextFile = (buffer) => {
  // Check first 1KB for text-like content
  const checkLength = Math.min(buffer.length, 1024);

  for (let i = 0; i < checkLength; i++) {
    const byte = buffer[i];

    // Allow printable ASCII (32-126), tab (9), newline (10), carriage return (13)
    // Also allow UTF-8 continuation bytes (128-255) for international chars
    const isPrintable =
      (byte >= 32 && byte <= 126) ||  // Printable ASCII
      byte === 9 ||   // Tab
      byte === 10 ||  // LF
      byte === 13 ||  // CR
      byte >= 128;    // UTF-8 continuation

    if (!isPrintable) {
      // Found a suspicious byte - likely binary
      // Exception: BOM markers at start
      if (i < 4 && (byte === 0xEF || byte === 0xBB || byte === 0xBF || byte === 0xFE || byte === 0xFF)) {
        continue;  // UTF-8/16 BOM
      }
      return false;
    }
  }

  return true;
};

/**
 * Get list of allowed MIME types
 * @returns {string[]} Array of allowed MIME types
 */
const getAllowedMimeTypes = () => {
  const mimeTypes = new Set();
  for (const typeDef of Object.values(FILE_SIGNATURES)) {
    typeDef.mimeTypes.forEach(mime => mimeTypes.add(mime));
  }
  return Array.from(mimeTypes);
};

/**
 * Get list of allowed extensions
 * @returns {string[]} Array of allowed extensions
 */
const getAllowedExtensions = () => {
  const extensions = new Set();
  for (const typeDef of Object.values(FILE_SIGNATURES)) {
    typeDef.extensions.forEach(ext => extensions.add(ext));
  }
  return Array.from(extensions);
};

/**
 * Express middleware for validating uploaded files
 * Use after multer middleware to validate file signatures
 *
 * @param {Object} options - Middleware options
 * @param {string[]} options.allowedTypes - Array of allowed type names (e.g., ['jpeg', 'png', 'pdf'])
 * @returns {Function} Express middleware
 */
const validateUploadMiddleware = (options = {}) => {
  const { allowedTypes = null } = options;

  return (req, res, next) => {
    // Check if there's a file to validate
    const file = req.file || (req.files && req.files[0]);

    if (!file) {
      // No file uploaded - let route handler decide if that's OK
      return next();
    }

    // Validate file signature
    const result = validateFileSignature(file.buffer, file.mimetype);

    if (!result.valid) {
      logger.warn('File signature validation failed', {
        filename: file.originalname,
        claimedMime: file.mimetype,
        detectedType: result.detectedType,
        reason: result.reason,
        ip: req.ip
      });

      return res.status(400).json({
        success: false,
        error: 'Invalid file type',
        message: result.reason,
        code: 'INVALID_FILE_SIGNATURE'
      });
    }

    // If specific types are required, check against them
    if (allowedTypes && !allowedTypes.includes(result.detectedType)) {
      logger.warn('File type not in allowed list', {
        filename: file.originalname,
        detectedType: result.detectedType,
        allowedTypes,
        ip: req.ip
      });

      return res.status(400).json({
        success: false,
        error: 'File type not allowed',
        message: `Only ${allowedTypes.join(', ')} files are accepted`,
        code: 'FILE_TYPE_NOT_ALLOWED'
      });
    }

    // Add validated type to request for route handler
    req.validatedFileType = result.detectedType;

    next();
  };
};

module.exports = {
  validateFileSignature,
  detectFileType,
  isLikelyTextFile,
  getAllowedMimeTypes,
  getAllowedExtensions,
  validateUploadMiddleware,
  FILE_SIGNATURES
};
