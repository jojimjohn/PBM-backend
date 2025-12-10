/**
 * Report Utilities
 *
 * Shared utility functions for report generation including:
 * - Date range handling
 * - Pagination
 * - Response formatting
 */

/**
 * Build date range filter with sensible defaults
 *
 * @param {string|Date} fromDate - Start date (optional)
 * @param {string|Date} toDate - End date (optional)
 * @returns {Object} { from: string, to: string } in YYYY-MM-DD format
 */
function buildDateRangeFilter(fromDate, toDate) {
  const today = new Date();

  // Default: Last 30 days
  const defaultFrom = new Date(today);
  defaultFrom.setDate(defaultFrom.getDate() - 30);

  const from = fromDate
    ? formatDateForDb(new Date(fromDate))
    : formatDateForDb(defaultFrom);

  const to = toDate
    ? formatDateForDb(new Date(toDate))
    : formatDateForDb(today);

  return { from, to };
}

/**
 * Format a Date object to YYYY-MM-DD string
 *
 * @param {Date} date - Date to format
 * @returns {string} Formatted date string
 */
function formatDateForDb(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Build pagination parameters
 *
 * @param {number} page - Page number (1-indexed)
 * @param {number} limit - Records per page
 * @returns {Object} { offset: number, limitValue: number }
 */
function buildPaginationParams(page = 1, limit = 20) {
  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitValue = Math.min(100, Math.max(1, parseInt(limit) || 20));
  const offset = (pageNum - 1) * limitValue;

  return { offset, limitValue };
}

/**
 * Format a standard report response
 *
 * @param {Array} records - Data records
 * @param {Object} summary - Summary statistics
 * @param {Object} pagination - Pagination info { page, limit, total, pages }
 * @param {Object} dateRange - Date range { from, to }
 * @returns {Object} Formatted response object
 */
function formatReportResponse(records, summary, pagination, dateRange) {
  return {
    success: true,
    data: {
      summary,
      records,
      pagination,
      dateRange
    }
  };
}

/**
 * Calculate date range presets
 *
 * @param {string} preset - Preset name (today, this_week, this_month, last_month, this_quarter)
 * @returns {Object} { from: string, to: string }
 */
function getDateRangePreset(preset) {
  const today = new Date();
  let from, to;

  switch (preset) {
    case 'today':
      from = to = formatDateForDb(today);
      break;

    case 'this_week':
      // Start of week (Sunday)
      const startOfWeek = new Date(today);
      startOfWeek.setDate(today.getDate() - today.getDay());
      from = formatDateForDb(startOfWeek);
      to = formatDateForDb(today);
      break;

    case 'this_month':
      from = formatDateForDb(new Date(today.getFullYear(), today.getMonth(), 1));
      to = formatDateForDb(today);
      break;

    case 'last_month':
      from = formatDateForDb(new Date(today.getFullYear(), today.getMonth() - 1, 1));
      to = formatDateForDb(new Date(today.getFullYear(), today.getMonth(), 0));
      break;

    case 'this_quarter':
      const quarter = Math.floor(today.getMonth() / 3);
      from = formatDateForDb(new Date(today.getFullYear(), quarter * 3, 1));
      to = formatDateForDb(today);
      break;

    case 'last_quarter':
      const lastQuarter = Math.floor(today.getMonth() / 3) - 1;
      const lastQuarterYear = lastQuarter < 0 ? today.getFullYear() - 1 : today.getFullYear();
      const adjustedQuarter = lastQuarter < 0 ? 3 : lastQuarter;
      from = formatDateForDb(new Date(lastQuarterYear, adjustedQuarter * 3, 1));
      to = formatDateForDb(new Date(lastQuarterYear, adjustedQuarter * 3 + 3, 0));
      break;

    case 'this_year':
      from = formatDateForDb(new Date(today.getFullYear(), 0, 1));
      to = formatDateForDb(today);
      break;

    default:
      // Default to last 30 days
      const defaultFrom = new Date(today);
      defaultFrom.setDate(defaultFrom.getDate() - 30);
      from = formatDateForDb(defaultFrom);
      to = formatDateForDb(today);
  }

  return { from, to };
}

/**
 * Parse sort parameters with validation
 *
 * @param {string} sortBy - Column to sort by
 * @param {string} sortOrder - Sort direction (asc/desc)
 * @param {Object} allowedColumns - Map of allowed sort columns { displayName: dbColumn }
 * @param {string} defaultColumn - Default column if sortBy is invalid
 * @returns {Object} { column: string, order: string }
 */
function parseSortParams(sortBy, sortOrder, allowedColumns, defaultColumn) {
  const order = sortOrder === 'asc' ? 'asc' : 'desc';
  const column = allowedColumns[sortBy] || defaultColumn;
  return { column, order };
}

module.exports = {
  buildDateRangeFilter,
  buildPaginationParams,
  formatReportResponse,
  formatDateForDb,
  getDateRangePreset,
  parseSortParams
};
