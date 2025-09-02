/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.alterTable('users', function(table) {
    // Drop the old enum constraint and recreate with new values
    table.dropColumn('role');
  })
  .then(() => {
    return knex.schema.alterTable('users', function(table) {
      table.enum('role', [
        'SUPER_ADMIN',
        'COMPANY_ADMIN', 
        'MANAGER',
        'SALES',
        'PURCHASE',
        'ACCOUNTS'
      ]).notNullable().defaultTo('SALES');
      table.index(['role']);
    });
  })
  .then(() => {
    // Update existing data if any exists
    return knex('users').update({
      role: knex.raw(`CASE 
        WHEN role = 'super-admin' THEN 'SUPER_ADMIN'
        WHEN role = 'company-admin' THEN 'COMPANY_ADMIN'
        WHEN role = 'manager' THEN 'MANAGER'
        WHEN role = 'sales-staff' THEN 'SALES'
        WHEN role = 'purchase-staff' THEN 'PURCHASE'
        WHEN role = 'accounts-staff' THEN 'ACCOUNTS'
        ELSE role
      END`)
    });
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.alterTable('users', function(table) {
    table.dropColumn('role');
  })
  .then(() => {
    return knex.schema.alterTable('users', function(table) {
      table.enum('role', [
        'super-admin',
        'company-admin', 
        'manager',
        'sales-staff',
        'purchase-staff',
        'accounts-staff'
      ]).notNullable();
      table.index(['role']);
    });
  })
  .then(() => {
    // Revert data changes
    return knex('users').update({
      role: knex.raw(`CASE 
        WHEN role = 'SUPER_ADMIN' THEN 'super-admin'
        WHEN role = 'COMPANY_ADMIN' THEN 'company-admin'
        WHEN role = 'MANAGER' THEN 'manager'
        WHEN role = 'SALES' THEN 'sales-staff'
        WHEN role = 'PURCHASE' THEN 'purchase-staff'
        WHEN role = 'ACCOUNTS' THEN 'accounts-staff'
        ELSE role
      END`)
    });
  });
};