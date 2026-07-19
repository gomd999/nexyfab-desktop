/**
 * fastener-auto.mjs — 체결 자동(260719b): 플랜지 짝 인식 → 볼트 세트 산출.
 *
 * 규칙(결정론): flange 부품쌍이 ①볼트 수·BCD 근접(≤2%) ②축선 근접(중심 xy ≤ BCD 10%)
 * ③면 맞댐(z 간격 ≤ 3mm)이면 접합부로 인식 — 볼트 호칭=볼트홀−2mm 관례를 M 스냅,
 * 길이=그립(t1+t2)+너트(0.8d)+와셔 2(0.3d)+돌출 2피치(0.25d) → 표준 길이 올림 스냅.
 * 정직 명시: 개스킷 두께·토크·강도등급(8.8 등)=입력 영역. 무회전 배치 v1(회전 짝=후속).
 */
import { snapBolt } from './std-snap.mjs';
import { placedAabb } from './assembly.mjs';

const STD_LEN = [16, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 180, 200];

/** @returns { sets:[{a,b,count,m,lengthMm,gripMm,label}], note, skipped? } */
export function autoFasteners(asm) {
  const flanges = (asm.parts ?? [])
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.type === 'flange' && !(p.at?.rx || p.at?.ry || p.at?.rz));
  const sets = [];
  const skipped = [];
  for (let a = 0; a < flanges.length; a++) {
    for (let b = a + 1; b < flanges.length; b++) {
      const A = flanges[a].p, B = flanges[b].p;
      const pa = A.params, pb = B.params;
      if (pa.boltCount !== pb.boltCount) continue;
      if (Math.abs(pa.bcd - pb.bcd) / Math.max(pa.bcd, pb.bcd) > 0.02) continue;
      // 축선(무회전 플랜지 로컬 축=z, 중심=at.tx/ty) 근접 + 면 맞댐(z 간격)
      const ax = A.at?.tx ?? 0, ay = A.at?.ty ?? 0, bx = B.at?.tx ?? 0, by2 = B.at?.ty ?? 0;
      if (Math.hypot(ax - bx, ay - by2) > pa.bcd * 0.1) continue;
      const ba = placedAabb(A), bb = placedAabb(B);
      const gap = Math.max(ba.min[2], bb.min[2]) <= Math.min(ba.max[2], bb.max[2]) + 3
        && Math.min(ba.max[2], bb.max[2]) + 3 >= Math.max(ba.min[2], bb.min[2]);
      const zGap = Math.max(0, Math.max(ba.min[2], bb.min[2]) - Math.min(ba.max[2], bb.max[2]));
      if (!gap && zGap > 3) { skipped.push(`${A.id}↔${B.id}: 면 간격 ${zGap.toFixed(1)}mm > 3 — 접합 아님`); continue; }
      const holeD = Math.min(pa.boltHoleD, pb.boltHoleD);
      const bolt = snapBolt(Math.max(4, holeD - 2)); // 볼트홀=호칭+2mm 관례(명시)
      if (!bolt.ok) { skipped.push(`${A.id}↔${B.id}: 볼트홀 ⌀${holeD} 표준 M 스냅 실패`); continue; }
      const grip = pa.thickness + pb.thickness;
      const need = grip + bolt.m * (0.8 + 0.3 + 0.25); // 너트+와셔2+돌출
      const lengthMm = STD_LEN.find((L) => L >= need) ?? Math.ceil(need / 10) * 10;
      sets.push({
        a: A.id ?? `#${flanges[a].i}`, b: B.id ?? `#${flanges[b].i}`,
        count: pa.boltCount, m: bolt.m, lengthMm, gripMm: grip,
        label: `${pa.boltCount}×M${bolt.m}×${lengthMm} 육각볼트 세트(너트 1·평와셔 2/본)`,
      });
    }
  }
  return {
    sets,
    ...(skipped.length ? { skipped } : {}),
    note: '플랜지 짝 자동 볼트 세트(무회전 v1) — 강도등급·개스킷 두께·조임 토크=입력 영역(명시). 발주 전 규격서 대조.',
  };
}
