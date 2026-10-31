-- R2：把存檔原文放在 R2，D1 只記 key
ALTER TABLE uploads ADD COLUMN storage TEXT NOT NULL DEFAULT 'r2';
ALTER TABLE uploads ADD COLUMN object_key TEXT;
