// Bundles: a single-file HTML book, and the reader APK with books baked in as assets.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO } from '../lib/config.js';
import { writeBytes } from '../lib/store.js';

/** One self-contained HTML file: the view composites inlined, tap right to go forward, left to go back. */
export function bundleHtml(store, slug, { out } = {}) {
  const book = store.book(slug);
  const manifest = JSON.parse(fs.readFileSync(store.out(slug, 'book.json'), 'utf8'));
  const keys = ['cover', ...manifest.pages.map(p => p.image.replace(/\.webp$/, ''))];
  const imgs = keys.map(k => 'data:image/webp;base64,' + fs.readFileSync(store.view(slug, `${k}.webp`)).toString('base64'));
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(book.title)}</title>
<style>html,body{margin:0;height:100%;background:#1b1a18;color:#ddd;font:14px system-ui}#page{height:100%;display:grid;place-items:center;cursor:pointer;user-select:none}
img{max-height:100%;max-width:100%;aspect-ratio:1072/1448;object-fit:contain}#n{position:fixed;left:50%;bottom:8px;transform:translateX(-50%);opacity:.6}</style>
<div id="page"><img id="im" alt=""></div><div id="n"></div>
<script>const imgs=${JSON.stringify(imgs)};const title=${JSON.stringify(book.title)};let i=0;
function show(){document.getElementById('im').src=imgs[i];document.getElementById('n').textContent=i?i+' / '+(imgs.length-1):title;}
function go(d){i=Math.max(0,Math.min(imgs.length-1,i+d));show();}
document.getElementById('page').onclick=e=>go(e.clientX<innerWidth/3?-1:1);
addEventListener('keydown',e=>{if(e.key==='ArrowRight'||e.key===' ')go(1);if(e.key==='ArrowLeft')go(-1);});show();</script></html>`;
  const file = out || store.work(slug, `${slug}.html`);
  writeBytes(file, html);
  return { file, bytes: html.length };
}

/** Copy every packaged book's device folder into the app's assets and build the debug APK. */
export function bundleApk(store, { appDir = path.join(REPO, 'app'), log = () => {}, build = true } = {}) {
  const catalog = store.catalog();
  if (!catalog) throw new Error('no catalog.json: run publish first');
  const assets = path.join(appDir, 'app', 'src', 'main', 'assets', 'books');
  fs.rmSync(assets, { recursive: true, force: true });
  for (const b of catalog.books) {
    const dir = store.out(b.slug);
    for (const f of b.files) writeBytes(path.join(assets, b.slug, f), fs.readFileSync(path.join(dir, f)));
  }
  writeBytes(path.join(assets, 'catalog.json'), JSON.stringify(catalog, null, 1));
  log(`assets: ${catalog.books.length} books copied into ${assets}`);
  if (!build) return { assets };
  const r = spawnSync('./gradlew', ['-q', 'assembleDebug'], { cwd: appDir, stdio: 'inherit' });
  if (r.status !== 0) throw new Error('gradle build failed');
  const apk = path.join(appDir, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
  log(`apk: ${apk} (${(fs.statSync(apk).size / 1e6).toFixed(1)} MB)`);
  return { assets, apk };
}
