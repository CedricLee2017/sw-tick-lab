-- 據點戰對戰紀錄與 SWEX 外掛上傳金鑰
-- npx wrangler d1 execute sw-tick-lab-db --remote --file=db/migrate-006-siege.sql

CREATE TABLE IF NOT EXISTS siege_tokens (
  user_id      INTEGER PRIMARY KEY,
  token_hash   TEXT    NOT NULL,
  token_prefix TEXT    NOT NULL,
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS siege_battles (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 同一場戰鬥的穩定識別碼；不同會員重複上傳時只留一筆
  battle_uid       TEXT    NOT NULL UNIQUE,
  user_id          INTEGER NOT NULL,
  battle_type      TEXT    NOT NULL DEFAULT 'Siege',
  wizard_id        INTEGER,
  wizard_name      TEXT,
  guild_id         INTEGER,
  guild_name       TEXT,
  opp_guild_id     INTEGER,
  opp_guild_name   TEXT,
  opp_wizard_id    INTEGER,
  opp_wizard_name  TEXT,
  battle_key       TEXT,
  battle_time      INTEGER NOT NULL,
  win              INTEGER NOT NULL,
  battle_rank      INTEGER,
  defense_units    TEXT    NOT NULL,
  counter_units    TEXT    NOT NULL,
  created_at       INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_siege_battles_user_time
  ON siege_battles(user_id, battle_time DESC);
CREATE INDEX IF NOT EXISTS idx_siege_battles_guild_time
  ON siege_battles(guild_id, battle_time DESC);
CREATE INDEX IF NOT EXISTS idx_siege_battles_guild_name_time
  ON siege_battles(guild_name, battle_time DESC);
