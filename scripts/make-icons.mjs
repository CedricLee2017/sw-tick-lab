/**
 * 產生 PWA 需要的 PNG 圖示（不依賴任何影像套件）。
 * 執行：node scripts/make-icons.mjs
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, "public/icons");

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const name = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function inRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function paint(buf, width, x, y, color) {
  const i = (y * width + x) * 4;
  buf[i] = color[0];
  buf[i + 1] = color[1];
  buf[i + 2] = color[2];
  buf[i + 3] = color[3] ?? 255;
}

function fillRoundRect(buf, width, x0, y0, x1, y1, r, color) {
  for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
    for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
      if (inRoundRect(x + 0.5, y + 0.5, x0, y0, x1, y1, r)) paint(buf, width, x, y, color);
    }
  }
}

function fillCircle(buf, width, cx, cy, r, color) {
  const x0 = Math.floor(cx - r);
  const x1 = Math.ceil(cx + r);
  const y0 = Math.floor(cy - r);
  const y1 = Math.ceil(cy + r);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= r * r) paint(buf, width, x, y, color);
    }
  }
}

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function downsample(src, srcWidth, size) {
  const factor = srcWidth / size;
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let dy = 0; dy < factor; dy++) {
        for (let dx = 0; dx < factor; dx++) {
          const i = ((y * factor + dy) * srcWidth + (x * factor + dx)) * 4;
          r += src[i];
          g += src[i + 1];
          b += src[i + 2];
          a += src[i + 3];
        }
      }
      const n = factor * factor;
      const o = (y * size + x) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = Math.round(a / n);
    }
  }
  return out;
}

function render(size, { maskable = false } = {}) {
  const ss = 4;
  const W = size * ss;
  const buf = Buffer.alloc(W * W * 4);
  const bg = [7, 10, 18, 255];
  for (let i = 0; i < W * W; i++) paint(buf, W, i % W, Math.floor(i / W), bg);

  const inset = maskable ? 0.13 : 0.06;
  const x0 = W * inset;
  const x1 = W * (1 - inset);
  const radius = (x1 - x0) * 0.22;
  const goldA = [246, 210, 122];
  const goldB = [185, 130, 31];
  for (let y = Math.floor(x0); y < Math.ceil(x1); y++) {
    for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
      if (!inRoundRect(x + 0.5, y + 0.5, x0, x0, x1, x1, radius)) continue;
      const t = Math.min(1, Math.max(0, (x + y) / (2 * W)));
      paint(buf, W, x, y, [...mix(goldA, goldB, t), 255]);
    }
  }

  const ink = [35, 24, 10, 255];
  const bar = 0.1 * W;
  fillRoundRect(buf, W, 0.3 * W, 0.3 * W, 0.7 * W, 0.3 * W + bar, bar / 2, ink);
  fillRoundRect(buf, W, 0.45 * W, 0.3 * W, 0.55 * W, 0.72 * W, bar / 2, ink);
  fillCircle(buf, W, 0.72 * W, 0.72 * W, 0.055 * W, ink);

  return downsample(buf, W, size);
}

mkdirSync(outDir, { recursive: true });

const icons = [
  { file: "icon-192.png", size: 192, maskable: false },
  { file: "icon-512.png", size: 512, maskable: false },
  { file: "icon-maskable-512.png", size: 512, maskable: true },
  { file: "apple-touch-icon.png", size: 180, maskable: true },
];

for (const { file, size, maskable } of icons) {
  const png = encodePng(size, size, render(size, { maskable }));
  writeFileSync(resolve(outDir, file), png);
  console.log(`✓ public/icons/${file} (${size}×${size}, ${png.length} bytes)`);
}
