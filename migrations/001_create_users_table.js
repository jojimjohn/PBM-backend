/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.createTable('users', function(table) {
    table.increments('id').primary();
    table.string('email', 255).notNullable();
    table.string('password', 255).notNullable();
    table.string('firstName', 100).notNullable();
    table.string('lastName', 100).notNullable();
    table.enum('role', [
      'super-admin',
      'company-admin', 
      'manager',
      'sales-staff',
      'purchase-staff',
      'accounts-staff'
    ]).notNullable();
    table.enum('companyId', ['al-ramrami', 'pride-muscat']).notNullable();
    table.boolean('isActive').defaultTo(true);
    table.datetime('lastLoginAt').nullable();
    table.string('lastLoginIp', 45).nullable();
    table.timestamps(true, true);

    // Indexes
    table.unique(['email', 'companyId']); // Unique email per company
    table.index(['email']);
    table.index(['companyId']);
    table.index(['role']);
    table.index(['isActive']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTable('users');
};