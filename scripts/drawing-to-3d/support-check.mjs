/**
 * 지지 체인 검사 (§14-b, 위시빌더 실전 260717) — "연결 ≠ 지지".
 * lumps=1(연결성)만으론 배관에 매달린 장비를 못 잡는다. base(데크·레일·프레임 부재)에서
 * 시작해 ①아래에서 받침(bearing: xy 겹침 + 수직 간격 ≤tol) ②부피 겹침(체결)을 전파,
 * 남는 부품 = 허공(부유) — 실제 설치 불가 신호.
 *
 * + 면접촉 매립 제안(#5, 위시빌더 3차 "얹히는 부품은 1~5mm 매립 필수"의 자동화):
 *   bearing 은 성립하지만 부피 겹침이 없는(0겹침 면접촉) 쌍은 STL/STEP 융합에서 별도
 *   덩어리(lumps)로 떨어진다 — suggestTzMm(-2mm 매립) 수정 제안을 함께 반환한다.
 *
 * @param items [{ label, min:[x,y,z], max:[x,y,z], base?: boolean, ghost?: boolean }]
 * @param tol 수직 지지 간격 허용 mm · minBear xy 겹침 최소 mm(양축 모두)
 * @returns { supported: string[], floating: string[], faceContacts: [{part,on,gapMm,suggestTzMm}] }
 */
export function supportCheck(items, { tol = 8, minBear = 15, fastenBear = 40, embedMm = 2 } = {}) {
  const finite = (i) => i.min?.every?.(Number.isFinite) && i.max?.every?.(Number.isFinite);
  // AABB 미상(치수 null 등) 부품은 판정 불가 — floating 으로 단정하지 않고 unknown 으로 정직 분리
  const unknown = items.filter((i) => !i.ghost && !finite(i)).map((i) => i.label);
  const act = items.filter((i) => !i.ghost && finite(i));
  const supported = new Set(act.filter((i) => i.base).map((i) => i.label));
  const bearsOn = (a, b) => {
    const ox = Math.min(a.max[0], b.max[0]) - Math.max(a.min[0], b.min[0]);
    const oy = Math.min(a.max[1], b.max[1]) - Math.max(a.min[1], b.min[1]);
    const oz = Math.min(a.max[2], b.max[2]) - Math.max(a.min[2], b.min[2]);
    if (ox >= minBear && oy >= minBear) {
      if (oz > 0) return true;          // 부피 겹침 = 체결(스트랩·매립)
      const gap = a.min[2] - b.max[2];  // a 바닥 ↔ b 상면
      if (gap >= -tol && gap <= tol) return true; // 얹힘(bearing)
    }
    // 측면 면접촉 체결(보↔기둥 모멘트 접합 등): 한 수평축 면접촉 + 나머지 두 축 대면적(≥fastenBear).
    // 아래로 매달림(z 면접촉)은 지지로 안 봄 — "배관에 매달린 장비" 오탐 방지(위시빌더 원칙 유지).
    if (Math.abs(ox) <= tol && oy >= fastenBear && oz >= fastenBear) return true;
    if (Math.abs(oy) <= tol && ox >= fastenBear && oz >= fastenBear) return true;
    return false;
  };
  let moved = true;
  while (moved) {
    moved = false;
    for (const it of act) {
      if (supported.has(it.label)) continue;
      if (act.some((s) => supported.has(s.label) && bearsOn(it, s))) { supported.add(it.label); moved = true; }
    }
  }
  // 면접촉(0겹침 얹힘) 수집 — 지지는 OK 지만 메시 융합은 안 되는 쌍. 매립 제안(정직: 제안만, 자동 이동 없음).
  const faceContacts = [];
  for (const a of act) {
    if (a.base) continue;
    for (const b of act) {
      if (a === b) continue;
      const ox = Math.min(a.max[0], b.max[0]) - Math.max(a.min[0], b.min[0]);
      const oy = Math.min(a.max[1], b.max[1]) - Math.max(a.min[1], b.min[1]);
      if (ox < minBear || oy < minBear) continue;
      const oz = Math.min(a.max[2], b.max[2]) - Math.max(a.min[2], b.min[2]);
      if (oz > 0) continue; // 이미 매립(체결)
      const gap = a.min[2] - b.max[2];
      if (gap >= -0.01 && gap <= tol) {
        faceContacts.push({ part: a.label, on: b.label, gapMm: +gap.toFixed(2), suggestTzMm: -(gap + embedMm) });
      }
    }
  }
  return {
    supported: [...supported],
    floating: act.filter((i) => !i.base && !supported.has(i.label)).map((i) => i.label),
    unknown,
    faceContacts,
  };
}
