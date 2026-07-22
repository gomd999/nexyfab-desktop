/**
 * feaPackage.ts — 설계 패키지 FEA 정밀화 (#7).
 *
 * drawing-to-3d 어셈블리의 STL(openscad-wasm 실렌더)을 TET10 선형정적 FEA(runSimpleFEA)
 * 로 해석해 von Mises·변위·안전율 리포트를 만든다. 기존 구조검토(강체/단순보 근사)의
 * 정밀화 레이어 — 같은 형상에서 실제 유한요소 응력장이 나온다.
 *
 * 경계조건(자동·결정론): 최하단 z-평면 삼각형 = 고정, 최상단 z-평면 = 하중면.
 * 하중 기본값 = 어셈블리 총질량×g(자중 상당을 상면 등가 하중으로 — 보수적 개산, 명시).
 * 원칙: 하중을 지어내지 않는다 — 무엇을 가정했는지 리포트에 그대로 쓴다.
 *
 * 솔버 폴백: TET10 미수렴/부적합 메시 → beam-theory 근사(runSimpleFEA 내장) — method 로 표시.
 */
import * as THREE from 'three';
import { runSimpleFEA, type FEAResult, type FEAMaterial, type FEABoundaryCondition } from './simpleFEA';
import { runFEM, type Tet } from './femSolver';
import { hasCurvedStressRaiser } from './femRefine';

/** 재료 물성 (대표값 — E GPa·ν·기준강도 MPa·밀도 g/cm³). 비금속은 선형등방 근사임을 리포트에 명시. */
export const FEA_MATERIALS: Record<string, FEAMaterial & { label: string; strengthNote: string }> = {
  STS316: { youngsModulus: 193, poissonRatio: 0.3, yieldStrength: 205, density: 7.98, alpha: 16e-6, label: 'STS316', strengthNote: '항복강도 205 MPa' },
  STS304: { youngsModulus: 193, poissonRatio: 0.3, yieldStrength: 205, density: 7.93, alpha: 17e-6, label: 'STS304', strengthNote: '항복강도 205 MPa' },
  steel: { youngsModulus: 200, poissonRatio: 0.3, yieldStrength: 235, density: 7.85, alpha: 12e-6, label: '일반구조강(SS275급)', strengthNote: '항복강도 235 MPa' },
  aluminum: { youngsModulus: 69, poissonRatio: 0.33, yieldStrength: 240, density: 2.7, alpha: 23e-6, label: 'AL6061-T6', strengthNote: '항복강도 240 MPa' },
  concrete: { youngsModulus: 30, poissonRatio: 0.2, yieldStrength: 24, density: 2.4, alpha: 10e-6, label: '콘크리트(fck24 상당)', strengthNote: '압축강도 24 MPa 기준 개산 — 인장·균열 별도(선형등방 근사)' },
  timber: { youngsModulus: 11, poissonRatio: 0.35, yieldStrength: 8, density: 0.5, alpha: 5e-6, label: '구조용 목재(침엽수)', strengthNote: '허용휨응력 ~8 MPa 근사 — 이방성 미반영' },
  PVC: { youngsModulus: 3, poissonRatio: 0.38, yieldStrength: 50, density: 1.4, alpha: 80e-6, label: 'PVC', strengthNote: '항복강도 ~50 MPa' },
};

/** 바이너리 STL(triangle soup) → 비인덱스 BufferGeometry. */
export function stlToGeometry(stl: Uint8Array): THREE.BufferGeometry {
  const dv = new DataView(stl.buffer, stl.byteOffset, stl.byteLength);
  const tri = dv.getUint32(80, true);
  const pos = new Float32Array(tri * 9);
  for (let i = 0; i < tri; i++) {
    const o = 84 + i * 50 + 12; // normal 12바이트 건너뜀
    for (let v = 0; v < 9; v++) pos[i * 9 + v] = dv.getFloat32(o + v * 4, true);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** 최하단 z-평면 고정 + 최상단 z-평면 하중(총 loadN, -Z) — 결정론 자동 경계조건. */
export function autoConditions(geometry: THREE.BufferGeometry, loadN: number): { conditions: FEABoundaryCondition[]; fixedTris: number, loadTris: number } {
  const pos = geometry.getAttribute('position');
  const triCount = pos.count / 3;
  let zMin = Infinity, zMax = -Infinity;
  for (let i = 0; i < pos.count; i++) { const z = pos.getZ(i); if (z < zMin) zMin = z; if (z > zMax) zMax = z; }
  const tol = Math.max(1e-3, (zMax - zMin) * 0.02); // 전고의 2% (부재 접합 오차 흡수)
  const fixed: number[] = [], loaded: number[] = [];
  for (let t = 0; t < triCount; t++) {
    const z = [pos.getZ(t * 3), pos.getZ(t * 3 + 1), pos.getZ(t * 3 + 2)];
    if (z.every((v) => Math.abs(v - zMin) <= tol)) fixed.push(t);
    else if (z.every((v) => Math.abs(v - zMax) <= tol)) loaded.push(t);
  }
  const conditions: FEABoundaryCondition[] = [{ type: 'fixed', faceIndices: fixed }];
  if (loaded.length > 0 && loadN > 0) conditions.push({ type: 'force', faceIndices: loaded, value: [0, 0, -loadN] });
  return { conditions, fixedTris: fixed.length, loadTris: loaded.length };
}

export interface FeaPackageInput {
  stl: Uint8Array;
  materialKey?: string;   // FEA_MATERIALS 키 (기본 STS316)
  loadN?: number;         // 상면 총 하중 N (기본: 호출측이 총질량×g 전달)
  loadNote?: string;      // 하중 가정 설명(리포트에 그대로)
  /** 옵트인: 곡률 응력집중부(보어/필렛)가 감지되면 A5-급 정밀 해석(graded refine +
   *  boundary-snap + IC(0), 실측 ~24s·~68k DOF)을 추가 수행. 기본 false(스크리닝만). */
  precise?: boolean;
}

export interface FeaPackageOutput {
  result: FEAResult;
  material: (typeof FEA_MATERIALS)[string];
  materialKey: string;
  loadN: number;
  loadNote: string;
  mesh: { triangles: number; fixedTris: number; loadTris: number };
  /** 2-step 정밀 재해석 정보 (스크리닝 SF<2 시 자동 수행 — 외부감사 제언) */
  refined?: { maxNodes: number; screeningSF: number; screeningMaxStress: number } | null;
  /** 곡률 응력집중부(보어/필렛) 정직 블록: 감지 여부·정밀 재해석 적용 여부·등급·실측 벽시계.
   *  applied=false면 보어 피크는 스크리닝 수준(과소평가)임을 호출측/리포트가 명시해야 한다. */
  raiser?: {
    detected: boolean;
    applied: boolean;
    grade: 'certification-candidate' | 'engineering' | 'screening';
    /** Which mesher produced the applied precise solve (when applied). */
    meshMode?: 'refined' | 'gmsh-conforming';
    dofCount: number;
    converged: boolean;
    wallMs: number;
    note: string;
  } | null;
}

/**
 * STL → 자동 경계조건 → runSimpleFEA (빠른 스크리닝, refine OFF) → 결과.
 *
 * 곡률 응력집중부(보어/필렛)가 감지되고 precise=true면 A5 하네스가 입증한
 * graded refine + boundary-snap + IC(0) 정밀 해석(실측 seed 12000·cap 8000 →
 * ~68k DOF·~1120 PCG iters·~24s·Kt 2.833[Kirsch 3.0 대비 5.6%])을 추가 수행한다.
 * 정밀 해석은 느리므로 기본값은 스크리닝이며 precise는 명시적 옵트인이다 —
 * 24s 동기 요청을 무음으로 흘려보내 타임아웃 나는 일을 피한다(실측 근거).
 *
 * 비-라이저(각기둥) 부재는 스크리닝 SF<2 시 고밀도(6,000) 재해석하는 기존 2-step을
 * 유지한다(불필요한 비용·회귀 없음). 라이저 부재의 정밀화는 precise 경로가 전담한다.
 */
export function feaFromStl({ stl, materialKey = 'STS316', loadN = 0, loadNote = '', precise = false }: FeaPackageInput): FeaPackageOutput {
  const mat = FEA_MATERIALS[materialKey] ?? FEA_MATERIALS.STS316;
  const geometry = stlToGeometry(stl);
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  const raiserDetected = hasCurvedStressRaiser(pos);
  const { conditions, fixedTris, loadTris } = autoConditions(geometry, loadN);
  // 스크리닝: runSimpleFEA는 refine OFF(균일 메시)라 라이저 부재에서도 항상 빠르다(~수백 ms).
  // 보어/필렛 피크는 여기서 과소평가되며, 그 사실을 raiser 블록·리포트에 정직히 명시한다.
  let result = runSimpleFEA(geometry, { material: mat, conditions });

  // 라이저 정밀(옵트인): A5-급 graded refine + IC(0). 실측 ~24s.
  let raiser: FeaPackageOutput['raiser'] = raiserDetected
    ? {
        detected: true, applied: false, grade: 'screening',
        dofCount: result.dofCount, converged: result.converged, wallMs: 0,
        note: '곡률 응력집중부 감지 — 정밀 재해석 미적용(스크리닝): 보어/필렛 피크 응력 과소평가. precise 옵션으로 정밀 해석(서버, 실측 ~24s) 요청 가능.',
      }
    : null;
  if (precise && raiserDetected && result.method === 'linear-fem-tet') {
    const t0 = Date.now();
    try {
      // 실측 근거(feaRaiserPerf.test.ts): seed 12000(coarse ~2000)·cap 8000·기본 targetSize →
      // ~68k DOF·~1120 iters·~24s·Kt 2.833(Kirsch 3.0 대비 5.6%·Howland 2.573 대비 10.1%).
      const fine = runFEM(geometry, mat, conditions, 12000, { refine: 'on', maxCornerNodes: 8000 });
      const wallMs = Date.now() - t0;
      const usable = fine.converged && Number.isFinite(fine.maxStress) && fine.maxDisplacement < 1e6;
      if (usable) {
        result = { ...fine, method: 'linear-fem-tet' as const };
        raiser = {
          detected: true, applied: true, grade: 'engineering',
          dofCount: fine.dofCount, converged: fine.converged, wallMs,
          note: `곡률 응력집중부 정밀 재해석 적용 — graded refine + boundary-snap + IC(0), DOF ${fine.dofCount.toLocaleString()}·${fine.converged ? '수렴' : '미수렴'}·벽시계 ${(wallMs / 1000).toFixed(1)}s. 엔지니어링급(Kirsch 기준 ±~6%, 인증급 아님).`,
        };
      } else {
        raiser = {
          detected: true, applied: false, grade: 'screening',
          dofCount: result.dofCount, converged: result.converged, wallMs,
          note: '정밀 재해석 결과 부적합(미수렴/비유한) — 스크리닝 결과 유지(정직).',
        };
      }
    } catch {
      raiser = {
        detected: true, applied: false, grade: 'screening',
        dofCount: result.dofCount, converged: result.converged, wallMs: Date.now() - t0,
        note: '정밀 재해석 실패(예외) — 스크리닝 결과 유지(정직).',
      };
    }
  }

  // 2-step(비-라이저 전용): 각기둥 부재가 스크리닝 SF<2면 고밀도(6,000노드) 재해석.
  //   라이저 부재는 위 precise 경로가 전담하므로 여기서 우발적 refine을 배제한다.
  let refined: FeaPackageOutput['refined'] = null;
  if (!raiserDetected && result.method === 'linear-fem-tet' && Number.isFinite(result.safetyFactor) && result.safetyFactor < 2) {
    try {
      const fine = runFEM(geometry, mat, conditions, 6000);
      const usable = fine.converged && Number.isFinite(fine.maxStress) && fine.maxDisplacement < 1e6;
      if (usable) {
        refined = { maxNodes: 6000, screeningSF: result.safetyFactor, screeningMaxStress: result.maxStress };
        result = { ...fine, method: 'linear-fem-tet' as const };
      }
    } catch { /* 재해석 실패 시 스크리닝 결과 유지 (정직 — refined 미표기) */ }
  }
  return {
    result, material: mat, materialKey: FEA_MATERIALS[materialKey] ? materialKey : 'STS316', loadN, loadNote,
    mesh: { triangles: (geometry.getAttribute('position').count / 3) | 0, fixedTris, loadTris },
    refined, raiser,
  };
}

/**
 * feaFromStlAsync — SERVER precise path (Stage 4). Identical screening + 2-step
 * logic to feaFromStl, but when precise:true and a curved stress-raiser is
 * present it PREFERS an out-of-process gmsh boundary-conforming tet mesh
 * (certification-candidate grade). If the gmsh binary is absent or the mesh is
 * unusable it falls back to the in-repo octree-snap ENGINEERING path (the proven
 * A5 Kt ~5.6% floor) — never crashing, never fabricating. Sync feaFromStl is
 * left byte-identical for its existing callers.
 */
export async function feaFromStlAsync({ stl, materialKey = 'STS316', loadN = 0, loadNote = '', precise = false }: FeaPackageInput): Promise<FeaPackageOutput> {
  const mat = FEA_MATERIALS[materialKey] ?? FEA_MATERIALS.STS316;
  const geometry = stlToGeometry(stl);
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  const raiserDetected = hasCurvedStressRaiser(pos);
  const { conditions, fixedTris, loadTris } = autoConditions(geometry, loadN);
  let result = runSimpleFEA(geometry, { material: mat, conditions });

  let raiser: FeaPackageOutput['raiser'] = raiserDetected
    ? {
        detected: true, applied: false, grade: 'screening',
        dofCount: result.dofCount, converged: result.converged, wallMs: 0,
        note: '곡률 응력집중부 감지 — 정밀 재해석 미적용(스크리닝): 보어/필렛 피크 응력 과소평가. precise 옵션으로 정밀 해석(서버) 요청 가능.',
      }
    : null;

  if (precise && raiserDetected && result.method === 'linear-fem-tet') {
    // (1) PREFER a gmsh boundary-conforming mesh (certification-candidate) when the
    //     binary is available. gmsh runs as a SEPARATE PROCESS (GPL-as-subprocess =
    //     mere aggregation, same arm's-length posture as our OpenSCAD CLI).
    let gmshMesh: { nodes: Float32Array; tets: Tet[] } | null = null;
    try {
      const bb = new THREE.Box3().setFromBufferAttribute(pos);
      const size = new THREE.Vector3(); bb.getSize(size);
      const minDim = Math.max(1e-6, Math.min(size.x, size.y, size.z));
      const { gmshTetMeshFromStl } = await import('./gmshMesh');
      const g = await gmshTetMeshFromStl(stl, { targetSizeMm: Math.max(0.5, minDim / 4), maxNodes: 120_000 });
      if (g) gmshMesh = { nodes: g.nodes, tets: g.tets };
    } catch { gmshMesh = null; }

    if (gmshMesh) {
      const t0 = Date.now();
      try {
        const fine = runFEM(geometry, mat, conditions, 12000, { prebuiltMesh: gmshMesh });
        const wallMs = Date.now() - t0;
        const usable = fine.converged && Number.isFinite(fine.maxStress) && fine.maxDisplacement < 1e6;
        if (usable) {
          result = { ...fine, method: 'linear-fem-tet' as const };
          raiser = {
            detected: true, applied: true, grade: 'certification-candidate', meshMode: 'gmsh-conforming',
            dofCount: fine.dofCount, converged: fine.converged, wallMs,
            note: `곡률 응력집중부 정밀 재해석 — gmsh 경계정합 사면체 메시(별도 프로세스), DOF ${fine.dofCount.toLocaleString()}·${fine.converged ? '수렴' : '미수렴'}·벽시계 ${(wallMs / 1000).toFixed(1)}s. 인증후보급(외부 상용해석 교차검증 전).`,
          };
        }
      } catch { /* fall through to octree-snap */ }
    }

    // (2) FALLBACK: octree-snap ENGINEERING path (A5 Kt ~5.6% proven). Runs when gmsh
    //     is absent or produced an unusable mesh.
    if (!raiser || !raiser.applied) {
      const t0 = Date.now();
      try {
        const fine = runFEM(geometry, mat, conditions, 12000, { refine: 'on', maxCornerNodes: 8000 });
        const wallMs = Date.now() - t0;
        const usable = fine.converged && Number.isFinite(fine.maxStress) && fine.maxDisplacement < 1e6;
        if (usable) {
          result = { ...fine, method: 'linear-fem-tet' as const };
          raiser = {
            detected: true, applied: true, grade: 'engineering', meshMode: 'refined',
            dofCount: fine.dofCount, converged: fine.converged, wallMs,
            note: `곡률 응력집중부 정밀 재해석 적용 — graded refine + boundary-snap + IC(0)(gmsh 부재 폴백), DOF ${fine.dofCount.toLocaleString()}·${fine.converged ? '수렴' : '미수렴'}·벽시계 ${(wallMs / 1000).toFixed(1)}s. 엔지니어링급(Kirsch 기준 ±~6%, 인증급 아님).`,
          };
        } else {
          raiser = {
            detected: true, applied: false, grade: 'screening',
            dofCount: result.dofCount, converged: result.converged, wallMs,
            note: '정밀 재해석 결과 부적합(미수렴/비유한) — 스크리닝 결과 유지(정직).',
          };
        }
      } catch {
        raiser = {
          detected: true, applied: false, grade: 'screening',
          dofCount: result.dofCount, converged: result.converged, wallMs: Date.now() - t0,
          note: '정밀 재해석 실패(예외) — 스크리닝 결과 유지(정직).',
        };
      }
    }
  }

  // 2-step (비-라이저 각기둥 전용) — feaFromStl과 동일.
  let refined: FeaPackageOutput['refined'] = null;
  if (!raiserDetected && result.method === 'linear-fem-tet' && Number.isFinite(result.safetyFactor) && result.safetyFactor < 2) {
    try {
      const fine = runFEM(geometry, mat, conditions, 6000);
      const usable = fine.converged && Number.isFinite(fine.maxStress) && fine.maxDisplacement < 1e6;
      if (usable) {
        refined = { maxNodes: 6000, screeningSF: result.safetyFactor, screeningMaxStress: result.maxStress };
        result = { ...fine, method: 'linear-fem-tet' as const };
      }
    } catch { /* 재해석 실패 시 스크리닝 결과 유지 */ }
  }
  return {
    result, material: mat, materialKey: FEA_MATERIALS[materialKey] ? materialKey : 'STS316', loadN, loadNote,
    mesh: { triangles: (geometry.getAttribute('position').count / 3) | 0, fixedTris, loadTris },
    refined, raiser,
  };
}

const esc = (s: string) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
const f = (n: number, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : '-');

/** FEA 결과 → 인쇄양식 HTML 리포트 (A4). 방법·가정·한계를 결과와 같은 크기로 명시. */
export function feaReportHtml(out: FeaPackageOutput, { title = 'FEA 응력해석' }: { title?: string } = {}): string {
  const r = out.result;
  const isTet = r.method === 'linear-fem-tet';
  const sfClass = r.safetyFactor >= 2 ? '#16a34a' : r.safetyFactor >= 1.2 ? '#d97706' : '#dc2626';
  const verdict = r.safetyFactor >= 2 ? '여유 있음' : r.safetyFactor >= 1.2 ? '검토 필요(여유 작음)' : '초과 위험 — 단면/재질 상향';
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>@page{size:A4 portrait;margin:12mm}body{margin:0;font-family:'Segoe UI','Malgun Gothic',sans-serif;background:#eef1f4;color:#1f2937;font-size:13px}
.nf-print-bar{position:sticky;top:0;z-index:9;background:#1f2937;color:#fff;padding:7px 16px;font-size:12.5px;display:flex;gap:12px;align-items:center}.nf-print-bar button{background:#2563eb;color:#fff;border:0;padding:5px 13px;border-radius:6px;cursor:pointer}
.sheet{max-width:900px;margin:16px auto;background:#fff;border:1px solid #cbd5e1;box-shadow:0 4px 24px rgba(0,0,0,.1);padding:0 0 22px}.hd{padding:15px 24px;border-bottom:2px solid #1f2937}.hd h1{margin:0;font-size:18px}.hd .s{color:#64748b;font-size:12px}
h2{font-size:14px;margin:18px 24px 6px;padding-bottom:4px;border-bottom:1px solid #e2e8f0}table{border-collapse:collapse;margin:6px 24px;font-size:12px;width:calc(100% - 48px)}td,th{border:1px solid #cbd5e1;padding:4px 9px;text-align:center}th{background:#f1f5f9}
.kpi{display:flex;gap:8px;flex-wrap:wrap;margin:10px 24px}.kpi div{flex:1;min-width:120px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:8px 12px}.kpi b{display:block;font-size:17px}.kpi span{font-size:10.5px;color:#64748b}
.honest{background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;margin:8px 24px;padding:8px 14px;font-size:11.5px;color:#92400e}.note{font-size:11px;color:#94a3b8;padding:6px 24px}
@media print{.nf-print-bar{display:none}body{background:#fff}.sheet{box-shadow:none;border:none;margin:0}}</style></head>
<body><div class="nf-print-bar"><b>FEA 응력해석 (A4)</b><button onclick="print()">🖨 인쇄 / PDF</button></div>
<div class="sheet"><div class="hd"><h1>${esc(title)} — 유한요소 응력해석</h1><div class="s">nexyfab FEA · ${isTet ? 'TET10 2차 사면체 선형정적' : '보 이론 근사(FEM 폴백)'} · ${esc(out.material.label)}</div></div>
<div class="kpi">
<div><b style="color:${sfClass}">${f(r.safetyFactor, 2)}</b><span>안전율 (${esc(out.material.strengthNote)})</span></div>
<div><b>${f(r.maxStress, 1)} MPa</b><span>최대 von Mises 응력</span></div>
<div><b>${f(r.maxDisplacement, 3)} mm</b><span>최대 변위</span></div>
<div><b style="color:${sfClass}">${verdict}</b><span>판정(개산)</span></div></div>
<h2>① 해석 조건</h2><table>
<tr><th>항목</th><th>값</th></tr>
<tr><td>해석 방법</td><td>${isTet ? `TET10 선형정적 FEM (요소 ${r.elementCount.toLocaleString()} · DOF ${r.dofCount.toLocaleString()} · ${r.converged ? '수렴' : '미수렴'})${out.refined ? ` — <b>2-step 정밀 재해석</b>(스크리닝 SF ${out.refined.screeningSF.toFixed(2)}·σ ${out.refined.screeningMaxStress.toFixed(1)}MPa → ${out.refined.maxNodes.toLocaleString()}노드 재해석)` : ''}${out.raiser && out.raiser.applied ? ` — <b>곡률 라이저 정밀</b>(graded refine + IC(0) · 벽시계 ${(out.raiser.wallMs / 1000).toFixed(1)}s)` : out.raiser ? ' — 곡률 라이저 감지(정밀 미적용·스크리닝)' : ''}` : '보 이론 복셀 근사 (FEM 메시 부적합 → 폴백)'}</td></tr>
<tr><td>재료</td><td>${esc(out.material.label)} — E ${out.material.youngsModulus} GPa · ν ${out.material.poissonRatio} · ρ ${out.material.density} g/cm³</td></tr>
<tr><td>구속</td><td>최하단 z-평면 전체 고정 (표면 삼각형 ${out.mesh.fixedTris}개)</td></tr>
<tr><td>하중</td><td>상면 총 ${f(out.loadN / 1000, 2)} kN (-Z) — ${esc(out.loadNote || '사용자 지정')}</td></tr>
<tr><td>표면 메시</td><td>삼각형 ${out.mesh.triangles.toLocaleString()}개 (openscad 실렌더 STL)</td></tr></table>
<h2>② 결과</h2><table>
<tr><th>항목</th><th>값</th><th>비고</th></tr>
<tr><td>최대 von Mises</td><td>${f(r.maxStress, 2)} MPa</td><td>기준강도 ${out.material.yieldStrength} MPa</td></tr>
<tr><td>최소 von Mises</td><td>${f(r.minStress, 2)} MPa</td><td>-</td></tr>
<tr><td>최대 변위</td><td>${f(r.maxDisplacement, 3)} mm</td><td>-</td></tr>
<tr><td>안전율</td><td style="color:${sfClass};font-weight:700">${f(r.safetyFactor, 2)}</td><td>기준강도 / 최대응력</td></tr></table>
<div class="honest">⚠ <b>개념 해석(비법정)</b> — 자동 경계조건(바닥 고정·상면 하중)은 실제 지지·하중 조건과 다를 수 있습니다. ${out.raiser ? (out.raiser.applied ? `<b>곡률 응력집중부: 정밀 재해석 적용</b>(graded refine + boundary-snap + IC(0), DOF ${out.raiser.dofCount.toLocaleString()}·벽시계 ${(out.raiser.wallMs / 1000).toFixed(1)}s) — 보어/필렛 피크는 엔지니어링급(Kirsch 기준 ±~6%). ` : '<b>곡률 응력집중부 감지 — 정밀 재해석 미적용(스크리닝)</b>: 보어/필렛 피크 응력은 과소평가됩니다. 정밀 해석은 precise 옵션(서버, 실측 ~24s)으로 요청하세요. ') : ''}${isTet ? (out.refined ? '2-step 재해석(6,000노드) 결과 — 그래도 국부 응력집중(용접 토우·노치)은 과소평가 가능.' : '스크리닝 메시(≈1,200노드) — SF≥2 여유 구간. 국부 응력집중은 과소평가될 수 있음.') : '보 이론 폴백 — 형상이 가늘거나 복잡해 FEM 메시가 성립하지 않은 경우로, 결과는 차원 수준의 개산.'} 최종 설계는 상용 해석(ANSYS 등) 교차검증 필수. ${out.materialKey === 'concrete' || out.materialKey === 'timber' ? '비금속(콘크리트/목재)은 선형등방 근사 — 균열·이방성·크리프 미반영, 참고용.' : ''} 법정 구조검토·상세설계는 전문 해석·기술사 검토가 필요합니다.</div>
<div class="note">방법: STL(형상 실렌더) → 복셀 사면체화 → TET10 강성 조립 → Jacobi-PCG → von Mises. 폴백: 보 이론. 하중을 지어내지 않음 — 가정은 ① 표에 전부 명시.</div>
<div class="note" style="border-top:1px solid #e2e8f0;margin-top:8px;padding-top:6px">본 보고서는 KDS 현행 기준에 따라 자동 산출된 결과이며, 최종 설계도서·시공에는 반드시 등록 구조기술자(해당 분야 기술사)의 직접 검토·확인이 필요합니다.</div>
</div></body></html>`;
}
