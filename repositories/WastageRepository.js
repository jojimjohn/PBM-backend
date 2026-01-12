const BaseRepository = require('./BaseRepository');

/**
 * Wastage Repository
 * Handles wastage-specific database operations
 */
class WastageRepository extends BaseRepository {
  constructor(companyId) {
    super('wastages', companyId);
  }

  /**
   * Find wastages with material and user details
   * @param {Object} filters - Filter criteria
   * @param {Object} pagination - Pagination options
   */
  async findAllWithDetails(filters = {}, pagination = {}) {
    try {
      const { page = 1, limit = 50 } = pagination;
      const offset = (page - 1) * limit;

      let query = this.db(this.tableName)
        .select(
          'wastages.*',
          'materials.name as materialName',
          'materials.code as materialCode',
          'reportedUser.firstName as reportedByName',
          'reportedUser.lastName as reportedByLastName',
          'approvedUser.firstName as approvedByName',
          'approvedUser.lastName as approvedByLastName',
          // Collection order reference for linking display
          'collection_orders.wcn_number as collectionWcnNumber',
          'collection_orders.orderNumber as collectionOrderNumber'
        )
        .leftJoin('materials', 'wastages.materialId', 'materials.id')
        .leftJoin('users as reportedUser', 'wastages.reportedBy', 'reportedUser.id')
        .leftJoin('users as approvedUser', 'wastages.approvedBy', 'approvedUser.id')
        .leftJoin('collection_orders', 'wastages.collectionOrderId', 'collection_orders.id')
        .orderBy('wastages.created_at', 'desc');

      // Apply filters
      if (filters.materialId) {
        query = query.where('wastages.materialId', filters.materialId);
      }
      if (filters.wasteType) {
        query = query.where('wastages.wasteType', filters.wasteType);
      }
      if (filters.status) {
        query = query.where('wastages.status', filters.status);
      }
      if (filters.dateFrom) {
        query = query.where('wastages.wastageDate', '>=', filters.dateFrom);
      }
      if (filters.dateTo) {
        query = query.where('wastages.wastageDate', '<=', filters.dateTo);
      }

      // Apply project-based filtering
      // Uses same logic as applyProjectFilter in projectFilter.js middleware
      if (filters.projectFilter && filters.projectFilter.isFiltered) {
        const { projectIds, selectedProjectId } = filters.projectFilter;
        if (projectIds === null) {
          // No filter - show all
        } else if (projectIds.length === 0) {
          // User has no projects - show nothing
          query = query.whereRaw('1 = 0');
        } else if (selectedProjectId) {
          // STRICT mode: specific project selected - exclude NULLs
          // This ensures new projects don't show unrelated data
          query = query.whereIn('wastages.project_id', projectIds);
        } else {
          // INCLUSIVE mode: viewing all assigned projects - include NULLs
          // This helps users see "unassigned" records that need project assignment
          query = query.where(function() {
            this.whereIn('wastages.project_id', projectIds)
              .orWhereNull('wastages.project_id');
          });
        }
      }

      // Get total count
      const totalQuery = query.clone();
      const [{ count }] = await totalQuery.clearSelect().clearOrder().count('wastages.id as count');

      // Get paginated results
      const wastages = await query.limit(limit).offset(offset);

      // Process attachments JSON and add collection reference
      const processedWastages = wastages.map(wastage => ({
        ...wastage,
        attachments: wastage.attachments ? JSON.parse(wastage.attachments) : [],
        // Set collection reference display name
        collectionReference: wastage.collectionOrderId
          ? (wastage.collectionWcnNumber || wastage.collectionOrderNumber || `#${wastage.collectionOrderId}`)
          : null
      }));

      return {
        data: processedWastages,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: count,
          pages: Math.ceil(count / limit)
        }
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get wastage analytics
   * @param {Object} filters - Filter criteria
   */
  async getAnalytics(filters = {}) {
    try {
      let query = this.db(this.tableName);

      // Apply date filters
      if (filters.dateFrom) {
        query = query.where('wastageDate', '>=', filters.dateFrom);
      }
      if (filters.dateTo) {
        query = query.where('wastageDate', '<=', filters.dateTo);
      }
      if (filters.materialId) {
        query = query.where('materialId', filters.materialId);
      }

      // Get summary statistics
      const [totalStats] = await query.clone()
        .select(
          this.db.raw('COUNT(*) as totalWastages'),
          this.db.raw('SUM(CASE WHEN status = "approved" THEN totalCost ELSE 0 END) as totalCost'),
          this.db.raw('SUM(CASE WHEN status = "pending" THEN 1 ELSE 0 END) as pendingCount'),
          this.db.raw('SUM(CASE WHEN status = "approved" THEN 1 ELSE 0 END) as approvedCount'),
          this.db.raw('SUM(CASE WHEN status = "rejected" THEN 1 ELSE 0 END) as rejectedCount')
        );

      // Get wastage by type
      const wastageByType = await query.clone()
        .select('wasteType', this.db.raw('COUNT(*) as count'), this.db.raw('SUM(totalCost) as totalCost'))
        .where('status', 'approved')
        .groupBy('wasteType')
        .orderBy('totalCost', 'desc');

      // Get top materials by wastage cost
      const topMaterials = await query.clone()
        .select(
          'materials.name as materialName',
          'materials.code as materialCode',
          this.db.raw('COUNT(wastages.id) as count'),
          this.db.raw('SUM(wastages.totalCost) as totalCost')
        )
        .join('materials', 'wastages.materialId', 'materials.id')
        .where('wastages.status', 'approved')
        .groupBy('wastages.materialId', 'materials.name', 'materials.code')
        .orderBy('totalCost', 'desc')
        .limit(10);

      // Get monthly trends (last 12 months by default, or within date range)
      let monthlyTrendsQuery = this.db(this.tableName)
        .select(
          this.db.raw('DATE_FORMAT(wastageDate, "%Y-%m-01") as month'),
          this.db.raw('COUNT(*) as count'),
          this.db.raw('SUM(totalCost) as totalCost')
        )
        .where('status', 'approved');

      // Apply date filters to monthly trends
      if (filters.dateFrom) {
        monthlyTrendsQuery = monthlyTrendsQuery.where('wastageDate', '>=', filters.dateFrom);
      } else {
        // Default to last 12 months if no dateFrom specified
        monthlyTrendsQuery = monthlyTrendsQuery.where('wastageDate', '>=', this.db.raw('DATE_SUB(CURDATE(), INTERVAL 12 MONTH)'));
      }
      if (filters.dateTo) {
        monthlyTrendsQuery = monthlyTrendsQuery.where('wastageDate', '<=', filters.dateTo);
      }
      if (filters.materialId) {
        monthlyTrendsQuery = monthlyTrendsQuery.where('materialId', filters.materialId);
      }

      const monthlyTrends = await monthlyTrendsQuery
        .groupBy(this.db.raw('DATE_FORMAT(wastageDate, "%Y-%m-01")'))
        .orderBy('month', 'asc');

      return {
        summary: totalStats,
        byType: wastageByType,
        topMaterials,
        monthlyTrends
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Find wastages linked to a collection order
   * @param {number} collectionOrderId - Collection order ID
   */
  async findByCollectionOrder(collectionOrderId) {
    try {
      return await this.db(this.tableName)
        .select(
          'wastages.*',
          'materials.name as materialName',
          'materials.code as materialCode',
          'materials.unit as materialUnit',
          'reportedUser.firstName as reportedByName',
          'reportedUser.lastName as reportedByLastName'
        )
        .leftJoin('materials', 'wastages.materialId', 'materials.id')
        .leftJoin('users as reportedUser', 'wastages.reportedBy', 'reportedUser.id')
        .where('wastages.collectionOrderId', collectionOrderId)
        .orderBy('wastages.created_at', 'desc');
    } catch (error) {
      throw error;
    }
  }

  /**
   * Find pending wastages for approval
   */
  async findPendingWastages() {
    return await this.findBy({ status: 'pending' }, { orderBy: 'created_at', orderDirection: 'asc' });
  }

  /**
   * Get wastages by material
   * @param {number} materialId - Material ID
   */
  async findByMaterial(materialId) {
    return await this.findBy({ materialId }, { orderBy: 'wastageDate', orderDirection: 'desc' });
  }

  /**
   * Update wastage status
   * @param {number} id - Wastage ID
   * @param {string} status - New status
   * @param {number} approvedBy - Approver user ID
   * @param {string} notes - Approval notes
   */
  async updateStatus(id, status, approvedBy, notes = null) {
    const updateData = {
      status,
      approvedBy,
      approvedAt: new Date(),
      approvalNotes: notes,
      updated_at: new Date()
    };

    return await this.update(id, updateData);
  }

  /**
   * Get wastage monthly trends
   * @param {number} months - Number of months to retrieve
   */
  async getMonthlyTrends(months = 12) {
    try {
      return await this.db(this.tableName)
        .select(
          this.db.raw('DATE_FORMAT(wastageDate, "%Y-%m") as month'),
          this.db.raw('COUNT(*) as count'),
          this.db.raw('SUM(totalCost) as totalCost')
        )
        .where('status', 'approved')
        .where('wastageDate', '>=', this.db.raw(`DATE_SUB(CURDATE(), INTERVAL ${months} MONTH)`))
        .groupBy(this.db.raw('DATE_FORMAT(wastageDate, "%Y-%m")'))
        .orderBy('month', 'desc');
    } catch (error) {
      throw error;
    }
  }
}

module.exports = WastageRepository;