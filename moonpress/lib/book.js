// Helpers over the authored book shape.

/**
 * The composition sentence every picture prompt carries. It pins down what the model is otherwise
 * free to wander on: the picture fills the frame, and there are no bands, margins or paper edges.
 * A book or series may override it; an explicit empty string drops it.
 */
export const DEFAULT_FRAMING = {
  bedtime: 'Composition: the picture fills the whole frame edge to edge like a photograph. The scene continues right up to every edge: no border, no margin, no frame line, no vignette, no paper edge, and no blank or plain strip on any side.',
  reading: 'Composition: the plain cream background fills the whole frame edge to edge with no border, frame line, margin or vignette.',
};

/** Effective header: book fields with series-level defaults filled in. */
export function effective(book, series) {
  const s = series || {};
  const character = book.character || s.character || '';
  const set = book.set || s.set || 'bedtime';
  return {
    set,
    framing: book.framing ?? s.framing ?? DEFAULT_FRAMING[set] ?? DEFAULT_FRAMING.bedtime,
    mask: book.mask ?? s.mask ?? null,               // path of a mask PNG relative to the content root, or null
    title: book.title || '',
    character,
    sharedChar: !!s.character && !book.character,
    style: book.style || s.style || '',
    palette: book.palette || s.palette || '',
    sky: book.sky || '',
    cover: book.cover || '',
    refrain: book.refrain || '',
    timePhrase: s.timePhrase || 'evening',
    frame: book.frame || s.frame || 'full',          // one frame policy for the whole book: full, square or rounded
    castDesc: s.cast || {},
    cast: book.cast || [],
  };
}

/**
 * Backfill: a book written before the composition sentence existed gets it written into its
 * authored file, so the next regeneration carries it and a human can see and edit it. Returns true
 * when the book changed.
 */
export function backfillFraming(book, series) {
  if (book.framing !== undefined || series?.framing !== undefined) return false;
  book.framing = DEFAULT_FRAMING[book.set || series?.set || 'bedtime'] || DEFAULT_FRAMING.bedtime;
  return true;
}

/** Image keys for a book: cover then pages. The reference sheet is handled separately. */
export function pageKeys(book) {
  return ['cover', ...book.pages.map(p => `p${String(p.n).padStart(2, '0')}`)];
}

export function keyOf(n) { return n === 0 ? 'cover' : `p${String(n).padStart(2, '0')}`; }

export function pageOf(book, key) {
  if (key === 'cover' || key === 'char') return null;
  return book.pages.find(p => `p${String(p.n).padStart(2, '0')}` === key) || null;
}

/** Pass 4 may override the authored panel position; the override lives in the derived state. */
export function effectiveTextPos(page, state) {
  if (!page) return 'bottom';
  const key = `p${String(page.n).padStart(2, '0')}`;
  return state?.pages?.[key]?.edit?.text_pos || page.text_pos || 'bottom';
}

/**
 * Reading books: which cast members are on each page. A page's explicit `who` wins; otherwise names
 * found in the beat or text; otherwise (from page 2 on) the previous page's cast, so "Both asleep"
 * keeps the same characters. Returns { cover: [...], p01: [...], ... }.
 */
export function castByPage(book, castDesc) {
  const names = book.cast?.length ? book.cast : Object.keys(castDesc || {});
  const present = text => names.filter(m => new RegExp(`\\b${m}\\b`).test(text));
  const out = {};
  let prev = [];
  const pages = [[0, { beat: book.cover || '', text: '' }], ...book.pages.map(p => [p.n, p])];
  for (const [n, p] of pages) {
    const key = keyOf(n);
    let who = Array.isArray(p.who) ? p.who : present((p.beat || '') + ' ' + (p.text || ''));
    if (!who.length && n > 1 && !p.no_cast) who = prev;
    if (n > 0) prev = who;
    out[key] = who;
  }
  return out;
}

export function wordCount(text) { return (text || '').trim().split(/\s+/).filter(Boolean).length; }

/** The header fields pass 2 writes from. Stamp this for `write.in`. */
export function headerVars(book, series) {
  const h = effective(book, series);
  const castDesc = Object.fromEntries(h.cast.map(m => [m, h.castDesc[m] || '']));   // only this book's cast, so other books' edits don't touch it
  return { set: h.set, title: book.title, synopsis: book.synopsis || '', setting: book.setting || '', character: h.character,
           refrain: h.refrain, palette: h.palette, sky: h.sky, cover: h.cover, cast: h.cast, castDesc, total: book.pages.length };
}

/** What pass 2 produced for one page. Stamp this for `write.out`; if it no longer matches, a human edited the page. */
export function pageOut(page) {
  return { text: page.text || '', beat: page.beat || '', text_pos: page.text_pos || 'bottom', word: page.word || '', who: page.who };
}

/** What pass 1 produced. Stamp this for `plan.out`. */
export function planOut(book) {
  return { title: book.title, synopsis: book.synopsis || '', character: book.character || '', refrain: book.refrain || '',
           palette: book.palette || '', sky: book.sky || '', cover: book.cover || '', style: book.style || '', frame: book.frame || '' };
}
