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
import { solveFrame2D } from '../engineering-core/frame2d.mjs';
import { responseSpectrumAnalysis, shearBuildingModes } from '../engineering-core/modal.mjs';
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

  const allParts = assembly?.parts ?? [];
  const unverifiedParts = allParts.filter((p) => p.unverified === true);
  const parts = allParts.filter((p) => p.unverified !== true);
  const columns = parts.filter((p) => p.role === 'column');
  const beams = parts.filter((p) => p.role === 'beam');
  const slabs = parts.filter((p) => p.role === 'slab');
  if (!columns.length || !beams.length || !slabs.length) {
    // 260729: 종전엔 전부 "role 태깅 필요"(=판정 불가)로 나갔다. 그러나 building 8종 실측에서
    // 7종이 여기 걸렸고, 열어보니 **대부분은 태깅이 빠진 게 아니라 애초에 라멘 골조가
    // 아니었다** — 물탱크·승강로·박공집은 기둥 0 · 벽 다수인 **벽식 구조**다.
    //
    // "확인 못 함"과 "해당 없음"은 다르다. 벽식 구조에 라멘 하중경로가 없다고 보고하는 것은
    // 판정 불가가 아니라 적용 대상이 아니라는 뜻이고, 둘을 섞으면 소비자는 "입력을 더 주면
    // 판정된다"고 오해한다. 기둥이 하나도 없고 벽이 있으면 벽식으로 분류한다(관측 기반 —
    // 임의 임계가 아니라 구조 형식의 정의).
    // 지붕 골조형(캐노피·박공 트러스): 슬래브 대신 **purlin→rafter→beam→column** 으로
    // 하중이 흐른다. 완결된 경로이지만 이 검사(슬래브→보→기둥)의 모델이 아니다.
    // 260729: 종전엔 "role 태깅 필요 — 슬래브0"으로 나갔는데, 캐노피에 슬래브가 없는 것은
    // **정상**이라 태깅을 요구하면 없는 부재를 만들어 붙이라는 뜻이 된다.
    const roofFrame = parts.filter((p) => p.role === 'rafter' || p.role === 'purlin');
    if (!slabs.length && roofFrame.length && columns.length && beams.length) {
      // ⚠ notApplicable 로 두지 **않는다**. 벽식은 shearWallCheck 가 받아 주지만 지붕
      // 골조형은 받아 줄 검사가 없어, 침묵시키면 "풍 상향력이 지배한다"는 실행 가능한
      // 안내까지 함께 사라진다. 판정 불가로 남기되 **사유가 정확해야** 한다.
      return {
        ok: false,
        error: `지붕 골조형(서까래·중도리 ${roofFrame.length} · 슬래브 0) — 하중이 지붕 골조로 흐르므로 `
          + '이 검토(슬래브→보→기둥→기초)의 대상이 아니다. ⚠ 캐노피·경사지붕은 **풍 상향력이 지배**하는 경우가 '
          + '많으니 wind.V0 를 주고 풍하중 검토를 받는 편이 낫다.',
      };
    }
    const walls = parts.filter((p) => p.role === 'wall');
    if (!columns.length && walls.length) {
      return {
        ok: false, notApplicable: true,
        error: `벽식 구조(기둥 0 · 벽 ${walls.length}) — 이 검토는 라멘 골조(슬래브→보→기둥→기초) 전용이라 해당 사항이 없다`,
      };
    }
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
  // ── 기둥 단 ↔ 슬래브 대응 (260729) ──────────────────────────────────────────
  // 종전: `slabs.length !== nf` → "슬래브 수 ≠ 층수, 층당 1장 필요". **가정이 틀렸다.**
  //
  // 실측(commercial_massing, floors=4): 기둥 단 z=[250,4450,8050,11650],
  // 슬래브 z=[0,4200,7800,11400,15000]. 각 기둥 단은 슬래브 위(+두께 250)에 서고 그 위로
  // 다음 슬래브를 받는다 — 기초 슬래브가 있는 4층 건물의 **정상 구성**인데 5≠4 로 거부됐다.
  // 즉 지붕/기초 슬래브를 가진 모든 건물이 항상 걸리는 규칙이었다.
  //
  // 하중경로가 실제로 요구하는 것은 개수 일치가 아니라 **각 기둥 단이 자기 위의 슬래브를
  // 받는가**이다. 단을 아래에서부터 훑어 위쪽 미사용 슬래브를 하나씩 짝지어 확인한다
  // — 기초 슬래브 유무와 무관하게 성립하고, 슬래브가 모자라면 그대로 걸린다.
  const slabZs = slabs.map((s) => s.at?.tz ?? 0).sort((a, b) => a - b);
  const usedSlab = new Set();
  const unmatchedTiers = [];
  for (const z of zs) {
    const i = slabZs.findIndex((sz, k) => !usedSlab.has(k) && sz > z);
    if (i < 0) unmatchedTiers.push(z); else usedSlab.add(i);
  }
  if (unmatchedTiers.length) {
    return {
      ok: false,
      error: `기둥 단 ${unmatchedTiers.length}개가 위쪽 슬래브를 못 받는다 — 기둥 단 z=[${zs.join(', ')}] vs 슬래브 z=[${slabZs.join(', ')}]. `
        + '각 기둥 단은 자기 위의 슬래브를 받아야 한다(기초 슬래브는 여분으로 허용).',
    };
  }
  if (xs.length < 2 || ys.length < 2) {
    // 260729: 종전 문구는 "기둥 격자 최소 2×2 필요" 뿐이라 **설계를 고치라는 뜻으로 읽혔다.**
    // 실제로는 이 검사기의 적용범위 한계다(위 96행과 같은 B3 v2 제약: 직교 격자 라멘 전용).
    // 실측 예: commercial_massing 은 기둥 24본이 전부 1열(6×1×4층)이고 벽 43장이 나머지를
    // 받는 벽+일방향 골조 혼합이다 — 건물이 틀린 게 아니라 이 검사의 대상이 아니다.
    return {
      ok: false,
      error: `기둥이 ${xs.length}×${ys.length} 배열(1열) — 이 검토는 직교 격자 라멘(2×2 이상) 전용이라 `
        + '대상이 아니다. 설계 결함이라는 뜻이 아니며, 벽·일방향 골조는 별도 검토가 필요하다.',
    };
  }

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

  // 지붕층 활하중 구분 (보완 #2): roofUsage 입력 시 최상층만 해당 활하중 — 미입력 시 전층 동일(보수적)
  const roofLive = params.roofUsage ? kds.loads.liveLoad_kNm2[params.roofUsage] : null;
  if (params.roofUsage && !roofLive) return { ok: false, error: `unknown roofUsage '${params.roofUsage}'` };
  const wL_roof = roofLive ? roofLive.v : wL_m2;
  const wu_roof = Math.max(1.4 * wD_m2, 1.2 * wD_m2 + 1.6 * wL_roof);

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
    const Vu_simple = Wu / 2;

    // 연속보 근사해법 (보완 #4 — KDS 14 20 10 §4.3.1(3)(4)): 조건 충족 시 계수법, 아니면 단순지지.
    const ac = kds.rc?.approxContinuous;
    const lineSpans = alongX ? xs : ys; // 보 방향 경간 좌표
    const spanCount = lineSpans.length - 1;
    const spanLens = lineSpans.slice(1).map((v, i) => v - lineSpans[i]);
    const adjOk = spanLens.every((s, i) => i === 0 || Math.abs(s - spanLens[i - 1]) <= Math.min(s, spanLens[i - 1]) * 0.2);
    const liveOk = L <= 3 * D; // 활하중 ≤ 3×고정 조건
    const useCoef = ac && params.continuity !== 'simple' && spanCount >= 2 && adjOk && liveOk;
    const lnM = spanM; // 보 부재 길이 = 기둥면 간 순경간(템플릿 기하)
    let Mu, MuNeg = null, Vu, method;
    if (useCoef) {
      Mu = (wu * lnM * lnM) / ac.posExteriorIntegral;   // 정모멘트 최외측(받침부 일체) — 지배 정모멘트
      MuNeg = (wu * lnM * lnM) / (spanCount === 2 ? ac.negFirstInterior2Span : ac.negFirstInterior3Span); // 첫 내부받침 부모멘트
      Vu = (ac.shearFirstInteriorFactor * wu * lnM) / 2;
      method = `연속보 계수법(§4.3.1(4)): +M=wl²/${ac.posExteriorIntegral}, −M=wl²/${spanCount === 2 ? ac.negFirstInterior2Span : ac.negFirstInterior3Span}, V=1.15wl/2 (${spanCount}경간·조건충족)`;
    } else {
      Mu = (wu * spanM * spanM) / 8;
      Vu = Vu_simple;
      method = spanCount >= 2
        ? `단순지지 근사 wl²/8 (계수법 조건 미충족: ${!adjOk ? '경간차>20% ' : ''}${!liveOk ? 'L>3D' : ''})`
        : '단순지지 wl²/8 (단경간)';
    }

    const cover = params.beamCover ?? 50;
    let check = null, checkNeg = null;
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
    // 부모멘트(상부철근) — beamAsTop 입력 시만 검토 (없으면 INPUT 표기, 지어내지 않음)
    if (MuNeg !== null) {
      if (Number(params.beamAsTop) > 0) {
        try {
          checkNeg = runCalculator('rc_beam', {
            b: bwv, d: bh - cover, fck: params.fck ?? 24, fy: params.fy ?? 400,
            As: Number(params.beamAsTop), Mu: round(MuNeg),
          }, 'KDS');
        } catch (e) { checkNeg = { error: e.message }; }
      } else {
        checkNeg = { verdict: 'INPUT(beamAsTop)' };
      }
    }
    const negVerdict = checkNeg ? (checkNeg.verdict ?? (checkNeg.error ? 'ERROR' : null)) : null;
    const posVerdict = check?.verdict ?? (check?.error ? 'ERROR' : 'INPUT(beamAs)');
    beamResults.push({
      id: `${worstBeam.id ?? 'beam'} (최악 — 층당 보 ${floor0Beams.length}본 중 최대분담)`,
      spanMm: round(span, 0), section: `${round(bwv, 0)}×${round(bh, 0)}`,
      tribM2: round(worstTrib), D_kN: round(D), L_kN: round(L), combo,
      wu_kNm: round(wu), Mu_kNm: round(Mu), MuNeg_kNm: MuNeg !== null ? round(MuNeg) : null, Vu_kN: round(Vu),
      method,
      verdict: negVerdict && negVerdict === 'FAIL' ? 'FAIL' : posVerdict,
      negVerdict,
      checks: check?.checks ?? null, checksNeg: checkNeg?.checks ?? null, error: check?.error ?? checkNeg?.error ?? null,
      // rc_beam의 설명 note(예: Vu>½φVc → 최소 전단철근 필요)를 체인 결과까지 전달 —
      // 이게 없으면 전단비 0.66인데 pass:false인 이유를 사용자가 볼 수 없다.
      notes: check?.notes ?? null, notesNeg: checkNeg?.notes ?? null,
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
  // 층 누적 — 최상층은 roofUsage 활하중(입력 시), 나머지 층은 usage (보완 #2)
  const perFloorPu = wu_m2 * worstColTrib + 1.2 * beamSelfPerM2 * worstColTrib + 1.2 * colSelfD;
  const roofFloorPu = wu_roof * worstColTrib + 1.2 * beamSelfPerM2 * worstColTrib + 1.2 * colSelfD;
  const perFloorPs = (wD_m2 + wL_m2 + beamSelfPerM2) * worstColTrib + colSelfD;
  const roofFloorPs = (wD_m2 + wL_roof + beamSelfPerM2) * worstColTrib + colSelfD;
  const Pu_col = perFloorPu * (nf - 1) + roofFloorPu;       // 최하층 기둥 = 전층 누적
  const Pservice_col = perFloorPs * (nf - 1) + roofFloorPs;
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

  // ── 지진 검토 (옵션 params.seismic — KDS 41 17 00 등가정적, 보완라운드) ──────
  //    층중량=형상 고정하중 파생 → V·Fx → 포탈법(관례 근사)으로 지배기둥 지진모멘트
  //    → rc_column_pm 지진조합(1.2D+1.0L+1.0E — 식 1.7-3 계열, 근사 명시).
  let seismicRes = null;
  const sp = params.seismic;
  if (sp && Number(sp.R) > 0) {
    try {
      const ncols = xs.length * ys.length;
      const beamSelfFloor = floor0Beams.reduce((s, b) => s + (partVolume(b.type, b.params) / 1e9) * gammaRC, 0);
      const wFloor = slabD_kN + beamSelfFloor + colSelfD * ncols; // 층 유효중량(고정하중) kN
      const pitch = zs.length > 1 ? (zs[1] - zs[0]) : (cb0.dz + (sb.dz ?? 150));
      const hsM = Array.from({ length: nf }, (_, i) => ((i + 1) * pitch) / 1000);
      const seis = runCalculator('seismic_static', {
        zone: sp.zone ?? 'I', siteClass: sp.siteClass ?? 'S4', importance: sp.importance ?? 'grade2',
        R: Number(sp.R), structType: sp.structType ?? 'rc_moment',
        ...(Number(sp.S) > 0 ? { S: Number(sp.S) } : {}), ...(Number(sp.T) > 0 ? { T: Number(sp.T) } : {}),
        heightsM: hsM, weightsKN: Array.from({ length: nf }, () => +wFloor.toFixed(1)),
      }, 'KDS');
      // 포탈법: 방향별 최하층 층전단 → 프레임 분배 → 내부기둥 전단 2v → M=v_col·h/2
      const V1 = seis.storyShear_kN[0];
      const clearH = (cb0.dz) / 1000; // 기둥 순높이 m
      const portal = (nSpans, nFrames) => {
        const vExt = V1 / nFrames / (2 * nSpans);
        const vInt = 2 * vExt;
        return vInt * clearH / 2; // kN·m (반곡점 중앙 가정)
      };
      const McolX = portal(xs.length - 1, ys.length);
      const McolY = portal(ys.length - 1, xs.length);
      const McolE = Math.max(McolX, McolY);
      // ── 매트릭스 횡해석 (실시설계급 — frame2d 평면골조, 포탈 대체·교차검증) ──
      // 대표 내부 골조(X·Y 각 방향): 층력/골조수 재하 → 기둥·보 단부모멘트 + 층간변위.
      // 강막(rigid diaphragm) 가정·2D 평면골조 근사 명시. 허용층간변위=표 8.2-1(원문).
      let matrixRes = null;
      try {
        const Ec_kPa = 8500 * Math.cbrt((params.fck ?? 24) + 4) * 1000;
        const runFrame = (lineXs, nFrames) => {
          const levels = [0, ...hsM.map((h) => h)]; // m (지반 0 + 각층)
          const nodes = [];
          for (let lv = 0; lv < levels.length; lv++) for (const x of lineXs) nodes.push([x / 1000, levels[lv]]);
          const nx2 = lineXs.length;
          const elements = [];
          const colI = ((cb0.dy / 1000) * Math.pow(cb0.dx / 1000, 3)) / 12;
          const colA = (cb0.dx / 1000) * (cb0.dy / 1000);
          const wb2 = worstBeam ? box(worstBeam) : null;
          const bw2 = wb2 ? Math.min(wb2.dx, wb2.dy) / 1000 : 0.3;
          const bh2 = wb2 ? wb2.dz / 1000 : 0.5;
          const beamI = (bw2 * Math.pow(bh2, 3)) / 12, beamA = bw2 * bh2;
          for (let lv = 0; lv < levels.length - 1; lv++) for (let i = 0; i < nx2; i++) {
            elements.push({ i: lv * nx2 + i, j: (lv + 1) * nx2 + i, E: Ec_kPa, A: colA, I: colI });
          }
          for (let lv = 1; lv < levels.length; lv++) for (let i = 0; i < nx2 - 1; i++) {
            elements.push({ i: lv * nx2 + i, j: lv * nx2 + i + 1, E: Ec_kPa, A: beamA, I: beamI });
          }
          const fixes = lineXs.map((_, i) => ({ node: i, ux: true, uy: true, rz: true }));
          const loads = seis.Fx_kN.map((F, fi) => ({ node: (fi + 1) * nx2, fx: F / nFrames }));
          const sol = solveFrame2D({ nodes, elements, springs: [], fixes, loads });
          // 층변위(각층 좌측 절점)·기둥 최대모멘트(1층)·보 최대 단부모멘트
          const dispByLevel = levels.map((_, lv) => sol.disp[3 * (lv * nx2)]);
          const drifts = [];
          for (let lv = 1; lv < levels.length; lv++) {
            drifts.push({ story: lv, drift_m: dispByLevel[lv] - dispByLevel[lv - 1], h_m: levels[lv] - levels[lv - 1] });
          }
          const nCols = (levels.length - 1) * nx2;
          let McolMax = 0, MbeamMax = 0;
          sol.elementEnd.forEach((el, ei) => {
            const M = Math.max(Math.abs(el.Mi), Math.abs(el.Mj));
            if (ei < nCols) { if (M > McolMax) McolMax = M; } else if (M > MbeamMax) MbeamMax = M;
          });
          return { drifts, McolMax, MbeamMax, roof_mm: +(dispByLevel[levels.length - 1] * 1000).toFixed(1) };
        };
        const fx = runFrame(xs, ys.length);
        const fy = runFrame(ys, xs.length);
        const worse = fx.McolMax >= fy.McolMax ? { d: fx, dir: 'X' } : { d: fy, dir: 'Y' };
        // 층간변위 검토: Δ설계 = δe × Cd / IE ≤ 허용(표 8.2-1)
        const Cd = Number(sp.Cd) || 0;
        const IE = seis.intermediate?.IE ?? 1.0;
        const dl = standards.KDS.seismicBuilding.allowableDrift;
        const limitRatio = dl[sp.driftClass ?? '1'] ?? dl['1'];
        const driftRows = worse.d.drifts.map((dr) => {
          const design = Cd > 0 ? (dr.drift_m * Cd) / IE : null;
          return {
            story: dr.story, elastic_mm: +(dr.drift_m * 1000).toFixed(2),
            design_mm: design !== null ? +(design * 1000).toFixed(2) : null,
            limit_mm: +(limitRatio * dr.h_m * 1000).toFixed(1),
            pass: design !== null ? design <= limitRatio * dr.h_m : null,
          };
        });
        // P-Δ 안정계수 θ = Px·Δ/(Vx·hsx·Cd) (KDS 41 17 00 §7.2.8.2 원문) — θ≤0.1 무시 가능
        const gravPerFloor = (wD_m2 + beamSelfPerM2 + wL_m2) * slabAreaM2 + colSelfD * xs.length * ys.length; // 층당 수직하중(D+L 근사 명시)
        const pdelta = worse.d.drifts.map((dr, i) => {
          const Px = gravPerFloor * (nf - i); // 해당층 이상 누적
          const Vx = seis.storyShear_kN[i];
          const theta = Cd > 0 && Vx > 0 ? (Px * dr.drift_m) / (Vx * dr.h_m * Cd) : null;
          return { story: i + 1, theta: theta !== null ? +theta.toFixed(4) : null, negligible: theta !== null ? theta <= 0.1 : null };
        });
        const thetaMax = Math.max(...pdelta.map((p) => p.theta ?? 0));
        // 비횡구속 sway 확대 δs = 1/(1−Q) (식 4.4-3 층안정성지수 Q=ΣPu·Δo/(Vu·h) — 1차 탄성변위)
        const sway = worse.d.drifts.map((dr, i) => {
          const Px = gravPerFloor * (nf - i);
          const Vx = seis.storyShear_kN[i];
          const Q = Vx > 0 ? (Px * dr.drift_m) / (Vx * dr.h_m) : null;
          const ds = Q !== null && Q < 1 ? 1 / (1 - Q) : null;
          return { story: i + 1, Q: Q !== null ? +Q.toFixed(4) : null, deltaS: ds !== null ? +ds.toFixed(3) : null, braced: Q !== null ? Q <= 0.05 : null };
        });
        // 응답스펙트럼(RSA) — 층 유연도(frame2d 단위하중 n회) → K=F⁻¹ → 모드 → KDS 스펙트럼 SRSS
        let rsa = null;
        if (sp.rsa === true) {
          try {
            const n = nf;
            const lineXs = worse.dir === 'X' ? xs : ys;
            const nFr = worse.dir === 'X' ? ys.length : xs.length;
            // 유연도: 층 j에 단위 1kN(골조당) → 각 층 변위
            const levels = [0, ...hsM];
            const nx2 = lineXs.length;
            const nodes = [];
            for (let lv = 0; lv < levels.length; lv++) for (const x of lineXs) nodes.push([x / 1000, levels[lv]]);
            const Ec_kPa2 = 8500 * Math.cbrt((params.fck ?? 24) + 4) * 1000;
            const colI2 = ((cb0.dy / 1000) * Math.pow(cb0.dx / 1000, 3)) / 12, colA2 = (cb0.dx / 1000) * (cb0.dy / 1000);
            const wb3 = worstBeam ? box(worstBeam) : null;
            const bw3 = wb3 ? Math.min(wb3.dx, wb3.dy) / 1000 : 0.3, bh3 = wb3 ? wb3.dz / 1000 : 0.5;
            const bI = (bw3 * Math.pow(bh3, 3)) / 12, bA = bw3 * bh3;
            const els = [];
            for (let lv = 0; lv < levels.length - 1; lv++) for (let i = 0; i < nx2; i++) els.push({ i: lv * nx2 + i, j: (lv + 1) * nx2 + i, E: Ec_kPa2, A: colA2, I: colI2 });
            for (let lv = 1; lv < levels.length; lv++) for (let i = 0; i < nx2 - 1; i++) els.push({ i: lv * nx2 + i, j: lv * nx2 + i + 1, E: Ec_kPa2, A: bA, I: bI });
            const fixes2 = lineXs.map((_, i) => ({ node: i, ux: true, uy: true, rz: true }));
            const F = [];
            for (let j = 1; j <= n; j++) {
              const sol2 = solveFrame2D({ nodes, elements: els, springs: [], fixes: fixes2, loads: [{ node: j * nx2, fx: 1 }] });
              F.push(Array.from({ length: n }, (_, i) => sol2.disp[3 * ((i + 1) * nx2)] * 1000)); // mm/kN(골조당)
            }
            // K = F⁻¹ (n×n 가우스) — 전체 골조 = ×nFr
            const A2 = F.map((row, i) => [...row.map((v) => v), ...Array.from({ length: n }, (_, j2) => (i === j2 ? 1 : 0))]);
            for (let c2 = 0; c2 < n; c2++) {
              let piv = c2; for (let r2 = c2 + 1; r2 < n; r2++) if (Math.abs(A2[r2][c2]) > Math.abs(A2[piv][c2])) piv = r2;
              [A2[c2], A2[piv]] = [A2[piv], A2[c2]];
              const d2 = A2[c2][c2];
              for (let c3 = 0; c3 < 2 * n; c3++) A2[c2][c3] /= d2;
              for (let r2 = 0; r2 < n; r2++) { if (r2 === c2) continue; const m2 = A2[r2][c2]; for (let c3 = 0; c3 < 2 * n; c3++) A2[r2][c3] -= m2 * A2[c2][c3]; }
            }
            const Kfull = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j2) => A2[i][n + j2] * nFr)); // kN/mm 전체
            // 층강성 근사(전단빌딩 환산): k_i = −K[i][i-1] (비대각) — 3중대각 가정 명시. 1층은 K[0][0]+K[0][1]
            const kStory = Array.from({ length: n }, (_, i) => {
              if (i === 0) return (Kfull[0][0] + (n > 1 ? Kfull[0][1] : 0)) * 1000; // kN/m
              return -Kfull[i][i - 1] * 1000;
            });
            const massTon = Array.from({ length: n }, () => (wFloor / 9.81)); // 층중량→질량
            const out = responseSpectrumAnalysis({
              kStory_kNm: kStory, mass_ton: massTon,
              SDS: seis.intermediate.SDS, SD1: seis.intermediate.SD1, TL: 5,
              R: Number(sp.R), IE: seis.intermediate?.IE ?? 1, nModes: Math.min(3, n),
            });
            const scale = Math.max(1, (0.85 * seis.V_kN) / out.V_srss_kN); // §7.3.3.5(2) 원문: 0.85V 하한 보정(층간변위 제외)
            rsa = {
              T1_s: out.modes[0]?.T_s, modes: out.modes, V_srss_kN: out.V_srss_kN, cumEffMass: out.cumEffMass,
              scale735: +scale.toFixed(3), V_design_kN: +(out.V_srss_kN * scale).toFixed(1),
              vsEquivalent: +(out.V_srss_kN / seis.V_kN).toFixed(3),
              note: '층 유연도(frame2d)→K→모드(Jacobi)→KDS 스펙트럼 SRSS. §7.3.3.5(2) 보정: Vt<0.85V이면 설계값×0.85V/Vt(층간변위 제외 — 원문). 전단빌딩 환산·질량=고정하중 층중량 명시.',
            };
          } catch (e) { rsa = { error: e.message }; }
        }
        matrixRes = {
          sway, rsa,
          pdelta: { rows: pdelta, thetaMax: +thetaMax.toFixed(4), note: thetaMax <= 0.1 ? 'θ≤0.1 전층 — P-Δ 무시 가능(§7.2.8.2(1))' : 'θ>0.1 층 존재 — 증폭계수 1/(1−θ) 적용 또는 P-Δ 해석 필요(§7.2.8.2(3)) — 자동 증폭은 후속(명시)' },
          dir: worse.dir, McolMax_kNm: +worse.d.McolMax.toFixed(1), MbeamMax_kNm: +worse.d.MbeamMax.toFixed(1),
          roof_mm: worse.d.roof_mm, drifts: driftRows,
          driftLimit: `${limitRatio}·hsx (표 8.2-1, 내진 ${sp.driftClass ?? 'I'}등급)`,
          Cd: Cd || 'INPUT(Cd — 표 6.2-1 R과 세트)',
          method: 'frame2d 평면골조 매트릭스(대표 골조·강막·2D 근사 명시) — 포탈 대체. E·I=형상·재료 파생',
          portalCrossCheck_kNm: null, // 아래에서 채움
        };
      } catch (e) {
        matrixRes = { error: e.message };
      }

      const McolUse = (matrixRes && !matrixRes.error && matrixRes.McolMax_kNm > 0) ? matrixRes.McolMax_kNm : McolE;
      if (matrixRes && !matrixRes.error) matrixRes.portalCrossCheck_kNm = round(McolE);
      // 지진조합 축력 (1.2D + 1.0L 부분, 지배기둥) — 층누적
      const PuE = ((1.2 * (wD_m2 + beamSelfPerM2) + 1.0 * wL_m2) * worstColTrib + 1.2 * colSelfD) * nf;
      let colE = null;
      if (Number(params.colAst) > 0) {
        try {
          colE = runCalculator('rc_column_pm', {
            b: round(cb0.dx, 0), h: round(cb0.dy, 0), fck: params.fck ?? 24, fy: params.fy ?? 400,
            Ast: Number(params.colAst), Pu: round(PuE), Mu: round(McolUse),
          }, 'KDS');
        } catch (e) { colE = { error: e.message }; }
      }

      seismicRes = {
        V_kN: seis.V_kN, Fx_kN: seis.Fx_kN, storyShear_kN: seis.storyShear_kN,
        Cs: seis.intermediate.Cs, governing: seis.intermediate.governing,
        SDS: seis.intermediate.SDS, SD1: seis.intermediate.SD1, Ta_s: seis.intermediate.Ta_s,
        perFloorWeight_kN: +wFloor.toFixed(1),
        matrix: matrixRes,
        column: {
          MuE_kNm: round((typeof McolUse !== 'undefined' ? McolUse : McolE)), PuE_kN: round(PuE),
          verdict: colE?.verdict ?? (colE?.error ? 'ERROR' : 'INPUT(colAst)'),
          checks: colE?.checks ?? null,
          method: `포탈법(내부기둥 2v·반곡점 중앙) — X ${round(McolX)}·Y ${round(McolY)} kN·m 중 최대. 조합 1.2D+1.0L+1.0E 근사`,
        },
        notes: seis.notes,
        applicability: (hsM[hsM.length - 1] ?? 0) >= 70
          ? `⚠ 높이 ${(hsM[hsM.length - 1]).toFixed(0)}m ≥ 70m — 표 7.1-1(내진설계범주 D): 등가정적 부적합, 동적해석 필수(sp.rsa=true) [원문 게이트]`
          : `높이 ${(hsM[hsM.length - 1] ?? 0).toFixed(1)}m < 70m — 정형 가정 시 등가정적 허용(표 7.1-1). 비정형(H-1·V-1 등) 판정은 별도(명시)`,
        disclaimer: '우발편심·비틀림·보 지진모멘트 미포함 — 매트릭스=대표골조 2D(강막). 비정형은 동적해석·정밀 판정 필요.' + (unverifiedParts.length ? ` ⚠ 비검증 직접편집 파츠 ${unverifiedParts.length}개는 구조 검토에서 제외됨(P4 라벨) — 해당 형상의 안전은 별도 확인 필요.` : ''),
      };
    } catch (e) {
      seismicRes = { error: e.message };
    }
  }

  // ── 풍하중 검토 (옵션 params.wind — KDS 41 12 00, 잔여 4축 A) ────────────────
  //    형상 파생: H=최상층 높이·B/D=평면 외곽. 간편법(§5.15) 적용조건 충족 시 간편법,
  //    아니면 정식법(§5.2 강체) 자동 선택 → 포탈법 기둥 풍모멘트(1.3W 조합 계수 적용).
  let windRes = null;
  const wp = params.wind;
  if (wp && Number(wp.V0) > 0) {
    try {
      const pitch2 = zs.length > 1 ? (zs[1] - zs[0]) : (cb0.dz + (sb.dz ?? 150));
      const Hm = (nf * pitch2) / 1000;
      const Bx = (xs[xs.length - 1] - xs[0] + cb0.dx) / 1000; // X방향 폭
      const By = (ys[ys.length - 1] - ys[0] + cb0.dy) / 1000;
      // 두 풍향 모두 검토: X풍(수압면 By×H, 깊이 Bx) · Y풍(수압면 Bx×H, 깊이 By)
      const runDir = (Bw, Dd) => {
        const simpleOk = Hm <= 20 && Hm / Math.sqrt(Bw * Dd) <= 1.0 && Bw >= 0.5 * Hm && Bw <= 30;
        if (simpleOk) {
          const r = runCalculator('wind_simple', { V0: Number(wp.V0), H: +Hm.toFixed(1), B: +Bw.toFixed(1), D: +Dd.toFixed(1), terrain: wp.terrain ?? 'normal', ...(Number(wp.Kzt) > 1 ? { Kzt: Number(wp.Kzt) } : {}), demandNone: 0 }, 'KDS');
          return { method: '간편법(§5.15)', baseShear_kN: r.baseShear_kN, p_Nm2: r.pressure.design_Nm2, detail: r };
        }
        const r = runCalculator('wind_static', { V0: Number(wp.V0), H: +Hm.toFixed(1), B: +Bw.toFixed(1), D: +Dd.toFixed(1), exposure: wp.exposure ?? 'C', importance: wp.importance ?? '1', structType: wp.structType ?? 'rc_moment', ...(Number(wp.dampingRatio) > 0 ? { dampingRatio: Number(wp.dampingRatio) } : {}), ...(Number(wp.natFreqHz) > 0 ? { natFreqHz: Number(wp.natFreqHz) } : {}), storyH: +(pitch2 / 1000).toFixed(2), demandNone: 0 }, 'KDS');
        return { method: r.designSpeed.rigidCheck.includes('유연') ? '정식법(§5.2·식5.6-1 유연)' : '정식법(§5.2 강체)', baseShear_kN: r.baseShear_kN, p_Nm2: r.pressure.pTop_Nm2, detail: r };
      };
      const wx = runDir(By, Bx); // X방향 바람 → 수압면 폭 = By
      const wy = runDir(Bx, By);
      // 지배 방향 포탈법 기둥 모멘트 (1.3W)
      const clearH2 = cb0.dz / 1000;
      const portalW = (V, nSpans, nFrames) => (2 * (V / nFrames / (2 * nSpans))) * clearH2 / 2;
      const McolWx = portalW(1.3 * wx.baseShear_kN, xs.length - 1, ys.length);
      const McolWy = portalW(1.3 * wy.baseShear_kN, ys.length - 1, xs.length);
      const McolW = Math.max(McolWx, McolWy);
      const PuW = ((1.2 * (wD_m2 + beamSelfPerM2) + 1.0 * wL_m2) * worstColTrib + 1.2 * colSelfD) * nf;
      let colW = null;
      if (Number(params.colAst) > 0) {
        try {
          colW = runCalculator('rc_column_pm', {
            b: round(cb0.dx, 0), h: round(cb0.dy, 0), fck: params.fck ?? 24, fy: params.fy ?? 400,
            Ast: Number(params.colAst), Pu: round(PuW), Mu: round(McolW),
          }, 'KDS');
        } catch (e) { colW = { error: e.message }; }
      }
      windRes = {
        H_m: +Hm.toFixed(1), B_m: +Bx.toFixed(1), D_m: +By.toFixed(1),
        x: { method: wx.method, baseShear_kN: wx.baseShear_kN, p_Nm2: wx.p_Nm2 },
        y: { method: wy.method, baseShear_kN: wy.baseShear_kN, p_Nm2: wy.p_Nm2 },
        column: {
          MuW_kNm: round(McolW), PuW_kN: round(PuW),
          verdict: colW?.verdict ?? (colW?.error ? 'ERROR' : 'INPUT(colAst)'),
          checks: colW?.checks ?? null,
          method: `포탈법 — 1.3W(U=1.2D+1.3W+1.0L 원문 조합) · X ${round(McolWx)}·Y ${round(McolWy)} kN·m 중 최대`,
        },
        note: 'H·B·D=형상 파생. 간편법 적용조건 자동판정(충족 시 §5.15, 아니면 §5.2 강체 정식법). 내압·지붕풍·비틀림 미포함.',
      };
    } catch (e) {
      windRes = { error: e.message };
    }
  }

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

  // ── 철근 개산 (P1 #2) — 입력 배근 × 형상 길이. 가정 제로 원칙:
  //    배근이 입력된 부재만 산출, 정착·이음·갈고리·슬래브근은 미포함 명시(별도 산정).
  const RHO_S = 7850; // kg/m³
  let rebar = null;
  {
    const items = [];
    const cover = params.beamCover ?? 50;
    const beamCount = floor0Beams.length * nf;
    if (Number(params.beamAs) > 0 && floor0Beams.length) {
      const totLenM = floor0Beams.reduce((s, b) => { const bb = box(b); return s + Math.max(bb.dx, bb.dy) / 1000; }, 0) * nf;
      items.push({ name: '보 하부 주철근', basis: `As ${params.beamAs}mm² × 보 전장 ${round(totLenM, 1)}m`, kg: round(Number(params.beamAs) * totLenM * RHO_S / 1e6, 1) });
      if (Number(params.beamAsTop) > 0) items.push({ name: '보 상부 주철근 (전장 가정 — 보수)', basis: `AsTop ${params.beamAsTop}mm² × ${round(totLenM, 1)}m`, kg: round(Number(params.beamAsTop) * totLenM * RHO_S / 1e6, 1) });
      if (Number(params.beamAv) > 0 && Number(params.beamS) > 0) {
        // 스터럽: 부재당 개수 = 순경간/s + 1, 1개 강재 체적 = Av × 둘레(피복 공제) — 갈고리 미포함 명시
        const b0 = box(floor0Beams[0]);
        const bwv = Math.min(b0.dx, b0.dy), bh = b0.dz, ln = Math.max(b0.dx, b0.dy);
        const per = 2 * ((bwv - 2 * cover) + (bh - 2 * cover));
        const nSt = Math.floor(ln / Number(params.beamS)) + 1;
        items.push({ name: '보 스터럽 (갈고리 미포함)', basis: `Av ${params.beamAv}mm² × 둘레 ${round(per, 0)}mm × ${nSt}개/본 × ${beamCount}본`, kg: round(Number(params.beamAv) * per * nSt * beamCount * RHO_S / 1e12 * 1e3, 1) });
      }
    }
    if (Number(params.colAst) > 0) {
      const colCount = xs.length * ys.length * nf;
      const colLenM = (cb0.dz / 1000) * colCount;
      items.push({ name: '기둥 주철근', basis: `Ast ${params.colAst}mm² × 기둥 전장 ${round(colLenM, 1)}m (${colCount}본)`, kg: round(Number(params.colAst) * colLenM * RHO_S / 1e6, 1) });
    }
    if (items.length) {
      const totalKg = round(items.reduce((s, i) => s + i.kg, 0), 1);
      rebar = {
        items, totalKg, totalTon: round(totalKg / 1000, 2),
        note: '입력 배근 × 형상 길이 결정론 산출. 정착·이음·갈고리·띠철근(기둥)·슬래브 배근 미포함(별도 산정 — 통상 총량의 상당분). 물량 개산·비법정.',
      };
    }
  }

  // ── 안 돌린 검토를 침묵으로 두지 않는다 (260729) ─────────────────────────────
  // 지진(KDS 41 17 00 등가정적)과 풍(KDS 41 12 00)은 **이미 구현돼 있으나** 각각
  // params.seismic.R · params.wind.V0 가 있을 때만 돈다. 그런데 패키지 경로는
  // verifyParams 를 비운 채 호출하므로 **생성되는 모든 건물 도면집에서 한 번도 돌지
  // 않았고**, 결과는 `seismic:null · wind:null · ok:true` 였다 — 소비자는 "하중경로
  // 검토 이상 없음"을 구조 검증으로 읽는다. 부재 휨/처짐 미검토와 같은 자리다.
  //
  // 층높이·층중량은 형상에서 이미 파생된다. 사용자가 줘야 하는 것은 **형상에서 추론
  // 불가능한 값** 뿐이고, 그것을 이름으로 지목한다(추측해 넣으면 그게 날조다).
  const unavailable = [];
  if (!seismicRes) {
    unavailable.push({
      what: 'seismic', labelKo: '지진 검토(KDS 41 17 00 등가정적)',
      needInputs: [
        { name: 'seismic.R', labelKo: '반응수정계수 R (1~8) — 구조시스템이 정하는 값이라 형상에서 알 수 없다' },
        { name: 'seismic.zone', labelKo: '지진구역 I/II (선택 — 기본 I)' },
        { name: 'seismic.siteClass', labelKo: '지반종류 S1~S5 (선택 — 기본 S4)' },
        { name: 'seismic.importance', labelKo: '내진등급 special/grade1/grade2 (선택 — 기본 grade2)' },
      ],
      messageKo: '지진 검토 미실시 — 층높이·층중량은 형상에서 이미 산출됐고 반응수정계수 R 만 주면 등가정적 해석이 돕니다. '
        + '**"지진에 안전하다"는 뜻이 아닙니다.**',
    });
  }
  if (!windRes) {
    unavailable.push({
      what: 'wind', labelKo: '풍하중 검토(KDS 41 12 00)',
      needInputs: [
        { name: 'wind.V0', labelKo: '기본풍속 V0 (m/s) — 대지 위치가 정하는 값이라 형상에서 알 수 없다' },
        { name: 'wind.exposure', labelKo: '노출계수 A~D (선택 — 기본 C)' },
      ],
      messageKo: '풍하중 검토 미실시 — 건물 높이·평면 외곽은 형상에서 이미 산출됐고 기본풍속 V0 만 주면 검토가 돕니다. '
        + '**"풍하중에 안전하다"는 뜻이 아닙니다.**',
    });
  }

  return {
    ok: true,
    scope: `직교 격자 라멘 ${xs.length - 1}×${ys.length - 1}베이 ${nf}층 · 중력${seismicRes && !seismicRes.error ? '+등가정적 지진' : '하중만'}`
      + `${windRes && !windRes.error ? '+풍' : ''} (B3)`
      + (unavailable.length ? ` · ⚠ 미실시: ${unavailable.map((u) => u.labelKo.split('(')[0].trim()).join('·')}` : ''),
    rebar,
    seismic: seismicRes,
    wind: windRes,
    ...(unavailable.length ? { lateralUnavailable: unavailable } : {}),
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
