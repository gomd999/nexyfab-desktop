/**
 * hierarchy-ir — N1 of the complex-scale plan (260808).
 *
 * 계층 어셈블리 IR: `definitions[]`(재사용 서브어셈블리) + 인스턴스 트리
 * (참조·배치·배열 패턴) → 결정론 전개기가 기존 flat `parts[]` 어셈블리를
 * 생산한다. 모든 하위 소비자(간섭·GA·STEP·BOQ·structural)는 전개 산출물을
 * 그대로 소비하므로 flat 소비자 재감사가 "구조적으로" 불필요하다 — 전개기가
 * 레거시 계약을 지키는 유일한 방출점이다.
 *
 * ## 변환 합성 계약 (v1 — 정확성이 제한을 이긴다)
 * 소비자 규약은 OpenSCAD `rotate([rx,ry,rz])` 순서(X→Y→Z, world = T·Rz·Ry·Rx·local,
 * assembly.mjs rotatePoint 단일 구현). 인스턴스 회전을 **yaw(rz) 전용**으로
 * 제한하면 부품의 로컬 euler와 정확히 합성된다:
 *   Rz(θ)·Rz(rz)·Ry(ry)·Rx(rx) = Rz(θ+rz)·Ry(ry)·Rx(rx)
 * 임의 euler 인스턴스 회전은 레거시 `at`로 일반 표현이 불가하므로 v1은
 * rx/ry 인스턴스 회전을 **정직하게 거부**한다(조용한 근사 금지).
 *
 * ## 스키마 nexyfab.assembly-hierarchy.v1
 * {
 *   schema, name, domain, kind,
 *   definitions: [{ defId, parts?: [legacyPart], children?: [instance] }],
 *   root: [instance | { part: legacyPart }],
 * }
 * instance = { ref, id, at?: {tx,ty,tz,rz}, pattern?: linear|grid|circular }
 *   linear   { kind:'linear', count, dx?,dy?,dz? }
 *   grid     { kind:'grid', nx, ny, dx, dy }
 *   circular { kind:'circular', count, cx?, cy?, startDeg?, sweepDeg? } — yaw 배열
 */

const DEG = Math.PI / 180;
const num = (v, d = 0) => (Number.isFinite(v) ? v : d);

/** 인스턴스 1개가 만드는 배치 목록: [{ suffix, tx, ty, tz, yaw }] */
function patternPlacements(inst, errs, tag) {
  const at = inst.at ?? {};
  if (at.rx || at.ry) errs.push(`${tag}: instance rotation은 rz(yaw)만 지원 — rx/ry는 레거시 euler와 정확 합성 불가(v1 정직 거부)`);
  const base = { tx: num(at.tx), ty: num(at.ty), tz: num(at.tz), yaw: num(at.rz) };
  const p = inst.pattern;
  if (!p) return [{ suffix: '', ...base }];
  const out = [];
  if (p.kind === 'linear') {
    const count = Math.round(num(p.count));
    if (!(count >= 1 && count <= 10000)) { errs.push(`${tag}: linear count invalid`); return []; }
    for (let k = 0; k < count; k++) {
      out.push({ suffix: `[${k}]`, tx: base.tx + num(p.dx) * k, ty: base.ty + num(p.dy) * k, tz: base.tz + num(p.dz) * k, yaw: base.yaw });
    }
  } else if (p.kind === 'grid') {
    const nx = Math.round(num(p.nx)), ny = Math.round(num(p.ny));
    if (!(nx >= 1 && ny >= 1 && nx * ny <= 10000)) { errs.push(`${tag}: grid nx/ny invalid`); return []; }
    if (!(num(p.dx) !== 0 || nx === 1) || !(num(p.dy) !== 0 || ny === 1)) { errs.push(`${tag}: grid pitch invalid`); return []; }
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      out.push({ suffix: `[${i},${j}]`, tx: base.tx + num(p.dx) * i, ty: base.ty + num(p.dy) * j, tz: base.tz, yaw: base.yaw });
    }
  } else if (p.kind === 'circular') {
    const count = Math.round(num(p.count));
    if (!(count >= 1 && count <= 3600)) { errs.push(`${tag}: circular count invalid`); return []; }
    const cx = num(p.cx), cy = num(p.cy);
    const start = num(p.startDeg), sweep = num(p.sweepDeg, 360);
    const step = count > 1 ? sweep / (Math.abs(sweep % 360) < 1e-9 ? count : count - 1) : 0;
    for (let k = 0; k < count; k++) {
      const th = (start + step * k) * DEG;
      const c = Math.cos(th), s = Math.sin(th);
      // 인스턴스 기준점(base.tx,ty)을 (cx,cy) 중심으로 yaw 회전 + 자체 yaw 가산.
      const rx0 = base.tx - cx, ry0 = base.ty - cy;
      out.push({ suffix: `[${k}]`, tx: cx + rx0 * c - ry0 * s, ty: cy + rx0 * s + ry0 * c, tz: base.tz, yaw: base.yaw + start + step * k });
    }
  } else {
    errs.push(`${tag}: unknown pattern kind '${p?.kind}'`);
  }
  return out;
}

/** world = P(parent) ∘ L(local): 위치=parentT + Rz(parentYaw)·localT, yaw 가산. */
function composePlacement(parent, local) {
  const th = parent.yaw * DEG, c = Math.cos(th), s = Math.sin(th);
  return {
    tx: parent.tx + local.tx * c - local.ty * s,
    ty: parent.ty + local.tx * s + local.ty * c,
    tz: parent.tz + local.tz,
    yaw: parent.yaw + local.yaw,
  };
}

/** IR 스키마 게이트(전개 없이) — 오류 배열 반환. */
export function gateHierarchy(ir) {
  const errs = [];
  if (!ir || ir.schema !== 'nexyfab.assembly-hierarchy.v1') errs.push('schema must be nexyfab.assembly-hierarchy.v1');
  const defs = new Map();
  for (const d of ir?.definitions ?? []) {
    if (!d?.defId?.trim()) { errs.push('definition defId missing'); continue; }
    if (defs.has(d.defId)) errs.push(`definition duplicated: ${d.defId}`);
    defs.set(d.defId, d);
    if (!(d.parts?.length || d.children?.length)) errs.push(`${d.defId}: parts/children 모두 비어있음`);
  }
  if (!Array.isArray(ir?.root) || ir.root.length === 0) errs.push('root[] 비어있음');
  const visit = (node, stack, tag) => {
    if (node.part) return; // inline leaf
    if (!node.ref || !defs.has(node.ref)) { errs.push(`${tag}: 미정의 ref '${node.ref}'`); return; }
    if (stack.includes(node.ref)) { errs.push(`${tag}: 순환 참조 ${[...stack, node.ref].join('→')}`); return; }
    if (stack.length >= 8) { errs.push(`${tag}: 중첩 깊이 > 8`); return; }
    patternPlacements(node, errs, tag);
    for (const child of defs.get(node.ref).children ?? []) visit(child, [...stack, node.ref], `${tag}/${child.id ?? child.ref}`);
  };
  for (const node of ir?.root ?? []) visit(node, [], node.id ?? node.ref ?? 'root');
  return errs;
}

/** 정의별 기대 전개 수(패턴 곱) — BOQ 교차검증용. */
export function hierarchyCounts(ir) {
  const defs = new Map((ir.definitions ?? []).map(d => [d.defId, d]));
  const counts = new Map();
  const walk = (node, mult) => {
    if (node.part) return;
    const n = node.pattern
      ? (node.pattern.kind === 'grid' ? Math.round(node.pattern.nx) * Math.round(node.pattern.ny) : Math.round(node.pattern.count))
      : 1;
    const total = mult * n;
    counts.set(node.ref, (counts.get(node.ref) ?? 0) + total);
    for (const child of defs.get(node.ref)?.children ?? []) walk(child, total);
  };
  for (const node of ir.root ?? []) walk(node, 1);
  return counts;
}

/**
 * 전개: IR → 레거시 flat 어셈블리 { name, domain, kind, parts, hierarchy }.
 * 부품 id = 발생 경로(`core/floor[3]/col[1,2]/column`), `_occ`에 정의·경로 메타.
 */
export function expandHierarchy(ir, { maxParts = 200000 } = {}) {
  const errs = gateHierarchy(ir);
  if (errs.length) return { ok: false, gateErrors: errs };
  const defs = new Map(ir.definitions.map(d => [d.defId, d]));
  const parts = [];
  const emit = (part, place, path) => {
    if (parts.length >= maxParts) throw new Error(`expand: 부품 수 상한 ${maxParts} 초과 — 패턴을 줄이거나 상한을 올려라`);
    const at = part.at ?? {};
    const world = composePlacement(place, { tx: num(at.tx), ty: num(at.ty), tz: num(at.tz), yaw: num(at.rz) });
    parts.push({
      ...part,
      id: `${path}/${part.id}`,
      at: { tx: world.tx, ty: world.ty, tz: world.tz, rx: num(at.rx), ry: num(at.ry), rz: world.yaw },
      _occ: { path, leaf: part.id },
    });
  };
  const walk = (node, place, path) => {
    if (node.part) { emit(node.part, place, path || 'root'); return; }
    const def = defs.get(node.ref);
    const localErrs = [];
    const placements = patternPlacements(node, localErrs, path || node.ref);
    if (localErrs.length) throw new Error(localErrs.join('; '));
    for (const pl of placements) {
      const here = composePlacement(place, pl);
      const segment = `${node.id ?? node.ref}${pl.suffix}`;
      const childPath = path ? `${path}/${segment}` : segment;
      for (const part of def.parts ?? []) emit({ ...part, system: part.system ?? def.system }, here, childPath);
      for (const child of def.children ?? []) walk(child, here, childPath);
    }
  };
  try {
    for (const node of ir.root) walk(node, { tx: 0, ty: 0, tz: 0, yaw: 0 }, '');
  } catch (e) {
    return { ok: false, gateErrors: [e instanceof Error ? e.message : String(e)] };
  }
  return {
    ok: true,
    name: ir.name, domain: ir.domain, kind: ir.kind ?? 'hierarchy',
    parts,
    hierarchy: {
      schema: ir.schema,
      definitions: ir.definitions.length,
      expandedParts: parts.length,
      counts: Object.fromEntries(hierarchyCounts(ir)),
    },
  };
}
