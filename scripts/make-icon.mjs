#!/usr/bin/env node
// 生成应用图标 build/icon.png（1024×1024，纯 Node 绘制，无需第三方依赖）
// 图案：圆角方块 + 三条「滑杆」，寓意配置调节
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const S = 1024;
const SS = 4; // 超采样抗锯齿

function hex(c) {
  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
}
const TOP = hex('#e0703a');
const BOTTOM = hex('#9a3812');
const KNOB_IN = hex('#b4461a');

function inRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}
const inCircle = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

const bars = [
  { y: 330, knob: 640 },
  { y: 512, knob: 400 },
  { y: 694, knob: 700 },
];

// 返回某个采样点的颜色 [r,g,b,a]
function sample(x, y) {
  if (!inRoundRect(x, y, 72, 72, 952, 952, 210)) return [0, 0, 0, 0];
  const t = (y - 72) / 880;
  let col = TOP.map((v, i) => Math.round(v + (BOTTOM[i] - v) * t));
  for (const b of bars) {
    if (inCircle(x, y, b.knob, b.y, 76)) {
      col = inCircle(x, y, b.knob, b.y, 40) ? KNOB_IN : [255, 255, 255];
      return [...col, 255];
    }
    if (inRoundRect(x, y, 250, b.y - 30, 774, b.y + 30, 30)) {
      const left = x < b.knob;
      col = left ? [255, 255, 255] : col.map((v) => Math.round(v + (255 - v) * 0.45));
    }
  }
  return [...col, 255];
}

const raw = Buffer.alloc((S * 4 + 1) * S);
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0;
  for (let x = 0; x < S; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const c = sample(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS);
        r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; a += c[3];
      }
    }
    const o = y * (S * 4 + 1) + 1 + x * 4;
    if (a > 0) {
      raw[o] = Math.round(r / a);
      raw[o + 1] = Math.round(g / a);
      raw[o + 2] = Math.round(b / a);
    }
    raw[o + 3] = Math.round(a / (SS * SS));
  }
}

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; // 位深
ihdr[9] = 6; // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
fs.mkdirSync(path.join(ROOT, 'build'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'build', 'icon.png'), png);
console.log('已生成 build/icon.png', png.length, 'bytes');
