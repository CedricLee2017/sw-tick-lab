/**
 * 預設隊整隊資料圖：把一隊所有魔靈的面板數值、符文與神器畫成一張 PNG。
 *
 * 與「一鍵生圖」的隊伍總覽不同，這張圖是給隊友看實際配裝用的：
 * 每隻魔靈都有完整面板、六顆符文（主屬／副屬／分數／效率）與兩件神器。
 * 魔靈圖示同樣走本站 /api/icon 代理，避免跨網域圖片污染畫布。
 */
import { ELEMENTS, SET_BY_ID, STAT_TYPES } from "./constants";
import {
  ARTIFACT_RANKS,
  artifactKindText,
  artifactMainText,
  artifactScore,
  artifactSubText,
  artifactTypeText,
} from "./artifacts";
import { effectiveSetCounts, runeScore, setSummary, type BaseStats } from "./stats";
import type { Artifact, Rune, Stats } from "./types";

export interface TeamSheetUnit {
  /** 顯示名稱（玩家自訂名稱優先） */
  name: string;
  /** 圖鑑圖示檔名 */
  icon: string;
  /** 屬性 id：1 水 / 2 火 / 3 風 / 4 光 / 5 暗 */
  el: number;
  stars: number;
  level: number;
  leader: boolean;
  /** 隊內速度順序（1 = 最快），0 表示沒有資料 */
  rank: number;
  /** 戰鬥速度（含隊長技 / 圖騰 / Buff） */
  spd: number;
  tick: number;
  /** 星級 / 等級換算後的基礎值 */
  base: BaseStats;
  /** 面板數值（與遊戲內魔靈資訊一致） */
  stats: Stats;
  runes: Rune[];
  artifacts: Artifact[];
}

export interface TeamSheetInput {
  title: string;
  subtitle?: string;
  units: TeamSheetUnit[];
  /** 例如「隊長技：火鳳凰 速度 +24%（競技場）」 */
  leaderSkill?: string;
  battlePower?: number;
  note?: string;
}

const EL_COLOR: Record<number, string> = {
  1: "#46a6ff",
  2: "#ff7a52",
  3: "#4ade80",
  4: "#ffd75e",
  5: "#b07cff",
};

const FONT_STACK = "'Noto Sans TC','Microsoft JhengHei','PingFang TC','Segoe UI',system-ui,sans-serif";
const font = (weight: number, size: number) => `${weight} ${size}px ${FONT_STACK}`;
const num = (v: number) => Math.round(v * 10) / 10;
const fmt = (v: number) => (Number.isFinite(v) ? v.toLocaleString("en-US") : "—");

const W = 1440;
const PAD = 28;
const GAP = 14;
const SCALE = 2;
const HEADER_H = 124;
const FOOTER_H = 42;
const SEC_PAD = 16;
const HEAD_H = 84;
const STAT_H = 60;
const SEC_GAP = 12;
const RUNE_H = 186;
const ART_H = 160;
const CELL_W = W - PAD * 2;
const INNER_W = CELL_W - SEC_PAD * 2;
const SEC_H = SEC_PAD * 2 + HEAD_H + 10 + STAT_H + SEC_GAP + RUNE_H + SEC_GAP + ART_H;
const RUNE_GAP = 10;
const RUNE_W = (INNER_W - RUNE_GAP * 5) / 6;
const ART_GAP = 10;
const ART_W = (INNER_W - ART_GAP) / 2;

const iconCache = new Map<string, Promise<HTMLImageElement | null>>();

function iconUrl(icon: string) {
  return `${import.meta.env.BASE_URL}api/icon/${encodeURIComponent(icon)}`;
}

/** 載入圖示；失敗就回 null，畫面上改畫屬性色底＋名稱首字。 */
function loadIcon(icon: string): Promise<HTMLImageElement | null> {
  if (!icon) return Promise.resolve(null);
  const cached = iconCache.get(icon);
  if (cached) return cached;
  const pending = new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img.naturalWidth > 0 ? img : null);
    img.onerror = () => resolve(null);
    window.setTimeout(() => resolve(null), 8000);
    img.src = iconUrl(icon);
  });
  iconCache.set(icon, pending);
  return pending;
}

async function loadIcons(units: TeamSheetUnit[]) {
  const names = [...new Set(units.map((u) => u.icon).filter(Boolean))];
  const out = new Map<string, HTMLImageElement | null>();
  let cursor = 0;
  const workers = Array.from({ length: Math.min(8, names.length) }, async () => {
    while (cursor < names.length) {
      const name = names[cursor++];
      out.set(name, await loadIcon(name));
    }
  });
  await Promise.all(workers);
  return out;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.arcTo(x + w, y, x + w, y + rad, rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.arcTo(x + w, y + h, x + w - rad, y + h, rad);
  ctx.lineTo(x + rad, y + h);
  ctx.arcTo(x, y + h, x, y + h - rad, rad);
  ctx.lineTo(x, y + rad);
  ctx.arcTo(x, y, x + rad, y, rad);
  ctx.closePath();
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) cut = cut.slice(0, -1);
  return `${cut}…`;
}

function statSuffix(t: number): string {
  const meta = STAT_TYPES[t];
  if (!meta) return "";
  return meta.pct || ["cr", "cd", "res", "acc"].includes(meta.key) ? "%" : "";
}

function statLabel(t: number): string {
  return (STAT_TYPES[t]?.label ?? `屬性 #${t}`).replace(/%$/, "");
}

function statText(t: number, v: number): string {
  return `${statLabel(t)} +${fmt(v)}${statSuffix(t)}`;
}

function drawIcon(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | null,
  unit: TeamSheetUnit,
  x: number,
  y: number,
  size: number,
) {
  roundRect(ctx, x, y, size, size, Math.round(size * 0.2));
  ctx.save();
  ctx.clip();
  if (img) {
    ctx.drawImage(img, x, y, size, size);
  } else {
    ctx.fillStyle = "rgba(255,255,255,.05)";
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = EL_COLOR[unit.el] ?? "#8b9cc0";
    ctx.font = font(800, Math.round(size * 0.44));
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText((unit.name || "?").slice(0, 1), x + size / 2, y + size / 2 + 1);
    ctx.textBaseline = "alphabetic";
  }
  ctx.restore();

  roundRect(ctx, x + 1, y + 1, size - 2, size - 2, Math.round(size * 0.19));
  ctx.strokeStyle = EL_COLOR[unit.el] ?? "#8b9cc0";
  ctx.lineWidth = Math.max(2, size * 0.03);
  ctx.stroke();
}

/** 由右側往左畫小標籤，回傳標籤寬度。 */
function drawChip(
  ctx: CanvasRenderingContext2D,
  text: string,
  right: number,
  y: number,
  color = "#cfdcff",
  bg = "rgba(255,255,255,.06)",
  border = "rgba(255,255,255,.14)",
) {
  ctx.font = font(700, 11.5);
  const w = Math.ceil(ctx.measureText(text).width) + 20;
  const h = 24;
  roundRect(ctx, right - w, y, w, h, 7);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.strokeStyle = border;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, right - w / 2, y + h / 2 + 0.5);
  ctx.textBaseline = "alphabetic";
  return w;
}

function drawRuneCard(
  ctx: CanvasRenderingContext2D,
  rune: Rune | null,
  slot: number,
  x: number,
  y: number,
) {
  roundRect(ctx, x, y, RUNE_W, RUNE_H, 10);
  ctx.fillStyle = "#0d1628";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,.06)";
  ctx.lineWidth = 1;
  ctx.stroke();

  if (!rune) {
    ctx.textAlign = "center";
    ctx.fillStyle = "#3f4f70";
    ctx.font = font(800, 30);
    ctx.fillText(String(slot), x + RUNE_W / 2, y + 62);
    ctx.fillStyle = "#6f80a6";
    ctx.font = font(500, 11);
    ctx.fillText("未裝備", x + RUNE_W / 2, y + 84);
    return;
  }

  const pad = 11;
  const set = SET_BY_ID[rune.set];

  ctx.beginPath();
  ctx.arc(x + pad + 3, y + 17, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = setColor(rune.set);
  ctx.fill();

  ctx.textAlign = "left";
  ctx.fillStyle = "#f4f8ff";
  ctx.font = font(700, 12.5);
  const setName = `${set?.name ?? `套裝${rune.set}`}${rune.ancient ? " · 遠古" : ""}`;
  ctx.fillText(fitText(ctx, setName, RUNE_W - pad * 2 - 62), x + pad + 12, y + 21);

  ctx.textAlign = "right";
  ctx.fillStyle = "#8b9cc0";
  ctx.font = font(500, 10.5);
  ctx.fillText(`${slot} 號 · +${rune.level}`, x + RUNE_W - pad, y + 21);

  ctx.textAlign = "left";
  ctx.fillStyle = "#f2c65c";
  ctx.font = font(800, 14);
  ctx.fillText(statText(rune.main.t, rune.main.v), x + pad, y + 44);

  let by = y + 62;
  if (rune.prefix?.t > 0) {
    ctx.textAlign = "left";
    ctx.fillStyle = "#8b9cc0";
    ctx.font = font(500, 10.5);
    ctx.fillText(fitText(ctx, `固有 ${statText(rune.prefix.t, rune.prefix.v)}`, RUNE_W - pad * 2), x + pad, by);
    by += 16;
  }

  for (const s of rune.subs) {
    const v = Math.round((s.v + s.g) * 10) / 10;
    ctx.textAlign = "left";
    ctx.fillStyle = "#9fb0d4";
    ctx.font = font(500, 11.5);
    ctx.fillText(statLabel(s.t), x + pad, by);

    ctx.textAlign = "right";
    ctx.fillStyle = "#e8eeff";
    ctx.font = font(700, 11.5);
    const grind = s.g > 0 ? ` (+${s.g})` : s.gem > 0 ? " ◆" : "";
    ctx.fillText(`${fmt(v)}${statSuffix(s.t)}${grind}`, x + RUNE_W - pad, by);
    by += 16.5;
  }

  ctx.textAlign = "left";
  ctx.fillStyle = "#8b9cc0";
  ctx.font = font(600, 10.5);
  ctx.fillText(`◆ ${runeScore(rune)}`, x + pad, y + RUNE_H - 12);

  ctx.textAlign = "right";
  ctx.fillStyle = "#f2c65c";
  ctx.fillText(`效率 ${Math.round(rune.eff)}%`, x + RUNE_W - pad, y + RUNE_H - 12);
}

function drawArtifactCard(
  ctx: CanvasRenderingContext2D,
  art: Artifact | null,
  x: number,
  y: number,
) {
  roundRect(ctx, x, y, ART_W, ART_H, 10);
  ctx.fillStyle = "#0d1628";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,.06)";
  ctx.lineWidth = 1;
  ctx.stroke();

  if (!art) {
    ctx.textAlign = "center";
    ctx.fillStyle = "#6f80a6";
    ctx.font = font(500, 12);
    ctx.fillText("未裝備神器", x + ART_W / 2, y + ART_H / 2 + 4);
    return;
  }

  const pad = 13;
  ctx.textAlign = "left";
  ctx.fillStyle = "#f4f8ff";
  ctx.font = font(700, 12.5);
  ctx.fillText(
    fitText(ctx, `${artifactTypeText(art.type)} · ${artifactKindText(art)}`, ART_W - pad * 2 - 60),
    x + pad,
    y + 22,
  );

  ctx.textAlign = "right";
  ctx.fillStyle = "#8b9cc0";
  ctx.font = font(500, 10.5);
  ctx.fillText(`+${art.level}`, x + ART_W - pad, y + 22);

  ctx.textAlign = "left";
  ctx.fillStyle = "#f2c65c";
  ctx.font = font(800, 14);
  ctx.fillText(artifactMainText(art), x + pad, y + 48);

  let by = y + 70;
  for (const s of art.subs) {
    ctx.textAlign = "left";
    ctx.fillStyle = "#c3d1ee";
    ctx.font = font(500, 11.5);
    ctx.fillText(fitText(ctx, artifactSubText(s), ART_W - pad * 2 - 70), x + pad, by);
    if (s.up && s.up > 0) {
      ctx.textAlign = "right";
      ctx.fillStyle = "#f2c65c";
      ctx.font = font(600, 10);
      ctx.fillText(`強化 ${s.up}`, x + ART_W - pad, by);
    }
    by += 17;
  }

  ctx.textAlign = "left";
  ctx.fillStyle = "#8b9cc0";
  ctx.font = font(500, 10.5);
  const quality = `${ARTIFACT_RANKS[art.rank] ?? `${art.rank}★`} · ${art.stars}★ 原生`;
  ctx.fillText(quality, x + pad, y + ART_H - 12);

  ctx.textAlign = "right";
  ctx.fillStyle = "#f2c65c";
  ctx.fillText(`分數 ${artifactScore(art)} / 200`, x + ART_W - pad, y + ART_H - 12);
}

const setColorCache: Record<number, string> = {
  1: "#f2c65c", 2: "#7fb3ff", 3: "#43d98a", 4: "#ff9f6b", 5: "#ff6b6b", 6: "#b07cff",
  7: "#8fd6a8", 8: "#ff7a52", 10: "#c084fc", 11: "#ef4444", 13: "#f97316", 14: "#38bdf8",
  15: "#fbbf24", 16: "#60a5fa", 17: "#f472b6", 18: "#94a3b8", 19: "#fb923c", 20: "#4ade80",
  21: "#facc15", 22: "#a78bfa", 23: "#34d399", 24: "#e879f9", 25: "#cbd5e1", 99: "#f8fafc",
};
function setColor(id: number): string {
  return setColorCache[id] ?? "#8b9cc0";
}

function unitSets(unit: TeamSheetUnit): string {
  const sets: Record<number, number> = {};
  for (const r of unit.runes) sets[r.set] = (sets[r.set] ?? 0) + 1;
  return setSummary(effectiveSetCounts(sets));
}

/** 把一隊的完整資料畫成一張 PNG，回傳 Blob。 */
export async function renderTeamSheet(input: TeamSheetInput): Promise<Blob> {
  const units = input.units;
  const rows = Math.max(1, units.length);
  const H = HEADER_H + rows * SEC_H + (rows - 1) * GAP + FOOTER_H + 14;

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(W * SCALE);
  canvas.height = Math.round(H * SCALE);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("無法建立畫布");
  ctx.scale(SCALE, SCALE);
  ctx.textBaseline = "alphabetic";

  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#0a1120");
  bg.addColorStop(1, "#0e1830");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // ── 頁首 ─────────────────────────────────────────────
  ctx.fillStyle = "#f2c65c";
  roundRect(ctx, PAD, 30, 4, 34, 2);
  ctx.fill();

  ctx.textAlign = "left";
  ctx.fillStyle = "#f4f8ff";
  ctx.font = font(800, 28);
  ctx.fillText(input.title, PAD + 16, 58);

  if (input.subtitle) {
    ctx.fillStyle = "#8b9cc0";
    ctx.font = font(500, 12.5);
    ctx.fillText(fitText(ctx, input.subtitle, W - PAD * 2 - 320), PAD + 16, 82);
  }

  if (input.leaderSkill) {
    ctx.fillStyle = "#f2c65c";
    ctx.font = font(600, 12.5);
    ctx.fillText(fitText(ctx, input.leaderSkill, W - PAD * 2 - 320), PAD + 16, 105);
  }

  ctx.textAlign = "right";
  ctx.fillStyle = "#f2c65c";
  ctx.font = font(800, 22);
  ctx.fillText(`${units.length} 隻`, W - PAD, 54);
  if (input.battlePower) {
    ctx.fillStyle = "#c3d1ee";
    ctx.font = font(600, 12);
    ctx.fillText(`戰力 ${fmt(input.battlePower)}`, W - PAD, 78);
  }
  ctx.fillStyle = "#6f80a6";
  ctx.font = font(500, 11);
  ctx.fillText("面板數值 · 六顆符文 · 兩件神器", W - PAD, 100);

  ctx.strokeStyle = "rgba(255,255,255,.07)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, HEADER_H - 10);
  ctx.lineTo(W - PAD, HEADER_H - 10);
  ctx.stroke();

  // ── 每隻魔靈一張大卡 ─────────────────────────────────
  const icons = await loadIcons(units);

  if (units.length === 0) {
    ctx.fillStyle = "#6f80a6";
    ctx.font = font(500, 14);
    ctx.textAlign = "center";
    ctx.fillText("這一隊沒有可產圖的魔靈資料", W / 2, HEADER_H + 60);
  }

  units.forEach((unit, i) => {
    const x = PAD;
    const y = HEADER_H + i * (SEC_H + GAP);
    const inX = x + SEC_PAD;
    const top = y + SEC_PAD;

    roundRect(ctx, x, y, CELL_W, SEC_H, 16);
    ctx.fillStyle = "#121b30";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.07)";
    ctx.lineWidth = 1;
    ctx.stroke();

    // 魔靈標頭
    const iconSize = 76;
    drawIcon(ctx, icons.get(unit.icon) ?? null, unit, inX, top, iconSize);
    const textX = inX + iconSize + 14;

    ctx.textAlign = "left";
    ctx.fillStyle = unit.leader ? "#f2c65c" : "#f4f8ff";
    ctx.font = font(800, 20);
    ctx.fillText(fitText(ctx, unit.name, 760), textX, top + 26);

    const el = ELEMENTS[unit.el as 1 | 2 | 3 | 4 | 5];
    ctx.font = font(600, 12);
    ctx.fillStyle = "#f2c65c";
    ctx.fillText("★".repeat(Math.max(0, Math.min(6, Math.round(unit.stars)))), textX, top + 48);
    const starW = ctx.measureText("★".repeat(Math.max(0, Math.min(6, Math.round(unit.stars))))).width;
    ctx.fillStyle = "#c3d1ee";
    ctx.font = font(600, 12);
    ctx.fillText(`Lv.${unit.level}`, textX + starW + 10, top + 48);
    if (el) {
      ctx.fillStyle = EL_COLOR[unit.el] ?? "#8b9cc0";
      ctx.fillText(el.name, textX + starW + 78, top + 48);
    }

    ctx.fillStyle = "#8b9cc0";
    ctx.font = font(500, 11.5);
    const sets = unitSets(unit);
    ctx.fillText(
      fitText(ctx, `${sets ? `套裝 ${sets}` : "未裝備符文"} · ${unit.runes.length} 顆符文 / ${unit.artifacts.length} 件神器`, 900),
      textX,
      top + 71,
    );

    // 右側速度資訊
    let chipRight = x + CELL_W - SEC_PAD;
    let chipW = drawChip(
      ctx,
      Number.isFinite(unit.tick) && unit.tick > 0 ? `T${unit.tick}` : "T—",
      chipRight,
      top + 8,
      "#f2c65c",
      "rgba(242,198,92,.10)",
      "rgba(242,198,92,.28)",
    );
    chipRight -= chipW + 6;
    chipW = drawChip(ctx, `SPD ${unit.spd > 0 ? fmt(unit.spd) : "—"}`, chipRight, top + 8);
    chipRight -= chipW + 6;
    if (unit.rank > 0) {
      chipW = drawChip(ctx, `第 ${unit.rank} 速`, chipRight, top + 8);
      chipRight -= chipW + 6;
    }
    if (unit.leader) {
      drawChip(ctx, "隊長", chipRight, top + 8, "#f2c65c", "rgba(242,198,92,.10)", "rgba(242,198,92,.28)");
    }

    // 面板數值：8 格
    const statY = y + SEC_PAD + HEAD_H + 10;
    const statGap = 8;
    const statW = (INNER_W - statGap * 7) / 8;
    const cells: { label: string; value: string; note?: string; noteColor?: string }[] = [
      {
        label: "體力",
        value: fmt(unit.stats.hp),
        note: unit.stats.hp > unit.base.hp ? `+${fmt(unit.stats.hp - unit.base.hp)}` : undefined,
        noteColor: "#4ade80",
      },
      {
        label: "攻擊力",
        value: fmt(unit.stats.atk),
        note: unit.stats.atk > unit.base.atk ? `+${fmt(unit.stats.atk - unit.base.atk)}` : undefined,
        noteColor: "#4ade80",
      },
      {
        label: "防禦力",
        value: fmt(unit.stats.def),
        note: unit.stats.def > unit.base.def ? `+${fmt(unit.stats.def - unit.base.def)}` : undefined,
        noteColor: "#4ade80",
      },
      {
        label: "攻擊速度",
        value: fmt(unit.stats.panelSpd),
        note: `戰鬥 ${fmt(unit.stats.spd)}`,
        noteColor: "#7fb3ff",
      },
      { label: "暴擊率", value: `${num(unit.stats.cr)}%` },
      { label: "暴擊傷害", value: `${num(unit.stats.cd)}%` },
      { label: "效果抵抗", value: `${num(unit.stats.res)}%` },
      { label: "效果命中", value: `${num(unit.stats.acc)}%` },
    ];

    cells.forEach((cell, ci) => {
      const sx = inX + ci * (statW + statGap);
      roundRect(ctx, sx, statY, statW, STAT_H, 9);
      ctx.fillStyle = "rgba(11,17,32,.58)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,.06)";
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.textAlign = "left";
      ctx.fillStyle = "#6f80a6";
      ctx.font = font(700, 10.5);
      ctx.fillText(cell.label, sx + 10, statY + 17);

      ctx.fillStyle = "#f4f8ff";
      ctx.font = font(700, 15);
      ctx.fillText(fitText(ctx, cell.value, statW - 20), sx + 10, statY + 39);

      if (cell.note) {
        ctx.fillStyle = cell.noteColor ?? "#8b9cc0";
        ctx.font = font(600, 10);
        ctx.fillText(fitText(ctx, cell.note, statW - 20), sx + 10, statY + 53);
      }
    });

    // 符文：六個位置排成一列
    const runeY = statY + STAT_H + SEC_GAP;
    for (let slot = 1; slot <= 6; slot++) {
      const rune = unit.runes.find((r) => r.slot === slot) ?? null;
      drawRuneCard(ctx, rune, slot, inX + (slot - 1) * (RUNE_W + RUNE_GAP), runeY);
    }

    // 神器：兩件並排
    const artY = runeY + RUNE_H + SEC_GAP;
    for (let ai = 0; ai < 2; ai++) {
      drawArtifactCard(ctx, unit.artifacts[ai] ?? null, inX + ai * (ART_W + ART_GAP), artY);
    }
  });

  // ── 頁尾 ─────────────────────────────────────────────
  ctx.textAlign = "left";
  ctx.fillStyle = "#5c6c90";
  ctx.font = font(500, 11);
  ctx.fillText(input.note ?? "SW Tick Lab", PAD, H - 18);

  ctx.textAlign = "right";
  ctx.fillText(new Date().toLocaleString("zh-TW"), W - PAD, H - 18);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("產圖失敗：瀏覽器無法輸出圖片");
  return blob;
}
