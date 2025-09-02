/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.createTable('customers', function(table) {
    table.increments('id').primary();
    table.string('name', 200).notNullable();
    table.string('email', 255).nullable();
    table.string('phone', 20).nullable();
    table.text('address').nullable();
    table.enum('customerType', ['walk-in', 'project-based', 'contract']).notNullable().defaultTo('walk-in');
    table.string('vatRegistration', 50).nullable();
    table.string('contactPerson', 100).nullable();
    table.decimal('creditLimit', 15, 2).defaultTo(0);
    table.integer('paymentTermDays').defaultTo(0);
    table.text('notes').nullable();
    table.boolean('isActive').defaultTo(true);
    table.timestamps(true, true);

    // Indexes
    table.index(['name']);
    table.index(['customerType']);
    table.index(['isActive']);
    table.index(['email']);
    table.index(['phone']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTable('customers');
};