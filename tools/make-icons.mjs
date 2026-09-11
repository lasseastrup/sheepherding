// Draws the app and tray icons as PNGs with a tiny encoder (no image library needed).
import { deflateSync, crc32 } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

function png(width, height, rgba) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A sheep seen from above: cream fleece, dark head, on a transparent ground. */
function sheep(size, mono) {
  const buf = Buffer.alloc(size * size * 4);
  const put = (x, y, r, g, b, a) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    const ea = a / 255;
    buf[i] = Math.round(buf[i] * (1 - ea) + r * ea);
    buf[i + 1] = Math.round(buf[i + 1] * (1 - ea) + g * ea);
    buf[i + 2] = Math.round(buf[i + 2] * (1 - ea) + b * ea);
    buf[i + 3] = Math.min(255, buf[i + 3] + a * (1 - buf[i + 3] / 255));
  };
  const ellipse = (cx, cy, rx, ry, col) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      // 4x supersampling for soft edges
      let cover = 0;
      for (let sy = 0; sy < 2; sy++) for (let sx = 0; sx < 2; sx++) {
        const px = x + (sx + 0.5) / 2 - cx;
        const py = y + (sy + 0.5) / 2 - cy;
        if ((px * px) / (rx * rx) + (py * py) / (ry * ry) <= 1) cover++;
      }
      if (cover) put(x, y, col[0], col[1], col[2], Math.round((cover / 4) * col[3]));
    }
  };
  const s = size;
  const fleece = mono ? [255, 255, 255, 255] : [242, 239, 228, 255];
  const dark = mono ? [255, 255, 255, 255] : [47, 51, 48, 255];
  const shadow = [20, 30, 18, mono ? 0 : 70];
  ellipse(s * 0.5, s * 0.56, s * 0.36, s * 0.27, shadow);
  // lumpy fleece: a few overlapping ellipses
  ellipse(s * 0.47, s * 0.5, s * 0.34, s * 0.25, fleece);
  ellipse(s * 0.35, s * 0.46, s * 0.14, s * 0.15, fleece);
  ellipse(s * 0.6, s * 0.44, s * 0.14, s * 0.15, fleece);
  ellipse(s * 0.47, s * 0.6, s * 0.2, s * 0.13, fleece);
  // head, ears
  ellipse(s * 0.79, s * 0.5, s * 0.11, s * 0.085, dark);
  ellipse(s * 0.74, s * 0.39, s * 0.05, s * 0.035, dark);
  ellipse(s * 0.74, s * 0.61, s * 0.05, s * 0.035, dark);
  return buf;
}

mkdirSync('build', { recursive: true });
mkdirSync('electron/icons', { recursive: true });
writeFileSync('build/icon.png', png(256, 256, sheep(256, false)));
writeFileSync('electron/icons/tray.png', png(32, 32, sheep(32, false)));
writeFileSync('electron/icons/tray-mono.png', png(32, 32, sheep(32, true)));
console.log('icons written: build/icon.png (256), electron/icons/tray.png, tray-mono.png (32)');
