// Bond graph for The Loop.
//
// Two words are bonded when:
//   comp — they fuse into a real compound (SUN+LIGHT -> SUNLIGHT), in either order
//   shar — no comp bond, but both fuse (either side) with the same hidden word X
//          (FALL and SUN both go with DOWN: DOWNFALL, SUNDOWN)

export const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export function parseCompounds(text) {
  const seen = new Set();
  const entries = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^([A-Z]{2,})\+([A-Z]{2,})$/.exec(line);
    if (!m) throw new Error(`compounds.txt line ${i + 1}: malformed entry "${line}"`);
    const [, a, b] = m;
    if (a === b) throw new Error(`compounds.txt line ${i + 1}: self-compound "${line}"`);
    const dirKey = `${a}+${b}`;
    if (seen.has(dirKey)) continue; // silent dedupe
    seen.add(dirKey);
    entries.push({ a, b, joined: a + b });
  }
  return entries;
}

// Directional/glue words read as cheap on the ring but make great hidden
// helpers (+DOWN, +BACK, +OUT) — so they are banned as tiles only.
export const TILE_STOPLIST = new Set([
  'UP', 'OUT', 'OFF', 'OVER', 'UNDER', 'DOWN', 'BACK', 'FORE', 'ANY', 'SOME',
]);

export function buildGraph(entries, { maxWordLen = 8, tileStoplist = TILE_STOPLIST } = {}) {
  // comp bonds keyed by unordered pair; value is the fused word
  const comp = new Map();
  // every word that can fuse with W (either side), for shar derivation
  const partners = new Map();
  const addPartner = (w, p) => {
    if (!partners.has(w)) partners.set(w, new Set());
    partners.get(w).add(p);
  };

  for (const { a, b, joined } of entries) {
    const k = pairKey(a, b);
    if (!comp.has(k)) comp.set(k, joined);
    addPartner(a, b);
    addPartner(b, a);
  }

  // Playable tile words: short enough to fit a tile, not glue words.
  const words = [...partners.keys()]
    .filter((w) => w.length <= maxWordLen && !tileStoplist.has(w))
    .sort();
  const wordSet = new Set(words);

  // shar bonds: for each hub X, every pair of its partners shares X —
  // unless that pair already fuses directly.
  const shar = new Map(); // pairKey -> sorted array of helper words
  for (const [hub, ps] of partners) {
    const list = [...ps].filter((w) => wordSet.has(w)).sort();
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const k = pairKey(list[i], list[j]);
        if (comp.has(k)) continue;
        if (!shar.has(k)) shar.set(k, []);
        shar.get(k).push(hub);
      }
    }
  }
  for (const helpers of shar.values()) helpers.sort();

  return { words, wordSet, comp, shar, partners };
}

// bond(a,b) -> ['comp', fusedWord] | ['shar', [helpers...]] | null
export function bond(graph, a, b) {
  const k = pairKey(a, b);
  const c = graph.comp.get(k);
  if (c) return ['comp', c];
  const s = graph.shar.get(k);
  if (s && s.length) return ['shar', s];
  return null;
}

// Count distinct Hamiltonian cycles (as undirected edge sets) over the given
// six words, using every bond the graph knows about. A fair puzzle admits
// exactly one — otherwise a player could build a fully-bonded ring the
// validator would still reject.
export function countHamiltonianCycles(graph, words, { maxSharHelpers = Infinity } = {}) {
  const n = words.length;
  const adj = Array.from({ length: n }, () => new Array(n).fill(false));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const b = bond(graph, words[i], words[j]);
      const ok = b && (b[0] === 'comp' || b[1].length <= maxSharHelpers);
      adj[i][j] = adj[j][i] = !!ok;
    }
  }
  const cycles = new Set();
  const rest = [];
  for (let i = 1; i < n; i++) rest.push(i);
  const permute = (arr, k) => {
    if (k === arr.length) {
      const order = [0, ...arr];
      for (let i = 0; i < n; i++) {
        if (!adj[order[i]][order[(i + 1) % n]]) return;
      }
      const edges = [];
      for (let i = 0; i < n; i++) {
        const u = order[i];
        const v = order[(i + 1) % n];
        edges.push(u < v ? `${u}-${v}` : `${v}-${u}`);
      }
      cycles.add(edges.sort().join(','));
      return;
    }
    for (let i = k; i < arr.length; i++) {
      [arr[k], arr[i]] = [arr[i], arr[k]];
      permute(arr, k + 1);
      [arr[k], arr[i]] = [arr[i], arr[k]];
    }
  };
  permute(rest, 0);
  return cycles.size;
}

// Enumerate candidate 6-loops.
// A candidate: 6 distinct words in ring order where every adjacent pair bonds,
// with at least minComp fuse bonds and at most maxShar shared-word bonds.
export function enumerateLoops(graph, {
  size = 6,
  minComp = 4,
  maxShar = 2,
  maxSharHelpers = 3,
  maxResults = 250000,
  startCap = 300, // per-start limit so no corner of the alphabet dominates
  onLoop = null,
} = {}) {
  const { words } = graph;
  const idx = new Map(words.map((w, i) => [w, i]));
  const n = words.length;

  // adjacency lists as [neighborIndex, isShar]
  const neighbors = Array.from({ length: n }, () => []);
  for (const [k, joined] of graph.comp) {
    const [a, b] = k.split('|');
    const ia = idx.get(a);
    const ib = idx.get(b);
    if (ia === undefined || ib === undefined) continue;
    neighbors[ia].push([ib, false]);
    neighbors[ib].push([ia, false]);
    void joined;
  }
  for (const [k, helpers] of graph.shar) {
    if (helpers.length > maxSharHelpers) continue;
    const [a, b] = k.split('|');
    const ia = idx.get(a);
    const ib = idx.get(b);
    if (ia === undefined || ib === undefined) continue;
    neighbors[ia].push([ib, true]);
    neighbors[ib].push([ia, true]);
  }
  for (const list of neighbors) list.sort((x, y) => x[0] - y[0]);

  const results = [];
  const path = new Array(size);
  const inPath = new Array(n).fill(false);
  let startBase = 0;

  const dfs = (start, depth, sharUsed, compUsed) => {
    if (results.length >= maxResults || results.length - startBase >= startCap) return;
    const last = path[depth - 1];
    if (depth === size) {
      // close the ring back to start
      for (const [nb, isShar] of neighbors[last]) {
        if (nb !== start) continue;
        if (isShar && sharUsed + 1 > maxShar) break;
        const closingComp = compUsed + (isShar ? 0 : 1);
        if (closingComp < minComp) break;
        // canonical direction: second element smaller than last element
        if (path[1] > path[size - 1]) break;
        const loopWords = path.map((i) => words[i]);
        const cand = buildCandidate(graph, loopWords);
        if (cand && (!onLoop || onLoop(cand))) results.push(cand);
        break;
      }
      return;
    }
    for (const [nb, isShar] of neighbors[last]) {
      if (nb <= start || inPath[nb]) continue; // start stays the smallest index
      const s = sharUsed + (isShar ? 1 : 0);
      if (s > maxShar) continue;
      // prune: even if every remaining edge is comp we must be able to reach minComp
      const edgesLeft = size - depth; // edges still to add after this one (incl. closing)
      if (compUsed + (isShar ? 0 : 1) + edgesLeft < minComp) continue;
      path[depth] = nb;
      inPath[nb] = true;
      dfs(start, depth + 1, s, compUsed + (isShar ? 0 : 1));
      inPath[nb] = false;
      if (results.length >= maxResults) return;
    }
  };

  for (let s = 0; s < n; s++) {
    startBase = results.length;
    path[0] = s;
    inPath[s] = true;
    dfs(s, 1, 0, 0);
    inPath[s] = false;
    if (results.length >= maxResults) break;
  }
  return results;
}

// Assemble a candidate puzzle from ring-ordered words; returns null if it
// fails a fairness/quality rule.
export function buildCandidate(graph, loopWords) {
  const size = loopWords.length;
  const loopSet = new Set(loopWords);
  const edges = [];
  let compCount = 0;
  let sharCount = 0;
  let uniqueHelperCount = 0;

  for (let i = 0; i < size; i++) {
    const a = loopWords[i];
    const b = loopWords[(i + 1) % size];
    const bd = bond(graph, a, b);
    if (!bd) return null;
    if (bd[0] === 'comp') {
      compCount++;
      edges.push({ a, b, type: 'comp', label: bd[1] });
    } else {
      sharCount++;
      // the hidden shared word must exist outside the ring, or the reveal
      // reads as nonsense ("these two share HOUSE" while HOUSE sits on the ring)
      const outside = bd[1].filter((h) => !loopSet.has(h));
      if (outside.length === 0) return null;
      if (outside.length === 1) uniqueHelperCount++;
      edges.push({ a, b, type: 'shar', label: outside[0], helpers: outside });
    }
  }

  return { words: loopWords, edges, compCount, sharCount, uniqueHelperCount };
}
