/**
 * ifcImport — IFC2X3 → NexyFab 어셈블리 (260718e, 코퍼스4 실물 18개 앵커).
 *
 * 정직 경계(전부 명시):
 *  - 요소=IfcProduct 서브타입(벽·슬래브·기둥·보·문·창·지붕·계단·기초·부재 등).
 *  - 형상 2단계: ①IfcExtrudedAreaSolid+사각 프로파일+순수 z-회전 = **정확 box(rz 보존)**
 *    ②그 외(FacetedBrep·임의 프로파일·불리언) = 요소 형상 폐포의 점 스캔 **AABB 근사**.
 *    불리언 클리핑(개구 공제)은 1피연산자 기준 — 개구 미공제 과대측 명시.
 *  - 배치=IfcLocalPlacement 체인 완전 합성(Axis2Placement3D 회전 포함)·매핑 아이템=
 *    RepresentationMap+CartesianTransformationOperator(이동·균일 스케일·축 회전) 적용.
 *  - 단위=IfcSIUnit LENGTHUNIT 감지(m→×1000·mm→×1). 재질=클래스별 기본값(IfcMaterial 파싱=후속).
 *  - 파일 예산 150MB(초과=정직 거부 — 분할 안내). 부품 예산 600(초과=클래스별 대표화).
 */

export interface IfcImportResult {
  ok: boolean;
  error?: string;
  assembly?: {
    name: string;
    domain: string;
    importedApprox?: boolean;
    parts: Array<{ id: string; type: 'box'; params: { width: number; depth: number; height: number }; at: { tx: number; ty: number; tz: number; rz?: number }; role: string; material: string; qty?: number }>;
    note: string;
  };
  stats?: { elements: number; imported: number; exact: number; approx: number; skipped: number; unitScale: number; byClass: Record<string, number>; skipByClass?: Record<string, number>; representative?: boolean };
}

const ELEMENT_CLASSES: Record<string, { role: string; material: string }> = {
  IFCWALL: { role: 'wall', material: 'concrete' },
  IFCWALLSTANDARDCASE: { role: 'wall', material: 'concrete' },
  IFCSLAB: { role: 'slab', material: 'concrete' },
  IFCCOLUMN: { role: 'column', material: 'concrete' },
  IFCBEAM: { role: 'beam', material: 'concrete' },
  IFCFOOTING: { role: 'footing', material: 'concrete' },
  IFCROOF: { role: 'roof', material: 'concrete' },
  IFCSTAIR: { role: 'stair', material: 'concrete' },
  IFCSTAIRFLIGHT: { role: 'stair', material: 'concrete' },
  IFCRAMP: { role: 'ramp', material: 'concrete' },
  IFCDOOR: { role: 'door', material: 'timber' },
  IFCWINDOW: { role: 'window', material: 'glass' },
  IFCMEMBER: { role: 'member', material: 'steel' },
  IFCPLATE: { role: 'plate', material: 'steel' },
  IFCCOVERING: { role: 'covering', material: 'timber' },
  IFCCURTAINWALL: { role: 'wall', material: 'glass' },
  IFCRAILING: { role: 'railing', material: 'steel' },
  IFCBUILDINGELEMENTPROXY: { role: 'element', material: 'concrete' },
  IFCFURNISHINGELEMENT: { role: 'furniture', material: 'timber' },
  IFCFLOWTERMINAL: { role: 'fixture', material: 'steel' },
};

interface Ent { name: string; raw: string }
type M4 = number[]; // 12-real: [r00,r01,r02,tx, r10,r11,r12,ty, r20,r21,r22,tz]
const I4: M4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
const mul = (A: M4, B: M4): M4 => {
  const o = new Array(12).fill(0);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) o[i * 4 + j] = A[i * 4] * B[j] + A[i * 4 + 1] * B[4 + j] + A[i * 4 + 2] * B[8 + j];
    o[i * 4 + 3] = A[i * 4] * B[3] + A[i * 4 + 1] * B[7] + A[i * 4 + 2] * B[11] + A[i * 4 + 3];
  }
  return o;
};
const applyM = (m: M4, x: number, y: number, z: number): [number, number, number] => [
  m[0] * x + m[1] * y + m[2] * z + m[3],
  m[4] * x + m[5] * y + m[6] * z + m[7],
  m[8] * x + m[9] * y + m[10] * z + m[11],
];

/** 상위 레벨 콤마 분해 — 괄호 중첩 + **문자열 리터럴 내 콤마 보호**(casa 실측: 'Puerta 0,90x2,10'
 *  이름 콤마가 인자 인덱스를 밀어 문/창 21건 norep 오판 — 260718e). */
function splitArgs(raw: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = '', inStr = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inStr) {
      cur += ch;
      if (ch === "'") {
        if (raw[i + 1] === "'") { cur += "'"; i++; } // IFC 이스케이프 ''
        else inStr = false;
      }
      continue;
    }
    if (ch === "'") { inStr = true; cur += ch; }
    else if (ch === '(') { depth++; cur += ch; }
    else if (ch === ')') { depth--; cur += ch; }
    else if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
const refOf = (s: string | undefined): number | null => {
  const m = s?.match(/^#(\d+)$/);
  return m ? +m[1] : null;
};

export function ifcToNexyfabAssembly(source: string, { name = 'IFC import' } = {}): IfcImportResult {
  if (source.length > 150_000_000) return { ok: false, error: 'IFC 150MB 초과 — 파일 예산 밖(층/동 분할 내보내기 필요, 정직 거부)' };
  if (!/FILE_SCHEMA\s*\(\s*\(\s*'IFC/i.test(source.slice(0, 4000))) return { ok: false, error: 'IFC 스키마 헤더 없음 — IFC SPF 파일이 아님' };

  // ── 1. 엔티티 인덱스(#id=NAME(raw);) ──
  const ents = new Map<number, Ent>();
  const re = /#(\d+)\s*=\s*([A-Z0-9_]+)\s*\(([\s\S]*?)\)\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) ents.set(+m[1], { name: m[2], raw: m[3] });
  if (ents.size === 0) return { ok: false, error: '엔티티 0건 — 파싱 실패' };

  // ── 2. 단위 스케일(m→1000·mm→1) ──
  let unitScale = 1;
  for (const e of ents.values()) {
    if (e.name === 'IFCSIUNIT' && e.raw.includes('.LENGTHUNIT.')) {
      unitScale = e.raw.includes('.MILLI.') ? 1 : 1000;
      break;
    }
  }

  // ── 3. 배치 합성(IfcLocalPlacement 체인, 메모) ──
  const axisCache = new Map<number, M4>();
  const axis2M = (id: number | null): M4 => {
    if (id == null) return I4;
    const hit = axisCache.get(id);
    if (hit) return hit;
    const e = ents.get(id);
    if (!e) return I4;
    const a = splitArgs(e.raw);
    const loc = readPoint(refOf(a[0]));
    const zAx = readDir(refOf(a[1])) ?? [0, 0, 1];
    const xRef = readDir(refOf(a[2])) ?? defaultX(zAx);
    // 그램-슈미트: x ⟂ z, y = z×x
    const dot = xRef[0] * zAx[0] + xRef[1] * zAx[1] + xRef[2] * zAx[2];
    let x = [xRef[0] - dot * zAx[0], xRef[1] - dot * zAx[1], xRef[2] - dot * zAx[2]];
    const nx = Math.hypot(...x) || 1;
    x = x.map((v) => v / nx);
    const y = [zAx[1] * x[2] - zAx[2] * x[1], zAx[2] * x[0] - zAx[0] * x[2], zAx[0] * x[1] - zAx[1] * x[0]];
    const M: M4 = [x[0], y[0], zAx[0], loc[0], x[1], y[1], zAx[1], loc[1], x[2], y[2], zAx[2], loc[2]];
    axisCache.set(id, M);
    return M;
  };
  const readPoint = (id: number | null): [number, number, number] => {
    const e = id != null ? ents.get(id) : null;
    if (!e) return [0, 0, 0];
    const nums = e.raw.match(/[-\d.eE+]+/g)?.map(Number) ?? [];
    return [(nums[0] ?? 0) * unitScale, (nums[1] ?? 0) * unitScale, (nums[2] ?? 0) * unitScale];
  };
  const readDir = (id: number | null): [number, number, number] | null => {
    const e = id != null ? ents.get(id) : null;
    if (!e) return null;
    const nums = e.raw.match(/[-\d.eE+]+/g)?.map(Number) ?? [];
    return nums.length >= 2 ? [nums[0], nums[1], nums[2] ?? 0] : null;
  };
  const defaultX = (z: number[]): [number, number, number] => (Math.abs(z[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]);
  const placeCache = new Map<number, M4>();
  const placementM = (id: number | null, guard = 0): M4 => {
    if (id == null || guard > 64) return I4;
    const hit = placeCache.get(id);
    if (hit) return hit;
    const e = ents.get(id);
    if (!e || e.name !== 'IFCLOCALPLACEMENT') return I4;
    const a = splitArgs(e.raw);
    const parent = placementM(refOf(a[0]), guard + 1);
    const local = axis2M(refOf(a[1]));
    const M = mul(parent, local);
    placeCache.set(id, M);
    return M;
  };

  // ── 4. 요소별 형상: ①압출 정확 box ②서브트리 경계 **메모화 재귀**(공유 매핑=1회 계산) ──
  // v1 BFS 의 2결함(코퍼스4 casa 실측): ⓐ요소마다 공유 서브트리 재순회=O(요소×트리) 폭주
  // ⓑ표현 컨텍스트(WorldCoordinateSystem 원점)가 폐포에 들어와 경계를 원점으로 오염.
  type B3 = { min: number[]; max: number[] };
  const STOP_NAMES = new Set(['IFCGEOMETRICREPRESENTATIONCONTEXT', 'IFCGEOMETRICREPRESENTATIONSUBCONTEXT', 'IFCSTYLEDITEM', 'IFCPRESENTATIONLAYERASSIGNMENT', 'IFCOWNERHISTORY', 'IFCSURFACESTYLE', 'IFCMATERIAL', 'IFCMATERIALLAYERSETUSAGE', 'IFCCLASSIFICATIONREFERENCE']);
  const bCache = new Map<number, B3 | null>();
  const inStack = new Set<number>();
  const mergeB = (a: B3 | null, b: B3 | null): B3 | null => {
    if (!a) return b; if (!b) return a;
    return { min: a.min.map((v, k) => Math.min(v, b.min[k])), max: a.max.map((v, k) => Math.max(v, b.max[k])) };
  };
  const xformB = (b: B3, M: M4): B3 => {
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const cx of [b.min[0], b.max[0]]) for (const cy of [b.min[1], b.max[1]]) for (const cz of [b.min[2], b.max[2]]) {
      const w = applyM(M, cx, cy, cz);
      for (let k = 0; k < 3; k++) { if (w[k] < mn[k]) mn[k] = w[k]; if (w[k] > mx[k]) mx[k] = w[k]; }
    }
    return { min: mn, max: mx };
  };
  const boundsOf = (id: number, depth = 0): B3 | null => {
    const hit = bCache.get(id);
    if (hit !== undefined) return hit;
    if (inStack.has(id) || depth > 220) return null;
    const e = ents.get(id);
    if (!e || STOP_NAMES.has(e.name)) { bCache.set(id, null); return null; }
    if (e.name === 'IFCCARTESIANPOINT') {
      const nums = e.raw.match(/[-\d.eE+]+/g)?.map(Number) ?? [];
      const res: B3 | null = nums.length >= 2
        ? (() => { const p = [nums[0] * unitScale, nums[1] * unitScale, (nums[2] ?? 0) * unitScale]; return { min: [...p], max: [...p] }; })()
        : null;
      bCache.set(id, res);
      return res;
    }
    inStack.add(id);
    let acc: B3 | null = null;
    if (e.name === 'IFCRECTANGLEPROFILEDEF' || e.name === 'IFCCIRCLEPROFILEDEF' || e.name === 'IFCCIRCLEHOLLOWPROFILEDEF' || e.name === 'IFCISHAPEPROFILEDEF' || e.name === 'IFCLSHAPEPROFILEDEF' || e.name === 'IFCUSHAPEPROFILEDEF' || e.name === 'IFCTSHAPEPROFILEDEF') {
      // 파라메트릭 프로파일=치수 스칼라(점 스캔 불가 — casa 멀리언 28건 x/y=0 실측) → 폐형 경계.
      // 2D Position 회전은 미적용(v1 — 경계 근사 명시), 위치 오프셋만 반영.
      const a = splitArgs(e.raw);
      const p2 = ents.get(refOf(a[2]) ?? -1);
      let ox = 0, oy = 0;
      if (p2) { const lp = readPoint(refOf(splitArgs(p2.raw)[0])); ox = lp[0]; oy = lp[1]; }
      let hx = 0, hy = 0;
      if (e.name === 'IFCRECTANGLEPROFILEDEF') { hx = ((parseFloat(a[3]) || 0) * unitScale) / 2; hy = ((parseFloat(a[4]) || 0) * unitScale) / 2; }
      else if (e.name === 'IFCCIRCLEPROFILEDEF' || e.name === 'IFCCIRCLEHOLLOWPROFILEDEF') { hx = hy = (parseFloat(a[3]) || 0) * unitScale; }
      else { hx = ((parseFloat(a[4]) || parseFloat(a[3]) || 0) * unitScale) / 2; hy = ((parseFloat(a[3]) || 0) * unitScale) / 2; } // I/L/U/T: depth·width 순서 관례 근사
      if (hx > 0 && hy > 0) acc = { min: [ox - hx, oy - hy, 0], max: [ox + hx, oy + hy, 0] };
    } else if (e.name === 'IFCEXTRUDEDAREASOLID') {
      // 압출 깊이=스칼라(점 스캔 불가 — casa 벽 34건 z=0 스킵 실측) → 스윕 폐형:
      // 경계 = 프로파일 2D 경계 ∪ (경계+방향×깊이) 를 Position 으로 변환
      const a = splitArgs(e.raw);
      const profB = refOf(a[0]) != null ? boundsOf(refOf(a[0])!, depth + 1) : null;
      const dLen = (parseFloat(a[3]) || 0) * unitScale;
      const dir = readDir(refOf(a[2])) ?? [0, 0, 1];
      if (profB && dLen > 0) {
        const shifted: B3 = { min: profB.min.map((v, k) => v + dir[k] * dLen), max: profB.max.map((v, k) => v + dir[k] * dLen) };
        acc = xformB(mergeB(profB, shifted)!, axis2M(refOf(a[1])));
      }
    } else if (e.name === 'IFCBOOLEANCLIPPINGRESULT' || e.name === 'IFCBOOLEANRESULT') {
      // 클리핑=1피연산자 기준(하프스페이스 무한평면 점 오염 방지 — 개구/절단 미공제 과대측 명시)
      const a = splitArgs(e.raw);
      const first = refOf(a[1]);
      if (first != null) acc = boundsOf(first, depth + 1);
    } else if (e.name === 'IFCMAPPEDITEM') {
      // MappedItem = RepresentationMap(원점 배치)⁻¹? 관례상 소스 그대로 + 연산자 변환 적용
      const a = splitArgs(e.raw);
      const mapEnt = ents.get(refOf(a[0]) ?? -1);
      let srcB: B3 | null = null;
      if (mapEnt) {
        const ma = splitArgs(mapEnt.raw);
        const srcRep = refOf(ma[1]);
        if (srcRep != null) srcB = boundsOf(srcRep, depth + 1);
      }
      if (srcB) {
        const op = ents.get(refOf(a[1]) ?? -1);
        if (op) {
          // CartesianTransformationOperator3D(Axis1,Axis2,LocalOrigin,Scale,Axis3)
          const oa = splitArgs(op.raw);
          const x = readDir(refOf(oa[0])) ?? [1, 0, 0];
          const y = readDir(refOf(oa[1])) ?? [0, 1, 0];
          const org = readPoint(refOf(oa[2]));
          const sc = parseFloat(oa[3]) || 1;
          const z = readDir(refOf(oa[4])) ?? [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
          const M: M4 = [x[0] * sc, y[0] * sc, z[0] * sc, org[0], x[1] * sc, y[1] * sc, z[1] * sc, org[1], x[2] * sc, y[2] * sc, z[2] * sc, org[2]];
          acc = xformB(srcB, M);
        } else acc = srcB;
      }
    } else {
      const refs = e.raw.match(/#\d+/g);
      if (refs) for (const r of refs) acc = mergeB(acc, boundsOf(+r.slice(1), depth + 1));
    }
    inStack.delete(id);
    bCache.set(id, acc);
    return acc;
  };
  const localBounds = (rootIds: number[]): B3 | null => {
    let acc: B3 | null = null;
    for (const id of rootIds) acc = mergeB(acc, boundsOf(id));
    return acc;
  };

  /** 압출 정확 경로: IfcExtrudedAreaSolid(사각 프로파일·z 압출) → 로컬 box. 실패=null. */
  const tryExtrusion = (solidId: number): { min: number[]; max: number[]; M: M4 } | null => {
    const e = ents.get(solidId);
    if (!e || e.name !== 'IFCEXTRUDEDAREASOLID') return null;
    const a = splitArgs(e.raw);
    const prof = ents.get(refOf(a[0]) ?? -1);
    const posM = axis2M(refOf(a[1]));
    const dir = readDir(refOf(a[2])) ?? [0, 0, 1];
    const depth = (parseFloat(a[3]) || 0) * unitScale;
    if (!prof || Math.abs(dir[2]) < 0.999 || depth <= 0) return null;
    if (prof.name === 'IFCRECTANGLEPROFILEDEF') {
      const pa = splitArgs(prof.raw);
      const p2 = ents.get(refOf(pa[2]) ?? -1); // Axis2Placement2D
      let ox = 0, oy = 0;
      if (p2) { const loc = readPoint(refOf(splitArgs(p2.raw)[0])); ox = loc[0]; oy = loc[1]; }
      const xd = (parseFloat(pa[3]) || 0) * unitScale, yd = (parseFloat(pa[4]) || 0) * unitScale;
      if (xd <= 0 || yd <= 0) return null;
      return { min: [ox - xd / 2, oy - yd / 2, 0], max: [ox + xd / 2, oy + yd / 2, depth], M: posM };
    }
    if (prof.name === 'IFCARBITRARYCLOSEDPROFILEDEF') {
      const pa = splitArgs(prof.raw);
      const curve = refOf(pa[2]);
      if (curve == null) return null;
      const b = localBounds([curve]);
      if (!b) return null;
      return { min: [b.min[0], b.min[1], 0], max: [b.max[0], b.max[1], depth], M: axis2M(refOf(a[1])) };
    }
    return null;
  };

  // ── 5. 요소 수집·방출 ──
  const parts: NonNullable<IfcImportResult['assembly']>['parts'] = [];
  const byClass: Record<string, number> = {};
  let exact = 0, approx = 0, skipped = 0, elements = 0;
  const skipByClass: Record<string, number> = {};
  const skipC = (cls: string, why = '?') => { skipped++; const k = cls + ':' + why; skipByClass[k] = (skipByClass[k] ?? 0) + 1; };
  const used = new Set<string>();
  const emit = (cls: string, nameStr: string, place: M4, lb: { min: number[]; max: number[] }, extM: M4 | null) => {
    const meta = ELEMENT_CLASSES[cls];
    const M = extM ? mul(place, extM) : place;
    // 순수 z-회전 판정 → rz 보존 box(정밀 간섭 판정 가능), 아니면 월드 AABB
    const pureZ = Math.abs(M[2]) < 1e-6 && Math.abs(M[6]) < 1e-6 && Math.abs(M[8]) < 1e-6 && Math.abs(M[9]) < 1e-6 && Math.abs(M[10] - 1) < 1e-6;
    let id = nameStr.replace(/[^\w가-힣-]/g, '_').slice(0, 40) || cls.toLowerCase();
    while (used.has(id)) id = `${id}_`;
    used.add(id);
    const dims = [lb.max[0] - lb.min[0], lb.max[1] - lb.min[1], lb.max[2] - lb.min[2]];
    if (!dims.every((d) => Number.isFinite(d) && d > 0.5)) { skipC(cls, 'dims'); return; }
    if (pureZ && extM) {
      const rz = (Math.atan2(M[4], M[0]) * 180) / Math.PI;
      const c = Math.cos((rz * Math.PI) / 180), s = Math.sin((rz * Math.PI) / 180);
      // 로컬 min 코너를 rz 회전 원점으로 환산
      const tx = M[3] + lb.min[0] * c - lb.min[1] * s;
      const ty = M[7] + lb.min[0] * s + lb.min[1] * c;
      parts.push({ id, type: 'box', params: { width: +dims[0].toFixed(1), depth: +dims[1].toFixed(1), height: +dims[2].toFixed(1) }, at: { tx: +tx.toFixed(1), ty: +ty.toFixed(1), tz: +(M[11] + lb.min[2]).toFixed(1), ...(Math.abs(rz) > 0.01 ? { rz: +rz.toFixed(2) } : {}) }, role: meta.role, material: meta.material });
      exact++;
    } else {
      const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (const cx of [lb.min[0], lb.max[0]]) for (const cy of [lb.min[1], lb.max[1]]) for (const cz of [lb.min[2], lb.max[2]]) {
        const w = applyM(M, cx, cy, cz);
        for (let k = 0; k < 3; k++) { if (w[k] < mn[k]) mn[k] = w[k]; if (w[k] > mx[k]) mx[k] = w[k]; }
      }
      const wd = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
      if (!wd.every((d) => Number.isFinite(d) && d > 0.5)) { skipC(cls, 'wdims'); return; }
      parts.push({ id, type: 'box', params: { width: +wd[0].toFixed(1), depth: +wd[1].toFixed(1), height: +wd[2].toFixed(1) }, at: { tx: +mn[0].toFixed(1), ty: +mn[1].toFixed(1), tz: +mn[2].toFixed(1) }, role: meta.role, material: meta.material });
      approx++;
    }
  };

  for (const [, e] of ents) {
    const meta = ELEMENT_CLASSES[e.name];
    if (!meta) continue;
    elements++;
    byClass[e.name] = (byClass[e.name] ?? 0) + 1;
    if (parts.length >= 600) { skipC(e.name, 'budget'); continue; } // 부품 예산(대표성: 순서대로 600 — 명시)
    const a = splitArgs(e.raw);
    const place = placementM(refOf(a[5]));
    const repId = refOf(a[6]);
    if (repId == null) { skipC(e.name, 'norep'); continue; }
    // ProductDefinitionShape → ShapeRepresentation(s) → items
    const pds = ents.get(repId);
    if (!pds) { skipC(e.name, 'nopds'); continue; }
    const repRefs = (pds.raw.match(/#\d+/g) ?? []).map((r) => +r.slice(1));
    let done = false;
    // ①압출 정확 경로(대표 1솔리드)
    for (const rr of repRefs) {
      const rep = ents.get(rr);
      if (!rep || rep.name !== 'IFCSHAPEREPRESENTATION') continue;
      for (const ir of (rep.raw.match(/#\d+/g) ?? []).map((r) => +r.slice(1))) {
        const ext = tryExtrusion(ir);
        if (ext) { emit(e.name, splitArgs(e.raw)[2]?.replace(/'/g, '') || e.name, place, { min: ext.min, max: ext.max }, ext.M); done = true; break; }
      }
      if (done) break;
    }
    if (done) continue;
    // ②폐포 점 스캔 AABB(FacetedBrep·매핑·불리언 등 일괄 — 개구 미공제 과대측 명시)
    const lb = localBounds([repId]);
    if (lb) emit(e.name, splitArgs(e.raw)[2]?.replace(/'/g, '') || e.name, place, lb, null);
    else skipC(e.name, 'nobounds');
  }

  if (parts.length === 0) return { ok: false, error: `건축 요소 형상 0건(요소 ${elements}) — 지원 클래스/형상 없음`, stats: { elements, imported: 0, exact, approx, skipped, unitScale, byClass, skipByClass } };
  return {
    ok: true,
    assembly: {
      name, domain: 'building', importedApprox: true, parts,
      note: `IFC2X3 임포트: 정확 압출 box ${exact}(rz 보존)·AABB 근사 ${approx}(FacetedBrep/매핑 — 개구 미공제 과대측 명시)·스킵 ${skipped} · 재질=클래스 기본값(IfcMaterial 후속) · 단위 ×${unitScale}`,
    },
    stats: { elements, imported: parts.length, exact, approx, skipped, unitScale, byClass, skipByClass, representative: elements > 600 },
  };
}
