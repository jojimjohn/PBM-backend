/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.raw(`
    ALTER TABLE users 
    MODIFY COLUMN role ENUM(
      'SUPER_ADMIN',
      'COMPANY_ADMIN', 
      'MANAGER',
      'SALES_STAFF',
      'PURCHASE_STAFF',
      'ACCOUNTS_STAFF'
    ) NOT NULL
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.raw(`
    ALTER TABLE users 
    MODIFY COLUMN role ENUM(
      'super-admin',
      'company-admin', 
      'manager',
      'sales-staff',
      'purchase-staff',
      'accounts-staff'
    ) NOT NULL
  `);
};