#!/usr/bin/env node
// Publish the daily puzzle: promote the next pool puzzle to site/puzzles/.
//
//   node scripts/publish.mjs                # publish for today (UTC)
//   node scripts/publish.mjs --date 2026-07-09
//
// Idempotent: if the date already has a puzzle, it only re-syncs the index.
// The pool is consumed in filename order (the order the generator ranked them).

import {
  readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, rmSync, renameSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePuzzle, loadDefaultGraph } from '../engine/validate.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const POOL_DIR = join(ROOT, 'puzzles/pool');
const REJECT_DIR = join(ROOT, 'puzzles/rejected');
const PUBLISHED = join(ROOT, 'puzzles/published.json');
const SITE_PUZZLES = join(ROOT, 'site/puzzles');

function parseArgs(argv) {
  const args = { date: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--date') args.date = argv[++i];
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  if (!args.date) args.date = new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) throw new Error(`bad date: ${args.date}`);
  return args;
}

function loadPublished() {
  if (!existsSync(PUBLISHED)) return { nextNumber: 1, puzzles: [] };
  return JSON.parse(readFileSync(PUBLISHED, 'utf8'));
}

// index.json lets the client (and an archive page) discover what exists
// without listing the directory.
function rebuildIndex() {
  const days = {};
  let latest = null;
  for (const f of readdirSync(SITE_PUZZLES).sort()) {
    const m = /^(\d{4}-\d{2}-\d{2})\.json$/.exec(f);
    if (!m) continue;
    const p = JSON.parse(readFileSync(join(SITE_PUZZLES, f), 'utf8'));
    days[m[1]] = p.number;
    latest = { date: m[1], number: p.number };
  }
  writeFileSync(join(SITE_PUZZLES, 'index.json'), JSON.stringify({ latest, days }, null, 2) + '\n');
  if (latest) {
    const latestPuzzle = readFileSync(join(SITE_PUZZLES, `${latest.date}.json`));
    writeFileSync(join(SITE_PUZZLES, 'latest.json'), latestPuzzle);
  }
  return latest;
}

function main() {
  const { date } = parseArgs(process.argv.slice(2));
  mkdirSync(SITE_PUZZLES, { recursive: true });

  const dayFile = join(SITE_PUZZLES, `${date}.json`);
  if (existsSync(dayFile)) {
    rebuildIndex();
    console.log(`${date} already published — index re-synced`);
    return;
  }

  const graph = loadDefaultGraph();
  const published = loadPublished();
  const poolFiles = existsSync(POOL_DIR)
    ? readdirSync(POOL_DIR).filter((f) => f.endsWith('.json')).sort()
    : [];

  let chosen = null;
  for (const f of poolFiles) {
    const path = join(POOL_DIR, f);
    const puzzle = JSON.parse(readFileSync(path, 'utf8'));
    const { ok, errors } = validatePuzzle(puzzle, graph);
    if (ok) {
      chosen = { file: f, path, puzzle };
      break;
    }
    // A pool puzzle can go stale if the dataset changed since generation.
    console.warn(`rejecting pool/${f}:`);
    for (const e of errors) console.warn(`  - ${e}`);
    mkdirSync(REJECT_DIR, { recursive: true });
    renameSync(path, join(REJECT_DIR, f));
  }

  if (!chosen) {
    console.error('pool is empty — run: node engine/generate.mjs');
    process.exit(2);
  }

  const number = published.nextNumber;
  const out = {
    number,
    date,
    id: chosen.puzzle.id,
    words: chosen.puzzle.words,
    anchorIndex: chosen.puzzle.anchorIndex,
    bonds: chosen.puzzle.bonds,
    meta: chosen.puzzle.meta,
  };
  writeFileSync(dayFile, JSON.stringify(out, null, 2) + '\n');
  rmSync(chosen.path);

  published.nextNumber = number + 1;
  published.puzzles.push({ number, date, id: out.id, words: out.words });
  mkdirSync(dirname(PUBLISHED), { recursive: true });
  writeFileSync(PUBLISHED, JSON.stringify(published, null, 2) + '\n');

  rebuildIndex();
  console.log(`published No. ${number} for ${date}: ${out.words.join(' → ')}`);
  console.log(`pool has ${poolFiles.length - 1} puzzle(s) left`);
}

main();
