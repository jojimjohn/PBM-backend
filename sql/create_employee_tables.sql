-- ============================================================================
-- Employee Master Module - Database Tables
-- Run on BOTH: al_ramrami_db AND pride_muscat_db
-- ============================================================================

-- 1. Employees table
CREATE TABLE IF NOT EXISTS employees (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_code VARCHAR(20) NOT NULL UNIQUE,
  full_name VARCHAR(150) NOT NULL,
  phone VARCHAR(20),
  email VARCHAR(100),
  nationality VARCHAR(80),
  date_of_birth DATE,
  gender ENUM('male','female'),
  employment_start_date DATE,
  designation VARCHAR(100),
  department VARCHAR(100),
  status ENUM('active','inactive','terminated') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_status (status),
  INDEX idx_department (department)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. Employee addresses (max 2 per employee: oman_residential + home_country)
CREATE TABLE IF NOT EXISTS employee_addresses (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_id INT UNSIGNED NOT NULL,
  address_type ENUM('oman_residential','home_country') NOT NULL,
  address_line1 VARCHAR(255),
  address_line2 VARCHAR(255),
  city VARCHAR(100),
  state VARCHAR(100),
  country VARCHAR(100),
  postal_code VARCHAR(20),
  UNIQUE KEY uq_employee_address_type (employee_id, address_type),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3. Employee documents (passport, resident_id, other) with expiry tracking
CREATE TABLE IF NOT EXISTS employee_documents (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_id INT UNSIGNED NOT NULL,
  document_type ENUM('passport','resident_id','other') NOT NULL,
  document_number VARCHAR(100),
  issue_date DATE,
  expiry_date DATE,
  file_path VARCHAR(500),
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_employee (employee_id),
  INDEX idx_expiry (expiry_date),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4. Employee location assignments (FK to existing supplier_locations)
CREATE TABLE IF NOT EXISTS employee_location_assignments (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_id INT UNSIGNED NOT NULL,
  location_id INT UNSIGNED NOT NULL,
  role ENUM('in_charge','staff','driver','helper') NOT NULL,
  assigned_from DATE NOT NULL,
  assigned_to DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_employee (employee_id),
  INDEX idx_location (location_id),
  INDEX idx_assigned_to (assigned_to),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (location_id) REFERENCES supplier_locations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 5. Add optional driver_employee_id to collection_orders (nullable, backward compatible)
ALTER TABLE collection_orders
  ADD COLUMN IF NOT EXISTS driver_employee_id INT UNSIGNED NULL,
  ADD INDEX idx_driver_employee (driver_employee_id);

-- Add FK separately (ALTER TABLE ADD FOREIGN KEY with IF NOT EXISTS not supported in all MySQL versions)
-- This will error harmlessly if already exists
ALTER TABLE collection_orders
  ADD CONSTRAINT fk_collection_driver_employee
  FOREIGN KEY (driver_employee_id) REFERENCES employees(id) ON DELETE SET NULL;
