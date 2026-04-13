-- ============================================================================
-- Project-Based Access Control Migration
-- For Al Ramrami Trading Enterprises (alliehvb_al_ramrami_db)
-- ============================================================================
-- This script:
-- 1. Adds project_id column to tables that don't have it
-- 2. Creates a GENERAL project for legacy/unassigned data
-- 3. Assigns all existing data with NULL project_id to GENERAL project
-- 4. Assigns all existing users to GENERAL project
-- ============================================================================

-- Use Al Ramrami database
USE alliehvb_al_ramrami_db;

-- ============================================================================
-- STEP 0: Add project_id column to tables that don't have it
-- ============================================================================
-- Note: Based on actual table structure:
-- - sales_orders: ALREADY HAS project_id
-- - purchase_orders: ALREADY HAS project_id
-- - collection_orders: MISSING project_id (column is calloutId not callout_id)
-- - wastages: MISSING project_id

-- Add project_id to collection_orders if missing (after calloutId column)
SET @sql = (SELECT IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'collection_orders' AND COLUMN_NAME = 'project_id') = 0,
    'ALTER TABLE collection_orders ADD COLUMN project_id INT UNSIGNED NULL AFTER calloutId, ADD INDEX idx_collection_orders_project (project_id)',
    'SELECT "project_id already exists in collection_orders" AS status'
));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add project_id to wastages if missing (after collectionOrderId column)
SET @sql = (SELECT IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wastages' AND COLUMN_NAME = 'project_id') = 0,
    'ALTER TABLE wastages ADD COLUMN project_id INT UNSIGNED NULL AFTER collectionOrderId, ADD INDEX idx_wastages_project (project_id)',
    'SELECT "project_id already exists in wastages" AS status'
));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT 'Step 0 Complete: project_id columns added to collection_orders and wastages' AS status;

-- ============================================================================
-- STEP 1: Create GENERAL Project
-- ============================================================================
-- Check and insert GENERAL project only if it doesn't exist

INSERT INTO projects (company_id, code, name, description, status, created_at, updated_at)
SELECT
    'al-ramrami',
    'GENERAL',
    'General',
    'Default project for unassigned and legacy data. All users are assigned to this project by default.',
    'active',
    NOW(),
    NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM projects WHERE company_id = 'al-ramrami' AND code = 'GENERAL'
);

-- Get the GENERAL project ID for use in subsequent queries
SET @general_project_id = (
    SELECT id FROM projects WHERE company_id = 'al-ramrami' AND code = 'GENERAL' LIMIT 1
);

SELECT CONCAT('GENERAL project ID: ', IFNULL(@general_project_id, 'NOT FOUND')) AS status;

-- ============================================================================
-- STEP 2: Assign Legacy Data to GENERAL Project
-- ============================================================================
-- Update all records with NULL project_id to use the GENERAL project

-- 2a. Update sales_orders
UPDATE sales_orders
SET project_id = @general_project_id, updated_at = NOW()
WHERE project_id IS NULL AND @general_project_id IS NOT NULL;

SELECT CONCAT('Sales orders updated: ', ROW_COUNT()) AS sales_orders_updated;

-- 2b. Update purchase_orders
UPDATE purchase_orders
SET project_id = @general_project_id, updated_at = NOW()
WHERE project_id IS NULL AND @general_project_id IS NOT NULL;

SELECT CONCAT('Purchase orders updated: ', ROW_COUNT()) AS purchase_orders_updated;

-- 2c. Update collection_orders
UPDATE collection_orders
SET project_id = @general_project_id, updated_at = NOW()
WHERE project_id IS NULL AND @general_project_id IS NOT NULL;

SELECT CONCAT('Collection orders updated: ', ROW_COUNT()) AS collection_orders_updated;

-- 2d. Update wastages
UPDATE wastages
SET project_id = @general_project_id, updated_at = NOW()
WHERE project_id IS NULL AND @general_project_id IS NOT NULL;

SELECT CONCAT('Wastages updated: ', ROW_COUNT()) AS wastages_updated;

-- ============================================================================
-- STEP 3: Assign All Existing Users to GENERAL Project
-- ============================================================================
-- This ensures all current users can access the legacy data
-- Uses INSERT IGNORE to skip users already assigned
-- Note: assigned_by is required - we use user's own ID (self-assignment for migration)

INSERT IGNORE INTO user_projects (user_id, project_id, role_in_project, assigned_by, assigned_at)
SELECT
    u.id,
    @general_project_id,
    'contributor',
    u.id,  -- Self-assigned during migration
    NOW()
FROM users u
WHERE @general_project_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM user_projects up
      WHERE up.user_id = u.id AND up.project_id = @general_project_id
  );

SELECT CONCAT('Users assigned to GENERAL project: ', ROW_COUNT()) AS users_assigned;

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

-- Show GENERAL project details
SELECT
    id,
    company_id,
    code,
    name,
    status,
    created_at
FROM projects
WHERE code = 'GENERAL';

-- Show user-project assignments for GENERAL
SELECT
    u.id AS user_id,
    u.email,
    u.role,
    up.role_in_project,
    up.assigned_at
FROM user_projects up
JOIN users u ON u.id = up.user_id
WHERE up.project_id = @general_project_id
ORDER BY u.id;

-- Count records still with NULL project_id (should be 0 after migration)
SELECT
    'sales_orders' AS table_name, COUNT(*) AS null_project_count FROM sales_orders WHERE project_id IS NULL
UNION ALL
SELECT
    'purchase_orders', COUNT(*) FROM purchase_orders WHERE project_id IS NULL
UNION ALL
SELECT
    'collection_orders', COUNT(*) FROM collection_orders WHERE project_id IS NULL
UNION ALL
SELECT
    'wastages', COUNT(*) FROM wastages WHERE project_id IS NULL;

-- ============================================================================
-- ROLLBACK SCRIPT (if needed)
-- ============================================================================
-- To rollback this migration, run:
/*
USE alliehvb_al_ramrami_db;

-- Get GENERAL project ID
SET @general_project_id = (SELECT id FROM projects WHERE company_id = 'al-ramrami' AND code = 'GENERAL');

-- Remove user-project assignments for GENERAL
DELETE FROM user_projects WHERE project_id = @general_project_id;

-- Set project_id back to NULL for records assigned to GENERAL
UPDATE sales_orders SET project_id = NULL WHERE project_id = @general_project_id;
UPDATE purchase_orders SET project_id = NULL WHERE project_id = @general_project_id;
UPDATE collection_orders SET project_id = NULL WHERE project_id = @general_project_id;
UPDATE wastages SET project_id = NULL WHERE project_id = @general_project_id;

-- Delete GENERAL project
DELETE FROM projects WHERE id = @general_project_id;
*/
