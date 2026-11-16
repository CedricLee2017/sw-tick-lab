/**
 * 從 SWEX FullLogger 的 full_log.txt（或已拆好的 swex_split/）整理出「公會」資料。
 *
 *   node scripts/extract-guild.mjs --log "C:\...\full_log.txt" --out guild.json
 *   node scripts/extract-guild.mjs --dir swex_split --out guild.json
 *
 * 只保留公會相關、而且含完整符文 / 神器的 API：
 *   - GetGuildTestDeckDetail             公會測試隊伍（隊友的魔靈 + 符文 + 神器）
 *   - GetGuildTestDeckList               測試隊伍清單（成員名稱、說明）
 *   - GetGuildSiegeDefenseDeckListAlly   據點戰隊友防守隊伍（有符文 + 神器）
 *   - GetGuildSiegeMatchupInfo           賽季對戰資訊（只用來補成員名稱）
 *
 * 產出的 guild.json 直接在網站的「公會」頁匯入即可（資料只留在自己的瀏覽器）。
 */
import fs from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";

const WANTED = new Set([
  "GetGuildTestDeckDetail",
  "GetGuildTestDeckList",
  "GetGuildSiegeDefenseDeckListAlly",
  "GetGuildSiegeMatchupInfo",
]);

const args = process.argv.slice(2);
const argOf = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
};
const LOG = argOf("log");
const DIR = argOf("dir");
const OUT = argOf("out") ?? path.resolve(process.cwd(), "guild.json");

/** 只留下網站需要的欄位，避免整份對戰資訊（數百 KB）塞進輸出 */
function trim(command, response) {
  if (!response || typeof response !== "object") return response;
  if (command === "GetGuildTestDeckDetail") {
    return { deck_info: response.deck_info, deck_unit_info: response.deck_unit_info };
  }
  if (command === "GetGuildTestDeckList") {
    return { deck_list: response.deck_list };
  }
  if (command === "GetGuildSiegeDefenseDeckListAlly") {
    return { defense_deck_list: response.defense_deck_list };
  }
  if (command === "GetGuildSiegeMatchupInfo") {
    return {
      guild_list: response.guild_list,
      wizard_info_list: response.wizard_info_list,
      member_info_list: response.member_info_list,
    };
  }
  return response;
}

/** 解析 FullLogger：API Command / Request: / Response: 三行一組 */
async function readLog(file) {
  const blocks = [];
  const rl = readline.createInterface({ input: createReadStream(file, "utf8"), crlfDelay: Infinity });
  let command = null;
  let state = null;
  let seen = 0;
  for await (const rawLine of rl) {
    const line = rawLine.replace(/\r$/, "");
    if (line.startsWith("API Command: ")) {
      command = line.slice("API Command: ".length).split(" - ", 1)[0].trim();
      state = "cmd";
      continue;
    }
    if (line.startsWith("Request:")) {
      state = "req";
      continue;
    }
    if (line.startsWith("Response:")) {
      state = "resp";
      continue;
    }
    if (state === "resp" && line.trim()) {
      state = "done";
      if (command && WANTED.has(command)) {
        try {
          blocks.push({ command, response: trim(command, JSON.parse(line)) });
        } catch {
          /* 單一 block 壞掉就略過 */
        }
      }
      seen++;
      if (seen % 500 === 0) process.stdout.write(`\r  已掃描 ${seen} 個 block…`);
    }
  }
  process.stdout.write("\n");
  return blocks;
}

async function readDir(dir) {
  const blocks = [];
  for (const command of WANTED) {
    const folder = path.join(dir, command);
    if (!existsSync(folder)) continue;
    const files = (await fs.readdir(folder)).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      try {
        const payload = JSON.parse(await fs.readFile(path.join(folder, file), "utf8"));
        if (payload?.response) blocks.push({ command, response: trim(command, payload.response) });
      } catch {
        /* 略過壞檔 */
      }
    }
  }
  return blocks;
}

if (!LOG && !DIR) {
  console.error("請指定 --log <full_log.txt> 或 --dir <swex_split>");
  process.exit(1);
}

console.log(LOG ? `讀取 FullLogger：${LOG}` : `讀取拆分資料夾：${DIR}`);
const blocks = LOG ? await readLog(LOG) : await readDir(DIR);
const counts = {};
for (const b of blocks) counts[b.command] = (counts[b.command] ?? 0) + 1;
console.log("擷取到的 block：", counts);

const out = {
  format: "swtick-guild",
  version: 1,
  generatedAt: new Date().toISOString(),
  source: LOG ? path.basename(LOG) : DIR,
  blocks,
};
await fs.writeFile(OUT, JSON.stringify(out));
const bytes = (await fs.stat(OUT)).size;
console.log(`完成：${blocks.length} 個 block → ${OUT}（${(bytes / 1024).toFixed(0)} KB）`);
console.log("把這個檔案拖進網站的「公會」頁面即可（資料只存在瀏覽器）。");
