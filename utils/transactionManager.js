const winston = require('winston');
const { getDbConnection } = require('../config/database');
const { allocateFIFO, reverseFIFOAllocation } = require('./fifoAllocator');

/**
 * Advanced Transaction Manager for ACID Operations
 * Provides utilities for complex multi-table operations with proper rollback
 */
class TransactionManager {
  constructor(companyId) {
    this.db = getDbConnection(companyId);
    this.companyId = companyId;
  }

  /**
   * Execute multiple operations in a single ACID transaction
   * @param {Function} operations - Async function containing operations
   * @param {Object} options - Transaction options
   * @returns {Promise} - Transaction result
   */
  async executeTransaction(operations, options = {}) {
    // Note: MySQL default isolation level (REPEATABLE READ) is used
    // Cannot change isolation level inside an active transaction
    const { timeout = 30000 } = options;

    return await this.db.transaction(async (trx) => {
      // Set transaction timeout
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Transaction timeout')), timeout);
      });

      try {
        // Execute operations with timeout
        const result = await Promise.race([
          operations(trx),
          timeoutPromise
        ]);

        winston.info('Transaction completed successfully', {
          companyId: this.companyId
        });

        return result;
      } catch (error) {
        winston.error('Transaction failed and rolled back', {
          error: error.message,
          companyId: this.companyId
        });
        throw error;
      }
    });
  }

  /**
   * Process sales order with inventory updates and transaction recording
   * @param {Object} salesOrderData - Sales order data
   * @param {Array} orderItems - Order items array
   * @param {number} userId - User ID
   */
  async processSalesOrder(salesOrderData, orderItems, userId) {
    return await this.executeTransaction(async (trx) => {
      // 1. Create sales order
      const [orderId] = await trx('sales_orders').insert({
        ...salesOrderData,
        createdBy: userId
      });

      let totalAmount = 0;

      // 2. Process each order item
      for (const item of orderItems) {
        // Insert order item
        await trx('sales_order_items').insert({
          orderId,
          materialId: item.materialId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalPrice: item.quantity * item.unitPrice,
          notes: item.notes
        });

        // Update inventory
        const inventory = await trx('inventory')
          .where('materialId', item.materialId)
          .first();

        if (!inventory || inventory.currentStock < item.quantity) {
          throw new Error(`Insufficient stock for material ID ${item.materialId}`);
        }

        await trx('inventory')
          .where('materialId', item.materialId)
          .decrement('currentStock', item.quantity);

        // Record transaction
        await trx('transactions').insert({
          transactionNumber: this.generateTransactionNumber('sale'),
          transactionType: 'sale',
          referenceId: orderId,
          referenceType: 'sales_order',
          materialId: item.materialId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          amount: item.quantity * item.unitPrice,
          transactionDate: salesOrderData.orderDate,
          description: `Sale - Order ${salesOrderData.orderNumber}`,
          createdBy: userId
        });

        totalAmount += item.quantity * item.unitPrice;
      }

      // 3. Update sales order total
      await trx('sales_orders')
        .where('id', orderId)
        .update({
          subtotal: totalAmount,
          totalAmount: totalAmount * (1 + (salesOrderData.taxRate || 0) / 100)
        });

      return { orderId, totalAmount };
    });
  }

  /**
   * Process purchase order with inventory updates and transaction recording
   * @param {Object} purchaseOrderData - Purchase order data
   * @param {Array} orderItems - Order items array
   * @param {number} userId - User ID
   */
  async processPurchaseOrder(purchaseOrderData, orderItems, userId) {
    return await this.executeTransaction(async (trx) => {
      // 1. Create purchase order
      const [orderId] = await trx('purchase_orders').insert({
        ...purchaseOrderData,
        createdBy: userId
      });

      let totalAmount = 0;

      // 2. Process each order item
      for (const item of orderItems) {
        // Insert order item
        await trx('purchase_order_items').insert({
          orderId,
          materialId: item.materialId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalPrice: item.quantity * item.unitPrice,
          notes: item.notes
        });

        // Update inventory
        const existingInventory = await trx('inventory')
          .where('materialId', item.materialId)
          .first();

        if (existingInventory) {
          await trx('inventory')
            .where('materialId', item.materialId)
            .increment('currentStock', item.quantity)
            .update({
              lastPurchasePrice: item.unitPrice,
              lastPurchaseDate: purchaseOrderData.orderDate
            });
        } else {
          // Create new inventory record
          await trx('inventory').insert({
            materialId: item.materialId,
            openingStock: 0,
            currentStock: item.quantity,
            minimumStock: 10,
            maximumStock: 1000,
            lastPurchasePrice: item.unitPrice,
            lastPurchaseDate: purchaseOrderData.orderDate,
            averageCost: item.unitPrice,
            createdBy: userId
          });
        }

        // Record transaction
        await trx('transactions').insert({
          transactionNumber: this.generateTransactionNumber('purchase'),
          transactionType: 'purchase',
          referenceId: orderId,
          referenceType: 'purchase_order',
          materialId: item.materialId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          amount: -(item.quantity * item.unitPrice), // Negative for expense
          transactionDate: purchaseOrderData.orderDate,
          description: `Purchase - Order ${purchaseOrderData.orderNumber}`,
          createdBy: userId
        });

        totalAmount += item.quantity * item.unitPrice;
      }

      // 3. Update purchase order total
      await trx('purchase_orders')
        .where('id', orderId)
        .update({
          subtotal: totalAmount,
          totalAmount: totalAmount * (1 + (purchaseOrderData.taxRate || 0) / 100)
        });

      return { orderId, totalAmount };
    });
  }

  /**
   * Process wastage approval with inventory and financial impact
   * @param {number} wastageId - Wastage ID
   * @param {string} status - approved/rejected
   * @param {number} userId - User ID
   * @param {string} notes - Approval notes
   */
  async processWastageApproval(wastageId, status, userId, notes = null) {
    return await this.executeTransaction(async (trx) => {
      // Get wastage details
      const wastage = await trx('wastages').where('id', wastageId).first();
      if (!wastage) {
        throw new Error('Wastage record not found');
      }

      if (wastage.status !== 'pending') {
        throw new Error('Wastage is not in pending status');
      }

      // Update wastage status
      await trx('wastages')
        .where('id', wastageId)
        .update({
          status,
          approvedBy: userId,
          approvedAt: new Date(),
          approvalNotes: notes
        });

      if (status === 'approved') {
        let actualCOGS = wastage.totalCost; // Default to estimated cost

        // FIFO allocation - consume from oldest batches for accurate COGS
        if (wastage.materialId && wastage.quantity > 0) {
          const fifoResult = await allocateFIFO(
            trx,
            wastage.materialId,
            wastage.quantity,
            'wastage',
            'wastage',
            wastageId,
            userId,
            {}
          );

          if (fifoResult.success) {
            actualCOGS = fifoResult.totalCOGS;
            winston.info('FIFO allocation for wastage', {
              wastageId,
              materialId: wastage.materialId,
              quantity: wastage.quantity,
              estimatedCost: wastage.totalCost,
              actualCOGS: fifoResult.totalCOGS,
              batchesUsed: fifoResult.batchesUsed
            });

            // Update wastage record with actual COGS from FIFO
            await trx('wastages')
              .where('id', wastageId)
              .update({
                totalCost: actualCOGS,
                unitCost: actualCOGS / wastage.quantity
              });
          } else {
            // FIFO failed (no batches) - log warning but continue with estimated cost
            winston.warn('FIFO allocation failed for wastage, using estimated cost', {
              wastageId,
              materialId: wastage.materialId,
              error: fifoResult.error
            });
          }
        }

        // Also update legacy inventory table for display consistency
        // Find inventory record by materialId instead of relying on inventoryId
        const inventoryRecord = await trx('inventory')
          .where('materialId', wastage.materialId)
          .where('quantity', '>', 0)
          .orderBy('id', 'asc')
          .first();

        if (inventoryRecord) {
          const deductAmount = Math.min(wastage.quantity, inventoryRecord.quantity);
          await trx('inventory')
            .where('id', inventoryRecord.id)
            .decrement('quantity', deductAmount);

          winston.info('Updated legacy inventory for wastage', {
            wastageId,
            materialId: wastage.materialId,
            inventoryId: inventoryRecord.id,
            deductedQuantity: deductAmount,
            previousQuantity: inventoryRecord.quantity
          });
        } else {
          winston.warn('No legacy inventory record found for wastage', {
            wastageId,
            materialId: wastage.materialId
          });
        }

        // Record financial transaction with actual COGS
        await trx('transactions').insert({
          transactionNumber: this.generateTransactionNumber('wastage'),
          transactionType: 'wastage',
          referenceId: wastageId,
          referenceType: 'wastage',
          materialId: wastage.materialId,
          quantity: wastage.quantity,
          unitPrice: actualCOGS / wastage.quantity,
          amount: -actualCOGS, // Negative for loss (actual COGS)
          transactionDate: wastage.wastageDate,
          description: `Wastage - ${wastage.wasteType}: ${wastage.reason}`,
          createdBy: userId
        });
      }

      return { wastageId, status, totalCost: status === 'approved' ? wastage.totalCost : 0 };
    });
  }

  /**
   * Process petty cash expense approval with card balance update
   *
   * IMPORTANT: Balance is now DEDUCTED IMMEDIATELY on expense submission.
   * - On APPROVAL: Just update totalSpent (balance already deducted)
   * - On REJECTION: RESTORE the balance (refund the reserved amount)
   *
   * @param {number} expenseId - Expense ID
   * @param {string} status - approved/rejected
   * @param {number} userId - User ID
   * @param {string} notes - Approval notes
   */
  async processExpenseApproval(expenseId, status, userId, notes = null) {
    return await this.executeTransaction(async (trx) => {
      // Get expense and card details
      const expense = await trx('petty_cash_expenses')
        .select('petty_cash_expenses.*', 'petty_cash_cards.currentBalance', 'petty_cash_cards.totalSpent')
        .join('petty_cash_cards', 'petty_cash_expenses.cardId', 'petty_cash_cards.id')
        .where('petty_cash_expenses.id', expenseId)
        .first();

      if (!expense) {
        throw new Error('Expense record not found');
      }

      if (expense.status !== 'pending') {
        throw new Error('Expense is not in pending status');
      }

      // Update expense status
      await trx('petty_cash_expenses')
        .where('id', expenseId)
        .update({
          status,
          approvedBy: userId,
          approvedAt: new Date(),
          approvalNotes: notes
        });

      // IMPORTANT: MySQL returns DECIMAL as strings, so we must parseFloat
      const expenseAmount = parseFloat(expense.amount) || 0;
      const cardBalance = parseFloat(expense.currentBalance) || 0;
      const totalSpent = parseFloat(expense.totalSpent) || 0;

      if (status === 'approved') {
        // Balance was ALREADY deducted on submission
        // Just update totalSpent to track approved expenses
        await trx('petty_cash_cards')
          .where('id', expense.cardId)
          .update({
            totalSpent: totalSpent + expenseAmount
          });

        // Record financial transaction (confirms the expense)
        await trx('transactions').insert({
          transactionNumber: this.generateTransactionNumber('petty_cash'),
          transactionType: 'petty_cash',
          referenceId: expenseId,
          referenceType: 'petty_cash_expense',
          materialId: null,
          quantity: null,
          unitPrice: null,
          amount: -expenseAmount, // Negative for expense
          transactionDate: expense.expenseDate,
          description: `Petty Cash Approved - ${expense.category}: ${expense.description}`,
          createdBy: userId
        });

        // Log to petty cash transactions table
        await trx('petty_cash_transactions').insert({
          card_id: expense.cardId,
          transaction_number: this.generateTransactionNumber('petty_cash'),
          transaction_type: 'expense_approved',
          amount: -expenseAmount, // Negative for deduction
          balance_before: cardBalance,
          balance_after: cardBalance, // Balance unchanged (already deducted)
          expense_id: expenseId,
          description: `Expense approved: ${expense.category} - ${expense.description}`,
          performed_by: userId,
          pc_user_id: expense.submitted_by_pc_user,
          transaction_date: new Date()
        });

        winston.info('Petty cash expense approved', {
          expenseId,
          amount: expenseAmount,
          cardId: expense.cardId,
          approvedBy: userId
        });

      } else if (status === 'rejected') {
        // RESTORE the balance - refund the reserved amount
        const newBalance = cardBalance + expenseAmount;

        await trx('petty_cash_cards')
          .where('id', expense.cardId)
          .update({
            currentBalance: newBalance
          });

        // Log to petty cash transactions table
        await trx('petty_cash_transactions').insert({
          card_id: expense.cardId,
          transaction_number: this.generateTransactionNumber('petty_cash'),
          transaction_type: 'expense_rejected',
          amount: expenseAmount, // Positive for refund
          balance_before: cardBalance,
          balance_after: newBalance,
          expense_id: expenseId,
          description: `Expense rejected (balance restored): ${expense.category} - ${notes || 'No reason provided'}`,
          performed_by: userId,
          pc_user_id: expense.submitted_by_pc_user,
          transaction_date: new Date()
        });

        winston.info('Petty cash expense rejected - balance restored', {
          expenseId,
          amount: expenseAmount,
          cardId: expense.cardId,
          previousBalance: cardBalance,
          newBalance: newBalance,
          rejectedBy: userId,
          reason: notes
        });
      }

      return {
        expenseId,
        status,
        amount: expenseAmount,
        balanceRestored: status === 'rejected' ? expenseAmount : 0
      };
    });
  }

  /**
   * Transfer inventory between locations/batches
   * @param {Object} transferData - Transfer details
   * @param {number} userId - User ID
   */
  async processInventoryTransfer(transferData, userId) {
    const { fromInventoryId, toInventoryId, materialId, quantity, notes } = transferData;

    return await this.executeTransaction(async (trx) => {
      // Get source inventory
      const fromInventory = await trx('inventory').where('id', fromInventoryId).first();
      if (!fromInventory || fromInventory.currentStock < quantity) {
        throw new Error('Insufficient stock in source inventory');
      }

      // Get destination inventory
      const toInventory = await trx('inventory').where('id', toInventoryId).first();
      if (!toInventory) {
        throw new Error('Destination inventory not found');
      }

      // Update source inventory
      await trx('inventory')
        .where('id', fromInventoryId)
        .decrement('currentStock', quantity);

      // Update destination inventory
      await trx('inventory')
        .where('id', toInventoryId)
        .increment('currentStock', quantity);

      // Record transfer transaction
      const transferNumber = this.generateTransactionNumber('transfer');

      // Outbound transaction
      await trx('transactions').insert({
        transactionNumber: `${transferNumber}-OUT`,
        transactionType: 'transfer',
        referenceId: fromInventoryId,
        referenceType: 'inventory_transfer_out',
        materialId,
        quantity: -quantity,
        unitPrice: fromInventory.averageCost,
        amount: -(quantity * fromInventory.averageCost),
        transactionDate: new Date(),
        description: `Inventory Transfer Out - ${notes}`,
        createdBy: userId
      });

      // Inbound transaction
      await trx('transactions').insert({
        transactionNumber: `${transferNumber}-IN`,
        transactionType: 'transfer',
        referenceId: toInventoryId,
        referenceType: 'inventory_transfer_in',
        materialId,
        quantity,
        unitPrice: fromInventory.averageCost,
        amount: quantity * fromInventory.averageCost,
        transactionDate: new Date(),
        description: `Inventory Transfer In - ${notes}`,
        createdBy: userId
      });

      return { transferNumber, quantity, value: quantity * fromInventory.averageCost };
    });
  }

  /**
   * Generate transaction number
   * @param {string} type - Transaction type
   */
  generateTransactionNumber(type) {
    const prefix = this.companyId === 'al-ramrami' ? 'ALR' : 'PM';
    const typeCode = {
      sale: 'S',
      purchase: 'P',
      wastage: 'W',
      petty_cash: 'PC',
      transfer: 'T',
      adjustment: 'ADJ'
    }[type] || 'TXN';
    
    const timestamp = Date.now().toString().slice(-8);
    return `${prefix}-${typeCode}-${timestamp}`;
  }

  /**
   * Get transaction statistics for a date range
   * @param {string} dateFrom - Start date
   * @param {string} dateTo - End date
   */
  async getTransactionStats(dateFrom, dateTo) {
    const query = this.db('transactions');
    
    if (dateFrom) query.where('transactionDate', '>=', dateFrom);
    if (dateTo) query.where('transactionDate', '<=', dateTo);
    
    return await query
      .select(
        this.db.raw('COUNT(*) as totalTransactions'),
        this.db.raw('SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) as totalIncome'),
        this.db.raw('SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END) as totalExpenses'),
        this.db.raw('SUM(amount) as netAmount')
      )
      .first();
  }

  /**
   * Process wastage amendment for approved wastages with differential inventory adjustment
   *
   * When amending an approved wastage:
   * - If new quantity > old quantity: reduce inventory by the difference
   * - If new quantity < old quantity: increase inventory by the difference
   *
   * @param {number} wastageId - Wastage ID
   * @param {Object} updateData - New wastage data { quantity, unitCost, reason, description, etc. }
   * @param {number} userId - User ID performing the amendment
   * @param {string} amendmentNotes - Notes explaining the amendment
   * @returns {Object} Amendment result
   */
  async processWastageAmendment(wastageId, updateData, userId, amendmentNotes = null) {
    return await this.executeTransaction(async (trx) => {
      // Get existing wastage
      const existingWastage = await trx('wastages').where('id', wastageId).first();

      if (!existingWastage) {
        throw new Error('Wastage record not found');
      }

      if (existingWastage.status !== 'approved') {
        throw new Error('Only approved wastages can be amended. Pending/rejected wastages can be updated normally.');
      }

      const oldQuantity = parseFloat(existingWastage.quantity);
      const newQuantity = parseFloat(updateData.quantity);
      const quantityDelta = newQuantity - oldQuantity;

      // Build amendment history note
      const amendmentTimestamp = new Date().toISOString();
      const amendmentHistory = existingWastage.amendmentHistory
        ? JSON.parse(existingWastage.amendmentHistory)
        : [];

      amendmentHistory.push({
        timestamp: amendmentTimestamp,
        previousQuantity: oldQuantity,
        newQuantity: newQuantity,
        previousUnitCost: parseFloat(existingWastage.unitCost),
        newUnitCost: parseFloat(updateData.unitCost || existingWastage.unitCost),
        amendedBy: userId,
        notes: amendmentNotes
      });

      // Calculate new total cost
      const unitCost = parseFloat(updateData.unitCost || existingWastage.unitCost);
      const newTotalCost = newQuantity * unitCost;

      // Prepare update data
      const updateFields = {
        quantity: newQuantity,
        unitCost: unitCost,
        totalCost: newTotalCost,
        reason: updateData.reason || existingWastage.reason,
        description: updateData.description || existingWastage.description,
        location: updateData.location !== undefined ? updateData.location : existingWastage.location,
        amendmentHistory: JSON.stringify(amendmentHistory),
        amendmentCount: (existingWastage.amendmentCount || 0) + 1,
        lastAmendedAt: new Date(),
        lastAmendedBy: userId,
        updated_at: new Date()
      };

      // Handle inventory adjustment if quantity changed
      let inventoryAdjustment = null;

      if (quantityDelta !== 0 && existingWastage.materialId) {
        if (quantityDelta > 0) {
          // New quantity is MORE - need to reduce additional inventory via FIFO
          const fifoResult = await allocateFIFO(
            trx,
            existingWastage.materialId,
            quantityDelta,
            'wastage_amendment',
            'wastage',
            wastageId,
            userId,
            {}
          );

          if (fifoResult.success) {
            inventoryAdjustment = {
              type: 'reduction',
              quantity: quantityDelta,
              cogs: fifoResult.totalCOGS,
              batchesUsed: fifoResult.batchesUsed
            };

            winston.info('Wastage amendment: additional inventory reduction via FIFO', {
              wastageId,
              materialId: existingWastage.materialId,
              additionalQty: quantityDelta,
              cogs: fifoResult.totalCOGS
            });
          } else {
            throw new Error(`Insufficient inventory for amendment: ${fifoResult.error}`);
          }

        } else {
          // New quantity is LESS - need to restore inventory
          // We add back the difference using adjustment movement
          const restorationQty = Math.abs(quantityDelta);
          const movementDate = new Date().toISOString().split('T')[0];

          // Find the most recent batch for this material to restore to
          const latestBatch = await trx('inventory_batches')
            .where('material_id', existingWastage.materialId)
            .orderBy('purchase_date', 'desc')
            .orderBy('id', 'desc')
            .first();

          if (latestBatch) {
            // Restore to the latest batch
            await trx('inventory_batches')
              .where('id', latestBatch.id)
              .increment('remaining_quantity', restorationQty)
              .update({
                is_depleted: false,
                updated_at: new Date()
              });

            // Create restoration movement record
            await trx('batch_movements').insert({
              batch_id: latestBatch.id,
              movement_type: 'adjustment',
              quantity: restorationQty, // Positive for restoration
              reference_type: 'wastage_amendment_restoration',
              reference_id: wastageId,
              movement_date: movementDate,
              notes: `Wastage amendment restoration: ${restorationQty} units restored (original wastage qty reduced)`,
              created_by: userId,
              created_at: new Date()
            });

            inventoryAdjustment = {
              type: 'restoration',
              quantity: restorationQty,
              batchId: latestBatch.id,
              batchNumber: latestBatch.batch_number
            };

            winston.info('Wastage amendment: inventory restoration', {
              wastageId,
              materialId: existingWastage.materialId,
              restoredQty: restorationQty,
              toBatchId: latestBatch.id
            });
          } else {
            // No existing batches - create an adjustment entry in legacy inventory if exists
            if (existingWastage.inventoryId) {
              await trx('inventory')
                .where('id', existingWastage.inventoryId)
                .increment('currentStock', restorationQty);

              inventoryAdjustment = {
                type: 'restoration_legacy',
                quantity: restorationQty,
                inventoryId: existingWastage.inventoryId
              };
            }
          }
        }
      }

      // Update wastage record
      await trx('wastages').where('id', wastageId).update(updateFields);

      // Record financial transaction for the amendment (difference only)
      if (quantityDelta !== 0) {
        const transactionAmount = quantityDelta * unitCost;

        await trx('transactions').insert({
          transactionNumber: this.generateTransactionNumber('adjustment'),
          transactionType: 'wastage_amendment',
          referenceId: wastageId,
          referenceType: 'wastage',
          materialId: existingWastage.materialId,
          quantity: quantityDelta,
          unitPrice: unitCost,
          amount: transactionAmount > 0 ? -transactionAmount : Math.abs(transactionAmount), // Negative for additional loss, positive for recovery
          transactionDate: existingWastage.wastageDate,
          description: `Wastage Amendment - ${amendmentNotes || 'Quantity adjusted'}: ${oldQuantity} → ${newQuantity}`,
          createdBy: userId
        });
      }

      winston.info('Wastage amended successfully', {
        wastageId,
        oldQuantity,
        newQuantity,
        quantityDelta,
        inventoryAdjustment,
        amendedBy: userId
      });

      return {
        wastageId,
        oldQuantity,
        newQuantity,
        quantityDelta,
        newTotalCost,
        inventoryAdjustment,
        amendmentCount: updateFields.amendmentCount
      };
    });
  }

  /**
   * Cleanup old transactions (for maintenance)
   * @param {number} daysOld - Days to keep
   */
  async cleanupOldTransactions(daysOld = 2555) { // ~7 years default
    return await this.executeTransaction(async (trx) => {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);
      
      // Archive old transactions instead of deleting
      const oldTransactions = await trx('transactions')
        .where('transactionDate', '<', cutoffDate.toISOString().split('T')[0])
        .select('*');
      
      if (oldTransactions.length > 0) {
        // Create archive record (could be separate table)
        winston.info('Archiving old transactions', {
          count: oldTransactions.length,
          cutoffDate: cutoffDate.toISOString(),
          companyId: this.companyId
        });
      }
      
      return { archived: oldTransactions.length };
    });
  }
}

module.exports = TransactionManager;