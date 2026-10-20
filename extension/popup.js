const TR = (navigator.language || '').toLowerCase().startsWith('tr');
const T = TR
  ? { on: 'Uygulamaya bağlı', off: 'Uygulama çalışmıyor', sent: 'Gönderildi ✓', fail: 'Gönderilemedi', intercept: 'Tarayıcı indirmelerini yakala', floating: 'Video üstünde "İndir" butonu', min: 'Şundan küçükleri yakalama (MB)', video: 'Bu sayfadaki videoyu indir', audio: 'Sadece sesi indir (MP3)' }
  : { on: 'Connected to app', off: 'App is not running', sent: 'Sent ✓', fail: 'Failed to send', intercept: 'Capture browser downloads', floating: 'Show floating download button', min: 'Ignore files smaller than (MB)', video: 'Download video on this page', audio: 'Download audio only (MP3)' };

const $ = (id) => document.getElementById(id);
$('lblIntercept').textContent = T.intercept;
$('lblFloating').textContent = T.floating;
$('lblMin').textContent = T.min;
$('grabVideo').textContent = T.video;
$('grabAudio').textContent = T.audio;

chrome.storage.local.get({ enabled: true, minSizeMB: 0, showFloatingBtn: true }, (r) => {
  $('enabled').checked = r.enabled;
  $('minSize').value = r.minSizeMB;
  $('showFloatingBtn').checked = r.showFloatingBtn;
});
$('enabled').addEventListener('change', (e) => chrome.storage.local.set({ enabled: e.target.checked }));
$('showFloatingBtn').addEventListener('change', (e) => chrome.storage.local.set({ showFloatingBtn: e.target.checked }));
$('minSize').addEventListener('change', (e) => chrome.storage.local.set({ minSizeMB: Math.max(0, +e.target.value || 0) }));

chrome.runtime.sendMessage({ type: 'ping' }, (r) => {
  const ok = r && r.ok;
  $('status').textContent = ok ? T.on : T.off;
  $('status').className = 'status ' + (ok ? 'on' : 'off');
  $('grabVideo').disabled = $('grabAudio').disabled = !ok;
});

// Yakalanan akışları listele
chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  if (!tab) return;
  chrome.runtime.sendMessage({ type: 'getStreams', tabId: tab.id }, (r) => {
    const list = r?.streams || [];
    if (!list.length) return;
    $('streamsSection').style.display = 'block';
    $('streamsTitle').textContent = TR ? `Yakalanan Medyalar (${list.length}):` : `Detected Media (${list.length}):`;
    const box = $('streamsList');
    box.innerHTML = '';
    list.forEach((s) => {
      const item = document.createElement('div');
      item.className = 'stream-item';
      // URL'ler ağdan gelir: innerHTML yerine textContent ile güvenle yaz
      const type = document.createElement('div');
      type.className = 'stream-type';
      type.textContent = s.type;
      const url = document.createElement('div');
      url.className = 'stream-url';
      url.title = s.url;
      url.textContent = s.url;
      const dl = document.createElement('button');
      dl.className = 'stream-dl';
      dl.type = 'button';
      dl.textContent = TR ? 'İndir' : 'Download';
      item.append(type, url, dl);
      dl.addEventListener('click', () => {
        chrome.runtime.sendMessage(
          {
            type: 'send',
            payload: { url: s.url, title: tab.title || '', referrer: tab.url, mode: 'media' },
          },
          () => window.close()
        );
      });
      box.appendChild(item);
    });
  });
});

async function grab(btn, choice) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https?:/i.test(tab.url)) return;
  chrome.runtime.sendMessage({ type: 'downloadMedia', tabId: tab.id, payload: { url: tab.url, referrer: tab.url, pageUrl: tab.url, title: tab.title || '', choice } }, () => {
    window.close();
  });
}
$('grabVideo').addEventListener('click', (e) => grab(e.target));
$('grabAudio').addEventListener('click', (e) => grab(e.target, 'audio'));
