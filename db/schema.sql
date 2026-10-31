-- SW Tick Lab 會員 / 上傳紀錄（Email + 密碼）
-- 全新環境：npx wrangler d1 execute sw-tick-lab-db --remote --file=db/schema.sql
-- 舊環境升級：npx wrangler d1 execute sw-tick-lab-db --remote --file=db/migrate-002-email-password.sql

CREATE TABLE IF NOT EXISTS users (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  email               TEXT    NOT NULL UNIQUE,
  name                TEXT,
  picture             TEXT,
  role                TEXT    NOT NULL DEFAULT 'user',
  status              TEXT    NOT NULL DEFAULT 'active',
  -- 密碼：瀏覽器端 PBKDF2 產生的 verifier，再用隨機 salt 做 SHA-256
  password_hash       TEXT,
  password_salt       TEXT,
  password_updated_at INTEGER,
  -- 保留欄位：舊的 Google 登入帳號（之後可移除）
  google_sub          TEXT UNIQUE,
  created_at          INTEGER NOT NULL,
  last_login_at       INTEGER,
  consent_at          INTEGER
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS login_attempts (
  key      TEXT PRIMARY KEY,
  count    INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS uploads (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL,
  file_id       TEXT,
  object_key    TEXT,
  storage       TEXT    NOT NULL DEFAULT 'r2',
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
