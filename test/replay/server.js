// Dev-only replay server: serves the saved Forum pages from page_grabs/ and
// answers /api/* from the recorded HAR files, over HTTPS on 127.0.0.1:8443.
// Chrome is pointed at it with --host-resolver-rules (see run.js).
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..', 'page_grabs');
const CERT_DIR = process.env.FGH_CERT_DIR;
const PORT = Number(process.env.FGH_PORT || 8443);

const MIME = { '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.html': 'text/html', '.htm': 'text/html', '.woff': 'font/woff', '.woff2': 'font/woff2', '.json': 'application/json' };

// Page routes: which saved page to serve for which URL path.
const PAGES = [
  { re: /^\/app\/courses\/\d+\/sections\/\d+\/classes\/\d+\/review(\/\d+)?$/, file: 'Class Poll Scoring.htm' },
  { re: /^\/app\/courses\/\d+\/sections\/\d+\/classes\/\d+$/, file: 'Class Assessment Page Entrance.html' },
  { re: /^\/app\/assignments\/\d+$/, file: 'Assignment Scoring Entrance.htm' },
  { re: /^\/app\/assignment-grader\/\d+(\/.*)?$/, file: 'Assignment Scoring.htm' },
];

// Index of every recorded response, from all HARs (first wins):
//   api:    "METHOD path?query" -> response   (forum.minerva.edu /api/*)
//   assets: "host/path"         -> response   (bundles, fonts, icons, ...)
const api = new Map();
const assets = new Map();
for (const name of fs.readdirSync(ROOT).filter((f) => f.endsWith('.har'))) {
  const har = JSON.parse(fs.readFileSync(path.join(ROOT, name), 'utf8'));
  for (const e of har.log.entries) {
    const u = new URL(e.request.url);
    const c = e.response.content || {};
    if (c.text == null) continue;
    let body = c.text;
    if (c.encoding === 'base64') body = Buffer.from(body, 'base64');
    const rec = { status: e.response.status, type: c.mimeType || 'application/octet-stream', body };
    if (u.pathname.startsWith('/api/')) {
      const key = e.request.method + ' ' + u.pathname + u.search;
      if (!api.has(key)) api.set(key, rec);
    } else if (e.request.method === 'GET' && e.response.status === 200) {
      const key = u.host + u.pathname;
      if (!assets.has(key)) assets.set(key, rec);
    }
  }
}
// "Webpage, Complete" saves sometimes truncate the *_files folder name in the
// HTML; resolve by suffix.
const fileDirs = fs.readdirSync(ROOT).filter((f) => f.endsWith('_files'));

function findApi(method, pathname, search) {
  return api.get(method + ' ' + pathname + search) || api.get(method + ' ' + pathname) ||
    [...api.entries()].find(([k]) => k.startsWith(method + ' ' + pathname + '?'))?.[1] || null;
}

const server = https.createServer({ key: fs.readFileSync(path.join(CERT_DIR, 'key.pem')), cert: fs.readFileSync(path.join(CERT_DIR, 'cert.pem')) }, (req, res) => {
  const u = new URL(req.url, 'https://forum.minerva.edu');
  const p = decodeURIComponent(u.pathname);
  if (p.startsWith('/api/')) {
    const hit = findApi(req.method, p, u.search);
    if (!hit) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end('{"error":"not recorded"}'); }
    res.writeHead(hit.status, { 'content-type': hit.type });
    return res.end(hit.body);
  }
  const files = /\/([^/]+_files)\/([^/]+)$/.exec(p);
  if (files) {
    const dir = fileDirs.find((d) => d === files[1]) || fileDirs.find((d) => d.endsWith(files[1]));
    const f = dir && path.join(ROOT, dir, files[2]);
    if (f && fs.existsSync(f)) { res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'access-control-allow-origin': '*' }); return res.end(fs.readFileSync(f)); }
    res.writeHead(404); return res.end('not found');
  }
  const host = (req.headers.host || 'forum.minerva.edu').replace(/:\d+$/, '');
  const page = host === 'forum.minerva.edu' && PAGES.find((x) => x.re.test(p));
  if (page) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(fs.readFileSync(path.join(ROOT, page.file))); }
  const asset = assets.get(host + p);
  if (asset) { res.writeHead(asset.status, { 'content-type': asset.type, 'access-control-allow-origin': '*' }); return res.end(asset.body); }
  res.writeHead(404); res.end('not found');
});

server.listen(PORT, '127.0.0.1', () => console.log(`replay server on https://127.0.0.1:${PORT} (${api.size} API responses, ${assets.size} assets)`));
module.exports = server;
