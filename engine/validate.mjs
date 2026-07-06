#!/usr/bin/env node
// Validate puzzle JSON files against the dataset and fairness rules.
//
//   node engine/validate.mjs site/puzzles/2026-07-05.json puzzles/pool/*.json

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCompounds, buildGraph, bond, pairKey, countHamiltonianCycles } from './lib/graph.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function validatePuzzle(puzzle, graph) {
  const errors = [];
  const err = (m) => errors.push(m);

  const words = puzzle.words;
  if (!Array.isArray(words) || words.length !== 6) {
    err('words must be an array of 6 entries');
    return { ok: false, errors };
  }
  if (new Set(words).size !== 6) err('words must be distinct');
  for (const w of words) {
    if (typeof w !== 'string' || !/^[A-Z]{2,8}$/.test(w)) err(`bad word "${w}"`);
  }
  if (!Number.isInteger(puzzle.anchorIndex) || puzzle.anchorIndex < 0 || puzzle.anchorIndex > 5) {
    err('anchorIndex must be an integer 0..5');
  }
  if (typeof puzzle.bonds !== 'object' || puzzle.bonds === null) {
    err('bonds must be an object');
    return { ok: errors.length === 0, errors };
  }

  const loopSet = new Set(words);

  // every ring edge must have a bond, and it must match the dataset
  for (let i = 0; i < 6; i++) {
    const a = words[i];
    const b = words[(i + 1) % 6];
    const k = pairKey(a, b);
    const entry = puzzle.bonds[k];
    if (!entry) {
      err(`missing bond for ring edge ${k}`);
      continue;
    }
    const [type, label] = entry;
    const expected = bond(graph, a, b);
    if (!expected) {
      err(`ring edge ${k} has no bond in the dataset`);
    } else if (type === 'comp') {
      if (expected[0] !== 'comp' || expected[1] !== label) {
        err(`ring edge ${k}: comp label "${label}" does not match dataset`);
      }
    } else if (type === 'shar') {
      if (expected[0] !== 'shar' || !expected[1].includes(label)) {
        err(`ring edge ${k}: shar helper "${label}" does not match dataset`);
      }
      if (loopSet.has(label)) err(`ring edge ${k}: shar helper "${label}" is a ring word`);
    } else {
      err(`ring edge ${k}: unknown bond type "${type}"`);
    }
  }

  // all listed bonds must at least be pairs of ring words
  for (const k of Object.keys(puzzle.bonds)) {
    const [a, b] = k.split('|');
    if (!loopSet.has(a) || !loopSet.has(b)) err(`bond ${k} references non-ring words`);
    if (pairKey(a, b) !== k) err(`bond key ${k} is not sorted`);
  }

  // fairness: the intended ring must be the only fully-bonded arrangement
  if (errors.length === 0 && countHamiltonianCycles(graph, words) !== 1) {
    err('puzzle admits more than one fully-bonded ring (ambiguous)');
  }

  if (puzzle.number !== undefined && (!Number.isInteger(puzzle.number) || puzzle.number < 1)) {
    err('number must be a positive integer');
  }
  if (puzzle.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(puzzle.date)) {
    err('date must be YYYY-MM-DD');
  }

  return { ok: errors.length === 0, errors };
}

export function loadDefaultGraph() {
  const text = readFileSync(join(ROOT, 'engine/data/compounds.txt'), 'utf8');
  return buildGraph(parseCompounds(text));
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error('usage: node engine/validate.mjs <puzzle.json> [...]');
    process.exit(2);
  }
  const graph = loadDefaultGraph();
  let bad = 0;
  for (const file of files) {
    const puzzle = JSON.parse(readFileSync(file, 'utf8'));
    const { ok, errors } = validatePuzzle(puzzle, graph);
    if (ok) {
      console.log(`ok    ${file}`);
    } else {
      bad++;
      console.error(`FAIL  ${file}`);
      for (const e of errors) console.error(`      - ${e}`);
    }
  }
  process.exit(bad ? 1 : 0);
}
