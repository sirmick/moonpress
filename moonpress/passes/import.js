// One-off import of the kids-bookgen checkout (books/*.json, examples/, reading-plan.md) into a Nightstand.
import fs from 'node:fs';
import path from 'node:path';
import { stamp, stampBytes } from '../lib/stamp.js';
import { headerVars, pageOut, planOut, pageKeys } from '../lib/book.js';
import { loadPrompts, imageJobs, seriesJobs } from '../lib/prompts.js';
import { refPaths, refStamps, imageInputs } from '../lib/images.js';
import { writeBytes } from '../lib/store.js';

const BEDTIME_ORDER = ['farm', 'zoo', 'reef', 'rainforest', 'savanna', 'woodland', 'fnq', 'cascades', 'garden', 'fireflies', 'kittens', 'dogs'];

const CAST = {
  Pip: 'Pip, a small brown-and-white beagle puppy with floppy ears and a red collar',
  Tip: 'Tip, a small ginger kitten with white paws and big round eyes',
  Mim: 'Mim, a small grey tabby kitten with dark stripes, white paws and green eyes',
  Sam: 'Sam, a very big shaggy grey-and-white old English sheepdog with hair over his eyes',
  Bob: 'Bob, a stocky wrinkly tan bulldog with a black nose',
  Chip: 'Chip, a tiny tan chihuahua with huge ears',
  Spot: 'Spot, a white dalmatian with black spots',
  Jack: 'Jack, a small white jack russell terrier with a brown patch over one eye',
  Max: 'Max, a fawn pug with a black face and curly tail',
  Zip: 'Zip, a slim grey greyhound with a long nose',
};

/** reading-plan.md -> { slug: { letters, sight: [] } } using the same slug rule as reading2json.py. */
function parseReadingPlan(file) {
  if (!fs.existsSync(file)) return {};
  const src = fs.readFileSync(file, 'utf8').split('\n---\n', 2)[1] || '';
  const out = {};
  for (const sec of src.split(/\n## (?=\d+\. )/).slice(1)) {
    const [head, body] = [sec.slice(0, sec.indexOf('\n')), sec.slice(sec.indexOf('\n') + 1)];
    const m = head.match(/^(\d+)\. (.+)/); if (!m) continue;
    const slug = `r${m[1].padStart(2, '0')}-` + m[2].toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '');
    const letters = (body.match(/\*\*Letters:\*\*\s*(.+)/) || [])[1]?.trim() || '';
    const sightRaw = (body.match(/\*\*Sight words:\*\*\s*(.+)/) || [])[1]?.trim() || 'none';
    out[slug] = { letters, sight: sightRaw === 'none' ? [] : sightRaw.split(',').map(s => s.trim()).filter(Boolean) };
  }
  return out;
}

export async function importLegacy(store, from, { log = () => {}, model = 'google/gemini-3.1-flash-image' } = {}) {
  const prompts = loadPrompts(store);
  const booksDir = path.join(from, 'books');
  const idx = JSON.parse(fs.readFileSync(path.join(from, 'examples', 'index.json'), 'utf8'));
  const legacy = {};
  for (const f of fs.readdirSync(booksDir).filter(f => f.endsWith('.json'))) legacy[f.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(booksDir, f), 'utf8'));

  const readingSlugs = Object.keys(legacy).filter(s => /^r\d\d-/.test(s)).sort();
  const bedtimeSlugs = [...BEDTIME_ORDER.filter(s => legacy[s]), ...Object.keys(legacy).filter(s => !/^r\d\d-/.test(s) && !BEDTIME_ORDER.includes(s)).sort()];
  const anyReading = legacy[readingSlugs[0]];

  // ---- series
  store.writeSeries('bedtime', {
    name: 'bedtime', title: 'Goodnight books', set: 'bedtime',
    brief: 'Twelve-page bedtime books, each following one small animal around its home as every other animal settles down to sleep, ending with the main character asleep. Each book has its own art style so the shelf looks varied.',
    timePhrase: 'evening',
    books: bedtimeSlugs,
  });
  store.writeSeries('reading', {
    name: 'reading', title: 'Learning to read', set: 'reading',
    brief: 'Ten staged learn-to-read books with a shared cast of dogs and cats. Each page teaches one new word, shown big above a sentence that uses only words taught so far.',
    style: anyReading.style, palette: anyReading.palette, cast: CAST,
    progression: parseReadingPlan(path.join(from, 'reading-plan.md')),
    books: readingSlugs,
  });
  log(`series: bedtime (${bedtimeSlugs.length} books), reading (${readingSlugs.length} books)`);

  // ---- cast sheets
  const castDir = path.join(from, 'examples', 'cast');
  const rState = store.seriesState('reading');
  const rSeries = store.series('reading');
  const sj = seriesJobs(rSeries, prompts);
  if (fs.existsSync(castDir)) {
    for (const f of fs.readdirSync(castDir).filter(f => f.endsWith('.webp'))) {
      const name = f.slice(0, -5);
      const dst = store.seriesRef('reading', name);
      writeBytes(dst, fs.readFileSync(path.join(castDir, f)));
      const job = sj.cast[name];
      rState.refs[name] = { inputs: job ? imageInputs(job, [], model) : null, model, prompt: job?.prompt || '', cost: 0, imported: true, stale: false };
      log(`cast sheet ${name}`);
    }
  }
  store.writeSeriesState('reading', rState);

  // ---- books
  let withPictures = 0;
  for (const [slug, old] of Object.entries(legacy)) {
    const reading = !!old.cast?.length;
    const seriesName = reading ? 'reading' : 'bedtime';
    const series = store.series(seriesName);
    const book = { slug, series: seriesName, set: reading ? 'reading' : 'bedtime', title: old.title };
    if (reading) book.cast = old.cast; else book.character = old.character;
    Object.assign(book, { refrain: old.refrain || '', palette: reading ? '' : old.palette, sky: reading ? '' : old.sky, cover: old.cover,
                          style: reading ? '' : old.style });
    book.pages = old.pages.map(p => {
      const page = { n: p.n, text: p.text, beat: p.beat, text_pos: p.text_pos || 'bottom' };
      if (reading) page.word = p.word || '';
      if (p.no_cast) page.no_cast = true;
      return page;
    });
    store.writeBook(slug, book);

    const state = store.state(slug);
    const hv = headerVars(book, series);
    state.plan = { in: stamp({ imported: true }), out: stamp(planOut(book)) };
    for (const p of book.pages) {
      const key = `p${String(p.n).padStart(2, '0')}`;
      state.pages[key] = { ...(state.pages[key] || {}), write: { in: stamp({ ...hv, n: p.n }), out: stamp(pageOut(p)) } };
    }

    // pictures, where the old examples had them
    const ex = idx.books[slug];
    if (ex) {
      const jobs = imageJobs(book, series, prompts, state);
      for (const [stem, meta] of Object.entries(ex.images)) {
        const srcFile = path.join(from, 'examples', slug, `${stem}.webp`);
        if (!fs.existsSync(srcFile)) continue;
        writeBytes(store.src(slug, stem), fs.readFileSync(srcFile));
        const job = jobs[stem];
        const inputs = job ? imageInputs(job, refStamps(refPaths(store, book, series, job)), meta.model || model) : null;
        state.pages[stem] = { ...(state.pages[stem] || {}),
          image: { inputs, refs: job?.refs || [], model: meta.model || model, prompt: meta.prompt || '', cost: meta.cost || 0,
                   seconds: meta.seconds || 0, stale: false, imported: true } };
      }
      withPictures++;
    }
    store.writeState(slug, state);
    log(`${slug}: ${book.pages.length} pages${ex ? ', pictures' : ''}`);
  }
  return { books: Object.keys(legacy).length, withPictures };
}
