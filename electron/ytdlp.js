// yt-dlp entegrasyonu: YouTube, Vimeo, X, Instagram, TikTok vb. sitelerden video/ses indirme
const { app } = require('electron');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const EventEmitter = require('events');
const { request } = require('./http');

const YTDLP_URL = 'https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp.exe';

function binDir() {
  return path.join(app.getPath('userData'), 'bin');
}
function ytdlpPath() {
  return path.join(binDir(), 'yt-dlp.exe');
}
function ffmpegPath() {
  try {
    let p = require('ffmpeg-static');
    if (p) p = p.replace(/app\.asar(?!\.unpacked)/, 'app.asar.unpacked');
    return p && fs.existsSync(p) ? p : null;
  } catch {
    return null;
  }
}

function nodeRuntimeArgs() {
  try {
    const nodeBin = process.execPath;
    if (nodeBin && fs.existsSync(nodeBin)) return ['--js-runtimes', `node:${nodeBin}`];
  } catch {}
  return ['--js-runtimes', 'node'];
}

// process.execPath Electron'un kendisi: yt-dlp onu "node" olarak çağırdığında uygulama
// penceresi açılmasın diye ELECTRON_RUN_AS_NODE ile saf Node.js kipinde çalışmalı.
function childEnv() {
  return { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', ELECTRON_RUN_AS_NODE: '1' };
}

const events = new EventEmitter();
let installing = null;

/** yt-dlp.exe yoksa GitHub'dan indirir */
function ensureYtdlp(force = false) {
  if (!force && fs.existsSync(ytdlpPath())) return Promise.resolve(ytdlpPath());
  if (installing) return installing;
  installing = (async () => {
    await fsp.mkdir(binDir(), { recursive: true });
    const tmp = ytdlpPath() + '.download';
    const res = await request(YTDLP_URL, { timeout: 60000 });
    if (res.statusCode !== 200) {
      res.resume();
      throw new Error('yt-dlp indirilemedi: HTTP ' + res.statusCode);
    }
    const total = parseInt(res.headers['content-length'] || '0', 10);
    let got = 0;
    const out = fs.createWriteStream(tmp);
    try {
      await new Promise((resolve, reject) => {
        res.on('data', (c) => {
          got += c.length;
          events.emit('install-progress', { got, total });
        });
        res.pipe(out);
        out.on('finish', resolve);
        out.on('error', reject);
        res.on('error', reject);
      });
      if (total && got !== total) throw new Error('yt-dlp indirmesi eksik kaldı');
    } catch (e) {
      out.destroy();
      await fsp.rm(tmp, { force: true }).catch(() => {});
      throw e;
    }
    await fsp.rm(ytdlpPath(), { force: true });
    await fsp.rename(tmp, ytdlpPath());
    events.emit('install-progress', { got: total, total, done: true });
    return ytdlpPath();
  })().finally(() => {
    installing = null;
  });
  return installing;
}

function getVersion() {
  return new Promise((resolve) => {
    if (!fs.existsSync(ytdlpPath())) return resolve(null);
    execFile(ytdlpPath(), ['--version'], { windowsHide: true, timeout: 15000 }, (err, stdout) =>
      resolve(err ? null : stdout.trim())
    );
  });
}

// Tarayıcı eklentisinden gelen çerez/referer/user-agent bilgilerini yt-dlp'ye aktarır
function headerArgs(headers = {}, targetUrl = '') {
  const isYt = /(?:youtube\.com|youtu\.be)/i.test(targetUrl || '');
  const args = [];
  
  if (!isYt) {
    for (const [k, v] of Object.entries(headers || {})) {
      if (!v) continue;
      const key = k.toLowerCase();
      if (key === 'user-agent') args.push('--user-agent', v);
      else if (key === 'referer') args.push('--referer', v);
      else if (key === 'cookie') args.push('--add-header', `Cookie:${v}`);
    }
  }
  return args;
}

async function getFastInfo(url) {
  try {
    const isYt = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)/i.test(url);
    if (isYt) {
      const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
      const res = await request(oembedUrl, { timeout: 3500 });
      if (res.statusCode !== 200) {
        res.resume();
        return null;
      }
      let body = '';
      for await (const chunk of res) body += chunk;
      const j = JSON.parse(body);
      return {
        title: j.title || '',
        thumbnail: j.thumbnail_url || null,
        uploader: j.author_name || null,
        extractor: 'youtube',
        webpageUrl: url,
        options: [
          { id: 'v1080', label: '1080p', kind: 'video', height: 1080, size: null },
          { id: 'v720', label: '720p', kind: 'video', height: 720, size: null },
          { id: 'v480', label: '480p', kind: 'video', height: 480, size: null },
          { id: 'v360', label: '360p', kind: 'video', height: 360, size: null },
        ],
        isLive: false,
      };
    }

    if (/\.(?:m3u8|mpd)(?:[?#]|$)/i.test(url)) {
      return {
        title: 'Dizi / Film Akışı (HLS Video)',
        thumbnail: null,
        uploader: 'HLS Stream',
        extractor: 'm3u8',
        webpageUrl: url,
        options: [
          { id: 'best', label: 'En Yüksek Kalite (Best)', kind: 'video', height: 1080, size: null },
          { id: 'v720', label: '720p', kind: 'video', height: 720, size: null },
          { id: 'v480', label: '480p', kind: 'video', height: 480, size: null },
        ],
        isLive: false,
      };
    }

    return null;
  } catch {
    return null;
  }
}

/** Video bilgisi + format seçenekleri */
async function getInfo(url, headers) {
  // 1) Hızlı ön izleme: YouTube veya M3U8 için anında (300ms) başlık, kanal, kapak görseli
  const fast = await getFastInfo(url);
  if (fast) return fast;

  const bin = await ensureYtdlp();
  return new Promise((resolve, reject) => {
    const args = [
      '-J',
      '--no-playlist',
      '--no-warnings',
      '--encoding', 'utf-8',
      ...nodeRuntimeArgs(),
      ...headerArgs(headers, url),
      url,
    ];
    execFile(bin, args, { env: childEnv(), windowsHide: true, maxBuffer: 64 * 1024 * 1024, timeout: 60000 }, (err, stdout, stderr) => {
      if (err) {
        const msg = (stderr || err.message || '').split('\n').filter((l) => l.includes('ERROR')).join(' ') || 'Video bilgisi alınamadı';
        return reject(new Error(msg.replace(/^ERROR:\s*/, '')));
      }
      try {
        const j = JSON.parse(stdout);
        const heights = new Set();
        for (const f of j.formats || []) if (f.height && f.vcodec && f.vcodec !== 'none') heights.add(f.height);
        const sizeFor = (h) => {
          // yaklaşık boyut: seçilen yükseklikteki en büyük video + en iyi ses
          const vids = (j.formats || []).filter((f) => f.height && f.height <= h && f.vcodec !== 'none');
          const best = vids.sort((a, b) => (b.height - a.height) || ((b.tbr || 0) - (a.tbr || 0)))[0];
          const aud = (j.formats || []).filter((f) => f.vcodec === 'none' && f.acodec !== 'none').sort((a, b) => (b.abr || 0) - (a.abr || 0))[0];
          const v = best ? best.filesize || best.filesize_approx || 0 : 0;
          const a = aud ? aud.filesize || aud.filesize_approx || 0 : 0;
          return v + (best && best.acodec && best.acodec !== 'none' ? 0 : a) || null;
        };
        const options = [...heights]
          .sort((a, b) => b - a)
          .filter((h) => h >= 144)
          .map((h) => ({ id: `v${h}`, label: `${h}p`, kind: 'video', height: h, size: sizeFor(h) }));
        resolve({
          title: j.title || j.id,
          thumbnail: j.thumbnail || null,
          duration: j.duration || null,
          uploader: j.uploader || j.channel || null,
          extractor: j.extractor_key || j.extractor,
          webpageUrl: j.webpage_url || url,
          options,
          isLive: !!j.is_live,
        });
      } catch (e) {
        reject(new Error('Video bilgisi çözümlenemedi'));
      }
    });
  });
}

function formatArgs(choice) {
  if (choice === 'audio') return ['-f', 'ba/b', '-x', '--audio-format', 'mp3', '--audio-quality', '0'];
  if (choice && /^v\d+$/.test(choice)) {
    const h = choice.slice(1);
    return ['-f', `bv*[height<=${h}]+ba/b[height<=${h}]/bv*+ba/b/best`, '--merge-output-format', 'mp4'];
  }
  return ['-f', 'bv*+ba/b/best', '--merge-output-format', 'mp4'];
}

class YtdlpTask extends EventEmitter {
  constructor(item, ctx) {
    super();
    this.item = item;
    this.ctx = ctx;
    this.proc = null;
    this.stopped = false;
  }

  async start() {
    const item = this.item;
    this.stopped = false;
    item.status = 'probing';
    this.emit('update');
    const bin = await ensureYtdlp();
    if (this.stopped) return;
    await this.ctx.resolveTarget(item);
    await fsp.mkdir(item.dir, { recursive: true });

    const ff = ffmpegPath();
    const limit = this.ctx.throttle.rate;
    const isYt = /(?:youtube\.com|youtu\.be)/i.test(item.url || '');
    const outTpl = path.join(item.dir, item.outName ? item.outName + '.%(ext)s' : '%(title).150s [%(id)s].%(ext)s');
    const args = [
      ...formatArgs(item.mediaChoice),
      '--no-playlist',
      '--newline',
      '--progress',
      '--no-warnings',
      '--continue',
      '--no-mtime',
      '--windows-filenames',
      '--encoding', 'utf-8',
      '--retries', '10',
      '--fragment-retries', '10',
      ...nodeRuntimeArgs(),
      '-N', String(Math.max(1, Math.min(8, this.ctx.connections))),
      '--progress-template',
      'download:FDMP|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|%(info.format_id)s',
      '--print', 'after_move:FDMF|%(filepath)s',
      '-o', outTpl,
      ...headerArgs(item.headers, item.url),
    ];
    if (ff) args.push('--ffmpeg-location', ff);
    if (limit) args.push('--limit-rate', String(limit));
    args.push(item.url);
    if (this.stopped) return;

    item.status = 'downloading';
    item.error = null;
    this.emit('update');

    await new Promise((resolve, reject) => {
      const p = spawn(bin, args, { env: childEnv(), windowsHide: true });
      this.proc = p;
      let errBuf = '';
      let lastFormat = null;
      let stage = 0;
      const onLine = (line) => {
        line = line.trim();
        if (!line) return;
        if (line.startsWith('FDMP|')) {
          const [, dl, tot, est, spd, eta, fmt] = line.split('|');
          const num = (x) => (x && x !== 'NA' && x !== 'None' ? Number(x) : null);
          if (fmt !== lastFormat) {
            lastFormat = fmt;
            stage++;
          }
          item.stage = stage;
          item.downloaded = num(dl) || 0;
          item.size = num(tot) || num(est) || item.size;
          item.speed = num(spd) || 0;
          item.eta = num(eta);
          item.status = 'downloading';
        } else if (line.startsWith('FDMF|')) {
          item.filePath = line.slice(5);
          item.filename = path.basename(item.filePath);
        } else if (/\[(Merger|ExtractAudio|FixupM3u8|VideoConvertor|FFmpeg)/.test(line)) {
          item.status = 'merging';
          item.speed = 0;
          this.emit('update');
        } else if (/^\[download\] Destination: /.test(line)) {
          const dest = line.replace(/^\[download\] Destination: /, '');
          // İptal edilirse temizlenebilsin diye ara dosyaları kaydet
          item.tempFiles = [...new Set([...(item.tempFiles || []), dest])];
          if (!item.filePath) item.filename = path.basename(dest);
        }
      };
      let outBuf = '';
      p.stdout.on('data', (d) => {
        outBuf += d.toString('utf8');
        const lines = outBuf.split(/\r?\n/);
        outBuf = lines.pop();
        lines.forEach(onLine);
      });
      p.stderr.on('data', (d) => {
        errBuf += d.toString('utf8');
        if (errBuf.length > 20000) errBuf = errBuf.slice(-20000);
      });
      p.on('error', reject);
      p.on('close', (code) => {
        if (outBuf) onLine(outBuf);
        this.proc = null;
        if (this.stopped) return resolve();
        if (code === 0) return resolve();
        const msg = errBuf.split('\n').filter((l) => l.includes('ERROR')).pop() || `yt-dlp çıkış kodu ${code}`;
        reject(new Error(msg.replace(/^ERROR:\s*/, '').trim()));
      });
    });
    if (this.stopped) return;

    if (item.filePath && fs.existsSync(item.filePath)) {
      const st = await fsp.stat(item.filePath);
      item.size = st.size;
      item.downloaded = st.size;
    }
    item.status = 'completed';
    item.completedAt = Date.now();
    item.speed = 0;
    delete item.tempFiles;
    this.emit('update');
  }

  stop() {
    this.stopped = true;
    const p = this.proc;
    if (p && p.pid) {
      // ffmpeg alt sürecini de sonlandırmak için ağaç olarak öldür
      // spawn hatası senkron fırlatılmaz, 'error' olayı olarak gelir
      const killer = spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { windowsHide: true });
      killer.on('error', () => p.kill());
    }
  }
}

/** Yarım kalan medya indirmesinin ara dosyalarını siler (.part, .ytdl, .part-FragN, birleştirilmemiş akışlar) */
async function cleanupPartials(item) {
  for (const dest of item.tempFiles || []) {
    const dir = path.dirname(dest);
    const base = path.basename(dest);
    await fsp.rm(dest, { force: true }).catch(() => {});
    const names = await fsp.readdir(dir).catch(() => []);
    for (const n of names) {
      if (n.startsWith(base + '.part') || n === base + '.ytdl') await fsp.rm(path.join(dir, n), { force: true }).catch(() => {});
    }
  }
}

module.exports = { ensureYtdlp, getInfo, getVersion, YtdlpTask, cleanupPartials, events: events, ffmpegPath };
