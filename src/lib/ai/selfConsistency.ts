/**
 * selfConsistency — lever B: run ONE model N times and use cross-run agreement
 * as free confidence.
 *
 * PROVEN TECHNIQUE (LLM_METHODOLOGY.md §4, from the user's own measured results):
 *   Running a SINGLE model several times (self-consistency) beat cross-model
 *   majority vote (measured 15/15 vs 9/15). So we do NOT add more models — we
 *   add more RUNS of the same model. Where the runs AGREE we have high
 *   confidence; where they DISAGREE that field is uncertain and is SURFACED as
 *   low confidence (routed to human / needs_input), never fabricated into a
 *   false consensus.
 *
 * HONESTY: this strengthens the existing honesty discipline. The deterministic
 * coerce/preflight gate stays authoritative — self-consistency only ATTACHES a
 * per-field agreement ratio and flags the low-agreement fields. A low-agreement
 * value is never presented as certain.
 *
 * COST (critical): N runs = N× cost and latency. The default is `runs = 1`,
 * which is a TRUE no-op passthrough — a single call, zero extra cost, every
 * field reported at confidence 1. A caller opts into real self-consistency by
 * passing `runs >= 2` (e.g. behind a Pro-plan / high-stakes flag / config). See
 * the callers (brief-expander, design-driver) for how the opt-in is threaded.
 *
 * DETERMINISM: given a deterministic `runOnce` (tests mock it), the whole
 * pipeline is deterministic — clustering walks values in run order and every
 * tie-break falls to the earliest run index.
 */

// ─── comparison model ───────────────────────────────────────────────────────

/**
 * A result is projected into a FLAT map of comparable scalar fields; agreement
 * is computed per field. Values may be number | string | boolean | null. A key
 * absent from the map is treated as its own distinct "absent" class (present in
 * one run, missing in another IS a disagreement).
 */
export type ScalarField = number | string | boolean | null;
export type ProjectedFields = Record<string, ScalarField>;

/** Normalised comparison token for one field value of one run. */
type Cell =
  | { kind: 'absent' }
  | { kind: 'null' }
  | { kind: 'num'; n: number }
  | { kind: 'str'; s: string }
  | { kind: 'bool'; b: boolean };

function toCell(map: ProjectedFields, field: string): Cell {
  if (!(field in map)) return { kind: 'absent' };
  const v = map[field];
  if (v === null || v === undefined) return { kind: 'null' };
  if (typeof v === 'number') return Number.isFinite(v) ? { kind: 'num', n: v } : { kind: 'null' };
  if (typeof v === 'boolean') return { kind: 'bool', b: v };
  return { kind: 'str', s: String(v) };
}

/**
 * Two cells count as the same value when:
 *   - both absent, both null;
 *   - strings/booleans EXACT (enums, ids, labels);
 *   - numbers within a RELATIVE tolerance: |a−b| / max(|a|,|b|) ≤ tol
 *     (with the zero-vs-zero case handled exactly). Default tol = 1% — so
 *     49.9 vs 50.1 (0.4% apart) AGREE, while 50 vs 60 do not.
 */
function cellsAgree(a: Cell, b: Cell, numericTolerance: number): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'absent':
    case 'null':
      return true;
    case 'str':
      return a.s === (b as Extract<Cell, { kind: 'str' }>).s;
    case 'bool':
      return a.b === (b as Extract<Cell, { kind: 'bool' }>).b;
    case 'num': {
      const bn = (b as Extract<Cell, { kind: 'num' }>).n;
      const diff = Math.abs(a.n - bn);
      const scale = Math.max(Math.abs(a.n), Math.abs(bn));
      if (scale === 0) return diff === 0;
      return diff / scale <= numericTolerance;
    }
  }
}

// ─── options / result ───────────────────────────────────────────────────────

export interface SelfConsistencyOptions<T> {
  /**
   * How many times to run `runOnce`. Default 1 = no-op passthrough (single
   * call, zero extra cost, confidence 1 everywhere). Values ≥ 2 opt into real
   * self-consistency at N× cost. Clamped to ≥ 1.
   */
  runs?: number;
  /**
   * Agreement threshold in [0,1]. A field whose majority-cluster ratio is
   * STRICTLY below this is reported in `lowConfidenceFields`. Default 0.8
   * (the pilot routed to a human below ~80% — 4/5).
   */
  agreement?: number;
  /** Relative tolerance for treating two numbers as equal. Default 0.01 (1%). */
  numericTolerance?: number;
  /**
   * Project a result into the flat scalar fields agreement is computed over.
   * Required for meaningful comparison of structured results; if omitted, the
   * result's own top-level scalar entries are used (objects only).
   */
  project?: (value: T) => ProjectedFields;
  /**
   * Restrict agreement to these field names. Omit to use every field seen in
   * any run's projection (the union).
   */
  keyFields?: string[];
}

export interface SelfConsistencyResult<T> {
  /**
   * The representative result: the run whose projected fields land in the
   * per-field majority on the MOST fields (a medoid), tie-broken to the
   * earliest run. It is a REAL, coherent result from a single run — never a
   * field-spliced Frankenstein — so downstream still sees a self-consistent T.
   */
  value: T;
  /** field → agreement ratio in [0,1] (majority cluster size / runsUsed). */
  confidence: Record<string, number>;
  /** fields whose agreement is strictly below the threshold (uncertain). */
  lowConfidenceFields: string[];
  /** how many runs actually executed (= max(1, runs)). */
  runsUsed: number;
}

// ─── default projection ─────────────────────────────────────────────────────

function defaultProject<T>(value: T): ProjectedFields {
  const out: ProjectedFields = {};
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === null || typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') {
        out[k] = v as ScalarField;
      }
    }
  }
  return out;
}

// ─── the wrapper ─────────────────────────────────────────────────────────────

/**
 * Run `runOnce` N times and aggregate the results field-by-field.
 *
 * At `runs <= 1` this is a strict no-op: exactly one call, confidence 1 for
 * every projected field, no low-confidence fields.
 *
 * At `runs >= 2` it calls `runOnce` N times (sequentially — the callers meter
 * cost/budget inside `runOnce`), projects each result to scalar fields, clusters
 * each field's values (numbers within tolerance, everything else exact), takes
 * the majority cluster per field as the agreement ratio, and returns the medoid
 * run as the representative value.
 */
export async function runSelfConsistent<T>(
  runOnce: () => Promise<T>,
  opts: SelfConsistencyOptions<T> = {},
): Promise<SelfConsistencyResult<T>> {
  const runs = Math.max(1, Math.floor(opts.runs ?? 1));
  const agreement = opts.agreement ?? 0.8;
  const numericTolerance = opts.numericTolerance ?? 0.01;
  const project = opts.project ?? defaultProject;

  // No-op fast path: one call, everything certain, zero extra cost.
  if (runs === 1) {
    const value = await runOnce();
    const fields = opts.keyFields ?? Object.keys(project(value));
    const confidence: Record<string, number> = {};
    for (const f of fields) confidence[f] = 1;
    return { value, confidence, lowConfidenceFields: [], runsUsed: 1 };
  }

  // Execute N runs. A run that throws is still N× cost risk, so we let the
  // first failure propagate (the caller decides retry/fallback) — a partial
  // self-consistency vote would understate disagreement.
  const results: T[] = [];
  for (let i = 0; i < runs; i++) {
    results.push(await runOnce());
  }
  const projections = results.map(project);

  // Field universe: caller-restricted, else the union across runs (stable order:
  // first appearance across runs left-to-right).
  let fields: string[];
  if (opts.keyFields) {
    fields = opts.keyFields;
  } else {
    const seen = new Set<string>();
    const order: string[] = [];
    for (const p of projections) {
      for (const k of Object.keys(p)) {
        if (!seen.has(k)) {
          seen.add(k);
          order.push(k);
        }
      }
    }
    fields = order;
  }

  // Per field: cluster the runs' cells, majority = largest cluster.
  const confidence: Record<string, number> = {};
  const lowConfidenceFields: string[] = [];
  // For medoid scoring: inMajority[field] = boolean[] (run in majority cluster?).
  const inMajority: Record<string, boolean[]> = {};

  for (const field of fields) {
    const cells = projections.map((p) => toCell(p, field));
    // Cluster: each cluster keyed by its first member (representative).
    const clusters: Array<{ repIndex: number; members: number[] }> = [];
    for (let i = 0; i < cells.length; i++) {
      let placed = false;
      for (const c of clusters) {
        if (cellsAgree(cells[c.repIndex], cells[i], numericTolerance)) {
          c.members.push(i);
          placed = true;
          break;
        }
      }
      if (!placed) clusters.push({ repIndex: i, members: [i] });
    }
    // Majority = largest cluster; tie-break to the earliest representative.
    let best = clusters[0];
    for (const c of clusters) {
      if (c.members.length > best.members.length) best = c;
    }
    const ratio = best.members.length / runs;
    confidence[field] = ratio;
    if (ratio < agreement) lowConfidenceFields.push(field);
    const flags = new Array<boolean>(runs).fill(false);
    for (const m of best.members) flags[m] = true;
    inMajority[field] = flags;
  }

  // Medoid: the run in the majority on the most fields (earliest wins ties).
  let bestRun = 0;
  let bestScore = -1;
  for (let i = 0; i < runs; i++) {
    let score = 0;
    for (const field of fields) {
      if (inMajority[field][i]) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestRun = i;
    }
  }

  return {
    value: results[bestRun],
    confidence,
    lowConfidenceFields,
    runsUsed: runs,
  };
}
