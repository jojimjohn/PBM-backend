/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.createTable('transactions', function(table) {
    table.increments('id').primary();
    table.string('transactionNumber', 100).notNullable().unique();
    table.enum('transactionType', [
      'sale', 'purchase', 'adjustment', 'transfer', 
      'wastage', 'return', 'petty_cash', 'expense'
    ]).notNullable();
    table.integer('referenceId').unsigned().nullable(); // ID of related record
    table.string('referenceType', 50).nullable(); // Type of related record
    table.integer('materialId').unsigned().nullable();
    table.decimal('quantity', 15, 3).nullable();
    table.decimal('unitPrice', 15, 3).nullable();
    table.decimal('amount', 15, 2).notNullable();
    table.date('transactionDate').notNullable();
    table.text('description').nullable();
    table.text('notes').nullable();
    table.integer('createdBy').unsigned().notNullable();
    table.timestamps(true, true);

    // Foreign keys
    table.foreign('materialId').references('id').inTable('materials').onDelete('SET NULL');
    table.foreign('createdBy').references('id').inTable('users').onDelete('RESTRICT');

    // Indexes
    table.index(['transactionNumber']);
    table.index(['transactionType']);
    table.index(['referenceId', 'referenceType']);
    table.index(['materialId']);
    table.index(['transactionDate']);
    table.index(['createdBy']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTable('transactions');
};