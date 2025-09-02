/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.createTable('sales_orders', function(table) {
    table.increments('id').primary();
    table.string('orderNumber', 100).notNullable().unique();
    table.integer('customerId').unsigned().notNullable();
    table.integer('contractId').unsigned().nullable(); // If order is from a contract
    table.date('orderDate').notNullable();
    table.date('deliveryDate').nullable();
    table.enum('status', ['draft', 'pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled']).defaultTo('draft');
    table.decimal('subtotal', 15, 2).notNullable().defaultTo(0);
    table.decimal('taxAmount', 15, 2).defaultTo(0);
    table.decimal('discountAmount', 15, 2).defaultTo(0);
    table.decimal('totalAmount', 15, 2).notNullable().defaultTo(0);
    table.string('currency', 3).defaultTo('OMR');
    table.text('deliveryAddress').nullable();
    table.text('notes').nullable();
    table.integer('createdBy').unsigned().notNullable();
    table.integer('approvedBy').unsigned().nullable();
    table.date('approvedAt').nullable();
    table.timestamps(true, true);

    // Foreign keys
    table.foreign('customerId').references('id').inTable('customers').onDelete('RESTRICT');
    table.foreign('contractId').references('id').inTable('contracts').onDelete('SET NULL');
    table.foreign('createdBy').references('id').inTable('users').onDelete('RESTRICT');
    table.foreign('approvedBy').references('id').inTable('users').onDelete('SET NULL');

    // Indexes
    table.index(['orderNumber']);
    table.index(['customerId']);
    table.index(['contractId']);
    table.index(['orderDate']);
    table.index(['status']);
    table.index(['createdBy']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTable('sales_orders');
};