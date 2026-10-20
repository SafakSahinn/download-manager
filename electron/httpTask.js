// Çok bağlantılı (parçalı) HTTP indirme motoru — IDM tarzı dinamik parça bölme ile
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const EventEmitter = require('events');
const { request, probe, sleep } = require('./http');

const MIN_SPLIT = 1024 * 1024; // Bir parçayı bölmek için gereken min. kalan boyut (1 MB)
const MAX_RETRIES = 8;
const FLUSH_BYTES = 1024 * 1024; // Bağlantı başına yazma tamponu
const FLUSH_MS = 500; // Yavaş bağlantılarda ilerleme donmasın diye en geç bu sürede yaz
const RECOVER_MS = 5000; // Bu süre hatasız geçerse düşürülen bağlantı sayısını bir artır

class HttpTask extends EventEmitter {
  /**
   * @param {object} item  Yönetici tarafından tutulan indirme kaydı (yerinde güncellenir)
   * @param {object} ctx   { throttle, connections, resolveTarget(item) }
   */
  constructor(item, ctx) {
    super();
    this.item = item;
    this.ctx = ctx;
    this.controller = null;
    this.fh = null;
    this.active = new Set();
    this.stopped = false;
  }

  get remainingOf() {
    return (s) => (s.end == null ? Infinity : s.end - (s.start + s.pos) + 1);
  }

  async start() {
    const item = this.item;
    if (item.status === 'completed') return;
    this.stopped = false;
    this.controller = new AbortController();

    // 1) Bilgi al (ilk kez veya devam edilemeyen bir indirmede)
    if (!item.probed) {
      item.status = 'probing';
      this.emit('update');
      const info = await probe(item.url, item.headers);
      if (this.stopped) return;
      item.finalUrl = info.finalUrl;
      item.size = info.size;
      item.resumable = info.resumable;
      item.mime = info.mime;
      if (!item.filename) item.filename = info.filename;
      item.probed = true;
      await this.ctx.resolveTarget(item); // kategori + hedef yol
    }

    // 2) Parçaları hazırla (yarım dosya silinmişse eski parça ilerlemesi geçersizdir)
    const part = item.filePath + '.fdpart';
    const exists = fs.existsSync(part);
    if (!item.segments || !item.segments.length || !item.resumable || !exists) {
      item.segments = this.planSegments();
      item.downloaded = 0;
    }

    // 3) Dosyayı aç
    await fsp.mkdir(path.dirname(part), { recursive: true });
    this.fh = await fsp.open(part, exists && item.resumable ? 'r+' : 'w+');
    if (this.stopped) {
      await this.fh.close().catch(() => {});
      this.fh = null;
      return;
    }

    item.status = 'downloading';
    item.error = null;
    this.emit('update');

    // 4) İşçileri başlat
    try {
      await this.runWorkers();
    } finally {
      try {
        await this.fh.close();
      } catch {}
      this.fh = null;
    }
    if (this.stopped) return;

    // 5) Tamamlandı mı?
    const incomplete = item.segments.some((s) => this.remainingOf(s) > 0 && s.end != null);
    if (incomplete) throw new Error('İndirme tamamlanamadı');

    if (item.size == null) item.size = item.downloaded;
    await fsp.rm(item.filePath, { force: true }).catch(() => {});
    await fsp.rename(part, item.filePath);
    item.status = 'completed';
    item.completedAt = Date.now();
    item.speed = 0;
    this.emit('update');
  }

  planSegments() {
    const { size, resumable } = this.item;
    if (!resumable || !size) return [{ start: 0, end: size ? size - 1 : null, pos: 0 }];
    const n = Math.max(1, Math.min(this.ctx.connections, Math.floor(size / MIN_SPLIT) || 1));
    const chunk = Math.ceil(size / n);
    const segs = [];
    for (let i = 0; i < n; i++) {
      const start = i * chunk;
      const end = Math.min(size - 1, start + chunk - 1);
      if (start <= end) segs.push({ start, end, pos: 0 });
    }
    return segs;
  }

  async runWorkers() {
    const item = this.item;
    const promises = new Set();
    let firstError = null;
    this.limit = item.resumable ? this.ctx.connections : 1;
    this.halted = false;

    const launch = (seg) => {
      const p = this.worker(seg)
        .catch((e) => {
          if (!firstError) firstError = e;
          // Kalıcı hata: diğer bağlantıları da durdur
          this.halted = true;
          try {
            this.controller.abort();
          } catch {}
        })
        .finally(() => {
          promises.delete(p);
          // Dinamik bölme: biten işçinin yerine (limit dahilinde) en büyük kalan parçayı ikiye böl
          if (!this.stopped && !this.halted && item.resumable && promises.size < this.limit) {
            const target = this.pickSplit();
            if (target) launch(target);
          }
        });
      promises.add(p);
    };

    for (const seg of item.segments) if (this.remainingOf(seg) > 0 && promises.size < this.limit) launch(seg);

    // Bağlantı sayısı segment sayısından fazlaysa, mevcut parçaları bölerek doldur
    const fill = () => {
      while (!this.stopped && !this.halted && promises.size < this.limit) {
        const t = this.pickSplit();
        if (!t) break;
        launch(t);
      }
    };
    if (item.resumable) fill();

    // Geçici bir hata yüzünden düşürülen bağlantı sayısını, ortalık sakinleşince kademeli geri kazan
    this.lastFail = 0;
    const recover = item.resumable
      ? setInterval(() => {
          if (this.limit < this.ctx.connections && Date.now() - this.lastFail > RECOVER_MS) {
            this.limit++;
            fill();
          }
        }, 1000)
      : null;

    try {
      while (promises.size) await Promise.race(promises);
    } finally {
      clearInterval(recover);
    }
    if (firstError && !this.stopped) throw firstError;
  }

  pickSplit() {
    const segs = this.item.segments;
    let best = null;
    let bestRem = MIN_SPLIT * 2;
    for (const s of segs) {
      if (!this.active.has(s)) continue;
      const rem = this.remainingOf(s);
      if (rem > bestRem) {
        best = s;
        bestRem = rem;
      }
    }
    // Aktif olmayan ama bitmemiş parça varsa önce onu al
    for (const s of segs) if (!this.active.has(s) && this.remainingOf(s) > 0) return s;
    if (!best) return null;
    const cur = best.start + best.pos;
    const mid = cur + Math.floor(bestRem / 2);
    const ns = { start: mid, end: best.end, pos: 0 };
    best.end = mid - 1;
    segs.push(ns);
    segs.sort((a, b) => a.start - b.start);
    return ns;
  }

  async worker(seg) {
    this.active.add(seg);
    let retries = 0;
    try {
      while (!this.stopped && !this.halted && this.remainingOf(seg) > 0) {
        try {
          await this.fetchInto(seg);
          retries = 0;
          if (seg.end == null) break; // boyut bilinmiyorsa akış bitti = dosya bitti
        } catch (e) {
          if (this.stopped || this.halted) return;
          if (e.fatal) throw e;
          // Diğer bağlantılar çalışıyorsa bu bağlantıyı bırak: sunucu bağlantı sayısını
          // kısıtlıyor olabilir. Parça, işini bitiren sağlıklı bir bağlantıca devralınır.
          if (this.item.resumable && this.active.size > 1) {
            this.limit = Math.max(1, Math.min(this.limit, this.active.size) - 1);
            this.lastFail = Date.now();
            return;
          }
          if (++retries > MAX_RETRIES) throw e;
          await sleep(Math.min(10000, 500 * 2 ** retries));
        }
      }
    } finally {
      this.active.delete(seg);
    }
  }

  async fetchInto(seg) {
    const item = this.item;
    const headers = { ...item.headers };
    const from = seg.start + seg.pos;
    if (item.resumable) headers.Range = `bytes=${from}-${seg.end != null ? seg.end : ''}`;
    else {
      // Devam ettirilemez: baştan başla
      seg.pos = 0;
      item.downloaded = 0;
    }

    const res = await request(item.finalUrl || item.url, { headers, signal: this.controller.signal, timeout: 15000 });
    try {
      if (res.statusCode >= 400) {
        const err = new Error(`Sunucu hatası: HTTP ${res.statusCode}`);
        if ([401, 403, 404, 410].includes(res.statusCode)) err.fatal = true;
        throw err;
      }
      if (item.resumable && res.statusCode !== 206) {
        const err = new Error('Sunucu parçalı indirmeyi reddetti');
        err.fatal = true;
        throw err;
      }
      // Küçük ağ parçalarını biriktirip tek seferde yaz: disk çağrısı ve olay döngüsü yükü azalır
      let buf = [];
      let bl = 0;
      let lastFlush = Date.now();
      const flush = async () => {
        if (!bl) return;
        let data = buf.length === 1 ? buf[0] : Buffer.concat(buf, bl);
        buf = [];
        bl = 0;
        lastFlush = Date.now();
        // Biriktirirken parça bölünmüş olabilir: kalan miktarı yazmadan hemen önce hesapla
        const rem = this.remainingOf(seg);
        if (rem <= 0) return;
        if (data.length > rem) data = data.subarray(0, rem);
        await this.fh.write(data, 0, data.length, seg.start + seg.pos);
        seg.pos += data.length;
        item.downloaded += data.length;
      };
      try {
        for await (const chunk of res) {
          if (this.stopped) break;
          await this.ctx.throttle.take(chunk.length);
          buf.push(chunk);
          bl += chunk.length;
          if (bl >= FLUSH_BYTES || bl >= this.remainingOf(seg) || Date.now() - lastFlush > FLUSH_MS) await flush();
          if (this.remainingOf(seg) <= 0) break;
        }
      } finally {
        // Bağlantı kopsa veya duraklatılsa bile alınmış veriyi kaybetme
        await flush().catch(() => {});
      }
      if (!this.stopped && seg.end != null && this.remainingOf(seg) > 0) throw new Error('Bağlantı erken kapandı');
      if (seg.end == null && !this.stopped && !res.complete) throw Object.assign(new Error('Bağlantı koptu'), { fatal: !item.resumable });
    } finally {
      res.destroy();
    }
  }

  stop() {
    this.stopped = true;
    try {
      this.controller && this.controller.abort();
    } catch {}
  }
}

module.exports = HttpTask;
