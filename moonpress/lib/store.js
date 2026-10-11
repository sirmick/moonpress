// The content store: a Nightstand checkout on disk.
//
//   catalog.json                  written by publish
//   house-style.md                optional shelf-wide override of prompts/house-style.md
//   series/<name>.json            authored series
//   series/<name>/state.json      derived series state (shared reference sheets)
//   series/<name>/cast/<Name>.webp, series/<name>/char.webp
//   books/<slug>/book.json        authored
//   books/<slug>/state.json       derived
//   books/<slug>/src/<key>.webp   master images (key: char, cover, p01..)
//   books/<slug>/out/             device folder
//   books/<slug>/view/            composites
//   work/<slug>/                  gitignored scratch
import fs from 'node:fs';
import path from 'node:path';

export const IMAGE_EXT = 'webp';

export function pageKey(n) { return n === 0 ? 'cover' : `p${String(n).padStart(2, '0')}`; }
export function keyPage(key) { return key === 'cover' ? 0 : key === 'char' ? null : parseInt(key.slice(1), 10); }

export function readJson(file, fallback = undefined) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT' && fallback !== undefined) return fallback; throw e; }
}

/** Atomic write: temp file then rename, so a crash never leaves a half-written JSON. */
export function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 1) + '\n');
  fs.renameSync(tmp, file);
}

export function writeBytes(file, buf) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, file);
}

export function exists(file) { return fs.existsSync(file); }

export function blankBook(slug, series) {
  return { slug, series, set: 'bedtime', title: '', character: '', refrain: '', palette: '', sky: '', cover: '', style: '', pages: [] };
}

export function blankPage(n) { return { n, text: '', beat: '', text_pos: 'bottom', word: '' }; }

export function openStore(root) {
  root = path.resolve(root);
  const p = (...xs) => path.join(root, ...xs);
  const store = {
    root,
    path: p,

    // ---- series
    listSeries() {
      const dir = p('series');
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).sort();
    },
    series(name) { return name ? readJson(p('series', `${name}.json`), null) : null; },
    writeSeries(name, obj) { writeJson(p('series', `${name}.json`), obj); },
    seriesState(name) { return readJson(p('series', name, 'state.json'), { v: 1, refs: {} }); },
    writeSeriesState(name, obj) { writeJson(p('series', name, 'state.json'), obj); },
    seriesRef(name, refName) { return p('series', name, refName === 'char' ? 'char.webp' : path.join('cast', `${refName}.webp`)); },
    seriesWork(name, ...xs) { return p('work', 'series', name, ...xs); },

    // ---- books
    listBooks() {
      const dir = p('books');
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir).filter(s => fs.existsSync(p('books', s, 'book.json'))).sort();
    },
    book(slug) { return readJson(p('books', slug, 'book.json'), null); },
    writeBook(slug, obj) { writeJson(p('books', slug, 'book.json'), obj); },
    bookFile(slug) { return p('books', slug, 'book.json'); },
    state(slug) { return readJson(p('books', slug, 'state.json'), { v: 1, pages: {}, spend: 0 }); },
    writeState(slug, obj) { writeJson(p('books', slug, 'state.json'), obj); },
    bookDir(slug) { return p('books', slug); },
    src(slug, key) { return p('books', slug, 'src', `${key}.${IMAGE_EXT}`); },
    out(slug, ...xs) { return p('books', slug, 'out', ...xs); },
    view(slug, ...xs) { return p('books', slug, 'view', ...xs); },
    work(slug, ...xs) { return p('work', slug, ...xs); },

    /** The series a book belongs to, or null. */
    seriesOf(book) { return book?.series ? store.series(book.series) : null; },

    /** Slugs in a series, in the series' declared order, then any stragglers that claim it. */
    booksIn(name) {
      const s = store.series(name);
      const declared = (s?.books || []).map(b => typeof b === 'string' ? b : b.slug);
      const claimed = store.listBooks().filter(slug => store.book(slug)?.series === name && !declared.includes(slug));
      return [...declared.filter(slug => fs.existsSync(p('books', slug, 'book.json'))), ...claimed];
    },

    /** Resolve a target argument: a series name or a book slug, to a list of slugs. */
    resolve(target) {
      if (!target) throw new Error('give a series name or a book slug');
      if (store.series(target)) return { series: target, slugs: store.booksIn(target) };
      if (store.book(target)) return { series: store.book(target).series, slugs: [target] };
      throw new Error(`"${target}" is neither a series nor a book in ${root}`);
    },

    /** Bytes of a mask PNG named by a book or series (path relative to the content root), or null. */
    mask(rel) { if (!rel) return null; const f = p(rel); return fs.existsSync(f) ? fs.readFileSync(f) : null; },
    maskPath(name) { return p('masks', `${name}.png`); },

    catalog() { return readJson(p('catalog.json'), null); },
    writeCatalog(obj) { writeJson(p('catalog.json'), obj); },
    houseStyle() { const f = p('house-style.md'); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null; },
  };
  return store;
}
