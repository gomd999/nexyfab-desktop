/**
 * 지지 체인 검사 (§14-b, 위시빌더 실전 260717) — "연결 ≠ 지지".
 * lumps=1(연결성)만으론 배관에 매달린 장비를 못 잡는다. base(데크·레일·프레임 부재)에서
 * 시작해 ①아래에서 받침(bearing: xy 겹침 + 수직 간격 ≤tol) ②부피 겹침(체결)을 전파,
 * 남는 부품 = 허공(부유) — 실제 설치 불가 신호.
 *
 * @param items [{ label, min:[x,y,z], max:[x,y,z], base?: boolean, ghost?: boolean }]
 * @param tol 수직 지지 간격 허용 mm · minBear xy 겹침 최소 mm(양축 모두)
 * @returns { supported: string[], floating: string[] }
 */
export function supportCheck(items, { tol = 8, minBear = 15 } = {}) {
  const act = items.filter((i) => !i.ghost);
  const supported = new Set(act.filter((i) => i.base).map((i) => i.label));
  const bearsOn = (a, b) => {
    const ox = Math.min(a.max[0], b.max[0]) - Math.max(a.min[0], b.min[0]);
    const oy = Math.min(a.max[1], b.max[1]) - Math.max(a.min[1], b.min[1]);
    if (ox < minBear || oy < minBear) return false;
    const oz = Math.min(a.max[2], b.max[2]) - Math.max(a.min[2], b.min[2]);
    if (oz > 0) return true;          // 부피 겹침 = 체결(스트랩·매립)
    const gap = a.min[2] - b.max[2];  // a 바닥 ↔ b 상면
    return gap >= -tol && gap <= tol; // 얹힘(bearing)
  };
  let moved = true;
  while (moved) {
    moved = false;
    for (const it of act) {
      if (supported.has(it.label)) continue;
      if (act.some((s) => supported.has(s.label) && bearsOn(it, s))) { supported.add(it.label); moved = true; }
    }
  }
  return {
    supported: [...supported],
    floating: act.filter((i) => !i.base && !supported.has(i.label)).map((i) => i.label),
  };
}
