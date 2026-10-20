// Tarayıcı eklentisi köprüsü: 127.0.0.1 üzerinde küçük bir HTTP sunucusu
const http = require('http');

function isAllowedOrigin(origin) {
  if (!origin) return true; // eklenti service worker'ları bazen Origin göndermez
  return /^(chrome-extension|moz-extension|extension|ms-browser-extension):\/\//i.test(origin);
}

function startBridge(port, onAdd, appInfo) {
  const server = http.createServer((req, res) => {
    const origin = req.headers.origin;
    if (!isAllowedOrigin(origin)) {
      res.writeHead(403);
      return res.end();
    }
    const cors = origin ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Content-Type' } : {};
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'GET, POST' });
      return res.end();
    }
    const send = (code, obj) => {
      res.writeHead(code, { 'Content-Type': 'application/json', ...cors });
      res.end(JSON.stringify(obj));
    };
    if (req.method === 'GET' && req.url === '/ping') return send(200, { ok: true, ...appInfo() });
    if (req.method === 'POST' && req.url === '/add') {
      let body = '';
      req.on('data', (c) => {
        body += c;
        if (body.length > 2 * 1024 * 1024) req.destroy();
      });
      req.on('end', () => {
        try {
          const data = JSON.parse(body || '{}');
          const list = Array.isArray(data.items) ? data.items : [data];
          const valid = list.filter((d) => d && typeof d.url === 'string' && /^https?:\/\//i.test(d.url));
          if (!valid.length) return send(400, { ok: false, error: 'url gerekli' });
          for (const d of valid) onAdd(d);
          send(200, { ok: true });
        } catch (e) {
          send(400, { ok: false, error: 'geçersiz JSON' });
        }
      });
      return;
    }
    send(404, { ok: false });
  });
  server.on('error', (e) => console.error('Köprü sunucusu başlatılamadı:', e.message));
  server.listen(port, '127.0.0.1');
  return server;
}

module.exports = { startBridge };
