// Flux Download Manager — tarayıcı eklentisi (Manifest V3 service worker)
const BASE = 'http://127.0.0.1:6801';
const TR = (navigator.language || '').toLowerCase().startsWith('tr');
const L = TR
  ? { link: 'Flux ile indir', page: 'Bu sayfadaki videoyu Flux ile indir', audio: 'Sesi MP3 olarak Flux ile indir' }
  : { link: 'Download with Flux', page: 'Download video on this page with Flux', audio: 'Download audio as MP3 with Flux' };

let enabled = true;
let minSizeMB = 0;
const bypass = new Set(); // uygulama ulaşılamazsa tarayıcıya geri verilen URL'ler

chrome.storage.local.get({ enabled: true, minSizeMB: 0 }, (r) => {
  enabled = r.enabled;
  minSizeMB = r.minSizeMB;
});
chrome.storage.onChanged.addListener((c) => {
  if (c.enabled) enabled = c.enabled.newValue;
  if (c.minSizeMB) minSizeMB = c.minSizeMB.newValue;
});

async function ping() {
  try {
    const r = await fetch(BASE + '/ping', { signal: AbortSignal.timeout(900) });
    return r.ok;
  } catch {
    return false;
  }
}

async function cookiesFor(url) {
  try {
    if (/(?:youtube\.com|youtu\.be)/i.test(url || '')) return '';
    const list = await chrome.cookies.getAll({ url });
    return list.map((c) => `${c.name}=${c.value}`).join('; ');
  } catch {
    return '';
  }
}

async function sendToApp(data) {
  try {
    const r = await fetch(BASE + '/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userAgent: navigator.userAgent, cookies: await cookiesFor(data.url), ...data }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

function flashBadge(text, color) {
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), 2500);
}

const basename = (p) => (p || '').split(/[\\/]/).pop() || null;

// ---- Tarayıcı indirmelerini yakala ----
chrome.downloads.onCreated.addListener(async (item) => {
  if (!enabled) return;
  const url = item.finalUrl || item.url;
  if (!/^https?:\/\//i.test(url || '')) return; // blob:, data: vb. tarayıcıda kalır
  if (bypass.has(url)) {
    bypass.delete(url);
    return;
  }
  if (minSizeMB > 0 && item.totalBytes > 0 && item.totalBytes < minSizeMB * 1024 * 1024) return;

  try {
    await chrome.downloads.pause(item.id);
  } catch {}

  if (!(await ping())) {
    try {
      await chrome.downloads.resume(item.id);
    } catch {}
    return;
  }

  try {
    await chrome.downloads.cancel(item.id);
    await chrome.downloads.erase({ id: item.id });
  } catch {}

  const ok = await sendToApp({
    url,
    filename: basename(item.filename),
    referrer: item.referrer || '',
    mime: item.mime || null,
    size: item.totalBytes > 0 ? item.totalBytes : null,
  });
  if (ok) flashBadge('✓', '#10b981');
  else {
    bypass.add(url);
    chrome.downloads.download({ url });
  }
});

// ---- Video & Akış Yakalayıcı (Sniffer) ----
const tabStreams = new Map(); // tabId -> Array of { url, type, title }

// Kelime sınırıyla eşleşir: "bet" → "alphabet", "beta", "between" gibi masum URL'leri elemez
const AD_RE = /(?:^|[^a-z0-9])(?:subaxe|adserver|bet|casino|poker|banner|doubleclick|popunder|pre-roll)(?:[^a-z0-9]|$)/i;

function isAdUrl(u) {
  return AD_RE.test(u || '');
}

function bestStreamFor(tabId) {
  const streams = tabId != null ? tabStreams.get(tabId) || [] : [];
  return streams.find((s) => s.isHls) || streams[0] || null;
}

chrome.webRequest?.onBeforeRequest?.addListener(
  (details) => {
    if (details.tabId < 0) return;
    // Sekme yeni bir sayfaya geçtiğinde önceki sayfanın akışlarını unut
    if (details.type === 'main_frame') {
      tabStreams.delete(details.tabId);
      chrome.action.setBadgeText({ text: '', tabId: details.tabId });
      return;
    }
    if (!enabled) return;
    const url = details.url;
    if (!/^https?:\/\//i.test(url)) return;
    if (isAdUrl(url)) return;

    const isHls = /\.m3u8([?#]|$)/i.test(url);
    const isMp4 = /\.mp4([?#]|$)/i.test(url) && details.type === 'media';

    if (isHls || isMp4) {
      let list = tabStreams.get(details.tabId);
      if (!list) {
        list = [];
        tabStreams.set(details.tabId, list);
      }
      if (!list.some((x) => x.url === url)) {
        list.push({
          url,
          type: isHls ? 'HLS (Dizi / Film)' : 'MP4 Video',
          isHls,
          time: Date.now(),
        });
        // Rozette yakalanan video sayısını göster
        chrome.action.setBadgeBackgroundColor({ color: '#6366f1', tabId: details.tabId });
        chrome.action.setBadgeText({ text: String(list.length), tabId: details.tabId });
      }
    }
  },
  { urls: ['<all_urls>'] }
);

chrome.tabs?.onRemoved?.addListener((tabId) => tabStreams.delete(tabId));

// ---- Sağ tık menüsü ----
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'flux-link', title: L.link, contexts: ['link', 'image', 'video', 'audio'] });
    chrome.contextMenus.create({ id: 'flux-page', title: L.page, contexts: ['page', 'video', 'frame'] });
    chrome.contextMenus.create({ id: 'flux-audio', title: L.audio, contexts: ['page', 'video', 'audio'] });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const pageUrl = info.pageUrl || tab?.url || '';
  const linkUrl = info.linkUrl || info.srcUrl;
  let payload;

  if (info.menuItemId === 'flux-link' && linkUrl && /^https?:/i.test(linkUrl)) {
    // Kullanıcı belirli bir bağlantıya tıkladı: sayfadaki akış yerine o bağlantıyı indir
    payload = { url: linkUrl, referrer: pageUrl };
  } else {
    // Sayfada yakalanmış gerçek dizi/film akışı varsa öncelikle onu kullan
    const best = bestStreamFor(tab?.id);
    const fallback = info.menuItemId === 'flux-page' && info.frameUrl ? info.frameUrl : pageUrl;
    payload = { url: best ? best.url : fallback, referrer: pageUrl, mode: 'media', title: tab?.title || '' };
    if (info.menuItemId === 'flux-audio') payload.choice = 'audio';
  }
  if (!/^https?:/i.test(payload.url || '')) {
    flashBadge('!', '#f43f5e');
    return;
  }
  const ok = await sendToApp(payload);
  flashBadge(ok ? '✓' : '!', ok ? '#10b981' : '#f43f5e');
});

// ---- Popup ve Content script mesajları ----
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg.type === 'ping') {
      sendResponse({ ok: await ping() });
    } else if (msg.type === 'send') {
      sendResponse({ ok: await sendToApp(msg.payload) });
    } else if (msg.type === 'getStreams') {
      const tabId = msg.tabId || sender?.tab?.id;
      const streams = tabId ? tabStreams.get(tabId) || [] : [];
      sendResponse({ streams });
    } else if (msg.type === 'downloadMedia') {
      // Popup'tan gelen mesajda sender.tab yoktur; sekme kimliği mesajla gelir
      const tabId = msg.tabId ?? sender?.tab?.id;
      // Yakalanan en iyi akışı bul (m3u8 veya büyük video)
      const best = bestStreamFor(tabId);
      const ok = await sendToApp({
        url: best ? best.url : msg.payload.url,
        title: msg.payload.title,
        referrer: msg.payload.pageUrl || msg.payload.referrer,
        mode: 'media',
        choice: msg.payload.choice || null,
      });
      sendResponse({ ok });
    } else {
      sendResponse(null);
    }
  })();
  return true;
});
