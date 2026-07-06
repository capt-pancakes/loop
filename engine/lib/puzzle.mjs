// Candidate -> puzzle JSON, ids, and scoring.
import { createHash } from 'node:crypto';
import { bond, pairKey, countHamiltonianCycles } from './graph.mjs';

// Stable content id: the ring words in canonical order.
export function puzzleId(words) {
  return createHash('sha1').update(words.join('|')).digest('hex').slice(0, 12);
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
