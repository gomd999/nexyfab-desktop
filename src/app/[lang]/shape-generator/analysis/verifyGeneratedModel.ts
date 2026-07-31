import * as THREE from 'three';
import { toIsoLang } from '@/lib/i18n/normalize';
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
 *   • outward-facing normals (signed volume > 0 — not inside-out)
 *   • single connected body when required (no floating fragments)
 *   • mesh complexity within a triangle budget (when one is given)
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
  /** Require the mesh to be a single connected body. Default false (an
   *  assembly may legitimately contain multiple disjoint shells). */
  requireSingleBody?: boolean;
  /** Soft cap on triangle count — exceeding it warns about a heavy mesh. */
  maxTriangles?: number;
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
    /** Number of disjoint connected shells (welded). 1 for a single body. */
    componentCount: number;
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

/** Signed divergence-theorem volume. Sign encodes winding: a closed solid with
 *  outward-facing normals is positive; inside-out normals make it negative. */
function signedMeshVolume(geo: THREE.BufferGeometry): number {
  const pos = geo.attributes.position;
  if (!pos) return 0;
  const idx = geo.index;
  const triCount = idx ? idx.count / 3 : pos.count / 3;
  let vol = 0;
  for (let t = 0; t < triCount; t++) {
    const i0 = idx ? idx.getX(t * 3) : t * 3;
    const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    const ax = pos.getX(i0), ay = pos.getY(i0), az = pos.getZ(i0);
    const bx = pos.getX(i1), by = pos.getY(i1), bz = pos.getZ(i1);
    const cx = pos.getX(i2), cy = pos.getY(i2), cz = pos.getZ(i2);
    vol += ax * (by * cz - bz * cy) + bx * (cy * az - cz * ay) + cx * (ay * bz - az * by);
  }
  return vol / 6;
}

/** Count disjoint connected shells via union-find over welded vertices. A
 *  single solid → 1; floating fragments / an assembly of separate parts → >1. */
function connectedComponentCount(geo: THREE.BufferGeometry): number {
  const pos = geo.attributes.position;
  if (!pos || pos.count === 0) return 0;
  const idx = geo.index ? Array.from(geo.index.array as ArrayLike<number>) : Array.from({ length: pos.count }, (_, i) => i);
  const key = (i: number) => `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
  const vid = new Map<string, number>();
  const canon = (i: number) => { const k = key(i); let v = vid.get(k); if (v === undefined) { v = vid.size; vid.set(k, v); } return v; };
  const parent: number[] = [];
  const ensure = (v: number) => { while (parent.length <= v) parent.push(parent.length); };
  const find = (x: number): number => { let r = x; while (parent[r] !== r) r = parent[r]!; while (parent[x] !== r) { const n = parent[x]!; parent[x] = r; x = n; } return r; };
  const union = (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  const seen = new Set<number>();
  for (let t = 0; t < idx.length / 3; t++) {
    const a = canon(idx[t * 3]!), b = canon(idx[t * 3 + 1]!), c = canon(idx[t * 3 + 2]!);
    ensure(a); ensure(b); ensure(c);
    seen.add(a); seen.add(b); seen.add(c);
    union(a, b); union(b, c);
  }
  const roots = new Set<number>();
  for (const v of seen) roots.add(find(v));
  return roots.size;
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
    return { pass: false, checks, metrics: { triangleCount: 0, volumeMm3: 0, bbox: { x: 0, y: 0, z: 0 }, boundaryEdges: 0, componentCount: 0 } };
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

  // 6. orientation (outward-facing normals). Only meaningful on a closed solid
  //    with a real volume — signed volume is ill-defined for open meshes, and a
  //    ~0 volume is already flagged above. A negative sign means the winding is
  //    inverted (inside-out), which trips up CSG and slicers.
  if (boundaryEdges === 0 && volumeMm3 > 1e-6) {
    const signed = signedMeshVolume(geometry);
    if (signed < 0) {
      checks.push({ id: 'orientation', pass: false, severity: 'warning', message: 'Inverted normals: the solid is inside-out (negative signed volume). Flip face winding so normals point outward.' });
    }
  }

  // 7. single connected body (when required). Otherwise just reported in metrics
  //    so callers can decide — multiple shells are legitimate for assemblies.
  const componentCount = connectedComponentCount(geometry);
  if (constraints.requireSingleBody && componentCount > 1) {
    checks.push({ id: 'single-body', pass: false, severity: 'error', message: `Expected one connected body but found ${componentCount} separate pieces. Join them (union) or remove floating fragments.` });
  }

  // 8. mesh complexity budget (when given).
  if (constraints.maxTriangles !== undefined && triangleCount > constraints.maxTriangles) {
    checks.push({ id: 'mesh-complexity', pass: false, severity: 'warning', message: `Mesh has ${triangleCount} triangles, over the ${constraints.maxTriangles} budget — consider lowering facet resolution ($fn) for a lighter model.` });
  }

  const pass = checks.every(c => c.pass || c.severity === 'warning');
  return { pass, checks, metrics: { triangleCount, volumeMm3, bbox: ext, boundaryEdges, componentCount } };
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

const LAY_MESSAGES: Record<string, { en: string; ko: string; ja: string; zh: string; es: string; ar: string }> = {
  'non-empty': {
    en: 'The design came out empty — nothing was created. Try again.',
    ko: '디자인이 비어 있어요. 다시 시도해 주세요.',
    ja: 'デザインが空です — 何も作成されませんでした。もう一度お試しください。',
    zh: '设计结果为空 — 没有生成任何内容。请重试。',
    es: 'El diseño ha salido vacío: no se ha creado nada. Inténtelo de nuevo.',
    ar: 'جاء التصميم فارغاً — لم يُنشأ أي شيء. حاول مرة أخرى.',
  },
  watertight: {
    en: 'The model has gaps or holes, so it won\u2019t form a solid object.',
    ko: '모델에 틈이나 구멍이 있어 통짜 형태로 만들어지지 않아요.',
    ja: 'モデルに隙間や穴があるため、中身の詰まった形になりません。',
    zh: '模型存在缝隙或孔洞，无法形成实体。',
    es: 'El modelo tiene huecos o agujeros, por lo que no formará un sólido.',
    ar: 'يحتوي النموذج على فجوات أو ثقوب، لذا لن يشكّل مجسماً صلباً.',
  },
  manifold: {
    en: 'Parts of the surface overlap. The shapes need to be merged or kept apart.',
    ko: '표면이 겹쳐 있어요. 모양을 합치거나 떨어뜨려야 해요.',
    ja: '表面が重なっています。形状を結合するか、離す必要があります。',
    zh: '表面存在重叠。需要合并或分开这些形状。',
    es: 'Hay superficies solapadas. Las formas deben fusionarse o separarse.',
    ar: 'تتداخل بعض الأسطح. يجب دمج الأشكال أو إبعادها عن بعضها.',
  },
  'max-size': {
    en: 'The model is too large for the allowed size — make it smaller.',
    ko: '모델이 허용 크기보다 너무 커요. 더 작게 만들어 주세요.',
    ja: 'モデルが許容サイズを超えています — 小さくしてください。',
    zh: '模型超出允许尺寸 — 请缩小。',
    es: 'El modelo supera el tamaño permitido: hágalo más pequeño.',
    ar: 'النموذج أكبر من المقاس المسموح — يُرجى تصغيره.',
  },
  'min-size': {
    en: 'One side is very thin — it may be too fragile or hard to make.',
    ko: '한쪽이 너무 얇아요 — 약하거나 제작이 어려울 수 있어요.',
    ja: '一部が非常に薄くなっています — 壊れやすい、または製作が難しい可能性があります。',
    zh: '某一侧非常薄 — 可能过于脆弱或难以制造。',
    es: 'Un lado es muy fino: puede resultar frágil o difícil de fabricar.',
    ar: 'أحد الجوانب رقيق جداً — قد يكون هشاً أو يصعب تصنيعه.',
  },
  volume: {
    en: 'This looks hollow (a shell), not a solid — it may not produce well.',
    ko: '속이 빈 모양(껍데기)이라 제대로 제작되지 않을 수 있어요.',
    ja: '中空(シェル)の形状で、中身が詰まっていません — うまく製作できない場合があります。',
    zh: '这是中空的壳体而非实体 — 可能无法正常制造。',
    es: 'Parece hueco (una cáscara), no un sólido: puede que no se fabrique bien.',
    ar: 'يبدو أنه مجوّف (قشرة) وليس صلباً — قد لا يُصنَّع بشكل سليم.',
  },
  orientation: {
    en: 'The surface is turned inside-out, which can confuse manufacturing.',
    ko: '면이 안팎으로 뒤집혀 있어요 — 제작 시 문제가 될 수 있어요.',
    ja: '面が裏返っています — 製作時に問題になる可能性があります。',
    zh: '表面法向翻转 — 可能导致制造出错。',
    es: 'La superficie está invertida, lo que puede confundir a fabricación.',
    ar: 'السطح مقلوب من الداخل إلى الخارج، وقد يربك عملية التصنيع.',
  },
  'single-body': {
    en: 'The design is in separate pieces but should be one connected part.',
    ko: '여러 조각으로 떨어져 있어요 — 하나로 이어진 부품이어야 해요.',
    ja: '複数の断片に分かれています — ひとつながりの部品である必要があります。',
    zh: '设计被分成了多块 — 应该是一个连通的零件。',
    es: 'El diseño está en piezas separadas, pero debería ser una sola pieza conectada.',
    ar: 'التصميم مقسّم إلى قطع منفصلة، بينما يجب أن يكون قطعة واحدة متصلة.',
  },
};

/** Plain-language guidance for the customer/lay surface. Skips jargon-only
 *  warnings (slivers/degenerate facets) that a lay user can't act on. */
/**
 * ⚠ 260802: `lang: 'en' | 'ko'` 이라 **호출측이 다른 언어를 넘길 수조차 없었다.**
 *   사전을 6언어로 채워도 도달하지 못하는 층위다(오늘 네 번째 같은 형태).
 */
export function formatForCustomer(result: ModelVerificationResult, lang: string = 'en'): string {
  const lines: string[] = [];
  for (const c of result.checks) {
    if (c.pass) continue;
    const plain = LAY_MESSAGES[c.id];
    if (!plain) continue; // technical-only check → not surfaced to lay users
    lines.push(plain[toIsoLang(lang)] ?? plain.en);
  }
  return lines.join('\n');
}

/** Convenience: format for the given audience. */
export function formatForAudience(result: ModelVerificationResult, audience: VerificationAudience, lang: 'en' | 'ko' = 'en'): string {
  return audience === 'vendor' ? formatForVendor(result) : formatForCustomer(result, lang);
}
