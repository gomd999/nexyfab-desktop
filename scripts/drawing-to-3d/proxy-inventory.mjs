/**
 * proxy-inventory.mjs — 어휘 전수 프록시 인벤토리(정확도 C1, 260719).
 *
 * 어휘별 대표 파라미터 단품을 세 경로로 실측해 부피 3열 대조:
 *   analytic = partVolume 폐형식 · SCAD = openscad 실렌더 STL 부호사면체
 *   · STEP = intentToStep 직렬화 → 재임포트 메시 실측
 * 열간 편차로 각 경로의 실형상/프록시/드롭을 기계 판정 — 실형상화 우선순위 표.
 * 날조 금지: 판정 불가(게이트 실패·렌더 실패)는 그대로 보고(추정치 대체 없음).
 *
 * CLI: node scripts/drawing-to-3d/proxy-inventory.mjs   → proxy-inventory.json
 */
import { buildAssembly } from './assembly.mjs';
import { partVolume } from './structural.mjs';
import { renderStl } from './verify.mjs';
import { stlVolume } from './interference-refine.mjs';
import { intentToStep, ensureReplicad } from './to-step.mjs';

/** 어휘별 대표 파라미터(게이트 통과 확인값) — 형상 특성이 드러나는 중간 치수. */
export const CANONICAL = {
  box: { width: 100, depth: 80, height: 60 },
  plate_with_holes: { width: 120, depth: 80, thickness: 10, holes: [{ x: 30, y: 40, d: 12 }, { x: 90, y: 40, d: 12 }] },
  slab_with_openings: { length: 6000, depth: 4000, thickness: 200, openings: [{ x: 1000, y: 1000, w: 1200, d: 2400 }] },
  stepped_plate: { width: 120, depth: 80, thickness: 20, stepWidth: 60, stepThickness: 10 },
  base_plate: { width: 200, depth: 200, thickness: 16, boltDia: 18 },
  l_bracket: { legA: 80, legB: 60, width: 50, thickness: 8 },
  bent_sheet: { webWidth: 100, flangeHeight: 40, length: 200, thickness: 5 },
  flange: { outerDia: 155, boreDia: 60, thickness: 16, bcd: 120, boltHoleD: 19, boltCount: 4 },
  tube: { outerDia: 60.5, innerDia: 52.7, length: 300 },
  rect_tube: { width: 60, height: 60, wallThk: 3.2, length: 400 },
  h_section: { H: 200, B: 100, tw: 5.5, tf: 8, length: 1000 },
  c_channel: { H: 150, B: 75, tw: 5, tf: 7.5, length: 1000 },
  i_girder: { length: 10000, topW: 300, topT: 20, webT: 12, webH: 800, botW: 400, botT: 25 },
  tapered_girder: { length: 10000, topW: 300, topT: 20, webT: 12, webH1: 600, webH2: 1200, botW: 400, botT: 25 },
  cylinder: { diameter: 60, length: 200 },
  gusset: { legA: 100, legB: 80, thickness: 10 },
  spur_gear: { module: 2, teeth: 24, thickness: 20, boreDia: 20 },
  hex_bolt: { threadDia: 12, length: 60 },
  hex_nut: { af: 19, thickness: 10, boreDia: 12 },
  washer: { outerDia: 24, boreDia: 13, thickness: 2.5 },
  angle: { legA: 65, legB: 65, thickness: 6, length: 500 },
  tee_section: { H: 100, B: 100, tw: 8, tf: 8, length: 500 },
  sheet_profile: { thickness: 3, width: 100, segments: [40, 60, 40], angles: [90, 90] },
  wall_with_openings: { length: 3000, thickness: 150, height: 2400, openings: [{ x: 500, w: 900, h: 2100, sill: 0 }] },
  pipe_reducer: { dia1: 114.3, dia2: 60.5, length: 150 },
  pipe_elbow: { od: 60.5, bendR: 90, angleDeg: 90 },
  pipe_tee: { runOD: 60.5, runLen: 200, branchOD: 34, branchLen: 100 },
  rebar: { dia: 16, points: [[0, 0, 0], [0, 0, 1000], [300, 0, 1300]] },
  coil_spring: { wireDia: 4, coilDia: 40, pitch: 10, turns: 8 },
  pillow_block: { boreDia: 25, width: 140, height: 70, depth: 35 },
  cavity_block: { blockW: 120, blockD: 80, blockH: 60, cavity: { type: 'cylinder', params: { diameter: 40, length: 30 }, at: { tx: 60, ty: 40, tz: 30 } } },
  revolve: { profile: [[20, 0], [60, 0], [60, 40], [20, 40]], angleDeg: 360 },
  /**
   * 260801 — 새 어휘를 추가하면서 **여기에 넣는 것을 빠뜨렸다.**
   *
   * `CANONICAL` 은 「전 어휘를 세 경로(폐형식·SCAD·STEP)로 실측하는」 유일한 전수
   * 소비자다. 여기 없으면 게이트·부피·BOQ·SCAD·STEP 을 다 붙여 놓고도 **어느 검사도
   * 새 어휘를 밟지 않는다** — 이 세션 내내 잡아 온 형태 ①(있는 것이 안 닿음)의 어휘판이다.
   * 아래 회귀(`PARAMS ⊆ CANONICAL`)로 다음에는 빠뜨릴 수 없게 했다.
   */
  extrude_profile: { profile: [[0, 0], [100, 0], [100, 20], [20, 20], [20, 100], [0, 100]], depth: 50, holes: [{ x: 50, y: 10, d: 10 }] },
  masonry_block: { length: 390, thickness: 190, height: 190, coreCount: 2, coreW: 105, coreD: 115 },
  mesh: { volumeMm3: 123456, aabb: { min: [0, 0, 0], max: [100, 100, 100] } },
};

const devPct = (v, ref) => (ref > 0 ? Math.abs(v - ref) / ref * 100 : null);

/** STEP 텍스트 → 재임포트 메시 부피(roundtrip 과 동일 수학 — 부호 사면체). */
async function stepMeshVolume(stepText) {
  const rc = await ensureReplicad();
  const shp = await rc.importSTEP(new Blob([stepText]));
  const m = shp.mesh({ tolerance: 0.05, angularTolerance: 15 });
  const v = m.vertices, tri = m.triangles;
  let vol6 = 0;
  for (let t = 0; t < tri.length; t += 3) {
    const a = tri[t] * 3, b = tri[t + 1] * 3, c = tri[t + 2] * 3;
    vol6 += v[a] * (v[b + 1] * v[c + 2] - v[b + 2] * v[c + 1])
      + v[a + 1] * (v[b + 2] * v[c] - v[b] * v[c + 2])
      + v[a + 2] * (v[b] * v[c + 1] - v[b + 1] * v[c]);
  }
  return Math.abs(vol6 / 6);
}

/**
 * 인벤토리 실행. band(%) 초과 편차 = 해당 열 프록시.
 * @returns rows: [{ type, analyticMm3, scadMm3, stepMm3, scadDevPct, stepDevPct, verdict, note? }]
 */
export async function buildProxyInventory({ types = Object.keys(CANONICAL), bandPct = 2.5 } = {}) {
  const rows = [];
  for (const type of types) {
    const params = CANONICAL[type];
    const row = { type, analyticMm3: null, scadMm3: null, stepMm3: null, scadDevPct: null, stepDevPct: null, verdict: '?' };
    try { row.analyticMm3 = +((partVolume(type, params) || 0).toFixed(1)); } catch { row.analyticMm3 = 0; }
    const asm = { parts: [{ id: 'p', type, params, at: { tx: 0, ty: 0, tz: 0 }, material: 'steel' }] };
    const built = buildAssembly(asm);
    if (!built.ok) {
      row.verdict = 'GATE_FAIL';
      row.note = (built.gateErrors ?? []).join('; ').slice(0, 120);
      rows.push(row);
      continue;
    }
    try {
      row.scadMm3 = +stlVolume(await renderStl(built.openscad)).toFixed(1);
    } catch (e) { row.note = `scad: ${String(e?.message ?? e).slice(0, 60)}`; }
    try {
      const st = await intentToStep(built.composeIntent);
      const dropped = (st.fuseReport?.dropped ?? []).length;
      if (dropped) row.stepDropped = true;
      else row.stepMm3 = +(await stepMeshVolume(st.step)).toFixed(1);
    } catch (e) { row.note = `${row.note ? row.note + ' · ' : ''}step: ${String(e?.message ?? e).slice(0, 60)}`; }
    const ref = row.analyticMm3;
    row.scadDevPct = row.scadMm3 != null && ref ? +devPct(row.scadMm3, ref).toFixed(2) : null;
    row.stepDevPct = row.stepMm3 != null && ref ? +devPct(row.stepMm3, ref).toFixed(2) : null;
    // 판정: 해석식 없음 > 드롭 > 열별 프록시 > EXACT (곡면 테셀 새그 감안 band 명시)
    row.verdict = !ref ? 'NO_ANALYTIC'
      : row.stepDropped ? 'STEP_DROPPED'
        : row.scadMm3 == null ? 'SCAD_FAIL'
          : row.scadDevPct > bandPct && (row.stepDevPct ?? 0) > bandPct ? 'BOTH_PROXY'
            : row.scadDevPct > bandPct ? 'SCAD_PROXY'
              : row.stepDevPct != null && row.stepDevPct > bandPct ? 'STEP_PROXY'
                : row.stepMm3 == null ? 'STEP_FAIL'
                  : 'EXACT';
    rows.push(row);
  }
  return { bandPct, rows, note: '3열=analytic 폐형·SCAD 실렌더·STEP 재임포트 실측 — 편차>band = 프록시(실형상화 우선순위)' };
}

// CLI: 표를 JSON 으로 산출(회귀는 proxy-inventory.test.ts)
if (import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1] ?? '').href) {
  const inv = await buildProxyInventory({});
  const { writeFileSync } = await import('node:fs');
  writeFileSync(new URL('./proxy-inventory.json', import.meta.url), JSON.stringify(inv, null, 1));
  for (const r of inv.rows) console.log(`${r.type.padEnd(20)} ${r.verdict.padEnd(13)} analytic=${r.analyticMm3} scad=${r.scadMm3}(${r.scadDevPct}%) step=${r.stepMm3}(${r.stepDevPct}%)${r.note ? ' · ' + r.note : ''}`);
}
