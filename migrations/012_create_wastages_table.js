/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.createTable('wastages', function(table) {
    table.increments('id').primary();
    table.string('wastageNumber', 100).notNullable().unique();
    table.integer('materialId').unsigned().notNullable();
    table.integer('inventoryId').unsigned().nullable(); // Specific inventory batch
    table.decimal('quantity', 15, 3).notNullable();
    table.decimal('unitCost', 15, 3).notNullable();
    table.decimal('totalCost', 15, 2).notNullable();
    table.enum('wasteType', [
      'spillage', 'contamination', 'expiry', 'damage', 
      'theft', 'evaporation', 'sorting_loss', 'quality_rejection',
      'transport_loss', 'handling_damage', 'other'
    ]).notNullable();
    table.text('reason').nullable();
    table.text('description').nullable();
    table.date('wastageDate').notNullable();
    table.string('location', 100).nullable();
    table.enum('status', ['pending', 'approved', 'rejected']).defaultTo('pending');
    table.integer('reportedBy').unsigned().notNullable();
    table.integer('approvedBy').unsigned().nullable();
    table.date('approvedAt').nullable();
    table.text('approvalNotes').nullable();
    table.string('attachments', 500).nullable(); // JSON array of file paths
    table.timestamps(true, true);

    // Foreign keys
    table.foreign('materialId').references('id').inTable('materials').onDelete('RESTRICT');
    table.foreign('inventoryId').references('id').inTable('inventory').onDelete('SET NULL');
    table.foreign('reportedBy').references('id').inTable('users').onDelete('RESTRICT');
    table.foreign('approvedBy').references('id').inTable('users').onDelete('SET NULL');

    // Indexes
    table.index(['wastageNumber']);
    table.index(['materialId']);
    table.index(['wastageDate']);
    table.index(['wasteType']);
    table.index(['status']);
    table.index(['reportedBy']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTable('wastages');
};