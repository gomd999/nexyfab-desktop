/**
 * bomBalloon — Phase 3 of the SolidWorks-parity roadmap
 * (docs/process/solidworks-parity-roadmap.md): assembly-drawing BOM table
 * + auto balloons.
 *
 * Pure logic only (no React/DOM/Three) — same layering as {@link ./holeTable}
 * and {@link ./bom}. Two responsibilities:
 *
 *   1. `buildBomRows(parts)` — collapse an assembly's part-instance list
 *      into deduplicated BOM rows (item no. / name / qty / material).
 *      Deterministic item numbering: rows are sorted ascending by part
 *      NAME (codepoint order), ties broken by material — chosen over
 *      insertion order so the numbering is stable regardless of how the
 *      assembly state happens to list its instances.
 *
 *   2. `placeBalloons(opts)` — auto-place one circled item-number balloon
 *      per part instance around the main view's perimeter, leader-anchored
 *      at the part's projected 2D position.
 *
 * Balloon placement algorithm (v1):
 *   - Build a "ring" rectangle = the viewport box expanded outward by
 *     `standoff` mm on every side.
 *   - For each anchor, shoot a ray from the box centre through the anchor
 *     and intersect it with the ring rectangle → the balloon's initial
 *     position, expressed as an arc-length parameter t along the ring
 *     perimeter (counter-clockwise from the bottom-left corner).
 *   - Collision avoidance: sort balloons by t and enforce a minimum
 *     arc-length spacing of (2·radius + gap)·√2 between neighbours with a
 *     forward pass. The √2 factor covers the corner worst case, where two
 *     points with arc gap g sit only g/√2 apart in Euclidean distance.
 *     If the forward pass wraps past the available perimeter (cyclic
 *     clash between last and first), fall back to distributing all
 *     balloons evenly around the ring in their sorted order.
 *   - Map each final t back to an (x, y) point on the ring rectangle.
 *
 * Coordinate frame: everything is sheet mm-space with a bottom-left
 * (Y-up) origin — the Sheet IR convention. The renderer flips Y.
 *
 * Out of scope (later phases):
 *   - Manual balloon repositioning (drag) — the IR carries explicit
 *     center positions so a future editor can overwrite them.
 *   - Stacked / split balloons (qty inside the balloon).
 */

// ─── types ───────────────────────────────────────────────────────────────

export interface BomItemRow {
  /** 1-based item number — deterministic (rows sorted by name asc). */
  itemNo: number;
  /** Part display name (the dedup key together with material). */
  name: string;
  /** Number of identical instances collapsed into this row. */
  qty: number;
  /** Material label; empty string when unknown. */
  material: string;
}

export interface BomBalloon {
  /** Unique id within a sheet (one balloon per part INSTANCE). */
  id: string;
  /** BOM row this balloon references (duplicates allowed across balloons). */
  itemNo: number;
  /** Leader endpoint on the part, sheet mm (bottom-left origin). */
  anchor: { x: number; y: number };
  /** Balloon circle centre, sheet mm (bottom-left origin). */
  center: { x: number; y: number };
  /** Circle radius (mm). */
  radius: number;
}

export interface BomPartLike {
  name: string;
  /** Optional material label. Missing/empty → blank column. */
  material?: string;
}

export interface BalloonAnchor {
  /** Unique id for the resulting balloon (typically the part-instance id). */
  id: string;
  /** BOM item number this balloon points at. */
  itemNo: number;
  /** Projected 2D position of the part (sheet mm, bottom-left origin). */
  anchor: { x: number; y: number };
}

export interface PlaceBalloonsOptions {
  anchors: ReadonlyArray<BalloonAnchor>;
  /** Main-view viewport box in sheet mm (bottom-left origin). */
  box: { x: number; y: number; w: number; h: number };
  /** Balloon circle radius (mm). Default 4. */
  radius?: number;
  /** Distance from the viewport box to the balloon ring (mm). Default 10. */
  standoff?: number;
  /** Extra rim-to-rim clearance between neighbouring balloons (mm). Default 2. */
  gap?: number;
}

// ─── errors ──────────────────────────────────────────────────────────────

export class BomBalloonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BomBalloonError';
  }
}

// ─── BOM rows ────────────────────────────────────────────────────────────

/** Unit-separator control char — cannot occur in part names / materials. */
const GROUP_SEP = String.fromCharCode(31);

/**
 * Dedup key for a part: name + material. Exported so callers that need to
 * map a part instance back to its BOM row (e.g. for balloon item numbers)
 * use the exact same grouping rule.
 */
export function bomGroupKey(part: BomPartLike): string {
  return `${part.name}${GROUP_SEP}${part.material ?? ''}`;
}

/**
 * Collapse a part-instance list into BOM rows. Identical (name, material)
 * pairs merge into one row with `qty` = instance count. Rows are sorted
 * ascending by name (codepoint order), ties by material; `itemNo` is the
 * 1-based index after sorting — deterministic across runs and input order.
 */
export function buildBomRows(parts: ReadonlyArray<BomPartLike>): BomItemRow[] {
  if (!Array.isArray(parts)) {
    throw new BomBalloonError('buildBomRows: parts must be an array');
  }
  const groups = new Map<string, { name: string; material: string; qty: number }>();
  parts.forEach((p, i) => {
    if (!p || typeof p.name !== 'string' || p.name.length === 0) {
      throw new BomBalloonError(`buildBomRows: parts[${i}] has an empty name`);
    }
    const key = bomGroupKey(p);
    const existing = groups.get(key);
    if (existing) existing.qty += 1;
    else groups.set(key, { name: p.name, material: p.material ?? '', qty: 1 });
  });
  const sorted = [...groups.values()].sort(
    (a, b) =>
      (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
      || (a.material < b.material ? -1 : a.material > b.material ? 1 : 0),
  );
  return sorted.map((g, i) => ({
    itemNo: i + 1,
    name: g.name,
    qty: g.qty,
    material: g.material,
  }));
}

/**
 * Convenience: itemNo lookup keyed by {@link bomGroupKey} for mapping part
 * instances onto the rows produced by {@link buildBomRows}.
 */
export function bomItemNoIndex(rows: ReadonlyArray<BomItemRow>): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    out.set(bomGroupKey({ name: r.name, material: r.material }), r.itemNo);
  }
  return out;
}

// ─── balloon placement ───────────────────────────────────────────────────

interface Rect { x: number; y: number; w: number; h: number }

/**
 * Intersect a ray from the rect centre along (dx, dy) with the rect
 * boundary. (dx, dy) must not be the zero vector.
 */
function rayRectIntersect(rect: Rect, dx: number, dy: number): { x: number; y: number } {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const kx = dx !== 0 ? (rect.w / 2) / Math.abs(dx) : Infinity;
  const ky = dy !== 0 ? (rect.h / 2) / Math.abs(dy) : Infinity;
  const k = Math.min(kx, ky);
  return { x: cx + dx * k, y: cy + dy * k };
}

/**
 * Arc-length parameter t ∈ [0, perimeter) of a boundary point, walking the
 * rectangle counter-clockwise from the bottom-left corner:
 *   bottom edge (L→R) → right edge (B→T) → top edge (R→L) → left edge (T→B).
 */
function perimeterParam(rect: Rect, p: { x: number; y: number }): number {
  const eps = 1e-6;
  const relX = Math.min(Math.max(p.x - rect.x, 0), rect.w);
  const relY = Math.min(Math.max(p.y - rect.y, 0), rect.h);
  if (Math.abs(p.y - rect.y) < eps) return relX; // bottom
  if (Math.abs(p.x - (rect.x + rect.w)) < eps) return rect.w + relY; // right
  if (Math.abs(p.y - (rect.y + rect.h)) < eps) return rect.w + rect.h + (rect.w - relX); // top
  return 2 * rect.w + rect.h + (rect.h - relY); // left
}

/** Inverse of {@link perimeterParam}: walk t mm along the boundary CCW. */
function pointAtParam(rect: Rect, t: number): { x: number; y: number } {
  const P = 2 * (rect.w + rect.h);
  let s = t % P;
  if (s < 0) s += P;
  if (s < rect.w) return { x: rect.x + s, y: rect.y };
  s -= rect.w;
  if (s < rect.h) return { x: rect.x + rect.w, y: rect.y + s };
  s -= rect.h;
  if (s < rect.w) return { x: rect.x + rect.w - s, y: rect.y + rect.h };
  s -= rect.w;
  return { x: rect.x, y: rect.y + rect.h - s };
}

/**
 * Auto-place balloons on a ring around the viewport box. See the module
 * JSDoc for the algorithm. Returns one balloon per anchor, in the order
 * the anchors were supplied.
 */
export function placeBalloons(opts: PlaceBalloonsOptions): BomBalloon[] {
  const { anchors, box } = opts;
  const radius = opts.radius ?? 4;
  const standoff = opts.standoff ?? 10;
  const gap = opts.gap ?? 2;
  if (!Array.isArray(anchors)) {
    throw new BomBalloonError('placeBalloons: anchors must be an array');
  }
  if (!(box.w > 0) || !(box.h > 0)) {
    throw new BomBalloonError('placeBalloons: box must have positive extents');
  }
  if (!(radius > 0)) {
    throw new BomBalloonError('placeBalloons: radius must be positive');
  }
  if (anchors.length === 0) return [];

  const ring: Rect = {
    x: box.x - standoff,
    y: box.y - standoff,
    w: box.w + 2 * standoff,
    h: box.h + 2 * standoff,
  };
  if (Math.min(ring.w, ring.h) < 2 * radius) {
    throw new BomBalloonError(
      'placeBalloons: ring rectangle is too small for the balloon radius',
    );
  }
  const P = 2 * (ring.w + ring.h);
  const minGap = (2 * radius + gap) * Math.SQRT2;
  if (anchors.length * 2 * radius >= P) {
    throw new BomBalloonError(
      `placeBalloons: ${anchors.length} balloons of radius ${radius} cannot fit on a ${P.toFixed(1)} mm perimeter`,
    );
  }

  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const seen = new Set<string>();
  const items = anchors.map((a, i) => {
    if (!a.id) throw new BomBalloonError(`placeBalloons: anchors[${i}] has an empty id`);
    if (seen.has(a.id)) {
      throw new BomBalloonError(`placeBalloons: duplicate anchor id ${a.id}`);
    }
    seen.add(a.id);
    let dx = a.anchor.x - cx;
    let dy = a.anchor.y - cy;
    if (dx === 0 && dy === 0) {
      // Degenerate anchor at the exact centre — send it right.
      dx = 1;
      dy = 0;
    }
    const hit = rayRectIntersect(ring, dx, dy);
    return { ...a, t: perimeterParam(ring, hit) };
  });

  // Deterministic sort: arc param, then id for exact ties.
  items.sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const n = items.length;
  const ts = items.map((it) => it.t);
  if (n * minGap >= P) {
    // Too crowded for the preferred spacing — distribute evenly (still
    // guaranteed ≥ 2·radius apart by the hard-fit check above only when
    // P/n ≥ 2r·√2; best-effort beyond that).
    for (let i = 0; i < n; i += 1) ts[i] = (ts[0] + (i * P) / n) % P;
  } else {
    // Forward pass anchored at the first balloon.
    for (let i = 1; i < n; i += 1) {
      if (ts[i] < ts[i - 1] + minGap) ts[i] = ts[i - 1] + minGap;
    }
    // Cyclic clash: the pushed-forward tail wraps onto the head.
    if (ts[n - 1] - ts[0] > P - minGap) {
      for (let i = 0; i < n; i += 1) ts[i] = (ts[0] + (i * P) / n) % P;
    }
  }

  return items.map((it, i) => ({
    id: `balloon-${it.id}`,
    itemNo: it.itemNo,
    anchor: { x: it.anchor.x, y: it.anchor.y },
    center: pointAtParam(ring, ts[i]),
    radius,
  }));
}
