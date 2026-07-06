import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseCompounds, buildGraph, bond, pairKey, enumerateLoops,
  countHamiltonianCycles, buildCandidate, TILE_STOPLIST,
} from '../engine/lib/graph.mjs';
import { emitPuzzle, isUnique, puzzleId, overlap } from '../engine/lib/puzzle.mjs';
import { validatePuzzle } from '../engine/validate.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const datasetText = readFileSync(join(ROOT, 'engine/data/compounds.txt'), 'utf8');

test('dataset parses and is well-formed', () => {
  const entries = parseCompounds(datasetText);
  assert.ok(entries.length > 500, `expected a substantial dataset, got ${entries.length}`);
  for (const { a, b, joined } of entries) {
    assert.equal(joined, a + b);
  }
});

test('graph derives the prototype bonds', () => {
  const graph = buildGraph(parseCompounds(datasetText));
  assert.deepEqual(bond(graph, 'SUN', 'LIGHT'), ['comp', 'SUNLIGHT']);
  assert.deepEqual(bond(graph, 'LIGHT', 'HOUSE'), ['comp', 'LIGHTHOUSE']);
  assert.deepEqual(bond(graph, 'WATER', 'FALL'), ['comp', 'WATERFALL']);
  const fallSun = bond(graph, 'FALL', 'SUN');
  assert.equal(fallSun[0], 'shar');
  assert.ok(fallSun[1].includes('DOWN'), 'FALL and SUN share DOWN');
  const groundHouse = bond(graph, 'GROUND', 'HOUSE');
  assert.equal(groundHouse[0], 'shar');
  assert.ok(groundHouse[1].includes('WORK'), 'GROUND and HOUSE share WORK');
  assert.equal(bond(graph, 'SUN', 'TABLE'), null);
});

test('glue words are helpers, not tiles', () => {
  const graph = buildGraph(parseCompounds(datasetText));
  for (const w of TILE_STOPLIST) {
    assert.ok(!graph.wordSet.has(w), `${w} must not be a tile`);
  }
  // ...but still work as hidden shared words
  const fallSun = bond(graph, 'FALL', 'SUN');
  assert.ok(fallSun[1].includes('DOWN'));
});

test('prototype ring builds as a candidate with 4 fuses + 2 shares', () => {
  const graph = buildGraph(parseCompounds(datasetText));
  const cand = buildCandidate(graph, ['SUN', 'LIGHT', 'HOUSE', 'GROUND', 'WATER', 'FALL']);
  assert.ok(cand, 'prototype ring must be constructible');
  assert.equal(cand.compCount, 4);
  assert.equal(cand.sharCount, 2);
});

test('enumerateLoops finds a synthetic ring', () => {
  const entries = parseCompounds(
    ['AA+BB', 'BB+CC', 'CC+DD', 'DD+EE', 'EE+HUB', 'FF+HUB', 'FF+JIG', 'AA+JIG'].join('\n'),
  );
  const graph = buildGraph(entries);
  const loops = enumerateLoops(graph, { minComp: 4, maxShar: 2 });
  const ids = loops.map((c) => puzzleId(c.words));
  assert.ok(
    ids.includes(puzzleId(['AA', 'BB', 'CC', 'DD', 'EE', 'FF'])),
    'the designed ring must be found',
  );
});

test('countHamiltonianCycles flags ambiguity', () => {
  // Ring AA-BB-CC-DD-EE-FF plus chords AA-DD... build two rings sharing words:
  // second valid ring AA-BB-CC-DD-FF-EE-AA via comp edges DD+FF and EE+AA.
  const entries = parseCompounds(
    ['AA+BB', 'BB+CC', 'CC+DD', 'DD+EE', 'EE+FF', 'FF+AA', 'DD+FF', 'EE+AA'].join('\n'),
  );
  const graph = buildGraph(entries);
  const n = countHamiltonianCycles(graph, ['AA', 'BB', 'CC', 'DD', 'EE', 'FF']);
  assert.ok(n >= 2, `expected ambiguity, got ${n}`);
});

test('generated puzzles pass validation end-to-end', () => {
  const graph = buildGraph(parseCompounds(datasetText));
  const loops = enumerateLoops(graph, { minComp: 4, maxShar: 2, maxResults: 3000 });
  assert.ok(loops.length > 0, 'expected at least one loop from the dataset');
  let checked = 0;
  for (const cand of loops) {
    if (!isUnique(graph, cand.words)) continue;
    const puzzle = emitPuzzle(graph, cand);
    const { ok, errors } = validatePuzzle(puzzle, graph);
    assert.ok(ok, `puzzle ${puzzle.id} invalid: ${errors.join('; ')}`);
    if (++checked >= 5) break;
  }
  assert.ok(checked > 0, 'expected at least one unique-solution loop');
});

test('validatePuzzle rejects a tampered ring', () => {
  const graph = buildGraph(parseCompounds(datasetText));
  const cand = buildCandidate(graph, ['SUN', 'LIGHT', 'HOUSE', 'GROUND', 'WATER', 'FALL']);
  const puzzle = emitPuzzle(graph, cand);
  const tampered = { ...puzzle, words: [...puzzle.words] };
  tampered.words[1] = 'TABLE'; // breaks ring bonds
  const { ok } = validatePuzzle(tampered, graph);
  assert.equal(ok, false);
});

test('pairKey and overlap helpers', () => {
  assert.equal(pairKey('SUN', 'FALL'), 'FALL|SUN');
  assert.equal(pairKey('FALL', 'SUN'), 'FALL|SUN');
  assert.equal(overlap(['A', 'B', 'C'], ['B', 'C', 'D']), 2);
});
