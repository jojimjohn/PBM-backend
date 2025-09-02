/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.createTable('contract_rates', function(table) {
    table.increments('id').primary();
    table.integer('contractId').unsigned().notNullable();
    table.integer('materialId').unsigned().notNullable();
    table.enum('rateType', ['fixed_rate', 'discount_percentage', 'minimum_price_guarantee']).notNullable();
    table.decimal('contractRate', 15, 3).notNullable();
    table.decimal('discountPercentage', 5, 2).nullable(); // For discount type
    table.decimal('minimumPrice', 15, 3).nullable(); // For minimum guarantee
    table.text('description').nullable();
    table.boolean('isActive').defaultTo(true);
    table.timestamps(true, true);

    // Foreign keys
    table.foreign('contractId').references('id').inTable('contracts').onDelete('CASCADE');
    table.foreign('materialId').references('id').inTable('materials').onDelete('RESTRICT');

    // Indexes
    table.index(['contractId']);
    table.index(['materialId']);
    table.index(['rateType']);
    table.index(['isActive']);
    table.unique(['contractId', 'materialId']); // One rate per material per contract
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTable('contract_rates');
};