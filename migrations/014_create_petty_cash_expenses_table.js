/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.createTable('petty_cash_expenses', function(table) {
    table.increments('id').primary();
    table.string('expenseNumber', 100).notNullable().unique();
    table.integer('cardId').unsigned().notNullable();
    table.string('category', 100).notNullable();
    table.text('description').notNullable();
    table.decimal('amount', 15, 2).notNullable();
    table.date('expenseDate').notNullable();
    table.string('vendor', 200).nullable();
    table.string('receiptNumber', 100).nullable();
    table.string('receiptPhoto', 500).nullable(); // File path
    table.enum('status', ['pending', 'approved', 'rejected']).defaultTo('pending');
    table.integer('submittedBy').unsigned().notNullable();
    table.integer('approvedBy').unsigned().nullable();
    table.date('approvedAt').nullable();
    table.text('approvalNotes').nullable();
    table.text('notes').nullable();
    table.timestamps(true, true);

    // Foreign keys
    table.foreign('cardId').references('id').inTable('petty_cash_cards').onDelete('RESTRICT');
    table.foreign('submittedBy').references('id').inTable('users').onDelete('RESTRICT');
    table.foreign('approvedBy').references('id').inTable('users').onDelete('SET NULL');

    // Indexes
    table.index(['expenseNumber']);
    table.index(['cardId']);
    table.index(['category']);
    table.index(['expenseDate']);
    table.index(['status']);
    table.index(['submittedBy']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTable('petty_cash_expenses');
};