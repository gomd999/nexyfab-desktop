/**
 * load-path.mjs — 건축 하중경로 자동 체인 (완벽화 Wave A · B1).
 *
 * role 태깅된 RC 골조 어셈블리(slab/beam/column)에서:
 *   슬래브 자중(형상 결정론) + 활하중(KDS 41 12 00 표 3.2-1, 용도 선택)
 *   → 하중조합 max(1.4D, 1.2D+1.6L) (식 1.7-1/1.7-2, 중력만)
 *   → 45° 2방향 분담으로 보 하중 → rc_beam 검토
 *   → 보 단부반력 집계 → 기둥 축력 → rc_column_pm 검토
 *   → 기둥 반력 → isolated_footing 검토 (기초 치수·지지력은 입력)
 *
 * 원칙: 하중을 지어내지 않는다 — 자중=형상×단위중량(결정론), 활하중=KDS 표(출처 인용),
 * 마감하중=입력(없으면 "미포함" 명시), 철근·기초·지반=입력(INPUT_GATE).
 * 근사는 전부 명시: 등가등분포·단순지지 M=wl²/8(중앙부 보수적)·기둥 Mu=0(φPn,max의
 * 0.80φ가 최소편심 내재 — KDS 14 20 20 식 4.1-17)·연속성/횡하중/장주효과 미고려.
 *
 * v1 적용 범위: 단일 직사각 베이 — 기둥 4 · 외곽 보 4 · 슬래브 1 (rc_frame 템플릿).
 * 범위 밖 구조는 정직하게 거부(scope 오류 반환). 다베이·다층은 B3에서 확장.
 */
import { runCalculator, loadStandards } from '../engineering-core/registry.mjs';
import { partVolume } from './structural.mjs';
import { partAabb } from './reconstruct.mjs';

const standards = loadStandards();
const round = (v, n = 2) => +Number(v).toFixed(n);

/** 배치 후 AABB 중심·치수 (회전 미지원 — v1 골조는 축정렬) */
function box(part) {
  const a = partAabb({ type: part.type, ...part.params });
  const { tx = 0, ty = 0, tz = 0 } = part.at ?? {};
  return {
    cx: (a.min[0] + a.max[0]) / 2 + tx, cy: (a.min[1] + a.max[1]) / 2 + ty,
    x0: a.min[0] + tx, x1: a.max[0] + tx, y0: a.min[1] + ty, y1: a.max[1] + ty,
    dx: a.max[0] - a.min[0], dy: a.max[1] - a.min[1], dz: a.max[2] - a.min[2],
    z0: a.min[2] + tz,
  };
}

/** KDS 활하중 표 (kds.json loads — 원문 대조 데이터). */
export function listUsages() {
  const L = standards?.KDS?.loads?.liveLoad_kNm2 ?? {};
  return Object.entries(L).filter(([k]) => !k.startsWith('_')).map(([key, v]) => ({ key, kNm2: v.v, label: v.label }));
}

/**
 * @param assembly rc_frame형 어셈블리 (role: column×4 / beam×4 / slab×1)
 * @param params {
 *   usage: kds loads 키 (기본 'office'),
 *   finish_kNm2?: 마감 고정하중 (미입력=0, "마감 미포함" 명시),
 *   fck=24, fy=400,
 *   beamAs: 보 인장철근 mm² (필수), beamCover=50, beamAv?: 전단철근 단면적 mm²(간격 s 내), beamS?: 간격 mm,
 *   colAst: 기둥 주철근 총 mm² (필수), colMu?: 기둥 계수모멘트(기본 0),
 *   footing?: { B, L, t, d, qAllow } — 없으면 기초 검토 생략(needInputs)
 * }
 */
export function loadPathCheck(assembly, params = {}) {
  const kds = standards?.KDS;
  if (!kds?.loads) return { ok: false, error: 'KDS loads 데이터 미탑재(kds.json)' };

  const parts = assembly?.parts ?? [];
  const columns = parts.filter((p) => p.role === 'column');
  const beams = parts.filter((p) => p.role === 'beam');
  const slabs = parts.filter((p) => p.role === 'slab');
  if (!columns.length || !beams.length || !slabs.length) {
    return { ok: false, error: `role 태깅 필요 — 기둥${columns.length}·보${beams.length}·슬래브${slabs.length}` };
  }

  // ── 그리드 파생 (형상에서 — 비균등 스팬 허용) ───────────────────────────────
  const uniq = (arr, tol = 50) => {
    const out = [];
    for (const v of arr.slice().sort((a, b) => a - b)) if (!out.length || v - out[out.length - 1] > tol) out.push(v);
    return out;
  };
  const xs = uniq(columns.map((c) => box(c).cx));
  const ys = uniq(columns.map((c) => box(c).cy));
  const zs = uniq(columns.map((c) => (c.at?.tz ?? 0)));
  const nf = zs.length; // 층수
  if (columns.length !== xs.length * ys.length * nf) {
    return { ok: false, scope: 'grid', error: `기둥이 완전 격자가 아님 — ${xs.length}×${ys.length}×${nf}층=${xs.length * ys.length * nf} 기대, 실제 ${columns.length}본. (B3 v2는 직교 격자 라멘만)` };
  }
  if (slabs.length !== nf) return { ok: false, error: `슬래브 수(${slabs.length}) ≠ 층수(${nf}) — 층당 1장 필요` };
  if (xs.length < 2 || ys.length < 2) return { ok: false, error: '기둥 격자 최소 2×2 필요' };

  // ── 하중 산정 (전부 근거 있는 값) ─────────────────────────────────────────
  const usage = params.usage ?? 'office';
  const live = kds.loads.liveLoad_kNm2[usage];
  if (!live) return { ok: false, error: `unknown usage '${usage}' — listUsages() 참조`, usages: listUsages() };
  const gammaRC = kds.loads.rcUnitWeight_kNm3.value; // 24 kN/m³
  const finish = Number(params.finish_kNm2) > 0 ? Number(params.finish_kNm2) : 0;

  const slab0 = slabs[0];
  const sb = box(slab0);
  const slabAreaM2 = (sb.dx * sb.dy) / 1e6;
  const slabD_kN = (partVolume(slab0.type, slab0.params) / 1e9) * gammaRC + finish * slabAreaM2;
  const slabL_kN = live.v * slabAreaM2;
  const wD_m2 = slabD_kN / slabAreaM2; // 슬래브 자중+마감 면하중
  const wL_m2 = live.v;
  const wu_m2 = Math.max(1.4 * wD_m2, 1.2 * wD_m2 + 1.6 * wL_m2);
  const combo = 1.4 * wD_m2 >= 1.2 * wD_m2 + 1.6 * wL_m2 ? '1.4D (식1.7-1)' : '1.2D+1.6L (식1.7-2)';

  // 베이 목록 (비균등 허용)
  const bays = [];
  for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < ys.length - 1; j++) {
    bays.push({ x0: xs[i], x1: xs[i + 1], y0: ys[j], y1: ys[j + 1], dx: xs[i + 1] - xs[i], dy: ys[j + 1] - ys[j] });
  }

  // ── 보 검토 (1개 층 대표 — 층별 동일 하중. 45° 분담을 인접 베이에서 누적) ──
  const floor0Beams = beams.filter((b) => Math.abs((b.at?.tz ?? 0) - Math.min(...beams.map((x) => x.at?.tz ?? 0))) < 1);
  // 같은 z층의 보만 (첫 층). 각 보: 방향·라인·스팬 구간에 인접한 베이의 해당 변 분담 합.
  const beamTrib = (bm) => {
    const bb = box(bm);
    const alongX = bb.dx >= bb.dy;
    const line = alongX ? bb.cy : bb.cx; // 보 중심선(직각 좌표)
    const s0 = alongX ? bb.x0 : bb.y0, s1 = alongX ? bb.x1 : bb.y1;
    let trib = 0;
    for (const bay of bays) {
      // 이 보가 베이의 X변/Y변에 접하는가
      if (alongX) {
        const onEdge = Math.abs(line - bay.y0) < 60 || Math.abs(line - bay.y1) < 60;
        const overlap = Math.min(s1, bay.x1) - Math.max(s0, bay.x0);
        if (!onEdge || overlap < bay.dx * 0.5) continue;
        const tri = (Math.min(bay.dx, bay.dy) ** 2) / 4 / 1e6;
        const trap = (bay.dx * bay.dy / 1e6 - 2 * tri) / 2;
        trib += bay.dx <= bay.dy ? tri : trap; // X변이 단변이면 삼각형
      } else {
        const onEdge = Math.abs(line - bay.x0) < 60 || Math.abs(line - bay.x1) < 60;
        const overlap = Math.min(s1, bay.y1) - Math.max(s0, bay.y0);
        if (!onEdge || overlap < bay.dy * 0.5) continue;
        const tri = (Math.min(bay.dx, bay.dy) ** 2) / 4 / 1e6;
        const trap = (bay.dx * bay.dy / 1e6 - 2 * tri) / 2;
        trib += bay.dy <= bay.dx ? tri : trap;
      }
    }
    return trib;
  };
  // 최악 보(최대 분담) + 클래스 요약
  let worstBeam = null, worstTrib = -1;
  for (const bm of floor0Beams) {
    const t = beamTrib(bm);
    if (t > worstTrib) { worstTrib = t; worstBeam = bm; }
  }
  const beamResults = [];
  if (worstBeam) {
    const bb = box(worstBeam);
    const alongX = bb.dx >= bb.dy;
    const span = alongX ? bb.dx : bb.dy;
    const bwv = alongX ? bb.dy : bb.dx;
    const bh = bb.dz;
    const selfD = (partVolume(worstBeam.type, worstBeam.params) / 1e9) * gammaRC;
    const D = wD_m2 * worstTrib + selfD;
    const L = wL_m2 * worstTrib;
    const spanM = span / 1000;
    const Wu = Math.max(1.4 * D, 1.2 * D + 1.6 * L);
    const wu = Wu / spanM;
    const Mu = (wu * spanM * spanM) / 8;
    const Vu = Wu / 2;
    const cover = params.beamCover ?? 50;
    let check = null;
    if (Number(params.beamAs) > 0) {
      try {
        const beamInput = {
          b: bwv, d: bh - cover, fck: params.fck ?? 24, fy: params.fy ?? 400,
          As: Number(params.beamAs), Mu: round(Mu), Vu: round(Vu),
        };
        if (Number(params.beamAv) > 0 && Number(params.beamS) > 0) { beamInput.Av = Number(params.beamAv); beamInput.s = Number(params.beamS); }
        check = runCalculator('rc_beam', beamInput, 'KDS');
      } catch (e) { check = { error: e.message }; }
    }
    beamResults.push({
      id: `${worstBeam.id ?? 'beam'} (최악 — 층당 보 ${floor0Beams.length}본 중 최대분담)`,
      spanMm: round(span, 0), section: `${round(bwv, 0)}×${round(bh, 0)}`,
      tribM2: round(worstTrib), D_kN: round(D), L_kN: round(L), combo,
      wu_kNm: round(wu), Mu_kNm: round(Mu), Vu_kN: round(Vu),
      verdict: check?.verdict ?? (check?.error ? 'ERROR' : 'INPUT(beamAs)'),
      checks: check?.checks ?? null, error: check?.error ?? null,
    });
  }

  // ── 기둥 검토 (지배 기둥 = 최대 분담면적 × 최하층 누적) ─────────────────────
  // 분담면적법(관례): 기둥 (i,j) = (좌우 반스팬 합)×(상하 반스팬 합). 층 누적 = 상부 전층 합.
  const halfSum = (arr, k) => ((k > 0 ? arr[k] - arr[k - 1] : 0) / 2 + (k < arr.length - 1 ? arr[k + 1] - arr[k] : 0) / 2) / 1000;
  let worstColTrib = 0, worstIdx = [0, 0];
  for (let i = 0; i < xs.length; i++) for (let j = 0; j < ys.length; j++) {
    const t = halfSum(xs, i) * halfSum(ys, j);
    if (t > worstColTrib) { worstColTrib = t; worstIdx = [i, j]; }
  }
  const col0 = columns[0];
  const cb0 = box(col0);
  const colSelfD = (partVolume(col0.type, col0.params) / 1e9) * gammaRC; // kN/층
  // 층당 보 자중을 면적당으로 환산해 분담(개산 명시)
  const beamSelfPerM2 = floor0Beams.reduce((s, b) => s + (partVolume(b.type, b.params) / 1e9) * gammaRC, 0) / slabAreaM2;
  const perFloorPu = wu_m2 * worstColTrib + 1.2 * beamSelfPerM2 * worstColTrib + 1.2 * colSelfD;
  const perFloorPs = (wD_m2 + wL_m2 + beamSelfPerM2) * worstColTrib + colSelfD;
  const Pu_col = perFloorPu * nf;       // 최하층 기둥 = 전층 누적
  const Pservice_col = perFloorPs * nf;
  let colCheck = null;
  if (Number(params.colAst) > 0) {
    try {
      colCheck = runCalculator('rc_column_pm', {
        b: round(cb0.dx, 0), h: round(cb0.dy, 0), fck: params.fck ?? 24, fy: params.fy ?? 400,
        Ast: Number(params.colAst), Pu: round(Pu_col), Mu: round(Number(params.colMu) || 0),
      }, 'KDS');
    } catch (e) { colCheck = { error: e.message }; }
  }
  const colResults = [{
    id: `지배 기둥 (격자 ${worstIdx[0] + 1},${worstIdx[1] + 1} — 분담 ${round(worstColTrib)}m² × ${nf}층 누적)`,
    section: `${round(cb0.dx, 0)}×${round(cb0.dy, 0)}`,
    Pu_kN: round(Pu_col), Pservice_kN: round(Pservice_col), perFloorPu_kN: round(perFloorPu),
    Mu_kNm: round(Number(params.colMu) || 0),
    note: '분담면적법(관례) — Mu=0 시 φPn(max) 대조(최소편심 0.80φ 내재). 횡하중·장주효과·모멘트골조 불균형모멘트 미고려.',
    verdict: colCheck?.verdict ?? (colCheck?.error ? 'ERROR' : 'INPUT(colAst)'),
    checks: colCheck?.checks ?? null, error: colCheck?.error ?? null,
  }];

  // ── 기초 검토 (치수·지지력 = 입력) ─────────────────────────────────────────
  let footing = null;
  const f = params.footing;
  if (f && Number(f.B) > 0 && Number(f.L) > 0) {
    try {
      const r = runCalculator('isolated_footing', {
        B: Number(f.B), L: Number(f.L), t: Number(f.t) || 500, d: Number(f.d) || (Number(f.t) || 500) - 80,
        cb: round(cb0.dx, 0), cl: round(cb0.dy, 0),
        Pu: round(Pu_col), Pservice: round(Pservice_col),
        qAllow: Number(f.qAllow) || 200, fck: params.fck ?? 24,
      }, 'KDS');
      footing = { verdict: r.verdict, checks: r.checks, refs: r.refs, input: { B: f.B, L: f.L, t: f.t, qAllow: f.qAllow } };
    } catch (e) { footing = { verdict: 'ERROR', error: e.message }; }
  } else {
    footing = { verdict: 'INPUT(footing)', needInputs: ['footing.B', 'footing.L', 'footing.t', 'footing.d', 'footing.qAllow'], note: '기초 치수·허용지지력은 설계/지반 조건 — 입력 필요(체인이 Pu·Pservice는 자동 전달)' };
  }

  return {
    ok: true,
    scope: `직교 격자 라멘 ${xs.length - 1}×${ys.length - 1}베이 ${nf}층 · 중력하중만 (B3)`,
    loads: {
      usage: { key: usage, label: live.label, live_kNm2: live.v, ref: kds.loads.liveLoad_kNm2._ref },
      slab: { areaM2: round(slabAreaM2), D_kN: round(slabD_kN), L_kN: round(slabL_kN), finish_kNm2: finish, finishNote: finish > 0 ? '입력값' : '마감하중 미포함(미입력)', perFloor: true, floors: nf },
      combo: kds.loads.comboGravity,
      unitWeight: kds.loads.rcUnitWeight_kNm3,
      spans: { xs_mm: xs.map((v) => round(v, 0)), ys_mm: ys.map((v) => round(v, 0)), tributary: '보=45° 2방향(삼각/사다리꼴) · 기둥=분담면적법 · 층 누적' },
    },
    beams: beamResults,
    columns: colResults,
    footing,
    provenance: {
      geometry: ['슬래브 자중(체적×24kN/m³)', '스팬(기둥 중심간격)', '보·기둥 단면', '분담면적(45°)'],
      kds: ['활하중(표 3.2-1)', '하중조합(식 1.7-1/1.7-2)', 'rc_beam·rc_column_pm·isolated_footing 전 계수'],
      user: ['용도', '마감하중(선택)', 'fck·fy', '철근량', '기초 치수·지지력'],
    },
    disclaimer: '개념 검토(비법정) — 등가등분포·단순지지 근사, 연속성·횡하중·장주효과·2방향슬래브 자체 검토 미포함. 실시설계는 구조기술사 검토 필요.',
  };
}

// --- self-test: rc_frame 기본값 + 사무실 + 가정 철근 → 체인 완주·손검증 대조 ---
const isMain = process.argv[1] && process.argv[1].replaceAll('\\', '/').endsWith('load-path.mjs');
if (isMain) {
  const { buildAssemblyTemplate } = await import('./domain-assemblies.mjs');
  const rebar = { usage: 'office', fck: 24, fy: 400, beamAs: 1548, beamAv: 142.7, beamS: 250, colAst: 3097, footing: { B: 2200, L: 2200, t: 500, d: 420, qAllow: 200 } };
  // ① 1베이 1층 (v1 회귀)
  const asm1 = buildAssemblyTemplate('building', 'rc_frame', {});
  const r1 = loadPathCheck(asm1, rebar);
  if (!r1.ok) { console.log('FAIL(1bay)', r1.error); process.exit(1); }
  console.log('[1×1×1] slab D:', r1.loads.slab.D_kN, 'kN (손검증 152.1) | 보:', r1.beams[0].verdict, 'Mu=' + r1.beams[0].Mu_kNm, '| 기둥 Pu:', r1.columns[0].Pu_kN, '→', r1.columns[0].verdict, '| 기초:', r1.footing.verdict);
  // ② 2×2베이 3층 — 지배 기둥 = 내부기둥 분담 36m²×3층
  const asm2 = buildAssemblyTemplate('building', 'rc_frame', { baysX: 2, baysY: 2, floors: 3, colSize: 600 });
  const r2 = loadPathCheck(asm2, { ...rebar, colAst: 6194, footing: { B: 3000, L: 3000, t: 700, d: 600, qAllow: 300 } });
  if (!r2.ok) { console.log('FAIL(2x2x3)', r2.error); process.exit(1); }
  console.log('[2×2×3]', r2.scope, '| 보(최악):', r2.beams[0].tribM2 + 'm²', 'Mu=' + r2.beams[0].Mu_kNm, '→', r2.beams[0].verdict);
  console.log('  기둥:', r2.columns[0].id, '| 층당', r2.columns[0].perFloorPu_kN, 'kN × 3 =', r2.columns[0].Pu_kN, 'kN →', r2.columns[0].verdict, '| 기초:', r2.footing.verdict);
  // 손검증: 내부기둥 분담 6×6=36m² ✓ · 층누적 = 층당×3 ✓
  const dOk = Math.abs(r1.loads.slab.D_kN - 152.1) < 2;
  const tribOk = r2.columns[0].id.includes('36');
  const stackOk = Math.abs(r2.columns[0].Pu_kN - r2.columns[0].perFloorPu_kN * 3) < 1;
  const allRun = [r1, r2].every((r) => r.beams[0].verdict !== 'ERROR' && r.columns[0].verdict !== 'ERROR' && r.footing.verdict !== 'ERROR');
  console.log(allRun && dOk && tribOk && stackOk ? 'load-path self-test: PASS' : `load-path self-test: FAIL (d:${dOk} trib:${tribOk} stack:${stackOk})`);
  if (!(allRun && dOk && tribOk && stackOk)) process.exit(1);
}
