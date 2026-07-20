// Candidate -> puzzle JSON, ids, and scoring.
import { createHash } from 'node:crypto';
import { bond, pairKey, countHamiltonianCycles } from './graph.mjs';

// Stable content id: the ring words in canonical order.
export function puzzleId(words) {
  return createHash('sha1').update(words.join('|')).digest('hex').slice(0, 12);
}

// Difficulty schedule: how many hidden-link (shar) ring edges the day's
// puzzle should have, indexed by Date#getUTCDay (0 = Sunday). Hidden links
// are the difficulty knob — Mon/Tue ease in with none, midweek adds one,
// the weekend peaks at two. Comp count is always 6 - shar.
export const WEEKDAY_SHAR = [2, 0, 0, 1, 1, 1, 2];

export function sharTargetForDate(dateStr) {
  return WEEKDAY_SHAR[new Date(`${dateStr}T00:00:00Z`).getUTCDay()];
}

// Hidden-link count of a puzzle's ring (chords don't count), straight from
// the puzzle JSON — pool files predate meta trust, so derive, don't read meta.
export function ringSharCount(puzzle) {
  const words = puzzle.words;
  let n = 0;
  for (let i = 0; i < words.length; i++) {
    const entry = puzzle.bonds[pairKey(words[i], words[(i + 1) % words.length])];
    if (entry && entry[0] === 'shar') n++;
  }
  return n;
}

// Higher is better. Deterministic so generation is reproducible.
export function scoreCandidate(cand) {
  let score = 0;
  score += cand.compCount * 8; // fuse bonds are the satisfying ones
  score += cand.uniqueHelperCount * 3; // crisp single-answer shared words
  const avgLen = cand.words.reduce((s, w) => s + w.length, 0) / cand.words.length;
  score -= Math.round(avgLen * 2); // short words tend to be common words
  score += new Set(cand.words.map((w) => w[0])).size; // visual variety on the ring
  return score;
}

// Emit the client-facing puzzle object (without number/date — the publisher
// stamps those). Bonds cover EVERY bonded pair among the six words so the
// reveal can label off-ring bonds too, exactly like the hand-built prototype.
export function emitPuzzle(graph, cand) {
  const words = cand.words;
  const loopSet = new Set(words);
  const bonds = {};
  for (let i = 0; i < words.length; i++) {
    for (let j = i + 1; j < words.length; j++) {
      const bd = bond(graph, words[i], words[j]);
      if (!bd) continue;
      const k = pairKey(words[i], words[j]);
      if (bd[0] === 'comp') {
        bonds[k] = ['comp', bd[1]];
      } else {
        const outside = bd[1].filter((h) => !loopSet.has(h));
        const helper = outside.length ? outside[0] : bd[1][0];
        bonds[k] = ['shar', helper];
      }
    }
  }
  return {
    id: puzzleId(words),
    words,
    anchorIndex: 0,
    bonds,
    meta: {
      generator: 'v1',
      comp: cand.compCount,
      shar: cand.sharCount,
      score: scoreCandidate(cand),
    },
  };
}

// Fairness gate: the ring must be the only fully-bonded arrangement of its
// six words, or a player can deserve a win the validator won't give them.
export function isUnique(graph, words) {
  return countHamiltonianCycles(graph, words) === 1;
}

// How many words two puzzles share.
export function overlap(wordsA, wordsB) {
  const set = new Set(wordsA);
  return wordsB.filter((w) => set.has(w)).length;
}
