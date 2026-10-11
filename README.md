# Moonpress

Makes illustrated twelve-page picture books for the **Nighttime Books** reader, an Android app for the
Bigme HiBreak colour e-ink tablet. The books live on **Nightstand**, a content-only repo served by
GitHub Pages, which the reader and the web viewer both pull from.

- **Read the books:** https://sirmick.github.io/moonpress/
- **The shelf:** https://github.com/sirmick/nightstand
- **The design:** [docs/moonpress.md](docs/moonpress.md)

Images come from OpenRouter (`google/gemini-3.1-flash-lite-image` by default, about $0.035 each);
writing and inspection use Claude Sonnet through the same key.

## Layout

    moonpress/   the Node package: `moonpress` (generator) and `moonpress serve` (editor)
    web/         the viewer and editor page; also published to GitHub Pages
    app/         the Android reader
    sample/      a tiny Nightstand with two finished books: the test fixture and the default target
    docs/        the design

## Generator

    export OPENROUTER_API_KEY=…            # or put the key in ~/openrouter.token
    export NIGHTSTAND=~/src/nightstand     # the content checkout (default: ./sample)
    npm install

    moonpress status                       # what is missing, stale, unpublished
    moonpress plan    <series>             # pass 1: book headers from a series brief
    moonpress write   <series|slug>        # pass 2: page text and beats
    moonpress draw    <series|slug>        # pass 3: pictures (missing ones; --redo p03; --force)
    moonpress inspect <series|slug> --auto # pass 4: judge every page; fix cheap things; regen under a budget
    moonpress publish                      # package what is stale, write catalog.json
    moonpress all     <series|slug>        # write, draw, inspect --auto, package

Every run takes `--budget <usd>` (default 5) and `--dry-run`. Nothing is redrawn because a prompt
changed: a changed picture is marked *stale* in `status` and the review sheet, and only `--redo`,
`--force` or an inspection action spends on it. Pages a human has edited are never rewritten.

`moonpress inspect` writes `work/<slug>/review.html` in the content checkout: every page as the
device shows it, with the inspector's checks and the action taken or proposed.

Then commit and push Nightstand. GitHub Pages serves it; the reader pulls on its next sync.

### Making a series

Write `series/<name>.json` in the Nightstand checkout (see `sample/series/` and the `cities`
series on Nightstand): a brief, the set (`bedtime` or `reading`), optionally a fixed character and
style shared by every book, and the books wanted as `{ "slug", "hint" }`. Then:

    moonpress plan cities && moonpress all cities && moonpress publish

## Editor

    moonpress serve        # http://localhost:8787/

Hosts `web/` plus a small JSON API over the content checkout. Edit a book's text, beats and panel
positions with a live preview rendered by the same code that makes the device pages; save writes
`book.json`; "Commit & push" runs git. Pictures are still made from the terminal.

The same page, published to GitHub Pages from this repo, reads the public shelf instead and is
view-only. Pass `?content=<url>` to point it at another Nightstand.

## Reader

    cd app && ./gradlew assembleDebug      # JDK 17 or 21, Android SDK 34

Sideload once. On launch and on the ↻ tab it fetches Nightstand's `catalog.json` and downloads
every book whose hash changed, whole, into a temp folder before swapping it in. The library only ever
reads local files, so it works offline. `moonpress bundle apk` builds an APK with every published
book inside, for a tablet that never sees Wi-Fi.

Over the LAN, `app/push.sh <slug>` still pushes one packaged book with adb, and a file
`files/base_url.txt` inside the app's data points the sync at a local `moonpress serve`.

## Tests

    npm test

Stamps, stamping rules, the reading vocabulary check, the house rules, prompt parity with the
pictures in `sample/`, and the renderer's panel geometry. Nothing in the tests calls OpenRouter.
