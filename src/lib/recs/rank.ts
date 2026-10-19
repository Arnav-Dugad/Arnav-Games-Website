/**
 * Pure ranking maths for recommendations v2 — no I/O, no clock reads, no
 * randomness, so the same inputs always give the same list and every piece
 * can be pinned in `scripts/check-providers.ts`.
 *
 * The model, end to end:
 *  1. Every game becomes a sparse TF-IDF vector over its genres, themes,
 *     keywords, perspectives, modes, developers, series and (for PC players)
 *     SteamSpy tags. IDF is computed over the candidate pool, so a feature
 *     every candidate shares ("Adventure") carries little, and a distinctive
 *     one ("souls-like") carries a lot.
 *  2. The user is the weighted sum of their seed games' vectors — weight =
 *     status × rating × hours × recency, negative for games they disliked —
 *     so taste similarity is one cosine.
 *  3. A candidate's score blends taste with a Bayesian quality prior,
 *     popularity *and* novelty (so not only blockbusters), platform fit and
 *     length fit, plus provenance boosts and penalties (ignored before,
 *     disliked-looking).
 *  4. Lists are diversified with Maximal Marginal Relevance, so ten
 *     souls-likes don't crowd out everything else.
 */

/** Sparse vector: feature key → weight. Keys are `type * FEATURE_SPACE + id`. */
export type SparseVector = Map<number, number>;

/** Feature id spaces; IGDB ids in each table stay far below this. */
export const FEATURE_SPACE = 10_000_000;
export const FEATURE = {
  genre: 1,
  theme: 2,
  keyword: 3,
  perspective: 4,
  mode: 5,
  developer: 6,
  series: 7,
  steamTag: 8,
} as const;
export type FeatureType = keyof typeof FEATURE;

/** How much each kind of feature says about taste, before IDF. */
export const FEATURE_WEIGHT: Record<FeatureType, number> = {
  genre: 0.6,
  theme: 1,
  keyword: 0.9,
  perspective: 0.5,
  mode: 0.35,
  developer: 0.7,
  series: 0.8,
  steamTag: 0.8,
};

export const featureKey = (type: FeatureType, id: number) => FEATURE[type] * FEATURE_SPACE + id;
/** Index = type code. A flat lookup: this runs for every feature of every candidate. */
const TYPE_BY_CODE: Array<FeatureType | undefined> = [];
for (const type of Object.keys(FEATURE) as FeatureType[]) TYPE_BY_CODE[FEATURE[type]] = type;
const WEIGHT_BY_CODE: number[] = TYPE_BY_CODE.map((type) => (type ? FEATURE_WEIGHT[type] : 0));

export const featureType = (key: number): FeatureType | null => TYPE_BY_CODE[Math.floor(key / FEATURE_SPACE)] ?? null;
export const featureId = (key: number) => key % FEATURE_SPACE;

/* ---------------------------------------------------------------------------
 * Vectors
 * ------------------------------------------------------------------------ */

export function norm(vector: SparseVector): number {
  let sum = 0;
  for (const value of vector.values()) sum += value * value;
  return Math.sqrt(sum);
}

/** Dot product; equals cosine when both vectors are unit length (every vector here is). */
export function dot(a: SparseVector, b: SparseVector): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let sum = 0;
  for (const [key, value] of small) {
    const other = large.get(key);
    if (other !== undefined) sum += value * other;
  }
  return sum;
}

/** Scales to unit length (in place); an empty or zero vector is returned as is. */
export function normalise(vector: SparseVector): SparseVector {
  const length = norm(vector);
  if (length > 0) for (const [key, value] of vector) vector.set(key, value / length);
  return vector;
}

/** Cosine similarity in [-1, 1]; 0 when either side is empty. Iterates the smaller map. */
export function cosine(a: SparseVector, b: SparseVector): number {
  if (a.size === 0 || b.size === 0) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [key, value] of small) {
    const other = large.get(key);
    if (other !== undefined) dot += value * other;
  }
  const denominator = norm(a) * norm(b);
  return denominator > 0 ? dot / denominator : 0;
}

/**
 * Document frequency of every feature across a set of feature-key lists.
 * Each list must already hold unique keys (`featureKeys` guarantees it) —
 * skipping a per-document Set keeps this cheap over ~500 candidates.
 */
export function documentFrequency(docs: number[][]): Map<number, number> {
  const df = new Map<number, number>();
  for (const doc of docs) for (const key of doc) df.set(key, (df.get(key) ?? 0) + 1);
  return df;
}

/* ---------------------------------------------------------------------------
 * Dense corpus: the same TF-IDF model on typed arrays
 *
 * Scoring ~500 candidates with ~80 features each through Maps cost ~10 ms of
 * CPU — the whole Workers Free allowance. Giving every distinct feature a
 * dense index once makes the user/seed vectors plain Float64Arrays, so a
 * cosine is an indexed loop with no hashing. The Map-based functions above
 * stay as the readable reference (and are what the self-checks pin down);
 * the two agree by construction (checked).
 * ------------------------------------------------------------------------ */

export interface DenseDoc {
  /** Indices into the corpus vocabulary. */
  idx: Int32Array;
  /** TF-IDF weight per index (un-normalised). */
  w: Float64Array;
  norm: number;
}

export interface Corpus {
  /** Dense index → feature key. */
  vocab: number[];
  docs: DenseDoc[];
}

/** Indexes the features of every doc (keys unique per doc) and weights them by type × IDF. */
export function buildCorpus(keyLists: number[][]): Corpus {
  const index = new Map<number, number>();
  const vocab: number[] = [];
  const df: number[] = [];
  const idxLists: number[][] = [];
  for (const keys of keyLists) {
    const list: number[] = [];
    for (const key of keys) {
      if ((WEIGHT_BY_CODE[Math.floor(key / FEATURE_SPACE)] ?? 0) === 0) continue;
      let i = index.get(key);
      if (i === undefined) {
        i = vocab.length;
        index.set(key, i);
        vocab.push(key);
        df.push(0);
      }
      df[i]++;
      list.push(i);
    }
    idxLists.push(list);
  }
  const n = keyLists.length;
  const termWeight = vocab.map((key, i) => WEIGHT_BY_CODE[Math.floor(key / FEATURE_SPACE)] * idf(df[i], n));
  const docs = idxLists.map((list) => {
    const idx = Int32Array.from(list);
    const w = new Float64Array(idx.length);
    let sum = 0;
    for (let j = 0; j < idx.length; j++) {
      w[j] = termWeight[idx[j]];
      sum += w[j] * w[j];
    }
    return { idx, w, norm: Math.sqrt(sum) };
  });
  return { vocab, docs };
}

/** A doc as a unit-length dense vector over the vocabulary. */
export function denseUnit(doc: DenseDoc, size: number): Float64Array {
  const out = new Float64Array(size);
  if (doc.norm === 0) return out;
  for (let j = 0; j < doc.idx.length; j++) out[doc.idx[j]] = doc.w[j] / doc.norm;
  return out;
}

/** Dense version of `tasteVector`: Σ weight × unit seed vector, trimmed to `keep` features, unit length. */
export function denseTaste(seeds: Array<{ doc: DenseDoc; weight: number }>, size: number, keep = 240): Float64Array {
  const sum = new Float64Array(size);
  for (const { doc, weight } of seeds) {
    if (!Number.isFinite(weight) || weight === 0 || doc.norm === 0) continue;
    for (let j = 0; j < doc.idx.length; j++) sum[doc.idx[j]] += (doc.w[j] / doc.norm) * weight;
  }
  const nonZero: number[] = [];
  for (let i = 0; i < size; i++) if (Math.abs(sum[i]) > 1e-9) nonZero.push(i);
  if (nonZero.length > keep) {
    nonZero.sort((a, b) => Math.abs(sum[b]) - Math.abs(sum[a]) || a - b);
    for (const i of nonZero.slice(keep)) sum[i] = 0;
  }
  let length = 0;
  for (let i = 0; i < size; i++) length += sum[i] * sum[i];
  length = Math.sqrt(length);
  if (length > 0) for (let i = 0; i < size; i++) sum[i] /= length;
  return sum;
}

/** Cosine between a doc and a unit-length dense vector. */
export function denseDot(doc: DenseDoc, unit: Float64Array): number {
  if (doc.norm === 0) return 0;
  let sum = 0;
  for (let j = 0; j < doc.idx.length; j++) sum += unit[doc.idx[j]] * doc.w[j];
  return sum / doc.norm;
}

/** A doc's `k` strongest features, unit length, sorted by index — for `sortedDot`. */
export function diversityOf(doc: DenseDoc, k: number): { idx: Int32Array; w: Float64Array } {
  const order = Array.from(doc.idx.keys()).sort((a, b) => doc.w[b] - doc.w[a] || doc.idx[a] - doc.idx[b]).slice(0, k);
  order.sort((a, b) => doc.idx[a] - doc.idx[b]);
  const idx = Int32Array.from(order.map((j) => doc.idx[j]));
  const w = Float64Array.from(order.map((j) => doc.w[j]));
  let length = 0;
  for (const value of w) length += value * value;
  length = Math.sqrt(length);
  if (length > 0) for (let j = 0; j < w.length; j++) w[j] /= length;
  return { idx, w };
}

/** Dot product of two index-sorted sparse vectors (a merge, no hashing). */
export function sortedDot(a: { idx: Int32Array; w: Float64Array }, b: { idx: Int32Array; w: Float64Array }): number {
  let i = 0;
  let j = 0;
  let sum = 0;
  while (i < a.idx.length && j < b.idx.length) {
    if (a.idx[i] === b.idx[j]) sum += a.w[i++] * b.w[j++];
    else if (a.idx[i] < b.idx[j]) i++;
    else j++;
  }
  return sum;
}

/** Back to feature keys, for explanations. */
export function denseToSparse(vector: Float64Array, vocab: number[]): SparseVector {
  const out: SparseVector = new Map();
  for (let i = 0; i < vector.length; i++) if (vector[i] !== 0) out.set(vocab[i], vector[i]);
  return out;
}

export function docToSparse(doc: DenseDoc, vocab: number[]): SparseVector {
  const out: SparseVector = new Map();
  for (let j = 0; j < doc.idx.length; j++) out.set(vocab[doc.idx[j]], doc.norm ? doc.w[j] / doc.norm : 0);
  return out;
}

/** Smoothed IDF: rare features approach ln(N) + 1, universal ones 1. */
export function idf(df: number, docs: number): number {
  return Math.log((docs + 1) / (df + 1)) + 1;
}

/** A game's binary-TF × type weight × IDF vector, L2-normalised. */
export function tfidfVector(keys: number[], df: Map<number, number>, docs: number): SparseVector {
  const vector: SparseVector = new Map();
  let sum = 0;
  for (const key of keys) {
    if (vector.has(key)) continue;
    const weight = WEIGHT_BY_CODE[Math.floor(key / FEATURE_SPACE)] ?? 0;
    if (weight === 0) continue;
    const value = weight * idf(df.get(key) ?? 0, docs);
    vector.set(key, value);
    sum += value * value;
  }
  const length = Math.sqrt(sum);
  if (length > 0) for (const [key, value] of vector) vector.set(key, value / length);
  return vector;
}

/**
 * The user's taste vector: Σ weight × seed vector. Disliked seeds (negative
 * weights) subtract, so a feature only they carry ends up negative and
 * *lowers* the cosine of candidates that have it. Trimmed to the strongest
 * `keep` features by magnitude to keep scoring cheap.
 */
export function tasteVector(seeds: Array<{ vector: SparseVector; weight: number }>, keep = 240): SparseVector {
  const sum: SparseVector = new Map();
  for (const { vector, weight } of seeds) {
    if (!Number.isFinite(weight) || weight === 0) continue;
    for (const [key, value] of vector) sum.set(key, (sum.get(key) ?? 0) + value * weight);
  }
  const top = [...sum].filter(([, value]) => Math.abs(value) > 1e-9).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]) || a[0] - b[0]).slice(0, keep);
  return new Map(top);
}

/** Features that contribute most to a candidate's match with the user, strongest first. */
export function sharedFeatures(user: SparseVector, candidate: SparseVector, limit: number): number[] {
  const out: Array<[number, number]> = [];
  for (const [key, value] of candidate) {
    const u = user.get(key);
    if (u !== undefined && u > 0) out.push([key, u * value]);
  }
  return out.sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, limit).map(([key]) => key);
}

/* ---------------------------------------------------------------------------
 * Priors and fits
 * ------------------------------------------------------------------------ */

/**
 * Bayesian average: shrinks a score toward `prior` until it has enough
 * votes, so a 98 from 3 critics doesn't outrank a 92 from 90.
 */
export function bayesianAverage(score: number | null, count: number, prior: number, confidence: number): number {
  if (score === null || !Number.isFinite(score) || count <= 0) return prior;
  return (score * count + prior * confidence) / (count + confidence);
}

/**
 * 0–1 quality from IGDB's critic aggregate and user rating (both 0–100),
 * each Bayesian-shrunk, critics weighted a little higher. A game nobody has
 * rated sits at the prior (≈ 0.4), not at zero.
 */
export function qualityPrior(input: { critic: number | null; criticCount: number; user: number | null; userCount: number }): number {
  const critic = bayesianAverage(input.critic, input.criticCount, 70, 6);
  const user = bayesianAverage(input.user, input.userCount, 70, 25);
  const blended = 0.6 * critic + 0.4 * user;
  return clamp01((blended - 55) / 40);
}

/** 0–1 popularity on a log scale: ~5k ratings (or hype) saturates. */
export function popularity(ratingCount: number, hypes: number): number {
  return clamp01(Math.log10(1 + Math.max(0, ratingCount) + 2 * Math.max(0, hypes)) / Math.log10(5001));
}

/** Half-life decay: 1 now, 0.5 after `halfLifeDays`. */
export function recencyDecay(ageDays: number, halfLifeDays: number): number {
  if (!Number.isFinite(ageDays) || ageDays <= 0) return 1;
  return Math.pow(0.5, ageDays / halfLifeDays);
}

/** 1 when a game's length matches what the user finishes, falling off on a log scale (2× longer ≈ 0.43). */
export function lengthFit(hours: number | null, preferred: number | null): number | null {
  if (!hours || !preferred || hours <= 0 || preferred <= 0) return null;
  return Math.exp(-1.2 * Math.abs(Math.log(hours / preferred)));
}

export const clamp01 = (value: number) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);

/* ---------------------------------------------------------------------------
 * Scoring
 * ------------------------------------------------------------------------ */

export interface ScoreInput {
  /** Cosine with the user, −1…1. */
  taste: number;
  quality: number;
  popularity: number;
  /** 0–1, or null when the user declared no platforms/services (neutral). */
  platform: number | null;
  /** 0–1, or null when unknown (neutral). */
  length: number | null;
  /** Came straight from a liked seed's similar-games list, scaled by that seed's strength 0–1. */
  seedSimilar: number;
  sameSeries: boolean;
  sameDeveloper: boolean;
  steamTag: boolean;
  /** Recommended before and not opened. */
  ignored: boolean;
}

export const SCORE_WEIGHTS = {
  taste: 0.5,
  quality: 0.18,
  popularity: 0.06,
  novelty: 0.05,
  platform: 0.08,
  length: 0.05,
  seedSimilar: 0.08,
  series: 0.04,
  developer: 0.03,
  steamTag: 0.03,
  ignored: -0.12,
  disliked: -0.25,
  unavailable: -0.06,
} as const;

/** The weighted feature model. Unknown platform/length count as neutral (0.5). */
export function scoreCandidate(input: ScoreInput): number {
  const w = SCORE_WEIGHTS;
  const taste = Math.max(0, input.taste);
  let score =
    w.taste * taste +
    w.quality * input.quality +
    w.popularity * input.popularity +
    w.novelty * (1 - input.popularity) +
    w.platform * (input.platform ?? 0.5) +
    w.length * (input.length ?? 0.5) +
    w.seedSimilar * clamp01(input.seedSimilar) +
    (input.sameSeries ? w.series : 0) +
    (input.sameDeveloper ? w.developer : 0) +
    (input.steamTag ? w.steamTag : 0);
  if (input.ignored) score += w.ignored;
  if (input.taste < 0) score += w.disliked * Math.min(1, -input.taste * 2);
  if (input.platform === 0) score += w.unavailable;
  return Math.round(clamp01(score) * 1e4) / 1e4;
}

/* ---------------------------------------------------------------------------
 * Diversification
 * ------------------------------------------------------------------------ */

/**
 * Maximal Marginal Relevance: repeatedly take the item maximising
 * λ·relevance − (1−λ)·(max similarity to anything already taken). λ = 1 is
 * plain ranking; lower values trade relevance for variety. Ties break on
 * id, so the order is deterministic. O(k·n) similarity calls — callers pass
 * a pre-ranked shortlist.
 */
export function mmr<T extends { id: number; score: number }>(
  items: T[],
  k: number,
  lambda: number,
  similarity: (a: T, b: T) => number,
): T[] {
  const pool = [...items].sort((a, b) => b.score - a.score || a.id - b.id);
  const chosen: T[] = [];
  const maxSim = new Map<number, number>(pool.map((item) => [item.id, 0]));
  while (chosen.length < k && pool.length > 0) {
    let bestIndex = 0;
    let bestValue = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const item = pool[i];
      const value = lambda * item.score - (1 - lambda) * (maxSim.get(item.id) ?? 0);
      if (value > bestValue + 1e-12 || (Math.abs(value - bestValue) <= 1e-12 && item.id < pool[bestIndex].id)) {
        bestValue = value;
        bestIndex = i;
      }
    }
    const [picked] = pool.splice(bestIndex, 1);
    chosen.push(picked);
    for (const item of pool) {
      const sim = similarity(item, picked);
      if (sim > (maxSim.get(item.id) ?? 0)) maxSim.set(item.id, sim);
    }
  }
  return chosen;
}
