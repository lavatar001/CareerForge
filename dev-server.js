// Local dev server — serves the static site and runs /api/* handlers the way
// Vercel does, so the full flow works without the Vercel CLI.
// Usage: fill in .env.local, then `npm run dev` → http://localhost:5173
// Not deployed: Vercel serves /api itself in production.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 5173;
const MAX_BODY = 10 * 1024 * 1024;

// ─── Env (.env.local, then .env) ──────────────────────────────────────

for (const file of ['.env.local', '.env']) {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) continue;
  for (const line of fs.readFileSync(full, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

const REQUIRED = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY'];
const missing = REQUIRED.filter((k) => !process.env[k]);

// ─── Static files ─────────────────────────────────────────────────────

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

// Never serve secrets, server code or dependencies as static files.
const BLOCKED = /^[\\/](\.env|\.git|\.claude|node_modules|api|sql|dev-server\.js|package(-lock)?\.json)([\\/.]|$)/;

function serveStatic(pathname, res) {
  // cleanUrls: /app → app.html, / → index.html
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }
  if (rel.endsWith('/')) rel += 'index.html';
  let file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT) || BLOCKED.test(file.slice(ROOT.length))) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
    return;
  }
  if (!path.extname(file) && fs.existsSync(`${file}.html`)) file = `${file}.html`;
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  });
}

// ─── API (Vercel-style req/res) ───────────────────────────────────────

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('Body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function withVercelHelpers(res) {
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    if (!res.headersSent) res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(payload));
    return res;
  };
  res.send = (payload) => {
    if (typeof payload === 'object' && !Buffer.isBuffer(payload)) return res.json(payload);
    res.end(payload);
    return res;
  };
  return res;
}

function resolveHandler(pathname) {
  const rel = pathname.replace(/^\/api\//, '').replace(/\/$/, '');
  if (!rel || rel.split('/').some((seg) => seg.startsWith('_') || seg.startsWith('.'))) return null;
  const apiRoot = path.join(ROOT, 'api');
  for (const candidate of [`${rel}.js`, `${rel}/index.js`]) {
    const full = path.normalize(path.join(apiRoot, candidate));
    if (full.startsWith(apiRoot) && fs.existsSync(full)) return full;
  }
  return null;
}

async function handleApi(req, res, url) {
  withVercelHelpers(res);
  res.setHeader('Cache-Control', 'no-store');

  const file = resolveHandler(url.pathname);
  if (!file) {
    res.status(404).json({ ok: false, error: 'Not found.', code: 'NOT_FOUND' });
    return;
  }
  if (missing.length) {
    res.status(500).json({
      ok: false,
      error: `Local API is not configured — add ${missing.join(', ')} to .env.local and restart the dev server.`,
      code: 'NOT_CONFIGURED',
    });
    return;
  }

  try {
    const raw = await readBody(req);
    const type = req.headers['content-type'] || '';
    req.body = raw && type.includes('application/json') ? JSON.parse(raw) : raw || undefined;
  } catch {
    res.status(400).json({ ok: false, error: 'Invalid request body.', code: 'BAD_REQUEST' });
    return;
  }
  req.query = Object.fromEntries(url.searchParams);

  try {
    const mod = await import(pathToFileURL(file).href);
    await mod.default(req, res);
  } catch (err) {
    console.error(`[api] ${url.pathname} failed:`, err);
    if (!res.headersSent) res.status(500).json({ ok: false, error: 'Something went wrong.', code: 'INTERNAL' });
  }
}

// ─── Server ───────────────────────────────────────────────────────────

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) {
      handleApi(req, res, url);
      return;
    }
    serveStatic(url.pathname, res);
  })
  .listen(PORT, () => {
    console.log(`CareerForge dev server → http://localhost:${PORT}`);
    if (missing.length) console.warn(`Missing in .env.local: ${missing.join(', ')} — /api/* will return NOT_CONFIGURED.`);
  });
