/**
 * Flexible Purchase Orders Table - No foreign key dependency on suppliers table
 * Stores supplier information directly when suppliers module is not enabled
 */
exports.up = function(knex) {
  return knex.schema.createTable('purchase_orders', function(table) {
    table.increments('id').primary();
    table.string('orderNumber', 100).notNullable().unique();
    
    // Flexible supplier reference - can be ID or direct info
    table.integer('supplierId').unsigned().nullable(); // Only used if suppliers module exists
    table.string('supplierName', 200).nullable(); // Direct supplier name
    table.string('supplierPhone', 20).nullable(); // Direct supplier contact
    table.string('supplierEmail', 255).nullable(); // Direct supplier email
    table.text('supplierAddress').nullable(); // Direct supplier address
    
    table.date('orderDate').notNullable();
    table.date('expectedDeliveryDate').nullable();
    table.date('actualDeliveryDate').nullable();
    table.enum('status', ['draft', 'pending', 'approved', 'sent', 'received', 'completed', 'cancelled']).defaultTo('draft');
    table.decimal('subtotal', 15, 2).notNullable().defaultTo(0);
    table.decimal('taxAmount', 15, 2).defaultTo(0);
    table.decimal('shippingCost', 15, 2).defaultTo(0);
    table.decimal('totalAmount', 15, 2).notNullable().defaultTo(0);
    table.string('currency', 3).defaultTo('OMR');
    table.text('deliveryAddress').nullable();
    table.text('terms').nullable();
    table.text('notes').nullable();
    table.integer('createdBy').unsigned().notNullable();
    table.integer('approvedBy').unsigned().nullable();
    table.date('approvedAt').nullable();
    table.timestamps(true, true);

    // Foreign keys - only to guaranteed tables
    table.foreign('createdBy').references('id').inTable('users').onDelete('RESTRICT');
    table.foreign('approvedBy').references('id').inTable('users').onDelete('SET NULL');
    
    // Optional foreign key to suppliers table (only if it exists)
    // This will be handled programmatically, not as DB constraint

    // Indexes
    table.index(['orderNumber']);
    table.index(['supplierId']); // Index even if nullable
    table.index(['supplierName']); // For direct supplier searches
    table.index(['orderDate']);
    table.index(['status']);
    table.index(['createdBy']);
  });
};

exports.down = function(knex) {
  return knex.schema.dropTable('purchase_orders');
};