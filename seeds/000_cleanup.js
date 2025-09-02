/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> } 
 */
exports.seed = async function(knex) {
  console.log('🧹 Cleaning database for fresh seed...');
  
  // Check if tables exist and delete in reverse order of dependencies
  const tables = ['transactions', 'petty_cash_expenses', 'petty_cash_cards', 'wastages', 
                 'purchase_order_items', 'purchase_orders', 'sales_order_items', 'sales_orders', 
                 'contract_rates', 'contracts', 'inventory', 'customers', 'suppliers', 'materials'];
  
  for (const table of tables) {
    try {
      const exists = await knex.schema.hasTable(table);
      if (exists) {
        await knex(table).del();
      }
    } catch (error) {
      console.log(`   ⚠️  Skipping ${table}: ${error.message}`);
    }
  }
  
  console.log('✅ Database cleaned successfully');
};