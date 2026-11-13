-- 上傳紀錄記住玩家所屬公會（guild.guild_info.name），後台可顯示與補齊舊資料
-- 舊環境升級：npx wrangler d1 execute sw-tick-lab-db --remote --file=db/migrate-005-upload-guild.sql

ALTER TABLE uploads ADD COLUMN guild TEXT;
