/**
 * landscape-check.mjs — 조경 구조 체인 (Wave A · 조경 L1+L2).
 *
 * role 태깅 조경 어셈블리(pergola/timber_deck)에서:
 *   ① 목재 부재 검토 — 장선/서까래 최악 부재를 형상에서 파생(단면 b×h·스팬·장선간격)
 *      → timber_beam 계산기(KDS 41 50 10 허용응력×CD). 데크=활하중(표 3.2-1 용도),
 *      파고라 서까래=자중+입력 추가하중.
 *   ② 풍하중 전도 — 입력 풍압 × 측면 투영면적(AABB 합, 겹침 미공제=보수적)
 *      → 전도모멘트 vs 자중 저항모멘트 → FS(양방향 최소) + 바람쪽 기둥 앵커 소요인발력.
 *
 * 정직 원칙: 풍압은 입력(KDS 41 12 00 5장 산정은 지역·지형·중요도 의존 — 지어내지 않음).
 * 전도 FS 임계도 입력(기본 1.5 관례 — KDS에 파고라 전도 확정기준 없음, 옹벽은 2.0).
 * 자중=형상×밀도(결정론). 근사(AABB 투영·강체 전도) 전부 명시.
 */
import { runCalculator, loadStandards } from '../engineering-core/registry.mjs';
import { partVolume, DENSITY } from './structural.mjs';
import { partAabb } from './reconstruct.mjs';
import { buildAssembly } from './assembly.mjs';

const standards = loadStandards();
const G = 9.81;
const round = (v, n = 2) => +Number(v).toFixed(n);

function box(part) {
  const a = partAabb({ type: part.type, ...part.params });
  const { tx = 0, ty = 0, tz = 0 } = part.at ?? {};
  return {
    x0: a.min[0] + tx, y0: a.min[1] + ty, z0: a.min[2] + tz,
    x1: a.max[0] + tx, y1: a.max[1] + ty, z1: a.max[2] + tz,
    dx: a.max[0] - a.min[0], dy: a.max[1] - a.min[1], dz: a.max[2] - a.min[2],
  };
}
const massKg = (p) => partVolume(p.type, p.params) / 1e9 * (DENSITY[p.material ?? 'timber'] ?? DENSITY.timber);

/**
 * @param assembly pergola/timber_deck 어셈블리 (role: joist/beam/column/deck)
 * @param params {
 *   species='pine', grade=2, duration='tenYears', deflLimit=240,
 *   usage='residence_living' (데크 활하중 용도 — KDS 표 3.2-1), extraW_kNm=0 (서까래 추가하중),
 *   windPressure_kNm2 (풍하중 전도 검토 시 필수 — 미입력 시 전도 생략), fsLimit=1.5
 * }
 */
export function landscapeCheck(assembly, params = {}) {
  const allParts = assembly?.parts ?? [];
  const unverifiedParts = allParts.filter((p) => p.unverified === true);
  const parts = allParts.filter((p) => p.unverified !== true);
  if (!parts.length) return { ok: false, error: 'assembly.parts 필요' };
  const joists = parts.filter((p) => p.role === 'joist');
  const columns = parts.filter((p) => p.role === 'column');
  const decks = parts.filter((p) => p.role === 'deck');

  const species = params.species ?? 'pine', grade = params.grade ?? 2;

  // ── ① 목재 부재 검토 (장선/서까래 대표 — 동일 단면 반복 가정, 형상 파생) ──
  let member = null;
  if (joists.length) {
    const jb = box(joists[0]);
    // 스팬 방향 = 장축(수평), 단면 = 폭(수평 단축) × 춤(dz)
    const spanIsX = jb.dx >= jb.dy;
    const L = spanIsX ? jb.dx : jb.dy;
    const b = spanIsX ? jb.dy : jb.dx;
    const h = jb.dz;
    // 장선 간격 = 인접 장선 중심 간 거리(형상 파생, 스팬 직각 방향)
    const centers = joists.map((j) => { const bb = box(j); return spanIsX ? (bb.y0 + bb.y1) / 2 : (bb.x0 + bb.x1) / 2; }).sort((a, c) => a - c);
    const spacing = centers.length > 1 ? (centers[centers.length - 1] - centers[0]) / (centers.length - 1) : L;
    // 하중: 자중(장선+분담 데크보드) + 활하중(데크일 때, 용도표) + 추가 입력
    const selfW = massKg(joists[0]) * G / 1000 / (L / 1000); // kN/m
    const deckW = decks.length ? decks.reduce((s, d) => s + massKg(d), 0) * G / 1000 / decks.length / (L / 1000) * 0 : 0; // 개별 분담은 아래 면하중으로
    const live = standards?.KDS?.loads?.liveLoad_kNm2?.[params.usage ?? 'residence_living'];
    const liveW = decks.length && live ? live.v * (spacing / 1000) : 0; // kN/m (데크 위 활하중 × 장선 분담폭)
    const deckSelfPerM2 = decks.length ? decks.reduce((s, d) => s + massKg(d), 0) * G / 1000 / ((box(decks[0]).dx / 1000) * (decks.length * (box(decks[0]).dy / 1000))) : 0;
    const deckSelfW = decks.length ? deckSelfPerM2 * (spacing / 1000) : 0;
    const w = round(selfW + deckSelfW + liveW + (Number(params.extraW_kNm) || 0), 3);
    let check = null;
    try {
      check = runCalculator('timber_beam', {
        species, grade, b: round(b, 0), h: round(h, 0), L: round(L, 0), w,
        duration: params.duration ?? 'tenYears', deflLimit: params.deflLimit ?? 240,
        // 조경(옥외)은 습윤 사용조건이 기본 — 표 3.1-8 CM 적용 (명시적 false로만 해제)
        wetService: params.wetService !== false,
      }, 'KDS');
    } catch (e) {
      check = e.code === 'INPUT_GATE' ? { verdict: 'INPUT', error: e.message } : { verdict: 'ERROR', error: e.message };
    }
    member = {
      id: joists[0].id ?? 'joist', count: joists.length,
      section: `${round(b, 0)}×${round(h, 0)}`, spanMm: round(L, 0), spacingMm: round(spacing, 0),
      load: { self_kNm: round(selfW, 3), deckSelf_kNm: round(deckSelfW, 3), live_kNm: round(liveW, 3), extra_kNm: Number(params.extraW_kNm) || 0, total_kNm: w, liveRef: decks.length && live ? `${live.label} ${live.v}kN/m² (KDS 41 12 00 표 3.2-1)` : '활하중 없음(비바닥)' },
      verdict: check?.verdict, checks: check?.checks ?? null, notes: check?.notes ?? null, error: check?.error ?? null,
      provenance: { geometry: ['단면 b×h', '스팬', '장선 간격', '자중'], user: ['수종·등급', '용도(활하중)', '추가하중', '하중기간'] },
    };
  }

  // ── ①a 장선↔보 접합부 검토 — 단부반력(형상·하중 파생)을 못/볼트 계산기로 ──
  let connection = null;
  if (member && member.load) {
    const R_N = round(member.load.total_kNm * (member.spanMm / 1000) / 2 * 1000, 0); // 장선 단부반력 N
    const conn = params.connection;
    const grpMap = { larch: 'A', pine: 'B', koreanpine: 'C', cedar: 'D' };
    const group = grpMap[species] ?? 'B';
    if (conn?.type === 'nail' || conn?.type === 'bolt') {
      let chk = null;
      try {
        chk = conn.type === 'nail'
          ? runCalculator('timber_nail', {
              sideThk: conn.sideThk ?? 38, nailLen: conn.nailLen ?? 89, nailDia: conn.nailDia ?? 4.11,
              group, count: conn.count ?? 2, demandN: R_N,
              duration: params.duration ?? 'tenYears',
              // 옥외 조경 = 습윤 기본 (표 4.9-2)
              serviceWet: params.wetService !== false,
              ...(conn.endDist !== undefined ? { endDist: conn.endDist } : {}),
            }, 'KDS')
          : runCalculator('timber_bolt', {
              mainThk: conn.mainThk ?? 38, sideThk: conn.sideThk ?? 38, boltDia: conn.boltDia ?? 12,
              group, count: conn.count ?? 1, demandN: R_N,
              duration: params.duration ?? 'tenYears', serviceWet: params.wetService !== false,
              ...(conn.count >= 2 && conn.rowSpacing_mm ? { nRow: conn.count, rowSpacing_mm: conn.rowSpacing_mm, mainWidth: conn.mainWidth ?? 140, sideWidth: conn.sideWidth ?? 140 } : {}),
            }, 'KDS');
      } catch (e) {
        chk = e.code === 'INPUT_GATE' ? { verdict: 'INPUT', error: e.message } : { verdict: 'ERROR', error: e.message };
      }
      connection = {
        type: conn.type, demandN: R_N, verdict: chk?.verdict,
        checks: chk?.checks ?? null, notes: chk?.notes ?? null, error: chk?.error ?? null,
        provenance: { geometry: ['단부반력 = w·L/2 (부재 하중·스팬 파생)'], user: ['철물 종류·규격·개수'] },
      };
    } else {
      connection = {
        type: 'unspecified', demandN: R_N, verdict: 'INPUT',
        note: `장선↔보 접합 철물 미지정 — 단부반력 ${R_N}N을 지지할 접합 필요 (params.connection={type:'nail'|'bolt',…} 입력 시 자동 검토)`,
      };
    }
  }

  // ── ①b 데크보드 검토 (보완 #5) — 보드 스팬 = 장선 간격, 대표 1장 ──────────
  let board = null;
  if (decks.length && member) {
    const db = box(decks[0]);
    const alongX = db.dx >= db.dy;
    const panelW = alongX ? db.dy : db.dx;   // 모델상 보드/패널 폭(스팬 직각 방향)
    // 폭이 실제 데크보드 폭(≤600)이면 그대로 사용, 단일 패널(폭 수 m)로 모델링돼 과대하면
    // 대표 보드 1장(폭=params.boardWidthMm, 기본 140mm 관례)으로 협폭화 — 패널 전체폭을 b로
    // 넘기면 timber_beam 게이트(b≤600)에 걸려 검토 자체가 무의미해지므로.
    const boardW = panelW > 0 && panelW <= 600
      ? panelW
      : Math.min(600, Number(params.boardWidthMm) > 0 ? Number(params.boardWidthMm) : 140);
    const bt = db.dz;                     // 보드 두께
    const spanB = member.spacingMm;       // 장선 간격이 보드 스팬
    const live = standards?.KDS?.loads?.liveLoad_kNm2?.[params.usage ?? 'residence_living'];
    const panelArea = (db.dx / 1000) * (decks.length * (db.dy / 1000)); // m² (전체 데크 면적)
    const selfPerM2 = panelArea > 0 ? decks.reduce((s, d) => s + massKg(d), 0) * G / 1000 / panelArea : 0; // kN/m²
    const selfB = selfPerM2 * (boardW / 1000); // kN/m (보드 1장 길이당 자중)
    const wB = round((live ? live.v * (boardW / 1000) : 0) + selfB, 3);
    let chk = null;
    try {
      chk = runCalculator('timber_beam', {
        species, grade, b: round(boardW, 0), h: round(bt, 0), L: round(spanB, 0), w: wB,
        duration: params.duration ?? 'tenYears', deflLimit: params.deflLimit ?? 240,
        wetService: params.wetService !== false,
      }, 'KDS');
    } catch (e) {
      // 게이트 실패 원문("input gate failed: …")을 사용자 응답에 노출 금지 → 구조화
      chk = e.code === 'INPUT_GATE'
        ? { verdict: 'INPUT', needInputs: [{ field: 'params.boardWidthMm', reason: '데크보드 1장 폭(mm, ≤600) — 패널 전체폭이 아닌 개별 보드 폭 필요' }] }
        : { verdict: 'ERROR', error: e.message };
    }
    board = {
      id: decks[0].id ?? 'board', count: decks.length, section: `${round(boardW, 0)}×${round(bt, 0)}`,
      spanMm: round(spanB, 0), w_kNm: wB,
      verdict: chk?.verdict, checks: chk?.checks ?? null,
      ...(chk?.needInputs ? { needInputs: chk.needInputs } : {}),
      ...(chk?.error ? { error: chk.error } : {}),
      note: `보드 1장(폭 ${round(boardW, 0)}mm${panelW > 600 ? ' — 단일 패널 모델이라 대표 보드폭으로 협폭화(params.boardWidthMm)' : ''})·스팬=장선 간격(단순지지 근사)·하중=활하중×보드폭+자중`,
    };
  }

  // ── ② 풍하중 전도 (강체 — 파고라 등 자립 구조) ─────────────────────────────
  let wind = null;
  const wp = Number(params.windPressure_kNm2);
  if (wp > 0 && columns.length) {
    const totalM = parts.reduce((s, p) => s + massKg(p), 0); // kg
    const W = totalM * G / 1000; // kN
    const x0 = Math.min(...parts.map((p) => box(p).x0)), x1 = Math.max(...parts.map((p) => box(p).x1));
    const y0 = Math.min(...parts.map((p) => box(p).y0)), y1 = Math.max(...parts.map((p) => box(p).y1));
    // 기둥 저면 지지 폭 (전도 팔길이) — 기둥 중심 범위
    const colXs = columns.map((c) => (box(c).x0 + box(c).x1) / 2), colYs = columns.map((c) => (box(c).y0 + box(c).y1) / 2);
    const baseX = (Math.max(...colXs) - Math.min(...colXs)) / 1000, baseY = (Math.max(...colYs) - Math.min(...colYs)) / 1000;
    const dir = (axis) => {
      // 투영면적: 각 부품 AABB의 (바람 직각 폭 × 높이) 합 — 겹침 미공제(보수적)
      let A = 0, Mza = 0;
      for (const p of parts) {
        const bb = box(p);
        const a = ((axis === 'x' ? bb.dy : bb.dx) / 1000) * (bb.dz / 1000);
        A += a; Mza += a * ((bb.z0 + bb.z1) / 2 / 1000);
      }
      const zc = A > 0 ? Mza / A : 0;
      const F = wp * A;
      const Mo = F * zc;
      const arm = (axis === 'x' ? baseX : baseY) / 2;
      const Mr = W * arm;
      return { areaM2: round(A), F_kN: round(F), zc_m: round(zc), Mo_kNm: round(Mo), Mr_kNm: round(Mr), FS: Mo > 0 ? round(Mr / Mo) : Infinity };
    };
    const dx = dir('x'), dy2 = dir('y');
    const worst = dx.FS <= dy2.FS ? { ...dx, dir: 'X풍' } : { ...dy2, dir: 'Y풍' };
    const fsLimit = Number(params.fsLimit) || 1.5;
    // 앵커 소요 인발력(부족 시): 바람쪽 기둥열이 부담 — T = (fsLimit·Mo − Mr) / base / (열당 기둥수)
    const base = worst.dir === 'X풍' ? baseX : baseY;
    const perSide = Math.max(1, Math.round(columns.length / 2));
    const deficit = fsLimit * worst.Mo_kNm - worst.Mr_kNm;
    const anchorT = deficit > 0 && base > 0 ? round(deficit / base / perSide) : 0;
    wind = {
      windPressure_kNm2: wp, totalWeight_kN: round(W),
      x: dx, y: dy2, worst: worst.dir, FS: worst.FS, fsLimit,
      pass: worst.FS >= fsLimit,
      anchorUpliftPerPost_kN: anchorT,
      fsNote: 'FS 임계=입력(기본 1.5 관례 — KDS에 파고라 전도 확정기준 없음·옹벽 기준은 2.0). 풍압=입력(KDS 41 12 00 5장 산정은 지역·지형 의존).',
      method: 'AABB 측면 투영(겹침 미공제=보수적) × 풍압 → 강체 전도. 앵커 인발=부족모멘트/지지폭/열당 기둥수(개산).',
    };
  } else if (columns.length) {
    wind = { skipped: true, note: 'windPressure_kNm2 미입력 — 전도 검토 생략(풍압을 지어내지 않음). KDS 41 12 00 5장 또는 프로젝트 기준으로 산정해 입력.' };
  }

  // 관수 체인(MEP 확산): supply 배관 형상(정수두·연장=라우터 결정론 실측) + 유량·헤드(제품
  // 사양 입력 — 지어내지 않음) → pump_head 전양정·동력. 관경은 선언 d(외경 개산) 사용 명시.
  let irrigation = null;
  const supplyPipes = Array.isArray(assembly?.pipes) ? assembly.pipes.filter((pp) => pp.service === 'supply') : [];
  if (supplyPipes.length) {
    try {
      const routes = (buildAssembly(assembly)?.pipes?.routes ?? []).filter((rt) => supplyPipes.some((sp) => sp.id === rt.label));
      if (routes.length) {
        let len = 0, zmin = Infinity, zmax = -Infinity;
        for (const rt of routes) for (let i = 0; i < rt.pts.length; i++) {
          const p = rt.pts[i];
          if (i) len += Math.hypot(p[0] - rt.pts[i - 1][0], p[1] - rt.pts[i - 1][1], p[2] - rt.pts[i - 1][2]);
          zmin = Math.min(zmin, p[2]); zmax = Math.max(zmax, p[2]);
        }
        const derived = { staticHead_m: +((zmax - zmin) / 1000).toFixed(2), pipeLen_m: +(len / 1000).toFixed(2), pipeDia_mm: routes[0].d, diaNote: '선언 관경(외경 개산 — 내경 입력 시 정밀)' };
        const Q = Number(params.irrigationQ_Lmin);
        const heads = Array.isArray(params.irrigationHeads) ? params.irrigationHeads : null;
        // 헤드 배열이 와도 q_Lmin 이 없으면 ΣQ=0 이라 유량이 없다 — 「입력받았다」가 아니다.
        const headsQ = (heads ?? []).reduce((a, h) => a + (Number(h?.q_Lmin) || 0), 0);
        if (!(Q > 0) && !(headsQ > 0)) {
          irrigation = {
            needInputs: ['irrigationQ_Lmin (또는 irrigationHeads[{q_Lmin,minP_kPa}])'], derived,
            note: '유량·헤드=제품 사양 입력 — 지어내지 않음. 입력 시 pump_head 전양정·수동력 산출.'
              + (heads && !(headsQ > 0) ? ' ⚠ irrigationHeads 는 왔지만 q_Lmin(헤드 유량)이 없어 ΣQ=0 — 유량 미상이다.' : ''),
          };
        } else {
          const r = runCalculator('pump_head', {
            // Q_Lmin 은 heads 가 있으면 계산기가 ΣQ 로 덮어쓴다(위 게이트가 ΣQ>0 을 보장).
            Q_Lmin: Q > 0 ? Q : headsQ, staticHead_m: derived.staticHead_m, pipeDia_mm: derived.pipeDia_mm, pipeLen_m: derived.pipeLen_m,
            ...(heads ? { heads } : {}),
            ...(Number(params.hwC) > 0 ? { hwC: +params.hwC } : {}),
            ...(Number(params.sumK) > 0 ? { sumK: +params.sumK } : {}),
            ...(Number(params.residualHead_m) > 0 ? { residualHead_m: +params.residualHead_m } : {}),
            ...(Number(params.pumpEfficiency) > 0 ? { efficiency: +params.pumpEfficiency } : {}),
          });
          irrigation = { derived, head: r.checks.head, power: r.checks.power, velocity_ms: r.intermediate.velocity_ms, notes: r.notes };
        }
      }
    } catch (e) { irrigation = { error: '관수 체인 실패: ' + (e?.message ?? e) }; }
  }

  /**
   * 형상 자기정합 (260729c) — 조경 8종 중 6종이 「목재 부재 없음」으로 실판정 0 이었다.
   * 목재가 없는 것은 정당하지만, **그 템플릿들이 들고 있는 제원으로 판정 가능한 것**이
   * 있는데 아무것도 보지 않았다. 아래는 전부 순수 기하·산술이라 **가정이 0** 이다.
   */
  const selfChecks = {};
  const pm = assembly?.parkingMeta;
  if (pm && Number(pm.pavementThk) > 0 && pm.layers) {
    const sum = Object.values(pm.layers).reduce((s, v) => s + (Number(v) || 0), 0);
    selfChecks.pavementLayers = {
      labelKo: '포장 층 두께 합 = 선언 포장 두께',
      pass: Math.abs(sum - Number(pm.pavementThk)) < 1e-6,
      detail: [`${Object.entries(pm.layers).map(([k, v]) => `${k} ${v}`).join(' + ')} = ${sum} vs 선언 ${pm.pavementThk}`],
      note: '어긋나면 단면도와 제원표 중 하나가 틀렸다 — 순수 산술, 가정 없음',
    };
    if (Number(pm.curbHeight) > 0) {
      selfChecks.curbVsPavement = {
        labelKo: '연석 높이 > 포장 두께 (연석이 포장 위로 돌출)',
        pass: Number(pm.curbHeight) > Number(pm.pavementThk),
        detail: [`연석 ${pm.curbHeight} vs 포장 ${pm.pavementThk}`],
        note: '연석이 포장보다 낮으면 경계 기능을 못 한다 — 형상이 성립하지 않는다',
      };
    }
  }
  const tm = assembly?.treePlantingMeta;
  if (tm && Number(tm.canopyDia) > 0 && Number(tm.spacingX) > 0) {
    // 수관이 서로 닿으면 생육 불량 — 간격 ≥ 수관경이어야 한다(순수 기하).
    const minSp = Math.min(Number(tm.spacingX), Number(tm.spacingY) || Number(tm.spacingX));
    selfChecks.canopyClearance = {
      labelKo: '식재 간격 ≥ 수관 지름 (수관 간섭)',
      pass: minSp >= Number(tm.canopyDia),
      detail: [`최소 간격 ${minSp} vs 수관경 ${tm.canopyDia} → 여유 ${minSp - Number(tm.canopyDia)}mm`],
      note: '수관이 겹치면 생육 불량·수형 훼손. 성목 수관경 기준이며 식재 시점 기준이 아니다',
    };
    if (Number(tm.rows) > 0 && Number(tm.cols) > 0 && Number(tm.trees) > 0) {
      selfChecks.treeCount = {
        labelKo: '수목 수 = 행 × 열',
        pass: Number(tm.rows) * Number(tm.cols) === Number(tm.trees),
        detail: [`${tm.rows} × ${tm.cols} = ${Number(tm.rows) * Number(tm.cols)} vs 선언 ${tm.trees}`],
      };
    }
  }
  const wm = assembly?.planterWallMeta;
  if (wm && Number(wm.baseWidth) > 0 && Number(wm.stemThk) > 0) {
    selfChecks.planterBase = {
      labelKo: '저판 폭 > 벽체 두께 (저판이 벽을 받친다)',
      pass: Number(wm.baseWidth) > Number(wm.stemThk),
      detail: [`저판 ${wm.baseWidth} vs 벽체 ${wm.stemThk} · 앞굽 ${wm.toeLength ?? '-'}`],
      note: '저판이 벽체보다 좁으면 옹벽 형식이 성립하지 않는다',
    };
    // 배수공은 화단벽의 지배 요소다 — 없으면 배면 수압이 그대로 걸린다.
    selfChecks.planterDrain = {
      labelKo: '배면 배수공 선언',
      pass: Number(wm.drainDia) > 0,
      detail: [Number(wm.drainDia) > 0
        ? `배수공 ⌀${wm.drainDia} 선언됨 — 간격·개소는 선언돼 있지 않아 판정하지 않는다`
        : '배수공이 선언되지 않았다 — 배면 수압이 그대로 걸리면 전도·활동이 크게 불리해진다'],
      note: '⚠ 배수공 유무만 본다. 옹벽 안정(전도·활동·지지력)은 토질 입력이 있어야 하며 여기서 판정하지 않는다',
    };
  }
  return {
    ok: true,
    member, connection, board, wind, irrigation,
    ...(Object.keys(selfChecks).length ? { selfChecks } : {}),
    refs: ['KDS 41 50 10:2022 (허용응력·CD·CM)', 'KDS 41 12 00:2022 표 3.2-1 (활하중)', 'KDS 41 50 30:2022 (접합부 — 못·볼트)'],
    disclaimer: '개념 검토(비법정) — 단순지지·대표부재·강체전도 근사. CM(습윤)·CF·CL 미적용(v1). 실시설계는 구조기술사 검토 필요.' + (unverifiedParts.length ? ` ⚠ 비검증 직접편집 파츠 ${unverifiedParts.length}개는 구조 검토에서 제외됨(P4 라벨) — 해당 형상의 안전은 별도 확인 필요.` : ''),
  };
}

// --- self-test ---
const isMain = process.argv[1] && process.argv[1].replaceAll('\\', '/').endsWith('landscape-check.mjs');
if (isMain) {
  const { buildAssemblyTemplate } = await import('./domain-assemblies.mjs');
  // 데크: 활하중 주거 2.0
  const deck = buildAssemblyTemplate('landscape', 'timber_deck', {});
  const r1 = landscapeCheck(deck, { species: 'pine', grade: 2, usage: 'residence_living' });
  console.log('데크 장선:', r1.member.section, 'L=' + r1.member.spanMm, '@' + r1.member.spacingMm, '| w=' + r1.member.load.total_kNm + 'kN/m →', r1.member.verdict);
  // 파고라: 풍압 0.6 kN/m²
  const per = buildAssemblyTemplate('landscape', 'pergola', {});
  const r2 = landscapeCheck(per, { species: 'larch', grade: 1, windPressure_kNm2: 0.6 });
  console.log('파고라 서까래:', r2.member.section, '→', r2.member.verdict, '| 전도 FS:', r2.wind.FS, '(' + r2.wind.worst + ')', r2.wind.pass ? 'PASS' : 'FAIL — 앵커 ' + r2.wind.anchorUpliftPerPost_kN + 'kN/본');
  // 풍압 미입력 → 정직 생략
  const r3 = landscapeCheck(per, {});
  console.log('풍압 미입력:', r3.wind.skipped ? '생략(정직) ✓' : 'FAIL');
  const pass = r1.ok && r1.member.verdict && r2.ok && Number.isFinite(r2.wind.FS) && r3.wind.skipped;
  console.log(pass ? 'landscape-check self-test: PASS' : 'FAIL');
  if (!pass) process.exit(1);
}

/**
 * 사면녹화 체인 — 사면 안정(slope_bishop 자동탐색) + 식재기반(planting_base 생육토심)
 * 순차 실행 컴포지트. 원칙: 안정 FAIL이면 식재 검토 전에 정직하게 중단 보고(사면 보강 우선).
 */
export function slopeGreenCheck(params = {}) {
  const { H_m, slopeDeg, gamma, c_kPa, phiDeg, fsRequired = 1.5, plantType = '잔디초화류', soilKind = 'natural', soilGrade = 'mid', providedDepth_cm } = params;
  let stability = null;
  try {
    stability = runCalculator('slope_bishop', { geometry: { H: H_m, slopeDeg, gamma, c_kPa, phiDeg }, fsRequired }, 'KDS');
  } catch (e) { return { ok: false, error: '사면 안정: ' + e.message }; }
  const stable = stability.verdict === 'PASS';
  let planting = null;
  if (stable && Number(providedDepth_cm) > 0) {
    try {
      planting = runCalculator('planting_base', { soilCheck: { plantType, soilKind, soilGrade, providedDepth_cm } }, 'KDS');
    } catch (e) { planting = { verdict: 'ERROR', error: e.message }; }
  }
  return {
    ok: true,
    verdict: !stable ? 'FAIL' : planting ? planting.verdict : 'INFO',
    stability: { FS: stability.checks.stability.FS, required: fsRequired, pass: stable, criticalCircle: stability.criticalCircle },
    planting: planting ? { verdict: planting.verdict, soilDepth: planting.checks?.soilDepth ?? null } : { note: '안정 통과 후 providedDepth_cm 입력 시 생육토심 검토' },
    notes: [
      !stable ? '⚠ 사면 안정 미달 — 녹화 전 보강(구배 완화·억지공) 우선. 식재 검토 중단(정직 순서).' : '사면 안정 통과 → 식재기반 검토 연계.',
      '식생 뿌리 보강효과는 정량 미반영(보수 — 연구별 편차 커서 입력 원칙도 곤란 명시). 표층 안정(무한사면 slope_infinite)·침식은 별도.',
    ],
  };
}
