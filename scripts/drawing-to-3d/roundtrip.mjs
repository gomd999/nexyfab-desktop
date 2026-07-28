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
  // ⚠ 정직하게: 드롭을 **재현하지는 못했다**(과대 필렛·mesh 부품·영치수 세 경로 모두
  // 드롭 없이 통과). 이 수정은 코드 경로 검토와 위 문서 계약에 근거한 것이고, 실측
  // 재현 사례는 아직 없다. 그래도 통과 조건을 좁히는 방향이라 과탐 위험이 없다.
  const droppedIds = [...droppedPids].map((i) => asm.parts[i]?.id ?? `#${i}`);
  const nothingDropped = droppedIds.length === 0;
  return {
    ok: true,
    // 드롭이 있으면 기하 불일치(FAIL)와 구별되는 상태로 — 원인이 다르고 조치도 다르다.
    verdict: !nothingDropped ? 'INCOMPLETE'
      : volOk && aabbOk !== false ? 'PASS' : 'FAIL',
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
