-- 上傳紀錄記住遊戲玩家 ID（wizard_id），同一個遊戲帳號只保留最新一份雲端存檔
-- 套用：npx wrangler d1 execute sw-tick-lab-db --remote --file=db/migrate-004-upload-wizard-id.sql

ALTER TABLE uploads ADD COLUMN wizard_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_uploads_user_wizard
  ON uploads(user_id, wizard_id, created_at DESC);
