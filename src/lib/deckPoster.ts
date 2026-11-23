/**
 * 預設隊一鍵生圖：把一整組預設隊畫成單張 PNG，方便直接傳給隊友。
 *
 * 魔靈圖示走本站的 /api/icon 代理（與頁面同源），否則把跨網域圖片畫進 canvas
 * 會污染畫布，導致 toBlob() 失敗。
 */

export interface PosterUnit {
  /** 顯示名稱（玩家自訂名稱優先） */
  name: string;
  /** 圖鑑圖示檔名，例如 unit_icon_0001_0_1.png */
  icon: string;
  /** 屬性 id：1 水 / 2 火 / 3 風 / 4 光 / 5 暗 */
  el: number;
  spd: number;
  tick: number;
  /** 隊內速度順序（1 = 最快），0 表示沒有資料 */
  rank: number;
  leader: boolean;
}

export interface PosterTeam {
  /** 第幾隊（預設隊序號） */
  seq: number;
  units: PosterUnit[];
}

export interface PosterInput {
  title: string;
  subtitle?: string;
  teams: PosterTeam[];
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

const W = 1440;
const PAD = 32;
const GAP = 14;
const SCALE = 1.5;
const HEADER_H = 104;
const CELL_PAD = 14;
const CELL_LABEL_H = 30;
const FOOTER_H = 44;
/** 一隊一列，隊員之間的間距 */
const UNIT_GAP = 18;
/** 圖示上限；4 隻一隊時整列只放這一隊，圖示可放到最大 */
const ICON_MAX = 256;

const CELL_W = W - PAD * 2;

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

/** 一次抓一批圖示，最多同時 8 張，避免一次打太多請求。 */
async function loadIcons(teams: PosterTeam[]) {
  const names = [...new Set(teams.flatMap((t) => t.units.map((u) => u.icon)).filter(Boolean))];
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

function drawIcon(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | null,
  unit: PosterUnit,
  x: number,
  y: number,
  size: number,
) {
  const ICON = size;
  const badgeR = Math.round(ICON * 0.12);
  roundRect(ctx, x, y, ICON, ICON, Math.round(ICON * 0.2));
  ctx.save();
  ctx.clip();
  if (img) {
    ctx.drawImage(img, x, y, ICON, ICON);
  } else {
    ctx.fillStyle = "rgba(255,255,255,.05)";
    ctx.fillRect(x, y, ICON, ICON);
    ctx.fillStyle = EL_COLOR[unit.el] ?? "#8b9cc0";
    ctx.font = font(800, Math.round(ICON * 0.44));
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText((unit.name || "?").slice(0, 1), x + ICON / 2, y + ICON / 2 + 1);
    ctx.textBaseline = "alphabetic";
  }
  ctx.restore();

  roundRect(ctx, x + 1, y + 1, ICON - 2, ICON - 2, Math.round(ICON * 0.19));
  ctx.strokeStyle = EL_COLOR[unit.el] ?? "#8b9cc0";
  ctx.lineWidth = Math.max(2, ICON * 0.03);
  ctx.stroke();

  if (unit.rank > 0) {
    const r = badgeR;
    const cx = x + r + 1;
    const cy = y + r + 1;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(6,10,20,.9)";
    ctx.fill();
    ctx.strokeStyle = unit.rank === 1 ? "#f2c65c" : "rgba(255,255,255,.28)";
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.fillStyle = unit.rank === 1 ? "#f2c65c" : "#cfdcff";
    ctx.font = font(700, Math.round(r * 0.95));
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`#${unit.rank}`, cx, cy + 0.5);
    ctx.textBaseline = "alphabetic";
  }
}

/** 把一組預設隊畫成一張 PNG，回傳 Blob。 */
export async function renderDeckPoster(input: PosterInput): Promise<Blob> {
  const teams = input.teams;
  const maxUnits = Math.max(1, ...teams.map((t) => Math.min(5, t.units.length)));
  /** 一隊一列：依最多隊員數把整列寬度均分，4 隻一隊時圖示可以放到最大 */
  const slotW = (CELL_W - CELL_PAD * 2) / maxUnits;
  const icon = Math.max(72, Math.min(ICON_MAX, Math.floor(slotW - UNIT_GAP)));
  const nameSize = Math.max(14, Math.min(20, Math.round(icon * 0.075)));
  const metaSize = Math.max(11, Math.min(15, Math.round(icon * 0.055)));
  const unitH = icon + nameSize + metaSize + 12;
  const cellH = CELL_PAD + CELL_LABEL_H + unitH + 12;
  const rows = Math.max(1, teams.length);
  const H = HEADER_H + rows * cellH + (rows - 1) * GAP + FOOTER_H + 14;

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
  roundRect(ctx, PAD, 30, 4, 30, 2);
  ctx.fill();

  ctx.fillStyle = "#f4f8ff";
  ctx.font = font(800, 28);
  ctx.textAlign = "left";
  ctx.fillText(`${input.title}`, PAD + 16, 56);

  if (input.subtitle) {
    ctx.fillStyle = "#8b9cc0";
    ctx.font = font(500, 12.5);
    ctx.fillText(fitText(ctx, input.subtitle, W - PAD * 2 - 260), PAD + 16, 78);
  }

  ctx.textAlign = "right";
  ctx.fillStyle = "#f2c65c";
  ctx.font = font(800, 22);
  ctx.fillText(`${teams.length} 隊`, W - PAD, 52);
  ctx.fillStyle = "#6f80a6";
  ctx.font = font(500, 11);
  ctx.fillText("圈內 # = 隊內速度順序 · SPD 含隊長技 · T = Tick", W - PAD, 72);

  ctx.strokeStyle = "rgba(255,255,255,.07)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, HEADER_H - 12);
  ctx.lineTo(W - PAD, HEADER_H - 12);
  ctx.stroke();

  // ── 隊伍卡片 ─────────────────────────────────────────
  const icons = await loadIcons(teams);

  if (teams.length === 0) {
    ctx.fillStyle = "#6f80a6";
    ctx.font = font(500, 14);
    ctx.textAlign = "center";
    ctx.fillText("這個分組沒有預設隊", W / 2, HEADER_H + 60);
  }

  teams.forEach((team, i) => {
    const x = PAD;
    const y = HEADER_H + i * (cellH + GAP);

    roundRect(ctx, x, y, CELL_W, cellH, 16);
    ctx.fillStyle = "#121b30";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.07)";
    ctx.lineWidth = 1;
    ctx.stroke();

    // 隊號 + 隊長
    ctx.textAlign = "left";
    ctx.fillStyle = "#e8eeff";
    ctx.font = font(700, 16);
    ctx.fillText(`第 ${team.seq} 隊`, x + CELL_PAD, y + CELL_PAD + 16);

    const leader = team.units.find((u) => u.leader);
    const rightMax = CELL_W - CELL_PAD * 2 - 120;
    ctx.textAlign = "right";
    if (leader) {
      ctx.fillStyle = "#f2c65c";
      ctx.font = font(600, 13);
      ctx.fillText(fitText(ctx, `隊長 ${leader.name}`, rightMax), x + CELL_W - CELL_PAD, y + CELL_PAD + 16);
    } else {
      ctx.fillStyle = "#6f80a6";
      ctx.font = font(500, 13);
      ctx.fillText(`${team.units.length} 人`, x + CELL_W - CELL_PAD, y + CELL_PAD + 16);
    }

    // 隊員：一列排開，數量少於最多隊員數時置中
    const shown = team.units.slice(0, maxUnits);
    const startX = x + CELL_PAD + ((maxUnits - shown.length) * slotW) / 2;
    shown.forEach((unit, ui) => {
      const ix = startX + ui * slotW + (slotW - icon) / 2;
      const iy = y + CELL_PAD + CELL_LABEL_H;

      drawIcon(ctx, icons.get(unit.icon) ?? null, unit, ix, iy, icon);

      const cx = ix + icon / 2;
      const textMax = slotW - 10;
      ctx.textAlign = "center";
      ctx.fillStyle = unit.leader ? "#f2c65c" : "#dfe8ff";
      ctx.font = font(600, nameSize);
      ctx.fillText(fitText(ctx, unit.name, textMax), cx, iy + icon + nameSize + 3);

      ctx.font = font(600, metaSize);
      const spd = unit.spd > 0 ? `SPD ${unit.spd}` : "SPD —";
      const tick = unit.tick > 0 ? `T${unit.tick}` : "T—";
      const meta = `${spd} · ${tick}`;
      ctx.fillStyle = "#9fb0d4";
      ctx.fillText(fitText(ctx, meta, textMax), cx, iy + icon + nameSize + metaSize + 5);
    });
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
