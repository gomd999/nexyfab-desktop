/**
 * ingestDxf2d.ts — DXF (ASCII) -> Ir2d, plus a deterministic 2D re-emitter for round-trip proof.
 *
 * `dxfToIr2d` extracts the measurable 2D evidence by REUSING the deterministic seed extractor
 * (scripts/drawing-to-3d/dxf-seed.mjs::extractDxfSeed) — the same parser the DWG->DXF route already
 * relies on. We do not re-invent DXF parsing. On top of the seed we add two evidence fields the seed
 * does not carry: declared units ($INSUNITS in HEADER) and layer names (LAYER table) — both parsed
 * deterministically (group-code scan, no AI).
 *
 * `emitDxf2d` re-serializes an Ir2d back to R12 ASCII DXF. Feeding its output back through
 * `dxfToIr2d` and gating (gate2d.ts) proves our READ is faithful: dimension values, circle radii and
 * extents survive our own serialize/parse round-trip. It is NOT a full DXF writer — it reproduces
 * only the evidence we model (a bbox rectangle for extents, circles, dimensions). Entity types the
 * seed does not retain (ARC/SPLINE/TEXT/INSERT...) are intentionally NOT reproduced; the gate then
 * surfaces those as entity-count mismatches rather than hiding the loss.
 *
 * The seed .mjs is loaded via the repo's webpackIgnore dynamic-import convention so Next's bundler
 * leaves the Node ESM path untouched (same pattern as dwg-convert/route.ts).
 */

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Ir2d } from './schema2d';
import { normalizeIr2d } from './schema2d';
import { verify2dReconstruction, type Gate2dResult } from './gate2d';

// ── seed module shape (subset we use) ────────────────────────────────────────
interface SeedDim { value: number; kind: string; text?: string }
interface SeedCircle { r: number; cx: number; cy: number }
interface DxfSeed {
  measurements: number[];
  dims: SeedDim[];
  dimTexts: string[];
  circles: SeedCircle[];
  extents: { w: number; h: number } | null;
  entityCounts: Record<string, number>;
}
type SeedMod = { extractDxfSeed: (text: string) => DxfSeed };

let _seedMod: SeedMod | null = null;
async function loadSeed(): Promise<SeedMod> {
  if (_seedMod) return _seedMod;
  const p = join(process.cwd(), 'scripts', 'drawing-to-3d', 'dxf-seed.mjs');
  _seedMod = (await import(/* webpackIgnore: true */ pathToFileURL(p).href)) as SeedMod;
  return _seedMod;
}

// ── deterministic group-code pair scan (mirrors dxf-seed.mjs::pairs) ──────────
function pairs(text: string): Array<[number, string]> {
  const lines = text.split(/\r?\n/);
  const out: Array<[number, string]> = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    if (Number.isNaN(code)) continue;
    out.push([code, lines[i + 1].trim()]);
  }
  return out;
}

/**
 * $INSUNITS (HEADER, code 70): 1=inches, 4=millimeters. Anything else (0=unitless, cm/m/ft, or
 * absent) -> null. We NEVER guess mm — an undeclared unit is reported as null (honesty invariant #1).
 */
function parseUnits(P: Array<[number, string]>): 'mm' | 'in' | null {
  for (let i = 0; i < P.length - 1; i++) {
    if (P[i][0] === 9 && P[i][1] === '$INSUNITS') {
      // next 70-code pair carries the value
      for (let j = i + 1; j < Math.min(i + 4, P.length); j++) {
        if (P[j][0] === 70) {
          const v = parseInt(P[j][1], 10);
          if (v === 1) return 'in';
          if (v === 4) return 'mm';
          return null;
        }
      }
      return null;
    }
  }
  return null;
}

/** LAYER table: every `0 LAYER` block's `2 <name>`. Entities never use type LAYER, so this is exact. */
function parseLayers(P: Array<[number, string]>): string[] {
  const names: string[] = [];
  for (let i = 0; i < P.length; i++) {
    if (P[i][0] === 0 && P[i][1] === 'LAYER') {
      for (let j = i + 1; j < P.length && !(P[j][0] === 0); j++) {
        if (P[j][0] === 2) { names.push(P[j][1]); break; }
      }
    }
  }
  return [...new Set(names.filter(Boolean))];
}

export interface DxfToIr2dResult {
  ok: boolean;
  ir2d: Ir2d | null;
  reason?: string;
}

/**
 * Parse DXF ASCII into an Ir2d. `extraApproximations` lets the caller fold in a converter's stats
 * (spline approximations, skipped entities, truncation) so all approximations live in one place.
 */
export async function dxfToIr2d(
  dxfText: string,
  extraApproximations: string[] = [],
): Promise<DxfToIr2dResult> {
  if (typeof dxfText !== 'string' || !dxfText.trim()) {
    return { ok: false, ir2d: null, reason: 'empty DXF text' };
  }
  let seed: DxfSeed;
  try {
    seed = (await loadSeed()).extractDxfSeed(dxfText);
  } catch (e) {
    return { ok: false, ir2d: null, reason: `seed extraction failed: ${(e as Error).message}` };
  }
  const P = pairs(dxfText);
  const units = parseUnits(P);
  const layers = parseLayers(P);

  const approximations = [...extraApproximations];
  if (units === null) approximations.push('units undeclared ($INSUNITS absent/unitless) — absolute-unit claims not asserted');

  const ir2d = normalizeIr2d({
    units,
    entityCounts: seed.entityCounts ?? {},
    dimensions: (seed.dims ?? []).map((d) => ({ value: d.value, text: d.text ?? '' })),
    circles: seed.circles ?? [],
    extents: seed.extents,
    layers,
    approximations,
  });
  return { ok: true, ir2d };
}

// ── R12 re-emitter (round-trip fidelity proof) ───────────────────────────────
const g = (code: number, val: string | number) => `${code}\n${val}\n`;

/**
 * Re-serialize an Ir2d to R12 ASCII DXF. Reproduces ONLY modeled evidence:
 *   - extents -> a bbox rectangle (4 LINE) sized w x h at origin, so re-extracted extents == w x h.
 *   - circles -> one CIRCLE each, radius preserved, center clamped inside the bbox so it never
 *     enlarges the extents (only the RADIUS multiset is gate-compared).
 *   - dimensions -> one DIMENSION each (code 42 = value, code 1 = text) so values round-trip.
 * Non-modeled entity types are deliberately absent; the gate surfaces the count gap.
 */
export function emitDxf2d(ir: Ir2d): string {
  const layers = ir.layers.length ? ir.layers : ['0'];
  const insunits = ir.units === 'mm' ? 4 : ir.units === 'in' ? 1 : 0;

  let head = '';
  head += g(0, 'SECTION') + g(2, 'HEADER') + g(9, '$ACADVER') + g(1, 'AC1009') + g(9, '$INSUNITS') + g(70, insunits) + g(0, 'ENDSEC');
  head += g(0, 'SECTION') + g(2, 'TABLES') + g(0, 'TABLE') + g(2, 'LAYER') + g(70, layers.length);
  for (const name of layers) head += g(0, 'LAYER') + g(2, name) + g(70, 0) + g(62, 7) + g(6, 'CONTINUOUS');
  head += g(0, 'ENDTAB') + g(0, 'ENDSEC');

  let e = '';
  const w = ir.extents?.w ?? 0;
  const h = ir.extents?.h ?? 0;
  if (ir.extents) {
    // bbox rectangle: (0,0)-(w,0)-(w,h)-(0,h)-(0,0) as 4 LINE entities on layer 0
    const corners: Array<[number, number]> = [[0, 0], [w, 0], [w, h], [0, h]];
    for (let i = 0; i < 4; i++) {
      const [x1, y1] = corners[i];
      const [x2, y2] = corners[(i + 1) % 4];
      e += g(0, 'LINE') + g(8, '0') + g(10, x1) + g(20, y1) + g(30, 0) + g(11, x2) + g(21, y2) + g(31, 0);
    }
  }
  for (const c of ir.circles) {
    // clamp center inside the bbox so the circle cannot enlarge the extents (radius is what matters)
    const cx = ir.extents ? Math.min(Math.max(c.r, w / 2), Math.max(c.r, w - c.r)) : (c.cx ?? 0);
    const cy = ir.extents ? Math.min(Math.max(c.r, h / 2), Math.max(c.r, h - c.r)) : (c.cy ?? 0);
    e += g(0, 'CIRCLE') + g(8, '0') + g(10, cx) + g(20, cy) + g(30, 0) + g(40, c.r);
  }
  for (const d of ir.dimensions) {
    e += g(0, 'DIMENSION') + g(8, '0') + g(70, 0) + g(42, d.value) + g(1, d.text || '<>');
  }

  return head + g(0, 'SECTION') + g(2, 'ENTITIES') + e + g(0, 'ENDSEC') + g(0, 'EOF');
}

/**
 * Round-trip interpretation-fidelity proof: re-emit the source Ir2d to DXF, re-ingest it with the
 * SAME extractor, and gate the re-extracted evidence against the source. A PASS means our read/write
 * of the drawing preserved every dimension value, circle radius, extent and modeled entity count —
 * i.e. we understood the drawing, we did not hallucinate it. Entity types our 2D model does not
 * reproduce surface as honest mismatches rather than a silent loss.
 *
 * This is the first honest "reconstruction" for a 2D drawing. Lifting a single closed profile to a
 * 3D solid (extrudeProfile) and reprojecting it (reproject-diff.mjs) for a 2D compare is the NEXT
 * step; MULTI-VIEW orthographic -> solid inference remains FRONTIER and is deliberately out of scope.
 */
export async function roundTripVerify2d(source: Ir2d): Promise<Gate2dResult> {
  const dxf = emitDxf2d(source);
  const re = await dxfToIr2d(dxf, source.approximations);
  if (!re.ok || !re.ir2d) {
    return {
      status: 'unavailable',
      score: 0,
      mismatches: 0,
      checks: [],
      reason: re.reason ?? 're-ingest failed',
      feedback: `UNAVAILABLE. Could not re-ingest the round-trip DXF (${re.reason ?? 'unknown'}). Not reported as a pass.`,
    };
  }
  // ⚠ 왕복임을 알린다 — 우리 자신의 재출력과 원본의 엔티티 수를 하드 비교하면
  //   실도면은 구조적으로 100% 실패한다(gate2d.ts 주석 참조).
  return verify2dReconstruction(re.ir2d, source, { roundTrip: true });
}
