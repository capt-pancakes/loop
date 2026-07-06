# The Loop — agent guide

Daily word-ring puzzle. Static game on GitHub Pages + a Node engine that
generates puzzles + a GitHub Actions pipeline that publishes one per day.
No runtime dependencies; Node >= 20; plain ESM (`.mjs`), no TypeScript, no
build step. `npm test` must pass before any push.

## Vocabulary

- **ring / loop**: 6 words arranged in a circle; every adjacent pair must bond.
- **comp bond** (amber, solid): the two words fuse into a real closed compound
  (`SUN`+`LIGHT` → SUNLIGHT), in either order.
- **shar bond** (teal, dashed): the two words don't fuse, but both fuse with
  the same hidden **helper** word (FALL·SUN → both take DOWN).
- **anchor**: the slot locked at game start (`anchorIndex`, always 0 today —
  the canonical first word).
- **pool**: vetted, unpublished puzzles in `puzzles/pool/`, consumed in
  filename order (`0001-<id>.json`, seq = generation rank).
- **published log**: `puzzles/published.json` — numbering + dedupe history.

## Data flow

```
engine/data/compounds.txt          ← the ONLY source of truth for word bonds
        │  parseCompounds / buildGraph (engine/lib/graph.mjs)
        ▼
bond graph ──enumerateLoops──▶ candidates ──score+filters──▶ puzzles/pool/*.json
                                   (engine/generate.mjs)
        │ daily cron (.github/workflows/daily-publish.yml)
        ▼
scripts/publish.mjs ──▶ site/puzzles/YYYY-MM-DD.json + latest.json + index.json
        ▼
site/index.html fetches by date → renders the game
```

## Puzzle JSON format

```jsonc
{
  "number": 1,                 // stamped by publisher; pool files omit this
  "date": "2026-07-05",        // stamped by publisher
  "id": "0be8d5fcbfee",        // sha1(words joined by "|"), 12 hex chars
  "words": ["HALL","MARK","NOTE","PAD","LOCK","WAY"],  // ring order, slot 0 first
  "anchorIndex": 0,
  "bonds": {                   // EVERY bonded pair among the 6 words, key sorted "A|B"
    "HALL|MARK": ["comp","HALLMARK"],   // label = fused word
    "MARK|NOTE": ["shar","BOOK"]        // label = hidden helper word
  },
  "meta": { "generator": "v1", "comp": 4, "shar": 2, "score": 37 }
}
```

`bonds` includes off-ring pairs too (chords) — the client only labels ring
edges, but the data mirrors the original hand-built prototype.

## Invariants — do not break these

1. **Fairness gate**: the 6 words must admit *exactly one* fully-bonded ring
   (`countHamiltonianCycles(...) === 1`, mirror counts as the same ring).
   The client validates against the intended edge set only, so an ambiguous
   word set means a player can build a real-looking loop that gets rejected.
   Enforced by the generator (lazily, in `engine/generate.mjs`) and re-checked
   by `engine/validate.mjs` at publish time.
2. **Ring-edge shar helpers must not be ring words** (revealing "+HOUSE" while
   HOUSE sits on the ring reads as nonsense). Off-ring bonds are exempt.
3. **Tile stoplist** (`TILE_STOPLIST` in `engine/lib/graph.mjs`): glue words
   (UP, OUT, OFF, OVER, UNDER, DOWN, BACK, FORE…) may be hidden helpers but
   never ring tiles. Rings of prepositions feel cheap.
4. **Ring quota**: ≥4 comp bonds, ≤2 shar bonds (matches the prototype feel).
5. **Canonical ring order**: `words[0]` is the alphabetically smallest;
   direction chosen so the second word < the last word. `id` hashes this
   canonical order — never reorder words in an existing puzzle file.
6. **Dataset rules** (`engine/data/compounds.txt`): `PART+PART`, uppercase,
   both parts standalone English words, fused form written as ONE word in
   ordinary usage (no hyphens, no two-word phrases). One per line; `#`
   comments. The parser throws on malformed lines.
7. **Published files are immutable**: never renumber or rewrite files in
   `site/puzzles/` or entries in `puzzles/published.json`; players' shares
   reference "No. N".
8. **Client fallback chain** must keep working: `?d=YYYY-MM-DD` → local-date
   file → `latest.json` → embedded DEFAULT practice puzzle (offline/file://).

## Commands

```bash
npm test                              # node --test tests/*.test.mjs (~30s, includes enumeration)
node engine/generate.mjs --stats      # dataset/supply stats (~25s, enumerates)
node engine/generate.mjs --list 10    # preview top fair candidates, writes nothing
node engine/generate.mjs --count 25   # append N puzzles to the pool
node engine/generate.mjs --refill 21  # top pool up to N (no-op if full) — what cron runs
node engine/validate.mjs <files...>   # exit 1 if any file invalid
node scripts/publish.mjs [--date YYYY-MM-DD]  # promote next pool puzzle (idempotent per date)
npm run serve                         # python http.server on :8080 serving site/
```

## Gotchas an agent will hit

- **`engine/generate.mjs` and `scripts/publish.mjs` execute on import** (they
  call `main()` at module top level / bottom). Never `import` them to reach
  helpers — importable logic lives in `engine/lib/*.mjs` and
  `engine/validate.mjs` (which has a proper "is main" guard).
- **Enumeration takes ~20s** and is capped (`startCap` per start word,
  `maxResults` global). It is deterministic: same dataset → same ranked
  candidates. Dedup against published/pool happens by `id` + word-overlap
  rules (`MAX_OVERLAP = 2` shared words with any prior puzzle,
  `MAX_WORD_USES = 2` appearances per word in the pool).
- **The top-scored candidates are usually ambiguous** (dense word sets admit
  alternate rings), so the fairness gate rejects many before a pick lands.
  That's expected, not a bug.
- **Client accepts the mirrored ring** (same undirected edge set); hint
  targeting picks whichever of ring/mirror is closer (`T1`/`T2` in
  `site/index.html`).
- **Pipeline deploys inside `daily-publish.yml`**: pushes made with
  `GITHUB_TOKEN` do NOT trigger other workflows, so `deploy-pages.yml` would
  never fire on the bot's commit. Don't "simplify" the daily workflow by
  removing its deploy job.
- **Dataset edits can invalidate pooled puzzles** (e.g. a new compound makes an
  old ring ambiguous). `scripts/publish.mjs` re-validates on publish and
  quarantines stale files to `puzzles/rejected/` automatically; CI also
  validates the whole pool. After editing the dataset, run
  `node engine/validate.mjs puzzles/pool/*.json` locally.
- **The scramble is seeded** by puzzle number (mulberry32) so all players see
  the same board; "Reset" reshuffles deterministically by attempt count.
- **`site/` must stay a self-contained static dir** — it is uploaded verbatim
  as the Pages artifact. No bundler, no server code, relative fetch paths only
  (the site is served from a subpath: `https://<user>.github.io/loop/`).

## Where to change what

| Want to…                                | Touch                                    |
|-----------------------------------------|------------------------------------------|
| Add/curate words                        | `engine/data/compounds.txt` (then run tests + validate pool) |
| Change ring size / bond quotas          | `enumerateLoops` opts in `engine/lib/graph.mjs`, `engine/generate.mjs` args — client assumes 6 slots |
| Change candidate quality/ranking        | `scoreCandidate` in `engine/lib/puzzle.mjs` |
| Change variety across days              | `MAX_OVERLAP` / `MAX_WORD_USES` in `engine/generate.mjs` |
| Change publish cadence/time             | cron in `.github/workflows/daily-publish.yml` |
| Change game look/behavior               | `site/index.html` (single file, inline CSS/JS) |
| Add fairness/quality rules              | `buildCandidate` (per-edge rules) or `isUnique` (whole-ring) + mirror them in `validatePuzzle` |

## Verifying changes like a human would

Serve the site (`npm run serve`), open `http://localhost:8080/?d=<date>`, and
play: the eyebrow shows "Daily · No. N", tiles swap on tap, Submit walks the
ring link by link, six hints force-solve any board. Playwright + the
preinstalled Chromium (`executablePath: '/opt/pw-browsers/chromium'`) works for
headless checks; Google Fonts failing to load in sandboxes is expected noise.
