/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.createTable('purchase_order_items', function(table) {
    table.increments('id').primary();
    table.integer('purchaseOrderId').unsigned().notNullable();
    table.integer('materialId').unsigned().notNullable();
    table.decimal('quantityOrdered', 15, 3).notNullable();
    table.decimal('quantityReceived', 15, 3).defaultTo(0);
    table.decimal('unitPrice', 15, 3).notNullable();
    table.decimal('totalPrice', 15, 2).notNullable();
    table.string('batchNumber', 100).nullable();
    table.date('expiryDate').nullable();
    table.text('notes').nullable();
    table.timestamps(true, true);

    // Foreign keys
    table.foreign('purchaseOrderId').references('id').inTable('purchase_orders').onDelete('CASCADE');
    table.foreign('materialId').references('id').inTable('materials').onDelete('RESTRICT');

    // Indexes
    table.index(['purchaseOrderId']);
    table.index(['materialId']);
    table.index(['batchNumber']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTable('purchase_order_items');
};