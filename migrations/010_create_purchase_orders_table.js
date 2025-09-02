/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.createTable('purchase_orders', function(table) {
    table.increments('id').primary();
    table.string('orderNumber', 100).notNullable().unique();
    table.integer('supplierId').unsigned().notNullable();
    table.date('orderDate').notNullable();
    table.date('expectedDeliveryDate').nullable();
    table.date('actualDeliveryDate').nullable();
    table.enum('status', ['draft', 'pending', 'approved', 'sent', 'received', 'completed', 'cancelled']).defaultTo('draft');
    table.decimal('subtotal', 15, 2).notNullable().defaultTo(0);
    table.decimal('taxAmount', 15, 2).defaultTo(0);
    table.decimal('shippingCost', 15, 2).defaultTo(0);
    table.decimal('totalAmount', 15, 2).notNullable().defaultTo(0);
    table.string('currency', 3).defaultTo('OMR');
    table.text('deliveryAddress').nullable();
    table.text('terms').nullable();
    table.text('notes').nullable();
    table.integer('createdBy').unsigned().notNullable();
    table.integer('approvedBy').unsigned().nullable();
    table.date('approvedAt').nullable();
    table.timestamps(true, true);

    // Foreign keys
    table.foreign('supplierId').references('id').inTable('suppliers').onDelete('RESTRICT');
    table.foreign('createdBy').references('id').inTable('users').onDelete('RESTRICT');
    table.foreign('approvedBy').references('id').inTable('users').onDelete('SET NULL');

    // Indexes
    table.index(['orderNumber']);
    table.index(['supplierId']);
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
  return knex.schema.dropTable('purchase_orders');
};