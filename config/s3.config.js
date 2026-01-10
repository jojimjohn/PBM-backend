/**
 * S3/MinIO Configuration
 *
 * Configures the S3 client for MinIO storage backend.
 * Uses environment variables for credentials.
 */

const { S3Client, HeadBucketCommand } = require('@aws-sdk/client-s3');

// S3 Client Configuration
const s3Client = new S3Client({
  endpoint: process.env.MINIO_ENDPOINT || 'https://pbm-s3.alramramiapp.com',
  region: 'us-east-1', // Required by SDK but ignored by MinIO
  credentials: {
    accessKeyId: process.env.MINIO_ACCESS_KEY || '',
    secretAccessKey: process.env.MINIO_SECRET_KEY || '',
  },
  forcePathStyle: true, // Required for MinIO compatibility
});

// Constants
const BUCKET_NAME = process.env.MINIO_BUCKET || 'pbm-files';
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

// Allowed file types for receipts
const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'application/pdf',
];

const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.pdf'];

/**
 * Check if S3 is properly configured and accessible
 * @returns {Promise<boolean>} True if S3 is available
 */
async function isS3Available() {
  // Check if credentials are configured
  if (!process.env.MINIO_ACCESS_KEY || !process.env.MINIO_SECRET_KEY) {
    console.warn('[S3] Missing credentials - S3 storage not available');
    return false;
  }

  try {
    // Try to access the bucket
    await s3Client.send(new HeadBucketCommand({ Bucket: BUCKET_NAME }));
    return true;
  } catch (error) {
    console.error('[S3] Connection check failed:', error.message);
    return false;
  }
}

/**
 * Generate S3 key for petty cash receipts
 * Path structure: {companyId}/{year}/petty-cash/{expenseNumber}/receipt-{timestamp}.{ext}
 * Example: al-ramrami/2025/petty-cash/EXP-2025-0001/receipt-1704067200000.jpg
 *
 * @param {string} companyId - Company identifier (e.g., 'al-ramrami', 'pride-muscat')
 * @param {string} expenseNumber - Expense number (e.g., 'EXP-2025-0001')
 * @param {string} filename - Original filename
 * @param {string|Date} expenseDate - Expense date (used to determine year folder)
 * @returns {string} S3 object key
 */
function generateReceiptKey(companyId, expenseNumber, filename, expenseDate = null) {
  const timestamp = Date.now();
  const ext = filename.substring(filename.lastIndexOf('.'));

  // Determine year from expense date, falling back to current year
  let year;
  if (expenseDate) {
    const date = expenseDate instanceof Date ? expenseDate : new Date(expenseDate);
    year = date.getFullYear();
  } else {
    year = new Date().getFullYear();
  }

  // Company/Year path for easier bucket policies and chronological organization
  return `${companyId}/${year}/petty-cash/${expenseNumber}/receipt-${timestamp}${ext}`;
}

/**
 * Validate file type for upload
 * @param {string} mimeType - MIME type of the file
 * @param {string} filename - Original filename
 * @returns {boolean} True if file type is allowed
 */
function isValidFileType(mimeType, filename) {
  const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();
  return ALLOWED_MIME_TYPES.includes(mimeType) && ALLOWED_EXTENSIONS.includes(ext);
}

/**
 * Generate S3 key for any module attachments (generic version)
 * Path structure: {companyId}/{year}/{module}/{referenceCode}/{filename-timestamp}.{ext}
 *
 * @param {string} companyId - Company identifier (e.g., 'al-ramrami', 'pride-muscat')
 * @param {string} module - Module name (e.g., 'sales-orders', 'purchase-orders', 'customers')
 * @param {string} referenceCode - Reference code (e.g., 'SO-2025-0001', 'CUST-001')
 * @param {string} filename - Original filename
 * @param {string|Date|null} referenceDate - Reference date for year folder (defaults to current date)
 * @returns {string} S3 object key
 *
 * @example
 * // Sales order attachment
 * generateAttachmentKey('al-ramrami', 'sales-orders', 'SO-2025-0001', 'invoice.pdf')
 * // Returns: al-ramrami/2025/sales-orders/SO-2025-0001/invoice-1704067200000.pdf
 *
 * @example
 * // Customer document
 * generateAttachmentKey('al-ramrami', 'customers', 'CUST-001', 'contract.pdf')
 * // Returns: al-ramrami/2025/customers/CUST-001/contract-1704067200000.pdf
 */
function generateAttachmentKey(companyId, module, referenceCode, filename, referenceDate = null) {
  const timestamp = Date.now();

  // Extract file extension
  const lastDotIndex = filename.lastIndexOf('.');
  const ext = lastDotIndex !== -1 ? filename.substring(lastDotIndex) : '';
  const baseName = lastDotIndex !== -1 ? filename.substring(0, lastDotIndex) : filename;

  // Sanitize base name: remove special characters, replace spaces with dashes
  const sanitizedBaseName = baseName
    .toLowerCase()
    .replace(/[^a-z0-9\-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50); // Limit length to prevent overly long keys

  // Determine year from reference date, falling back to current year
  let year;
  if (referenceDate) {
    const date = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
    year = date.getFullYear();
  } else {
    year = new Date().getFullYear();
  }

  // Build the S3 key: companyId/year/module/referenceCode/sanitizedName-timestamp.ext
  return `${companyId}/${year}/${module}/${referenceCode}/${sanitizedBaseName}-${timestamp}${ext}`;
}

module.exports = {
  s3Client,
  BUCKET_NAME,
  MAX_FILE_SIZE,
  ALLOWED_MIME_TYPES,
  ALLOWED_EXTENSIONS,
  isS3Available,
  generateReceiptKey,
  generateAttachmentKey,
  isValidFileType,
};
