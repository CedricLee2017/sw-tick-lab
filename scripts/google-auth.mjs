/**
 * 一次性取得 Google Drive 上傳用的 refresh token（業主授權）。
 *
 * 使用前先在 .dev.vars 設定：
 *   GOOGLE_CLIENT_ID="....apps.googleusercontent.com"
 *   GOOGLE_OAUTH_CLIENT_SECRET="..."
 * 並在 Google OAuth 用戶端加入重新導向 URI：http://localhost:53682/
 *
 * 執行：npm run google:auth
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";

const DEV = path.join(process.cwd(), ".dev.vars");
const PORT = 53682;
const REDIRECT = `http://localhost:${PORT}/`;

function readVars() {
  const out = {};
  if (!fs.existsSync(DEV)) return out;
  for (const line of fs.readFileSync(DEV, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1");
  }
  return out;
}

function writeVar(key, value) {
  const current = fs.existsSync(DEV) ? fs.readFileSync(DEV, "utf8") : "";
  const line = `${key}="${value}"`;
  const re = new RegExp(`^${key}\\s*=.*$`, "m");
  const next = re.test(current)
    ? current.replace(re, line)
    : `${current.trimEnd()}\n${line}\n`;
  fs.writeFileSync(DEV, next);
}

const vars = readVars();
const clientId = vars.GOOGLE_CLIENT_ID;
const clientSecret = vars.GOOGLE_OAUTH_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error("\n缺少設定。請先在 .dev.vars 加上：");
  console.error('  GOOGLE_CLIENT_ID="....apps.googleusercontent.com"');
  console.error('  GOOGLE_OAUTH_CLIENT_SECRET="..."');
  console.error("\nClient Secret 在 Google Cloud → API 和服務 → 憑證 → 你的 OAuth 用戶端裡。\n");
  process.exit(1);
}

const authUrl =
  "https://accounts.google.com/o/oauth2/v2/auth?" +
  new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/drive.file",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
  }).toString();

console.log("\n請用「服務擁有者」的 Google 帳號（存檔要存放的帳號）開啟下面網址並同意授權：\n");
console.log(authUrl);
console.log("\n授權後瀏覽器會回到 http://localhost:53682/ ，這個視窗會自動完成。\n");

try {
  const cmd =
    process.platform === "win32"
      ? `start "" "${authUrl}"`
      : process.platform === "darwin"
        ? `open "${authUrl}"`
        : `xdg-open "${authUrl}"`;
  exec(cmd);
} catch {
  /* 不強制開瀏覽器，使用者可以手動貼上網址 */
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", REDIRECT);
  if (url.pathname !== "/") {
    res.writeHead(404).end("not found");
    return;
  }

  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  if (error) {
    res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    res.end(`授權失敗：${error}`);
    server.close();
    return;
  }
  if (!code) {
    res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    res.end("缺少授權碼，請重新執行 npm run google:auth");
    return;
  }

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: REDIRECT,
        grant_type: "authorization_code",
      }),
    });
    const data = await tokenRes.json();
    if (!tokenRes.ok || !data.refresh_token) {
      throw new Error(data.error_description || data.error || "沒有取得 refresh_token");
    }
    writeVar("GOOGLE_REFRESH_TOKEN", data.refresh_token);

    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end("完成！refresh token 已寫入 .dev.vars，可以關閉這個頁面，回到終端機執行 npm run google:secret。");
    console.log("\n✅ 已取得 refresh token 並寫入 .dev.vars");
    console.log("下一步：npm run google:secret（把 secret 與 token 上傳到 Cloudflare Pages）\n");
    server.close();
  } catch (err) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end(`換取 token 失敗：${err instanceof Error ? err.message : String(err)}`);
    server.close();
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`等待授權回呼：${REDIRECT}`);
});
