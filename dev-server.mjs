// Local server: serves public/ with the same rewrites as Netlify and routes /api/* to lib/api.mjs.
// Data is kept in .data/ as JSON files.   Run: npm run dev   then open http://localhost:8888
import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { handle } from './lib/api.mjs';

const PORT = Number(process.env.PORT || 8888);
const ROOT = path.resolve('public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.json': 'application/json', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

const rules = (await fs.readFile(path.join(ROOT, '_redirects'), 'utf8')).split('\n')
  .map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  .map((l) => { const [from, to, code] = l.split(/\s+/); return { from, to, code: Number(code) }; });

function rewrite(p) {
  for (const r of rules) {
    const keys = [];
    const re = new RegExp('^' + r.from.replace(/\*/g, '(.*)').replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
    const m = p.match(re);
    if (!m) continue;
    let to = r.to;
    keys.forEach((k, i) => { to = to.replace(':' + k, m[i + 1]); });
    return { to, code: r.code };
  }
  return null;
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith('/api/')) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const r = await handle(new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body }));
    const headers = {};
    r.headers.forEach((v, k) => { headers[k] = v; });
    res.writeHead(r.status, headers);
    res.end(Buffer.from(await r.arrayBuffer()));
    return;
  }
  let p = decodeURIComponent(url.pathname);
  const rw = rewrite(p);
  if (rw && rw.code === 301) { res.writeHead(301, { location: rw.to }); res.end(); return; }
  if (rw) p = rw.to;
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(ROOT, path.normalize(p));
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  try {
    const data = await fs.readFile(file);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('غير موجود');
  }
}).listen(PORT, () => console.log(`AMAN running on http://localhost:${PORT}`));
