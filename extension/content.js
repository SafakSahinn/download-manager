// Flux Download Manager — Shadow DOM Korumalı Yüzen İndirme Butonu
(() => {
  // YouTube gibi platformlarda video ortasında veya kontrollerinde yüzen butona gerek yok; kullanıcı eklentiye tıklayarak indirir
  const isYouTube = /(?:youtube\.com|youtu\.be)/i.test(window.location.hostname || '');
  if (isYouTube) return;

  const TR = (navigator.language || '').toLowerCase().startsWith('tr');
  const BTN_TEXT = TR ? 'İndir' : 'Download';

  let showFloatingBtn = true;
  chrome.storage?.local?.get({ showFloatingBtn: true }, (r) => {
    if (!r) return;
    showFloatingBtn = r.showFloatingBtn;
    // Kayıtlı ayar "kapalı" ise ilk taramada eklenen butonları gizle
    if (!showFloatingBtn) {
      document.querySelectorAll('[data-flux-container]').forEach((el) => (el.style.display = 'none'));
    }
  });
  chrome.storage?.onChanged?.addListener((changes) => {
    if (changes.showFloatingBtn) {
      showFloatingBtn = changes.showFloatingBtn.newValue;
      document.querySelectorAll('[data-flux-container]').forEach((el) => {
        el.style.display = showFloatingBtn ? 'block' : 'none';
      });
      // Buton kapalıyken eklenmemiş videolara da şimdi ekle
      if (showFloatingBtn) scan();
    }
  });

  const attached = new WeakSet();

  function attachToVideo(video) {
    if (!showFloatingBtn) return;
    if (!video || attached.has(video)) return;
    attached.add(video);

    // Dış sitelerin CSS'inden 100% korumalı Shadow DOM host
    const host = document.createElement('div');
    host.setAttribute('data-flux-container', 'true');
    host.style.cssText = [
      'position: absolute !important',
      'top: 12px !important',
      'right: 12px !important',
      'z-index: 2147483647 !important',
      'pointer-events: auto !important',
      'width: auto !important',
      'height: auto !important',
      'padding: 0 !important',
      'margin: 0 !important',
      'border: none !important',
      'display: block !important',
      'opacity: 1 !important',
      'visibility: visible !important'
    ].join(';');

    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      :host {
        all: initial !important;
        position: absolute !important;
        top: 12px !important;
        right: 12px !important;
        z-index: 2147483647 !important;
        display: block !important;
      }
      .flux-btn {
        all: initial !important;
        box-sizing: border-box !important;
        display: inline-flex !important;
        align-items: center !important;
        gap: 6px !important;
        height: 32px !important;
        padding: 0 12px !important;
        background: linear-gradient(135deg, #4f46e5 0%, #06b6d4 100%) !important;
        color: #ffffff !important;
        border: 1px solid rgba(255, 255, 255, 0.45) !important;
        border-radius: 6px !important;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.55) !important;
        cursor: pointer !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
        font-size: 13px !important;
        font-weight: 700 !important;
        line-height: 30px !important;
        white-space: nowrap !important;
        user-select: none !important;
        opacity: 0.95 !important;
        transition: transform 0.15s, opacity 0.15s !important;
      }
      .flux-btn:hover {
        opacity: 1 !important;
        transform: translateY(-1px) scale(1.03) !important;
      }
      .flux-btn svg {
        all: initial !important;
        width: 16px !important;
        height: 16px !important;
        fill: #ffffff !important;
        flex-shrink: 0 !important;
        display: inline-block !important;
      }
      .flux-btn span {
        all: initial !important;
        color: #ffffff !important;
        font-family: inherit !important;
        font-size: 13px !important;
        font-weight: 700 !important;
        line-height: 1 !important;
        white-space: nowrap !important;
      }
    `;

    const btn = document.createElement('button');
    btn.className = 'flux-btn';
    btn.type = 'button';
    btn.title = 'Flux Download Manager ile İndir';
    btn.innerHTML = `
      <svg viewBox="0 0 24 24">
        <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/>
      </svg>
      <span>${BTN_TEXT}</span>
    `;

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      let title = document.title || 'Video';
      title = title.replace(/\s*[-|•].*$/, '').trim();

      let videoSrc = video.currentSrc || video.src || '';
      if (videoSrc.startsWith('blob:')) videoSrc = '';

      chrome.runtime.sendMessage({
        type: 'downloadMedia',
        payload: {
          url: videoSrc || window.location.href,
          pageUrl: window.location.href,
          title: title,
          referrer: window.location.href,
        },
      });

      btn.style.opacity = '0.5';
      setTimeout(() => (btn.style.opacity = '0.95'), 1500);
    });

    shadow.appendChild(style);
    shadow.appendChild(btn);

    function placeHost() {
      // Eğer video görünür değilse veya boyutu çok küçükse (reklam tracking pikselleri) atla
      const rect = video.getBoundingClientRect();
      if (rect.width < 140 || rect.height < 90) return;

      // Oynatıcı kapsayıcısını bul
      let target = video.parentElement;
      while (target && target !== document.body && target !== document.documentElement) {
        const cs = window.getComputedStyle(target);
        if (cs.position === 'relative' || cs.position === 'absolute' || target.classList.contains('jwplayer') || target.classList.contains('dplayer') || target.classList.contains('video-js') || target.id.includes('player')) {
          break;
        }
        if (target.parentElement) target = target.parentElement;
        else break;
      }
      if (!target) target = video.parentElement || document.body;

      const cs = window.getComputedStyle(target);
      if (cs.position === 'static') {
        target.style.position = 'relative';
      }

      if (!target.contains(host)) {
        target.appendChild(host);
      }
    }

    placeHost();
    video.addEventListener('play', placeHost);
    video.addEventListener('playing', placeHost);
    video.addEventListener('loadedmetadata', placeHost);
    video.addEventListener('canplay', placeHost);

    const checkInterval = setInterval(() => {
      if (!video.isConnected) {
        clearInterval(checkInterval);
        host.remove();
        return;
      }
      placeHost();
    }, 1000);
  }

  function scan() {
    const vids = document.querySelectorAll('video');
    vids.forEach(attachToVideo);
  }

  // Yoğun DOM değişikliklerinde (sonsuz kaydırma vb.) her mutasyonda tüm sayfayı taramamak için birleştir
  let scanQueued = false;
  function queueScan() {
    if (scanQueued) return;
    scanQueued = true;
    setTimeout(() => {
      scanQueued = false;
      scan();
    }, 300);
  }

  scan();
  const obs = new MutationObserver(queueScan);
  obs.observe(document.documentElement, { childList: true, subtree: true });
})();
