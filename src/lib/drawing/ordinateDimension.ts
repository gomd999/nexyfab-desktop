/**
 * ordinateDimension — Phase 4.2 follow-up of NexyFab Pro own-CAD (ADR-013).
 *
 * Ordinate (a.k.a. baseline / CMM-style) dimensioning. A single datum origin
 * fixes (0, 0) in sheet space, and every measurement on the chain is the
 * signed distance from that origin along the chosen axis (X-only, Y-only,
 * or both). This is the layout machine shops typically use when a single
 * datum face is the reference for many holes — much cleaner than chained
 * linear dimensions for parts with 10+ features.
 *
 * Pure logic only (no React/DOM). Adds a NEW abstraction next to
 * {@link ./dimension} without touching the existing Dimension IR. The
 * renderer (Phase 4.4) consumes `buildOrdinateRenderHints` to lay out leader
 * lines + text and translates each ordinate to its STEP AP242
 * `ordinate_dimension` representation on export.
 *
 * Scope:
 *   - Validation (id uniqueness, non-empty, finite coords).
 *   - Origin-relative value computation (signed delta per axis).
 *   - Configurable precision + unit (mm / in) on the formatted string.
 *   - Render hints: leader line geometry + per-point stagger so close
 *     measurements do not overlap.
 *   - Merge chains that share an origin (so callers can split inputs by
 *     authoring tool without losing the single-datum invariant).
 *
 * Out of scope:
 *   - Drawing primitive emission (Phase 4.4).
 *   - Tolerance per ordinate value (Phase 4.2.2 — wire {@link Tolerance}
 *     in once the renderer needs it).
 *   - 3D ordinate dimensions (model-based definition follow-up).
 */

// ─── types ───────────────────────────────────────────────────────────────

export interface OrdinatePoint {
  id: string;
  x: number;
  y: number;
  /** User override for the rendered label. When absent, the renderer uses
   *  the auto-formatted value (e.g., "12.50"). */
  label?: string;
}

export type OrdinateAxis = 'x' | 'y' | 'both';

export interface OrdinateDimensionChain {
  id: string;
  /** Datum (0, 0) in sheet coords. Every value below is `point - origin`. */
  origin: { x: number; y: number };
  /** Which axis (or both) to measure for every point in this chain. */
  axis: OrdinateAxis;
  points: OrdinatePoint[];
  /** Decimal places for the formatted string. Defaults to 2. */
  precision?: number;
  /** Unit suffix appended to the formatted string. Defaults to 'mm'. */
  unit?: 'mm' | 'in';
}

export interface OrdinateValue {
  pointId: string;
  axis: 'x' | 'y';
  /** Signed distance from origin along the axis, in chain units. */
  value: number;
  /** Pre-formatted display string (precision + unit applied). */
  formatted: string;
}

export interface OrdinateRenderHint {
  pointId: string;
  axis: 'x' | 'y';
  value: number;
  formatted: string;
  /** Leader starts on the datum's axis projection of the point. */
  leaderStart: { x: number; y: number };
  /** Leader ends at the text anchor (after the stagger offset is applied). */
  leaderEnd: { x: number; y: number };
  /** Text rotation in radians. 0 for X-axis labels (read left→right) and
   *  π/2 for Y-axis labels (read bottom→top, ISO drafting convention). */
  textAngle: number;
  /** Zero-based stagger row/column. Useful for renderers that want to draw
   *  per-layer guide lines or color-code overlapping clusters. */
  staggerLayer: number;
}

// ─── errors ──────────────────────────────────────────────────────────────

export class OrdinateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrdinateError';
  }
}

// ─── constants ───────────────────────────────────────────────────────────

/** Two points whose along-axis values are within this distance share a
 *  stagger cluster and will be split across rows / columns to avoid label
 *  overlap. Drawing-units (mm in the default unit system). */
export const STAGGER_THRESHOLD = 5;

/** Distance from the origin axis line to the first text row / column, in
 *  drawing units. The renderer is free to scale this with paper size. */
export const LEADER_BASE_OFFSET = 10;

/** Distance between successive stagger layers in drawing units. */
export const STAGGER_STEP = 6;

// ─── validation ──────────────────────────────────────────────────────────

export interface OrdinateValidationResult {
  ok: boolean;
  errors: string[];
}

export function validateOrdinateChain(
  chain: OrdinateDimensionChain,
): OrdinateValidationResult {
  const errors: string[] = [];

  if (!chain.id) errors.push('chain id is empty');
  if (!isFiniteNumber(chain.origin?.x) || !isFiniteNumber(chain.origin?.y)) {
    errors.push(`chain ${chain.id || '<unnamed>'}: origin must be finite numbers`);
  }
  if (chain.axis !== 'x' && chain.axis !== 'y' && chain.axis !== 'both') {
    errors.push(`chain ${chain.id || '<unnamed>'}: invalid axis '${String(chain.axis)}'`);
  }
  if (chain.precision !== undefined) {
    if (!Number.isInteger(chain.precision) || chain.precision < 0 || chain.precision > 12) {
      errors.push(
        `chain ${chain.id || '<unnamed>'}: precision must be an integer in [0, 12]`,
      );
    }
  }
  if (chain.unit !== undefined && chain.unit !== 'mm' && chain.unit !== 'in') {
    errors.push(`chain ${chain.id || '<unnamed>'}: unit must be 'mm' or 'in'`);
  }

  if (!Array.isArray(chain.points) || chain.points.length === 0) {
    errors.push(`chain ${chain.id || '<unnamed>'}: must have at least one point`);
  } else {
    const seen = new Set<string>();
    for (const p of chain.points) {
      if (!p.id) {
        errors.push(`chain ${chain.id}: point has empty id`);
        continue;
      }
      if (seen.has(p.id)) {
        errors.push(`chain ${chain.id}: duplicate point id '${p.id}'`);
      }
      seen.add(p.id);
      if (!isFiniteNumber(p.x) || !isFiniteNumber(p.y)) {
        errors.push(`chain ${chain.id}: point '${p.id}' has non-finite coords`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function assertValid(chain: OrdinateDimensionChain): void {
  const r = validateOrdinateChain(chain);
  if (!r.ok) {
    throw new OrdinateError(
      `invalid ordinate chain: ${r.errors.join('; ')}`,
    );
  }
}

// ─── value computation ──────────────────────────────────────────────────

export function computeOrdinateValues(
  chain: OrdinateDimensionChain,
): OrdinateValue[] {
  assertValid(chain);
  const precision = chain.precision ?? 2;
  const unit = chain.unit ?? 'mm';
  const out: OrdinateValue[] = [];
  for (const p of chain.points) {
    if (chain.axis === 'x' || chain.axis === 'both') {
      const v = p.x - chain.origin.x;
      out.push({
        pointId: p.id,
        axis: 'x',
        value: v,
        formatted: formatValue(v, precision, unit),
      });
    }
    if (chain.axis === 'y' || chain.axis === 'both') {
      const v = p.y - chain.origin.y;
      out.push({
        pointId: p.id,
        axis: 'y',
        value: v,
        formatted: formatValue(v, precision, unit),
      });
    }
  }
  return out;
}

function formatValue(value: number, precision: number, unit: string): string {
  // toFixed handles -0 by emitting "-0.00"; normalize that to "0.00" so two
  // independent chains with identical magnitudes look identical.
  const normalized = Object.is(value, -0) ? 0 : value;
  return `${normalized.toFixed(precision)} ${unit}`;
}

// ─── render hints (stagger + leader lines) ──────────────────────────────

export function buildOrdinateRenderHints(
  chain: OrdinateDimensionChain,
): OrdinateRenderHint[] {
  assertValid(chain);
  const values = computeOrdinateValues(chain);

  // Cluster per-axis values that are within STAGGER_THRESHOLD of one
  // another so overlapping labels get fanned out across rows/columns.
  const perAxis: Record<'x' | 'y', OrdinateValue[]> = { x: [], y: [] };
  for (const v of values) perAxis[v.axis].push(v);

  const layerByPointAxis = new Map<string, number>();
  for (const axis of ['x', 'y'] as const) {
    assignStaggerLayers(perAxis[axis]).forEach((layer, idx) => {
      const v = perAxis[axis][idx];
      layerByPointAxis.set(keyOf(v.pointId, axis), layer);
    });
  }

  const hints: OrdinateRenderHint[] = [];
  for (const v of values) {
    const layer = layerByPointAxis.get(keyOf(v.pointId, v.axis)) ?? 0;
    const point = chain.points.find((p) => p.id === v.pointId)!;
    const offset = LEADER_BASE_OFFSET + layer * STAGGER_STEP;

    let leaderStart: { x: number; y: number };
    let leaderEnd: { x: number; y: number };
    let textAngle: number;
    if (v.axis === 'x') {
      // X-axis ordinates label the horizontal distance — leader goes UP
      // from the point's projection on the origin's X-axis row to the
      // text row above the part.
      leaderStart = { x: point.x, y: chain.origin.y };
      leaderEnd = { x: point.x, y: chain.origin.y - offset };
      textAngle = 0;
    } else {
      // Y-axis ordinates label the vertical distance — leader extends
      // RIGHT from the point's projection on the origin's Y-axis column
      // to a text column off to the right of the part.
      leaderStart = { x: chain.origin.x, y: point.y };
      leaderEnd = { x: chain.origin.x + offset, y: point.y };
      textAngle = Math.PI / 2;
    }

    hints.push({
      pointId: v.pointId,
      axis: v.axis,
      value: v.value,
      formatted: v.formatted,
      leaderStart,
      leaderEnd,
      textAngle,
      staggerLayer: layer,
    });
  }
  return hints;
}

function keyOf(pointId: string, axis: 'x' | 'y'): string {
  return `${axis}:${pointId}`;
}

/**
 * Greedy stagger assignment.
 *
 * The values are sorted by absolute distance from origin. For each value we
 * pick the lowest layer index whose previously-placed values are all
 * farther than STAGGER_THRESHOLD away along the measurement axis. This
 * keeps the most labels possible on the base row (layer 0) and only
 * promotes points that would actually collide. The returned array maps 1:1
 * with the input order (NOT sorted order) so callers can correlate with
 * the original `values` array by index.
 */
function assignStaggerLayers(values: OrdinateValue[]): number[] {
  const result = new Array<number>(values.length).fill(0);
  if (values.length <= 1) return result;

  // Process in sorted order but track original indices for the output.
  const sorted = values
    .map((v, idx) => ({ v, idx }))
    .sort((a, b) => Math.abs(a.v.value) - Math.abs(b.v.value));

  // For each layer, remember the values already placed there so we can
  // check the spacing constraint cheaply.
  const layers: number[][] = [];
  for (const { v, idx } of sorted) {
    let placed = false;
    for (let li = 0; li < layers.length; li++) {
      if (layers[li].every((existing) => Math.abs(existing - v.value) >= STAGGER_THRESHOLD)) {
        layers[li].push(v.value);
        result[idx] = li;
        placed = true;
        break;
      }
    }
    if (!placed) {
      layers.push([v.value]);
      result[idx] = layers.length - 1;
    }
  }
  return result;
}

// ─── chain merging ──────────────────────────────────────────────────────

const ORIGIN_EPSILON = 1e-9;

/**
 * Merge chains that share the same origin AND axis configuration. Chains
 * with distinct origins or distinct axis selections remain separate (a
 * different datum is, by definition, a different ordinate chain).
 *
 * The merged chain keeps the FIRST chain's id, precision, and unit so the
 * caller can predict which authoring chain wins. Points are concatenated
 * in input order; duplicate ids across merged chains throw an
 * {@link OrdinateError} because silent renaming would surprise the
 * renderer when it looks the id up later.
 */
export function mergeOrdinateChains(
  chains: OrdinateDimensionChain[],
): OrdinateDimensionChain[] {
  const groups: OrdinateDimensionChain[] = [];
  for (const chain of chains) {
    const target = groups.find(
      (g) =>
        g.axis === chain.axis &&
        Math.abs(g.origin.x - chain.origin.x) < ORIGIN_EPSILON &&
        Math.abs(g.origin.y - chain.origin.y) < ORIGIN_EPSILON,
    );
    if (target) {
      const seen = new Set(target.points.map((p) => p.id));
      for (const p of chain.points) {
        if (seen.has(p.id)) {
          throw new OrdinateError(
            `mergeOrdinateChains: duplicate point id '${p.id}' across chains sharing origin`,
          );
        }
        target.points.push(p);
        seen.add(p.id);
      }
    } else {
      groups.push({
        ...chain,
        // Defensive shallow copy so callers can keep mutating their input.
        origin: { ...chain.origin },
        points: [...chain.points],
      });
    }
  }
  return groups;
}
