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
 * + 인장 매닮 체인(260718, 현수교·닐센류): **선언된 인장 부재(tension:true — role
 *   hanger/cable/stay/saddle)에서 매달림**은 지지로 인정한다. 미선언 부품에 매달린
 *   경우(배관에 매달린 장비)는 종전대로 부유 — "연결≠지지" 원칙은 선언 기반으로만 완화.
 *
 * @param items [{ label, min:[x,y,z], max:[x,y,z], base?: boolean, ghost?: boolean, tension?: boolean }]
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
    // 인장 매닮(260718): **매닮 링크 어느 한쪽이 선언 인장 부재**면 인정 — b(위)가 인장
    // (행어에 매달린 보) 또는 a(자신)가 인장(슬래브에 정착된 로드). 무선언 쌍(배관에 매달린
    // 장비)은 종전대로 부유 — 원칙 완화는 역할 선언 기반으로만.
    if ((a.tension || b.tension) && ox >= minBear && oy >= minBear) {
      const hang = b.min[2] - a.max[2]; // b 하면 ↔ a 상면
      if (hang >= -tol && hang <= tol) return true;
    }
    // 덕트 플랜지 체결(260718): 덕트↔덕트 수직 접합은 플랜지 볼팅 관례로 하중 전달 —
    // 선언 역할(role 'duct') 쌍 한정. 드롭·분기 수직 접합의 정당 지지.
    if (a.role === 'duct' && b.role === 'duct' && ox >= minBear && oy >= minBear) {
      const hang = b.min[2] - a.max[2];
      if (hang >= -tol && hang <= tol) return true;
    }
    // 인장 체인(260718): 인장 부재끼리 축방향 미세 갭(미터 컷 — 케이블 밴드 관례)으로
    // 이웃하면 연결로 인정. 갭 허용 40mm·수직/횡 겹침 필요 — 선언 쌍 한정.
    if (a.tension && b.tension && oy >= minBear && oz >= minBear && ox >= -40) return true;
    // mech 조인트 선언 체결(260718c — 로봇류): role {joint,link,gripper} 쌍이 근접(전 축
    // 갭 ≤40mm — 링크 모서리 풀백 구간은 실기계에서 축/베어링이 채움 관례 명시·한 축 이상
    // 실겹침 ≥minBear)하면 볼팅/감속기 체결로 연결 — 선언 역할 한정.
    const MECH_J = ['joint', 'link', 'gripper'];
    if (MECH_J.includes(a.role) && MECH_J.includes(b.role)
      && ox >= -40 && oy >= -40 && oz >= -40 && Math.max(ox, oy, oz) >= minBear) return true;
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
