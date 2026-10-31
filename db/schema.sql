-- SW Tick Lab 會員 / 上傳紀錄
-- 套用：npx wrangler d1 execute sw-tick-lab-db --remote --file=db/schema.sql

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  google_sub    TEXT    NOT NULL UNIQUE,
  email         TEXT    NOT NULL UNIQUE,
  name          TEXT,
  picture       TEXT,
  role          TEXT    NOT NULL DEFAULT 'user',
  status        TEXT    NOT NULL DEFAULT 'active',
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER,
  consent_at    INTEGER
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS uploads (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL,
  file_id       TEXT,
  file_name     TEXT    NOT NULL,
  size          INTEGER NOT NULL DEFAULT 0,
  sha256        TEXT,
  wizard        TEXT,
  monster_count INTEGER,
  rune_count    INTEGER,
  created_at    INTEGER NOT NULL,
  deleted_at    INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_uploads_user ON uploads(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_uploads_created ON uploads(created_at DESC);

-- 執行期開關（例如 force_login），改一行 SQL 就能生效，不必重新部署
CREATE TABLE IF NOT EXISTS settings (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);

INSERT INTO settings (k, v) VALUES ('force_login', '0')
ON CONFLICT(k) DO NOTHING;
