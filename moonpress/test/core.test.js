import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { stamp, canonical, blobSha } from '../lib/stamp.js';
import { openStore } from '../lib/store.js';
import { loadPrompts, imageJobs, seriesJobs } from '../lib/prompts.js';
import { vocabCheck, houseCheck } from '../lib/validate.js';
import { castByPage, headerVars, pageOut } from '../lib/book.js';
import { pagesToWrite } from '../passes/write.js';
import { REPO } from '../lib/config.js';

const SAMPLE = path.join(REPO, 'sample');
const store = openStore(SAMPLE);
const prompts = loadPrompts(store);

test('stamps are stable across key order and whitespace', () => {
  assert.equal(stamp({ b: 1, a: [1, { d: 2, c: 3 }] }), stamp({ a: [1, { c: 3, d: 2 }], b: 1 }));
  assert.equal(canonical({ a: undefined, b: null }), '{"b":null}');
  assert.equal(stamp({ a: 1 }).length, 12);
  assert.notEqual(stamp({ a: 1 }), stamp({ a: 2 }));
});

test('model JSON with stray quotes and prose around it still parses', async () => {
  const { extractJson } = await import('../lib/openrouter.js');
  assert.deepEqual(extractJson('Here you go:\n```json\n{"a": 1}\n```'), { a: 1 });
  const broken = '{"checks": {"text": "the sign says "OPEN" in red", "panel": "ok"}, "action": {"do": "edit", "instruction": "Remove the word "OPEN"."}}';
  const fixed = extractJson(broken);
  assert.equal(fixed.checks.text, 'the sign says "OPEN" in red');
  assert.equal(fixed.action.instruction, 'Remove the word "OPEN".');
  assert.throws(() => extractJson('   '), /empty reply/);
});

test('blob sha matches git', () => {
  // `echo -n hello | git hash-object --stdin`
  assert.equal(blobSha(Buffer.from('hello')), 'b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0');
});

test('sample store resolves series and books', () => {
  assert.deepEqual(store.listSeries(), ['bedtime', 'cities', 'reading'].filter(s => store.series(s)));
  assert.deepEqual(store.booksIn('reading'), ['r01-sit-pip']);
  assert.equal(store.resolve('kittens').slugs[0], 'kittens');
  assert.throws(() => store.resolve('nope'));
});

test('templates reproduce the prompts the sample pictures were made with', () => {
  // Those pictures predate the composition sentence and the panel wording, so compare without them.
  const legacy = JSON.parse(JSON.stringify(prompts));
  legacy.t.bedtime.page = legacy.t.bedtime.page.replace(/ An opaque text panel.*$/, ' Keep the {{text_pos}} quarter of the image simple and uncluttered (plain ground, water or sky) because a text panel will be drawn there.');
  for (const slug of ['kittens', 'r01-sit-pip']) {
    const book = { ...store.book(slug), framing: '' }, state = store.state(slug);
    const jobs = imageJobs(book, store.seriesOf(book), legacy, state);
    for (const [key, p] of Object.entries(state.pages)) {
      if (!p.image?.prompt) continue;
      assert.equal(jobs[key].prompt, p.image.prompt, `${slug}/${key}`);
    }
  }
  const sj = seriesJobs(store.series('reading'), prompts);
  const rs = store.seriesState('reading');
  for (const name of ['Pip', 'Tip']) assert.equal(sj.cast[name].prompt, rs.refs[name].prompt, name);
});

test('every picture prompt carries the composition sentence, and it is stamped', () => {
  const book = store.book('kittens');
  const jobs = imageJobs(book, store.seriesOf(book), prompts, store.state('kittens'));
  for (const k of ['cover', 'p01', 'p12']) {
    assert.match(jobs[k].prompt, /fills the whole frame edge to edge/);
    assert.ok(jobs[k].vars.framing.includes('edge to edge'), 'framing is part of the stamped vars');
  }
  const custom = imageJobs({ ...book, framing: 'Composition: a round porthole vignette.' }, store.seriesOf(book), prompts, store.state('kittens'));
  assert.match(custom.p01.prompt, /porthole/);
  assert.notEqual(custom.p01.vars.framing, jobs.p01.vars.framing);
  const r = store.book('r01-sit-pip');
  assert.match(imageJobs(r, store.seriesOf(r), prompts).p01.prompt, /plain cream background fills the whole frame/);
});

test('reading pages get the cast on the page, falling back to the previous page', () => {
  const book = store.book('r01-sit-pip');
  const who = castByPage(book, store.series('reading').cast);
  assert.deepEqual(who.p01, ['Pip']);
  assert.deepEqual(who.p02, ['Tip']);
  assert.deepEqual(who.p12, ['Pip', 'Tip']);   // "Both asleep" has no names: same as page 11
});

test('vocabulary check passes the sample reading book and catches an untaught word', () => {
  const series = store.series('reading'), book = store.book('r01-sit-pip');
  const ok = vocabCheck([{ slug: book.slug, pages: book.pages }], series.progression);
  assert.deepEqual(ok.violations, []);
  const broken = structuredClone(book); broken.pages[3].text = 'Tip sat on the mat.';
  const bad = vocabCheck([{ slug: book.slug, pages: broken.pages }], series.progression);
  assert.deepEqual(bad.violations.map(v => v.token), ['on', 'the', 'mat']);
});

test('house rules pass the sample bedtime book and flag a wordy page', () => {
  const book = store.book('kittens');
  assert.deepEqual(houseCheck(book), []);
  const wordy = structuredClone(book);
  wordy.pages[0].text = Array(30).fill('word').join(' ');
  wordy.pages[11].text = 'The end.';
  const v = houseCheck(wordy);
  assert.ok(v.some(s => s.includes('30 words')));
  assert.ok(v.some(s => s.includes('sleeping page')));
});

test('stamping rules: changed input regenerates, touched output is left alone', () => {
  const book = structuredClone(store.book('kittens')), series = store.seriesOf(book);
  const state = { v: 1, pages: {} };
  const hv = headerVars(book, series);
  for (const p of book.pages) state.pages[`p${String(p.n).padStart(2, '0')}`] = { write: { in: stamp({ ...hv, n: p.n }), out: stamp(pageOut(p)) } };
  assert.equal(pagesToWrite(book, series, state).length, 0, 'nothing changed');
  book.title = 'Goodnight, Different Kittens';
  assert.equal(pagesToWrite(book, series, state).length, 12, 'header changed, every untouched page is stale');
  book.pages[2].text = 'A human wrote this.';
  assert.equal(pagesToWrite(book, series, state).length, 11, 'the touched page is human-owned');
  const fresh = structuredClone(store.book('kittens'));
  fresh.pages[4].text = '';
  assert.deepEqual(pagesToWrite(fresh, series, { v: 1, pages: {} }).map(p => p.n), [5], 'empty pages always need writing');
});
