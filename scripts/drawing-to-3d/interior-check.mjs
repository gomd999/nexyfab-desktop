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
  const parts = assembly?.parts ?? [];
  const rb = assembly?.roomBounds;
  const exits = assembly?.exits ?? [];
  if (!rb?.W || !rb?.D) return { ok: false, error: 'roomBounds{W,D} 메타 필요 (cafe_room형 어셈블리)' };
  if (!exits.length) return { ok: false, error: 'exits[] 메타 필요 — 출입구 없는 실은 피난 검토 불가(정직 거부)' };

  const cell = Math.max(50, Number(params.cell) || 100);
  const nx = Math.ceil(rb.W / cell), ny = Math.ceil(rb.D / cell);

  // ── 장애물 격자 (보행 차단: 테이블·카운터·벽 — z 1800 이하에 존재하는 풋프린트) ──
  const blocked = new Uint8Array(nx * ny);
  const obstacles = parts.filter((p) => ['table', 'counter', 'wall'].includes(p.role) && footprint(p).z0 < 1800);
  for (const ob of obstacles) {
    const f = footprint(ob);
    const i0 = Math.max(0, Math.floor(f.x0 / cell)), i1 = Math.min(nx - 1, Math.floor((f.x1 - 1) / cell));
    const j0 = Math.max(0, Math.floor(f.y0 / cell)), j1 = Math.min(ny - 1, Math.floor((f.y1 - 1) / cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) blocked[j * nx + i] = 1;
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
  const D4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (qh < qt) {
    const ci = qx[qh], cj = qy[qh]; qh++;
    const cd = dist[cj * nx + ci];
    for (const [dx, dy] of D4) {
      const i = ci + dx, j = cj + dy;
      if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
      const idx = j * nx + i;
      if (blocked[idx] || dist[idx] >= 0) continue;
      dist[idx] = cd + cell;
      qx[qt] = i; qy[qt] = j; qt++;
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
  const travel = {
    maxTravelM: round(maxDist / 1000), farthestPointMm: maxAt, limitM: limit / 1000,
    pass: maxDist <= limit,
    unreachableCells: unreachable, unreachableM2: round((unreachable * cell * cell) / 1e6),
    limitNote: '한계 30m = 건축법 시행령 제34조(직통계단 보행거리) 참고 기본값 — 용도·내화구조·스프링클러에 따라 상이, 프로젝트 기준 확인 필요(입력 가능)',
    method: `${cell}mm 격자 4방향 BFS · 장애물=테이블·카운터·벽 풋프린트(z<1.8m) · 맨해튼 근사(대각 이동 미허용 → 보수적)`,
  };

  // ── 수용인원·피난폭 (occupancy_egress — 문 폭 합=형상 파생) ─────────────────
  const doorWidthSum = exits.reduce((s, e) => s + (e.widthMm ?? 0), 0);
  const seatCount = Array.isArray(assembly.furniture) ? assembly.furniture.reduce((s, f) => s + (f.seats > 0 ? f.count : 0), 0) : 0;
  let egress = null;
  try {
    egress = runCalculator('occupancy_egress', {
      floorAreaM2: assembly.floorAreaM2 ?? round((rb.W * rb.D) / 1e6),
      seatCount,
      occupantDensityM2: Number(params.occupantDensityM2) || 1.4,
      egressWidthProvidedMm: doorWidthSum,
      exitCount: exits.length,
      doorClearWidthMm: Math.min(...exits.map((e) => e.widthMm ?? 900)),
    }, 'KDS');
  } catch (e) {
    egress = { verdict: e.code === 'INPUT_GATE' ? 'INPUT' : 'ERROR', error: e.message };
  }

  // ── 마감 물량 (결정론 — 개구 공제) ─────────────────────────────────────────
  const walls = parts.filter((p) => p.type === 'wall_with_openings');
  const wallNet = walls.reduce((s, w) => {
    const pp = w.params;
    return s + (pp.length * pp.height - (pp.openings ?? []).reduce((o, x) => o + x.w * x.h, 0));
  }, 0);
  const finishes = {
    floorM2: round((rb.W * rb.D) / 1e6),
    wallM2: round(wallNet / 1e6),
    ceilingM2: round((rb.W * rb.D) / 1e6),
    note: '벽=실내측 1면 기준·개구 공제. 걸레받이·몰딩 연장 등 부자재 미포함. 단가 미산출(날조 방지).',
  };

  return {
    ok: true,
    travel,
    egress: egress ? { verdict: egress.verdict, checks: egress.checks ?? null, derived: { doorWidthSumMm: doorWidthSum, seatCount }, refs: egress.refs ?? null, error: egress.error ?? null } : null,
    finishes,
    provenance: { geometry: ['보행거리(BFS)', '장애물 풋프린트', '문 폭 합', '마감 면적'], user: ['보행거리 한계', '인당 점유면적'] },
    disclaimer: '개념 검토(비법정) — 격자 근사·가구 배치 기준. 법정 피난 검토는 용도·내화·스프링클러 조건 반영한 건축사 검토 필요.',
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
