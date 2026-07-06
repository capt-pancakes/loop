# The Loop ↻

A daily word puzzle. Six tiles sit on a ring; arrange them so every adjacent
pair *bonds* — either the two words **fuse** into a real compound
(`SUN`+`LIGHT` → SUNLIGHT) or they **share a hidden word**
(`FALL`·`SUN` → both go with DOWN). Close the loop in three lives.

This repo contains the whole product:

```
site/                 the playable game (static, deployed to GitHub Pages)
  index.html          game client — fetches the daily puzzle JSON
  puzzles/            published puzzles: YYYY-MM-DD.json, latest.json, index.json
engine/
  data/compounds.txt  curated dataset of closed compounds (PART+PART)
  lib/graph.mjs       bond graph, loop enumeration, fairness checks
  lib/puzzle.mjs      scoring, ids, puzzle emission
  generate.mjs        CLI: generate candidate puzzles into the pool
  validate.mjs        CLI + library: validate puzzle files
puzzles/
  pool/               vetted, unpublished puzzles awaiting their day
  published.json      log of published puzzles (numbering + dedupe)
scripts/
  publish.mjs         CLI: promote the next pool puzzle to site/puzzles/
tests/                node --test suite
```

## How a puzzle is made

1. **Dataset** — `engine/data/compounds.txt` lists real closed compounds where
   both halves are standalone words. Everything is derived from this file.
2. **Bond graph** — words are nodes; `comp` edges come straight from the
   dataset, `shar` edges connect two words that both fuse with the same hidden
   helper. Directional glue words (UP, OUT, BACK, DOWN…) are allowed as hidden
   helpers but never as tiles.
3. **Enumeration** — DFS finds 6-rings with at least 4 fuse bonds and at most
   2 shared-word bonds.
4. **Fairness gate** — a candidate is only kept if its six words admit
   *exactly one* fully-bonded ring (checked over all arrangements). Otherwise
   a player could build a legitimate-looking loop the game would reject.
5. **Quality** — candidates are scored (fuse-heavy, short common words,
   crisp single-answer helpers) and picked with variety rules: a new puzzle
   may share at most 2 words with any earlier one, and no word may appear in
   more than 2 pooled puzzles at a time.

## The daily pipeline

`.github/workflows/daily-publish.yml` runs at 05:15 UTC every day:

1. `npm test` — engine sanity.
2. `node scripts/publish.mjs` — takes the top pool puzzle, re-validates it,
   stamps it with today's date and the next puzzle number, writes
   `site/puzzles/YYYY-MM-DD.json`, refreshes `latest.json` + `index.json`,
   and appends to `puzzles/published.json`. Idempotent per date.
3. `node engine/generate.mjs --refill 21` — keeps three weeks of vetted
   puzzles in the pool.
4. Commits to `main`, then deploys `site/` to GitHub Pages.

`deploy-pages.yml` additionally deploys on any human push to `main` touching
`site/**`, and `ci.yml` runs the tests + validates every puzzle file on
branches and PRs.

The client resolves the puzzle as: `?d=YYYY-MM-DD` query override → today
(player-local date) → `latest.json` → a built-in practice loop (so the file
also works offline / from disk). The starting scramble is seeded by the puzzle
number, so every player gets the same board.

## Commands

```bash
npm test                              # run the suite
node engine/generate.mjs --stats     # dataset & supply stats
node engine/generate.mjs --list 10   # preview top candidates (writes nothing)
node engine/generate.mjs --count 25  # add 25 puzzles to the pool
node engine/generate.mjs --refill 21 # top the pool up to 21
node engine/validate.mjs puzzles/pool/*.json
node scripts/publish.mjs             # publish today's puzzle locally
npm run serve                        # play at http://localhost:8080
```

## One-time repo setup

- **GitHub Pages**: Settings → Pages → Source: **GitHub Actions**.
- **Actions**: allow workflows to write (Settings → Actions → General →
  Workflow permissions → read and write) — the daily job pushes its commit.

## Growing the game

Add compounds to `engine/data/compounds.txt` (format `PART+PART`, closed
compounds only) and run `npm test`. More dataset → more supply and variety;
the generator, validator, and pipeline pick it up automatically.
