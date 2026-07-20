#!/usr/bin/env node
// Generate candidate puzzles for The Loop into the pool.
//
//   node engine/generate.mjs                  # add 20 puzzles in the weekly difficulty mix
//   node engine/generate.mjs --count 50
//   node engine/generate.mjs --refill 21      # top pool up to 21, keeping the mix
//   node engine/generate.mjs --shar 0 --count 5   # a single difficulty tier only
//   node engine/generate.mjs --stats          # dataset/supply stats, write nothing
//   node engine/generate.mjs --list 5         # preview top fair candidates per tier
//
// Difficulty tiers: a puzzle's tier is its hidden-link (shar) ring-edge count
// — 0 easy, 1 medium, 2 hard; comp count is always 6 - shar. The publisher
// picks by weekday (WEEKDAY_SHAR in engine/lib/puzzle.mjs), so the pool is
// stocked in the same weekly proportion.
//
// Generation is deterministic: the same dataset always yields the same ranked
// candidate list per tier. Already-published puzzles and puzzles already in
// the pool are excluded by id, and near-duplicates are suppressed by word
// overlap.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCompounds, buildGraph, enumerateLoops } from './lib/graph.mjs';
import {
  emitPuzzle, isUnique, scoreCandidate, overlap, puzzleId, WEEKDAY_SHAR, ringSharCount,
} from './lib/puzzle.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'engine/data/compounds.txt');
const POOL_DIR = join(ROOT, 'puzzles/pool');
const PUBLISHED = join(ROOT, 'puzzles/published.json');

// Keep consecutive days feeling fresh: a new pool puzzle may share at most
// MAX_OVERLAP words with any published or pooled puzzle, and no single word
// may appear in more than MAX_WORD_USES unpublished pool puzzles.
const MAX_OVERLAP = 2;
const MAX_WORD_USES = 2;

const TIERS = [
  { shar: 0, minComp: 6 },
  { shar: 1, minComp: 5 },
  { shar: 2, minComp: 4 },
];
// Pool stock mirrors the publishing schedule: days per week each tier runs.
const WEEKLY_MIX = TIERS.map((t) => WEEKDAY_SHAR.filter((s) => s === t.shar).length);

// Split a total pool size across tiers proportionally to the weekly mix
// (largest-remainder rounding so the parts always sum to the total).
function tierTargets(total) {
  const exact = WEEKLY_MIX.map((w) => (total * w) / 7);
  const base = exact.map(Math.floor);
  let left = total - base.reduce((a, b) => a + b, 0);
  const order = exact
    .map((e, i) => [e - base[i], i])
    .sort((x, y) => y[0] - x[0] || x[1] - y[1]);
  for (const [, i] of order) {
    if (left === 0) break;
    base[i]++;
    left--;
  }
  return base;
}

function parseArgs(argv) {
  const args = { count: null, refill: null, stats: false, list: null, shar: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--count') args.count = Number(argv[++i]);
    else if (a === '--refill') args.refill = Number(argv[++i]);
    else if (a === '--stats') args.stats = true;
    else if (a === '--list') args.list = Number(argv[++i] ?? 5);
    else if (a === '--shar') args.shar = Number(argv[++i]);
    else throw new Error(`unknown argument: ${a}`);
  }
  if (args.shar !== null && !TIERS.some((t) => t.shar === args.shar)) {
    throw new Error(`--shar must be one of ${TIERS.map((t) => t.shar).join(', ')}`);
  }
  return args;
}

function loadGraph() {
  return buildGraph(parseCompounds(readFileSync(DATA, 'utf8')));
}

function loadPublished() {
  if (!existsSync(PUBLISHED)) return { nextNumber: 1, puzzles: [] };
  return JSON.parse(readFileSync(PUBLISHED, 'utf8'));
}

function loadPool() {
  if (!existsSync(POOL_DIR)) return [];
  return readdirSync(POOL_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({ file: f, puzzle: JSON.parse(readFileSync(join(POOL_DIR, f), 'utf8')) }));
}

// Enumerate one tier and return [id, candidate] pairs ranked by score.
// maxShar bounds the search; the exact-count filter keeps tiers disjoint.
function rankedCandidates(graph, tier) {
  const raw = enumerateLoops(graph, { minComp: tier.minComp, maxShar: tier.shar });
  const byId = new Map();
  for (const cand of raw) {
    if (cand.sharCount !== tier.shar) continue;
    const id = puzzleId(cand.words);
    if (!byId.has(id)) byId.set(id, cand);
  }
  return [...byId.entries()].sort(
    (x, y) => scoreCandidate(y[1]) - scoreCandidate(x[1]) || (x[0] < y[0] ? -1 : 1),
  );
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const graph = loadGraph();
  const tiers = args.shar === null ? TIERS : TIERS.filter((t) => t.shar === args.shar);

  if (args.stats || args.list !== null) {
    console.log(`words:      ${graph.words.length}`);
    console.log(`comp bonds: ${graph.comp.size}`);
    console.log(`shar bonds: ${graph.shar.size}`);
    for (const tier of tiers) {
      const t0 = Date.now();
      const ranked = rankedCandidates(graph, tier);
      const dt = Date.now() - t0;
      const sample = ranked.slice(0, 200);
      const fairRate = sample.length
        ? sample.filter(([, c]) => isUnique(graph, c.words)).length / sample.length
        : 0;
      console.log(
        `shar=${tier.shar}: ${ranked.length} candidates, ` +
        `fairness rate in top ${sample.length}: ${(fairRate * 100).toFixed(0)}% (${dt}ms)`,
      );
      if (args.list !== null) {
        let shown = 0;
        for (const [id, cand] of ranked) {
          if (shown >= args.list) break;
          if (!isUnique(graph, cand.words)) continue;
          const ring = cand.edges
            .map((e) => `${e.a}${e.type === 'comp' ? '=' : '~'}`)
            .join('');
          console.log(`  ${id}  score=${scoreCandidate(cand)} ${ring}`);
          shown++;
        }
      }
    }
    return;
  }

  const published = loadPublished();
  const pool = loadPool();
  const usedIds = new Set([
    ...published.puzzles.map((p) => p.id),
    ...pool.map((p) => p.puzzle.id),
  ]);
  const usedWordSets = [
    ...published.puzzles.map((p) => p.words),
    ...pool.map((p) => p.puzzle.words),
  ];
  const poolByTier = TIERS.map(
    (t) => pool.filter((p) => ringSharCount(p.puzzle) === t.shar).length,
  );

  // How many puzzles each tier still wants.
  const want = TIERS.map(() => 0);
  if (args.refill !== null) {
    const targets = tierTargets(args.refill);
    for (const tier of tiers) {
      const i = TIERS.indexOf(tier);
      want[i] = Math.max(0, targets[i] - poolByTier[i]);
    }
    if (want.every((w) => w === 0)) {
      console.log(`pool already has ${pool.length} puzzles in mix — nothing to do`);
      return;
    }
  } else if (args.shar !== null) {
    want[TIERS.indexOf(tiers[0])] = args.count ?? 20;
  } else {
    const targets = tierTargets(args.count ?? 20);
    for (let i = 0; i < TIERS.length; i++) want[i] = targets[i];
  }

  const wordUses = new Map();
  for (const p of pool) {
    for (const w of p.puzzle.words) wordUses.set(w, (wordUses.get(w) ?? 0) + 1);
  }

  // Fill scarce tiers first (easy candidates are rarest) so dedupe pressure
  // from plentiful tiers never starves them.
  const picked = [];
  for (const tier of tiers) {
    const goal = want[TIERS.indexOf(tier)];
    if (goal === 0) continue;
    const ranked = rankedCandidates(graph, tier);
    let got = 0;
    for (const [id, cand] of ranked) {
      if (got >= goal) break;
      if (usedIds.has(id)) continue;
      if (usedWordSets.some((ws) => overlap(ws, cand.words) > MAX_OVERLAP)) continue;
      if (cand.words.some((w) => (wordUses.get(w) ?? 0) >= MAX_WORD_USES)) continue;
      if (!isUnique(graph, cand.words)) continue; // fairness gate, lazily
      picked.push(cand);
      usedIds.add(id);
      usedWordSets.push(cand.words);
      for (const w of cand.words) wordUses.set(w, (wordUses.get(w) ?? 0) + 1);
      got++;
    }
    if (got < goal) {
      console.warn(`warning: shar=${tier.shar}: only found ${got}/${goal} fresh puzzles — grow the dataset`);
    }
  }

  if (picked.length === 0) {
    process.exitCode = pool.length === 0 ? 1 : 0;
    return;
  }

  mkdirSync(POOL_DIR, { recursive: true });
  let seq =
    pool.length === 0
      ? 1
      : Math.max(...pool.map((p) => Number(p.file.split('-')[0]) || 0)) + 1;
  for (const cand of picked) {
    const puzzle = emitPuzzle(graph, cand);
    const name = `${String(seq).padStart(4, '0')}-${puzzle.id}.json`;
    writeFileSync(join(POOL_DIR, name), JSON.stringify(puzzle, null, 2) + '\n');
    console.log(`pool/${name}  shar=${cand.sharCount}  ${puzzle.words.join(' → ')}`);
    seq++;
  }
  console.log(`added ${picked.length} puzzle(s); pool now has ${pool.length + picked.length}`);
}

main();
