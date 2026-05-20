/**
 * vertexPaint.ts — Vertex-color painting with stroke history.
 *
 * Lets the user paint colors directly onto mesh vertices using a
 * "stroke" interaction (like ZBrush PolyPaint). Per-vertex color
 * later bakes into texture maps or exports as glTF vertex attribute.
 *
 * Features:
 *
 *   - **Stroke recording** — every brush stroke captured with brush
 *     params + affected vertices + previous colors, so the user can
 *     undo / redo per stroke (not per vertex).
 *   - **Brush kernel** — distance-from-stroke-center falloff.
 *   - **Color blends** — paint over (replace), multiply, add, mix.
 *   - **Layered painting** — multiple layers like Photoshop; each can
 *     be hidden / opacity-adjusted / merged.
 *
 * Output: per-vertex RGB array. Renderer reads it as a vertex
 * attribute (no texture needed for "low-fi" painted look).
 */

export type RGB = [number, number, number];
export type Vec3 = [number, number, number];

export interface BrushStroke {
  id: string;
  /** When the stroke happened (ms epoch). */
  timestamp: number;
  /** Brush settings used. */
  brush: BrushSettings;
  /** Per-affected-vertex previous color (for undo). */
  beforeColors: Map<number, RGB>;
  /** Per-affected-vertex new color. */
  afterColors: Map<number, RGB>;
}

export interface BrushSettings {
  /** Color applied. */
  color: RGB;
  /** Brush radius in world units (mm). */
  radiusMm: number;
  /** Falloff: 0 = constant, 1 = linear, 2 = quadratic. */
  falloff: number;
  /** Blend mode. */
  blendMode: BlendMode;
  /** Brush opacity 0..1. */
  opacity: number;
}

export type BlendMode = 'replace' | 'multiply' | 'add' | 'mix';

export interface PaintLayer {
  id: string;
  name: string;
  /** Per-vertex RGB color, in mesh vertex order. */
  colors: RGB[];
  /** Layer opacity 0..1. */
  opacity: number;
  /** Hidden from compositing? */
  hidden: boolean;
}

// ── Paint session ───────────────────────────────────────────────

export class PaintSession {
  vertexPositions: Vec3[];
  layers: PaintLayer[] = [];
  /** Strokes in chronological order. */
  strokes: BrushStroke[] = [];
  /** Index pointing at the next stroke (for redo). */
  redoStack: BrushStroke[] = [];

  constructor(vertexPositions: Vec3[]) {
    this.vertexPositions = vertexPositions;
  }

  // ── Layer CRUD ──────────────────────────────────────────────

  addLayer(name: string, baseColor: RGB = [1, 1, 1]): PaintLayer {
    const layer: PaintLayer = {
      id: `layer-${this.layers.length}`,
      name,
      colors: this.vertexPositions.map(() => [...baseColor] as RGB),
      opacity: 1,
      hidden: false,
    };
    this.layers.push(layer);
    return layer;
  }

  getLayer(id: string): PaintLayer | null {
    return this.layers.find(l => l.id === id) ?? null;
  }

  setLayerOpacity(id: string, opacity: number): void {
    const l = this.getLayer(id);
    if (l) l.opacity = Math.max(0, Math.min(1, opacity));
  }

  toggleLayerVisibility(id: string): void {
    const l = this.getLayer(id);
    if (l) l.hidden = !l.hidden;
  }

  // ── Apply stroke ────────────────────────────────────────────

  applyStroke(layerId: string, brush: BrushSettings, brushCenter: Vec3): BrushStroke {
    const layer = this.getLayer(layerId);
    if (!layer) throw new Error(`Unknown layer ${layerId}`);
    const affected = this.findAffectedVertices(brushCenter, brush.radiusMm);
    const before = new Map<number, RGB>();
    const after = new Map<number, RGB>();
    for (const { index, distance } of affected) {
      const weight = falloffWeight(distance, brush.radiusMm, brush.falloff) * brush.opacity;
      if (weight <= 0) continue;
      const prev = [...layer.colors[index]!] as RGB;
      before.set(index, prev);
      const next = blendColor(prev, brush.color, brush.blendMode, weight);
      layer.colors[index] = next;
      after.set(index, next);
    }
    const stroke: BrushStroke = {
      id: `stroke-${this.strokes.length}`,
      timestamp: Date.now(),
      brush: { ...brush, color: [...brush.color] as RGB },
      beforeColors: before,
      afterColors: after,
    };
    this.strokes.push(stroke);
    this.redoStack = [];
    return stroke;
  }

  // ── Undo / redo ─────────────────────────────────────────────

  undo(): BrushStroke | null {
    const stroke = this.strokes.pop();
    if (!stroke) return null;
    // Find the layer that the stroke applied to (search all layers).
    for (const layer of this.layers) {
      for (const [idx, color] of stroke.beforeColors) {
        if (this.colorEquals(layer.colors[idx]!, stroke.afterColors.get(idx)!)) {
          layer.colors[idx] = [...color] as RGB;
        }
      }
    }
    this.redoStack.push(stroke);
    return stroke;
  }

  redo(): BrushStroke | null {
    const stroke = this.redoStack.pop();
    if (!stroke) return null;
    for (const layer of this.layers) {
      for (const [idx, color] of stroke.afterColors) {
        if (this.colorEquals(layer.colors[idx]!, stroke.beforeColors.get(idx)!)) {
          layer.colors[idx] = [...color] as RGB;
        }
      }
    }
    this.strokes.push(stroke);
    return stroke;
  }

  private colorEquals(a: RGB, b: RGB): boolean {
    return Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6 && Math.abs(a[2] - b[2]) < 1e-6;
  }

  // ── Composite ───────────────────────────────────────────────

  composite(): RGB[] {
    const N = this.vertexPositions.length;
    const out: RGB[] = Array.from({ length: N }, () => [1, 1, 1] as RGB);
    for (const layer of this.layers) {
      if (layer.hidden) continue;
      for (let i = 0; i < N; i++) {
        const c = layer.colors[i]!;
        const a = layer.opacity;
        out[i] = [
          out[i]![0] * (1 - a) + c[0] * a,
          out[i]![1] * (1 - a) + c[1] * a,
          out[i]![2] * (1 - a) + c[2] * a,
        ];
      }
    }
    return out;
  }

  // ── Merge layers ────────────────────────────────────────────

  mergeLayerDown(layerId: string): void {
    const idx = this.layers.findIndex(l => l.id === layerId);
    if (idx <= 0) return;
    const top = this.layers[idx]!;
    const bottom = this.layers[idx - 1]!;
    for (let v = 0; v < bottom.colors.length; v++) {
      const t = top.colors[v]!;
      const b = bottom.colors[v]!;
      const a = top.opacity;
      bottom.colors[v] = [
        b[0] * (1 - a) + t[0] * a,
        b[1] * (1 - a) + t[1] * a,
        b[2] * (1 - a) + t[2] * a,
      ];
    }
    this.layers.splice(idx, 1);
  }

  // ── Vertex picker ───────────────────────────────────────────

  private findAffectedVertices(center: Vec3, radius: number): Array<{ index: number; distance: number }> {
    const out: Array<{ index: number; distance: number }> = [];
    for (let i = 0; i < this.vertexPositions.length; i++) {
      const p = this.vertexPositions[i]!;
      const d = Math.hypot(p[0] - center[0], p[1] - center[1], p[2] - center[2]);
      if (d <= radius) out.push({ index: i, distance: d });
    }
    return out;
  }

  // ── Serialization ───────────────────────────────────────────

  serialize(): SerializedSession {
    return {
      version: 1,
      vertexPositions: this.vertexPositions,
      layers: this.layers.map(l => ({
        id: l.id, name: l.name, opacity: l.opacity, hidden: l.hidden,
        colors: l.colors.map(c => [...c] as RGB),
      })),
    };
  }
}

export interface SerializedSession {
  version: number;
  vertexPositions: Vec3[];
  layers: Array<{ id: string; name: string; opacity: number; hidden: boolean; colors: RGB[] }>;
}

// ── Brush kernel ───────────────────────────────────────────────

export function falloffWeight(distance: number, radius: number, exponent: number): number {
  if (radius <= 0) return 0;
  const t = Math.min(1, distance / radius);
  return Math.max(0, Math.pow(1 - t, exponent));
}

// ── Color blend ────────────────────────────────────────────────

export function blendColor(prev: RGB, brush: RGB, mode: BlendMode, weight: number): RGB {
  const w = Math.max(0, Math.min(1, weight));
  switch (mode) {
    case 'replace':
      return [
        prev[0] * (1 - w) + brush[0] * w,
        prev[1] * (1 - w) + brush[1] * w,
        prev[2] * (1 - w) + brush[2] * w,
      ];
    case 'multiply':
      return [
        prev[0] * (1 - w + w * brush[0]),
        prev[1] * (1 - w + w * brush[1]),
        prev[2] * (1 - w + w * brush[2]),
      ];
    case 'add':
      return [
        Math.min(1, prev[0] + brush[0] * w),
        Math.min(1, prev[1] + brush[1] * w),
        Math.min(1, prev[2] + brush[2] * w),
      ];
    case 'mix':
      return [
        prev[0] * (1 - w * 0.5) + brush[0] * w * 0.5,
        prev[1] * (1 - w * 0.5) + brush[1] * w * 0.5,
        prev[2] * (1 - w * 0.5) + brush[2] * w * 0.5,
      ];
  }
}
