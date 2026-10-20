// Flux Download Manager — Electron ana süreci
const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, nativeImage, clipboard, Notification, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const { SettingsStore } = require('./store');
const DownloadManager = require('./manager');
const { probe } = require('./http');
const { categorize, looksDownloadable, isMediaSite } = require('./categories');
const ytdlp = require('./ytdlp');
const { startBridge } = require('./bridge');
const { makeIcon } = require('./icon');

const isDev = process.argv.includes('--dev');
app.setAppUserModelId('com.safak.fluxdm');

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

function getDefaults() {
  return {
    language: 'tr',
    theme: 'system',
    baseDir: path.join(app.getPath('downloads'), 'DownloadManager'),
    maxConcurrent: 3,
    connections: 8,
    speedLimitKBps: 0,
    clipboardWatch: true,
    minimizeToTray: true,
    notifications: true,
    startWithWindows: false,
    bridgePort: 6801,
    categoryFolders: {
      pdf: 'PDF',
      video: 'Video',
      image: 'Görsel',
      audio: 'Müzik',
      archive: 'Arşiv',
      program: 'Program',
      document: 'Belge',
      other: 'Diğer',
    },
  };
}

let win = null;
let tray = null;
let settings;
let manager;
let quitting = false;
const iconPath = path.join(__dirname, 'app.ico');
const iconImage = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createFromBuffer(makeIcon(256));

// Yalnızca http(s) bağlantıları dış tarayıcıda açılır (file:, javascript: vb. reddedilir)
const isWebUrl = (u) => typeof u === 'string' && /^https?:\/\//i.test(u);

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function overlayColors() {
  const dark = nativeTheme.shouldUseDarkColors;
  return dark ? { color: '#0f1117', symbolColor: '#e6e8ee', height: 44 } : { color: '#f4f5f9', symbolColor: '#1f2330', height: 44 };
}

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 860,
    minHeight: 560,
    show: false,
    icon: iconImage,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f1117' : '#f4f5f9',
    titleBarStyle: 'hidden',
    titleBarOverlay: overlayColors(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (process.platform === 'win32') {
    win.setIcon(iconPath);
  }
  win.once('ready-to-show', () => {
    if (process.platform === 'win32') win.setIcon(iconPath);
    if (!process.argv.includes('--hidden')) win.show();
  });
  if (isDev) win.loadURL('http://localhost:5173');
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  win.on('close', (e) => {
    if (!quitting && settings.get().minimizeToTray) {
      e.preventDefault();
      win.hide();
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isWebUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

function showWindow() {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.moveTop();
  win.setAlwaysOnTop(true, 'screen-saver');
  win.focus();
  setTimeout(() => {
    if (win && !win.isDestroyed()) {
      win.setAlwaysOnTop(false);
      win.focus();
    }
  }, 1000);
}

function createTray() {
  tray = new Tray(iconImage.resize({ width: 16, height: 16 }));
  tray.setToolTip('Flux Download Manager');
  const menu = () =>
    Menu.buildFromTemplate([
      { label: 'Göster / Show', click: showWindow },
      { type: 'separator' },
      { label: 'Tümünü devam ettir / Resume all', click: () => manager.resumeAll() },
      { label: 'Tümünü duraklat / Pause all', click: () => manager.pauseAll() },
      { type: 'separator' },
      { label: 'Çıkış / Quit', click: () => { quitting = true; app.quit(); } },
    ]);
  tray.setContextMenu(menu());
  tray.on('click', showWindow);
}

// ---------- Pano izleyici ----------
let clipTimer = null;
let lastClip = '';
function getClipText() {
  try {
    const t = clipboard.readText();
    return typeof t === 'string' ? t.trim() : '';
  } catch {
    return '';
  }
}

function setupClipboard() {
  clearInterval(clipTimer);
  if (!settings.get().clipboardWatch) return;
  lastClip = getClipText();
  clipTimer = setInterval(() => {
    const text = getClipText();
    if (!text || text === lastClip) return;
    lastClip = text;
    if (/^https?:\/\/\S+$/i.test(text) && (looksDownloadable(text) || isMediaSite(text))) {
      send('clipboard:url', { url: text, media: isMediaSite(text) });
    }
  }, 1000);
}

// ---------- Tarayıcı köprüsü ----------
function onBridgeAdd(d) {
  const headers = {};
  if (d.cookies) headers.Cookie = d.cookies;
  if (d.referrer) headers.Referer = d.referrer;
  if (d.userAgent) headers['User-Agent'] = d.userAgent;
  showWindow();
  send('external:add', {
    url: d.url,
    filename: d.filename || null,
    headers,
    mode: d.mode || 'auto',
    choice: d.choice || null,
    size: d.size || null,
    mime: d.mime || null,
  });
}

function appInfo() {
  return { app: 'Flux Download Manager', version: app.getVersion() };
}

function categoryDir(cat) {
  const s = settings.get();
  return path.join(s.baseDir, s.categoryFolders[cat] || s.categoryFolders.other);
}

// ---------- IPC ----------
function registerIpc() {
  ipcMain.handle('app:info', async () => ({
    version: app.getVersion(),
    ytdlpVersion: await ytdlp.getVersion(),
    ffmpeg: !!ytdlp.ffmpegPath(),
    bridgePort: settings.get().bridgePort,
    extensionDir: path.join(app.isPackaged ? process.resourcesPath : path.join(__dirname, '..'), 'extension'),
  }));

  ipcMain.handle('settings:get', () => settings.get());
  ipcMain.handle('settings:set', (_, patch) => {
    const prev = settings.get();
    const next = settings.set(patch);
    manager.applySettings();
    if (prev.clipboardWatch !== next.clipboardWatch) setupClipboard();
    if (prev.theme !== next.theme) nativeTheme.themeSource = next.theme;
    if (prev.startWithWindows !== next.startWithWindows) {
      app.setLoginItemSettings({ openAtLogin: next.startWithWindows, args: ['--hidden'] });
    }
    return next;
  });

  ipcMain.handle('dl:list', () => manager.list());

  ipcMain.handle('dl:probe', async (_, { url, headers, mode }) => {
    // 1) Eğer doğrudan uzantılı bir dosya ise (film, zip, pdf, exe vb.) hemen HTTP probe yap
    if (mode === 'file' || (mode !== 'media' && looksDownloadable(url))) {
      const p = await probe(url, headers);
      const category = categorize(p.filename, p.mime);
      return { kind: 'file', ...p, category, dir: categoryDir(category) };
    }
    // 2) Medya sitesi (YouTube, Vimeo vb.) veya media modunda ise doğrudan medya bilgisi al
    if (mode === 'media' || isMediaSite(url)) {
      const info = await ytdlp.getInfo(url, headers);
      return { kind: 'media', ...info, dirVideo: categoryDir('video'), dirAudio: categoryDir('audio') };
    }
    // 3) Diğer bağlantılarda HTTP probe yap, eğer HTML ise fallback olarak yt-dlp dene
    const p = await probe(url, headers);
    if (/text\/html/i.test(p.mime)) {
      try {
        const info = await ytdlp.getInfo(url, headers);
        return { kind: 'media', ...info, dirVideo: categoryDir('video'), dirAudio: categoryDir('audio'), fallback: p };
      } catch {}
    }
    const category = categorize(p.filename, p.mime);
    return { kind: 'file', ...p, category, dir: categoryDir(category) };
  });

  ipcMain.handle('dl:categoryFor', (_, { filename, mime }) => {
    const category = categorize(filename, mime);
    return { category, dir: categoryDir(category) };
  });

  ipcMain.handle('dl:add', (_, opts) => manager.add(opts));
  ipcMain.handle('dl:pause', (_, id) => manager.pause(id));
  ipcMain.handle('dl:resume', (_, id) => manager.resume(id));
  ipcMain.handle('dl:remove', (_, id, deleteFile) => manager.remove(id, deleteFile));
  ipcMain.handle('dl:pauseAll', () => manager.pauseAll());
  ipcMain.handle('dl:resumeAll', () => manager.resumeAll());
  ipcMain.handle('dl:clearCompleted', () => manager.clearCompleted());

  ipcMain.handle('shell:openFile', async (_, id) => {
    const it = manager.get(id);
    if (it && it.filePath && fs.existsSync(it.filePath)) return shell.openPath(it.filePath);
    return 'Dosya bulunamadı';
  });
  ipcMain.handle('shell:showInFolder', (_, id) => {
    const it = manager.get(id);
    if (!it) return;
    if (it.filePath && fs.existsSync(it.filePath)) shell.showItemInFolder(it.filePath);
    else if (it.dir) {
      fs.mkdirSync(it.dir, { recursive: true });
      shell.openPath(it.dir);
    }
  });
  ipcMain.handle('shell:openCategory', (_, cat) => {
    const dir = cat ? categoryDir(cat) : settings.get().baseDir;
    fs.mkdirSync(dir, { recursive: true });
    return shell.openPath(dir);
  });
  ipcMain.handle('shell:openExternal', (_, url) => (isWebUrl(url) ? shell.openExternal(url) : undefined));
  ipcMain.handle('shell:openPath', (_, p) => shell.openPath(p));
  ipcMain.handle('clipboard:read', () => clipboard.readText());

  ipcMain.handle('dialog:pickDir', async (_, defaultPath) => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], defaultPath });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('ytdlp:update', async () => {
    await ytdlp.ensureYtdlp(true);
    return ytdlp.getVersion();
  });
  ytdlp.events.on('install-progress', (p) => send('ytdlp:install', p));
}

// ---------- Başlangıç ----------
app.whenReady().then(() => {
  settings = new SettingsStore(path.join(app.getPath('userData'), 'settings.json'), getDefaults());
  nativeTheme.themeSource = settings.get().theme;
  manager = new DownloadManager(settings, path.join(app.getPath('userData'), 'downloads.json'));

  // Güncellemeleri 100 ms'lik pencerelerde topla: her indirme için ayrı IPC + yeniden çizim yerine tek mesaj
  const pending = new Map();
  let flushTimer = null;
  manager.on('update', (s) => {
    pending.set(s.id, s);
    if (!flushTimer) {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        const batch = [...pending.values()];
        pending.clear();
        if (batch.length) send('dl:updates', batch);
      }, 100);
    }
  });
  manager.on('removed', (id) => {
    pending.delete(id); // silinen öğe bekleyen bir güncellemeyle geri gelmesin
    send('dl:removed', id);
  });
  manager.on('completed', (s) => {
    send('dl:completed', s);
    if (settings.get().notifications && Notification.isSupported()) {
      const tr = settings.get().language === 'tr';
      const n = new Notification({
        title: tr ? 'İndirme tamamlandı' : 'Download complete',
        body: s.filename,
        icon: iconImage,
      });
      n.on('click', () => s.filePath && shell.showItemInFolder(s.filePath));
      n.show();
    }
  });

  nativeTheme.on('updated', () => {
    if (win && !win.isDestroyed()) {
      try {
        win.setTitleBarOverlay(overlayColors());
      } catch {}
      send('theme:changed', nativeTheme.shouldUseDarkColors);
    }
  });

  registerIpc();
  createWindow();
  createTray();
  setupClipboard();
  startBridge(settings.get().bridgePort, onBridgeAdd, appInfo);
});

app.on('second-instance', showWindow);
app.on('before-quit', () => {
  quitting = true;
  if (manager) manager.shutdown();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && quitting) app.quit();
});
