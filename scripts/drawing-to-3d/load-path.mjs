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
  if (columns.length !== 4 || beams.length !== 4 || slabs.length !== 1) {
    return {
      ok: false, scope: 'v1',
      error: `v1 범위 밖 — 단일 베이(기둥4·보4·슬래브1)만 지원. 현재: 기둥${columns.length}·보${beams.length}·슬래브${slabs.length}`,
    };
  }

  // ── 하중 산정 (전부 근거 있는 값) ─────────────────────────────────────────
  const usage = params.usage ?? 'office';
  const live = kds.loads.liveLoad_kNm2[usage];
  if (!live) return { ok: false, error: `unknown usage '${usage}' — listUsages() 참조`, usages: listUsages() };
  const gammaRC = kds.loads.rcUnitWeight_kNm3.value; // 24 kN/m³
  const finish = Number(params.finish_kNm2) > 0 ? Number(params.finish_kNm2) : 0;

  const slab = slabs[0];
  const sb = box(slab);
  const slabAreaM2 = (sb.dx * sb.dy) / 1e6;
  const slabD_kN = (partVolume(slab.type, slab.params) / 1e9) * gammaRC + finish * slabAreaM2;
  const slabL_kN = live.v * slabAreaM2;

  // 스팬 = 기둥 중심 간격 (형상에서 파생)
  const cxs = [...new Set(columns.map((c) => round(box(c).cx, 0)))].sort((a, b) => a - b);
  const cys = [...new Set(columns.map((c) => round(box(c).cy, 0)))].sort((a, b) => a - b);
  if (cxs.length !== 2 || cys.length !== 2) return { ok: false, error: 'v1: 기둥 4개가 직사각 격자를 이뤄야 함' };
  const bayX = cxs[1] - cxs[0], bayY = cys[1] - cys[0];
  const lx = Math.min(bayX, bayY), ly = Math.max(bayX, bayY); // 단·장스팬 mm

  // 45° 2방향 분담: 단변 보(스팬 lx) = 삼각형 lx²/4 ×2개, 장변 보(스팬 ly) = 사다리꼴
  const areaTot = (bayX * bayY) / 1e6; // 분담 기준 면적(베이) m²
  const triM2 = (lx * lx) / 4 / 1e6;
  const trapM2 = (areaTot - 2 * triM2) / 2;
  // 슬래브 면하중 (kN/m²) — 슬래브 전체 하중을 슬래브 면적으로 (오버행 포함 하중도 베이 면적비로 분담)
  const wD_m2 = slabD_kN / slabAreaM2;
  const wL_m2 = live.v;

  // ── 보 검토 ────────────────────────────────────────────────────────────────
  const beamResults = [];
  const reactions = []; // 각 보의 계수 단부반력 kN (기둥 집계용)
  const serviceReactions = [];
  for (const bm of beams) {
    const bb = box(bm);
    // 스팬 방향 = 보 장축. 단면 = 나머지 두 치수 (b=수평, h=수직)
    const spanIsX = bb.dx >= bb.dy;
    const span = spanIsX ? bb.dx : bb.dy;
    const bw = spanIsX ? bb.dy : bb.dx;
    const bh = bb.dz;
    const isShort = Math.abs(span - (lx - 0)) <= Math.abs(span - ly) ? span <= lx + 1 : false;
    const tribM2 = (isShort ? triM2 : trapM2);
    const selfD = (partVolume(bm.type, bm.params) / 1e9) * gammaRC; // kN
    const D = wD_m2 * tribM2 + selfD;
    const L = wL_m2 * tribM2;
    const spanM = span / 1000;
    // 하중조합 (KDS 41 12 00 식 1.7-1 / 1.7-2, 중력만)
    const Wu = Math.max(1.4 * D, 1.2 * D + 1.6 * L);
    const combo = 1.4 * D >= 1.2 * D + 1.6 * L ? '1.4D (식1.7-1)' : '1.2D+1.6L (식1.7-2)';
    const wu = Wu / spanM;                      // 등가등분포 kN/m (근사 명시)
    const Mu = (wu * spanM * spanM) / 8;        // 단순지지 근사(중앙부 보수적)
    const Vu = Wu / 2;
    reactions.push(Wu / 2);
    serviceReactions.push((D + L) / 2);
    const cover = params.beamCover ?? 50;
    let check = null;
    if (Number(params.beamAs) > 0) {
      try {
        const beamInput = {
          b: bw, d: bh - cover, fck: params.fck ?? 24, fy: params.fy ?? 400,
          As: Number(params.beamAs), Mu: round(Mu), Vu: round(Vu),
        };
        if (Number(params.beamAv) > 0 && Number(params.beamS) > 0) { beamInput.Av = Number(params.beamAv); beamInput.s = Number(params.beamS); }
        check = runCalculator('rc_beam', beamInput, 'KDS');
      } catch (e) { check = { error: e.message }; }
    }
    beamResults.push({
      id: bm.id ?? 'beam', spanMm: round(span, 0), section: `${round(bw, 0)}×${round(bh, 0)}`,
      tribM2: round(tribM2), D_kN: round(D), L_kN: round(L), combo,
      wu_kNm: round(wu), Mu_kNm: round(Mu), Vu_kN: round(Vu),
      verdict: check?.verdict ?? (check?.error ? 'ERROR' : 'INPUT(beamAs)'),
      checks: check?.checks ?? null, error: check?.error ?? null,
    });
  }

  // ── 기둥 검토 (대칭 — 각 기둥 = 인접 보 2개 반력 합 + 자중) ─────────────────
  // 단변보 1 + 장변보 1 이 각 기둥에 접속(직사각 1베이 대칭)
  const shortR = reactions[beamResults.findIndex((b) => b.tribM2 === round(triM2))] ?? reactions[0];
  const longR = reactions[beamResults.findIndex((b) => b.tribM2 === round(trapM2))] ?? reactions[1];
  const shortRs = serviceReactions[0], longRs = serviceReactions[1];
  const colResults = [];
  const col = columns[0]; // 대칭 — 대표 1본 (전부 동일 단면·하중)
  const cb0 = box(col);
  const colSelfD = (partVolume(col.type, col.params) / 1e9) * gammaRC;
  const Pu_col = shortR + longR + 1.2 * colSelfD;
  const Pservice_col = (shortRs + longRs) + colSelfD;
  let colCheck = null;
  if (Number(params.colAst) > 0) {
    try {
      colCheck = runCalculator('rc_column_pm', {
        b: round(cb0.dx, 0), h: round(cb0.dy, 0), fck: params.fck ?? 24, fy: params.fy ?? 400,
        Ast: Number(params.colAst), Pu: round(Pu_col), Mu: round(Number(params.colMu) || 0),
      }, 'KDS');
    } catch (e) { colCheck = { error: e.message }; }
  }
  colResults.push({
    id: '기둥(대표 — 4본 대칭)', section: `${round(cb0.dx, 0)}×${round(cb0.dy, 0)}`,
    Pu_kN: round(Pu_col), Pservice_kN: round(Pservice_col),
    Mu_kNm: round(Number(params.colMu) || 0),
    note: 'Mu=0 시 φPn(max) 대조 — 최소편심은 0.80φ 계수에 내재(KDS 14 20 20 식 4.1-17). 횡하중·장주효과 미고려.',
    verdict: colCheck?.verdict ?? (colCheck?.error ? 'ERROR' : 'INPUT(colAst)'),
    checks: colCheck?.checks ?? null, error: colCheck?.error ?? null,
  });

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
    scope: '단일 직사각 베이 (기둥4·보4·슬래브1) · 중력하중만',
    loads: {
      usage: { key: usage, label: live.label, live_kNm2: live.v, ref: kds.loads.liveLoad_kNm2._ref },
      slab: { areaM2: round(slabAreaM2), D_kN: round(slabD_kN), L_kN: round(slabL_kN), finish_kNm2: finish, finishNote: finish > 0 ? '입력값' : '마감하중 미포함(미입력)' },
      combo: kds.loads.comboGravity,
      unitWeight: kds.loads.rcUnitWeight_kNm3,
      spans: { bayX_mm: round(bayX, 0), bayY_mm: round(bayY, 0), tributary: '45° 2방향(삼각/사다리꼴)' },
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
  const asm = buildAssemblyTemplate('building', 'rc_frame', {});
  const r = loadPathCheck(asm, {
    usage: 'office', fck: 24, fy: 400,
    beamAs: 1548, // 4-D22 가정
    beamAv: 142.7, beamS: 250, // D10@250 2가닥 가정
    colAst: 3097, // 8-D22 가정
    footing: { B: 2200, L: 2200, t: 500, d: 420, qAllow: 200 },
  });
  if (!r.ok) { console.log('FAIL', r.error); process.exit(1); }
  console.log('slab D:', r.loads.slab.D_kN, 'kN (손검증: 6.5×6.5×0.15×24=152.1)');
  console.log('slab L:', r.loads.slab.L_kN, 'kN (42.25m²×2.5)');
  console.log('스팬:', r.loads.spans.bayX_mm, '×', r.loads.spans.bayY_mm);
  for (const b of r.beams) console.log(`보 ${b.id}: 분담 ${b.tribM2}m² Mu=${b.Mu_kNm}kN·m → ${b.verdict}`);
  for (const c of r.columns) console.log(`${c.id}: Pu=${c.Pu_kN}kN → ${c.verdict}`);
  console.log('기초:', r.footing.verdict);
  const allRun = r.beams.every((b) => b.verdict && b.verdict !== 'ERROR') && r.columns.every((c) => c.verdict !== 'ERROR') && r.footing.verdict !== 'ERROR';
  // 손검증: 슬래브 D ≈ 152.1 (±1), L ≈ 105.6 (±1)
  const dOk = Math.abs(r.loads.slab.D_kN - 152.1) < 2 && Math.abs(r.loads.slab.L_kN - 105.63) < 2;
  console.log(allRun && dOk ? 'load-path self-test: PASS' : 'load-path self-test: FAIL');
  if (!(allRun && dOk)) process.exit(1);
}
