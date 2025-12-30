/**
 * FIFO Inventory Allocator
 *
 * Implements First-In-First-Out allocation for inventory batches.
 * When materials are sold, wasted, or transferred, this allocator
 * determines which batches to consume based on purchase date (oldest first).
 */

const { logger } = require('./logger');

/**
 * Allocate quantity from available batches using FIFO method
 *
 * @param {Object} trx - Knex transaction object
 * @param {number} materialId - Material ID to allocate from
 * @param {number} quantity - Quantity needed
 * @param {string} movementType - Type of movement ('sale', 'wastage', 'transfer', 'adjustment')
 * @param {string} referenceType - Reference entity type (e.g., 'sales_order', 'wastage')
 * @param {number} referenceId - Reference entity ID
 * @param {number} userId - User performing the allocation
 * @param {Object} options - Additional options
 * @param {number} options.branchId - Optionally filter by branch
 * @returns {Object} { allocations: Array, totalCOGS: number, success: boolean }
 */
async function allocateFIFO(trx, materialId, quantity, movementType, referenceType, referenceId, userId, options = {}) {
  try {
    const { branchId } = options;

    // Get available batches ordered by purchase_date ASC (oldest first = FIFO)
    let batchQuery = trx('inventory_batches')
      .where({ material_id: materialId, is_depleted: 0 })
      .where('remaining_quantity', '>', 0)
      .orderBy('purchase_date', 'asc')
      .orderBy('id', 'asc'); // Secondary sort by ID for consistency

    // Apply branch filter only if branchId is specified AND branch-specific batches exist
    // Note: Many existing batches may have NULL branch_id, so we need to handle this carefully
    if (branchId) {
      // Check if any batches exist for this branch
      const branchBatches = await trx('inventory_batches')
        .where('material_id', materialId)
        .where('branch_id', branchId)
        .where('is_depleted', 0)
        .where('remaining_quantity', '>', 0)
        .first();

      // Only filter by branch if there are branch-specific batches
      // Otherwise, fall back to all available batches (for backwards compatibility)
      if (branchBatches) {
        batchQuery = batchQuery.where('branch_id', branchId);
        logger.debug('allocateFIFO: filtering by branch_id', { branchId });
      } else {
        logger.debug('allocateFIFO: no branch-specific batches found, using all available batches', { branchId });
      }
    }

    const batches = await batchQuery;

    if (batches.length === 0) {
      return {
        success: false,
        error: 'No available inventory batches found',
        allocations: [],
        totalCOGS: 0
      };
    }

    let remaining = parseFloat(quantity);
    const allocations = [];
    let totalCOGS = 0;

    // Allocate from batches in FIFO order
    for (const batch of batches) {
      if (remaining <= 0) break;

      const batchRemaining = parseFloat(batch.remaining_quantity);
      const allocated = Math.min(batchRemaining, remaining);
      const unitCost = parseFloat(batch.unit_cost);
      const allocationCOGS = allocated * unitCost;

      allocations.push({
        batchId: batch.id,
        batchNumber: batch.batch_number,
        quantity: allocated,
        unitCost: unitCost,
        cogs: allocationCOGS,
        supplierId: batch.supplier_id,
        purchaseDate: batch.purchase_date
      });

      totalCOGS += allocationCOGS;
      remaining -= allocated;
    }

    // Check if we could allocate the full quantity
    if (remaining > 0) {
      const totalAvailable = batches.reduce((sum, b) => sum + parseFloat(b.remaining_quantity), 0);
      return {
        success: false,
        error: `Insufficient inventory. Requested: ${quantity}, Available: ${totalAvailable.toFixed(3)}`,
        allocations: [],
        totalCOGS: 0,
        shortfall: remaining
      };
    }

    // Apply the allocations - update batches and create movement records
    const movementDate = new Date().toISOString().split('T')[0];

    for (const allocation of allocations) {
      // Update batch remaining quantity
      const newRemaining = await trx('inventory_batches')
        .where({ id: allocation.batchId })
        .decrement('remaining_quantity', allocation.quantity)
        .then(() => trx('inventory_batches')
          .where({ id: allocation.batchId })
          .select('remaining_quantity')
          .first()
        );

      // Mark as depleted if remaining is 0 or very close to 0
      if (parseFloat(newRemaining.remaining_quantity) <= 0.001) {
        await trx('inventory_batches')
          .where({ id: allocation.batchId })
          .update({
            is_depleted: true,
            remaining_quantity: 0,
            updated_at: new Date()
          });
      }

      // Create batch movement record
      await trx('batch_movements').insert({
        batch_id: allocation.batchId,
        movement_type: movementType,
        quantity: -allocation.quantity, // Negative for outflow
        reference_type: referenceType,
        reference_id: referenceId,
        movement_date: movementDate,
        notes: `FIFO allocation: ${allocation.quantity} units @ ${allocation.unitCost}/unit = ${allocation.cogs.toFixed(3)} COGS`,
        created_by: userId,
        created_at: new Date()
      });
    }

    logger.info('FIFO allocation completed', {
      materialId,
      quantityAllocated: quantity,
      batchesUsed: allocations.length,
      totalCOGS: totalCOGS.toFixed(3),
      movementType,
      referenceType,
      referenceId
    });

    return {
      success: true,
      allocations,
      totalCOGS: parseFloat(totalCOGS.toFixed(3)),
      batchesUsed: allocations.length
    };

  } catch (error) {
    logger.error('FIFO allocation error', {
      error: error.message,
      materialId,
      quantity,
      movementType
    });
    throw error;
  }
}

/**
 * Preview FIFO allocation without committing changes
 * Useful for showing users what batches would be consumed
 *
 * @param {Object} db - Knex database connection
 * @param {number} materialId - Material ID
 * @param {number} quantity - Quantity to preview
 * @param {Object} options - Additional options
 * @returns {Object} { allocations: Array, totalCOGS: number, canFulfill: boolean }
 */
async function previewFIFO(db, materialId, quantity, options = {}) {
  const { branchId } = options;

  // Log the query parameters for debugging
  logger.debug('previewFIFO called', {
    materialId,
    materialIdType: typeof materialId,
    quantity,
    branchId: branchId || 'none'
  });

  // Build base query
  let batchQuery = db('inventory_batches')
    .where('material_id', materialId)
    .where('is_depleted', 0)
    .where('remaining_quantity', '>', 0)
    .orderBy('purchase_date', 'asc')
    .orderBy('id', 'asc');

  // Apply branch filter only if branchId is specified
  // Note: Many existing batches may have NULL branch_id, so we need to handle this carefully
  if (branchId) {
    // Check if any batches exist for this branch
    const branchBatches = await db('inventory_batches')
      .where('material_id', materialId)
      .where('branch_id', branchId)
      .where('is_depleted', 0)
      .where('remaining_quantity', '>', 0)
      .first();

    // Only filter by branch if there are branch-specific batches
    // Otherwise, fall back to all available batches (for backwards compatibility)
    if (branchBatches) {
      batchQuery = batchQuery.where('branch_id', branchId);
      logger.debug('previewFIFO: filtering by branch_id', { branchId });
    } else {
      logger.debug('previewFIFO: no branch-specific batches found, using all available batches', { branchId });
    }
  }

  const batches = await batchQuery;

  logger.debug('previewFIFO batches found', {
    materialId,
    batchCount: batches.length,
    batches: batches.map(b => ({ id: b.id, remaining: b.remaining_quantity }))
  });

  let remaining = parseFloat(quantity);
  const allocations = [];
  let totalCOGS = 0;

  for (const batch of batches) {
    if (remaining <= 0) break;

    const batchRemaining = parseFloat(batch.remaining_quantity);
    const allocated = Math.min(batchRemaining, remaining);
    const unitCost = parseFloat(batch.unit_cost);
    const allocationCOGS = allocated * unitCost;

    allocations.push({
      batchId: batch.id,
      batchNumber: batch.batch_number,
      quantity: allocated,
      unitCost: unitCost,
      cogs: allocationCOGS,
      supplierId: batch.supplier_id,
      purchaseDate: batch.purchase_date,
      remainingAfter: batchRemaining - allocated
    });

    totalCOGS += allocationCOGS;
    remaining -= allocated;
  }

  const totalAvailable = batches.reduce((sum, b) => sum + parseFloat(b.remaining_quantity), 0);

  return {
    canFulfill: remaining <= 0,
    allocations,
    totalCOGS: parseFloat(totalCOGS.toFixed(3)),
    totalAvailable: parseFloat(totalAvailable.toFixed(3)),
    shortfall: remaining > 0 ? parseFloat(remaining.toFixed(3)) : 0
  };
}

/**
 * Create a new inventory batch (used when receiving goods)
 *
 * @param {Object} trx - Knex transaction object
 * @param {Object} batchData - Batch details
 * @returns {Object} Created batch with ID
 */
async function createBatch(trx, batchData) {
  const {
    materialId,
    batchNumber,
    supplierId,
    purchaseOrderId,
    branchId,
    purchaseDate,
    quantityReceived,
    unitCost,
    expiryDate,
    location,
    condition = 'new',
    notes,
    userId
  } = batchData;

  // Generate batch number if not provided
  const finalBatchNumber = batchNumber ||
    `BATCH-${materialId}-${Date.now().toString(36).toUpperCase()}`;

  const [batchId] = await trx('inventory_batches').insert({
    material_id: materialId,
    batch_number: finalBatchNumber,
    supplier_id: supplierId,
    purchase_order_id: purchaseOrderId || null,
    branch_id: branchId || null,
    purchase_date: purchaseDate,
    quantity_received: quantityReceived,
    remaining_quantity: quantityReceived,
    unit_cost: unitCost,
    expiry_date: expiryDate || null,
    location: location || null,
    condition: condition,
    is_depleted: false,
    notes: notes || null,
    created_at: new Date(),
    updated_at: new Date()
  });

  // Create receipt movement record
  await trx('batch_movements').insert({
    batch_id: batchId,
    movement_type: 'receipt',
    quantity: quantityReceived, // Positive for inflow
    reference_type: purchaseOrderId ? 'purchase_order' : 'manual_receipt',
    reference_id: purchaseOrderId || null,
    movement_date: purchaseDate,
    notes: `Initial receipt: ${quantityReceived} units @ ${unitCost}/unit`,
    created_by: userId,
    created_at: new Date()
  });

  logger.info('Inventory batch created', {
    batchId,
    batchNumber: finalBatchNumber,
    materialId,
    quantity: quantityReceived,
    unitCost,
    supplierId,
    purchaseOrderId
  });

  return {
    id: batchId,
    batchNumber: finalBatchNumber,
    materialId,
    quantityReceived,
    unitCost,
    supplierId
  };
}

/**
 * Get batch summary for a material
 *
 * @param {Object} db - Knex database connection
 * @param {number} materialId - Material ID
 * @returns {Object} Summary statistics
 */
async function getBatchSummary(db, materialId) {
  const batches = await db('inventory_batches')
    .where({ material_id: materialId, is_depleted: 0 })
    .where('remaining_quantity', '>', 0)
    .orderBy('purchase_date', 'asc');

  if (batches.length === 0) {
    return {
      totalQuantity: 0,
      totalValue: 0,
      averageCost: 0,
      batchCount: 0,
      oldestBatchDate: null,
      newestBatchDate: null
    };
  }

  let totalQuantity = 0;
  let totalValue = 0;

  for (const batch of batches) {
    const qty = parseFloat(batch.remaining_quantity);
    const cost = parseFloat(batch.unit_cost);
    totalQuantity += qty;
    totalValue += qty * cost;
  }

  return {
    totalQuantity: parseFloat(totalQuantity.toFixed(3)),
    totalValue: parseFloat(totalValue.toFixed(3)),
    averageCost: totalQuantity > 0 ? parseFloat((totalValue / totalQuantity).toFixed(3)) : 0,
    batchCount: batches.length,
    oldestBatchDate: batches[0].purchase_date,
    newestBatchDate: batches[batches.length - 1].purchase_date
  };
}

/**
 * Reverse/Undo a FIFO allocation (for order cancellations)
 *
 * @param {Object} trx - Knex transaction object
 * @param {string} referenceType - Reference entity type
 * @param {number} referenceId - Reference entity ID
 * @param {number} userId - User performing the reversal
 * @returns {Object} Result of reversal
 */
async function reverseFIFOAllocation(trx, referenceType, referenceId, userId) {
  // Get all movements for this reference
  const movements = await trx('batch_movements')
    .where({ reference_type: referenceType, reference_id: referenceId })
    .whereIn('movement_type', ['sale', 'wastage', 'transfer']);

  if (movements.length === 0) {
    return { success: true, message: 'No allocations to reverse', reversedCount: 0 };
  }

  const movementDate = new Date().toISOString().split('T')[0];
  let reversedCount = 0;

  for (const movement of movements) {
    // Add quantity back to batch (movements are stored as negative)
    const quantityToRestore = Math.abs(parseFloat(movement.quantity));

    await trx('inventory_batches')
      .where({ id: movement.batch_id })
      .increment('remaining_quantity', quantityToRestore)
      .update({
        is_depleted: false,
        updated_at: new Date()
      });

    // Create reversal movement record
    await trx('batch_movements').insert({
      batch_id: movement.batch_id,
      movement_type: 'adjustment',
      quantity: quantityToRestore, // Positive for restoration
      reference_type: `${referenceType}_reversal`,
      reference_id: referenceId,
      movement_date: movementDate,
      notes: `Reversal of ${movement.movement_type} (original movement ID: ${movement.id})`,
      created_by: userId,
      created_at: new Date()
    });

    reversedCount++;
  }

  logger.info('FIFO allocation reversed', {
    referenceType,
    referenceId,
    reversedCount,
    userId
  });

  return {
    success: true,
    message: `Reversed ${reversedCount} batch allocations`,
    reversedCount
  };
}

module.exports = {
  allocateFIFO,
  previewFIFO,
  createBatch,
  getBatchSummary,
  reverseFIFOAllocation
};
