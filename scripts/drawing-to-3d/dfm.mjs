/**
 * dfm.mjs — 판금·절삭 제조성(DFM) 상시검증(기계·판금 완벽화 Pillar ②).
 *
 * 형상 intent(compose/preset)에서 홀·두께·벽을 **결정론적으로 읽어** 제조 규칙을 검사한다.
 * 메시 휴리스틱이 아니라 파라미터 직독이라 홀 지름·엣지거리·벽두께가 정확하다.
 *
 * 규칙(일반 판금·절삭 지침 — 비법정 참고, 샵 관행값). 프로세스로 임계 조정:
 *  - min_hole:    펀칭 ⌀ ≥ 두께 t (레이저 ⌀ ≥ 0.5t). 미만=경고
 *  - hole_edge:   홀 가장자리~판 가장자리 ≥ 2t(펀칭)/1t(레이저). 미만=경고 / 음수=실패(판 밖/겹침)
 *  - hole_spacing:홀 가장자리 간격 ≥ 2t. 미만=경고
 *  - min_thickness:t < 1.0mm 경고(기존 dfmAnalysis minWall과 정합)
 *  - thin_wall:   중공/용기 벽 < 1.0mm 경고, 벽/외경 과소 주의
 * 임계값은 기존 shape-generator/analysis/dfmAnalysis(minWall 1.0~1.5)와 맞춘다.
 */

const REF = '일반 판금·절삭 가공 지침(비법정 참고 · 샵 관행값)';
const MIN_T = 1.0; // mm — dfmAnalysis 기본 minWallThickness와 정합

const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** intent에서 판/벽/홀을 추출(결정론). 인식 불가한 부분은 조용히 생략(허위 금지). */
function extract(intent) {
  const feats = Array.isArray(intent?.features) ? intent.features : [];
  const solids = feats.filter((f) => f.op !== 'subtract');
  const cuts = feats.filter((f) => f.op === 'subtract');

  // 판(plate) 후보: box 솔리드 중 가장 얇은 축을 두께로.
  const boxes = solids.filter((f) => f.kind === 'box' && Array.isArray(f.size) && f.size.length === 3);
  const cutBoxes = cuts.filter((f) => f.kind === 'box' && Array.isArray(f.size) && f.size.length === 3);

  // 중공 각관: 외곽 box + 내부 subtract box. 축별 (외-내)/2 중 양수인 것이 벽(단면 두 축),
  // 길이축은 ≈0/음수. 벽 = 양수 벽들의 최소.
  let tubeWall = null;
  if (boxes.length && cutBoxes.length) {
    const o = boxes[0].size, inn = cutBoxes[0].size;
    const walls = o.map((v, i) => (v - inn[i]) / 2).filter((w) => w > 0.05);
    if (walls.length) tubeWall = Math.min(...walls);
  }

  // 판(plate): box 중 한 축이 나머지보다 확연히 얇은 것(t < 0.4×중간축). 각관(변≈변)은 제외.
  let plate = null;
  if (!tubeWall) {
    for (const f of boxes) {
      const s = f.size.slice().sort((a, b) => a - b); // [t, mid, max]
      if (s[0] < 0.4 * s[1]) {
        const tIdx = f.size.indexOf(s[0]);
        const face = f.size.filter((_, i) => i !== tIdx);
        if (!plate || s[0] < plate.t) plate = { t: s[0], face, size: f.size, tIdx };
      }
    }
  }

  // 원형 홀: subtract cylinder — 판 평면(대개 XY) 내 위치.
  const holes = [];
  for (const c of cuts) {
    if (c.kind === 'cylinder' && c.diameter > 0) {
      const tr = c.at?.translate ?? [0, 0, 0];
      holes.push({ dia: c.diameter, pos: [tr[0], tr[1]], id: c.id });
    }
  }

  // 용기(revolve) 벽두께는 일반 프로파일에서 신뢰성 있게 산출 불가(내/외면 대응 모호)
  // → 추측하지 않는다. 회전체 존재 여부만 표시(두께는 미인식으로 생략).
  const hasRevolve = solids.some((f) => f.kind === 'revolve' && Array.isArray(f.profile));

  return { plate, holes, tubeWall, hasRevolve, featureCount: feats.length };
}

/**
 * @param intent compose/preset intent
 * @param opts { process?: 'laser'|'punch', material?: string, thicknessMm?: number }
 * @returns { checks:[{rule,severity,title,message,ref}], summary, recognized }
 */
export function analyzeDfm(intent, opts = {}) {
  const process = opts.process === 'punch' ? 'punch' : 'laser';
  const { plate, holes, tubeWall, hasRevolve, featureCount } = extract(intent);
  const checks = [];
  const add = (rule, severity, title, message) => checks.push({ rule, severity, title, message, ref: REF });

  const t = opts.thicknessMm ?? plate?.t ?? tubeWall ?? null;

  if (t == null) {
    // 260728: 종전엔 세 경우를 한 문구("자유형상")로 뭉갰다 — **하지 않은 진단을 주장한
    // 것이다.** intent.features[] 를 아예 못 읽은 것과 "읽었는데 자유형상"은 다른 말이고,
    // 앞의 경우는 형상이 아니라 입력을 의심해야 한다.
    const why = featureCount === 0
      ? 'intent.features[] 가 비어 있어 형상을 하나도 읽지 못했다 — 자유형상이라는 뜻이 아니라 ' +
        '두께를 판정할 입력이 없다는 뜻이다(compose/preset intent 인지 확인)'
      : hasRevolve
        ? '회전체(용기) 벽두께는 형상만으론 산출 불가 — 두께 명시(thicknessMm) 시 검사'
        : `형상 ${featureCount}개를 읽었으나 판(얇은 축)·중공각관 어느 것으로도 인식되지 않아 ` +
          '두께를 정할 수 없다 — thicknessMm 로 명시하면 검사한다';
    return {
      checks: [], summary: 'DFM: ' + why, recognized: false,
      // 소비자가 "입력 문제"와 "형상 특성"을 갈라 볼 수 있게 사유를 코드로도 싣는다.
      reason: featureCount === 0 ? 'no_features' : hasRevolve ? 'revolve_wall_unknown' : 'thickness_unrecognized',
      featureCount,
    };
  }

  // 최소 두께
  if (t < MIN_T) add('min_thickness', 'warn', '최소 두께', `두께 ${t.toFixed(2)}mm < 권장 ${MIN_T}mm — 취급·가공 중 변형/파단 주의`);

  // 홀 규칙(판이 있을 때)
  if (plate && holes.length) {
    const [W, D] = plate.face;
    const minHole = process === 'punch' ? t : 0.5 * t;
    for (const h of holes) {
      const r = h.dia / 2;
      // 최소 홀
      if (h.dia < minHole) add('min_hole', 'warn', '최소 홀 지름', `홀 ${h.id ?? ''} ⌀${h.dia} < ${process === 'punch' ? '두께' : '0.5×두께'}(${minHole.toFixed(1)}) — ${process === 'punch' ? '펀칭 곤란(레이저 권장)' : '가공 곤란'}`);
      // 엣지 거리(홀 가장자리~판 가장자리)
      const edge = Math.min(h.pos[0], h.pos[1], W - h.pos[0], D - h.pos[1]) - r;
      const minEdge = (process === 'punch' ? 2 : 1) * t;
      if (edge < 0) add('hole_edge', 'fail', '홀 위치 오류', `홀 ${h.id ?? ''}이 판 경계를 벗어나거나 걸침(엣지거리 ${edge.toFixed(1)}mm)`);
      else if (edge < minEdge) add('hole_edge', 'warn', '홀-엣지 거리', `홀 ${h.id ?? ''} 엣지거리 ${edge.toFixed(1)}mm < 권장 ${minEdge.toFixed(1)}mm(${process === 'punch' ? '2t' : '1t'}) — 가장자리 찢김/변형 위험`);
    }
    // 홀 간격
    for (let i = 0; i < holes.length; i++) {
      for (let j = i + 1; j < holes.length; j++) {
        const gap = dist2(holes[i].pos, holes[j].pos) - holes[i].dia / 2 - holes[j].dia / 2;
        if (gap < 2 * t) add('hole_spacing', 'warn', '홀 간격', `홀 ${holes[i].id ?? i}–${holes[j].id ?? j} 간격 ${gap.toFixed(1)}mm < 권장 ${(2 * t).toFixed(1)}mm(2t)`);
      }
    }
  }

  // 벽(중공 각관) — 용기(revolve)는 위에서 생략 처리.
  if (tubeWall != null && !plate && tubeWall < MIN_T) {
    add('thin_wall', 'warn', '얇은 벽', `벽두께 ${tubeWall.toFixed(2)}mm < 권장 ${MIN_T}mm`);
  }

  if (!checks.length) add('ok', 'pass', '제조성 양호', `주요 판금 규칙(홀·엣지·간격·두께) 위반 없음 (${process}, t=${t.toFixed(1)}mm 기준)`);

  const worst = checks.some((c) => c.severity === 'fail') ? 'fail' : checks.some((c) => c.severity === 'warn') ? 'warn' : 'pass';
  return {
    checks,
    summary: `DFM(${process}, t=${t.toFixed(1)}mm): ${worst === 'pass' ? '양호' : worst === 'warn' ? '경고 ' + checks.filter((c) => c.severity === 'warn').length : '오류 ' + checks.filter((c) => c.severity === 'fail').length}`,
    worst,
    recognized: true,
    thickness: t,
    process,
  };
}

// --- CLI ---
const isMain = process.argv[1] && process.argv[1].replaceAll('\\', '/').endsWith('dfm.mjs');
if (isMain) {
  const arg = process.argv[2];
  if (arg) console.log(JSON.stringify(analyzeDfm(JSON.parse(arg), { process: process.argv[3] || 'laser' }), null, 2));
  else {
    // self-demo: 얇은 홀-엣지 위반 플레이트
    const bad = { name: 'p', features: [
      { id: 'plate', kind: 'box', size: [100, 100, 2] },
      { id: 'h1', kind: 'cylinder', diameter: 6, op: 'subtract', at: { translate: [5, 50, -1] }, height: 4 },
      { id: 'h2', kind: 'cylinder', diameter: 1, op: 'subtract', at: { translate: [50, 50, -1] }, height: 4 },
    ] };
    console.log(JSON.stringify(analyzeDfm(bad, { process: 'punch' }), null, 2));
  }
}
