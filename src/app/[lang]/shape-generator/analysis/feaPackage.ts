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
import { runFEM } from './femSolver';

/** 재료 물성 (대표값 — E GPa·ν·기준강도 MPa·밀도 g/cm³). 비금속은 선형등방 근사임을 리포트에 명시. */
export const FEA_MATERIALS: Record<string, FEAMaterial & { label: string; strengthNote: string }> = {
  STS316: { youngsModulus: 193, poissonRatio: 0.3, yieldStrength: 205, density: 7.98, label: 'STS316', strengthNote: '항복강도 205 MPa' },
  STS304: { youngsModulus: 193, poissonRatio: 0.3, yieldStrength: 205, density: 7.93, label: 'STS304', strengthNote: '항복강도 205 MPa' },
  steel: { youngsModulus: 200, poissonRatio: 0.3, yieldStrength: 235, density: 7.85, label: '일반구조강(SS275급)', strengthNote: '항복강도 235 MPa' },
  aluminum: { youngsModulus: 69, poissonRatio: 0.33, yieldStrength: 240, density: 2.7, label: 'AL6061-T6', strengthNote: '항복강도 240 MPa' },
  concrete: { youngsModulus: 30, poissonRatio: 0.2, yieldStrength: 24, density: 2.4, label: '콘크리트(fck24 상당)', strengthNote: '압축강도 24 MPa 기준 개산 — 인장·균열 별도(선형등방 근사)' },
  timber: { youngsModulus: 11, poissonRatio: 0.35, yieldStrength: 8, density: 0.5, label: '구조용 목재(침엽수)', strengthNote: '허용휨응력 ~8 MPa 근사 — 이방성 미반영' },
  PVC: { youngsModulus: 3, poissonRatio: 0.38, yieldStrength: 50, density: 1.4, label: 'PVC', strengthNote: '항복강도 ~50 MPa' },
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
}

/** STL → 자동 경계조건 → runSimpleFEA (스크리닝) → SF<2면 고밀도 재해석(2-step). */
export function feaFromStl({ stl, materialKey = 'STS316', loadN = 0, loadNote = '' }: FeaPackageInput): FeaPackageOutput {
  const mat = FEA_MATERIALS[materialKey] ?? FEA_MATERIALS.STS316;
  const geometry = stlToGeometry(stl);
  const { conditions, fixedTris, loadTris } = autoConditions(geometry, loadN);
  let result = runSimpleFEA(geometry, { material: mat, conditions });
  // 2-step: 스크리닝(≈1,200노드)에서 여유가 작으면(SF<2) 고밀도(6,000노드) 재해석.
  // 성긴 메시는 응력집중을 과소평가할 수 있어, 위험 영역에서만 비용을 지불한다.
  let refined: FeaPackageOutput['refined'] = null;
  if (result.method === 'linear-fem-tet' && Number.isFinite(result.safetyFactor) && result.safetyFactor < 2) {
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
    refined,
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
<tr><td>해석 방법</td><td>${isTet ? `TET10 선형정적 FEM (요소 ${r.elementCount.toLocaleString()} · DOF ${r.dofCount.toLocaleString()} · ${r.converged ? '수렴' : '미수렴'})${out.refined ? ` — <b>2-step 정밀 재해석</b>(스크리닝 SF ${out.refined.screeningSF.toFixed(2)}·σ ${out.refined.screeningMaxStress.toFixed(1)}MPa → ${out.refined.maxNodes.toLocaleString()}노드 재해석)` : ''}` : '보 이론 복셀 근사 (FEM 메시 부적합 → 폴백)'}</td></tr>
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
<div class="honest">⚠ <b>개념 해석(비법정)</b> — 자동 경계조건(바닥 고정·상면 하중)은 실제 지지·하중 조건과 다를 수 있습니다. ${isTet ? (out.refined ? '2-step 재해석(6,000노드) 결과 — 그래도 국부 응력집중(용접 토우·노치)은 과소평가 가능.' : '스크리닝 메시(≈1,200노드) — SF≥2 여유 구간. 국부 응력집중은 과소평가될 수 있음.') : '보 이론 폴백 — 형상이 가늘거나 복잡해 FEM 메시가 성립하지 않은 경우로, 결과는 차원 수준의 개산.'} 최종 설계는 상용 해석(ANSYS 등) 교차검증 필수. ${out.materialKey === 'concrete' || out.materialKey === 'timber' ? '비금속(콘크리트/목재)은 선형등방 근사 — 균열·이방성·크리프 미반영, 참고용.' : ''} 법정 구조검토·상세설계는 전문 해석·기술사 검토가 필요합니다.</div>
<div class="note">방법: STL(형상 실렌더) → 복셀 사면체화 → TET10 강성 조립 → Jacobi-PCG → von Mises. 폴백: 보 이론. 하중을 지어내지 않음 — 가정은 ① 표에 전부 명시.</div>
</div></body></html>`;
}
