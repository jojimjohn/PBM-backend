/**
 * Flexible Sales Orders Table - No foreign key dependency on customers table
 * Stores customer information directly when customers module is not enabled
 */
exports.up = function(knex) {
  return knex.schema.createTable('sales_orders', function(table) {
    table.increments('id').primary();
    table.string('orderNumber', 100).notNullable().unique();
    
    // Flexible customer reference - can be ID or direct info
    table.integer('customerId').unsigned().nullable(); // Only used if customers module exists
    table.string('customerName', 200).nullable(); // Direct customer name
    table.string('customerPhone', 20).nullable(); // Direct customer contact
    table.string('customerEmail', 255).nullable(); // Direct customer email
    table.text('customerAddress').nullable(); // Direct customer address
    table.string('customerType', 50).nullable(); // walk-in, project, contract
    
    table.date('orderDate').notNullable();
    table.date('expectedDeliveryDate').nullable();
    table.date('actualDeliveryDate').nullable();
    table.enum('status', ['draft', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled']).defaultTo('draft');
    table.enum('paymentStatus', ['pending', 'partial', 'paid', 'overdue']).defaultTo('pending');
    table.decimal('subtotal', 15, 2).notNullable().defaultTo(0);
    table.decimal('taxAmount', 15, 2).defaultTo(0);
    table.decimal('discountAmount', 15, 2).defaultTo(0);
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
    
    // Optional foreign key to customers table (only if it exists)
    // This will be handled programmatically, not as DB constraint

    // Indexes
    table.index(['orderNumber']);
    table.index(['customerId']); // Index even if nullable
    table.index(['customerName']); // For direct customer searches
    table.index(['orderDate']);
    table.index(['status']);
    table.index(['paymentStatus']);
    table.index(['createdBy']);
  });
};

exports.down = function(knex) {
  return knex.schema.dropTable('sales_orders');
};