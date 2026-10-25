/**
 * 配符引擎 / Tick 公式自動測試
 * 用法：npm test
 *
 * 會先用 rolldown 把 src/lib 的純邏輯打包到 .tmp/engine.mjs，再用 Node 執行。
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");
const BUNDLE = path.join(ROOT, ".tmp/engine.mjs");

await fs.mkdir(path.dirname(BUNDLE), { recursive: true });
const build = spawnSync(
  process.execPath,
  [
    path.join(ROOT, "node_modules/rolldown/bin/cli.mjs"),
    "scripts/engine-entry.ts",
    "--platform", "node",
    "--format", "esm",
    "--file", BUNDLE,
    "--logLevel", "warn",
  ],
  { cwd: ROOT, stdio: "inherit" },
);
if (build.status !== 0) throw new Error("rolldown bundle 失敗");

const engine = await import(`${pathToFileURL(BUNDLE).href}?t=${Date.now()}`);
const {
  tickOf, speedForTick, tickInfo, speedNeededForTick, simulateOrder, optimize, maxSpeedBound,
  baseStats, bonusFromBuildings, parseAccountJSON, MONSTERS,
} = engine;

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

/* ── 1. Tick 公式 ─────────────────────────────── */
console.log("\n[1] Tick 公式");
check("Tick 5 = 286 速", () => {
  assert.equal(speedForTick(5), 286);
  assert.equal(tickOf(286), 5);
  assert.equal(tickOf(285), 6);
});
check("Tick 6 / 7 門檻", () => {
  assert.equal(speedForTick(6), 239);
  assert.equal(speedForTick(7), 205);
  assert.equal(tickOf(239), 6);
  assert.equal(tickOf(205), 7);
});
check("RTA 模式（0.015%）", () => {
  assert.equal(speedForTick(5, true), 1334);
  assert.equal(tickOf(1334, true), 5);
});
check("tickInfo 顯示下一階還差多少", () => {
  const info = tickInfo(280);
  assert.equal(info.tick, 6);
  assert.equal(info.need, 286);
  assert.equal(info.next, 6);
});

/* ── 2. 速度反推 ─────────────────────────────── */
console.log("\n[2] 速度反推（建築 + 隊長技）");
const bonus43 = {
  towerSpd: 15, towerAtk: 0, towerHp: 0, towerDef: 0,
  guildAtk: 0, guildHp: 0, guildDef: 0, guildCd: 0,
  leadSpd: 28, buffSpd: 0, useGuild: false, useElementTower: false, grind: true,
};
check("基礎 100 + 圖騰 15% + 隊長 28% → 符文需 143 速", () => {
  const need = speedNeededForTick(5, 100, bonus43);
  assert.equal(need.target, 286);
  assert.equal(need.runeSpeed, 143);
});
check("基礎速 114（Perna）→ 符文需 122 速", () => {
  const need = speedNeededForTick(5, 114, bonus43);
  assert.equal(need.target, 286);
  assert.equal(need.runeSpeed, 122);
});
check("加入 Buff 30% 後需求下降", () => {
  const need = speedNeededForTick(5, 100, { ...bonus43, buffSpd: 30 });
  assert.equal(need.runeSpeed, 113);
});

/* ── 3. 示範帳號解析 ─────────────────────────── */
console.log("\n[3] 示範帳號");
const demoPath = path.join(ROOT, "public/demo-account.json");
const demoText = await fs.readFile(demoPath, "utf8");
const parsed = parseAccountJSON(demoText, "demo-account.json");
check("解析成功", () => {
  assert.equal(parsed.error, undefined);
  assert.ok(parsed.account);
  assert.equal(parsed.account.units.length, 44);
  assert.equal(parsed.account.runes.length, 144);
  assert.ok(parsed.account.buildings.length >= 9);
});
const account = parsed.account;
check("自動偵測速度圖騰 15%", () => {
  const b = bonusFromBuildings(account.buildings, { leadSpd: 28 });
  assert.equal(b.towerSpd, 15);
  assert.equal(b.leadSpd, 28);
  assert.equal(b.useGuild, true);
});
check("符文都有 6 個位置", () => {
  const slots = new Set(account.runes.map((r) => r.slot));
  assert.deepEqual([...slots].sort(), [1, 2, 3, 4, 5, 6]);
});
check("容忍多層包裝 / 物件索引 / 字串屬性", () => {
  const wrapped = JSON.stringify({
    save: {
      data: {
        unit_list: {
          1: { unit_id: 11, unit_master_id: 17012, stars: 6, level: 40, runes: { 0: { rune_id: 101 } } },
        },
        runes: {
          101: {
            id: 101, set: "Swift", slot: 1, grade: 6, level: 15,
            main: { type: "SPD", value: 42 },
            prefix: { type: "HP%", value: 8 },
            subs: [{ type: "CRate", value: 10 }, { t: 11, v: 8, g: 2 }],
          },
        },
        buildings: { 7: { building_master_id: 7, building_level: 15 } },
      },
    },
  });
  const p = parseAccountJSON(wrapped, "wrapped.json");
  assert.equal(p.error, undefined, p.error);
  assert.equal(p.account.units.length, 1);
  assert.equal(p.account.units[0].stars, 6);
  assert.deepEqual(p.account.units[0].runes, [101]);
  assert.equal(p.account.runes.length, 1);
  assert.equal(p.account.runes[0].set, 3);
  assert.equal(p.account.runes[0].main.t, 7);
  assert.equal(p.account.runes[0].main.v, 42);
  assert.equal(p.account.runes[0].prefix.t, 2);
  assert.equal(p.account.runes[0].subs[0].t, 8);
  assert.equal(p.account.runes[0].subs[1].g, 2);
  assert.deepEqual(p.account.buildings, [{ id: 7, level: 15 }]);
});

/* ── 4. 一鍵配符 ─────────────────────────────── */
console.log("\n[4] 一鍵配符（迅速 ×4 + 意志 ×2，目標 Tick 5）");
const velajuel = MONSTERS.find((m) => m.id === 17012);
assert.ok(velajuel, "找不到 Velajuel");
const base = baseStats(velajuel, 6, 40);
const bonus = bonusFromBuildings(account.buildings, { leadSpd: 28 });
const req = {
  base,
  runes: account.runes,
  required: [{ set: 3, count: 4 }, { set: 13, count: 2 }],
  min: { spd: 286 },
  max: {},
  objective: "spd",
  bonus,
  limit: 5,
  pool: 18,
  allowEquipped: true,
  targetUnit: 0,
  rta: false,
  maxNodes: 3_500_000,
};

const t0 = performance.now();
const result = optimize(req);
const elapsed = Math.round(performance.now() - t0);

check("找到至少一組配裝", () => {
  assert.ok(result.builds.length > 0, "沒有任何結果");
});
for (const [i, b] of result.builds.entries()) {
  check(`第 ${i + 1} 組：速度 ${b.stats.spd} / Tick ${b.stats.tick}、套裝符合`, () => {
    assert.ok(b.stats.spd >= 286, `速度只有 ${b.stats.spd}`);
    assert.ok(b.stats.tick <= 5, `Tick 為 ${b.stats.tick}`);
    assert.equal(b.runes.filter(Boolean).length, 6);
    assert.ok((b.sets[3] ?? 0) >= 4, "迅速不足 4 件");
    assert.ok((b.sets[13] ?? 0) >= 2, "意志不足 2 件");
    const slots = b.runes.filter(Boolean).map((r) => r.slot).sort();
    assert.deepEqual(slots, [1, 2, 3, 4, 5, 6], "位置重複或缺漏");
  });
}
console.log(`  · 候選符文 ${result.candidates} 顆 · 節點 ${result.nodes.toLocaleString()} · ${elapsed} ms${result.truncated ? "（已達節點上限）" : ""}`);
console.log("  · 前三名：");
for (const [i, b] of result.builds.slice(0, 3).entries()) {
  console.log(`      ${i + 1}. ${b.stats.spd} 速 / Tick ${b.stats.tick} / HP ${b.stats.hp} / EHP ${b.stats.ehp} / 效率 ${b.eff.toFixed(1)}%`);
}

check("速度上界不低於實際最佳解", () => {
  const bound = maxSpeedBound(req);
  assert.ok(bound.speed >= result.builds[0].stats.spd, `上界 ${bound.speed} < 實際 ${result.builds[0].stats.spd}`);
  assert.ok(bound.speed < speedForTick(3), `上界 ${bound.speed} 不合理（超過 Tick 3）`);
});
check("允許破套：只強制主套 4 件", () => {
  const relaxed = optimize({
    ...req,
    required: [{ set: 11, count: 4 }, { set: 13, count: 2 }],
    relaxSub: true,
    min: { spd: 286 },
    objective: "spd",
    limit: 5,
  });
  assert.ok(relaxed.builds.length > 0, "破套模式沒有任何結果");
  for (const b of relaxed.builds) {
    assert.ok((b.sets[11] ?? 0) >= 4, "暴走不足 4 件");
    assert.ok(b.stats.spd >= 286);
  }
});
check("主屬性篩選（#4 HP%、#6 攻擊%）", () => {
  const filtered = optimize({
    ...req,
    required: [],
    min: { spd: 180 },
    mainFilters: { 4: 2, 6: 4 },
    limit: 3,
  });
  assert.ok(filtered.builds.length > 0, "主屬性篩選後沒有任何結果");
  for (const b of filtered.builds) {
    assert.equal(b.runes[3].main.t, 2, "#4 不是 HP% 主屬性");
    assert.equal(b.runes[5].main.t, 4, "#6 不是攻擊%主屬性");
    assert.ok(b.stats.spd >= 180);
  }
});

/* ── 5. 出手順序 ─────────────────────────────── */
console.log("\n[5] 出手順序模擬");
check("286 速比 285 速先出手", () => {
  const order = simulateOrder([
    { id: "fast", name: "286", spd: 286 },
    { id: "slow", name: "285", spd: 285 },
  ], 4);
  assert.equal(order[0].id, "fast");
  assert.equal(order[0].tick, 5);
  assert.equal(order.find((o) => o.id === "slow").tick, 6);
});

console.log(`\n✅ 全部 ${passed} 項測試通過（配符耗時 ${elapsed} ms）\n`);
