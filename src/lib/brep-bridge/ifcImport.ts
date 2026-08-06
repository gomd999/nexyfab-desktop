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
import { classifyIndexedMeshBoundaries, repairIndexedMeshDegenerateFaces } from './indexedMeshClosure';

export interface IfcImportResult {
  ok: boolean;
  error?: string;
  assembly?: {
    name: string;
    domain: string;
    importedApprox?: boolean;
    /** Reusable type geometry only; contains no placed physical occurrence. */
    definitionOnly?: boolean;
    // ⚠ 260729c: 삼각 메시 요소는 `mesh` 로 나간다 — 형상은 AABB 로 표시되지만
    //   **부피·질량은 실측**이다(박스로 뭉개면 최대 58배 과대, 실측). 둘은 다른 정보다.
    parts: Array<{
      id: string;
      type: 'box' | 'mesh';
      params: { width: number; depth: number; height: number }
        | { volumeMm3?: number; aabb: { min: number[]; max: number[] }; verts?: number[][]; faces?: number[][]; openSurface?: boolean };
      at: { tx: number; ty: number; tz: number; rz?: number };
      role: string; material: string; qty?: number;
      meshVolumeExact?: boolean; boxVolumeMm3?: number;
      geometryEvidence?: 'exact_extrusion_box' | 'exact_mesh_volume_aabb_display' | 'exact_surface_mesh' | 'aabb_only';
      sourceClass?: string;
      representationKinds?: string[];
      closureEvidence?: { watertight: boolean; sourceDeclaredOpenSurface: boolean; boundaryEdges: number; nonManifoldEdges: number; degenerateFaces: number; orientationConsistent: boolean; degenerateRepairApplied: boolean; removedDegenerateFaces: number; boundaryComponents: number; closedBoundaryLoops: number; openBoundaryChains: number; branchedBoundaryComponents: number; planarClosedBoundaryLoops: number; microGapCandidates: number; totalBoundaryLengthMm: number };
    }>;
    note: string;
  };
  stats?: { elements: number; imported: number; exact: number; approx: number; skipped: number; unitScale: number; byClass: Record<string, number>; skipByClass?: Record<string, number>; dimensionSamples?: Record<string, number[][]>; dimensionEvidence?: Array<{ entityId: number; ifcClass: string; dimensions: number[] }>; authoritativeThicknessRecoveries?: number; authoritativeInputRecoveries?: number; appliedAuthoritativeInputs?: Array<{ entityId: number; globalId: string; axis: number; valueMm: number; provenance: string; beforeDimensionsMm: number[]; afterDimensionsMm: number[] }>; representative?: boolean };
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
  IFCBUILTELEMENT: { role: 'element', material: 'concrete' },
  IFCFURNISHINGELEMENT: { role: 'furniture', material: 'timber' },
  IFCFLOWTERMINAL: { role: 'fixture', material: 'steel' },
  IFCSANITARYTERMINAL: { role: 'fixture', material: 'ceramic' },
  IFCREINFORCINGBAR: { role: 'reinforcement', material: 'steel' },

  // ── IFC4.3 인프라 (260729c) ────────────────────────────────────────────────
  // 실측: PCERT 4.3 인프라 씬이 Rail 73→1 · Road 33→1 로 무너졌다. 원인은 4.3 이
  // 신설한 토목 클래스를 몰라서다(IFC4.3 은 도로·철도·교량·항만을 정식 지원한다).
  //
  // ⚠ **물리 요소만 넣는다.** `IfcRoad`·`IfcRailway`·`IfcBridge` 와 `*Part` 는
  //   `IfcFacility`/`IfcFacilityPart` — **공간 구조**(건물의 IfcBuilding·IfcBuildingStorey
  //   자리)이지 물체가 아니다. 이들을 부품으로 임포트하면 **공간을 물체로 바꾸는 것**이라
  //   부피·질량·간섭이 전부 허구가 된다. 아래 SPATIAL_CLASSES 에서 명시적으로 건너뛴다.
  IFCTRACKELEMENT: { role: 'track', material: 'concrete' },   // 궤도 요소(침목·분기 등)
  IFCRAIL: { role: 'rail', material: 'steel' },               // 레일
  IFCCOURSE: { role: 'course', material: 'concrete' },        // 노반층·도상(층상 요소)
  IFCPAVEMENT: { role: 'pavement', material: 'concrete' },    // 포장
  IFCEARTHWORKSFILL: { role: 'earthworks', material: 'concrete' },  // 성토(재질=흙이나 밀도 미선언 → 보수측 표기)
  IFCEARTHWORKSCUT: { role: 'earthworks', material: 'concrete' },   // 절토
  IFCSIGN: { role: 'sign', material: 'steel' },               // 표지
  IFCSIGNAL: { role: 'signal', material: 'steel' },           // 신호기
  IFCGEOGRAPHICELEMENT: { role: 'geographic', material: 'timber' }, // 수목·지형지물
  IFCKERB: { role: 'kerb', material: 'concrete' },            // 연석
  IFCMOORINGDEVICE: { role: 'mooring', material: 'steel' },
  IFCBEARING: { role: 'bearing', material: 'steel' },         // 교량 받침
  IFCDEEPFOUNDATION: { role: 'footing', material: 'concrete' },
  IFCPILE: { role: 'pile', material: 'concrete' },
};

/**
 * **공간 구조** — 물리 요소가 아니므로 부품으로 임포트하지 않는다.
 *
 * IFC4.3 의 `IfcFacility`(IfcRoad·IfcRailway·IfcBridge·IfcMarineFacility)와
 * `IfcFacilityPart`(IfcRoadPart·IfcRailwayPart·IfcBridgePart)는 건물의 IfcBuilding·
 * IfcBuildingStorey 와 같은 자리다. 형상 표현을 갖는 경우도 있지만 그것은 **영역 경계**이지
 * 부재가 아니다 — 부품으로 세면 부피·질량·간섭이 전부 허구가 되고, 자식 요소와 **이중
 * 계상**된다. 건너뛴 사실은 `skipByClass` 에 남는다(조용히 버리지 않는다).
 */
const SPATIAL_CLASSES = new Set([
  'IFCROAD', 'IFCRAILWAY', 'IFCBRIDGE', 'IFCMARINEFACILITY', 'IFCFACILITY',
  'IFCROADPART', 'IFCRAILWAYPART', 'IFCBRIDGEPART', 'IFCMARINEPART', 'IFCFACILITYPART',
  'IFCSITE', 'IFCBUILDING', 'IFCBUILDINGSTOREY', 'IFCSPACE', 'IFCSPATIALZONE',
  // 조립체는 자식 요소를 묶는 컨테이너다 — 자식과 함께 세면 이중 계상이다.
  'IFCELEMENTASSEMBLY',
]);

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

export interface IfcAuthoritativeGeometryOverride { globalId: string; axis: number; valueMm: number; provenance: string }
export interface IfcImportOptions { name?: string; maxParts?: number; authoritativeGeometryOverrides?: IfcAuthoritativeGeometryOverride[] }

export function ifcToNexyfabAssembly(source: string, { name = 'IFC import', maxParts = 600, authoritativeGeometryOverrides = [] }: IfcImportOptions = {}): IfcImportResult {
  const partLimit = Number.isSafeInteger(maxParts) && maxParts > 0 ? maxParts : 600;
  if (source.length > 300_000_000) return { ok: false, error: 'IFC 300MB 초과 — 파일 예산 밖(층/동 분할 내보내기 필요, 정직 거부)' };
  if (!/FILE_SCHEMA\s*\(\s*\(\s*'IFC/i.test(source.slice(0, 4000))) return { ok: false, error: 'IFC 스키마 헤더 없음 — IFC SPF 파일이 아님' };

  // ── 1. 엔티티 인덱스(#id=NAME(raw);) ──
  const ents = new Map<number, Ent>();
  const re = /#(\d+)\s*=\s*([A-Z0-9_]+)\s*\(([\s\S]*?)\)\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) ents.set(+m[1], { name: m[2], raw: m[3] });
  if (ents.size === 0) return { ok: false, error: '엔티티 0건 — 파싱 실패' };
  const approvedOverrideByGlobalId = new Map(authoritativeGeometryOverrides.map(value => [value.globalId, value]));

  // ── 2. 단위 스케일(m→1000·mm→1) ──
  let unitScale = 1, areaScaleToMm2 = 1_000_000, volumeScaleToMm3 = 1_000_000_000;
  let lengthUnitFound = false, areaUnitFound = false, volumeUnitFound = false;
  for (const e of ents.values()) {
    if (!lengthUnitFound && e.name === 'IFCSIUNIT' && e.raw.includes('.LENGTHUNIT.')) {
      unitScale = e.raw.includes('.MILLI.') ? 1 : 1000;
      lengthUnitFound = true;
    }
    if (!areaUnitFound && e.name === 'IFCSIUNIT' && e.raw.includes('.AREAUNIT.')) { areaScaleToMm2 = e.raw.includes('.MILLI.') ? 1 : 1_000_000; areaUnitFound = true; }
    if (!volumeUnitFound && e.name === 'IFCSIUNIT' && e.raw.includes('.VOLUMEUNIT.')) { volumeScaleToMm3 = e.raw.includes('.MILLI.') ? 1 : 1_000_000_000; volumeUnitFound = true; }
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
    const is2d = e.name === 'IFCAXIS2PLACEMENT2D';
    const zAx = is2d ? [0, 0, 1] : readDir(refOf(a[1])) ?? [0, 0, 1];
    const xRef = readDir(refOf(is2d ? a[1] : a[2])) ?? defaultX(zAx);
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
    if (!e) return I4;
    if (e.name === 'IFCLINEARPLACEMENT') {
      const a = splitArgs(e.raw); const M = mul(placementM(refOf(a[0]), guard + 1), axis2M(refOf(a[2]))); placeCache.set(id, M); return M;
    }
    if (e.name !== 'IFCLOCALPLACEMENT') return I4;
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
  /**
   * 삼각 메시의 **실부피**(로컬 좌표, mm³). 없으면 0.
   *
   * ⚠ 260729c 실측: PCERT 요소의 실부피/AABB 부피가 **최소 0.017**(58배 과대) ·
   * 중앙 0.967 · 평균 1.40배 과대였다. 대부분은 박스형(벽·기초)이라 AABB 가 거의 맞지만
   * 경사·얇은 요소에서 크게 벌어진다 — 부피가 58배 틀리면 질량·물량·원가가 전부 틀린다.
   * 좌표와 면 인덱스가 다 있는데 박스로 뭉개는 것은 **있는 정보를 버리는 것**이다.
   *
   * 발산정리(Σ P·(Q×R)/6). IFC 인덱스는 1-base 다.
   */
  const meshVolOf = (id: number, depth = 0): number => {
    const e = ents.get(id);
    if (!e || depth > 12) return 0;
    if (e.name === 'IFCCLOSEDSHELL') {
      let v6 = 0, triangles = 0, faces = 0;
      for (const faceRef of (e.raw.match(/#\d+/g) ?? []).map(value => +value.slice(1))) {
        const face = ents.get(faceRef); if (face?.name !== 'IFCFACE') continue;
        const bounds = (face.raw.match(/#\d+/g) ?? []).map(value => +value.slice(1)).map(value => ents.get(value)).filter((value): value is Ent => value?.name === 'IFCFACEOUTERBOUND');
        const bound = bounds[0]; if (!bound) continue;
        const boundArgs = splitArgs(bound.raw), loop = ents.get(refOf(boundArgs[0]) ?? -1); if (loop?.name !== 'IFCPOLYLOOP') continue;
        const points = (loop.raw.match(/#\d+/g) ?? []).map(value => readPoint(+value.slice(1))); if (points.length < 3) continue;
        if (boundArgs[1]?.toUpperCase() === '.F.') points.reverse();
        const p = points[0]!;
        for (let index = 1; index + 1 < points.length; index++) {
          const q = points[index]!, r = points[index + 1]!;
          v6 += p[0] * (q[1] * r[2] - q[2] * r[1]) + p[1] * (q[2] * r[0] - q[0] * r[2]) + p[2] * (q[0] * r[1] - q[1] * r[0]); triangles++;
        }
        faces++;
      }
      return faces >= 4 && triangles >= 4 ? Math.abs(v6 / 6) : 0;
    }
    if (e.name === 'IFCTRIANGULATEDFACESET' || e.name === 'IFCPOLYGONALFACESET') {
      const a = splitArgs(e.raw);
      const listId = refOf(a[0]);
      const pts: number[][] = [];
      if (listId != null) {
        const pe = ents.get(listId);
        if (pe && /CARTESIANPOINTLIST3D/.test(pe.name)) {
          for (const m of pe.raw.matchAll(/\(([^()]*)\)/g)) {
            const v = m[1].split(',').map(Number);
            if (v.length >= 3 && v.every(Number.isFinite)) pts.push([v[0] * unitScale, v[1] * unitScale, v[2] * unitScale]);
          }
        }
      }
      if (pts.length < 3) return 0;
      let v6 = 0, tri = 0;
      // 삼각 인덱스는 마지막 인수들에 ((i,j,k),…) 형태로 온다.
      for (const m of e.raw.matchAll(/\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/g)) {
        const P = pts[+m[1] - 1], Q = pts[+m[2] - 1], R = pts[+m[3] - 1];
        if (!P || !Q || !R) continue;
        v6 += P[0] * (Q[1] * R[2] - Q[2] * R[1]) + P[1] * (Q[2] * R[0] - Q[0] * R[2]) + P[2] * (Q[0] * R[1] - Q[1] * R[0]);
        tri++;
      }
      return tri >= 4 ? Math.abs(v6 / 6) : 0;   // 사면체 미만은 닫힌 solid 가 아니다
    }
    // 표현 트리를 따라 내려간다(ShapeRepresentation → Items → …).
    let sum = 0;
    for (const m of e.raw.matchAll(/#(\d+)/g)) sum += meshVolOf(+m[1], depth + 1);
    return sum;
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
    /**
     * IFC4 테셀레이션 좌표 리스트 (260729b).
     *
     * ⚠ 실측: buildingSMART **공식 import-certification 세트(PCERT 18파일)를 하나도
     * 임포트하지 못했다** — 요소는 감지되는데(Building-Structural 15건 등) 형상 0건.
     * 원인은 IFC4 의 표준 형상 표현인 `IfcTriangulatedFaceSet` 이 좌표를 개별
     * `IfcCartesianPoint` 가 아니라 **`IfcCartesianPointList3D`** 한 덩어리에 담기 때문이다.
     * 점 스캔이 그 형태를 몰라 폐포가 비었고, 결과는 "지원 클래스/형상 없음" 이었다.
     *
     * 기존 IFC2X3 코퍼스(17,269부품 임포트)는 개별 점을 써서 이 한계가 드러나지 않았다 —
     * **다른 표현을 쓰는 파일군에서만 나타나는 구멍**이었다.
     *
     * 좌표 리스트는 `((x,y,z),(x,y,z),…)` 형태라 숫자를 3개씩 끊어 읽으면 폐포가 나온다.
     * 면 인덱스는 보지 않는다 — AABB 근사에는 좌표 폐포만 있으면 되고, 그 근사임은
     * 기존 `importedApprox` 규약이 이미 밝힌다.
     */
    if (e.name === 'IFCCARTESIANPOINTLIST3D' || e.name === 'IFCCARTESIANPOINTLIST2D') {
      const dim = e.name.endsWith('3D') ? 3 : 2;
      const nums = e.raw.match(/-?\d+(?:\.\d*)?(?:[eE][-+]?\d+)?/g)?.map(Number) ?? [];
      let res: B3 | null = null;
      for (let i = 0; i + dim - 1 < nums.length; i += dim) {
        const p = [nums[i] * unitScale, nums[i + 1] * unitScale, (dim === 3 ? nums[i + 2] : 0) * unitScale];
        res = res
          ? { min: res.min.map((v, k) => Math.min(v, p[k])), max: res.max.map((v, k) => Math.max(v, p[k])) }
          : { min: [...p], max: [...p] };
      }
      bCache.set(id, res);
      return res;
    }
    inStack.add(id);
    let acc: B3 | null = null;
    if (e.name === 'IFCCIRCLE' || e.name === 'IFCELLIPSE') {
      const a = splitArgs(e.raw); const rx = (parseFloat(a[1]) || 0) * unitScale; const ry = e.name === 'IFCELLIPSE' ? (parseFloat(a[2]) || 0) * unitScale : rx;
      if (rx > 0 && ry > 0) acc = xformB({ min: [-rx, -ry, 0], max: [rx, ry, 0] }, axis2M(refOf(a[0])));
    } else if (e.name === 'IFCRECTANGLEPROFILEDEF' || e.name === 'IFCCIRCLEPROFILEDEF' || e.name === 'IFCCIRCLEHOLLOWPROFILEDEF' || e.name === 'IFCISHAPEPROFILEDEF' || e.name === 'IFCLSHAPEPROFILEDEF' || e.name === 'IFCUSHAPEPROFILEDEF' || e.name === 'IFCTSHAPEPROFILEDEF') {
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
    } else if (e.name === 'IFCBLOCK') {
      const a = splitArgs(e.raw);
      const x = (parseFloat(a[1]) || 0) * unitScale, y = (parseFloat(a[2]) || 0) * unitScale, z = (parseFloat(a[3]) || 0) * unitScale;
      if (x > 0 && y > 0 && z > 0) acc = xformB({ min: [0, 0, 0], max: [x, y, z] }, axis2M(refOf(a[0])));
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
    } else if (e.name === 'IFCFIXEDREFERENCESWEPTAREASOLID' || e.name === 'IFCSECTIONEDSOLIDHORIZONTAL' || e.name === 'IFCSECTIONEDSOLID') {
      const a = splitArgs(e.raw);
      const directrix = boundsOf(refOf(e.name === 'IFCFIXEDREFERENCESWEPTAREASOLID' ? a[2] : a[0]) ?? -1, depth + 1);
      const profileIds = e.name === 'IFCFIXEDREFERENCESWEPTAREASOLID'
        ? [refOf(a[0])].filter((value): value is number => value !== null)
        : (a[1]?.match(/#\d+/g) ?? []).map(value => +value.slice(1));
      let profile: B3 | null = null;
      for (const profileId of profileIds) profile = mergeB(profile, boundsOf(profileId, depth + 1));
      if (directrix && profile) {
        // Section orientation changes along the curve. Expanding the directrix
        // by the maximum profile radius on all axes is conservative and avoids
        // inventing an exact swept B-rep while retaining collision-safe bounds.
        const radius = Math.max(...profile.min.map(Math.abs), ...profile.max.map(Math.abs));
        if (radius > 0) acc = { min: directrix.min.map(value => value - radius), max: directrix.max.map(value => value + radius) };
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
  const tryExtrusion = (solidId: number): { min: number[]; max: number[]; M: M4; exactBox: boolean } | null => {
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
      return { min: [ox - xd / 2, oy - yd / 2, 0], max: [ox + xd / 2, oy + yd / 2, depth], M: posM, exactBox: true };
    }
    if (prof.name === 'IFCARBITRARYCLOSEDPROFILEDEF') {
      const pa = splitArgs(prof.raw);
      const curve = refOf(pa[2]);
      if (curve == null) return null;
      const b = localBounds([curve]);
      if (!b) return null;
      return { min: [b.min[0], b.min[1], 0], max: [b.max[0], b.max[1], depth], M: axis2M(refOf(a[1])), exactBox: false };
    }
    return null;
  };

  // ── 5. 요소 수집·방출 ──
  const parts: NonNullable<IfcImportResult['assembly']>['parts'] = [];
  const byClass: Record<string, number> = {};
  let exact = 0, approx = 0, skipped = 0, elements = 0, authoritativeThicknessRecoveries = 0, authoritativeInputRecoveries = 0;
  const appliedAuthoritativeInputs: NonNullable<NonNullable<IfcImportResult['stats']>['appliedAuthoritativeInputs']> = [];
  const skipByClass: Record<string, number> = {};
  const dimensionSamples: Record<string, number[][]> = {};
  const dimensionEvidence: Array<{ entityId: number; ifcClass: string; dimensions: number[] }> = [];
  const skipC = (cls: string, why = '?') => { skipped++; const k = cls + ':' + why; skipByClass[k] = (skipByClass[k] ?? 0) + 1; };
  const recordDimensions = (cls: string, values: number[], entityId: number | null) => { const measured = values.map(value => +value.toPrecision(8)); const samples = dimensionSamples[cls] ?? []; if (samples.length < 8) samples.push(measured); dimensionSamples[cls] = samples; if (entityId !== null) dimensionEvidence.push({ entityId, ifcClass: cls, dimensions: measured }); };
  const used = new Set<string>();
  // IFC occurrences may intentionally omit Representation and inherit a
  // mapped representation from their IfcTypeProduct via IfcRelDefinesByType.
  const typeRepresentationRefs = new Map<number, number[]>();
  const occurrenceTypeIds = new Map<number, number>();
  const materialRootsByObject = new Map<number, number[]>();
  const propertyRootsByObject = new Map<number, number[]>();
  const decompositionParents = new Set<number>();
  for (const e of ents.values()) {
    if (e.name === 'IFCRELAGGREGATES') { const parentId = refOf(splitArgs(e.raw)[4]); if (parentId !== null) decompositionParents.add(parentId); }
    if (e.name === 'IFCRELASSOCIATESMATERIAL') {
      const materialArgs = splitArgs(e.raw); const materialId = refOf(materialArgs[5]);
      if (materialId !== null) for (const objectId of (materialArgs[4]?.match(/#\d+/g) ?? []).map(value => +value.slice(1))) materialRootsByObject.set(objectId, [...(materialRootsByObject.get(objectId) ?? []), materialId]);
    }
    if (e.name === 'IFCRELDEFINESBYPROPERTIES') {
      const propertyArgs = splitArgs(e.raw); const propertyId = refOf(propertyArgs[5]);
      if (propertyId !== null) for (const objectId of (propertyArgs[4]?.match(/#\d+/g) ?? []).map(value => +value.slice(1))) propertyRootsByObject.set(objectId, [...(propertyRootsByObject.get(objectId) ?? []), propertyId]);
    }
    if (e.name !== 'IFCRELDEFINESBYTYPE') continue;
    const args = splitArgs(e.raw); const typeId = refOf(args[5]); const typeEntity = typeId == null ? null : ents.get(typeId);
    const representationMaps = typeEntity ? (splitArgs(typeEntity.raw)[6]?.match(/#\d+/g) ?? []).map(value => +value.slice(1)) : [];
    for (const occurrence of (args[4]?.match(/#\d+/g) ?? []).map(value => +value.slice(1))) {
      if (typeId !== null) occurrenceTypeIds.set(occurrence, typeId);
      if (representationMaps.length) typeRepresentationRefs.set(occurrence, representationMaps);
    }
  }
  const representationKindCache = new Map<number, string[]>();
  const representationKinds = (rootId: number | null): string[] => {
    if (rootId === null) return [];
    const cached = representationKindCache.get(rootId); if (cached) return cached;
    const pending = [rootId], seen = new Set<number>(), kinds = new Set<string>();
    while (pending.length && seen.size < 20_000) {
      const id = pending.pop()!; if (seen.has(id)) continue; seen.add(id); const entity = ents.get(id); if (!entity) continue;
      if (/^(?:IFC(?:FACETEDBREP|SHELLBASEDSURFACEMODEL|FACEBASEDSURFACEMODEL|TRIANGULATEDFACESET|POLYGONALFACESET|EXTRUDEDAREASOLID|BOOLEANRESULT|BOOLEANCLIPPINGRESULT|MAPPEDITEM|GEOMETRICSET))$/.test(entity.name)) kinds.add(entity.name);
      for (const match of entity.raw.matchAll(/#(\d+)/g)) pending.push(+match[1]);
    }
    const result = [...kinds].sort(); representationKindCache.set(rootId, result); return result;
  };
  const surfaceMeshOf = (rootId: number | null): { verts: number[][]; faces: number[][]; openSurface: boolean } | null => {
    if (rootId === null) return null;
    const inverseRigid = (matrix: M4): M4 => { const tx = matrix[3], ty = matrix[7], tz = matrix[11]; return [matrix[0], matrix[4], matrix[8], -(matrix[0] * tx + matrix[4] * ty + matrix[8] * tz), matrix[1], matrix[5], matrix[9], -(matrix[1] * tx + matrix[5] * ty + matrix[9] * tz), matrix[2], matrix[6], matrix[10], -(matrix[2] * tx + matrix[6] * ty + matrix[10] * tz)]; };
    const operatorM = (id: number | null): M4 => { const entity = id === null ? null : ents.get(id); if (!entity) return I4; const args = splitArgs(entity.raw), x = readDir(refOf(args[0])) ?? [1, 0, 0], y = readDir(refOf(args[1])) ?? [0, 1, 0], origin = readPoint(refOf(args[2])), scale = parseFloat(args[3]) || 1, z = readDir(refOf(args[4])) ?? [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]]; return [x[0] * scale, y[0] * scale, z[0] * scale, origin[0], x[1] * scale, y[1] * scale, z[1] * scale, origin[1], x[2] * scale, y[2] * scale, z[2] * scale, origin[2]]; };
    const verts: number[][] = [], faces: number[][] = []; let openSurface = false;
    const walk = (id: number, transform: M4, stack: Set<number>, depth: number) => {
      if (depth > 220 || stack.has(id) || verts.length > 2_000_000) return; const entity = ents.get(id); if (!entity || STOP_NAMES.has(entity.name)) return; const nextStack = new Set(stack).add(id);
      if (entity.name === 'IFCMAPPEDITEM') { const args = splitArgs(entity.raw), map = ents.get(refOf(args[0]) ?? -1); if (!map) return; const mapArgs = splitArgs(map.raw), source = refOf(mapArgs[1]), origin = axis2M(refOf(mapArgs[0])), target = operatorM(refOf(args[1])); if (source !== null) walk(source, mul(transform, mul(target, inverseRigid(origin))), nextStack, depth + 1); return; }
      if (entity.name === 'IFCCLOSEDSHELL' || entity.name === 'IFCOPENSHELL') {
        if (entity.name === 'IFCOPENSHELL') openSurface = true;
        const vertexByCoordinate = new Map<string, number>(); const vertex = (pointId: number) => { const point = readPoint(pointId), transformed = applyM(transform, point[0], point[1], point[2]), key = transformed.map(value => Math.round(value * 1e6)).join(':'); const existing = vertexByCoordinate.get(key); if (existing !== undefined) return existing; const index = verts.length; verts.push(transformed); vertexByCoordinate.set(key, index); return index; };
        for (const faceId of (entity.raw.match(/#\d+/g) ?? []).map(value => +value.slice(1))) { const face = ents.get(faceId); if (face?.name !== 'IFCFACE') continue; const outerId = (face.raw.match(/#\d+/g) ?? []).map(value => +value.slice(1)).find(value => ents.get(value)?.name === 'IFCFACEOUTERBOUND'); if (outerId === undefined) continue; const outer = ents.get(outerId)!, args = splitArgs(outer.raw), loop = ents.get(refOf(args[0]) ?? -1); if (loop?.name !== 'IFCPOLYLOOP') continue; const polygon = (loop.raw.match(/#\d+/g) ?? []).map(value => vertex(+value.slice(1))); if (args[1]?.toUpperCase() === '.F.') polygon.reverse(); for (let index = 1; index + 1 < polygon.length; index++) faces.push([polygon[0]!, polygon[index]!, polygon[index + 1]!]); }
        return;
      }
      for (const match of entity.raw.matchAll(/#(\d+)/g)) walk(+match[1], transform, nextStack, depth + 1);
    };
    walk(rootId, I4, new Set(), 0);
    return verts.length >= 3 && faces.length ? { verts, faces, openSurface } : null;
  };
  const materialLayerThickness = (entityId: number): number | null => {
    const typeId = occurrenceTypeIds.get(entityId);
    const pending = [...(materialRootsByObject.get(entityId) ?? []), ...(typeId === undefined ? [] : materialRootsByObject.get(typeId) ?? [])];
    const seen = new Set<number>(), layers = new Set<number>(); let total = 0;
    while (pending.length && seen.size < 20_000) {
      const id = pending.pop()!; if (seen.has(id)) continue; seen.add(id); const entity = ents.get(id); if (!entity) continue;
      if (entity.name === 'IFCMATERIALLAYER') {
        const thickness = (parseFloat(splitArgs(entity.raw)[1]) || 0) * unitScale;
        if (thickness > 0.5 && Number.isFinite(thickness) && !layers.has(id)) { layers.add(id); total += thickness; }
        continue;
      }
      for (const match of entity.raw.matchAll(/#(\d+)/g)) pending.push(+match[1]);
    }
    return total > 0.5 ? total : null;
  };
  const quantityVolumeAreaThickness = (entityId: number): number | null => {
    const typeId = occurrenceTypeIds.get(entityId);
    const pending = [...(propertyRootsByObject.get(entityId) ?? []), ...(typeId === undefined ? [] : propertyRootsByObject.get(typeId) ?? [])];
    const seen = new Set<number>(), areas = new Set<number>(), volumes = new Set<number>();
    while (pending.length && seen.size < 20_000) {
      const id = pending.pop()!; if (seen.has(id)) continue; seen.add(id); const entity = ents.get(id); if (!entity) continue;
      if (entity.name === 'IFCQUANTITYAREA' || entity.name === 'IFCQUANTITYVOLUME') {
        const value = parseFloat(splitArgs(entity.raw)[3]) || 0;
        if (value > 0 && Number.isFinite(value)) (entity.name === 'IFCQUANTITYAREA' ? areas : volumes).add(+value.toPrecision(10));
        continue;
      }
      for (const match of entity.raw.matchAll(/#(\d+)/g)) pending.push(+match[1]);
    }
    if (areas.size !== 1 || volumes.size !== 1) return null;
    const area = [...areas][0]! * areaScaleToMm2, volume = [...volumes][0]! * volumeScaleToMm3;
    const thickness = volume / area;
    return Number.isFinite(thickness) && thickness > 0.5 ? thickness : null;
  };
  const emit = (cls: string, nameStr: string, place: M4, lb: { min: number[]; max: number[] }, extM: M4 | null, repId: number | null = null, sourceEntityId: number | null = null, forceApprox = false) => {
    const meta = ELEMENT_CLASSES[cls] ?? { role: 'definition', material: 'unspecified' };
    const sourceRepresentationKinds = representationKinds(repId);
    const M = extM ? mul(place, extM) : place;
    // 순수 z-회전 판정 → rz 보존 box(정밀 간섭 판정 가능), 아니면 월드 AABB
    const pureZ = Math.abs(M[2]) < 1e-6 && Math.abs(M[6]) < 1e-6 && Math.abs(M[8]) < 1e-6 && Math.abs(M[9]) < 1e-6 && Math.abs(M[10] - 1) < 1e-6;
    let id = nameStr.replace(/[^\w가-힣-]/g, '_').slice(0, 40) || cls.toLowerCase();
    while (used.has(id)) id = `${id}_`;
    used.add(id);
    let governedBounds = lb;
    let dims = [lb.max[0] - lb.min[0], lb.max[1] - lb.min[1], lb.max[2] - lb.min[2]];
    const missingAxes = dims.flatMap((dimension, index) => !Number.isFinite(dimension) || dimension <= 0.5 ? [index] : []);
    if (sourceEntityId !== null && ['IFCWALL', 'IFCWALLSTANDARDCASE'].includes(cls) && missingAxes.length === 1) {
      const thickness = materialLayerThickness(sourceEntityId);
      if (thickness !== null) {
        const axis = missingAxes[0]!; governedBounds = { min: [...lb.min], max: [...lb.max] };
        const center = (lb.min[axis]! + lb.max[axis]!) / 2;
        governedBounds.min[axis] = center - thickness / 2; governedBounds.max[axis] = center + thickness / 2;
        dims = governedBounds.max.map((value, index) => value - governedBounds.min[index]!);
        authoritativeThicknessRecoveries++;
      }
    }
    if (sourceEntityId !== null && cls === 'IFCDOOR' && missingAxes.length === 1 && dims.some(dimension => !Number.isFinite(dimension) || dimension <= 0.5)) {
      const thickness = quantityVolumeAreaThickness(sourceEntityId);
      if (thickness !== null) {
        const axis = missingAxes[0]!; governedBounds = { min: [...lb.min], max: [...lb.max] };
        const center = (lb.min[axis]! + lb.max[axis]!) / 2;
        governedBounds.min[axis] = center - thickness / 2; governedBounds.max[axis] = center + thickness / 2;
        dims = governedBounds.max.map((value, index) => value - governedBounds.min[index]!);
        authoritativeThicknessRecoveries++;
      }
    }
    if (sourceEntityId !== null && missingAxes.length === 1 && dims.some(dimension => !Number.isFinite(dimension) || dimension <= 0.5)) {
      const sourceEntity = ents.get(sourceEntityId); const sourceArgs = sourceEntity ? splitArgs(sourceEntity.raw) : [];
      const globalId = sourceArgs[0]?.match(/^'([^']+)'$/)?.[1]; const override = globalId ? approvedOverrideByGlobalId.get(globalId) : undefined;
      if (override && override.axis === missingAxes[0]) {
        const beforeDimensionsMm = [...dims], axis = override.axis;
        governedBounds = { min: [...governedBounds.min], max: [...governedBounds.max] };
        const center = (governedBounds.min[axis]! + governedBounds.max[axis]!) / 2;
        governedBounds.min[axis] = center - override.valueMm / 2; governedBounds.max[axis] = center + override.valueMm / 2;
        dims = governedBounds.max.map((value, index) => value - governedBounds.min[index]!);
        authoritativeInputRecoveries++;
        appliedAuthoritativeInputs.push({ entityId: sourceEntityId, globalId: globalId!, axis, valueMm: override.valueMm, provenance: override.provenance, beforeDimensionsMm, afterDimensionsMm: [...dims] });
      }
    }
    if (!dims.every((d) => Number.isFinite(d) && d > 0.5)) { recordDimensions(cls, dims, sourceEntityId); skipC(cls, 'dims'); return; }
    if (pureZ && extM && !forceApprox) {
      const rz = (Math.atan2(M[4], M[0]) * 180) / Math.PI;
      const c = Math.cos((rz * Math.PI) / 180), s = Math.sin((rz * Math.PI) / 180);
      // 로컬 min 코너를 rz 회전 원점으로 환산
      const tx = M[3] + governedBounds.min[0] * c - governedBounds.min[1] * s;
      const ty = M[7] + governedBounds.min[0] * s + governedBounds.min[1] * c;
      parts.push({ id, type: 'box', params: { width: +dims[0].toFixed(1), depth: +dims[1].toFixed(1), height: +dims[2].toFixed(1) }, at: { tx: +tx.toFixed(1), ty: +ty.toFixed(1), tz: +(M[11] + governedBounds.min[2]).toFixed(1), ...(Math.abs(rz) > 0.01 ? { rz: +rz.toFixed(2) } : {}) }, role: meta.role, material: meta.material, geometryEvidence: 'exact_extrusion_box', sourceClass: cls, representationKinds: sourceRepresentationKinds });
      exact++;
    } else {
      const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (const cx of [governedBounds.min[0], governedBounds.max[0]]) for (const cy of [governedBounds.min[1], governedBounds.max[1]]) for (const cz of [governedBounds.min[2], governedBounds.max[2]]) {
        const w = applyM(M, cx, cy, cz);
        for (let k = 0; k < 3; k++) { if (w[k] < mn[k]) mn[k] = w[k]; if (w[k] > mx[k]) mx[k] = w[k]; }
      }
      const wd = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
      if (!wd.every((d) => Number.isFinite(d) && d > 0.5)) { recordDimensions(cls, wd, sourceEntityId); skipC(cls, 'wdims'); return; }
      // 삼각 메시가 있으면 **실부피**를 살린다 — 박스로 뭉개면 최대 58배 과대(실측).
      // 배치 변환의 행렬식으로 스케일을 보정한다(회전·평행이동은 부피 불변이라 1).
      const det = Math.abs(
        M[0] * (M[5] * M[10] - M[6] * M[9])
        - M[1] * (M[4] * M[10] - M[6] * M[8])
        + M[2] * (M[4] * M[9] - M[5] * M[8]),
      );
      const mv = repId != null ? meshVolOf(repId) * (Number.isFinite(det) && det > 0 ? det : 1) : 0;
      const boxVol = wd[0] * wd[1] * wd[2];
      const surfaceMesh = surfaceMeshOf(repId);
      if (surfaceMesh) {
        const repair = repairIndexedMeshDegenerateFaces(surfaceMesh.verts, surfaceMesh.faces), closure = repair.after, boundaries = classifyIndexedMeshBoundaries(repair.verts, repair.faces, 0.01), topologyVolume = closure.volumeMm3 * (Number.isFinite(det) && det > 0 ? det : 1), effectiveVolume = closure.watertight ? topologyVolume : 0;
        const worldVerts = surfaceMesh.verts.map(vertex => applyM(M, vertex[0]!, vertex[1]!, vertex[2]!));
        const meshMin = [Infinity, Infinity, Infinity], meshMax = [-Infinity, -Infinity, -Infinity]; for (const vertex of worldVerts) for (let axis = 0; axis < 3; axis++) { meshMin[axis] = Math.min(meshMin[axis]!, vertex[axis]!); meshMax[axis] = Math.max(meshMax[axis]!, vertex[axis]!); } const meshSize = meshMax.map((value, axis) => value - meshMin[axis]!);
        const localVerts = worldVerts.map(vertex => vertex.map((value, axis) => +(value - meshMin[axis]!).toFixed(6)));
        parts.push({ id, type: 'mesh', params: { ...(effectiveVolume > 0 ? { volumeMm3: +effectiveVolume.toFixed(1) } : {}), aabb: { min: [0, 0, 0], max: meshSize.map(value => +value.toFixed(1)) }, verts: localVerts, faces: repair.faces, openSurface: !closure.watertight }, at: { tx: +meshMin[0]!.toFixed(1), ty: +meshMin[1]!.toFixed(1), tz: +meshMin[2]!.toFixed(1) }, role: meta.role, material: meta.material, ...(effectiveVolume > 0 ? { meshVolumeExact: true } : {}), boxVolumeMm3: +boxVol.toFixed(1), geometryEvidence: 'exact_surface_mesh', sourceClass: cls, representationKinds: sourceRepresentationKinds, closureEvidence: { watertight: closure.watertight, sourceDeclaredOpenSurface: surfaceMesh.openSurface, boundaryEdges: closure.boundaryEdges, nonManifoldEdges: closure.nonManifoldEdges, degenerateFaces: closure.degenerateFaces, orientationConsistent: closure.orientationConsistent, degenerateRepairApplied: repair.accepted, removedDegenerateFaces: repair.removedFaces, boundaryComponents: boundaries.components, closedBoundaryLoops: boundaries.closedLoops, openBoundaryChains: boundaries.openChains, branchedBoundaryComponents: boundaries.branchedComponents, planarClosedBoundaryLoops: boundaries.planarClosedLoops, microGapCandidates: boundaries.microGapCandidates, totalBoundaryLengthMm: boundaries.totalBoundaryLengthMm } });
      } else if (mv > 0 && mv <= boxVol * 1.001) {
        parts.push({
          id, type: 'mesh',
          params: {
            volumeMm3: +mv.toFixed(1),
            aabb: { min: [0, 0, 0], max: [+wd[0].toFixed(1), +wd[1].toFixed(1), +wd[2].toFixed(1)] },
          },
          at: { tx: +mn[0].toFixed(1), ty: +mn[1].toFixed(1), tz: +mn[2].toFixed(1) },
          role: meta.role, material: meta.material,
          // 형상은 여전히 AABB 로 표시되지만 **부피·질량은 실측**이다 — 둘을 구별해 적는다.
          meshVolumeExact: true, boxVolumeMm3: +boxVol.toFixed(1),
          geometryEvidence: 'exact_mesh_volume_aabb_display',
          sourceClass: cls,
          representationKinds: sourceRepresentationKinds,
        });
      } else {
        parts.push({ id, type: 'box', params: { width: +wd[0].toFixed(1), depth: +wd[1].toFixed(1), height: +wd[2].toFixed(1) }, at: { tx: +mn[0].toFixed(1), ty: +mn[1].toFixed(1), tz: +mn[2].toFixed(1) }, role: meta.role, material: meta.material, geometryEvidence: 'aabb_only', sourceClass: cls, representationKinds: sourceRepresentationKinds });
      }
      approx++;
    }
  };

  for (const [entityId, e] of ents) {
    // 공간 구조는 **부품이 아니다** — 세지도 임포트하지도 않고 그 사실만 남긴다.
    // (IfcRoad·IfcRoadPart 등을 물체로 넣으면 부피·질량·간섭이 허구가 되고 자식과 이중 계상)
    if (SPATIAL_CLASSES.has(e.name)) { skipC(e.name, 'spatial'); continue; }
    const meta = ELEMENT_CLASSES[e.name];
    if (!meta) continue;
    const a = splitArgs(e.raw);
    const repId = refOf(a[6]);
    // A decomposed parent is an assembly/container occurrence even when an
    // Axis/FootPrint representation is present. Its children are the physical
    // solids; counting the parent again invents a duplicate zero-thickness part.
    if (decompositionParents.has(entityId)) { skipC(e.name, 'aggregate'); continue; }
    const occurrenceName = a[2]?.replace(/'/g, '') ?? '';
    if (repId == null && e.name === 'IFCBUILDINGELEMENTPROXY' && /^Group#/i.test(occurrenceName)) { skipC(e.name, 'placeholder'); continue; }
    if (repId !== null) {
      const pds = ents.get(repId); const representationIds = pds ? (pds.raw.match(/#\d+/g) ?? []).map(value => +value.slice(1)) : [];
      const representations = representationIds.map(id => ents.get(id)).filter((value): value is Ent => value?.name === 'IFCSHAPEREPRESENTATION');
      const referenceOnly = representations.length > 0 && representations.every(representation => {
        const repArgs = splitArgs(representation.raw); const identifier = repArgs[1]?.replace(/'/g, '').toUpperCase(); const representationType = repArgs[2]?.replace(/'/g, '').toUpperCase();
        return ['AXIS', 'FOOTPRINT'].includes(identifier ?? '') && /CURVE/.test(representationType ?? '');
      });
      if (referenceOnly && e.name === 'IFCBUILTELEMENT') { skipC(e.name, 'reference'); continue; }
    }
    elements++;
    byClass[e.name] = (byClass[e.name] ?? 0) + 1;
    if (parts.length >= partLimit) { skipC(e.name, 'budget'); continue; } // explicit preview/full-analysis budget
    const place = placementM(refOf(a[5]));
    if (repId == null) {
      const inherited = typeRepresentationRefs.get(entityId); const inheritedBounds = inherited?.length ? localBounds(inherited) : null; const inheritedRepId = inherited?.[0] ?? null;
      if (inheritedBounds) { emit(e.name, occurrenceName || e.name, place, inheritedBounds, null, inheritedRepId, entityId); continue; }
      skipC(e.name, 'norep'); continue;
    }
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
        if (ext) { emit(e.name, splitArgs(e.raw)[2]?.replace(/'/g, '') || e.name, place, { min: ext.min, max: ext.max }, ext.M, repId, entityId, !ext.exactBox); done = true; break; }
      }
      if (done) break;
    }
    if (done) continue;
    // ②폐포 점 스캔 AABB(FacetedBrep·매핑·불리언 등 일괄 — 개구 미공제 과대측 명시)
    const lb = localBounds([repId]);
    if (lb) emit(e.name, splitArgs(e.raw)[2]?.replace(/'/g, '') || e.name, place, lb, null, repId, entityId);
    else skipC(e.name, 'nobounds');
  }

  let definitionOnly = false;
  if (parts.length === 0 && elements === 0) {
    for (const [entityId, entity] of ents) {
      if (!entity.name.endsWith('TYPE')) continue;
      const args = splitArgs(entity.raw); const maps = (args[6]?.match(/#\d+/g) ?? []).map(value => +value.slice(1));
      const bounds = maps.length ? localBounds(maps) : null;
      if (!bounds) continue;
      emit(entity.name.replace(/TYPE$/, ''), args[2]?.replace(/'/g, '') || `${entity.name}_${entityId}`, I4, bounds, null, maps[0] ?? null, entityId);
    }
    definitionOnly = parts.length > 0;
    if (definitionOnly) elements = parts.length;
  }
  if (parts.length === 0) return { ok: false, error: `건축 요소 형상 0건(요소 ${elements}) — 지원 클래스/형상 없음`, stats: { elements, imported: 0, exact, approx, skipped, unitScale, byClass, skipByClass, dimensionSamples, dimensionEvidence, authoritativeThicknessRecoveries, authoritativeInputRecoveries, appliedAuthoritativeInputs } };
  return {
    ok: true,
    assembly: {
      name, domain: definitionOnly ? 'building_definition' : 'building', importedApprox: true, definitionOnly, parts,
      note: `IFC2X3 임포트: 정확 압출 box ${exact}(rz 보존)·AABB 근사 ${approx}(FacetedBrep/매핑 — 개구 미공제 과대측 명시)·스킵 ${skipped} · 재질=클래스 기본값(IfcMaterial 후속) · 단위 ×${unitScale}`,
    },
    stats: { elements, imported: parts.length, exact, approx, skipped, unitScale, byClass, skipByClass, dimensionSamples, dimensionEvidence, authoritativeThicknessRecoveries, authoritativeInputRecoveries, appliedAuthoritativeInputs, representative: elements > partLimit },
  };
}
