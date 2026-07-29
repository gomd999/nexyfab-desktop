/**
 * interior-check.mjs — 인테리어 피난·마감 체인 (Wave A · 인테리어 I2+I3).
 *
 * role 태깅 실내 어셈블리(cafe_room 등)에서:
 *   ① 보행거리 실측 — 100mm 격자 BFS: 장애물(테이블·카운터·벽 풋프린트) 우회한
 *      실 내 최원점 → 출입구 최단 보행거리. 한계는 입력(기본 30m — 건축법 시행령
 *      제34조 직통계단 보행거리 참고 표기; 용도·내화에 따라 다름 → 프로젝트 확인).
 *   ② 수용인원·피난폭 — occupancy_egress 계산기: 바닥면적·좌석(형상/메타 파생)
 *      + 문 폭 합(형상 파생 = exits 메타) → 재실자·요구폭 대조.
 *   ③ 마감 물량 — 바닥(순)·벽(실내측 1면, 개구 공제)·천장 면적. 결정론.
 *
 * 원칙: 경로·면적 = 형상 결정론. 법규 한계값 = 입력(출처 병기, 지어내지 않음).
 */
import { runCalculator } from '../engineering-core/registry.mjs';
import { partAabb } from './reconstruct.mjs';
import { buildAssembly } from './assembly.mjs';

const round = (v, n = 2) => +Number(v).toFixed(n);

function footprint(part) {
  const a = partAabb({ type: part.type, ...part.params });
  const { tx = 0, ty = 0, tz = 0, rz = 0 } = part.at ?? {};
  // rz 90° 회전(벽체 배치용)만 지원 — placedAabb와 동일 사상(코너 회전)
  if (rz === 90) {
    return { x0: tx - a.max[1], x1: tx - a.min[1], y0: ty + a.min[0], y1: ty + a.max[0], z0: a.min[2] + tz, z1: a.max[2] + tz };
  }
  return { x0: a.min[0] + tx, x1: a.max[0] + tx, y0: a.min[1] + ty, y1: a.max[1] + ty, z0: a.min[2] + tz, z1: a.max[2] + tz };
}

/**
 * @param assembly cafe_room형 (roomBounds{W,D}·exits[{x,y,widthMm}]·furniture 메타)
 * @param params { travelLimitMm=30000, occupantDensityM2=1.4, cell=100 }
 */
export function interiorCheck(assembly, params = {}) {
  const allParts = assembly?.parts ?? [];
  const unverifiedParts = allParts.filter((p) => p.unverified === true);
  const parts = allParts.filter((p) => p.unverified !== true);
  const rb = assembly?.roomBounds;
  const exits = assembly?.exits ?? [];
  if (!rb?.W || !rb?.D) return { ok: false, error: 'roomBounds{W,D} 메타 필요 (cafe_room형 어셈블리)' };
  if (!exits.length) return { ok: false, error: 'exits[] 메타 필요 — 출입구 없는 실은 피난 검토 불가(정직 거부)' };

  const cell = Math.max(50, Number(params.cell) || 100);
  const nx = Math.ceil(rb.W / cell), ny = Math.ceil(rb.D / cell);

  // ── 장애물 격자 (보행 차단: 테이블·카운터·벽 — z 1800 이하에 존재하는 풋프린트) ──
  const blocked = new Uint8Array(nx * ny);
  const obstacles = parts.filter((p) => ['table', 'counter', 'wall'].includes(p.role) && footprint(p).z0 < 1800);
  const blockRect = (f) => {
    const i0 = Math.max(0, Math.floor(f.x0 / cell)), i1 = Math.min(nx - 1, Math.floor((f.x1 - 1) / cell));
    const j0 = Math.max(0, Math.floor(f.y0 / cell)), j1 = Math.min(ny - 1, Math.floor((f.y1 - 1) / cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) blocked[j * nx + i] = 1;
  };
  for (const ob of obstacles) {
    const f = footprint(ob);
    // 다실 지원: 벽 개구(문 — sill<300·h≥1800)는 통행 가능 → 벽을 개구 사이 세그먼트로 분할 차단
    const doors = ob.type === 'wall_with_openings'
      ? (ob.params?.openings ?? []).filter((o) => (o.sill ?? 0) < 300 && o.h >= 1800).sort((a, b) => a.x - b.x)
      : [];
    if (!doors.length) { blockRect(f); continue; }
    const rz90 = (ob.at?.rz ?? 0) === 90;
    const len = ob.params.length;
    let cur = 0;
    const segs = [];
    for (const d of doors) { if (d.x > cur) segs.push([cur, d.x]); cur = d.x + d.w; }
    if (cur < len) segs.push([cur, len]);
    for (const [s0, s1] of segs) {
      // 로컬 길이축 구간 → 월드 (footprint 사상과 동일 규약)
      if (!rz90) blockRect({ x0: (ob.at?.tx ?? 0) + s0, x1: (ob.at?.tx ?? 0) + s1, y0: f.y0, y1: f.y1, z0: f.z0 });
      else blockRect({ x0: f.x0, x1: f.x1, y0: (ob.at?.ty ?? 0) + s0, y1: (ob.at?.ty ?? 0) + s1, z0: f.z0 });
    }
  }

  // ── 다중 소스 BFS (출입구 → 전체 도달거리) ─────────────────────────────────
  const dist = new Float32Array(nx * ny).fill(-1);
  const qx = new Int32Array(nx * ny), qy = new Int32Array(nx * ny);
  let qh = 0, qt = 0;
  for (const ex of exits) {
    const halfW = (ex.widthMm ?? 900) / 2;
    for (let x = ex.x - halfW; x <= ex.x + halfW; x += cell) {
      const i = Math.min(nx - 1, Math.max(0, Math.floor(x / cell)));
      const j = Math.min(ny - 1, Math.max(0, Math.floor((ex.y ?? 0) / cell)));
      const idx = j * nx + i;
      if (!blocked[idx] && dist[idx] < 0) { dist[idx] = 0; qx[qt] = i; qy[qt] = j; qt++; }
    }
  }
  if (qt === 0) return { ok: false, error: '출입구 셀이 장애물에 막힘 — 문 위치 확인' };
  // 8방향 다익스트라(옥타일 — 대각 √2·모서리 통과 금지). 4방향 맨해튼 대비 실보행에 근접(보완 #6).
  const D8 = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  // 이진 힙 (min-heap by dist)
  const heap = new Int32Array(nx * ny * 2); // 여유 크기
  let hn = 0;
  const push = (idx) => {
    let i = hn++; heap[i] = idx;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (dist[heap[p]] <= dist[heap[i]]) break;
      const t = heap[p]; heap[p] = heap[i]; heap[i] = t; i = p;
    }
  };
  const pop = () => {
    const top = heap[0]; heap[0] = heap[--hn];
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      if (l < hn && dist[heap[l]] < dist[heap[m]]) m = l;
      if (r < hn && dist[heap[r]] < dist[heap[m]]) m = r;
      if (m === i) break;
      const t = heap[m]; heap[m] = heap[i]; heap[i] = t; i = m;
    }
    return top;
  };
  for (let k = 0; k < qt; k++) push(qy[k] * nx + qx[k]);
  const done = new Uint8Array(nx * ny);
  while (hn > 0) {
    const cur = pop();
    if (done[cur]) continue;
    done[cur] = 1;
    const ci = cur % nx, cj = (cur / nx) | 0;
    const cd = dist[cur];
    for (const [dx, dy, cost] of D8) {
      const i = ci + dx, j = cj + dy;
      if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
      const idx = j * nx + i;
      if (blocked[idx] || done[idx]) continue;
      // 대각 이동은 양측 직교 셀이 모두 열려 있어야 (모서리 스침 금지)
      if (dx !== 0 && dy !== 0 && (blocked[cj * nx + i] || blocked[j * nx + ci])) continue;
      const nd = cd + cost * cell;
      if (dist[idx] < 0 || nd < dist[idx]) { dist[idx] = nd; push(idx); }
    }
  }
  // 최원점(도달 가능한 셀 중 최대) + 미도달 셀
  let maxDist = 0, maxAt = null, unreachable = 0, walkable = 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const idx = j * nx + i;
    if (blocked[idx]) continue;
    walkable++;
    if (dist[idx] < 0) { unreachable++; continue; }
    if (dist[idx] > maxDist) { maxDist = dist[idx]; maxAt = [i * cell + cell / 2, j * cell + cell / 2]; }
  }
  const limit = Number(params.travelLimitMm) || 30000;
  // 히트맵 오버레이용 격자 (옵션 — B 인테리어 UX): dist(m, -1=미도달)·blocked를 정수 dm로 압축
  const grid = params.returnGrid === true ? {
    nx, ny, cellMm: cell,
    // dist: 0.1m 단위 정수 배열(전송량 절감·결정론), blocked: 0/1
    dist_dm: Array.from(dist, (v) => v < 0 ? -1 : Math.round(v / 100)),
    blocked: Array.from(blocked),
  } : undefined;
  const travel = {
    maxTravelM: round(maxDist / 1000), farthestPointMm: maxAt, limitM: limit / 1000,
    pass: maxDist <= limit,
    ...(grid ? { grid } : {}),
    unreachableCells: unreachable, unreachableM2: round((unreachable * cell * cell) / 1e6),
    limitNote: '한계 30m = 건축법 시행령 제34조(직통계단 보행거리) 참고 기본값 — 용도·내화구조·스프링클러에 따라 상이, 프로젝트 기준 확인 필요(입력 가능)',
    method: `${cell}mm 격자 8방향 다익스트라(대각 √2·모서리 스침 금지) · 장애물=테이블·카운터·벽 풋프린트(z<1.8m)`,
  };

  // ── 수용인원·피난폭 (occupancy_egress — 문 폭 합=형상 파생) ─────────────────
  const doorWidthSum = exits.reduce((s, e) => s + (e.widthMm ?? 0), 0);
  // 좌석 수 = 각 가구 행의 좌석수 × 유닛 수(seats 필드=유닛 1개당 좌석수). seats 미기재 행은 좌석 아님(0).
  const seatCount = Array.isArray(assembly.furniture) ? assembly.furniture.reduce((s, f) => s + (f.seats > 0 ? f.seats * (Number(f.count) || 0) : 0), 0) : 0;
  const floorAreaM2 = assembly.floorAreaM2 ?? round((rb.W * rb.D) / 1e6);
  // ⚠ 260729: 종전엔 밀도 미지정 시 **1.4 ㎡/인 을 조용히 썼다.** 그건 중립값이 아니라
  // **집회좌석 밀도**다. 그 결과 72㎡ 주거 2실이 재실자 52명으로 계산돼 "출구 2개소 필요"
  // FAIL 이 났고(실제 주거 밀도면 4명 남짓), 반대로 통과한 것들도 근거 없는 통과였다.
  // 용도는 어느 인테리어 템플릿에도 선언돼 있지 않다(kind:'assembly' 는 어셈블리 종류
  // 표시일 뿐 용도가 아니다 — 붙박이장·천장그리드에도 붙어 있다).
  //
  // 재실밀도는 **용도가 정하는 값**이라 형상에서 알 수 없다. 지어내지 않는다.
  //  · 밀도가 선언되면 종전대로 재실자 기반 판정(피난폭·출구 수)을 한다.
  //  · 선언이 없으면 그 판정을 **하지 않고** 무엇이 필요한지 지목한다. 형상에서 나오는
  //    사실(면적·좌석·문 폭 합·출구 수)은 그대로 보고한다 — 좌석 수는 재실자의
  //    **하한**이지 재실자 수가 아니다.
  const density = Number(params.occupantDensityM2);
  let egress = null;
  let egressUnavailable = null;
  if (density > 0) {
    try {
      egress = runCalculator('occupancy_egress', {
        floorAreaM2, seatCount, occupantDensityM2: density,
        egressWidthProvidedMm: doorWidthSum,
        exitCount: exits.length,
        doorClearWidthMm: Math.min(...exits.map((e) => e.widthMm ?? 900)),
      }, 'KDS');
    } catch (e) {
      egress = { verdict: e.code === 'INPUT_GATE' ? 'INPUT' : 'ERROR', error: e.message };
    }
  } else {
    egressUnavailable = {
      ran: false,
      needInputs: [
        { name: 'occupantDensityM2', labelKo: '인당 점유면적 ㎡/인 — 용도가 정한다(집회밀집 0.5·집회좌석 1.4·판매 3.0·업무 10·주거는 훨씬 큼)' },
      ],
      derived: { floorAreaM2, seatCountLowerBound: seatCount, doorWidthSumMm: doorWidthSum, exitCount: exits.length },
      messageKo: `수용인원·피난폭 미검토 — 바닥면적 ${floorAreaM2}㎡·좌석 ${seatCount}석(재실자 하한)·`
        + `출구 ${exits.length}개소·문 폭 합 ${doorWidthSum}mm 는 형상에서 산출했습니다. `
        + '재실밀도는 **용도가 정하는 값**이라 형상에서 알 수 없어 산정하지 않았습니다 — '
        + 'occupantDensityM2 를 주면 재실자·요구 피난폭·출구 수를 검토합니다. '
        + '**"피난이 충분하다"는 뜻이 아닙니다.**',
    };
  }

  // ── 마감 물량 (결정론 — 개구 공제) ─────────────────────────────────────────
  const walls = parts.filter((p) => p.type === 'wall_with_openings');
  const wallNet = walls.reduce((s, w) => {
    const pp = w.params;
    return s + (pp.length * pp.height - (pp.openings ?? []).reduce((o, x) => o + x.w * x.h, 0));
  }, 0);
  // 걸레받이·몰딩 연장 = 둘레 − 문 폭(sill<300 통행 개구만 공제 — 창은 미공제)
  const perimM = (2 * (rb.W + rb.D)) / 1000;
  const doorWidthM = parts.filter((p) => p.type === 'wall_with_openings').reduce((s, p) => {
    const ops = Array.isArray(p.params?.openings) ? p.params.openings : [];
    return s + ops.filter((o) => (o.sill ?? 0) < 300).reduce((a, o) => a + (o.w ?? 0), 0);
  }, 0) / 1000;
  const loss = Number(params.finishLossFactor) > 0 ? Math.min(1.3, Math.max(1.0, Number(params.finishLossFactor))) : 1.1; // 할증 기본 10% 관례(명시)
  const finishes = {
    floorM2: round((rb.W * rb.D) / 1e6),
    wallM2: round(wallNet / 1e6),
    ceilingM2: round((rb.W * rb.D) / 1e6),
    baseboardM: round(Math.max(0, perimM - doorWidthM)),
    crownMoldingM: round(perimM),
    lossFactor: loss,
    withLoss: {
      floorM2: round(((rb.W * rb.D) / 1e6) * loss),
      wallM2: round((wallNet / 1e6) * loss),
      ceilingM2: round(((rb.W * rb.D) / 1e6) * loss),
    },
    ...(Number(params.wallpaperRollM2) > 0 ? { wallpaperRolls: Math.ceil(((wallNet / 1e6) * loss) / Number(params.wallpaperRollM2)) } : {}),
    ...(Number(params.tileM2PerBox) > 0 ? { floorTileBoxes: Math.ceil((((rb.W * rb.D) / 1e6) * loss) / Number(params.tileM2PerBox)) } : {}),
    note: '벽=실내측 1면·개구 공제 / 걸레받이=둘레−문폭·몰딩=둘레(개산). 할증 ' + loss + '(기본 10% 관례 — 입력 가능). 롤/박스 환산=제품 규격 입력 시. 단가 미산출(날조 방지).',
  };

  // ── 설비 개산 (조명·환기·전기) — 형상 파생 + 명시 입력, 기준값 날조 금지 ────
  const areaM2 = (rb.W * rb.D) / 1e6;
  const wallH = Math.max(...parts.filter((p) => p.type === 'wall_with_openings').map((p) => p.params.height ?? 0), 0);
  const ceilH_m = (params.ceilingHmm ?? wallH ?? 2600) / 1000;

  // 조명 — 광속법(lumen method). 실지수 RI = W·D/(Hm(W+D))는 형상 파생.
  // E(목표조도)·F(램프광속)는 필수 입력(KS A 3011·제품사양 — 지어내지 않음).
  // UF(이용률)·MF(보수율)는 관례 기본값 명시(제조사 배광표 확인 권고).
  let lighting = null;
  {
    const E = Number(params.targetLux) || 0;
    const F = Number(params.lampLumen) || 0;
    const workH = params.workPlaneM ?? 0.85; // 작업면 높이 관례 0.85m
    const Hm = Math.max(0.3, ceilH_m - workH);
    const RI = (rb.W / 1000) * (rb.D / 1000) / (Hm * (rb.W / 1000 + rb.D / 1000));
    if (E > 0 && F > 0) {
      const UF = params.utilFactor ?? 0.5;
      const MF = params.maintFactor ?? 0.8;
      const N = Math.ceil((E * areaM2) / (F * UF * MF));
      // 격자 배치: 실 비율에 맞춰 rows×cols (형상 파생)
      const cols = Math.max(1, Math.round(Math.sqrt(N * (rb.W / rb.D))));
      const rows = Math.max(1, Math.ceil(N / cols));
      lighting = {
        verdict: 'INFO', targetLux: E, lampLumen: F, roomIndex: round(RI),
        UF, MF, mountingH_m: round(Hm), fixtures: N, layout: `${cols}×${rows}`,
        avgLuxProvided: round((rows * cols * F * UF * MF) / areaM2, 0),
        note: `광속법 N=E·A/(F·UF·MF). 목표조도는 KS A 3011(용도별 조도기준)·램프광속은 제품사양 참조 — 입력값. UF ${UF}·MF ${MF}=개산 관례(제조사 이용률표 확인 필요).`,
      };
    } else {
      lighting = {
        verdict: 'INPUT', roomIndex: round(RI), mountingH_m: round(Hm),
        // ⚠ 260729d: needInputs 를 구조화했다. 종전엔 필드명이 `note` 문자열에만 있어
        //   렌더러가 「입력 대기」만 찍고 **무엇을 달라는지 이름으로 보여주지 못했다.**
        needInputs: [
          { name: 'targetLux', labelKo: '설계 조도(lx) — 용도가 정한다(KS A 3011). 형상에서 알 수 없다' },
          { name: 'lampLumen', labelKo: '기구 광속(lm) — 제품 사양' },
        ],
        note: `targetLux(KS A 3011 용도별)·lampLumen(제품사양) 입력 시 광속법 등수·배치 산출. 실지수 ${round(RI)}=형상 파생.`,
      };
    }
  }

  // 환기 — 필요환기량 = 재실인원(피난 산정 재사용) × 인당 환기량(법정 기준 용도별 — 입력).
  let ventilation = null;
  {
    const occ = egress?.intermediate?.occupants_design ?? null;
    const q = Number(params.ventPerPersonCMH) || 0;
    const vol = areaM2 * ceilH_m;
    if (occ && q > 0) {
      const Q = occ * q;
      ventilation = {
        verdict: 'INFO', occupants: occ, perPersonCMH: q, requiredCMH: round(Q, 0),
        roomVolM3: round(vol), ACH: round(Q / vol),
        note: '필요환기량=재실인원×인당환기량. 인당환기량은 실내공기질관리법·건축법 용도별 기준 확인 입력(예시값 미제공 — 날조 방지). ACH=참고.',
      };
    } else {
      ventilation = {
        verdict: 'INPUT', occupants: occ, roomVolM3: round(vol),
        needInputs: [{ name: 'ventPerPersonCMH', labelKo: '인당 환기량(㎥/h) — 용도별 법정 기준이 정한다' }],
        note: 'ventPerPersonCMH(용도별 법정 기준) 입력 시 필요환기량·ACH 산출. 재실인원은 피난 산정 재사용.',
      };
    }
  }

  // 전기 — 회로수 개산: 부하밀도(설계값 입력) × 면적 → 분기회로수.
  let electrical = null;
  {
    const density = Number(params.loadDensityVAm2) || 0;
    if (density > 0) {
      const totalVA = density * areaM2;
      const volt = params.circuitVolt ?? 220, amp = params.breakerA ?? 16, lf = params.circuitLoadFactor ?? 0.8;
      const perCircuit = volt * amp * lf;
      electrical = {
        verdict: 'INFO', loadDensityVAm2: density, totalVA: round(totalVA, 0),
        circuitVA: round(perCircuit, 0), circuits: Math.ceil(totalVA / perCircuit),
        basis: `${volt}V×${amp}A×${lf}(여유율) — 분기회로 용량 가정 명시`,
        note: '조명·콘센트 부하 개산(동력·주방기기 별도). 부하밀도는 KDS 31/내선규정 용도별 설계값 입력.',
      };
    } else {
      electrical = {
        verdict: 'INPUT',
        needInputs: [{ name: 'loadDensityVAm2', labelKo: '설계 부하밀도(VA/㎡) — 용도가 정한다' }],
        note: 'loadDensityVAm2(용도별 설계 부하밀도) 입력 시 총부하·분기회로수 개산.',
      };
    }
  }

  // 급수·오수 개산 — 재실인원(피난 산정 재사용) × 인당 급수원단위(용도별 기준 — 입력).
  let water = null;
  {
    const occ2 = egress?.intermediate?.occupants_design ?? null;
    const unit = Number(params.waterPerPersonLpd) || 0; // L/인·일
    if (occ2 && unit > 0) {
      const daily = occ2 * unit;
      const peak = params.peakFactor ?? 2.0; // 시간최대 배율 관례(명시)
      const hourlyAvg = daily / (params.useHours ?? 10);
      water = {
        verdict: 'INFO', occupants: occ2, unitLpd: unit,
        daily_L: round(daily, 0), hourlyPeak_Lh: round(hourlyAvg * peak, 0),
        sewage_L: round(daily * (params.sewageRatio ?? 0.9), 0),
        note: `급수 ${occ2}인×${unit}L/일 (원단위=건축기계설비 설계기준 용도별 값 참조 입력) · 시간최대=평균×${peak}(관례 명시) · 오수=급수×${params.sewageRatio ?? 0.9}. 기구별 배관 구경은 기구단위법 별도.`,
      };
    } else {
      water = {
        verdict: 'INPUT', occupants: occ2,
        needInputs: [{ name: 'waterPerPersonLpd', labelKo: '급수원단위(L/인·일) — 용도가 정한다(건축기계설비 기준)' }],
        note: 'waterPerPersonLpd(용도별 급수원단위 L/인·일 — 건축기계설비 기준 참조) 입력 시 일급수량·시간최대·오수량 개산.',
      };
    }
  }

  // 소방 개산 — 소화기(면적/기준면적) + 스프링클러 헤드 배치(수평거리 r → 정방형 격자, 형상 파생).
  let fire = null;
  {
    const extArea = Number(params.extinguisherAreaM2) || 0; // 능력단위 1당 바닥면적 (소방시설법 별표4 용도·내화 조건 — 입력)
    const r = Number(params.sprinklerRadiusM) || 0;         // 헤드 수평거리 (NFTC 103 — 용도별 1.7/2.1/2.3 확인 입력)
    const ext = extArea > 0 ? { units: Math.ceil(areaM2 / extArea), basisAreaM2: extArea } : null;
    let spk = null;
    if (r > 0) {
      const S = Math.SQRT2 * r; // 정방형 배치 최대 간격
      const cols = Math.max(1, Math.ceil((rb.W / 1000) / S));
      const rows2 = Math.max(1, Math.ceil((rb.D / 1000) / S));
      spk = { radiusM: r, maxSpacingM: round(S), heads: cols * rows2, layout: `${cols}×${rows2}`, spacingX: round(rb.W / 1000 / cols), spacingY: round(rb.D / 1000 / rows2) };
    }
    fire = (ext || spk) ? {
      verdict: 'INFO', extinguisher: ext, sprinkler: spk,
      note: '소화기=바닥면적/능력단위 기준면적(소방시설법 시행령 별표4 — 용도·내화별 값 확인 입력). 스프링클러=정방형 S=√2r(NFTC 103 수평거리 — 용도별 확인 입력), 헤드수·배치는 형상 파생 개산. 법정 소방설계는 소방시설설계업 영역.',
    } : {
      verdict: 'INPUT',
      needInputs: [
        { name: 'extinguisherAreaM2', labelKo: '소화기 능력단위 기준면적(㎡) — 용도·내화구조가 정한다(소방시설법 시행령 별표4)' },
        { name: 'sprinklerRadiusM', labelKo: '스프링클러 수평거리(m) — 용도가 정한다(NFTC 103)' },
      ],
      note: 'extinguisherAreaM2(별표4)·sprinklerRadiusM(NFTC 103) 입력 시 소화기 수·헤드 배치 개산.',
    };
  }

  return {
    ok: true,
    travel,
    egress: egress ? { verdict: egress.verdict, checks: egress.checks ?? null, derived: { doorWidthSumMm: doorWidthSum, seatCount }, refs: egress.refs ?? null, error: egress.error ?? null } : null,
    ...(egressUnavailable ? { egressUnavailable } : {}),
    finishes,
    lighting, ventilation, electrical, water, fire,
    mep: mepDrainageCheck(assembly),
    provenance: { geometry: ['보행거리(BFS)', '장애물 풋프린트', '문 폭 합', '마감 면적', '실지수·실체적'], user: ['보행거리 한계', '인당 점유면적', '조도·광속·환기량·부하밀도(기준 참조 입력)'] },
    disclaimer: '개념 검토(비법정) — 격자 근사·가구 배치 기준. 법정 피난·설비 검토는 용도·내화·스프링클러 조건 반영한 건축사·설비기술사 검토 필요.' + (unverifiedParts.length ? ` ⚠ 비검증 직접편집 파츠 ${unverifiedParts.length}개는 구조 검토에서 제외됨(P4 라벨) — 해당 형상의 안전은 별도 확인 필요.` : ''),
  };
}

/**
 * MEP 배수 DFU 판정 — 형상의 배관 선언(pipes[] drain)과 drainage_vent 계산기(KDS 31 30 25
 * DFU법 원문 전사)를 잇는다. 기구 role→표 4.1-2 키 매핑, 라인=수평지관·PS 스택=수직관 판정.
 * 계획 관경(선언 d)이 소요 DN 미달이면 FAIL — "관경=개산 선언"을 원문 표로 검증하는 폐루프.
 */
const ROLE_FX = { toilet: '대변기_6L', basin: '세면기', bathtub: '욕조', sink: '주방싱크' };
// 표 4.1-1 최소 기울기(관지름별) — drainage-vent.mjs SLOPE_MIN 과 동일 출처(1행 규칙)
const SLOPE_MIN = (dn) => (dn <= 65 ? { s: 1 / 50, label: '1/50' } : dn <= 150 ? { s: 1 / 100, label: '1/100' } : { s: 1 / 200, label: '1/200' });
export function mepDrainageCheck(assembly) {
  if (!Array.isArray(assembly?.pipes) || !assembly.pipes.length) return null;
  const byId = new Map((assembly.parts ?? []).map((pp) => [pp.id, pp]));
  // 라우팅 실경로(결정론) — 구배 검증(수평 연장→소요 낙차)·통기 길이에 사용
  let routes = [];
  try { routes = buildAssembly(assembly)?.pipes?.routes ?? []; } catch { routes = []; }
  const routeOf = (id) => routes.find((rt) => rt.label === id);
  // 구배 검증: 도식 경로는 무구배(z 정렬·코리도 상승 포함)라 "시공 시 필요한 낙차"를 산출해
  // 대조한다 — 상승 구간이 있으면 PASS 단정 대신 CHECK(실시공은 바닥 구배 배관으로 대체).
  const slopeOf = (id, dn) => {
    const rt = routeOf(id);
    if (!rt) return null;
    let horiz = 0, rises = false;
    for (let i = 0; i < rt.pts.length - 1; i++) {
      const a = rt.pts[i], b = rt.pts[i + 1];
      if (Math.abs(b[2] - a[2]) < 1e-6) horiz += Math.hypot(b[0] - a[0], b[1] - a[1]);
      else if (b[2] > a[2]) rises = true;
    }
    const sm = SLOPE_MIN(dn);
    const requiredDropMm = Math.round(horiz * sm.s);
    const availableDropMm = Math.round(rt.pts[0][2] - rt.pts[rt.pts.length - 1][2]);
    return {
      horizontalM: +(horiz / 1000).toFixed(2), minSlope: sm.label, requiredDropMm, availableDropMm, rises,
      verdict: rises ? 'CHECK' : availableDropMm >= requiredDropMm ? 'PASS' : 'CHECK',
    };
  };
  const lines = [];
  const allFixtures = [];
  for (const pipe of assembly.pipes) {
    if (pipe.service !== 'drain') continue;
    const fromId = typeof pipe.from === 'string' ? pipe.from.split('.')[0] : pipe.from?.part;
    const fx = ROLE_FX[byId.get(fromId)?.role];
    if (!fx) { lines.push({ line: pipe.id, note: `기구 role 매핑 없음(${fromId ?? '원시좌표'}) — DFU 판정 생략(정직)` }); continue; }
    allFixtures.push({ type: fx, count: 1 });
    try {
      const r = runCalculator('drainage_vent', { fixtures: [{ type: fx, count: 1 }], segment: 'branch', plannedDN: pipe.d ?? 26 });
      lines.push({ line: pipe.id, fixture: fx, sumDFU: r.checks.sizing.sumDFU, requiredDN: r.checks.sizing.requiredDN, plannedDN: pipe.d ?? 26, verdict: r.verdict, slope: slopeOf(pipe.id, pipe.d ?? 26) });
    } catch (e) { lines.push({ line: pipe.id, fixture: fx, note: '판정 불가: ' + (e?.message ?? e) }); }
  }
  if (!lines.length) return null;
  let stack = null;
  const stackPart = (assembly.parts ?? []).find((pp) => pp.role === 'stack');
  if (allFixtures.length && stackPart) {
    try {
      const dn = stackPart.params?.diameter ?? 100;
      const r = runCalculator('drainage_vent', { fixtures: allFixtures, segment: 'stack', floors: 1, plannedDN: dn });
      stack = { part: stackPart.id, sumDFU: r.checks.sizing.sumDFU, requiredDN: r.checks.sizing.requiredDN, plannedDN: dn, verdict: r.verdict };
    } catch (e) { stack = { part: stackPart.id, note: '판정 불가: ' + (e?.message ?? e) }; }
  }
  // 통기 판정(§4.3 하한) — vent 라인: 담당 배수관=PS 스택 지름, 길이=라우팅 실측
  let vent = null;
  const ventPipe = assembly.pipes.find((pp) => pp.service === 'vent');
  if (ventPipe && stackPart) {
    try {
      const rt = routeOf(ventPipe.id);
      const lenM = rt ? +(rt.pts.reduce((s, p, i) => i ? s + Math.hypot(p[0] - rt.pts[i - 1][0], p[1] - rt.pts[i - 1][1], p[2] - rt.pts[i - 1][2]) : 0, 0) / 1000).toFixed(2) : undefined;
      const r = runCalculator('drainage_vent', { segment: 'vent', ventKind: 'stack_vent', drainDN: stackPart.params?.diameter ?? 100, ...(lenM !== undefined ? { ventLen_m: lenM } : {}), plannedDN: ventPipe.d ?? 32 });
      vent = { line: ventPipe.id, drainDN: stackPart.params?.diameter ?? 100, requiredDN: r.checks.sizing.requiredDN, plannedDN: ventPipe.d ?? 32, verdict: r.verdict, notes: r.notes };
    } catch (e) { vent = { line: ventPipe.id, note: '판정 불가: ' + (e?.message ?? e) }; }
  }
  return {
    lines, stack, vent,
    ref: 'KDS 31 30 25 표 4.1-2·4.1-5(DFU)·표 4.1-1(기울기)·§4.3(통기 하한) — drainage_vent 계산기',
    note: '기구 1개=지관 1선 단순화 · 구배=도식 경로 기준 소요 낙차 산출(상승 구간=CHECK, 실시공은 바닥 구배 배관) · 트랩 미모델 · 통기=명문 하한(표 4.3-1 매트릭스 보류) — 비법정.',
  };
}

// --- self-test ---
const isMain = process.argv[1] && process.argv[1].replaceAll('\\', '/').endsWith('interior-check.mjs');
if (isMain) {
  const { buildAssemblyTemplate } = await import('./domain-assemblies.mjs');
  const asm = buildAssemblyTemplate('interior', 'cafe_room', {});
  const r = interiorCheck(asm, {});
  if (!r.ok) { console.log('FAIL', r.error); process.exit(1); }
  console.log('보행거리:', r.travel.maxTravelM, 'm / 한계', r.travel.limitM, 'm →', r.travel.pass ? 'PASS' : 'FAIL', '| 미도달:', r.travel.unreachableM2, 'm²');
  console.log('피난폭:', r.egress.verdict, '| 문폭합:', r.egress.derived.doorWidthSumMm, 'mm | 좌석:', r.egress.derived.seatCount);
  console.log('마감: 바닥', r.finishes.floorM2, '· 벽', r.finishes.wallM2, '· 천장', r.finishes.ceilingM2, 'm²');
  // sanity: 8×6 실 — 보행거리는 실 대각(≈14m 맨해튼) 이내·0 초과
  const sane = r.travel.maxTravelM > 3 && r.travel.maxTravelM < 20 && r.finishes.floorM2 === 48;
  console.log(sane && r.travel.pass ? 'interior-check self-test: PASS' : 'interior-check self-test: FAIL');
  if (!(sane && r.travel.pass)) process.exit(1);
}
