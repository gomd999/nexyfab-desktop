/**
 * ingestStl.ts — REAL Node/TS ingest for ONE format (STL) → IR.
 *
 * This is a genuine parser (binary + ASCII STL), not a fixture read. It is the honest,
 * end-to-end "CAD file → IR" path for the slice. STL is chosen because it is the largest
 * fixture set (678 files) and the mesh measurement it needs is already implemented here.
 *
 * Honesty: STL carries NO unit declaration, so `extent.units = null` /
 * `units_source = 'unknown'` and absolute dimensions are recorded but flagged un-trustworthy —
 * exactly what ir-schema.md §불변 규칙 1 requires. Topology/features are left null (a mesh has
 * no B-rep topology), and grade is capped accordingly.
 *
 * Other formats (STEP/DXF/IFC/…) are fixture-fed for this slice: their `.ir.json` files from
 * 참고파일들/result/ir/ are read through `normalizeIr` (see schema.ts). This split is stated
 * plainly: STL = real-parsed here; the rest = ported fixtures.
 */

import { createHash } from 'node:crypto';
import type { Ir, IrExtent, IrReconstruct, Vec3 } from './schema';
import { analyzeIndexed, trianglesToIndexed } from './meshAnalysis';
import type { TriangleSoup } from './meshAnalysis';

function isAsciiStl(buf: Uint8Array): boolean {
  // Binary STL is 80-byte header + uint32 count + 50*count bytes. If the byte length matches
  // that exactly it is binary regardless of a leading "solid" token (some binary files lie).
  if (buf.length < 84) return true;
  const count = new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint32(80, true);
  const expected = 84 + count * 50;
  if (buf.length === expected) return false;
  // Otherwise sniff the leading token.
  const head = new TextDecoder().decode(buf.subarray(0, 5)).toLowerCase();
  return head === 'solid';
}

function parseBinaryStl(buf: Uint8Array): TriangleSoup {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const count = dv.getUint32(80, true);
  const tris: TriangleSoup = [];
  let off = 84;
  for (let i = 0; i < count && off + 50 <= buf.length; i++) {
    off += 12; // skip normal
    const p: Vec3[] = [];
    for (let k = 0; k < 3; k++) {
      p.push([dv.getFloat32(off, true), dv.getFloat32(off + 4, true), dv.getFloat32(off + 8, true)]);
      off += 12;
    }
    off += 2; // attribute byte count
    tris.push(p);
  }
  return tris;
}

function parseAsciiStl(text: string): TriangleSoup {
  const tris: TriangleSoup = [];
  const re = /vertex\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)/g;
  let cur: Vec3[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    cur.push([parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])]);
    if (cur.length === 3) {
      tris.push(cur);
      cur = [];
    }
  }
  return tris;
}

export function parseStl(buf: Uint8Array): { triangles: TriangleSoup; format: 'ascii' | 'binary' } {
  if (isAsciiStl(buf)) {
    return { triangles: parseAsciiStl(new TextDecoder().decode(buf)), format: 'ascii' };
  }
  return { triangles: parseBinaryStl(buf), format: 'binary' };
}

function gradeMesh(m: ReturnType<typeof analyzeIndexed>): IrReconstruct {
  const blockers: string[] = [];
  if (!m.watertight) blockers.push('non-watertight mesh');
  if (m.nonManifold) blockers.push('non-manifold edges');
  // A mesh has no B-rep topology, so it cannot be an A (parametric) grade. Best case is D:
  // it round-trips as an import stub. This is deliberately conservative per ir-schema.md.
  const grade: IrReconstruct['grade'] = m.ok && m.watertight ? 'D' : 'F';
  return {
    grade,
    score: grade === 'D' ? 0.5 : 0,
    strategy: grade === 'D' ? 'mesh_import' : 'none',
    rationale:
      grade === 'D'
        ? 'STL mesh: watertight but no B-rep topology/units. import() stub only — not sent to the parametric fleet.'
        : 'STL mesh not watertight/manifold — cannot be trusted for reconstruction.',
    est_tokens: null,
    blockers,
  };
}

/** Parse a raw STL buffer into a normalized IR. `path`/`name` describe the source file. */
export function stlToIr(buf: Uint8Array, opts: { path: string; name: string; source_hint?: string | null }): Ir {
  const t0 = Date.now();
  const { triangles, format } = parseStl(buf);
  const indexed = trianglesToIndexed(triangles);
  const m = analyzeIndexed(indexed);
  const sha256 = createHash('sha256').update(buf).digest('hex');

  const size: Vec3 | null = m.extents;
  const centroid: Vec3 | null =
    m.bboxMin && m.bboxMax
      ? [(m.bboxMin[0] + m.bboxMax[0]) / 2, (m.bboxMin[1] + m.bboxMax[1]) / 2, (m.bboxMin[2] + m.bboxMax[2]) / 2]
      : null;

  let aspect: IrExtent['aspect'] = null;
  if (size) {
    const s = [...size].sort((a, b) => b - a);
    const r = s[0] / (s[2] || 1e-9);
    aspect = r > 8 ? 'rod' : s[2] / (s[0] || 1) < 0.15 ? 'plate' : 'block';
  }

  return {
    ir_version: '1',
    identity: { path: opts.path, name: opts.name, format: 'STL', bytes: buf.length, sha256, source_hint: opts.source_hint ?? null },
    parse: { status: m.ok ? 'ok' : 'failed', parser: `stl_${format}_ts_v1`, elapsed_ms: Date.now() - t0, truncated: false, sampled_ratio: 1.0, warnings: m.nonManifold ? ['non-manifold edges present'] : [], error: m.ok ? null : m.error },
    extent: {
      // Honesty rule 1: STL declares no units → null, never guessed.
      units: null,
      units_source: 'unknown',
      bbox_min: m.bboxMin,
      bbox_max: m.bboxMax,
      size,
      centroid,
      aspect,
      is_2d: !!size && size[2] < 1e-6,
    },
    // A mesh has no analytic B-rep topology; leave null rather than fabricate surface types.
    topology: null,
    features: null,
    symmetry: null,
    assembly: null,
    mesh: {
      triangles: m.triangles,
      vertices: m.vertices,
      watertight: m.watertight,
      // Volume is in the STL's native (unknown) unit³; flag it rather than claim mm³.
      volume_mm3: m.volume,
      volume_mm3_unit_warning: 'STL has no units — value is native-unit³, not necessarily mm³',
      area_mm2: m.area,
      components: m.bodyCount,
      planar_clusters: null,
      normal_histogram_peaks: null,
      curvature_bins: null,
      primitive_fit: null,
      degenerate_faces: null,
    },
    semantics: null,
    reconstruct: gradeMesh(m),
  };
}
