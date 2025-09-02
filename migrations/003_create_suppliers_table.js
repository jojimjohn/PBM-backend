/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.createTable('suppliers', function(table) {
    table.increments('id').primary();
    table.string('name', 200).notNullable();
    table.string('email', 255).nullable();
    table.string('phone', 20).nullable();
    table.text('address').nullable();
    table.string('vatRegistration', 50).nullable();
    table.string('contactPerson', 100).nullable();
    table.string('specialization', 100).nullable(); // For scrap business
    table.decimal('creditBalance', 15, 2).defaultTo(0);
    table.integer('paymentTermDays').defaultTo(0);
    table.text('notes').nullable();
    table.boolean('isActive').defaultTo(true);
    table.timestamps(true, true);

    // Indexes
    table.index(['name']);
    table.index(['isActive']);
    table.index(['email']);
    table.index(['specialization']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTable('suppliers');
};