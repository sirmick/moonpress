#!/usr/bin/env node
// moonpress: makes illustrated picture books for the Nighttime Books reader.
import { parseArgs } from 'node:util';
import fs from 'node:fs';
import { config } from './lib/config.js';
import { openStore } from './lib/store.js';
import { OpenRouter, readKey, BudgetExceeded } from './lib/openrouter.js';
import { loadPrompts } from './lib/prompts.js';
import { log, usd } from './lib/log.js';
import { pageKeys } from './lib/book.js';
import { importLegacy } from './passes/import.js';
import { planSeries } from './passes/plan.js';
import { writeBook, pagesToWrite } from './passes/write.js';
import { drawBook } from './passes/draw.js';
import { inspectBook } from './passes/inspect.js';
import { packageBook, packageable } from './passes/package.js';
import { publish } from './passes/publish.js';
import { bundleHtml, bundleApk } from './passes/bundle.js';

const USAGE = `moonpress: makes illustrated picture books for the Nighttime Books reader

  moonpress plan    <series>            pass 1: book headers for the books a series wants
  moonpress write   <series|slug>       pass 2: page text and beats
  moonpress draw    <series|slug>       pass 3: pictures (missing ones; --redo p03,p07; --force)
  moonpress inspect <series|slug>       pass 4: look at every page, fix cheap things, propose regens (--auto to apply)
  moonpress package <series|slug>       device folders and composites
  moonpress publish                     package what is stale, write catalog.json
  moonpress all     <series|slug>       write, draw, inspect --auto, package
  moonpress status  [series|slug]       what is missing, stale, or unpublished
  moonpress bundle  html <slug> | apk   one-file HTML book, or the reader APK with every book inside
  moonpress import  <kids-bookgen dir>  one-off migration of the old checkout
  moonpress serve                       editor server (web/ + JSON API)

  --content <dir>   Nightstand checkout (default: $NIGHTSTAND or ./sample)
  --budget <usd>    stop before spending more than this in one run (default 5)
  --dry-run         print prompts and estimates, spend nothing
  --only a,b        restrict to these image keys (char, cover, p01…)
  --redo a,b        draw these again, keeping the old picture as a candidate
  --force           ignore stamps and redo everything in the pass
  --auto            inspect: apply edits and regens, not just propose them
  --max-regens n    inspect: regens per page (default 1)
  --candidates n    plan: how many plans to generate (first is used)
  --model-text / --model-vision / --model-image <id>
  --workers n       parallel image calls (default 3)
  --out <file>      bundle html: where to write
  --port n          serve: port (default 8787)
`;

const { values: f, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    content: { type: 'string' }, budget: { type: 'string' }, 'dry-run': { type: 'boolean' }, only: { type: 'string' },
    redo: { type: 'string' }, force: { type: 'boolean' }, auto: { type: 'boolean' }, 'max-regens': { type: 'string' },
    candidates: { type: 'string' }, 'model-text': { type: 'string' }, 'model-vision': { type: 'string' }, 'model-image': { type: 'string' },
    workers: { type: 'string' }, out: { type: 'string' }, port: { type: 'string' }, help: { type: 'boolean', short: 'h' },
  },
});
const [cmd, ...args] = positionals;
if (!cmd || f.help) { console.log(USAGE); process.exit(cmd ? 0 : 1); }

const cfg = config({ content: f.content, budget: f.budget && +f.budget, modelText: f['model-text'], modelVision: f['model-vision'],
                     modelImage: f['model-image'], workers: f.workers && +f.workers });
const store = openStore(cfg.content);
const prompts = loadPrompts(store);
const or = new OpenRouter({ key: readKey(), budget: cfg.budget, dryRun: !!f['dry-run'], log });
const list = s => s ? s.split(',').map(x => x.trim()).filter(Boolean) : null;
const common = { or, prompts, cfg, log, force: !!f.force };

function slugsOf(target) {
  if (!target) throw new Error('give a series name or a book slug');
  return store.resolve(target).slugs;
}

async function status(target) {
  const slugs = target ? slugsOf(target) : store.listBooks();
  const catalog = store.catalog();
  const rows = slugs.map(slug => {
    const book = store.book(slug), state = store.state(slug), series = store.seriesOf(book);
    const keys = pageKeys(book);
    const have = keys.filter(k => fs.existsSync(store.src(slug, k)));
    const stale = keys.filter(k => state.pages[k]?.image?.stale);
    const toWrite = book.pages.length ? pagesToWrite(book, series, state).length : book.pages.length === 0 ? 'all' : 0;
    const inspected = keys.filter(k => state.pages[k]?.inspect).length;
    const proposed = keys.filter(k => state.pages[k]?.inspect?.verdict === 'proposed');
    const published = catalog?.books.find(b => b.slug === slug)?.hash === state.package?.hash;
    return { slug, series: book.series || '', title: book.title || '(no title)', pages: book.pages.length, write: toWrite,
             images: `${have.length}/${keys.length}`, stale: stale.length, inspected: `${inspected}/${have.length}`,
             proposed: proposed.join(' ') || '', packaged: state.package ? (published ? 'published' : 'yes') : (packageable(store, book) ? 'no' : '-'),
             spent: usd(state.spend) };
  });
  console.table(rows);
  log(`spent this run: ${usd(or.spent)}`);
}

try {
  switch (cmd) {
    case 'import': {
      const from = args[0]; if (!from) throw new Error('import <kids-bookgen dir>');
      const r = await importLegacy(store, from, { log });
      log(`imported ${r.books} books (${r.withPictures} with pictures) into ${store.root}`);
      break;
    }
    case 'plan': await planSeries(store, args[0], { ...common, candidates: +(f.candidates || 1) }); break;
    case 'write': for (const slug of slugsOf(args[0])) await writeBook(store, slug, common); break;
    case 'draw': for (const slug of slugsOf(args[0])) await drawBook(store, slug, { ...common, only: list(f.only), redo: list(f.redo) || [] }); break;
    case 'inspect': for (const slug of slugsOf(args[0])) await inspectBook(store, slug, { ...common, auto: !!f.auto, maxRegens: +(f['max-regens'] || 1), only: list(f.only) }); break;
    case 'package': for (const slug of slugsOf(args[0])) await packageBook(store, slug, { force: !!f.force, log }); break;
    case 'publish': await publish(store, { force: !!f.force, log }); break;
    case 'all':
      for (const slug of slugsOf(args[0])) {
        await writeBook(store, slug, common);
        await drawBook(store, slug, { ...common, only: list(f.only), redo: list(f.redo) || [] });
        await inspectBook(store, slug, { ...common, auto: true, maxRegens: +(f['max-regens'] || 1) });
        await packageBook(store, slug, { log });
      }
      break;
    case 'status': await status(args[0]); break;
    case 'bundle': {
      if (args[0] === 'html') { const r = bundleHtml(store, args[1], { out: f.out }); log(`wrote ${r.file} (${(r.bytes / 1e6).toFixed(1)} MB)`); }
      else if (args[0] === 'apk') bundleApk(store, { log });
      else throw new Error('bundle html <slug> | bundle apk');
      break;
    }
    case 'serve': { const { serve } = await import('./serve.js'); await serve(store, { port: +(f.port || 8787), prompts, cfg, log }); break; }
    default: console.log(USAGE); process.exit(1);
  }
  if (or.spent) log(`spent this run: ${usd(or.spent)} in ${or.calls} calls`);
} catch (e) {
  if (e instanceof BudgetExceeded) { log(`stopped: ${e.message}`); process.exit(3); }
  log(e.stack || String(e)); process.exit(1);
}
