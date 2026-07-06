#!/usr/bin/env node
// Generate candidate puzzles for The Loop into the pool.
//
//   node engine/generate.mjs                  # add 20 puzzles to puzzles/pool
//   node engine/generate.mjs --count 50
//   node engine/generate.mjs --refill 21      # top pool up to 21 puzzles
//   node engine/generate.mjs --stats          # dataset/graph stats, write nothing
//   node engine/generate.mjs --list 10        # preview top candidates, write nothing
//
// Generation is deterministic: the same dataset always yields the same ranked
// candidate list. Already-published puzzles and puzzles already in the pool
// are excluded by id, and near-duplicates are suppressed by word overlap.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCompounds, buildGraph, enumerateLoops } from './lib/graph.mjs';
import { emitPuzzle, isUnique, scoreCandidate, overlap, puzzleId } from './lib/puzzle.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'engine/data/compounds.txt');
const POOL_DIR = join(ROOT, 'puzzles/pool');
const PUBLISHED = join(ROOT, 'puzzles/published.json');

// Keep consecutive days feeling fresh: a new pool puzzle may share at most
// MAX_OVERLAP words with any published or pooled puzzle, and no single word
// may appear in more than MAX_WORD_USES unpublished pool puzzles.
const MAX_OVERLAP = 2;
const MAX_WORD_USES = 2;

function parseArgs(argv) {
  const args = { count: 20, refill: null, stats: false, list: null, minComp: 4, maxShar: 2 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--count') args.count = Number(argv[++i]);
    else if (a === '--refill') args.refill = Number(argv[++i]);
    else if (a === '--stats') args.stats = true;
    else if (a === '--list') args.list = Number(argv[++i] ?? 10);
    else if (a === '--min-comp') args.minComp = Number(argv[++i]);
    else if (a === '--max-shar') args.maxShar = Number(argv[++i]);
    else throw new Error(`unknown argument: ${a}`);
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

function main() {
  const args = parseArgs(process.argv.slice(2));
  const graph = loadGraph();

  if (args.stats) {
    console.log(`words:      ${graph.words.length}`);
    console.log(`comp bonds: ${graph.comp.size}`);
    console.log(`shar bonds: ${graph.shar.size}`);
  }

  const t0 = Date.now();
  const raw = enumerateLoops(graph, { minComp: args.minComp, maxShar: args.maxShar });
  // Dedupe by id, rank by score. The expensive fairness gate (unique
  // fully-bonded ring) runs lazily, in score order, only until we have
  // as many puzzles as we need.
  const byId = new Map();
  for (const cand of raw) {
    const id = puzzleId(cand.words);
    if (!byId.has(id)) byId.set(id, cand);
  }
  const ranked = [...byId.entries()].sort(
    (x, y) => scoreCandidate(y[1]) - scoreCandidate(x[1]) || (x[0] < y[0] ? -1 : 1),
  );
  const dt = Date.now() - t0;

  if (args.stats || args.list !== null) {
    console.log(`raw loops:  ${raw.length} (${byId.size} distinct, ${dt}ms)`);
    const sample = ranked.slice(0, 500);
    const fairRate = sample.filter(([, c]) => isUnique(graph, c.words)).length / sample.length;
    console.log(`fairness rate in top 500: ${(fairRate * 100).toFixed(0)}%`);
  }
  if (args.list !== null) {
    let shown = 0;
    for (const [id, cand] of ranked) {
      if (shown >= args.list) break;
      if (!isUnique(graph, cand.words)) continue;
      const ring = cand.edges
        .map((e) => `${e.a}${e.type === 'comp' ? '=' : '~'}`)
        .join('');
      console.log(`${id}  score=${scoreCandidate(cand)} comp=${cand.compCount} ${ring}`);
      shown++;
    }
    return;
  }
  if (args.stats) return;

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

  let want = args.count;
  if (args.refill !== null) {
    want = Math.max(0, args.refill - pool.length);
    if (want === 0) {
      console.log(`pool already has ${pool.length} puzzles — nothing to do`);
      return;
    }
  }

  const wordUses = new Map();
  for (const p of pool) {
    for (const w of p.puzzle.words) wordUses.set(w, (wordUses.get(w) ?? 0) + 1);
  }
  const picked = [];
  for (const [id, cand] of ranked) {
    if (picked.length >= want) break;
    if (usedIds.has(id)) continue;
    if (usedWordSets.some((ws) => overlap(ws, cand.words) > MAX_OVERLAP)) continue;
    if (cand.words.some((w) => (wordUses.get(w) ?? 0) >= MAX_WORD_USES)) continue;
    if (!isUnique(graph, cand.words)) continue; // fairness gate, lazily
    picked.push(cand);
    usedWordSets.push(cand.words);
    for (const w of cand.words) wordUses.set(w, (wordUses.get(w) ?? 0) + 1);
  }

  if (picked.length < want) {
    console.warn(`warning: only found ${picked.length}/${want} fresh puzzles — grow the dataset`);
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
    console.log(`pool/${name}  ${puzzle.words.join(' → ')}`);
    seq++;
  }
  console.log(`added ${picked.length} puzzle(s); pool now has ${pool.length + picked.length}`);
}

main();
