/**
 * shear-wall-check.mjs — 벽식 구조 횡력 검토 (260729).
 *
 * ## 왜 이제야
 * `shear_wall` 계산기(전단벽 횡강성·분담, KDS 14 20 22 §4.9 원문식까지 구현)는
 * **어디서도 호출되지 않았다.** 그러는 사이 building 도메인의 벽식 3종(물탱크·승강로·
 * 박공집)은 라멘 전용 `loadPathCheck` 로 넘어가 "해당 없음"으로 침묵했다.
 * 있는 검사가 노는 동안 적용 대상이 검토를 못 받는 구조였다 — `stairCheck` 와 같은 자리.
 *
 * ## 지어내지 않는 것과 파생하는 것
 *  파생한다(형상에 있다):
 *   · 벽 길이 lw · 두께 t · 높이 h — 부재 치수 그대로
 *   · 방향(X/Y) — 긴 변이 향하는 축. 전단벽은 강축으로만 저항하므로 **방향별로 나눠 본다**
 *   · 총중량 W — structuralCheck 의 실측 질량
 *   · 전체높이 hn — 벽 상단 − 벽 하단
 *  거부한다(형상에서 알 수 없다):
 *   · 반응수정계수 R — 구조시스템이 정한다
 *   · 기본풍속 V0 — 대지 위치가 정한다
 *   둘 다 없으면 층전단력이 없고, 층전단력이 없으면 분담을 계산할 수 없다.
 *
 * ## 밑면전단에 쓰는 근사와 그 정당성
 * seismic_static 은 층별 heightsM·weightsKN 을 받는다. 벽식은 층 구분이 선언돼 있지 않아
 * **전 질량을 전체높이 한 점에 집중**시켜 넣는다. ⚠ 이 근사는 **밑면전단 V 에는 영향이
 * 없다** — V = Cs·W 이고 Cs 는 주기 T(=Ct·hn^x)와 총중량만으로 정해지기 때문이다.
 * 영향을 받는 것은 층별 Fx 분포뿐이라, 그 분포는 **산출하지도 보고하지도 않는다.**
 *
 * ⚠ 비법정 개산. 강막(rigid diaphragm) 가정이고 비틀림·개구부 저감·연결보는 보지 않는다.
 */
import { structuralCheck } from './structural.mjs';
import { placedAabb } from './assembly.mjs';
import { runCalculator } from '../engineering-core/registry.mjs';

/**
 * 부품의 **월드 AABB 중심**(x,y). 강성중심은 부재의 도심으로 재야 하는데 `at.tx/ty` 는
 * 부품 로컬 원점(대개 코너)이다 — 그대로 쓰면 벽 길이의 절반만큼 치우친다.
 * 실측: water_tank 에서 강성중심이 −0.15m 로 나왔다(대칭 구조인데 음수).
 * placedAabb 는 회전(rz 90° 등)까지 반영하므로 회전 부재도 맞는다.
 */
function planCenter(p) {
  try {
    const b = placedAabb(p);
    return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2];
  } catch { return [Number(p.at?.tx ?? 0), Number(p.at?.ty ?? 0)]; }
}

const G = 9.80665;

/** 회전을 반영한 수평 치수. rz 90°/270° 면 width↔depth 가 바뀐다. */
function planDims(p) {
  const w = Number(p.params?.width), d = Number(p.params?.depth);
  if (!(w > 0) || !(d > 0)) return null;
  const rz = ((Number(p.at?.rz ?? 0) % 180) + 180) % 180;
  const swap = Math.abs(rz - 90) < 1;
  return swap ? { dx: d, dy: w } : { dx: w, dy: d };
}

/**
 * ── 연직 스택 병합 (260729, P1-6) ──────────────────────────────────────────────
 * 다층 건물의 벽·기둥은 **층마다 별개 부품**으로 선언된다. 종전 코드는 이걸 몰라서
 * `commercial_massing`(4층) 에서 벽 43장 중 1층분 7장만 횡력저항으로 세고 **36장을
 * "박공 조각"이라며 버렸고**, 전체높이도 1층 높이 4.2m 로 잡았다(실제 15m).
 * 밑면전단 V=Cs·W 의 Cs 는 주기 T=Ct·hn^x 로 정해지므로 **V 자체가 틀렸다.**
 *
 * 같은 평면 위치(tx,ty)에 z 로 이어 선 조각들을 **하나의 캔틸레버 부재**로 묶는다.
 * 연속 판정 = 다음 조각의 밑면이 앞 조각 상단에서 `gapTol` 안에 있을 것(슬래브 두께 여유).
 * 층마다 단면이 다르면(변단면) **최소 길이를 채택**하고 그 사실을 표시한다 — 보수측.
 */
function stackVertical(items, { posTol = 150, gapTol = 500 } = {}) {
  // ⚠ 키는 **평면 중심**이어야 한다. `at.tx/ty`(로컬 원점=대개 코너)로 묶으면 왼쪽 끝이
  //   같기만 하면 붙는다 — 실측: elevator_shaft 에서 문설주(폭 500)와 그 위 상인방
  //   (폭 1900)이 둘 다 tx=200 이라 한 스택이 됐고, 높이가 17.4m 로 이어져 **인방이
  //   캔틸레버 전단벽으로 둔갑**했다(lateral 3→4). 중심으로 묶으면 450 ≠ 1150 이라 갈린다.
  const centers = new Map(items.map((x) => [x, planCenter(x.p)]));
  const key = (x) => {
    const [cx, cy] = centers.get(x);
    return `${Math.round(cx / posTol)}:${Math.round(cy / posTol)}`;
  };
  const groups = new Map();
  for (const x of items) {
    const k = key(x);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(x);
  }
  const out = [];
  for (const g of groups.values()) {
    g.sort((a, b) => Number(a.p.at?.tz ?? 0) - Number(b.p.at?.tz ?? 0));
    let run = [g[0]];
    const flush = () => {
      const base = Number(run[0].p.at?.tz ?? 0);
      const top = Math.max(...run.map((x) => Number(x.p.at?.tz ?? 0) + x.h));
      // 단면은 **최하 조각**(밑면)을 쓴다. 캔틸레버 벽은 밑면에서 전단·모멘트가 최대라
      // 강성도 전단강도 검토도 거기가 지배한다.
      // ⚠ 처음엔 「보수측」이라며 최소 단면을 썼는데, 그건 보수가 아니라 물리 왜곡이었다 —
      //   실측: gable_house 의 측벽(7000mm) 위에 박공 삼각 조각(409mm)이 얹히자 벽 길이가
      //   409mm 로 잡혔다. 강성이 lw³ 이라 **5000배 과소**다. 상부 축소분은 아래에 고지한다.
      const dx = run[0].dims.dx, dy = run[0].dims.dy;
      const minDx = Math.min(...run.map((x) => x.dims.dx));
      const minDy = Math.min(...run.map((x) => x.dims.dy));
      const varying = Math.abs(minDx - dx) > 1 || Math.abs(minDy - dy) > 1;
      const [cx, cy] = planCenter(run[0].p);
      out.push({
        id: run[0].p.id ?? run[0].p.type, parts: run.length,
        baseZ: base, topZ: top, h: top - base,
        storyH: run[0].h,               // 최하층 높이 — 층강성 기준
        dims: { dx, dy }, varying, cx, cy,
        minDims: { dx: minDx, dy: minDy },
      });
    };
    for (let i = 1; i < g.length; i++) {
      const prevTop = Math.max(...run.map((x) => Number(x.p.at?.tz ?? 0) + x.h));
      if (Number(g[i].p.at?.tz ?? 0) - prevTop <= gapTol) run.push(g[i]);
      else { flush(); run = [g[i]]; }
    }
    flush();
  }
  return out;
}

/**
 * 기둥에서 방향별 골조 횡강성(kN/mm)을 낸다. 기둥이 없으면 각 방향 0.
 *
 * ## 강접인가 캔틸레버인가 — 지어내지 않고 형상에서 본다
 * 기둥머리가 보로 구속되면 양단강접 `k = 12EcI/h³`, 아니면 캔틸레버 `k = 3EcI/h³`(4배 차).
 * "보가 있다"를 가정하면 강성을 **4배 부풀린다** — 그러면 골조 분담이 과대해지고
 * 「이중골조 요건 충족」이라는 **비보수적** 결론이 나온다. 그래서 그 방향으로 기둥에
 * 실제로 닿는 보를 찾고, 없으면 캔틸레버로 본다(보수측).
 *
 * ## 벽과 같은 기준으로 잰다
 * 벽은 전체높이 캔틸레버, 기둥은 층 부재라 원래 기준이 다르다(그래서 실무도 벽-골조
 * 상호작용에 정밀해석을 요구한다). 여기서는 **둘 다 최하층 높이 h1 의 요소로** 재서
 * 상대강성만 낸다. 이 선택은 벽을 과대평가하므로 골조 분담이 과소로 나오고,
 * 「이중골조 아님」쪽으로 기운다 — **보수측이라 이쪽을 골랐다.**
 * 절대 변위·층간변위는 이 값으로 낼 수 없다(산출하지 않는다).
 */
function frameStiffness(assembly, h1, params, byDir) {
  const cols = (assembly?.parts ?? []).filter((p) => p.role === 'column' && p.unverified !== true)
    .map((p) => ({ p, h: Number(p.params?.height), dims: planDims(p) }))
    .filter((x) => x.h > 0 && x.dims);
  if (!cols.length) return { X: null, Y: null, columns: 0 };

  const stacks = stackVertical(cols);
  const groundZ = Math.min(...stacks.map((s) => s.baseZ));
  const ground = stacks.filter((s) => s.baseZ <= groundZ + 1e-6); // 1층 기둥만(분담은 밑면 기준)

  const beams = (assembly?.parts ?? []).filter((p) => p.role === 'beam' && p.unverified !== true)
    .map((p) => ({ p, dims: planDims(p) })).filter((x) => x.dims);
  // 기둥 (tx,ty) 에 그 방향으로 뻗은 보가 닿는가 — 보의 직교 좌표가 기둥과 같은 선상인지.
  const framed = (s, dir) => beams.some((b) => {
    const long = b.dims.dx >= b.dims.dy ? 'X' : 'Y';
    if (long !== dir) return false;
    const bx = Number(b.p.at?.tx ?? 0), by = Number(b.p.at?.ty ?? 0);
    const [bcx, bcy] = planCenter(b.p);
    return dir === 'X'
      ? Math.abs(bcy - s.cy) <= 600 && Math.abs(s.cx - bcx) <= b.dims.dx / 2 + 600
      : Math.abs(bcx - s.cx) <= 600 && Math.abs(s.cy - bcy) <= b.dims.dy / 2 + 600;
  });

  const fck = Number(params.fck) > 0 ? Number(params.fck) : 24;
  const Ec = 8500 * Math.cbrt(fck + 4); // MPa = N/mm²
  const out = { columns: ground.length, h1 };
  for (const dir of ['X', 'Y']) {
    let k = 0, fixed = 0;
    const axes = new Set();
    const elements = [];
    for (const s of ground) {
      const { dx, dy } = s.dims;
      // dir 방향 횡력에 대한 단면2차모멘트 = 그 방향 치수를 세제곱
      const I = dir === 'X' ? (dy * dx ** 3) / 12 : (dx * dy ** 3) / 12;
      const isFramed = framed(s, dir);
      if (isFramed) fixed++;
      const ki = ((isFramed ? 12 : 3) * Ec * I) / h1 ** 3; // N/mm
      k += ki;
      elements.push({ k: ki / 1000, cx: s.cx, cy: s.cy });
      // dir 방향 모멘트골조가 성립하려면 **그 방향으로** 기둥이 2본 이상 한 줄에 서서
      // 보로 이어져야 한다. 그러니 세는 것은 dir 축의 좌표 종류다.
      // ⚠ 처음엔 직교축을 셌다 — commercial_massing 에서 Y방향(각 tx마다 1본씩이라
      //   프레임 불성립)을 6열로, X방향(6본 한 줄)을 1열로 뒤집어 읽었다.
      axes.add(Math.round((dir === 'X' ? s.cx : s.cy) / 100));
    }
    out[dir] = {
      k_kNmm: k / 1000, columns: ground.length, framedColumns: fixed, elements,
      // 한 축에만 서 있으면 그 방향으로 **모멘트골조 자체가 성립하지 않는다.**
      // 각 기둥이 독립 캔틸레버(역추형 계열)라 R 이 크게 달라진다 — 사실만 적는다.
      singleLine: axes.size <= 1,
      lines: axes.size,
      wallsInDir: byDir[dir].length,
    };
  }
  return out;
}

/** 벽 1장의 강축 횡강성(kN/mm) — 계산기와 같은 식(휨+전단, 캔틸레버). */
function wallK(lw, t, h, Ec) {
  const I = (t * lw ** 3) / 12, A = t * lw;
  const Gc = Ec / (2 * (1 + 0.17));
  return 1 / (h ** 3 / (3 * Ec * I) + (1.2 * h) / (Gc * A)) / 1000;
}

/**
 * 강성중심(CR) ↔ 질량중심(CM) 편심. 형상에서 결정론으로 나온다.
 *
 * ⚠ **「비틀림 비정형」이라고 단정하지 않는다.** KDS 41 17 00 의 비정형 판정은 우발편심을
 * 포함한 **층간변위비**(최대/평균 ≥1.2)로 하는 것이라 3D 해석이 필요하다. 여기서 낼 수
 * 있는 것은 편심 그 자체뿐이고, 그것만 적는다. 「편심이 크다」와 「비정형이다」는 다른 말이다.
 */
function eccentricity(byDir, frame, mass, assembly) {
  const cm = mass?.cgWorldMm;
  if (!Array.isArray(cm) || !Number.isFinite(cm[0]) || !Number.isFinite(cm[1])) return null;
  const Ec = 8500 * Math.cbrt(28); // fck 24 기준(분담비만 쓰므로 절대값 무관)
  const rows = [];
  for (const dir of ['X', 'Y']) {
    // dir 방향 횡력에 저항하는 요소들의 직교좌표 분포로 CR 을 낸다.
    // ⚠ **기둥도 저항요소다.** 벽만 넣으면 Y방향처럼 벽이 없는 축에서 편심이 통째로
    //   누락되고(조용한 누락), 벽+골조 혼합에서도 CR 이 벽 쪽으로 치우친다.
    const els = [
      ...byDir[dir].map((w) => ({
        k: wallK(w.lw_mm, w.t_mm, w.storyH, Ec),
        c: dir === 'X' ? w.cy : w.cx,
      })),
      ...((frame?.[dir]?.elements ?? []).map((e) => ({ k: e.k, c: dir === 'X' ? e.cy : e.cx }))),
    ];
    if (!els.length) continue;
    const sumK = els.reduce((s, e) => s + e.k, 0);
    if (!(sumK > 0)) continue;
    const cr = els.reduce((s, e) => s + e.k * e.c, 0) / sumK;
    const cmC = dir === 'X' ? cm[1] : cm[0];
    // 건물 폭은 그 방향 직교 치수 — 부품 전체 범위로 잰다.
    // 평면치수 = 그 방향 직교축의 월드 범위(코너 좌표가 아니라 실제 점유 폭).
    let lo = Infinity, hi = -Infinity;
    for (const p of assembly?.parts ?? []) {
      try {
        const b = placedAabb(p); const k = dir === 'X' ? 1 : 0;
        if (b.min[k] < lo) lo = b.min[k];
        if (b.max[k] > hi) hi = b.max[k];
      } catch { /* AABB 실패 부품은 범위에서 뺀다 */ }
    }
    const span = hi > lo ? hi - lo : 0;
    const e = Math.abs(cr - cmC);
    rows.push({ dir, cr, cm: cmC, e, ratio: span > 0 ? e / span : null, span });
  }
  if (!rows.length) return null;
  const worst = rows.reduce((a, b) => ((b.ratio ?? 0) > (a.ratio ?? 0) ? b : a));
  return {
    labelKo: '강성중심 ↔ 질량중심 편심 (비틀림 유발)',
    pass: null, // 비정형 판정은 층간변위비 항목 — 여기서 단정하지 않는다
    detail: [
      ...rows.map((r) => `${r.dir}방향: 강성중심 ${(r.cr / 1000).toFixed(2)}m · 질량중심 ${(r.cm / 1000).toFixed(2)}m`
        + ` → 편심 ${(r.e / 1000).toFixed(2)}m` + (r.ratio != null ? ` (평면치수의 ${(r.ratio * 100).toFixed(0)}%)` : '')),
      (worst.ratio ?? 0) >= 0.15
        ? `⚠ ${worst.dir}방향 편심이 평면치수의 ${(worst.ratio * 100).toFixed(0)}% 다 — 저항요소가 한쪽에 몰려 `
          + '비틀림이 지배할 수 있다. KDS 41 17 00 은 여기에 우발편심 5% 를 **더** 요구한다.'
        : '편심은 평면치수의 15% 미만이다.',
      '비틀림 비정형 판정(최대/평균 층간변위비 ≥1.2)은 3D 해석 항목이라 **산출하지 않았다** — 이상 없다는 뜻이 아니다.',
    ],
  };
}

/**
 * 벽식 횡력 검토. 벽이 없으면 **null**(해당 없음 — 에러가 아니다).
 * @param {object} assembly
 * @param {{seismic?:{R:number,zone?:string,siteClass?:string,importance?:string},wind?:{V0:number,exposure?:string},fck?:number}} params
 */
export function shearWallCheck(assembly, params = {}) {
  const parts = (assembly?.parts ?? []).filter((p) => p.role === 'wall' && p.unverified !== true);
  if (!parts.length) return null; // 벽이 없다 = 이 검토 대상이 아니다

  // 횡력저항 요소 = **가장 높은 벽과 같은 높이로 서는 벽**. 층별 조각벽(박공 삼각·문틀
  // 상부 등)은 전 높이를 관통하지 않으므로 캔틸레버 전단벽으로 세지 않는다.
  // (임의 임계가 아니라 "최대 높이와 같다"는 동치 판정이다)
  const withH = parts.map((p) => ({ p, h: Number(p.params?.height), dims: planDims(p) }))
    .filter((x) => x.h > 0 && x.dims);
  if (!withH.length) {
    return { ok: false, label: '벽식 횡력 검토', needInputs: [{ name: 'wall.params', labelKo: '벽 길이·두께·높이' }] };
  }
  // 층별 조각을 연직으로 병합한 뒤 판정한다(위 stackVertical 주석 참조).
  const stacks = stackVertical(withH);
  const groundZ = Math.min(...stacks.map((s) => s.baseZ));
  // 캔틸레버 전단벽의 요건은 **기초에서 시작해 1층을 온전히 관통**하는 것이다.
  // ⚠ "건물 최상단까지"를 요구하면 안 된다 — 박공·경사지붕 건물에서는 어떤 벽도 최상단에
  //   닿지 않아 **전부 탈락**한다(실측: gable_house 6장 → 0장). 지붕 형상은 벽이
  //   캔틸레버인지와 무관하다.
  const ground = stacks.filter((s) => s.baseZ <= groundZ + 1e-6);
  // 1층 높이 = 기초에서 시작하는 스택의 **첫 조각 높이 최댓값**. 창 아래 허리벽·인방
  // (층높이에 못 미치는 조각)을 이 기준으로 걸러낸다 — 임의 임계가 아니다.
  const h1 = ground.length ? Math.max(...ground.map((s) => s.storyH)) : null;
  const lateral = h1 ? ground.filter((s) => s.h >= h1 - 1e-6) : [];
  const partial = stacks.length - lateral.length;
  // 횡력저항 구조체 상단(파라펫·지붕 등 비구조 제외) — 밑면전단의 주기 T=Ct·hn^x 에 쓴다.
  const maxTop = lateral.length ? Math.max(...lateral.map((s) => s.topZ)) : Math.max(...stacks.map((s) => s.topZ));
  const hnM = maxTop / 1000;
  const multiStory = lateral.some((s) => s.parts > 1);

  // 방향별 분리 — 전단벽은 강축(긴 변)으로만 저항한다.
  const byDir = { X: [], Y: [] };
  for (const s of lateral) {
    const { dx, dy } = s.dims;
    const dir = dx >= dy ? 'X' : 'Y';
    byDir[dir].push({
      id: s.id, lw_mm: Math.max(dx, dy), t_mm: Math.min(dx, dy), h_mm: s.h,
      storyH: s.storyH, cx: s.cx, cy: s.cy, stories: s.parts, varying: s.varying,
    });
  }

  // ── 골조(기둥) 강성 — 벽+골조 혼합구조의 나머지 절반 (260729, P1-6) ───────
  // 종전 코드는 **기둥을 아예 보지 않았다.** 그래서 벽 분담률이 언제나 100% 로 나왔고,
  // `shear_wall` 계산기가 `frameStiffness_kNmm` 를 받아 벽·골조 분담을 낼 수 있는데도
  // 그 입력이 **한 번도 채워지지 않았다** — 있는 기능의 배선이 끊긴 자리(형태 ①).
  const frame = frameStiffness(assembly, h1, params, byDir);

  // ── 층전단력 확보 (없으면 정직 거부) ───────────────────────────────────────
  let mass = null;
  try { mass = structuralCheck(assembly, {}); } catch { /* 질량 실패는 아래에서 거부로 처리 */ }
  const W_kN = mass?.totalMassKg > 0 ? (mass.totalMassKg * G) / 1000 : null;

  const sources = [];
  const sp = params.seismic;
  if (W_kN && sp && Number(sp.R) > 0) {
    try {
      const seis = runCalculator('seismic_static', {
        zone: sp.zone ?? 'I', siteClass: sp.siteClass ?? 'S4', importance: sp.importance ?? 'grade2',
        R: Number(sp.R), structType: sp.structType ?? 'rc_moment',
        ...(Number(sp.S) > 0 ? { S: Number(sp.S) } : {}),
        heightsM: [+hnM.toFixed(2)], weightsKN: [+W_kN.toFixed(1)],
      }, 'KDS');
      sources.push({ kind: '지진(KDS 41 17 00 등가정적)', V_kN: seis.storyShear_kN[0], detail: seis });
    } catch (e) { sources.push({ kind: '지진', error: String(e?.message ?? e).slice(0, 120) }); }
  }
  const wp = params.wind;
  if (wp && Number(wp.V0) > 0) {
    try {
      const xs = lateral.map((x) => Number(x.p.at?.tx ?? 0));
      const ys = lateral.map((x) => Number(x.p.at?.ty ?? 0));
      const B = (Math.max(...xs) - Math.min(...xs)) / 1000 || hnM;
      const D = (Math.max(...ys) - Math.min(...ys)) / 1000 || hnM;
      const r = runCalculator('wind_static', {
        V0: Number(wp.V0), H: +hnM.toFixed(1), B: +Math.max(B, 1).toFixed(1), D: +Math.max(D, 1).toFixed(1),
        exposure: wp.exposure ?? 'C', importance: wp.importance ?? '1', structType: 'rc_moment', demandNone: 0,
      }, 'KDS');
      sources.push({ kind: '풍(KDS 41 12 00)', V_kN: r.baseShear_kN, detail: r });
    } catch (e) { sources.push({ kind: '풍', error: String(e?.message ?? e).slice(0, 120) }); }
  }

  const usable = sources.filter((s) => Number(s.V_kN) > 0);
  if (!usable.length) {
    return {
      ok: false, label: '벽식 횡력 검토 (전단벽 강성·분담)',
      needInputs: [
        { name: 'seismic.R', labelKo: '반응수정계수 R (1~8) — 구조시스템이 정하는 값이라 형상에서 알 수 없다' },
        { name: 'wind.V0', labelKo: '기본풍속 V0 (m/s) — 대지 위치가 정하는 값이라 형상에서 알 수 없다' },
      ],
      messageKo: `전단벽 ${lateral.length}장(X ${byDir.X.length}·Y ${byDir.Y.length})을 형상에서 찾았고 총중량 `
        + `${W_kN ? W_kN.toFixed(0) + 'kN' : '미산출'}·전체높이 ${hnM.toFixed(1)}m 도 산출했습니다. `
        + '다만 층전단력이 없으면 분담을 계산할 수 없습니다 — R 또는 V0 중 하나만 주면 검토가 돕니다. '
        + '**"횡력에 안전하다"는 뜻이 아닙니다.**',
      ...(sources.length ? { attempted: sources.map((s) => `${s.kind}: ${s.error ?? '산출 실패'}`) } : {}),
    };
  }
  // 지진·풍 둘 다 있으면 **큰 쪽이 지배**한다(둘 다 보고한다 — 감추지 않는다).
  const governing = usable.reduce((a, b) => (b.V_kN > a.V_kN ? b : a));

  const checks = {};
  for (const dir of ['X', 'Y']) {
    const walls = byDir[dir];
    const fr = frame[dir];
    if (!walls.length) {
      // 벽이 없다고 「판정 불가」가 아니다 — 골조가 있으면 **골조 단독**이라는 판정이다.
      checks[`dir${dir}`] = fr && fr.k_kNmm > 0
        ? {
          labelKo: `${dir}방향 — 전단벽 없음, 골조 단독`, pass: null,
          detail: [
            `${dir}방향으로 선 전단벽이 없다. 기둥 ${fr.columns}본(강접 ${fr.framedColumns}본)이 `
            + `횡력 ${governing.V_kN.toFixed(1)}kN 전량을 부담한다 — 골조 강성 ${fr.k_kNmm.toFixed(1)}kN/mm.`,
            ...(fr.singleLine ? [`⚠ 기둥이 **한 축(${fr.lines}열)** 에만 서 있다 — 이 방향으로 모멘트골조가 `
              + '성립하지 않고 각 기둥이 독립 캔틸레버(역추형 계열)가 된다. 반응수정계수 R 을 '
              + '모멘트골조 값으로 쓰면 안 된다(KDS 41 17 00 구조시스템 분류 재확인 필요).'] : []),
            '기둥 단면 전단·휨 검토는 rc_column_pm 영역이라 여기서 판정하지 않는다.',
          ],
        }
        : {
          labelKo: `${dir}방향 전단벽`, pass: null,
          detail: [`${dir}방향으로 선 전단벽도 기둥도 없다 — 이 방향 횡력저항 요소를 확인해야 한다(판정하지 않음)`],
        };
      continue;
    }
    try {
      const r = runCalculator('shear_wall', {
        // ⚠ h_mm 은 **최하층 높이 h1** 이다 — 벽·기둥을 같은 기준으로 재야 상대강성이
        //   의미를 갖는다(frameStiffness 주석의 보수측 선택). 벽 전체높이는 basis 에 따로 낸다.
        walls: walls.slice(0, 20).map((w) => ({ lw_mm: w.lw_mm, t_mm: w.t_mm, h_mm: h1 })),
        storyShear_kN: +governing.V_kN.toFixed(1),
        ...(fr && fr.k_kNmm > 0 ? { frameStiffness_kNmm: +fr.k_kNmm.toFixed(4) } : {}),
        ...(Number(params.fck) > 0 ? { fck: Number(params.fck) } : {}),
      }, 'KDS');
      const rows = r.walls ?? r.rows ?? [];
      const bad = rows.filter((x) => x.pass === false);
      // 초과 부재를 맨 앞에, 그다음 분담 내림차순 — 잘려도 중요한 것이 남는다.
      const ranked = rows.map((x, i) => ({ ...x, id: walls[i]?.id ?? `#${i + 1}` }))
        .sort((a, b) => (Number(a.pass === false) - Number(b.pass === false)) * -1 || b.share - a.share);
      const wallShare = rows.reduce((s, x) => s + (Number(x.share) || 0), 0);
      const frameShare = Math.max(0, 1 - wallShare);
      checks[`dir${dir}`] = {
        labelKo: `${dir}방향 전단벽 ${walls.length}장${fr && fr.k_kNmm > 0 ? ` + 기둥 ${fr.columns}본` : ''} — 강성 분담·개략 전단`,
        pass: bad.length === 0,
        detail: [
          // ⚠ **분담 큰 순**으로 자른다. 선언 순서대로 6개만 보이면 지배 부재가 잘려나간다 —
          //   실측: commercial_massing 에서 분담 0.0% 인 필라스터 6개만 나오고 99% 를 먹는
          //   wall_back 이 7번째라 사라졌다. 잘린 개수도 밝힌다(조용한 절단 금지).
          ...ranked.slice(0, 6).map((x) => `${x.id}: 분담 ${(x.share * 100).toFixed(1)}% · Vi ${x.Vi_kN}kN vs φVc ${x.phiVc_kN}kN (ratio ${x.ratio})${x.pass === false ? ' ← **초과**' : ''}`),
          ...(ranked.length > 6 ? [`… 분담 하위 ${ranked.length - 6}장 생략(전부 표시된 6장보다 분담이 작다${bad.length ? `, 초과 부재 ${bad.length}장은 위에 우선 표시` : ''})`] : []),
          ...(fr && fr.k_kNmm > 0 ? [`골조(기둥 ${fr.columns}본, 강접 ${fr.framedColumns}본): 분담 ${(frameShare * 100).toFixed(1)}% · ${(governing.V_kN * frameShare).toFixed(1)}kN`] : []),
        ],
        ...(fr && fr.k_kNmm > 0 ? { frameShare: +frameShare.toFixed(4) } : {}),
        note: `층전단 ${governing.V_kN.toFixed(1)}kN(${governing.kind} 지배) · 강막 가정 · 비틀림·개구부 저감 미고려`,
      };
      // ── KDS 41 17 00 이중골조 요건 — 모멘트골조가 설계지진력의 25% 이상 ──────
      // 이건 우리가 정한 임계가 아니라 **기준서가 정한 시스템 분류 조건**이다.
      // 미달이면 벽식으로 분류해야 하고 R 이 달라져 설계지진력 자체가 바뀐다.
      if (fr && fr.k_kNmm > 0) {
        const meets = frameShare >= 0.25;
        checks[`dual${dir}`] = {
          labelKo: `${dir}방향 구조시스템 분류 — 이중골조 요건(골조 ≥25%)`,
          pass: meets,
          detail: [
            `골조 분담 ${(frameShare * 100).toFixed(1)}% — 이중골조 요건 25% ${meets ? '충족' : '**미달**'}`,
            meets
              ? '이중골조로 분류 가능(KDS 41 17 00 구조시스템). 최종 분류는 정밀해석 결과로 확정할 것.'
              : `벽이 횡력을 사실상 전담한다 → **이중골조가 아니라 전단벽 시스템으로 분류**해야 하고, `
                + `입력한 R=${params.seismic?.R ?? '?'} 이 모멘트골조/이중골조 값이면 설계지진력이 과소평가된다.`,
            ...(fr.singleLine ? [`⚠ ${dir}방향 기둥이 한 열뿐이라 모멘트골조가 성립하지 않는다 — 25% 를 넘더라도 이중골조로 볼 수 없다.`] : []),
          ],
        };
      }
    } catch (e) {
      checks[`dir${dir}`] = { labelKo: `${dir}방향 전단벽`, pass: null, detail: [`계산 실패: ${String(e?.message ?? e).slice(0, 100)}`] };
    }
  }

  // ── 강성중심 vs 질량중심 (비틀림) ─────────────────────────────────────────
  // X방향 횡력의 비틀림은 저항요소의 **y 분포**가 정한다(반대도 마찬가지).
  // 편심 자체는 형상에서 결정론으로 나온다. 다만 「비틀림 비정형」은 KDS 상 층간변위비로
  // 판정하는 항목이라 **단정하지 않고 사실만** 보고한다(확인 못 함 ≠ 이상 없음).
  const torsion = eccentricity(byDir, frame, mass, assembly);
  if (torsion) checks.torsion = torsion;
  if (partial) {
    checks.partialWalls = {
      labelKo: '기초~최상단 미관통 벽', pass: null,
      detail: [`${partial}개 스택은 기초(z=${Math.round(groundZ)}mm)에서 시작해 1층(높이 ${Math.round(h1)}mm)을 `
        + '관통하지 않아 캔틸레버 전단벽으로 세지 않았다 — 박공 삼각·개구부 상부 인방·창 아래 허리벽 등. '
        + '이들의 횡력 기여는 판정하지 않는다'],
    };
  }
  const varying = lateral.filter((s) => s.varying).length;
  if (varying) {
    checks.varyingWalls = {
      labelKo: '층마다 단면이 다른 벽', pass: null,
      detail: [`${varying}개 스택은 상부로 갈수록 단면이 줄어든다(박공 삼각·세트백 등). `
        + `강성·전단은 전단·모멘트가 최대인 **밑면 단면**으로 검토했다 — 상부 축소 구간의 `
        + `전단은 검토하지 않았다(단면이 줄면 그 높이에서 별도로 확인해야 한다).`],
    };
  }
  return {
    ok: true,
    label: '벽식 횡력 검토 (전단벽 강성·분담)',
    checks,
    basis: {
      lateralWalls: lateral.length, dirX: byDir.X.length, dirY: byDir.Y.length,
      wallParts: withH.length, stacks: stacks.length, multiStory,
      frameColumns: frame.columns ?? 0,
      frameK_kNmm: { X: frame.X ? +frame.X.k_kNmm.toFixed(3) : 0, Y: frame.Y ? +frame.Y.k_kNmm.toFixed(3) : 0 },
      totalWeight_kN: W_kN ? +W_kN.toFixed(1) : null, hn_m: +hnM.toFixed(2), storyH1_mm: h1,
      storyShear_kN: +governing.V_kN.toFixed(1), governing: governing.kind,
      all: usable.map((s) => `${s.kind} ${s.V_kN.toFixed(1)}kN`),
      note: '밑면전단 V=Cs·W 는 총중량·전체높이로 정해지므로 질량 집중 근사가 V 에 영향을 주지 않는다(층별 Fx 분포는 산출하지 않음).'
        + (multiStory ? ` · 층별 벽 조각 ${withH.length}개를 연직 스택 ${stacks.length}개로 병합해 전체높이 ${hnM.toFixed(1)}m 를 얻었다.` : '')
        + ' · 벽·골조 상대강성은 최하층 높이 ' + h1 + 'mm 기준(벽 과대→골조 분담 과소=보수측). 절대 변위·층간변위는 산출하지 않는다.',
    },
  };
}
