CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(64) PRIMARY KEY,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email VARCHAR(254) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  initials VARCHAR(8) NOT NULL DEFAULT '',
  timezone VARCHAR(64) NOT NULL DEFAULT 'Europe/Paris',
  locale VARCHAR(16) NOT NULL DEFAULT 'fr-FR',
  role ENUM('user','admin') NOT NULL DEFAULT 'user',
  status ENUM('active','disabled','deleted') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  last_login_at TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY users_email_unique (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  user_agent VARCHAR(512) NULL,
  ip_hash CHAR(64) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY sessions_token_hash_unique (token_hash),
  KEY sessions_user_id_idx (user_id),
  KEY sessions_expires_at_idx (expires_at),
  CONSTRAINT sessions_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS invite_codes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code_hash CHAR(64) NOT NULL,
  created_by BIGINT UNSIGNED NULL,
  max_uses INT UNSIGNED NOT NULL DEFAULT 1,
  uses INT UNSIGNED NOT NULL DEFAULT 0,
  expires_at DATETIME NULL,
  disabled_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY invite_codes_code_hash_unique (code_hash),
  KEY invite_codes_created_by_idx (created_by),
  CONSTRAINT invite_codes_creator_fk FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
