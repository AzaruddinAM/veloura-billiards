CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff',
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE auth_tokens (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE pool_tables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'pool',
  rate_per_hour REAL NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_id INTEGER NOT NULL REFERENCES pool_tables(id),
  member_id INTEGER REFERENCES members(id),
  customer_name TEXT,
  players INTEGER NOT NULL DEFAULT 2,
  start_ts INTEGER NOT NULL,
  end_ts INTEGER,
  billed_minutes INTEGER,
  rate_per_hour REAL NOT NULL,
  amount REAL,
  discount REAL NOT NULL DEFAULT 0,
  total REAL,
  payment_method TEXT,
  period TEXT,
  notes TEXT,
  started_by INTEGER,
  stopped_by INTEGER
);
CREATE INDEX idx_sessions_end ON sessions(end_ts);
CREATE INDEX idx_sessions_table ON sessions(table_id);
CREATE TABLE payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL REFERENCES members(id),
  amount REAL NOT NULL,
  method TEXT NOT NULL DEFAULT 'cash',
  ts INTEGER NOT NULL,
  period TEXT NOT NULL,
  note TEXT,
  created_by INTEGER
);
CREATE TABLE expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  period TEXT NOT NULL,
  category TEXT NOT NULL,
  amount REAL NOT NULL,
  note TEXT,
  created_by INTEGER
);
CREATE TABLE month_closings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  period TEXT NOT NULL UNIQUE,
  revenue REAL NOT NULL,
  expenses REAL NOT NULL,
  net REAL NOT NULL,
  sessions_count INTEGER NOT NULL,
  minutes INTEGER NOT NULL,
  snapshot TEXT NOT NULL,
  closed_at INTEGER NOT NULL,
  closed_by INTEGER
);
CREATE TABLE settings (
  k TEXT PRIMARY KEY,
  v TEXT
)
