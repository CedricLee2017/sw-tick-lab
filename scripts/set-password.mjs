/**
 * 設定 / 重設會員密碼（不經網站，直接寫 D1）。
 *
 *   npm run set-password -- you@example.com            # 互動輸入（隱藏輸入）
 *   npm run set-password -- you@example.com --generate  # 隨機產生並印出一次
 *   npm run set-password -- you@example.com --local     # 本機 D1（開發用）
 *
 * 密碼推導與前端完全相同：PBKDF2-SHA256 21 萬次 → verifier，
 * 再用隨機 salt 做 SHA-256 存進 password_hash。
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { execSync } from "node:child_process";

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const positional = args.filter((a) => !a.startsWith("--"));
const email = (positional[0] ?? "leechungkit2011@gmail.com").trim().toLowerCase();
const local = flags.has("--local");
const generate = flags.has("--generate");

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("Email 格式不正確");
  process.exit(1);
}

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const original = rl._writeToOutput.bind(rl);
    rl._writeToOutput = (str) => {
      if (str.includes(question)) original(question);
      else original("*");
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

let password;
if (generate) {
  password = crypto.randomBytes(12).toString("base64url");
} else {
  password = await askHidden("輸入新密碼（至少 8 碼）：");
  const again = await askHidden("再輸入一次：");
  if (password !== again) {
    console.error("兩次輸入不一致");
    process.exit(1);
  }
}
if (password.length < 8) {
  console.error("密碼至少需要 8 個字元");
  process.exit(1);
}

const verifier = crypto.pbkdf2Sync(password, `swtick-lab:v1:${email}`, 210_000, 32, "sha256").toString("base64");
const salt = crypto.randomBytes(16).toString("base64");
const hash = crypto.createHash("sha256").update(`${salt}:${verifier}`).digest("base64");
const name = email.split("@")[0];

const sql = `INSERT INTO users (email, name, role, status, password_hash, password_salt, password_updated_at, created_at, last_login_at)
VALUES ('${email}', '${name.replace(/'/g, "''")}', 'admin', 'active', '${hash}', '${salt}', strftime('%s','now'), strftime('%s','now'), NULL)
ON CONFLICT(email) DO UPDATE SET
  password_hash = excluded.password_hash,
  password_salt = excluded.password_salt,
  password_updated_at = excluded.password_updated_at`;

const target = local ? "--local" : "--remote";
console.log(`寫入 ${local ? "本機" : "線上"} D1：${email} …`);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "swtick-"));
const sqlFile = path.join(tmpDir, "set-password.sql");
fs.writeFileSync(sqlFile, sql);
try {
  execSync(`npx wrangler d1 execute sw-tick-lab-db ${target} --file="${sqlFile}" --yes`, { stdio: "inherit" });
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

if (generate) {
  console.log(`\n✅ 臨時密碼：${password}`);
  console.log("請登入後到「設定 → 帳號」改成自己的密碼。\n");
} else {
  console.log("\n✅ 密碼已更新\n");
}
