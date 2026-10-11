// Editor server: hosts web/ and a small JSON API over the content checkout. Writes the working tree only.
// The content root is also served statically at /, mirroring the Nightstand Pages layout, so the same
// viewer code works against this server and against the public shelf.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO } from './lib/config.js';
import { blobSha } from './lib/stamp.js';
import { composite, encodeWebp } from './lib/render.js';
import { effective, pageOf, effectiveTextPos, pageKeys } from './lib/book.js';
import { imageJobs } from './lib/prompts.js';
import { markStale } from './lib/images.js';
import { packageBook } from './passes/package.js';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.md': 'text/markdown', '.ttf': 'font/ttf' };

function send(res, code, body, type = 'application/json') {
  const buf = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
  res.end(buf);
}
const json = (res, code, obj) => send(res, code, obj);

function serveFile(res, file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return json(res, 404, { error: 'not found' });
  send(res, 200, fs.readFileSync(file), MIME[path.extname(file)] || 'application/octet-stream');
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

const safe = s => /^[a-z0-9][a-z0-9-]*$/i.test(s) ? s : null;

export async function serve(store, { port = 8787, prompts, cfg, log = () => {} }) {
  const web = path.join(REPO, 'web');

  const server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://x');
      const parts = u.pathname.split('/').filter(Boolean);

      if (req.method === 'OPTIONS') return send(res, 204, '', 'text/plain');
      if (u.pathname === '/' || u.pathname === '/index.html') return serveFile(res, path.join(web, 'index.html'));
      if (parts[0] === 'web') return serveFile(res, path.join(web, ...parts.slice(1).map(p => path.basename(p))));

      if (parts[0] === 'api') {
        const [, what, slug, sub, key] = parts;

        if (what === 'books' && !slug && req.method === 'GET') {
          return json(res, 200, store.listBooks().map(s => {
            const b = store.book(s), st = store.state(s);
            const keys = pageKeys(b);
            return { slug: s, title: b.title, set: b.set || 'bedtime', series: b.series || '', pages: b.pages.length,
                     images: keys.filter(k => fs.existsSync(store.src(s, k))).length, of: keys.length,
                     stale: keys.filter(k => st.pages[k]?.image?.stale).length,
                     proposed: keys.filter(k => st.pages[k]?.inspect?.verdict === 'proposed'),
                     packaged: !!st.package, hash: st.package?.hash || null, spend: st.spend || 0 };
          }));
        }
        if (what === 'series' && req.method === 'GET') return json(res, 200, store.listSeries().map(n => store.series(n)));
        if (what === 'books' && safe(slug) && !sub && req.method === 'GET') {
          const file = store.bookFile(slug);
          if (!fs.existsSync(file)) return json(res, 404, { error: 'no such book' });
          const bytes = fs.readFileSync(file);
          const book = JSON.parse(bytes.toString('utf8')), state = store.state(slug), series = store.seriesOf(book);
          markStale(store, book, series, imageJobs(book, series, prompts, state), state, cfg.modelImage);
          return json(res, 200, { etag: blobSha(bytes), book, state, series, effective: effective(book, series) });
        }
        if (what === 'books' && safe(slug) && !sub && req.method === 'PUT') {
          const file = store.bookFile(slug);
          const current = fs.existsSync(file) ? blobSha(fs.readFileSync(file)) : null;
          const ifMatch = req.headers['if-match'];
          if (current && ifMatch && ifMatch !== current) return json(res, 409, { error: 'the book changed on disk; reload and try again', etag: current });
          let book;
          try { book = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: 'bad JSON' }); }
          if (book.slug !== slug || !Array.isArray(book.pages)) return json(res, 400, { error: 'slug mismatch or no pages' });
          store.writeBook(slug, book);
          return json(res, 200, { etag: blobSha(fs.readFileSync(file)) });
        }
        if (what === 'books' && safe(slug) && sub === 'override' && req.method === 'DELETE') {
          const state = store.state(slug), k = safe(key);
          if (state.pages[k]?.edit) { delete state.pages[k].edit; store.writeState(slug, state); }
          return json(res, 200, { ok: true });
        }
        if (what === 'books' && safe(slug) && sub === 'preview' && safe(key) && req.method === 'GET') {
          const book = store.book(slug), state = store.state(slug), h = effective(book, store.seriesOf(book));
          const src = store.src(slug, key);
          if (!fs.existsSync(src)) return json(res, 404, { error: 'no picture yet' });
          const page = pageOf(book, key);
          const over = page ? { ...page, text: u.searchParams.get('text') ?? page.text, word: u.searchParams.get('word') ?? page.word } : null;
          const e = state.pages[key]?.edit || {};
          const text_pos = u.searchParams.get('text_pos') || (page ? effectiveTextPos(page, state) : undefined);
          const frame = u.searchParams.get('frame') || h.frame;
          const c = await composite(fs.readFileSync(src), { page: over, set: h.set, text_pos, crop: e.crop, frame });
          return send(res, 200, await encodeWebp(c, 80), 'image/webp');
        }
        if (what === 'books' && safe(slug) && sub === 'package' && req.method === 'POST') {
          const r = await packageBook(store, slug, { force: true, log });
          return json(res, 200, r);
        }
        if (what === 'git' && slug === 'status' && req.method === 'GET') {
          const r = spawnSync('git', ['status', '--short', '.'], { cwd: store.root, encoding: 'utf8' });
          return json(res, 200, { changes: r.stdout.split('\n').filter(Boolean) });
        }
        if (what === 'git' && slug === 'commit' && req.method === 'POST') {
          let body = {}; try { body = JSON.parse(await readBody(req) || '{}'); } catch {}
          const steps = [['add', '-A', '.'], ['commit', '-m', body.message || 'Edit books'], ['push']];
          for (const s of steps) {
            const r = spawnSync('git', s, { cwd: store.root, encoding: 'utf8' });
            if (r.status !== 0) return json(res, 500, { error: `git ${s[0]} failed`, output: r.stdout + r.stderr });
          }
          return json(res, 200, { ok: true });
        }
        return json(res, 404, { error: 'no such endpoint' });
      }

      // Everything else: the content root, read-only (catalog.json, books/<slug>/view/..., series/...).
      const rel = path.normalize(u.pathname).replace(/^(\.\.[/\\])+/, '');
      const file = path.join(store.root, rel);
      if (!file.startsWith(store.root)) return json(res, 403, { error: 'no' });
      return serveFile(res, file);
    } catch (e) {
      log(e.stack || String(e));
      json(res, 500, { error: e.message });
    }
  });

  await new Promise(r => server.listen(port, r));
  log(`moonpress serve: http://localhost:${port}/  (content: ${store.root})`);
  return server;
}
