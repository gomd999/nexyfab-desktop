import * as THREE from 'three';
import { validateMesh } from '../features/meshValidation';
import { meshVolume } from '../features/roundingGuard';

/**
 * verifyGeneratedModel — Layer-1 (deterministic, engine-agnostic) verification
 * gate for AI-generated geometry. Runs the cheap, objective checks a generated
 * model must pass before any expensive Layer-2 (vision) critique:
 *
 *   • non-empty + finite positions
 *   • watertight (no open boundary edges) + manifold (no edge shared by >2)
 *   • bounding box within the requested size envelope
 *   • not riddled with degenerate / sliver triangles
 *   • positive solid volume
 *
 * (Self-intersection scanning is intentionally omitted here: the available
 * detector flags edge-adjacent triangles of valid closed solids as crossings,
 * which would mislead the self-correction loop. It needs welded input + proper
 * adjacency handling before it can be a reliable gate — a future refinement.)
 *
 * Returns structured, ACTIONABLE checks so the self-correction loop can feed a
 * precise critique back to the model. Works on any THREE.BufferGeometry, so it
 * is reused unchanged whether the mesh came from JSCAD or OpenSCAD-WASM.
 */

export interface ModelConstraints {
  /** Largest allowed extent on any axis (mm). */
  maxSizeMm?: number;
  /** Smallest allowed extent on any axis (mm) — guards collapsed output. */
  minSizeMm?: number;
  /** Require a closed solid (no open boundary edges). Default true. */
  requireWatertight?: boolean;
}

export interface ModelCheck {
  id: string;
  pass: boolean;
  severity: 'error' | 'warning';
  /** Actionable, model-facing message. */
  message: string;
}

export interface ModelVerificationResult {
  /** True when there are no error-severity failures. */
  pass: boolean;
  checks: ModelCheck[];
  metrics: {
    triangleCount: number;
    volumeMm3: number;
    bbox: { x: number; y: number; z: number };
    boundaryEdges: number;
  };
}

/** Count edges shared by exactly one triangle (open boundary) after welding
 *  coincident vertices — a watertight solid has zero. */
function boundaryEdgeCount(geo: THREE.BufferGeometry): number {
  const pos = geo.attributes.position;
  if (!pos) return 0;
  const idx = geo.index ? Array.from(geo.index.array as ArrayLike<number>) : Array.from({ length: pos.count }, (_, i) => i);
  const key = (i: number) => `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
  const vid = new Map<string, number>();
  const canon = (i: number) => { const k = key(i); let v = vid.get(k); if (v === undefined) { v = vid.size; vid.set(k, v); } return v; };
  const edges = new Map<string, number>();
  for (let t = 0; t < idx.length / 3; t++) {
    const a = canon(idx[t * 3]!), b = canon(idx[t * 3 + 1]!), c = canon(idx[t * 3 + 2]!);
    if (a === b || b === c || c === a) continue; // skip degenerate
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const ek = u < v ? `${u}_${v}` : `${v}_${u}`;
      edges.set(ek, (edges.get(ek) ?? 0) + 1);
    }
  }
  let boundary = 0;
  for (const count of edges.values()) if (count === 1) boundary++;
  return boundary;
}

export function verifyGeneratedModel(
  geometry: THREE.BufferGeometry,
  constraints: ModelConstraints = {},
): ModelVerificationResult {
  const requireWatertight = constraints.requireWatertight ?? true;
  const checks: ModelCheck[] = [];

  const pos = geometry.attributes.position as THREE.BufferAttribute | undefined;
  const triangleCount = pos ? (geometry.index ? geometry.index.count / 3 : pos.count / 3) : 0;

  // 1. non-empty
  if (triangleCount === 0) {
    checks.push({ id: 'non-empty', pass: false, severity: 'error', message: 'The model is empty (no geometry was produced). The code likely renders nothing — check that the top-level object is actually emitted.' });
    return { pass: false, checks, metrics: { triangleCount: 0, volumeMm3: 0, bbox: { x: 0, y: 0, z: 0 }, boundaryEdges: 0 } };
  }
  checks.push({ id: 'non-empty', pass: true, severity: 'error', message: `Produced ${triangleCount} triangles.` });

  // 2. validity (finite positions, indices in range, degeneracy/slivers, manifold)
  const mv = validateMesh(geometry, { topology: true, degeneracy: true });
  for (const issue of mv.issues) {
    if (issue.code === 'non-finite-position' || issue.code === 'index-out-of-range' || issue.code === 'no-position') {
      checks.push({ id: issue.code, pass: false, severity: 'error', message: `${issue.message} (${issue.count}) — invalid geometry data.` });
    } else if (issue.code === 'non-manifold-edge') {
      checks.push({ id: 'manifold', pass: false, severity: 'error', message: `Non-manifold: ${issue.count} edge(s) shared by >2 faces. Surfaces overlap or self-touch — separate the bodies or union them into one solid.` });
    } else if (issue.code === 'degenerate-triangle' || issue.code === 'sliver-triangle') {
      checks.push({ id: issue.code, pass: false, severity: 'warning', message: `${issue.count} ${issue.code.replace('-', ' ')}(s) — sliver/zero-area facets; usually harmless but can break downstream CSG.` });
    }
  }

  // 3. bounding box + size envelope
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox!;
  const ext = { x: bb.max.x - bb.min.x, y: bb.max.y - bb.min.y, z: bb.max.z - bb.min.z };
  const maxExt = Math.max(ext.x, ext.y, ext.z);
  const minExt = Math.min(ext.x, ext.y, ext.z);
  if (constraints.maxSizeMm !== undefined && maxExt > constraints.maxSizeMm) {
    checks.push({ id: 'max-size', pass: false, severity: 'error', message: `Largest extent ${maxExt.toFixed(1)}mm exceeds the limit ${constraints.maxSizeMm}mm — scale the model down.` });
  }
  if (constraints.minSizeMm !== undefined && minExt < constraints.minSizeMm) {
    checks.push({ id: 'min-size', pass: false, severity: 'warning', message: `Smallest extent ${minExt.toFixed(2)}mm is below ${constraints.minSizeMm}mm — the model may be collapsed/too thin on one axis.` });
  }

  // 4. watertight (open boundary edges)
  const boundaryEdges = boundaryEdgeCount(geometry);
  if (requireWatertight && boundaryEdges > 0) {
    checks.push({ id: 'watertight', pass: false, severity: 'error', message: `Not watertight: ${boundaryEdges} open boundary edge(s). The model has gaps/holes — ensure every surface is part of a closed solid (avoid open polygons / unclosed sweeps).` });
  } else {
    checks.push({ id: 'watertight', pass: true, severity: 'error', message: 'Closed solid (watertight).' });
  }

  // 5. positive volume
  const volumeMm3 = meshVolume(geometry);
  if (volumeMm3 <= 1e-6) {
    checks.push({ id: 'volume', pass: false, severity: 'warning', message: 'Volume is ~0 — the result is a surface/shell, not a solid body.' });
  }

  const pass = checks.every(c => c.pass || c.severity === 'warning');
  return { pass, checks, metrics: { triangleCount, volumeMm3, bbox: ext, boundaryEdges } };
}

/** Render the result as a compact critique string for the AI self-correction
 *  loop (errors first, then warnings). Empty when everything passed cleanly. */
export function formatVerificationCritique(result: ModelVerificationResult): string {
  const fails = result.checks.filter(c => !c.pass);
  if (fails.length === 0) return '';
  const errs = fails.filter(c => c.severity === 'error').map(c => `ERROR [${c.id}]: ${c.message}`);
  const warns = fails.filter(c => c.severity === 'warning').map(c => `WARN [${c.id}]: ${c.message}`);
  return [...errs, ...warns].join('\n');
}

// ── Role-based formatting (one engine, role-appropriate surfaces) ───────────
// The verifier produces a structured result; each surface formats it for its
// audience. Vendor/expert sees the technical critique; the customer/lay user
// sees plain-language guidance. Works in any mode (lay-solo, expert-solo, or
// collaborative) since both derive from the same ModelVerificationResult.

export type VerificationAudience = 'customer' | 'vendor';

/** Technical critique for the expert/vendor surface (same as the AI-loop one). */
export function formatForVendor(result: ModelVerificationResult): string {
  return formatVerificationCritique(result);
}

const LAY_MESSAGES: Record<string, { en: string; ko: string }> = {
  'non-empty': { en: 'The design came out empty — nothing was created. Try again.', ko: '디자인이 비어 있어요. 다시 시도해 주세요.' },
  watertight: { en: 'The model has gaps or holes, so it won’t form a solid object.', ko: '모델에 틈이나 구멍이 있어 통짜 형태로 만들어지지 않아요.' },
  manifold: { en: 'Parts of the surface overlap. The shapes need to be merged or kept apart.', ko: '표면이 겹쳐 있어요. 모양을 합치거나 떨어뜨려야 해요.' },
  'max-size': { en: 'The model is too large for the allowed size — make it smaller.', ko: '모델이 허용 크기보다 너무 커요. 더 작게 만들어 주세요.' },
  'min-size': { en: 'One side is very thin — it may be too fragile or hard to make.', ko: '한쪽이 너무 얇아요 — 약하거나 제작이 어려울 수 있어요.' },
  volume: { en: 'This looks hollow (a shell), not a solid — it may not produce well.', ko: '속이 빈 모양(껍데기)이라 제대로 제작되지 않을 수 있어요.' },
};

/** Plain-language guidance for the customer/lay surface. Skips jargon-only
 *  warnings (slivers/degenerate facets) that a lay user can't act on. */
export function formatForCustomer(result: ModelVerificationResult, lang: 'en' | 'ko' = 'en'): string {
  const lines: string[] = [];
  for (const c of result.checks) {
    if (c.pass) continue;
    const plain = LAY_MESSAGES[c.id];
    if (!plain) continue; // technical-only check → not surfaced to lay users
    lines.push(plain[lang]);
  }
  return lines.join('\n');
}

/** Convenience: format for the given audience. */
export function formatForAudience(result: ModelVerificationResult, audience: VerificationAudience, lang: 'en' | 'ko' = 'en'): string {
  return audience === 'vendor' ? formatForVendor(result) : formatForCustomer(result, lang);
}
