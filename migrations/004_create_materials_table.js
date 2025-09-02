/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.createTable('materials', function(table) {
    table.increments('id').primary();
    table.string('code', 50).notNullable().unique();
    table.string('name', 200).notNullable();
    table.text('description').nullable();
    table.enum('category', [
      // Oil business categories
      'engine-oil', 'transformer-oil', 'lube-oil', 'cooking-oil', 
      'empty-drums', 'diesel', 'lubricants',
      // Scrap business categories
      'metal-scrap', 'aluminum', 'copper', 'steel', 'brass', 
      'electronic-waste', 'plastic', 'rubber', 'paper'
    ]).notNullable();
    table.string('unit', 20).notNullable().defaultTo('liters'); // liters, kg, tons, pieces
    table.decimal('standardPrice', 15, 3).defaultTo(0);
    table.decimal('minimumPrice', 15, 3).defaultTo(0);
    table.decimal('density', 8, 4).nullable(); // For oil products
    table.integer('shelfLifeDays').nullable(); // For products with expiry
    table.text('specifications').nullable(); // Technical specs
    table.string('barcode', 100).nullable();
    table.boolean('trackBatches').defaultTo(false);
    table.boolean('isActive').defaultTo(true);
    table.timestamps(true, true);

    // Indexes
    table.index(['code']);
    table.index(['category']);
    table.index(['isActive']);
    table.index(['name']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTable('materials');
};