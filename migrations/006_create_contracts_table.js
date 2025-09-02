/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.createTable('contracts', function(table) {
    table.increments('id').primary();
    table.integer('customerId').unsigned().notNullable();
    table.string('contractNumber', 100).notNullable().unique();
    table.string('title', 200).notNullable();
    table.date('startDate').notNullable();
    table.date('endDate').notNullable();
    table.enum('status', ['draft', 'active', 'expired', 'terminated', 'renewed']).defaultTo('draft');
    table.decimal('totalValue', 15, 2).nullable();
    table.string('currency', 3).defaultTo('OMR');
    table.text('terms').nullable();
    table.text('notes').nullable();
    table.integer('createdBy').unsigned().nullable();
    table.integer('approvedBy').unsigned().nullable();
    table.date('approvedAt').nullable();
    table.timestamps(true, true);

    // Foreign keys
    table.foreign('customerId').references('id').inTable('customers').onDelete('RESTRICT');
    table.foreign('createdBy').references('id').inTable('users').onDelete('SET NULL');
    table.foreign('approvedBy').references('id').inTable('users').onDelete('SET NULL');

    // Indexes
    table.index(['customerId']);
    table.index(['contractNumber']);
    table.index(['status']);
    table.index(['startDate', 'endDate']);
    table.index(['createdBy']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTable('contracts');
};