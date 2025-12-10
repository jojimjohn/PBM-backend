/**
 * Export Utilities
 *
 * Provides functions for exporting data to CSV and XLSX formats.
 * Handles streaming for large datasets and proper HTTP headers.
 */

const { Parser } = require('json2csv');
const XLSX = require('xlsx');
const { logger } = require('./logger');

/**
 * Export data to CSV format
 *
 * @param {Array} data - Array of objects to export
 * @param {string} filename - Base filename (without extension)
 * @param {Object} res - Express response object
 * @param {Object} options - Optional configuration
 * @param {Array<string>} options.fields - Specific fields to include
 * @param {boolean} options.withBOM - Include UTF-8 BOM for Excel compatibility
 */
function exportToCsv(data, filename, res, options = {}) {
  try {
    if (!data || data.length === 0) {
      // Return empty CSV with headers if no data
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      res.send('No data available');
      return;
    }

    const parserOptions = {
      withBOM: options.withBOM !== false, // Default true for Excel compatibility
      fields: options.fields || undefined, // Use all fields if not specified
      delimiter: ',',
      quote: '"',
      escapedQuote: '""',
      header: true,
      eol: '\r\n'
    };

    const parser = new Parser(parserOptions);
    const csv = parser.parse(data);

    // Set headers for download
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${sanitizeFilename(filename)}.csv"`);
    res.setHeader('Content-Length', Buffer.byteLength(csv, 'utf8'));

    res.send(csv);

    logger.info(`CSV export generated: ${filename}.csv (${data.length} records)`);

  } catch (error) {
    logger.error('CSV Export Error:', error);
    throw new Error('Failed to generate CSV export');
  }
}

/**
 * Export data to XLSX format
 *
 * @param {Array} data - Array of objects to export
 * @param {string} filename - Base filename (without extension)
 * @param {Object} res - Express response object
 * @param {Object} options - Optional configuration
 * @param {string} options.sheetName - Name of the worksheet
 * @param {Array} options.columnWidths - Array of column widths
 * @param {boolean} options.autoFilter - Add auto filter to header row
 */
function exportToXlsx(data, filename, res, options = {}) {
  try {
    const sheetName = options.sheetName || 'Report';

    if (!data || data.length === 0) {
      // Create empty workbook with header
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.aoa_to_sheet([['No data available']]);
      XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
      res.send(buffer);
      return;
    }

    // Create workbook and worksheet
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(data);

    // Auto-fit column widths
    const columnWidths = calculateColumnWidths(data, options.columnWidths);
    worksheet['!cols'] = columnWidths;

    // Add auto filter if requested
    if (options.autoFilter !== false) {
      const range = XLSX.utils.decode_range(worksheet['!ref']);
      worksheet['!autofilter'] = { ref: XLSX.utils.encode_range(range) };
    }

    // Style header row (bold)
    const range = XLSX.utils.decode_range(worksheet['!ref']);
    for (let col = range.s.c; col <= range.e.c; col++) {
      const cellAddress = XLSX.utils.encode_cell({ r: 0, c: col });
      if (worksheet[cellAddress]) {
        worksheet[cellAddress].s = {
          font: { bold: true },
          fill: { fgColor: { rgb: 'E0E0E0' } }
        };
      }
    }

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

    // Generate buffer
    const buffer = XLSX.write(workbook, {
      type: 'buffer',
      bookType: 'xlsx',
      bookSST: false,
      compression: true
    });

    // Set headers for download
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${sanitizeFilename(filename)}.xlsx"`);
    res.setHeader('Content-Length', buffer.length);

    res.send(buffer);

    logger.info(`XLSX export generated: ${filename}.xlsx (${data.length} records)`);

  } catch (error) {
    logger.error('XLSX Export Error:', error);
    throw new Error('Failed to generate XLSX export');
  }
}

/**
 * Calculate optimal column widths based on data content
 *
 * @param {Array} data - Array of data objects
 * @param {Array} customWidths - Custom width overrides
 * @returns {Array} Array of column width objects
 */
function calculateColumnWidths(data, customWidths) {
  if (!data || data.length === 0) return [];

  const columns = Object.keys(data[0]);
  const widths = columns.map((col, index) => {
    // Use custom width if provided
    if (customWidths && customWidths[index]) {
      return { wch: customWidths[index] };
    }

    // Calculate based on content
    const headerWidth = col.length;
    const maxDataWidth = data.reduce((max, row) => {
      const value = row[col];
      const valueLength = value != null ? String(value).length : 0;
      return Math.max(max, valueLength);
    }, 0);

    // Width = max of header or data, with min of 8 and max of 50
    const width = Math.min(50, Math.max(8, Math.max(headerWidth, maxDataWidth) + 2));
    return { wch: width };
  });

  return widths;
}

/**
 * Sanitize filename to prevent directory traversal and invalid characters
 *
 * @param {string} filename - Raw filename
 * @returns {string} Sanitized filename
 */
function sanitizeFilename(filename) {
  return filename
    .replace(/[\/\\:*?"<>|]/g, '_') // Replace invalid chars
    .replace(/\.\./g, '_')          // Prevent directory traversal
    .replace(/^\.+/, '')            // Remove leading dots
    .slice(0, 200);                 // Limit length
}

/**
 * Stream large dataset to CSV (for exports > 10000 rows)
 *
 * @param {Object} db - Knex database connection
 * @param {Function} queryBuilder - Function that returns a Knex query
 * @param {Array<string>} fields - Fields to include
 * @param {string} filename - Base filename
 * @param {Object} res - Express response object
 */
async function streamToCsv(db, queryBuilder, fields, filename, res) {
  try {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${sanitizeFilename(filename)}.csv"`);

    // Write BOM and header
    const bom = '\ufeff';
    const header = fields.join(',') + '\r\n';
    res.write(bom + header);

    // Stream data in chunks
    const chunkSize = 1000;
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const query = queryBuilder();
      const chunk = await query.offset(offset).limit(chunkSize);

      if (chunk.length === 0) {
        hasMore = false;
        break;
      }

      // Write chunk to response
      for (const row of chunk) {
        const values = fields.map(field => {
          const value = row[field];
          if (value == null) return '';
          const str = String(value);
          // Escape quotes and wrap in quotes if contains comma, quote, or newline
          if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`;
          }
          return str;
        });
        res.write(values.join(',') + '\r\n');
      }

      offset += chunkSize;
      hasMore = chunk.length === chunkSize;
    }

    res.end();
    logger.info(`Streamed CSV export: ${filename}.csv`);

  } catch (error) {
    logger.error('Stream CSV Error:', error);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: 'Export failed' });
    }
  }
}

module.exports = {
  exportToCsv,
  exportToXlsx,
  streamToCsv,
  sanitizeFilename
};
