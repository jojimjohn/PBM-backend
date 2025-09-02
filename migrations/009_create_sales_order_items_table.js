/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.createTable('sales_order_items', function(table) {
    table.increments('id').primary();
    table.integer('salesOrderId').unsigned().notNullable();
    table.integer('materialId').unsigned().notNullable();
    table.integer('inventoryId').unsigned().nullable(); // Specific inventory batch
    table.decimal('quantity', 15, 3).notNullable();
    table.decimal('unitPrice', 15, 3).notNullable();
    table.decimal('contractRate', 15, 3).nullable(); // Applied contract rate
    table.decimal('discountPercentage', 5, 2).defaultTo(0);
    table.decimal('discountAmount', 15, 2).defaultTo(0);
    table.decimal('totalPrice', 15, 2).notNullable();
    table.text('notes').nullable();
    table.timestamps(true, true);

    // Foreign keys
    table.foreign('salesOrderId').references('id').inTable('sales_orders').onDelete('CASCADE');
    table.foreign('materialId').references('id').inTable('materials').onDelete('RESTRICT');
    table.foreign('inventoryId').references('id').inTable('inventory').onDelete('SET NULL');

    // Indexes
    table.index(['salesOrderId']);
    table.index(['materialId']);
    table.index(['inventoryId']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTable('sales_order_items');
};