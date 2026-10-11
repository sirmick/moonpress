# Moonpress and Nightstand

Moonpress makes illustrated picture books. Nightstand is the shelf they live on.
Nighttime Books is the Android reader that pulls the shelf onto a Bigme HiBreak.

This is the design the rewrite is built against. It replaces `gen.py`, `index.html`
and the plan-to-JSON scripts. `read.html`, `push.sh` and the Android app survive.

## Repos

**moonpress** (this repo). Tool only, no real content. The old `kids-bookgen` repo stays as history.

    moonpress/      Node package. Two commands: `moonpress` (generator) and `moonpress serve` (editor).
      prompts/      house-style.md and the prompt templates, loaded at runtime
      lib/          content store, hashing, OpenRouter client, renderer, validators
      passes/       plan.js write.js draw.js inspect.js package.js publish.js bundle.js
      cli.js serve.js
    web/            static viewer + editor page, served by `moonpress serve` and by GitHub Pages
    app/            the Android reader (moved from nighttime-books/app)
    sample/         a tiny Nightstand: one series, two finished books. Fixture, demo, default target.
    docs/           this file

**nightstand**. Content only, public, served by GitHub Pages. The reader and the web
viewer both fetch from `https://sirmick.github.io/nightstand/`.

    catalog.json                    written by `moonpress publish`; what the app syncs from
    house-style.md                  shelf-wide rules that go into every prompt (optional override of the default)
    series/<series>.json            authored: brief, set, cast, style constraints, book order
    books/<slug>/book.json          authored: everything a human may edit
    books/<slug>/state.json         derived: hashes, prompts, costs, verdicts, edits. Generator-owned.
    books/<slug>/src/*.webp         master images, model output as-is, WebP q92 (~150 KB)
    books/<slug>/out/*              device folder: book.json manifest + cover/p01.. WebP q85 at 1072x1448
    books/<slug>/view/*.webp        composites with the text panel drawn, for the web viewer
    work/                           gitignored: raw PNG originals, candidates, review.html

Not committed: raw PNGs (15x the size of the WebP), alternate candidates, review sheets. They stay
in `work/` on the devel box. Three WebP copies per page is about 3.5 MB a book, 75 MB for the
current shelf. No LFS: GitHub Pages serves LFS pointers instead of the files, so nothing the reader
fetches can live there, and LFS objects are never garbage-collected, so regenerated images would
only ever add to the quota.

Moonpress finds the content root from `--content <dir>` or `NIGHTSTAND=<dir>`,
defaulting to `./sample` so nothing runs against the real shelf by accident.

## Authored: `book.json`

Only humans and passes 1 and 2 write this file. Passes 1 and 2 only fill fields that are empty.

```json
{
  "slug": "cascades",
  "series": "bedtime",
  "set": "bedtime",
  "title": "Goodnight, Mountain",
  "character": "Marlo, a plump young hoary marmot ...",
  "cast": ["Pip", "Tip"],
  "synopsis": "optional, written by pass 1 for pass 2",
  "setting": "optional hint from the series, e.g. the city",
  "frame": "full | square | rounded: one frame policy for every page of the book",
  "framing": "the composition sentence in every picture prompt; backfilled with the default when missing",
  "mask": "masks/cream-soft.png: optional PNG laid over every page, a colour fading in from the edges",
  "refrain": "whistles Marlo.",
  "palette": "fir green, slate blue, ochre, rust, cream snow.",
  "sky": "gold alpenglow on the peak → pink → lavender dusk → pale indigo with stars (never black).",
  "cover": "Marlo standing up on a boulder in an alpine meadow, a snowy peak behind.",
  "style": "Children's picture-book illustration ... No text, letters or numbers anywhere in the image.",
  "pages": [
    { "n": 1, "text": "...", "beat": "...", "text_pos": "bottom", "word": "", "who": ["Pip"] }
  ]
}
```

- `set` is `bedtime` (one main character, one reference sheet) or `reading` (named cast, big word
  per page, cast sheets shared across the series).
- `character` is for bedtime books; `cast` is for reading books and lists the names on the book's
  pages, with the descriptions in the series file. The old joined-sentence form is converted on
  import and never written again.
- `frame` is a book-wide policy, never a per-page choice: `full` runs pictures to the edges;
  `square` and `rounded` inset every page in a white margin as wide as the text panel's margin, so
  the reader's panel lines up with the picture's inner edge and the app needs no change. Pass 1
  picks it when the series doesn't fix it; the inspector never touches it.
- `framing` is the composition sentence every picture prompt carries. The default pins what the
  models otherwise wander on: the picture fills the frame edge to edge, no bands, margins, paper
  edges or blank strips. It is part of the image stamp, so changing it marks pictures stale, and
  `moonpress backfill` (or any draw) writes the default into books that predate it so the next
  regeneration carries it and a human can edit it.
- `mask` names a PNG under `masks/` in the content root: a plain colour, opaque at the edges and
  fading to transparent inwards, laid over every page before the frame and the panel. It hides the
  inconsistent edges of pictures made before `framing` existed. `moonpress mask <name>` writes one
  (`--colour`, `--fade`, `--radius`); hand-made PNGs work too. Its bytes are in the package stamp.
- A series may fix `character`, `style`, `palette`, `frame`, `framing` and `mask` for every book (the cities series does): the
  book leaves those fields empty, and the shared reference sheet lives at `series/<name>/char.webp`.
  `timePhrase` in the series ("evening" by default) is the span the sky arc covers.
- `who` lists the cast members on a reading page. Optional: when absent it is inferred by matching
  cast names in the text and beat, falling back to the previous page, exactly as today.
- Page 12 is the sleeping page. Twelve pages is the house rule, not a schema limit.

## Derived: `state.json`

Generator-owned. The editor never writes it. Deleting it costs nothing but a rebuild of the
cheap stages and a loss of the cost log.

```json
{
  "v": 1,
  "plan":  { "in": "9f3a…", "out": "c21b…" },
  "pages": {
    "char":  { "image": { "inputs": "…", "refs": [], "model": "google/gemini-3.1-flash-lite-image",
                          "prompt": "…", "cost": 0.034, "seconds": 5.1, "stale": false } },
    "cover": { "image": { … } },
    "p01": {
      "write":   { "in": "…", "out": "…" },
      "image":   { "inputs": "…", "ref": "…", "model": "…", "prompt": "…", "cost": 0.068, "seconds": 10.2,
                   "src": "src/p01.webp", "candidate": 2, "stale": false },
      "edit":    { "crop": [0.05, 0.0, 0.9, 0.9], "text_pos": "top" },
      "inspect": { "in": "…", "verdict": "fixed", "checks": { "text": "ok", "character": "ok", "content": "ok",
                   "panel": "covers face", "contrast": "ok", "extras": "ok" },
                   "actions": [ { "do": "text_pos", "to": "top" } ], "regens": 0, "note": "…" }
    }
  },
  "package": { "in": "…", "hash": "a1b2c3d4e5f6" },
  "spend": 1.73
}
```

Page keys are the image file stems: `char` (reference sheet), `cover`, `p01`.. `p12`. Series-level
reference sheets (reading cast, or a shared main character) live in `series/<name>/cast/<Name>.webp`
and `series/<name>/char.webp`, with their state in `series/<name>/state.json`.

`edit` is non-destructive. `crop` is a 3:4 rectangle in unit coordinates applied to `src` before the
fit to 1072x1448. `text_pos` here overrides the authored value; the effective value is
`edit.text_pos ?? page.text_pos`. The editor shows and can clear an override.

## Stamps

A stamp is the first 12 hex characters of SHA-256 over canonical JSON (sorted keys, no whitespace)
of the stage's inputs. Every stage records `in`; stages whose output is human-editable also record
`out`, the stamp of what the pass wrote.

| Stage | `in` is a stamp of | `out` |
|---|---|---|
| plan | series brief, house style | the book header fields |
| write (per page) | book header fields, page number, page count | that page's text, beat, text_pos, word, who |
| image (per key) | style, palette, sky, character or cast descriptions, beat, effective text_pos, n, page count, aspect, ref stamp, model | none |
| inspect (per page) | src stamp, text, word, effective text_pos, edit | none |
| package | title, set, and per page: src stamp, edit, text, text_pos, word | none; `hash` is the catalog hash |

Rules:

1. **Regenerate when `in` changed and `out` is untouched.** If the current content no longer
   matches `out`, a human edited it after generation: leave it alone unless `--force`.
2. **Images are advisory.** A changed image `in` sets `stale: true` and lists the page in the review
   sheet. Nothing is drawn without `--force`, `--redo <pages>`, or a pass 4 regen action. Generation
   is non-deterministic and costs money; stale is not worse.
3. **Template wording is not an input.** The image stamp covers the template's inputs, not the
   assembled prompt, so tuning the wording in `prompts/` marks nothing stale. The prompt actually
   used is recorded for the record and for the lightbox.
4. Cheap, deterministic stages (write validators, composites, package, publish) run whenever stale.

## Generator

    moonpress plan    <series> [--brief file] [--candidates 3]
    moonpress write   <series|slug>
    moonpress draw    <series|slug> [--only char,0,3] [--redo 3,7] [--force]
    moonpress inspect <series|slug> [--auto] [--max-regens 1]
    moonpress package <series|slug>
    moonpress publish                         rebuilds stale packages and catalog.json
    moonpress bundle  html <slug> | apk
    moonpress all     <series|slug>
    moonpress status  [series|slug]           what is missing, stale, proposed, unpublished
    moonpress import  <kids-bookgen dir>      one-off: books/*.json + examples/ → nightstand layout
    moonpress serve   [--port 8787]

Global flags: `--content`, `--budget <usd>` (abort the run before exceeding it), `--dry-run`
(print prompts and estimated cost, spend nothing), `--model-text`, `--model-vision`,
`--model-image`. The key is `OPENROUTER_API_KEY`. Everything goes through OpenRouter's
chat-completions endpoint: text, vision and image models are just model strings.

### Pass 1, plan

Series level. Input: the series brief, the house style, and the headers of every book already on the
shelf. Output: book headers (title, synopsis, character or cast, refrain, palette, sky arc, cover
scene, style) as structured JSON. Picks a style from the style library so the shelf stays varied.
Writes `--candidates` options to `work/plan/` and the chosen ones into `book.json` files whose
header fields are empty. For a reading series it also plans the letter and vocabulary progression.

### Pass 2, write

Per book. Input: the header. Output per page: `text`, `beat`, `text_pos`, `word`, `who`.
The LLM writes what varies between pages. A deterministic template assembles the final image prompt
from the header plus those fields, so the style, palette, reference instructions, no-text rule and
panel clearance are word-for-word identical on every page.

Validators run in a retry loop with the violations fed back:

- reading set: every token on a page is a sight word or a word taught on that page or earlier in the
  series (port of the check in `reading2json.py`);
- house rules: page count, page 12 sleeps, refrain present, page text under about 25 words,
  panel position alternates sensibly.

### Pass 3, draw

Reference sheet first (bedtime: `char`; reading: any missing cast sheets), then cover and pages in
parallel with the references attached. Raw PNG to `work/<slug>/raw/`, master WebP to `src/`.
A redo keeps the previous image as a candidate in `work/<slug>/candidates/` and records which
candidate is live. Concurrency defaults to 3. Each image logs prompt, refs, model, cost and seconds.

### Pass 4, inspect

Per page. The vision model sees the composite (image with the panel drawn, exactly as the device
shows it), the reference sheet, the beat and the text, and returns structured JSON: one result per
check and one action.

Checks, in priority order for e-ink: stray letters or text in the picture; character matches the
reference; content matches the text, including counts; the panel covers something that matters;
large dark areas or low contrast; extra or duplicated characters.

Actions: `ok`, `text_pos`, `crop`, `edit`, `regen`. `edit` sends the current image back
to the image model with an instruction ("remove the letters on the sign") so a good composition is
kept. `crop` and `text_pos` are chosen together, since zooming can push content under the panel.

`text_pos` and `crop` apply immediately. `edit` and `regen` apply only with `--auto`,
capped by `--max-regens` per page and by `--budget` per run; otherwise they are proposed. After the
pass, `work/<slug>/review.html` is written: a contact sheet with every composite, its checks, the
action taken or proposed, and stale flags. It inlines its data and opens from disk.

### Package, publish, bundle

`package` applies edits, fits to 1072x1448, autocontrasts at a 0.5% cutoff, and writes `out/`
(device folder with the unchanged manifest format) and `view/` (composites). `publish` packages
anything stale and writes `catalog.json`. `bundle html` writes one self-contained HTML file with
images inlined. `bundle apk` copies `out/` folders into the app's assets and runs the Gradle build.

## Renderer

`@napi-rs/canvas` in Node is the single authority for crop, autocontrast and the text panel.
Geometry is a port of `PageView.java`, scaled from a 1072 px width: bedtime panel in the top or
bottom quarter with a 3% margin, serif text sized from 5% of the width down to 3.4% until it fits;
reading panel 80% wide at the bottom, Andika, big word at 10.2% of the width, growing to 42% of the
height. Fonts are bundled: Andika from the app's assets and Noto Serif, which is what Android's
`Typeface.SERIF` resolves to on the device.

The same renderer feeds the inspector, the review sheet, `view/`, and the editor's preview, so what
you see on the web is what the inspector judged. The Android app keeps drawing text natively from
the manifest, which leaves the door open to per-word interaction in the reading set. The two are
pinned once with a fixture page rendered both ways and compared by eye and by panel rectangle.

## Catalog and the reader's sync

```json
{
  "v": 1,
  "minApp": 2,
  "generated": "2026-10-11T08:00:00Z",
  "books": [
    { "slug": "cascades", "title": "Goodnight, Mountain", "set": "bedtime",
      "hash": "a1b2c3d4e5f6", "bytes": 812345,
      "files": ["book.json", "cover.webp", "p01.webp", "p02.webp"] }
  ]
}
```

Files resolve to `<base>/books/<slug>/out/<file>`. `hash` is the package stamp.

The reader is offline first. On launch, with a short timeout, and on a sync button, it fetches the
catalog, downloads every book whose hash differs from `files/books/<slug>/.hash` in full into a temp
folder, then renames it into place. The library only ever reads local files. Books missing from the
catalog stay until deleted on the device. If `minApp` exceeds the installed version the library
shows an update notice and keeps working. Needs the internet permission and nothing else; no
libraries. The base URL is a build constant with a hidden override for pointing at a LAN server.

## Editor server

`moonpress serve` hosts `web/` and a small JSON API over the content checkout. It writes the working
tree only; committing is a human step, or a single commit-and-push button.

    GET  /api/books                       [{ slug, title, set, hash, stale }]
    GET  /api/books/:slug                 { etag, book, state }
    PUT  /api/books/:slug                 body: book; header If-Match: etag → { etag } or 409
    GET  /api/books/:slug/preview/:n      composite rendered now from src + query overrides (text, text_pos)
    GET  /api/books/:slug/view/:n.webp    published composite
    POST /api/git/commit                  { message } → commit and push (optional)

`etag` is the SHA-1 of the file bytes, which is what the GitHub contents API uses, so moving the
store to GitHub later is a change to one module, or the same calls made from the browser.

The web page has two modes. **Shelf and reader**: the current `read.html`, fed from `view/`
composites instead of its own layout code, with the device bezel and tap zones kept. **Editor**:
the book's authored fields and page table with a live preview from the preview endpoint, a stale
badge per page, the prompt used, and clear buttons for pass 4 overrides. No generation from the
browser.

## Migration

1. Create `nightstand`; run `moonpress import` on this checkout to produce `series/`, `books/`
   with `src/` from `work/` where originals exist, and `view/` and `out/` by packaging. The four
   example books come across with pictures; the other eighteen come across as text only.
2. Rename this repo to `moonpress`; move `nighttime-books/app` to `app/`; delete `gen.py`,
   `plan2json.py`, `reading2json.py`, `make_examples.py`, `index.html`, `books/`, `examples/`.
   `read.html` becomes `web/`. `push.sh` stays for the LAN path.
3. Sample: the kittens and r01-sit-pip books with pictures, under `sample/`. (Those two reproduce
   their recorded prompts byte for byte; farm and cascades had their style text edited after their
   pictures were made, so they can't serve as parity fixtures.)
4. Pages on both repos. Reader URL becomes `sirmick.github.io/moonpress/`, content at
   `sirmick.github.io/nightstand/`.

## Tests

`node --test`. Stamps are stable across key order and whitespace. Stamping rules: changed in,
untouched out regenerates; touched out does not; image stale is advisory. Prompt template parity:
the templates applied to the sample books reproduce the prompts recorded in today's
`examples/index.json`. Validators: the reading vocabulary check against the ten reading books.
Renderer: fixture page composited and compared against a checked-in image. Catalog: round trip
through the app's parser shape. Nothing in the test suite calls OpenRouter.

## Order of work

1. This document.
2. Content store, stamps, templates, validators, renderer, import. Run against `sample/`.
3. Passes 2, 3, 4 and package, then publish and the catalog.
4. Reader sync, then `bundle apk`.
5. Pass 1 and series planning.
6. Editor server and page.
