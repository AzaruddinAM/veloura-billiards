CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  username VARCHAR(60) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'staff',
  active TINYINT NOT NULL DEFAULT 1,
  created_at INT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE auth_tokens (
  token VARCHAR(64) PRIMARY KEY,
  user_id INT NOT NULL,
  expires_at INT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE pool_tables (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  type VARCHAR(20) NOT NULL DEFAULT 'pool',
  rate_per_hour DECIMAL(10,2) NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  active TINYINT NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE members (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  phone VARCHAR(40),
  email VARCHAR(120),
  notes TEXT,
  active TINYINT NOT NULL DEFAULT 1,
  created_at INT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  table_id INT NOT NULL,
  member_id INT NULL,
  customer_name VARCHAR(120),
  players INT NOT NULL DEFAULT 2,
  start_ts INT NOT NULL,
  end_ts INT NULL,
  billed_minutes INT NULL,
  rate_per_hour DECIMAL(10,2) NOT NULL,
  amount DECIMAL(10,2) NULL,
  discount DECIMAL(10,2) NOT NULL DEFAULT 0,
  total DECIMAL(10,2) NULL,
  payment_method VARCHAR(20),
  period CHAR(7),
  notes TEXT,
  started_by INT,
  stopped_by INT,
  INDEX idx_sessions_end (end_ts),
  INDEX idx_sessions_table (table_id),
  FOREIGN KEY (table_id) REFERENCES pool_tables(id),
  FOREIGN KEY (member_id) REFERENCES members(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  member_id INT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  method VARCHAR(20) NOT NULL DEFAULT 'cash',
  ts INT NOT NULL,
  period CHAR(7) NOT NULL,
  note TEXT,
  created_by INT,
  FOREIGN KEY (member_id) REFERENCES members(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE expenses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ts INT NOT NULL,
  period CHAR(7) NOT NULL,
  category VARCHAR(60) NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  note TEXT,
  created_by INT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE month_closings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  period CHAR(7) NOT NULL UNIQUE,
  revenue DECIMAL(12,2) NOT NULL,
  expenses DECIMAL(12,2) NOT NULL,
  net DECIMAL(12,2) NOT NULL,
  sessions_count INT NOT NULL,
  minutes INT NOT NULL,
  snapshot LONGTEXT NOT NULL,
  closed_at INT NOT NULL,
  closed_by INT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE settings (
  k VARCHAR(60) PRIMARY KEY,
  v TEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
