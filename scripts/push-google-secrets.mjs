/**
 * 把 .dev.vars 裡的 Google Drive 憑證上傳成 Cloudflare Pages 的 Secret。
 * 值只會從檔案經 stdin 傳給 wrangler，不會出現在指令或 log 裡。
 *
 * 執行：npm run google:secret
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const DEV = path.join(process.cwd(), ".dev.vars");
const PROJECT = "sw-tick-lab";
const KEYS = ["GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"];

if (!fs.existsSync(DEV)) {
  console.error("找不到 .dev.vars，請先複製 .dev.vars.example 並填入憑證");
  process.exit(1);
}

const vars = {};
for (const line of fs.readFileSync(DEV, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) vars[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1");
}

let missing = false;
for (const key of KEYS) {
  if (!vars[key]) {
    console.error(`缺少 ${key}`);
    missing = true;
  }
}
if (missing) process.exit(1);

for (const key of KEYS) {
  console.log(`上傳 ${key} …`);
  execSync(`npx wrangler pages secret put ${key} --project-name ${PROJECT}`, {
    input: vars[key],
    stdio: ["pipe", "inherit", "inherit"],
  });
}

console.log("\n✅ 完成。線上 Worker 會在下一次請求時使用新的憑證。");
