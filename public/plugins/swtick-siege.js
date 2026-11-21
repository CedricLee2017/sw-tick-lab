/*
 * SW Tick Lab — 據點戰紀錄上傳外掛（SWEX）
 *
 * 安裝：
 *   1. 把這個檔案放到 SWEX 的 plugins 資料夾：plugins/swtick-siege.js
 *   2. 重新開啟 SWEX，在 Settings → Plugins 啟用 SwTickSiegeLogger
 *   3. 到 SW Tick Lab「公會 → 據點戰」產生上傳金鑰，貼到外掛設定
 *
 * 這個外掛只會上傳「自己的據點戰進攻紀錄」（3 隻防守 + 3 隻進攻），
 * 不會上傳帳號存檔、符文庫或聊天內容。
 *
 * 封包流程參考 Cerusa/swgt-swex-plugin（MIT License，Copyright (c) 2020 Cerusa），
 * 但這裡是獨立實作，只把資料送到 SW Tick Lab，不使用 SWGT 的 API、金鑰或服務。
 * 完整授權文字見同目錄的 swtick-siege.LICENSE.txt。
 */
const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");

const pluginName = "SwTickSiegeLogger";
const version = "1.0.0";

module.exports = {
  pluginName,
  version,
  pluginDescription:
    "把據點戰進攻紀錄（雙方隊伍、勝負、公會）自動上傳到 SW Tick Lab，於公會 → 據點戰頁面查看。",
  defaultConfig: {
    enabled: true,
    siteURL: "https://sw-tick-lab.pages.dev",
    token: "",
    saveToFile: false,
  },
  defaultConfigDetails: {
    siteURL: { label: "SW Tick Lab 網站網址", type: "input" },
    token: { label: "SW Tick Lab 上傳金鑰（公會 → 據點戰頁面產生）", type: "input" },
    saveToFile: { label: "同時把 3MDC JSON 存到 SWEX 資料夾（備份用）" },
  },

  init(proxy, config) {
    this.ctx = {
      guildNames: new Map(),
      guildRatings: new Map(),
      wizardGuild: new Map(),
      wizardNames: new Map(),
      pending: [],
      seen: new Set(),
      warned: false,
    };

    const commands = [
      "GetGuildSiegeMatchupInfo",
      "GetGuildSiegeMatchupInfoForFinished",
      "GetGuildSiegeRankingInfo",
      "BattleGuildSiegeStart_v2",
      "BattleGuildSiegeStartSuccess",
      "BattleGuildSiegeResult",
      "getGuildSiegeMatchBattleLogSummary_v2",
      "SetGuildSiegeBattleReplayData",
    ];

    for (const command of commands) {
      proxy.on(command, (req, resp) => {
        try {
          this.process(command, proxy, config, req || {}, resp || {});
        } catch (err) {
          this.log(proxy, "debug", `處理 ${command} 失敗：${err && err.message ? err.message : err}`);
        }
      });
    }
    this.log(proxy, "success", `已啟用 SwTickSiegeLogger ${version}`);
  },

  cfg(config) {
    return config?.Config?.Plugins?.[pluginName] || {};
  },

  log(proxy, type, message) {
    try {
      proxy.log({ type, source: "plugin", name: pluginName, message });
    } catch {
      /* ignore */
    }
  },

  num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  },

  text(value) {
    return value == null ? "" : String(value).trim();
  },

  asArray(value) {
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object") return Object.values(value);
    return [];
  },

  process(command, proxy, config, req, resp) {
    const actual = resp.command || req.command || command;
    if (actual === "GetGuildSiegeMatchupInfo" || actual === "GetGuildSiegeMatchupInfoForFinished") return this.ingestContext(resp);
    if (actual === "GetGuildSiegeRankingInfo") return this.ingestRanking(resp);
    if (actual === "BattleGuildSiegeStart_v2") return this.startBattle(proxy, config, resp);
    if (actual === "BattleGuildSiegeResult") return this.finishBattle(proxy, config, req, resp);
    if (actual === "getGuildSiegeMatchBattleLogSummary_v2") return this.ingestSummary(proxy, config, resp);
    if (actual === "SetGuildSiegeBattleReplayData") return this.ingestReplay(proxy, config, req, resp);
  },

  ingestContext(resp) {
    const ctx = this.ctx;
    for (const guild of this.asArray(resp.guild_list)) {
      const id = this.num(guild.guild_id);
      if (!id) continue;
      if (guild.guild_name) ctx.guildNames.set(id, String(guild.guild_name));
      const rating = this.num(guild.rating_id);
      if (rating) ctx.guildRatings.set(id, rating);
    }
    for (const wizard of this.asArray(resp.wizard_info_list)) {
      const id = this.num(wizard.wizard_id);
      const guildId = this.num(wizard.guild_id);
      if (!id) continue;
      if (wizard.wizard_name) ctx.wizardNames.set(id, String(wizard.wizard_name));
      if (guildId) ctx.wizardGuild.set(id, guildId);
      if (guildId && wizard.guild_name) ctx.guildNames.set(guildId, String(wizard.guild_name));
    }
    const match = resp.match_info;
    if (match) {
      const gid = this.num(match.guild_id);
      const rating = this.num(match.rating_id);
      if (gid && rating) ctx.guildRatings.set(gid, rating);
    }
  },

  ingestRanking(resp) {
    const info = resp.guildsiege_ranking_info;
    if (!info) return;
    const id = this.num(info.guild_id);
    const rating = this.num(info.rating_id);
    if (id && rating) this.ctx.guildRatings.set(id, rating);
  },

  startBattle(proxy, config, resp) {
    const ctx = this.ctx;
    // 順便更新開戰時附帶的公會排名 / 名稱
    for (const guild of this.asArray(resp.guildsiege_world_ranking)) {
      const id = this.num(guild.guild_id);
      if (!id) continue;
      if (guild.guild_name) ctx.guildNames.set(id, String(guild.guild_name));
      const rating = this.num(guild.rating_id);
      if (rating) ctx.guildRatings.set(id, rating);
    }

    const wizardId = this.num(resp.wizard_info?.wizard_id);
    const wizardName = this.text(resp.wizard_info?.wizard_name);
    if (wizardId && wizardName) ctx.wizardNames.set(wizardId, wizardName);

    const counter = this.asArray(resp.guildsiege_my_unit_list)
      .map((unit) => this.num(unit.unit_master_id))
      .filter((id) => id > 0);
    const oppRows = this.asArray(resp.guildsiege_opp_unit_list);
    const defense = oppRows
      .map((unit) => this.num(unit?.unit_info?.unit_master_id))
      .filter((id) => id > 0);
    if (counter.length !== 3 || defense.length !== 3) return;

    const oppWizardId = this.num(oppRows[0]?.unit_info?.wizard_id);
    const guildId = ctx.wizardGuild.get(wizardId) || 0;
    const oppGuildId = ctx.wizardGuild.get(oppWizardId) || 0;
    const battleKey = this.text(resp.battle_key);
    const battle = {
      battleType: "Siege",
      wizard_id: wizardId,
      wizard_name: wizardName,
      guild_id: guildId,
      guild_name: ctx.guildNames.get(guildId) || "",
      opp_guild_id: oppGuildId,
      opp_guild_name: ctx.guildNames.get(oppGuildId) || "",
      opp_wizard_id: oppWizardId,
      opp_wizard_name: ctx.wizardNames.get(oppWizardId) || "",
      battleKey,
      battleStartTime: this.num(resp.tvalue),
      battleDateTime: 0,
      win_lose: 0,
      battleRank: ctx.guildRatings.get(guildId) || 0,
      defense: { units: defense },
      counter: { units: counter },
      resolved: false,
    };
    ctx.pending.push(battle);
    this.log(proxy, "debug", `據點戰開始：${wizardName || wizardId}（${counter.join("/")} vs ${defense.join("/")}）`);
  },

  finishBattle(proxy, config, req, resp) {
    const ctx = this.ctx;
    const key = this.text(req.battle_key || resp.battle_key);
    const wizardId = this.num(req.wizard_id || resp.wizard_id);
    if (!key) return;
    const battle = [...ctx.pending]
      .reverse()
      .find((item) => !item.resolved && item.battleKey === key && (!wizardId || item.wizard_id === wizardId));
    if (!battle) return;
    battle.win_lose = this.num(req.win_lose ?? resp.win_lose) === 1 ? 1 : 0;
    battle.battleDateTime = this.num(resp.tvalue) || battle.battleStartTime || Math.floor(Date.now() / 1000);
    battle.resolved = true;
    this.send(proxy, config, battle);
  },

  ingestSummary(proxy, config, resp) {
    this.ingestContext(resp);
    const ctx = this.ctx;
    for (const row of this.asArray(resp.wizard_battle_log_list)) {
      if (this.num(row.log_type) !== 1) continue; // 1 = 自己進攻
      const wizardId = this.num(row.wizard_id);
      const time = this.num(row.log_timestamp);
      if (!wizardId || !time) continue;
      const candidates = ctx.pending
        .filter((item) => !item.resolved && item.wizard_id === wizardId && (!item.battleStartTime || item.battleStartTime <= time + 5))
        .sort((a, b) => b.battleStartTime - a.battleStartTime);
      const battle = candidates[0];
      if (!battle) continue;
      battle.win_lose = this.num(row.win_lose) === 1 ? 1 : 0;
      battle.battleDateTime = time;
      battle.opp_wizard_id = this.num(row.opp_wizard_id) || battle.opp_wizard_id;
      battle.opp_guild_id = this.num(row.opp_guild_id) || battle.opp_guild_id;
      battle.opp_wizard_name = ctx.wizardNames.get(battle.opp_wizard_id) || battle.opp_wizard_name;
      battle.opp_guild_name = ctx.guildNames.get(battle.opp_guild_id) || battle.opp_guild_name;
      battle.resolved = true;
      this.send(proxy, config, battle);
    }
  },

  ingestReplay(proxy, config, req, resp) {
    const info = req.battle_info;
    if (!info) return;
    if (this.num(info.guild_id) !== this.num(info.opp_guild_id)) return;
    const counter = this.asArray(info.unit_list?.[0]).map((id) => this.num(id)).filter((id) => id > 0);
    const defense = this.asArray(info.opp_unit_list?.[0]).map((id) => this.num(id)).filter((id) => id > 0);
    if (counter.length !== 3 || defense.length !== 3) return;
    const ctx = this.ctx;
    const wizardId = this.num(info.wizard_id);
    const oppWizardId = this.num(info.opp_wizard_id);
    const guildId = this.num(info.guild_id);
    this.send(proxy, config, {
      battleType: "SiegeTest",
      wizard_id: wizardId,
      wizard_name: this.text(info.wizard_name) || ctx.wizardNames.get(wizardId) || "",
      guild_id: guildId,
      guild_name: this.text(info.guild_name) || ctx.guildNames.get(guildId) || "",
      opp_guild_id: this.num(info.opp_guild_id),
      opp_guild_name: this.text(info.opp_guild_name) || ctx.guildNames.get(this.num(info.opp_guild_id)) || "",
      opp_wizard_id: oppWizardId,
      opp_wizard_name: this.text(info.opp_wizard_name) || ctx.wizardNames.get(oppWizardId) || "",
      battleKey: this.text(req.battle_key),
      battleStartTime: this.num(resp.tvalue) || Math.floor(Date.now() / 1000),
      battleDateTime: this.num(resp.tvalue) || Math.floor(Date.now() / 1000),
      win_lose: this.num(info.result_list?.[0]) === 1 ? 1 : 0,
      battleRank: ctx.guildRatings.get(guildId) || 0,
      defense: { units: defense },
      counter: { units: counter },
    });
  },

  send(proxy, config, battle) {
    if (!battle) return;
    const key = [
      battle.battleType,
      battle.wizard_id,
      battle.battleKey || battle.battleDateTime,
      battle.counter?.units?.join("-"),
      battle.defense?.units?.join("-"),
    ].join("|");
    if (this.ctx.seen.has(key)) return;
    this.ctx.seen.add(key);

    if (this.cfg(config).saveToFile) this.writeFile(proxy, config, battle);

    const opts = this.cfg(config);
    const site = this.text(opts.siteURL).replace(/\/+$/, "");
    const token = this.text(opts.token);
    if (!site || !token) {
      if (!this.ctx.warned) {
        this.ctx.warned = true;
        this.log(proxy, "warning", "尚未設定 SW Tick Lab 網址或上傳金鑰，據點戰紀錄只會留在本機。");
      }
      return;
    }

    const payload = {
      battles: [
        {
          command: "3MDCBattleLog",
          ...battle,
          win_lose: battle.win_lose ? 1 : 0,
        },
      ],
    };
    this.post(`${site}/api/siege/battles`, token, payload, (err, status, body) => {
      if (err) {
        this.log(proxy, "error", `上傳失敗：${err.message || err}`);
        return;
      }
      if (status >= 200 && status < 300) {
        this.log(proxy, "success", `已上傳據點戰紀錄（${this.text(battle.wizard_name) || battle.wizard_id}）`);
      } else {
        this.log(proxy, "error", `上傳失敗：HTTP ${status} ${body || ""}`.trim());
      }
    });
  },

  post(url, token, body, callback) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (err) {
      callback(err);
      return;
    }
    const lib = parsed.protocol === "http:" ? http : https;
    const data = Buffer.from(JSON.stringify(body));
    const req = lib.request(
      {
        method: "POST",
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || undefined,
        path: parsed.pathname + parsed.search,
        headers: {
          "content-type": "application/json",
          "content-length": data.length,
          authorization: `Bearer ${token}`,
        },
      },
      (res) => {
        let text = "";
        res.on("data", (chunk) => {
          if (text.length < 2000) text += chunk.toString();
        });
        res.on("end", () => callback(null, res.statusCode || 0, text));
      },
    );
    req.on("error", callback);
    req.setTimeout(15000, () => req.destroy(new Error("連線逾時")));
    req.write(data);
    req.end();
  },

  writeFile(proxy, config, battle) {
    try {
      const filesPath = config?.Config?.App?.filesPath || "";
      if (!filesPath) return;
      const filename = `3MDC-${battle.battleType}-${battle.battleDateTime || Date.now()}-${Date.now()}.json`;
      fs.writeFileSync(path.join(filesPath, filename), JSON.stringify(battle, null, 2), "utf8");
      this.log(proxy, "success", `已儲存 ${filename}`);
    } catch (err) {
      this.log(proxy, "error", `儲存檔案失敗：${err.message || err}`);
    }
  },
};
