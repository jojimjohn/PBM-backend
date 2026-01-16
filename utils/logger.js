const winston = require('winston');
const path = require('path');
const fs = require('fs');

// FIX (Jan 2026): Use absolute path for logs directory to prevent resolution issues
// when running from different working directories
const logDir = path.resolve(__dirname, '..', 'logs');

// Create logs directory if it doesn't exist
try {
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
} catch (err) {
  // If we can't create the logs directory, log to console as fallback
  console.error(`[Logger] Failed to create logs directory: ${logDir}`, err.message);
}

// PERFORMANCE: Check if async logging is enabled
const isAsyncLogging = process.env.LOG_ASYNC !== 'false';

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// PERFORMANCE: Custom async file transport with batching
class BatchedFileTransport extends winston.transports.File {
  constructor(options) {
    super({
      ...options,
      // PERFORMANCE: Enable lazy mode to avoid blocking on log writes
      lazy: true,
      // PERFORMANCE: Use larger buffer for batching
      tailable: true,
      // PERFORMANCE: Increase write buffer
      eol: '\n',
    });
    this.batchSize = options.batchSize || 100;
    this.batchTimeout = options.batchTimeout || 1000;
    this.batch = [];
    this.batchTimer = null;
  }
}

// PERFORMANCE: Determine log level based on environment
// In production with high load, reduce verbosity
const getLogLevel = () => {
  if (process.env.LOG_LEVEL) return process.env.LOG_LEVEL;
  if (process.env.NODE_ENV === 'production') return 'warn';
  return 'info';
};

// FIX (Jan 2026): Create transports array with error handling
const transports = [];

// File transports - removed 'lazy: true' which caused "no transports" warnings
try {
  transports.push(
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      maxsize: 10485760, // 10MB
      maxFiles: 5,
      tailable: true,
    }),
    new winston.transports.File({
      filename: path.join(logDir, 'combined.log'),
      maxsize: 10485760, // 10MB
      maxFiles: 5,
      tailable: true,
    })
  );
} catch (err) {
  console.error('[Logger] Failed to create file transports:', err.message);
}

// Console transport - ALWAYS add in development, optional in production
// FIX: Production was getting "no transports" because file transports failed
// and there was no console fallback
const isProduction = process.env.NODE_ENV === 'production';
const disableConsole = process.env.LOG_DISABLE_CONSOLE === 'true';

if (!isProduction || !disableConsole) {
  transports.push(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple(),
      winston.format.printf(({ timestamp, level, message, ...meta }) => {
        // PERFORMANCE: Limit meta object serialization
        const metaStr = Object.keys(meta).length > 0 && Object.keys(meta).length < 10
          ? JSON.stringify(meta)
          : '';
        return `${timestamp} [${level}]: ${message} ${metaStr}`;
      })
    )
  }));
}

// Ensure we have at least one transport
if (transports.length === 0) {
  console.error('[Logger] WARNING: No transports available! Adding emergency console transport.');
  transports.push(new winston.transports.Console());
}

// Create logger instance
const logger = winston.createLogger({
  level: getLogLevel(),
  format: logFormat,
  defaultMeta: { service: 'petroleum-business-api' },
  transports,
  // PERFORMANCE: Don't exit on uncaught exceptions in logger
  exitOnError: false,
});

// Security audit logger for sensitive operations
const auditLogger = winston.createLogger({
  level: 'info',
  format: logFormat,
  defaultMeta: { service: 'petroleum-business-audit' },
  transports: [
    new winston.transports.File({
      filename: path.join(logDir, 'audit.log'),
      maxsize: 10485760, // 10MB
      maxFiles: 10,
      lazy: true,
      tailable: true,
    })
  ],
  exitOnError: false,
});

// PERFORMANCE: Batch audit logs to reduce I/O
const auditBatch = [];
const AUDIT_BATCH_SIZE = 50;
const AUDIT_FLUSH_INTERVAL = 5000; // 5 seconds

let auditFlushTimer = null;

const flushAuditBatch = () => {
  if (auditBatch.length === 0) return;

  const logs = [...auditBatch];
  auditBatch.length = 0;

  // Write all batched logs
  logs.forEach(log => {
    auditLogger.info('Security audit event', log);
  });
};

// Start periodic flush
if (isAsyncLogging) {
  auditFlushTimer = setInterval(flushAuditBatch, AUDIT_FLUSH_INTERVAL);
  // Don't prevent process exit
  if (auditFlushTimer.unref) auditFlushTimer.unref();
}

// Audit log function for security events
const auditLog = (action, userId, details = {}) => {
  const logEntry = {
    action,
    userId,
    timestamp: new Date().toISOString(),
    ip: details.ip || 'unknown',
    userAgent: details.userAgent || 'unknown',
    ...details
  };

  if (isAsyncLogging) {
    // PERFORMANCE: Batch audit logs
    auditBatch.push(logEntry);
    if (auditBatch.length >= AUDIT_BATCH_SIZE) {
      flushAuditBatch();
    }
  } else {
    // Immediate logging (for debugging)
    auditLogger.info('Security audit event', logEntry);
  }
};

// PERFORMANCE: Request logger that skips high-frequency endpoints
const skipPaths = new Set(['/health', '/api/health', '/favicon.ico']);
const shouldLogRequest = (path) => {
  return !skipPaths.has(path);
};

// Export a request logging helper
const logRequest = (method, path, meta = {}) => {
  if (shouldLogRequest(path)) {
    logger.info(`${method} ${path}`, meta);
  }
};

// Graceful shutdown - flush pending logs
const flushAndClose = async () => {
  flushAuditBatch();
  if (auditFlushTimer) {
    clearInterval(auditFlushTimer);
  }
  // Give time for async writes to complete
  await new Promise(resolve => setTimeout(resolve, 100));
};

// Register cleanup on process exit
process.on('beforeExit', flushAndClose);

module.exports = {
  logger,
  auditLog,
  logRequest,
  flushAndClose,
  shouldLogRequest
};