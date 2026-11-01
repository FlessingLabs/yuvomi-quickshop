// Entwicklungs-Proxy, verhaelt sich wie die Caddyfile: Prefix -> Sidecar, Rest -> Yuvomi. Nur fuer Tests.
import http from 'node:http';

const [, , listenPort, yuvomiPort, sidecarPort] = process.argv;
const PREFIX = '/api/extensions/flessinglabs-quickshop/';

http.createServer((req, res) => {
  const port = req.url.startsWith(PREFIX) ? sidecarPort : yuvomiPort;
  const headers = {
    ...req.headers,
    'x-forwarded-for': req.socket.remoteAddress,
    'x-forwarded-host': req.headers.host,
    'x-forwarded-proto': 'http',
  };
  const up = http.request({ host: '127.0.0.1', port, method: req.method, path: req.url, headers }, (r) => {
    res.writeHead(r.statusCode, r.headers);
    r.pipe(res);
  });
  up.on('error', () => { res.writeHead(502); res.end('bad gateway'); });
  req.pipe(up);
}).listen(Number(listenPort), '127.0.0.1', () => console.log(`proxy :${listenPort}`));
