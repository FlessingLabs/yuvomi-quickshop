/**
 * QuickShop-Sidecar - Startpunkt. Konfiguration ausschliesslich ueber die Umgebung.
 */

import path from 'node:path';
import { openStore } from './store.js';
import { createAuthResolver } from './auth.js';
import { createServer, PREFIX } from './server.js';
import { createPassThrough } from './proxy.js';

const port = Number(process.env.PORT || 8080);
const dataDir = process.env.DATA_DIR || '/data';
const yuvomiUrl = process.env.YUVOMI_URL || 'http://yuvomi:3000';
const publicOrigins = (process.env.PUBLIC_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);

const store = openStore(path.join(dataDir, 'quickshop.db'));
const resolveAuth = createAuthResolver({
  yuvomiUrl,
  sessionCookie: process.env.YUVOMI_SESSION_COOKIE || 'yuvomi.sid',
  cacheMs: Number(process.env.AUTH_CACHE_MS || 5000),
});

// Standard: der Dienst ist zugleich der Eingang fuer Yuvomi. Wer schon einen
// eigenen Reverse-Proxy hat, schaltet das mit PROXY_YUVOMI=false ab.
const proxyYuvomi = process.env.PROXY_YUVOMI !== 'false';
const passThrough = proxyYuvomi ? createPassThrough(yuvomiUrl) : null;

const server = createServer({ store, resolveAuth, publicOrigins, passThrough });
server.listen(port, () => {
  console.log(`[quickshop] listening on :${port}${PREFIX}, Yuvomi at ${yuvomiUrl}${proxyYuvomi ? ' (proxying all other paths to it)' : ''}`);
});

function shutdown() {
  server.close(() => {
    store.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
