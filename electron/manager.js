// İndirme yöneticisi: kuyruk, eşzamanlılık limiti, kalıcılık, hız/ETA hesaplama
const EventEmitter = require('events');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const HttpTask = require('./httpTask');
const { YtdlpTask, cleanupPartials } = require('./ytdlp');
const { categorize, isMediaSite } = require('./categories');
const { Throttle, sanitizeFilename } = require('./http');
const { readJson, writeJsonSync, writeJsonAsync } = require('./store');

const ACTIVE = new Set(['probing', 'downloading', 'merging']);

class DownloadManager extends EventEmitter {
  constructor(settingsStore, dataFile) {
    super();
    this.settings = settingsStore;
    this.dataFile = dataFile;
    this.items = new Map();
    this.tasks = new Map();
    this.throttle = new Throttle();
    this.throttle.setRate((this.cfg.speedLimitKBps || 0) * 1024);
    this.saveTimer = null;
    this.load();
    this.ticker = setInterval(() => this.tick(), 250);
    this.lastSave = Date.now();
  }

  get cfg() {
    return this.settings.get();
  }

  // ---------- Kalıcılık ----------
  load() {
    const list = readJson(this.dataFile, []);
    for (const it of list) {
      if (ACTIVE.has(it.status)) it.status = 'paused';
      it.speed = 0;
      it.eta = null;
      this.items.set(it.id, it);
    }
  }

  serialize() {
    return [...this.items.values()].map(({ _last, ...it }) => ({ ...it, speed: 0 }));
  }

  // Yalnızca kapanışta: süreç bitmeden diske yazıldığından emin olmak için senkron
  saveNow() {
    clearTimeout(this.saveTimer);
    try {
      writeJsonSync(this.dataFile, this.serialize());
      this.lastSave = Date.now();
    } catch (e) {
      console.error('Kaydetme hatası', e);
    }
  }

  // Çalışırken: ana süreci bloklamadan yaz; aynı anda tek yazma, arada gelen istek sonra tekrar yazılır
  async saveAsync() {
    this.lastSave = Date.now();
    if (this.closed) return;
    if (this.saving) {
      this.saveAgain = true;
      return;
    }
    this.saving = true;
    try {
      do {
        this.saveAgain = false;
        await writeJsonAsync(this.dataFile, this.serialize());
      } while (this.saveAgain && !this.closed);
    } catch (e) {
      console.error('Kaydetme hatası', e);
    } finally {
      this.saving = false;
    }
  }

  save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveAsync(), 800);
  }

  // ---------- UI için anlık görüntü ----------
  snapshot(it) {
    let segments = null;
    if (it.kind === 'http' && it.size && it.segments && it.segments.length > 1) {
      segments = it.segments.slice(0, 48).map((s) => ({
        s: s.start / it.size,
        e: ((s.end == null ? it.size - 1 : s.end) + 1) / it.size,
        p: (s.start + s.pos) / it.size,
      }));
    }
    return {
      id: it.id,
      url: it.url,
      kind: it.kind,
      filename: it.filename || it.title || it.url,
      title: it.title,
      thumbnail: it.thumbnail,
      category: it.category || 'other',
      dir: it.dir,
      filePath: it.filePath,
      size: it.size,
      downloaded: it.downloaded || 0,
      status: it.status,
      speed: it.speed || 0,
      eta: it.eta,
      error: it.error,
      resumable: it.kind === 'media' ? true : !!it.resumable,
      connections: this.tasks.get(it.id)?.active?.size || 0,
      segments,
      stage: it.stage,
      createdAt: it.createdAt,
      completedAt: it.completedAt,
    };
  }

  list() {
    return [...this.items.values()].sort((a, b) => b.createdAt - a.createdAt).map((it) => this.snapshot(it));
  }

  emitItem(it) {
    this.emit('update', this.snapshot(it));
  }

  // ---------- Hedef klasör ----------
  async resolveTarget(item) {
    const cfg = this.cfg;
    if (item.categoryOverride) {
      item.category = item.categoryOverride;
    } else if (item.kind === 'media') {
      item.category = item.mediaChoice === 'audio' ? 'audio' : 'video';
    } else {
      item.category = categorize(item.filename, item.mime);
    }
    const folder = cfg.categoryFolders[item.category] || cfg.categoryFolders.other;
    item.dir = item.customDir || path.join(cfg.baseDir, folder);
    if (item.kind === 'http' && !item.filePath) {
      item.filename = sanitizeFilename(item.filename);
      item.filePath = this.uniquePath(item.dir, item.filename, item.id);
      item.filename = path.basename(item.filePath);
    }
  }

  uniquePath(dir, name, selfId) {
    const ext = path.extname(name);
    const base = name.slice(0, name.length - ext.length);
    const taken = new Set();
    for (const it of this.items.values()) if (it.id !== selfId && it.filePath) taken.add(it.filePath.toLowerCase());
    for (let i = 0; i < 10000; i++) {
      const candidate = path.join(dir, i === 0 ? name : `${base} (${i})${ext}`);
      if (taken.has(candidate.toLowerCase())) continue;
      if (fs.existsSync(candidate) || fs.existsSync(candidate + '.fdpart')) continue;
      return candidate;
    }
    return path.join(dir, `${base}-${Date.now()}${ext}`);
  }

  // ---------- Ekleme ----------
  async add(opts) {
    const id = crypto.randomUUID();
    let kind = opts.kind;
    if (kind === 'auto') kind = isMediaSite(opts.url) ? 'media' : 'http';
    const item = {
      id,
      url: opts.url,
      kind: kind === 'media' ? 'media' : 'http',
      filename: opts.filename ? sanitizeFilename(opts.filename) : null,
      title: opts.title || null,
      thumbnail: opts.thumbnail || null,
      headers: opts.headers || {},
      mediaChoice: opts.mediaChoice || null,
      customDir: opts.customDir || null,
      categoryOverride: opts.category || null,
      status: opts.startPaused ? 'paused' : 'queued',
      createdAt: Date.now(),
      downloaded: 0,
      size: opts.size ?? null,
      speed: 0,
      eta: null,
      segments: null,
    };
    if (item.kind === 'http' && opts.probed) {
      item.probed = true;
      item.finalUrl = opts.finalUrl || opts.url;
      item.resumable = !!opts.resumable;
      item.mime = opts.mime || '';
    }
    if (item.kind === 'media') {
      item.filename = opts.title || opts.url;
      if (opts.title) item.outName = sanitizeFilename(opts.title).slice(0, 150);
    }
    if (item.kind === 'media' || item.probed) await this.resolveTarget(item);
    else item.category = categorize(item.filename || '', '');

    this.items.set(id, item);
    this.emitItem(item);
    this.save();
    this.schedule();
    return this.snapshot(item);
  }

  // ---------- Kuyruk ----------
  schedule() {
    const max = Math.max(1, this.cfg.maxConcurrent || 3);
    const queued = [...this.items.values()].filter((i) => i.status === 'queued').sort((a, b) => a.createdAt - b.createdAt);
    for (const it of queued) {
      if (this.tasks.size >= max) break;
      // Duraklatılan eski görev hâlâ kapanıyorsa bekle; bitince finally → schedule() yeniden başlatır
      if (this.tasks.has(it.id)) continue;
      this.startTask(it);
    }
  }

  startTask(item) {
    const ctx = {
      throttle: this.throttle,
      connections: Math.max(1, Math.min(32, this.cfg.connections || 8)),
      resolveTarget: (it) => this.resolveTarget(it),
    };
    const task = item.kind === 'media' ? new YtdlpTask(item, ctx) : new HttpTask(item, ctx);
    this.tasks.set(item.id, task);
    item._last = { t: Date.now(), d: item.downloaded || 0 };
    task.on('update', () => this.emitItem(item));
    task
      .start()
      .catch((e) => {
        if (task.stopped) return;
        item.status = 'error';
        item.error = e && e.message ? e.message : String(e);
        item.speed = 0;
        // Hata sonrası yeniden denemede bilgi tekrar alınsın (link yenilenmiş olabilir)
        if (item.kind === 'http' && !item.resumable) item.probed = false;
      })
      .finally(() => {
        this.tasks.delete(item.id);
        delete item._last;
        if (this.items.has(item.id)) {
          if (item.status === 'completed') this.emit('completed', this.snapshot(item));
          this.emitItem(item);
          this.save();
        }
        this.schedule();
      });
    this.emitItem(item);
  }

  tick() {
    const now = Date.now();
    for (const [id, task] of this.tasks) {
      const it = this.items.get(id);
      if (!it) continue;
      if (it.kind === 'http' && it._last) {
        const dt = (now - it._last.t) / 1000;
        if (dt >= 0.45) {
          const inst = Math.max(0, (it.downloaded - it._last.d) / dt);
          it.speed = it.speed ? it.speed * 0.6 + inst * 0.4 : inst;
          it._last = { t: now, d: it.downloaded };
          it.eta = it.size && it.speed > 1 ? (it.size - it.downloaded) / it.speed : null;
        }
      }
      if (it.status === 'downloading' || it.status === 'merging') this.emitItem(it);
    }
    // Aktif indirmelerde parça durumunu periyodik olarak kaydet (çökme sonrası devam için)
    if (this.tasks.size && now - this.lastSave > 5000) this.saveAsync();
  }

  // ---------- Eylemler ----------
  pause(id) {
    const it = this.items.get(id);
    if (!it) return;
    const task = this.tasks.get(id);
    if (task) task.stop();
    if (it.status !== 'completed') {
      it.status = 'paused';
      it.speed = 0;
      it.eta = null;
    }
    this.emitItem(it);
    this.save();
  }

  resume(id) {
    const it = this.items.get(id);
    if (!it || it.status === 'completed') return;
    const running = this.tasks.get(id);
    if (running && !running.stopped) return;
    it.status = 'queued';
    it.error = null;
    this.emitItem(it);
    this.save();
    this.schedule();
  }

  async remove(id, deleteFile) {
    const it = this.items.get(id);
    if (!it) return;
    const task = this.tasks.get(id);
    if (task) task.stop();
    this.items.delete(id);
    this.emit('removed', id);
    this.save();
    // Görev kapanana kadar biraz bekle, sonra yarım dosyaları temizle
    setTimeout(async () => {
      if (it.kind === 'http' && it.filePath && it.status !== 'completed') {
        await fsp.rm(it.filePath + '.fdpart', { force: true }).catch(() => {});
      }
      if (it.kind === 'media' && it.status !== 'completed') await cleanupPartials(it).catch(() => {});
      if (deleteFile && it.filePath && it.status === 'completed') {
        try {
          const { shell } = require('electron');
          await shell.trashItem(it.filePath);
        } catch {}
      }
    }, 700);
  }

  pauseAll() {
    for (const it of this.items.values()) if (it.status === 'queued' || ACTIVE.has(it.status)) this.pause(it.id);
  }

  resumeAll() {
    for (const it of this.items.values()) {
      if (it.status === 'paused' || it.status === 'error') {
        it.status = 'queued';
        it.error = null;
        this.emitItem(it);
      }
    }
    this.save();
    this.schedule();
  }

  clearCompleted() {
    for (const it of [...this.items.values()]) {
      if (it.status === 'completed') {
        this.items.delete(it.id);
        this.emit('removed', it.id);
      }
    }
    this.save();
  }

  get(id) {
    return this.items.get(id);
  }

  applySettings() {
    this.throttle.setRate((this.cfg.speedLimitKBps || 0) * 1024);
    this.schedule();
  }

  shutdown() {
    this.closed = true; // bekleyen asenkron kayıtlar artık yazmasın; son sözü senkron kayıt söyler
    clearInterval(this.ticker);
    for (const [id, task] of this.tasks) {
      task.stop();
      const it = this.items.get(id);
      if (it) it.status = 'paused';
    }
    this.saveNow();
  }
}

module.exports = DownloadManager;
