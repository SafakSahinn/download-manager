// HTTP yardımcıları: yönlendirme takibi, dosya adı çözümleme, global hız sınırlayıcı
const http = require('http');
const https = require('https');
const path = require('path');
const { extForMime } = require('./categories');

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const agentOpts = { keepAlive: true, maxSockets: 64 };
const httpAgent = new http.Agent(agentOpts);
const httpsAgent = new https.Agent(agentOpts);

function buildHeaders(extra = {}) {
  const h = { 'User-Agent': DEFAULT_UA, Accept: '*/*', 'Accept-Encoding': 'identity' };
  for (const [k, v] of Object.entries(extra || {})) {
    if (v == null || v === '') continue;
    if (k.toLowerCase() === 'user-agent') h['User-Agent'] = v;
    else h[k] = v;
  }
  return h;
}

/**
 * Yönlendirmeleri takip eden GET/HEAD isteği. IncomingMessage döndürür (res.finalUrl ekli).
 */
function request(url, { method = 'GET', headers = {}, signal, timeout = 30000 } = {}, redirects = 0) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(url);
    } catch {
      return reject(new Error('Geçersiz URL'));
    }
    const isHttps = u.protocol === 'https:';
    if (!isHttps && u.protocol !== 'http:') return reject(new Error('Desteklenmeyen protokol: ' + u.protocol));
    const lib = isHttps ? https : http;
    let timer = null;
    const req = lib.request(
      u,
      {
        method,
        headers: buildHeaders(headers),
        agent: isHttps ? httpsAgent : httpAgent,
        signal,
        autoSelectFamily: true,
        autoSelectFamilyAttemptTimeout: 500,
      },
      (res) => {
        clearTimeout(timer);
        const code = res.statusCode;
        if ([301, 302, 303, 307, 308].includes(code) && res.headers.location) {
          res.resume();
          if (redirects >= 15) return reject(new Error('Çok fazla yönlendirme'));
          const next = new URL(res.headers.location, url).toString();
          resolve(request(next, { method: code === 303 ? 'GET' : method, headers, signal, timeout }, redirects + 1));
          return;
        }
        res.finalUrl = url;
        // Veri akışı belirli süre durursa bağlantıyı kopar (takılan bağlantı bekçisi)
        res.setTimeout(timeout, () => res.destroy(new Error('Bağlantı yanıt vermiyor')));
        resolve(res);
      }
    );
    // DNS + bağlantı + ilk yanıt için kesin zaman aşımı
    timer = setTimeout(() => req.destroy(new Error('Bağlantı zaman aşımına uğradı')), timeout);
    req.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    req.end();
  });
}

function parseContentDisposition(cd) {
  if (!cd) return null;
  let m = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(cd);
  if (m) {
    try {
      return decodeURIComponent(m[2].trim().replace(/^"|"$/g, ''));
    } catch {}
  }
  m = /filename\s*=\s*"([^"]+)"/i.exec(cd) || /filename\s*=\s*([^;]+)/i.exec(cd);
  if (m) {
    const raw = m[1].trim();
    // Bazı sunucular UTF-8 baytlarını latin1 olarak gönderir
    try {
      const fixed = Buffer.from(raw, 'latin1').toString('utf8');
      return fixed.includes('\uFFFD') ? raw : fixed;
    } catch {
      return raw;
    }
  }
  return null;
}

function sanitizeFilename(name) {
  let n = (name || '').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/[. ]+$/, '').trim();
  if (!n) n = 'indirme';
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(n)) n = '_' + n;
  if (n.length > 200) {
    const ext = path.extname(n);
    n = n.slice(0, 200 - ext.length) + ext;
  }
  return n;
}

function filenameFromUrl(url) {
  try {
    const u = new URL(url);
    const base = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
    return base || u.hostname;
  } catch {
    return 'indirme';
  }
}

function resolveFilename(res, url, mime) {
  let name = parseContentDisposition(res.headers['content-disposition']) || filenameFromUrl(res.finalUrl || url);
  name = sanitizeFilename(name);
  if (!path.extname(name)) {
    const ext = extForMime(mime);
    if (ext) name += '.' + ext;
  }
  return name;
}

/**
 * Dosya bilgisi alma: boyut, devam ettirilebilirlik, ad, MIME.
 */
async function probe(url, headers = {}) {
  const res = await request(url, { headers: { ...headers, Range: 'bytes=0-0' }, timeout: 20000 });
  try {
    const code = res.statusCode;
    if (code >= 400) throw new Error(`Sunucu hatası: HTTP ${code}`);
    const mime = (res.headers['content-type'] || '').split(';')[0].trim();
    let size = null;
    let resumable = false;
    if (code === 206) {
      const m = /\/(\d+)\s*$/.exec(res.headers['content-range'] || '');
      if (m) {
        size = parseInt(m[1], 10);
        resumable = true;
      }
    } else if (res.headers['content-length']) {
      size = parseInt(res.headers['content-length'], 10);
    }
    return {
      finalUrl: res.finalUrl,
      filename: resolveFilename(res, url, mime),
      mime,
      size,
      resumable,
    };
  } finally {
    res.destroy();
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Global token-bucket hız sınırlayıcı (borçlanmalı) */
class Throttle {
  constructor() {
    this.rate = 0;
    this.tokens = 0;
    this.last = Date.now();
  }
  setRate(bytesPerSec) {
    this.rate = Math.max(0, bytesPerSec | 0);
    this.tokens = 0;
    this.last = Date.now();
  }
  async take(n) {
    for (;;) {
      if (!this.rate) return;
      const now = Date.now();
      this.tokens = Math.min(this.rate, this.tokens + ((now - this.last) / 1000) * this.rate);
      this.last = now;
      if (this.tokens > 0) {
        this.tokens -= n;
        return;
      }
      await sleep(Math.min(500, Math.ceil((-this.tokens / this.rate) * 1000) + 5));
    }
  }
}

module.exports = { request, probe, sanitizeFilename, Throttle, sleep, DEFAULT_UA };
