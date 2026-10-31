-- 從「Google 登入」升級成「Email + 密碼」：
-- 保留既有會員資料（含 admin 角色），新增密碼欄位並移除 google_sub 的 NOT NULL。
-- 執行：npx wrangler d1 execute sw-tick-lab-db --remote --file=db/migrate-002-email-password.sql

PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS users_new (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  email               TEXT    NOT NULL UNIQUE,
  name                TEXT,
  picture             TEXT,
  role                TEXT    NOT NULL DEFAULT 'user',
  status              TEXT    NOT NULL DEFAULT 'active',
  password_hash       TEXT,
  password_salt       TEXT,
  password_updated_at INTEGER,
  google_sub          TEXT UNIQUE,
  created_at          INTEGER NOT NULL,
  last_login_at       INTEGER,
  consent_at          INTEGER
);

INSERT INTO users_new (id, email, name, picture, role, status, google_sub, created_at, last_login_at, consent_at)
SELECT id, email, name, picture, role, status, google_sub, created_at, last_login_at, consent_at
FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS login_attempts (
  key      TEXT PRIMARY KEY,
  count    INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);

INSERT INTO settings (k, v) VALUES ('force_login', '1')
ON CONFLICT(k) DO UPDATE SET v = excluded.v;
