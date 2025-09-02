/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.createTable('inventory', function(table) {
    table.increments('id').primary();
    table.integer('materialId').unsigned().notNullable();
    table.string('batchNumber', 100).nullable();
    table.decimal('quantity', 15, 3).notNullable().defaultTo(0);
    table.decimal('reservedQuantity', 15, 3).defaultTo(0); // For pending orders
    table.decimal('averageCost', 15, 3).notNullable().defaultTo(0);
    table.decimal('lastPurchasePrice', 15, 3).nullable();
    table.date('lastPurchaseDate').nullable();
    table.date('expiryDate').nullable();
    table.string('location', 100).nullable(); // Storage location
    table.enum('condition', ['new', 'used', 'refurbished', 'damaged']).defaultTo('new');
    table.text('notes').nullable();
    table.decimal('minimumStockLevel', 15, 3).defaultTo(0);
    table.decimal('maximumStockLevel', 15, 3).defaultTo(0);
    table.boolean('isActive').defaultTo(true);
    table.timestamps(true, true);

    // Foreign keys
    table.foreign('materialId').references('id').inTable('materials').onDelete('RESTRICT');

    // Indexes
    table.index(['materialId']);
    table.index(['batchNumber']);
    table.index(['expiryDate']);
    table.index(['isActive']);
    table.index(['condition']);
    table.unique(['materialId', 'batchNumber']); // Unique material-batch combination
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTable('inventory');
};