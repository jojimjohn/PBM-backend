-- ============================================================================
-- Migration: Add Disposable Material Columns to materials table
-- Purpose: Support disposable materials with auto-wastage functionality
-- Run this on PRODUCTION database to sync with local schema
-- ============================================================================

-- Add is_disposable column (after isActive)
ALTER TABLE materials
ADD COLUMN `is_disposable` tinyint(1) DEFAULT 0
COMMENT 'Materials that are fully consumed/wasted after use (e.g., packaging, containers)'
AFTER `isActive`;

-- Add default_waste_type column (after is_disposable)
-- Using ENUM to match wastages table wasteType values
ALTER TABLE materials
ADD COLUMN `default_waste_type` ENUM(
  'waste',
  'spillage',
  'contamination',
  'expiry',
  'damage',
  'theft',
  'evaporation',
  'sorting_loss',
  'quality_rejection',
  'transport_loss',
  'handling_damage',
  'other'
) DEFAULT 'waste'
COMMENT 'Default wastage type when material is disposed'
AFTER `is_disposable`;

-- Add auto_wastage_percentage column (after default_waste_type)
ALTER TABLE materials
ADD COLUMN `auto_wastage_percentage` decimal(5,2) DEFAULT 100.00
COMMENT 'Percentage of material to auto-record as wastage (100 = full quantity)'
AFTER `default_waste_type`;

-- Verify the changes
SELECT
    COLUMN_NAME,
    COLUMN_TYPE,
    IS_NULLABLE,
    COLUMN_DEFAULT,
    COLUMN_COMMENT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
AND TABLE_NAME = 'materials'
AND COLUMN_NAME IN ('is_disposable', 'default_waste_type', 'auto_wastage_percentage');

SELECT 'Migration complete: Disposable material columns added' AS status;
