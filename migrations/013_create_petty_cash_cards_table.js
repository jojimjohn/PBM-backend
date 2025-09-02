/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.createTable('petty_cash_cards', function(table) {
    table.increments('id').primary();
    table.string('cardNumber', 50).notNullable().unique();
    table.integer('assignedTo').unsigned().notNullable(); // User ID
    table.string('staffName', 100).notNullable();
    table.string('department', 100).nullable();
    table.decimal('initialBalance', 15, 2).notNullable().defaultTo(0);
    table.decimal('currentBalance', 15, 2).notNullable().defaultTo(0);
    table.decimal('totalSpent', 15, 2).defaultTo(0);
    table.decimal('monthlyLimit', 15, 2).nullable();
    table.date('issueDate').notNullable();
    table.date('expiryDate').nullable();
    table.enum('status', ['active', 'suspended', 'expired', 'closed']).defaultTo('active');
    table.text('notes').nullable();
    table.integer('createdBy').unsigned().notNullable();
    table.timestamps(true, true);

    // Foreign keys
    table.foreign('assignedTo').references('id').inTable('users').onDelete('RESTRICT');
    table.foreign('createdBy').references('id').inTable('users').onDelete('RESTRICT');

    // Indexes
    table.index(['cardNumber']);
    table.index(['assignedTo']);
    table.index(['status']);
    table.index(['issueDate']);
    table.index(['createdBy']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTable('petty_cash_cards');
};