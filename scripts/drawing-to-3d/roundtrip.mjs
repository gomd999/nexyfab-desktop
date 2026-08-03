/**
 * roundtrip.mjs — 어셈블리 STEP 라운드트립 정합 게이트(정확도 A1, 260719).
 *
 * 「만든 STEP 이 예측과 맞다」를 기계가 확인 — 생성≠검증의 마지막 고리:
 *   buildAssembly → intentToStep(직렬화) → importSTEP(재파스) → 메시 재측정(부피·AABB)
 *   ↔ 폐형 예측(Σ partVolume · ∪ placedAabb) 대조. 드롭 부품(메시 등)은 예측에서도
 *   제외(동일 모집단 대조 — 정직).
 *
 * 밴드(명시): 부피 max(1.5%, 1000mm³) — 곡면 테셀 새그·필렛 제거량 여유.
 *   AABB 축별 max(1mm, 0.2%). 매입/중첩 부품은 양쪽 다 합산이라 정합(동일 규약).
 */
import { buildAssembly, placedAabb } from './assembly.mjs';
import { partVolume } from './structural.mjs';
import { intentToStep, ensureReplicad } from './to-step.mjs';

export async function stepRoundTrip(asm) {
  const built = buildAssembly(asm);
  if (!built.ok) return { ok: false, error: 'gate', gateErrors: built.gateErrors };
  const st = await intentToStep(built.composeIntent);
  const droppedPids = new Set((st.fuseReport?.dropped ?? []).map((d) => d.pid).filter((p) => p != null));

  // 폐형 예측(드롭 부품 제외 — STEP 모집단과 동일)
  let predVol = 0;
  let bb = null;
  const skipped = [];
  (asm.parts ?? []).forEach((p, i) => {
    if (droppedPids.has(i)) { skipped.push(p.id ?? p.type); return; }
    try { predVol += partVolume(p.type, p.params) || 0; } catch { skipped.push((p.id ?? p.type) + '(체적식 없음)'); }
    try {
      const b = placedAabb(p);
      bb = bb
        ? { min: bb.min.map((v, k) => Math.min(v, b.min[k])), max: bb.max.map((v, k) => Math.max(v, b.max[k])) }
        : { min: [...b.min], max: [...b.max] };
    } catch { /* AABB 실패는 부피 대조만 */ }
  });

  // 재임포트 실측
  const rc = await ensureReplicad();
  const shp = await rc.importSTEP(new Blob([st.step]));
  const m = shp.mesh({ tolerance: 0.05, angularTolerance: 15 });
  const v = m.vertices, tri = m.triangles;
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < v.length; i += 3) {
    if (v[i] < minX) minX = v[i]; if (v[i] > maxX) maxX = v[i];
    if (v[i + 1] < minY) minY = v[i + 1]; if (v[i + 1] > maxY) maxY = v[i + 1];
    if (v[i + 2] < minZ) minZ = v[i + 2]; if (v[i + 2] > maxZ) maxZ = v[i + 2];
  }
  let vol6 = 0;
  for (let t = 0; t < tri.length; t += 3) {
    const a = tri[t] * 3, b = tri[t + 1] * 3, c = tri[t + 2] * 3;
    const ax = v[a], ay = v[a + 1], az = v[a + 2];
    const bx = v[b], by = v[b + 1], bz = v[b + 2];
    const cx = v[c], cy = v[c + 1], cz = v[c + 2];
    vol6 += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
  }
  const measuredVol = Math.abs(vol6 / 6);

  // 대조(밴드 명시)
  const filletParts = (asm.parts ?? []).filter((p) => p.filletMm > 0).length;
  // 근사 체적식 어휘(pipe_tee 접합부 등) 포함 시 밴드 +2%(명시 — 폐형 아님)
  const approxParts = (asm.parts ?? []).filter((p) => ['pipe_tee'].includes(p.type)).length;
  const volBand = Math.max(1000, predVol * 0.015) + (filletParts ? predVol * 0.01 : 0) + (approxParts ? predVol * 0.02 : 0);
  const volErr = Math.abs(measuredVol - predVol);
  const volOk = volErr <= volBand;
  let aabbOk = null;
  const aabbDetail = [];
  if (bb) {
    const meas = [[minX, maxX], [minY, maxY], [minZ, maxZ]];
    aabbOk = true;
    for (let k = 0; k < 3; k++) {
      const pd = bb.max[k] - bb.min[k];
      const md = meas[k][1] - meas[k][0];
      const band = Math.max(1, pd * 0.002);
      const ok = Math.abs(md - pd) <= band;
      if (!ok) aabbOk = false;
      aabbDetail.push({ axis: 'xyz'[k], predicted: +pd.toFixed(2), measured: +md.toFixed(2), band: +band.toFixed(2), ok });
    }
  }
  // ── 드롭된 부품은 비교 모집단에서 빠진다 → 통과가 쉬워진다 (260729) ──────────
  // 위 루프는 `droppedPids` 를 predVol·predicted AABB 에서 **제외**한다. 즉 STEP 으로
  // 내보내지 못한 부품이 많을수록 남은 것끼리만 대조하게 되고, verdict 는 그대로 PASS 가
  // 됐다. 제작 업체가 받는 STEP 에는 그 부품이 **없는데** 모든 문서가 합격이라고 말한다.
  //
  // 방법론 문서(docs/drawing-to-3d-methodology.md)는 이미 "dropped>0 이면 호출측이
  // **반드시 고지**"라고 정해 뒀는데, 실제로는 쉬운요약 어디에도 dropped 렌더가 없었고
  // verdict 도 이를 보지 않았다 — 문서로만 있는 계약이었다.
  //
  // ✅ 260729 재현 확보: 처음 이 수정을 넣을 때는 드롭을 재현하지 못해(과대 필렛·mesh
  // 단독·영치수 세 경로 실패) 코드 경로와 문서 계약에만 근거했다. 이후 바디 개수 대조를
  // 만들다 **실제 사례를 찾았다** — `mech/propeller` 의 mesh 블레이드 3개가
  // "to-step: add 피처 없음(또는 전부 융합 실패)" 로 드롭된다.
  //
  // ⚠ 이건 실제 결함이기도 하다: **mesh 부품은 STEP 으로 나가지 않는다.** 프로펠러
  // STEP 을 업체에 보내면 허브만 있고 날개가 없다. verdict='INCOMPLETE' 와 쉬운요약
  // 고지가 정확히 이 상황을 위해 있다(실측 확인).
  const droppedIds = [...droppedPids].map((i) => asm.parts[i]?.id ?? `#${i}`);
  const nothingDropped = droppedIds.length === 0;

  // ── 바디 개수 대조 (260729) ────────────────────────────────────────────────
  // 종전 검사는 **총부피와 전체 AABB** 뿐이었다. 둘 다 집계값이라 바디가 융합되면
  // 값이 그대로여서 못 잡는다 — 실 CAD 코퍼스에서 body_count 가 재구성 실패 3위(37건)다.
  //
  // 실측으로 불변식을 세웠다(출하 41종): STEP 의 MANIFOLD_SOLID_BREP 수 =
  //   (부품 수 − 드롭) + 배관 수
  // 배관이 별도 솔리드로 나가는데 `parts` 에 없어서 그렇다(rc_frame 9+1=10 ·
  // apartment_unit 19+6=25 · studio_unit 14+5=19 · three_room_unit 23+6=29 — 전부 일치).
  const pipeCount = Array.isArray(asm.pipes) ? asm.pipes.length : 0;
  /**
   * ⚠ 260803 — **인스턴스 재사용을 넣으면서 이 셈의 의미가 갈렸다.**
   * 재사용 전에는 `MANIFOLD_SOLID_BREP` 수 = 부품 자리 수였다. 지금 MANIFOLD 는 **고유
   * 형상** 수이고(와셔 8개 → 형상 1개), 자리 수는 `tree.instances` 가 갖고 있다.
   * 이 불변식이 세려는 것은 **자리**다 — 「25부품을 넣었는데 STEP 에 25덩이가 있나」.
   * MANIFOLD 를 그대로 쓰면 재사용을 **「바디가 사라졌다」로 오판**한다.
   * ⚠ 트리 경로로 안 나간 폴백에는 `instances` 가 없다 — 그때는 종전대로 MANIFOLD 를 센다.
   */
  const bodiesInStep = Number.isFinite(st?.tree?.instances)
    ? st.tree.instances
    : (String(st.step ?? '').match(/MANIFOLD_SOLID_BREP/g) ?? []).length;
  const bodiesExpected = (asm.parts ?? []).length - droppedIds.length + pipeCount;
  const bodies = {
    inStep: bodiesInStep, expected: bodiesExpected,
    parts: (asm.parts ?? []).length, dropped: droppedIds.length, pipes: pipeCount,
    ok: bodiesInStep === bodiesExpected,
    note: '부피·AABB 는 집계값이라 바디가 융합돼도 그대로다 — 개수는 따로 세야 잡힌다',
  };
  return {
    ok: true,
    // 드롭이 있으면 기하 불일치(FAIL)와 구별되는 상태로 — 원인이 다르고 조치도 다르다.
    verdict: !nothingDropped ? 'INCOMPLETE'
      : (volOk && aabbOk !== false && bodies.ok) ? 'PASS' : 'FAIL',
    bodies,
    ...(nothingDropped ? {} : {
      droppedCount: droppedIds.length,
      incompleteNote: `STEP 으로 내보내지 못한 부품 ${droppedIds.length}개 — 대조는 나머지로만 했다. `
        + '내보낸 STEP 파일에는 이 부품이 **없다**(형상 불일치가 아니라 누락이다).',
    }),
    volume: { predictedMm3: +predVol.toFixed(1), measuredMm3: +measuredVol.toFixed(1), errMm3: +volErr.toFixed(1), bandMm3: +volBand.toFixed(1), ok: volOk },
    aabb: aabbDetail,
    stepEntities: st.entities,
    dropped: droppedIds,
    ...(skipped.length ? { predictionSkipped: skipped } : {}),
    ...(filletParts ? { note: `필렛 부품 ${filletParts} — 부피 밴드 +1%(제거량 여유, 명시)` } : {}),
  };
}
