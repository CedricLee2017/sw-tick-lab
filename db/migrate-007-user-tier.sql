-- 會員功能方案：basic = 基本分析；full = 完整功能
-- 新註冊會員預設 basic；既有會員保留完整功能，避免升級後突然被鎖。
-- npx wrangler d1 execute sw-tick-lab-db --remote --file=db/migrate-007-user-tier.sql

ALTER TABLE users ADD COLUMN tier TEXT NOT NULL DEFAULT 'basic';

UPDATE users SET tier = 'full';
