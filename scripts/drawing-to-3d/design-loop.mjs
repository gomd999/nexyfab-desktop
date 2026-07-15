/**
 * design-loop.mjs — 전수 설계 루프: 어셈블리 전 부재 자동 순회 → 부재별 판정표.
 *
 * load-path(대표부재 체인)와 동일한 하중 산정(자중 결정론·활하중 KDS 표·45° 분담·
 * 연속보 계수법 조건)을 **전 보·전 기둥**에 적용해 부재별 rc_beam/rc_column_pm 실행.
 * 교차검증 게이트: 이 루프의 최악 보 Mu는 loadPathCheck의 대표 보 Mu와 일치해야 함
 * (불일치 시 결과에 crossCheck FAIL 명시 — 하중 로직 이탈 감지).
 *
 * 정직성: 배근(As·Ast)은 공통 입력 + 부재별 override(rebarById) — 지어내지 않음.
 * 미입력 부재는 INPUT 표기. unverified 파츠는 제외 목록으로 보고.
 * v1 범위: 직교 격자 RC 라멘(rc_frame형). 다른 도메인 전수 루프는 후속.
 */
import { runCalculator, loadStandards } from '../engineering-core/registry.mjs';
import { partVolume } from './structural.mjs';
import { partAabb } from './reconstruct.mjs';
import { loadPathCheck } from './load-path.mjs';

const standards = loadStandards();
const round = (v, n = 2) => +Number(v).toFixed(n);

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

export function designLoop(assembly, params = {}) {
  const kds = standards?.KDS;
  if (!kds?.loads) return { ok: false, error: 'KDS loads 미탑재' };
  const allParts = assembly?.parts ?? [];
  const excluded = allParts.filter((p) => p.unverified === true).map((p) => p.id ?? p.type);
  const parts = allParts.filter((p) => p.unverified !== true);
  const columns = parts.filter((p) => p.role === 'column');
  const beams = parts.filter((p) => p.role === 'beam');
  const slabs = parts.filter((p) => p.role === 'slab');
  if (!columns.length || !beams.length || !slabs.length) return { ok: false, error: `role 태깅 필요 — 기둥${columns.length}·보${beams.length}·슬래브${slabs.length}` };

  const uniq = (arr, tol = 50) => { const out = []; for (const v of arr.slice().sort((a, b) => a - b)) if (!out.length || v - out[out.length - 1] > tol) out.push(v); return out; };
  const xs = uniq(columns.map((c) => box(c).cx));
  const ys = uniq(columns.map((c) => box(c).cy));
  const zs = uniq(columns.map((c) => (c.at?.tz ?? 0)));
  const nf = zs.length;
  if (columns.length !== xs.length * ys.length * nf) return { ok: false, error: '직교 완전 격자 라멘만 지원(v1)' };

  const usage = params.usage ?? 'office';
  const live = kds.loads.liveLoad_kNm2[usage];
  if (!live) return { ok: false, error: `unknown usage '${usage}'` };
  const gammaRC = kds.loads.rcUnitWeight_kNm3.value;
  const finish = Number(params.finish_kNm2) > 0 ? Number(params.finish_kNm2) : 0;
  const slab0 = slabs[0];
  const sb = box(slab0);
  const slabAreaM2 = (sb.dx * sb.dy) / 1e6;
  const wD_m2 = (partVolume(slab0.type, slab0.params) / 1e9) * gammaRC / slabAreaM2 + finish;
  const wL_m2 = live.v;
  const wu_m2 = Math.max(1.4 * wD_m2, 1.2 * wD_m2 + 1.6 * wL_m2);

  const bays = [];
  for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < ys.length - 1; j++) {
    bays.push({ x0: xs[i], x1: xs[i + 1], y0: ys[j], y1: ys[j + 1], dx: xs[i + 1] - xs[i], dy: ys[j + 1] - ys[j] });
  }
  const zMin = Math.min(...beams.map((x) => x.at?.tz ?? 0));
  const floor0Beams = beams.filter((b) => Math.abs((b.at?.tz ?? 0) - zMin) < 1);
  const beamTrib = (bm) => {
    const bb = box(bm);
    const alongX = bb.dx >= bb.dy;
    const line = alongX ? bb.cy : bb.cx;
    const s0 = alongX ? bb.x0 : bb.y0, s1 = alongX ? bb.x1 : bb.y1;
    let trib = 0;
    for (const bay of bays) {
      const onEdge = alongX
        ? (Math.abs(line - bay.y0) < 60 || Math.abs(line - bay.y1) < 60) && Math.min(s1, bay.x1) - Math.max(s0, bay.x0) >= bay.dx * 0.5
        : (Math.abs(line - bay.x0) < 60 || Math.abs(line - bay.x1) < 60) && Math.min(s1, bay.y1) - Math.max(s0, bay.y0) >= bay.dy * 0.5;
      if (!onEdge) continue;
      // 45° 2방향: 짧은변 삼각/긴변 사다리꼴 — 그 변이 부담하는 면적
      const Lx = bay.dx / 1000, Ly = bay.dy / 1000;
      const short = Math.min(Lx, Ly), long = Math.max(Lx, Ly);
      const isLongEdge = alongX ? Lx >= Ly : Ly >= Lx;
      trib += isLongEdge ? (short / 4) * (2 * long - short) : (short * short) / 4;
    }
    return trib;
  };

  const rebarById = params.rebarById ?? {};
  const ac = kds.rc?.approxContinuous;
  const members = [];
  // ── 전 보 순회 (1층 대표 — 층별 동일하중 명시. 다층 개별하중은 후속) ──────────
  for (const bm of floor0Beams) {
    const bb = box(bm);
    const alongX = bb.dx >= bb.dy;
    const span = alongX ? bb.dx : bb.dy;
    const bwv = alongX ? bb.dy : bb.dx;
    const bh = bb.dz;
    const trib = beamTrib(bm);
    const selfD = (partVolume(bm.type, bm.params) / 1e9) * gammaRC;
    const D = wD_m2 * trib + selfD, L = wL_m2 * trib;
    const spanM = span / 1000;
    const Wu = Math.max(1.4 * D, 1.2 * D + 1.6 * L);
    const wu = Wu / spanM;
    const lineSpans = alongX ? xs : ys;
    const spanCount = lineSpans.length - 1;
    const spanLens = lineSpans.slice(1).map((v, i) => v - lineSpans[i]);
    const adjOk = spanLens.every((s, i) => i === 0 || Math.abs(s - spanLens[i - 1]) <= Math.min(s, spanLens[i - 1]) * 0.2);
    const useCoef = ac && params.continuity !== 'simple' && spanCount >= 2 && adjOk && L <= 3 * D;
    let Mu, Vu, method;
    if (useCoef) {
      Mu = (wu * spanM * spanM) / ac.posExteriorIntegral;
      Vu = (ac.shearFirstInteriorFactor * wu * spanM) / 2;
      method = '계수법';
    } else { Mu = (wu * spanM * spanM) / 8; Vu = Wu / 2; method = '단순 wl²/8'; }
    const ov = rebarById[bm.id] ?? {};
    const As = Number(ov.As ?? params.beamAs) || 0;
    let check = null;
    if (As > 0) {
      try {
        const inp = { b: round(bwv, 0), d: round(bh - (params.beamCover ?? 50), 0), fck: params.fck ?? 24, fy: params.fy ?? 400, As, Mu: round(Mu), Vu: round(Vu) };
        const Av = Number(ov.Av ?? params.beamAv), sS = Number(ov.s ?? params.beamS);
        if (Av > 0 && sS > 0) { inp.Av = Av; inp.s = sS; }
        check = runCalculator('rc_beam', inp, 'KDS');
      } catch (e) { check = { error: e.message }; }
    }
    const util = check?.checks?.flexure?.ratio ?? check?.checks?.moment?.ratio ?? null;
    members.push({
      id: bm.id ?? 'beam', kind: 'beam', section: `${round(bwv, 0)}×${round(bh, 0)}`, span_mm: round(span, 0),
      trib_m2: round(trib), Mu_kNm: round(Mu), Vu_kN: round(Vu), method, As_used: As || null,
      verdict: check?.verdict ?? (check?.error ? 'ERROR' : 'INPUT(beamAs)'), util, checks: check?.checks ?? null, error: check?.error ?? null,
    });
  }
  // ── 전 기둥 순회 (격자 위치별 분담 × 층누적 — 각 층 기둥 개별 Pu) ─────────────
  const halfSum = (arr, k) => ((k > 0 ? arr[k] - arr[k - 1] : 0) / 2 + (k < arr.length - 1 ? arr[k + 1] - arr[k] : 0) / 2) / 1000;
  const beamSelfPerM2 = floor0Beams.reduce((s, b) => s + (partVolume(b.type, b.params) / 1e9) * gammaRC, 0) / slabAreaM2;
  for (const col of columns) {
    const cb = box(col);
    const i = xs.findIndex((v) => Math.abs(v - cb.cx) < 60);
    const j = ys.findIndex((v) => Math.abs(v - cb.cy) < 60);
    const zi = zs.findIndex((v) => Math.abs(v - (col.at?.tz ?? 0)) < 60);
    if (i < 0 || j < 0 || zi < 0) continue;
    const trib = halfSum(xs, i) * halfSum(ys, j);
    const colSelfD = (partVolume(col.type, col.params) / 1e9) * gammaRC;
    const floorsAbove = nf - zi; // 이 기둥이 받는 층수(자기 층 슬래브 포함)
    const perFloorPu = wu_m2 * trib + 1.2 * beamSelfPerM2 * trib + 1.2 * colSelfD;
    const Pu = perFloorPu * floorsAbove;
    const ov = rebarById[col.id] ?? {};
    const Ast = Number(ov.Ast ?? params.colAst) || 0;
    let check = null;
    if (Ast > 0) {
      try {
        check = runCalculator('rc_column_pm', { b: round(cb.dx, 0), h: round(cb.dy, 0), fck: params.fck ?? 24, fy: params.fy ?? 400, Ast, Pu: round(Pu), Mu: round(Number(params.colMu) || 0) }, 'KDS');
      } catch (e) { check = { error: e.message }; }
    }
    members.push({
      id: col.id ?? 'column', kind: 'column', section: `${round(cb.dx, 0)}×${round(cb.dy, 0)}`, grid: `${i + 1},${j + 1}·${zi + 1}층`,
      trib_m2: round(trib), Pu_kN: round(Pu), floorsAbove, Ast_used: Ast || null,
      verdict: check?.verdict ?? (check?.error ? 'ERROR' : 'INPUT(colAst)'), util: check?.checks?.axial?.ratio ?? null, checks: check?.checks ?? null, error: check?.error ?? null,
    });
  }
  // ── 교차검증: 최악 보 Mu vs load-path 대표 보 Mu ──────────────────────────────
  let crossCheck = null;
  try {
    const lp = loadPathCheck(assembly, params);
    const lpMu = lp?.beams?.[0]?.Mu_kNm ?? null;
    const myWorst = Math.max(...members.filter((m) => m.kind === 'beam').map((m) => m.Mu_kNm));
    crossCheck = lpMu !== null
      ? { loadPathMu: lpMu, loopWorstMu: round(myWorst), pass: Math.abs(lpMu - myWorst) <= Math.max(0.5, lpMu * 0.01) }
      : { note: 'load-path 대표 보 없음' };
  } catch (e) { crossCheck = { error: e instanceof Error ? e.message : String(e) }; }
  const counts = { PASS: 0, FAIL: 0, INPUT: 0, ERROR: 0 };
  for (const m of members) {
    if (m.verdict === 'PASS') counts.PASS++;
    else if (m.verdict === 'FAIL') counts.FAIL++;
    else if (String(m.verdict).startsWith('INPUT')) counts.INPUT++;
    else counts.ERROR++;
  }
  return {
    ok: true, members, summary: { total: members.length, ...counts, floors: nf, grid: `${xs.length}×${ys.length}` },
    crossCheck, excludedUnverified: excluded,
    loads: { usage: live.label, live_kNm2: live.v, wD_m2: round(wD_m2), wu_m2: round(wu_m2), finish_kNm2: finish },
    notes: [
      '전수 루프: 1층 보 전수(층별 동일하중 명시 — 층별 개별하중은 후속) + 전층 기둥 개별 Pu(층누적).',
      '교차검증: 최악 보 Mu = load-path 대표 보 Mu 일치 게이트' + (crossCheck?.pass === false ? ' — ⚠ 불일치(하중 로직 확인 필요)' : '.'),
      '배근=공통 입력+부재별 override(rebarById). 미입력=INPUT. 근사(등가등분포·기둥 Mu 입력)는 load-path와 동일 명시.',
    ],
    disclaimer: '개념 검토(비법정) — 부재별 판정표는 실시설계 배근 결정의 출발점이며 구조기술사 검토 필요.',
  };
}

// --- self-test ---
const isMain = typeof process !== 'undefined' && process.argv?.[1] && process.argv[1].replaceAll('\\', '/').endsWith('design-loop.mjs');
if (isMain) {
  const { buildAssemblyTemplate } = await import('./domain-assemblies.mjs');
  const asm = buildAssemblyTemplate('building', 'rc_frame', {});
  const r = designLoop(asm.assembly ?? asm, { usage: 'office', fck: 24, fy: 400, beamAs: 1548, beamAv: 142.7, beamS: 250, colAst: 3097 });
  if (!r.ok) { console.error('FAIL', r.error); process.exit(1); }
  const beams = r.members.filter((m) => m.kind === 'beam').length;
  const cols = r.members.filter((m) => m.kind === 'column').length;
  const ccOk = r.crossCheck?.pass === true;
  console.log(`design-loop self-test: 부재 ${r.members.length}(보 ${beams}·기둥 ${cols}) | 요약 ${JSON.stringify(r.summary)} | 교차검증 ${ccOk ? 'PASS' : JSON.stringify(r.crossCheck)}`);
  if (!beams || !cols || !ccOk) process.exit(1);
  console.log('OK');
}
