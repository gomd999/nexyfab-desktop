/**
 * interference-refine.mjs — 의심쌍 메시 부울 2차 간섭(정확도 B1, 260719).
 *
 * AABB/폐형 규칙이 보수적으로 남긴 간섭쌍만 openscad `intersection()` 실기하 부울로
 * 재판정 — 회전·사면·revolve·자유곡면 전 조합에서 정확(근사 아님·실렌더).
 * 교집합 부피 ≤ ε(기본 1mm³) = 실분리 → 간섭 해제(정제 내역 공개). > ε = 간섭 확정
 * (실측 부피 동봉 — AABB 추정보다 정확한 관통량).
 *
 * 비용: 쌍당 openscad 1회(수백 ms) — 의심쌍 한정 호출이 전제(전수 아님 명시).
 */
import { assemblyToComposeIntent } from './assembly.mjs';
import { emitComposite } from './compose.mjs';
import { renderStl } from './verify.mjs';

/** 바이너리 STL 부피(부호 사면체 — 닫힌 메시 전제, openscad 산출은 닫힘). */
export function stlVolume(bytes) {
  if (!bytes || bytes.length < 84) return 0;
  const dv = new DataView(bytes.buffer, bytes.byteOffset);
  const n = dv.getUint32(80, true);
  let vol6 = 0;
  for (let i = 0; i < n; i++) {
    const o = 84 + i * 50 + 12;
    const ax = dv.getFloat32(o, true), ay = dv.getFloat32(o + 4, true), az = dv.getFloat32(o + 8, true);
    const bx = dv.getFloat32(o + 12, true), by = dv.getFloat32(o + 16, true), bz = dv.getFloat32(o + 20, true);
    const cx = dv.getFloat32(o + 24, true), cy = dv.getFloat32(o + 28, true), cz = dv.getFloat32(o + 32, true);
    vol6 += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
  }
  return Math.abs(vol6 / 6);
}

// 격자 절점 랩 접합 역할(R2-⑩ 교차부 규칙): 송전탑·트러스류 격자 부재쌍의 소부피
// 실교차는 볼트 랩 접합 관례 — 결함이 아니라 접합부. latticeLapMm3 초과분은 여전히 간섭.
const LATTICE_ROLES = new Set(['column', 'beam', 'brace', 'chord', 'diagonal', 'vertical']);

/**
 * 간섭 목록(의심쌍) → 메시 부울 재판정.
 * @param asm 어셈블리(parts[])
 * @param interferences buildAssembly 산출 간섭 배열({a,b,...})
 * @param opts.latticeLapMm3 >0 이면 격자 role 쌍의 실교차 ≤ 이 부피를 '절점 랩 접합'으로
 *   분류(laps 로 분리 보고 — 간섭 목록에서 제외. 볼트·거셋 상세=입력 명시. 기본 0=비활성)
 * @returns { interferences(확정만·intersectMm3 동봉), demoted(해제 내역), laps, checked }
 */
export async function refineInterferencesMesh(asm, interferences, { epsMm3 = 1, latticeLapMm3 = 0, maxPairs = 400, budgetMs = 0 } = {}) {
  const intent = assemblyToComposeIntent(asm);
  const pidOf = new Map((asm.parts ?? []).map((p, i) => [p.id ?? p.type, i]));
  const roleOf = new Map((asm.parts ?? []).map((p) => [p.id ?? p.type, String(p.role ?? '')]));
  const confirmed = [];
  const demoted = [];
  const laps = [];
  let checked = 0;
  let unrefined = 0;
  // 성능 예산(260728) — 실측 쌍당 27~35ms, 쌍 수는 부품에 초선형(200부품→1468쌍→39s).
  // 예산을 넘긴 쌍은 **원본 판정을 그대로 유지**한다(해제하지 않는다) — 확인 못 한 것을
  // 이상 없음으로 바꾸지 않는다. 몇 쌍을 못 봤는지는 반드시 보고한다(조용한 절단 금지).
  //
  // ⚠ 260729 정정: 처음엔 `budgetMs = 20000` 을 기본으로 뒀는데 **그게 잘못이었다.**
  // 이 결과는 designOk 를 좌우하는데, 벽시계 예산을 걸면 **같은 입력이 머신 부하에 따라
  // 다른 판정을 낸다.** 실제로 송전탑(92쌍) 회귀가 단독 실행에선 통과하고 전체 스위트
  // 동시 실행에선 21쌍 미검증으로 실패했다 — 형상이 아니라 그때의 CPU 여유가 판정을
  // 바꾼 것이다. 이 레포의 결정론 원칙에 정면으로 어긋난다.
  // → 기본값은 쌍 수 상한(maxPairs)만. 그건 입력만으로 정해져 재현 가능하다.
  //   budgetMs 는 0=무제한이고, 시간 상한이 꼭 필요한 호출자만 명시적으로 넣는다.
  const started = Date.now();
  for (const rec of interferences ?? []) {
    if (checked >= maxPairs || (budgetMs > 0 && Date.now() - started > budgetMs)) {
      unrefined++;
      confirmed.push({ ...rec, note: `${rec.note ?? ''} · 2차 정제 예산 초과 — 미검증(보수 유지)`.trim() });
      continue;
    }
    const ia = pidOf.get(rec.a), ib = pidOf.get(rec.b);
    if (ia == null || ib == null) { confirmed.push(rec); continue; }
    const fa = intent.features.filter((f) => f._pid === ia);
    const fb = intent.features.filter((f) => f._pid === ib);
    if (!fa.length || !fb.length) { confirmed.push(rec); continue; }
    checked++;
    // 마커 큐브(1e-6mm³, AABB 밖) — 빈 교집합이면 openscad 가 STL 자체를 안 써서(FS error)
    // 실분리가 실패로 오인됨 → 항상 지오메트리 보장, 마커 부피는 ε 대비 무시 가능(명시)
    const scad = `module __A(){\n${emitComposite({ name: 'a', features: fa })}\n}\nmodule __B(){\n${emitComposite({ name: 'b', features: fb })}\n}\nunion(){ intersection(){ __A(); __B(); } translate([1e6,1e6,1e6]) cube([0.01,0.01,0.01]); }`;
    let vol = null;
    try {
      const stl = await renderStl(scad);
      vol = stlVolume(stl);
    } catch (e) {
      confirmed.push({ ...rec, note: `${rec.note ?? ''} · 메시 부울 실패(${String(e?.message ?? e).slice(0, 40)}) — 보수 유지(정직)` });
      continue;
    }
    if (vol <= epsMm3) {
      demoted.push({ a: rec.a, b: rec.b, intersectMm3: +vol.toFixed(3), note: '메시 부울 실기하 — 실분리(AABB/폐형 보수 과탐 해제)' });
    } else if (latticeLapMm3 > 0 && vol <= latticeLapMm3
      && LATTICE_ROLES.has(roleOf.get(rec.a)) && LATTICE_ROLES.has(roleOf.get(rec.b))) {
      // R2-⑩ 교차부 규칙: 격자 부재쌍 소부피 실교차 = 절점 랩 접합(볼트·거셋 상세=입력)
      laps.push({ a: rec.a, b: rec.b, intersectMm3: +vol.toFixed(1), note: '격자 절점 랩 접합(관례 분류 — 볼트/거셋 상세=입력 영역)' });
    } else {
      confirmed.push({ ...rec, intersectMm3: +vol.toFixed(1), note: `${rec.note ?? ''} · 메시 부울 확정(교집합 ${vol.toFixed(1)}mm³)`.trim() });
    }
  }
  // 확정분의 **성격**을 함께 낸다(260729). 판정을 바꾸지는 않는다 — 소비자가 규모를
  // 알아야 "제작 전에 도면을 고쳐야 한다"를 올바로 해석할 수 있기 때문이다.
  // 실측(송전탑): 확정 75건이 **전부** 격자 부재쌍이고 최대 교집합 36,234mm³ =
  // 부재 체적의 0.31%. 절점 볼트 랩이지 충돌이 아닌데 문구는 충돌처럼 읽혔다.
  const vols = confirmed.map((c) => Number(c.intersectMm3)).filter(Number.isFinite);
  const latticePairs = confirmed.length > 0 && confirmed.every(
    (c) => LATTICE_ROLES.has(roleOf.get(c.a)) && LATTICE_ROLES.has(roleOf.get(c.b)));
  return {
    interferences: confirmed, demoted, laps, checked, unrefined,
    ...(confirmed.length ? {
      confirmedProfile: {
        allLatticePairs: latticePairs,
        maxIntersectMm3: vols.length ? Math.max(...vols) : null,
        measured: vols.length, // 부울로 실측된 건수(예산 초과분은 값이 없다)
      },
    } : {}),
    note: '의심쌍 한정 2차(전수 아님) — ε=' + epsMm3 + 'mm³'
      + (latticeLapMm3 > 0 ? ' · 격자 랩 한계=' + latticeLapMm3 + 'mm³' : '')
      + (unrefined ? ` · ⚠ ${unrefined}쌍은 성능 예산(${maxPairs}쌍${budgetMs > 0 ? `/${budgetMs}ms` : ''}) 초과로 미검증 — 보수 판정 유지(해제 아님)` : ''),
  };
}

/**
 * 정제 결과를 `built` 에 되돌린다 — **계산해 놓고 버리던 것**(260728).
 *
 * ## 무엇이 문제였나
 * `generate_package`(MCP)와 `/drawing/package`(웹) 둘 다 잔여 간섭이 있으면 이 모듈로
 * 메시 부울 2차를 돌렸다. 그런데 응답의 `interferences`·`designOk` 는 **원본 AABB 값**을
 * 그대로 썼고, 정제 결과는 `interferenceRefine` 이라는 별도 필드에만 실렸다. 쉬운요약도
 * `built.interferences`·`built.designOk` 를 읽으므로 소비자에게 도달한 것은 보수 과탐 쪽이다.
 * §6-G "판정이 소비자에 도달하지 않음"인데, 방향이 과소가 아니라 **과대**다.
 *
 * 실측(mech/transmission_tower, 99부품): 원본 186건 → 확정 75 · 해제 111.
 * 회전 각도재의 AABB 가 실솔리드보다 크게 잡혀 **59.7% 가 과탐**이었다. 이 어셈블리는
 * 확정이 75건이라 designOk 가 어느 쪽이든 false 지만, **전량 해제되는 어셈블리는
 * 기하학적으로 깨끗한데도 designOk:false 로 나간다.**
 *
 * ## 왜 정제값을 쓰는 것이 정직한가
 * 해제는 추정이 아니라 **실기하 부울 교집합 부피 측정**이다(≤ε=실분리). 추측으로 지우는
 * 것이 아니라 더 정확한 측정으로 대체하는 것이라, "없는 근거로 통과시키지 않는다"에
 * 어긋나지 않는다. 다만 **원본 수치를 감추지 않는다** — raw/해제 건수를 함께 싣는다.
 * 정제가 실패했으면 원본을 그대로 두고 그 사실을 적는다(실패를 통과로 바꾸지 않는다).
 *
 * @param {object} built buildAssembly 산출
 * @param {object|null} refine refineInterferencesMesh 산출(또는 {error} / null)
 * @returns {object} built 사본 — interferences·designOk 가 정제 반영된 것
 */
export function applyInterferenceRefinement(built, refine) {
  if (!built || !refine || refine.error || !Array.isArray(refine.interferences)) return built;
  const raw = built.interferences ?? [];
  const confirmed = refine.interferences;
  // 해제가 없으면 바꿀 것이 없다 — 단 **예산 초과로 못 본 쌍이 있으면 그 사실은 남긴다.**
  // (전량 미검증이면 confirmed.length === raw.length 라 여기서 조용히 빠져나가 고지가 사라진다)
  // (해제가 없어도 **미검증 건수·확정분 성격**은 전달돼야 한다 — 둘 다 없을 때만 그대로.)
  if (confirmed.length === raw.length && !refine.unrefined && !refine.confirmedProfile) return built;
  // designOk 는 간섭 외 조건(부유·배관)도 본다. 그 조건들을 다시 판정하지 않고,
  // **원래 판정에서 간섭 항목만 교체**한다 — 여기서 다른 게이트를 재해석하지 않는다.
  const nonInterferenceOk = (built.support?.floating?.length ?? 0) === 0
    && (!built.pipes || (built.pipes.errors.length === 0
      && built.pipes.obstacleViolations.length === 0
      && built.pipes.crossViolations.length === 0));
  return {
    ...built,
    interferences: confirmed,
    designOk: nonInterferenceOk && confirmed.length === 0,
    interferencesRaw: raw.length,
    interferencesDemoted: (refine.demoted ?? []).length,
    ...(refine.unrefined ? { interferencesUnrefined: refine.unrefined } : {}),
    ...(refine.confirmedProfile ? { interferenceProfile: refine.confirmedProfile } : {}),
    interferenceBasis: `AABB 의심 ${raw.length}쌍 → 메시 부울 실기하 2차: 확정 ${confirmed.length}`
      + `${(refine.demoted ?? []).length ? ` · 실분리 해제 ${refine.demoted.length}` : ''}`
      + `${(refine.laps ?? []).length ? ` · 격자 절점 랩 ${refine.laps.length}` : ''}`
      // 미검증분을 숨기면 "확정 N"이 전수 검증 결과처럼 읽힌다.
      + `${refine.unrefined ? ` · ⚠ ${refine.unrefined}쌍 예산초과 미검증(보수 유지)` : ''}`,
  };
}
