-- Cipher Music Server Database Schema
-- Run: mysql -u root -p cipher_music < schema.sql

CREATE DATABASE IF NOT EXISTS cipher_music CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE cipher_music;

-- Admins table
CREATE TABLE IF NOT EXISTS admins (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(64) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP NULL,
    last_login_ip VARCHAR(45) NULL
) ENGINE=InnoDB;

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(64) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    status ENUM('active','banned','deleted') NOT NULL DEFAULT 'active',
    ban_reason TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    last_login TIMESTAMP NULL,
    last_login_ip VARCHAR(45) NULL
) ENGINE=InnoDB;

-- Payments table
CREATE TABLE IF NOT EXISTS payments (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id INT UNSIGNED NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    currency VARCHAR(8) NOT NULL DEFAULT 'USD',
    description TEXT NULL,
    status ENUM('pending','completed','revoked','refunded','deleted') NOT NULL DEFAULT 'pending',
    payment_method VARCHAR(64) NULL,
    transaction_id VARCHAR(255) NULL UNIQUE,
    revoke_reason TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Access logs table (tracks IPv6 addresses)
CREATE TABLE IF NOT EXISTS access_logs (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id INT UNSIGNED NULL,
    ip_address VARCHAR(45) NOT NULL,
    ip_version TINYINT UNSIGNED NOT NULL DEFAULT 4,
    user_agent TEXT NULL,
    request_uri VARCHAR(512) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Maintenance mode setting
CREATE TABLE IF NOT EXISTS settings (
    name VARCHAR(64) PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Default settings
INSERT INTO settings (name, value) VALUES
    ('maintenance_mode', '0'),
    ('maintenance_message', 'The site is currently undergoing scheduled maintenance. Please check back soon.'),
    ('site_name', 'Cipher Music'),
    ('app_version', '1.0.0')
ON DUPLICATE KEY UPDATE value = VALUES(value);

-- Default admin account — password hash is set by the setup script.
-- Run scripts/setup.sh which will prompt you for a password and update this hash.
-- If installing manually, generate a hash with:
--   php -r "echo password_hash('YOUR_PASSWORD', PASSWORD_BCRYPT, ['cost'=>12]);"
-- and then: UPDATE admins SET password_hash='...' WHERE username='admin';
INSERT INTO admins (username, password_hash, email) VALUES
    ('admin', '$2y$12$PLACEHOLDER_RUN_SETUP_SCRIPT_NOW_TO_SET_REAL_HASH_XXXXX', 'admin@example.com')
ON DUPLICATE KEY UPDATE username = username;

-- Indexes for performance
CREATE INDEX idx_users_status ON users(status);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_payments_user_id ON payments(user_id);
CREATE INDEX idx_payments_status ON payments(status);
CREATE INDEX idx_access_logs_ip ON access_logs(ip_address);
CREATE INDEX idx_access_logs_user_id ON access_logs(user_id);
CREATE INDEX idx_access_logs_created ON access_logs(created_at);
