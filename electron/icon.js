// Uygulama ikonunu harici dosya gerektirmeden PNG olarak üretir
const zlib = require('zlib');

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function encodePng(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// 0..1 normalize koordinatlarda şekil testi
function inShape(x, y) {
  // yuvarlatılmış kare
  const r = 0.22;
  const cx = Math.min(Math.max(x, r), 1 - r);
  const cy = Math.min(Math.max(y, r), 1 - r);
  const inBg = (x - cx) ** 2 + (y - cy) ** 2 <= r * r && x >= 0 && x <= 1 && y >= 0 && y <= 1;
  if (!inBg) return 0;
  // beyaz ok
  const stem = x >= 0.44 && x <= 0.56 && y >= 0.2 && y <= 0.55;
  const headTop = 0.5;
  const headBot = 0.74;
  const head = y >= headTop && y <= headBot && Math.abs(x - 0.5) <= ((headBot - y) / (headBot - headTop)) * 0.22;
  const base = x >= 0.26 && x <= 0.74 && y >= 0.79 && y <= 0.85;
  return stem || head || base ? 2 : 1;
}

function makeIcon(size = 256) {
  const buf = Buffer.alloc(size * size * 4);
  const S = 4;
  const c1 = [99, 102, 241];
  const c2 = [6, 182, 212];
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let bg = 0;
      let fg = 0;
      for (let sy = 0; sy < S; sy++)
        for (let sx = 0; sx < S; sx++) {
          const v = inShape((px + (sx + 0.5) / S) / size, (py + (sy + 0.5) / S) / size);
          if (v === 1) bg++;
          else if (v === 2) fg++;
        }
      const total = S * S;
      const a = (bg + fg) / total;
      const t = (px + py) / (2 * size);
      const g = c1.map((c, i) => c + (c2[i] - c) * t);
      const f = fg / Math.max(1, bg + fg);
      const o = (py * size + px) * 4;
      buf[o] = Math.round(g[0] * (1 - f) + 255 * f);
      buf[o + 1] = Math.round(g[1] * (1 - f) + 255 * f);
      buf[o + 2] = Math.round(g[2] * (1 - f) + 255 * f);
      buf[o + 3] = Math.round(a * 255);
    }
  }
  return encodePng(size, size, buf);
}

module.exports = { makeIcon };
