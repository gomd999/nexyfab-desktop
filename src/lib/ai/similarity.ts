/**
 * Lightweight text similarity for comparing AI provider responses.
 *
 * Uses tokenized cosine similarity over word frequency vectors. Not a deep
 * semantic measure (would need embeddings), but good enough to highlight
 * "providers gave nearly the same answer" vs "wildly different answers"
 * in the admin compare UI.
 *
 * Tokenization rules:
 *   - Lowercase
 *   - Split on non-alphanumeric so we keep CJK bigrams + Latin words
 *   - Drop tokens shorter than 2 chars (after CJK bigram expansion)
 *   - Drop a small English stopword set so common filler doesn't dominate
 */

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been',
  'of', 'to', 'in', 'on', 'at', 'for', 'with', 'by', 'as', 'from', 'this', 'that',
  'it', 'its', 'we', 'you', 'i', 'he', 'she', 'they', 'them', 'his', 'her',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should', 'can',
  'could', 'may', 'might', 'must', 'shall', 'not', 'no', 'so', 'if', 'then',
]);

/**
 * Generate CJK bigrams when characters are in the CJK block. For "한국어"
 * yields ["한국", "국어"] — bigrams are how we capture Korean/Japanese/Chinese
 * meaning without a real tokenizer.
 */
function cjkBigrams(text: string): string[] {
  const out: string[] = [];
  // CJK Unified Ideographs + Hangul Syllables + Hiragana + Katakana ranges.
  const cjkChars: string[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    const isCjk =
      (code >= 0x4E00 && code <= 0x9FFF) ||
      (code >= 0xAC00 && code <= 0xD7A3) ||
      (code >= 0x3040 && code <= 0x30FF);
    if (isCjk) cjkChars.push(ch);
    else if (cjkChars.length >= 2) {
      for (let i = 0; i + 1 < cjkChars.length; i++) out.push(cjkChars[i] + cjkChars[i + 1]);
      cjkChars.length = 0;
    } else {
      cjkChars.length = 0;
    }
  }
  if (cjkChars.length >= 2) {
    for (let i = 0; i + 1 < cjkChars.length; i++) out.push(cjkChars[i] + cjkChars[i + 1]);
  }
  return out;
}

export function tokenize(text: string): string[] {
  if (typeof text !== 'string' || text.length === 0) return [];
  const lower = text.toLowerCase();
  // Latin / digit tokens via split — anything non-alphanumeric splits.
  const latin = lower
    .split(/[^a-z0-9_]+/u)
    .filter(t => t.length >= 2 && !STOPWORDS.has(t));
  const cjk = cjkBigrams(text);
  return [...latin, ...cjk];
}

export interface FrequencyVector {
  /** Word/bigram → count. */
  counts: Map<string, number>;
  /** Sum of all counts (cached for cosine norm). */
  total: number;
}

export function frequencyVector(text: string): FrequencyVector {
  const counts = new Map<string, number>();
  let total = 0;
  for (const tok of tokenize(text)) {
    counts.set(tok, (counts.get(tok) ?? 0) + 1);
    total++;
  }
  return { counts, total };
}

/**
 * Cosine similarity between two frequency vectors. Returns a number in
 * [0, 1] where 1.0 means identical token distribution. Returns 0 when
 * either vector is empty (no shared tokens, no signal).
 */
export function cosineSimilarity(a: FrequencyVector, b: FrequencyVector): number {
  if (a.total === 0 || b.total === 0) return 0;
  // Iterate over the smaller map for speed; build dot product.
  const [small, large] = a.counts.size <= b.counts.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [tok, freq] of small.counts) {
    const other = large.counts.get(tok);
    if (other) dot += freq * other;
  }
  if (dot === 0) return 0;
  // Normalize by L2 norms.
  let aNorm = 0;
  for (const v of a.counts.values()) aNorm += v * v;
  let bNorm = 0;
  for (const v of b.counts.values()) bNorm += v * v;
  return dot / (Math.sqrt(aNorm) * Math.sqrt(bNorm));
}

/**
 * Pairwise cosine similarity matrix. Diagonal is 1 (each text vs itself).
 * Symmetric — matrix[i][j] === matrix[j][i].
 */
export function pairwiseSimilarity(texts: string[]): number[][] {
  const n = texts.length;
  const vectors = texts.map(frequencyVector);
  const result: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row: number[] = [];
    for (let j = 0; j < n; j++) {
      if (i === j) row.push(1);
      else if (j < i) row.push(result[j][i]);  // mirror lower triangle
      else row.push(Math.round(cosineSimilarity(vectors[i], vectors[j]) * 1000) / 1000);
    }
    result.push(row);
  }
  return result;
}
