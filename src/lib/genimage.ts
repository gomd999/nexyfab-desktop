/**
 * genimage.ts — 텍스트/사진 → 흰 배경 시안 이미지 (text→시안→2D도안→3D 진입층).
 *
 * 입력 커스텀 계층: 사용자 입력을 그대로 이미지 모델에 넘기지 않고, 다운스트림
 * 도안 판독(drawing/extract·extract-preset)이 잘 되도록 흰 배경·단일 객체·
 * 정면 뷰 지시문으로 감싼다(사용자 결정 2026-07-18: 입력부터 커스텀).
 *
 * 쿼터(사용자 결정): 비회원·무료 2회/일, 유료(pro/team/enterprise) 50회/일.
 * 회원=nf_usage_events metric 'image_gen' 24h 롤링(원자 트랜잭션), 비회원=라우트에서
 * 데모세션+IP 키 레이트리밋. 시안 이미지는 치수·형상 근거가 아님(정직 라벨) —
 * 도안 변환 시 기존 게이트(신뢰도·결정론 검증)를 그대로 통과해야 한다.
 */

export const GENIMAGE_DAILY_LIMITS: Record<string, number> = {
  free: 2,
  pro: 50,
  team: 50,
  enterprise: 50,
};
export const GENIMAGE_ANON_DAILY = 2;

const DOMAIN_HINT: Record<string, string> = {
  mech: '재질 힌트: 산업 장비/기계 부품 — 금속(스테인리스·도장강) 질감.',
  civil: '재질 힌트: 토목 구조물 — 콘크리트·강재 질감.',
  building: '재질 힌트: 건축 구조물 — 콘크리트 골조·외장재 질감.',
  landscape: '재질 힌트: 조경 시설물 — 방부목·강재 질감.',
  interior: '재질 힌트: 가구/인테리어 요소 — 목재·패브릭·금속 질감.',
};

/**
 * 사용자 입력 → 이미지 모델 프롬프트(커스텀 계층).
 * - 텍스트만: 흰 배경 규격의 신규 시안 생성 지시문으로 감싼다.
 * - 이미지 동반: 원본 형상·비례를 유지한 채 흰 배경으로 재현(배경 정리) 지시문.
 *   재해석 금지 — 시안은 어디까지나 시각 아이디에이션이며 치수 근거가 아니다.
 */
export function buildGenImagePrompt({ text, hasImage, domain }: { text?: string; hasImage: boolean; domain?: string }): string {
  const t = (text ?? '').trim().slice(0, 800);
  const hint = DOMAIN_HINT[domain ?? ''] ?? DOMAIN_HINT.mech;
  const rules = [
    '순수 흰색 배경(#FFFFFF) — 배경 소품·환경·바닥 텍스처 없음',
    '단일 객체만 화면 중앙에 배치',
    '정면에 가까운 뷰(입체감을 위한 약간의 등각 허용) — 극단적 원근·광각 금지',
    '균일한 스튜디오 조명, 그림자 없음(아주 옅은 접지 그림자만 허용)',
    '텍스트·치수·워터마크·로고·사람 없음',
    '제품 디자인 렌더링 스타일 — 윤곽과 부품 경계가 또렷할 것',
  ].join('\n- ');
  if (hasImage) {
    return `이 사진 속 주요 객체 1개를 아래 규격으로 다시 그려라.
형상·비례·부품 구성은 원본 그대로 유지(재해석·부품 추가/삭제 금지)하고, 배경·주변 물체·손·그림자만 제거한다.
- ${rules}
${hint}${t ? `\n추가 요청(형상 변경이 아닌 범위에서만 반영): ${t}` : ''}`;
  }
  return `다음 설명의 제품/부품 컨셉 시안 이미지를 1장 생성하라: "${t}"
반드시 지킬 규격:
- ${rules}
${hint}`;
}

/**
 * 회원 일일 슬롯 소모 — consumeMonthlyMetricSlot(plan-guard)과 같은 원자 패턴,
 * 창만 24h 롤링. 슬롯은 선소모(호출 실패에도 차감 — AI 비용 실발생, 기존 판정 유지).
 */
export async function consumeDailyImageSlot(
  userId: string,
  plan: string,
): Promise<{ ok: boolean; used: number; limit: number }> {
  const limit = GENIMAGE_DAILY_LIMITS[plan] ?? GENIMAGE_DAILY_LIMITS.free;
  const { getDbAdapter } = await import('./db-adapter');
  const db = getDbAdapter();
  const dayStart = Date.now() - 86_400_000;
  return db.transaction(async (tx) => {
    const row = await tx.queryOne<{ c: number }>(
      `SELECT COUNT(*) as c FROM nf_usage_events WHERE user_id = ? AND metric = 'image_gen' AND created_at > ?`,
      userId, dayStart,
    );
    const used = row?.c ?? 0;
    if (used >= limit) return { ok: false, used, limit };
    const id = `ue-${Math.random().toString(36).slice(2)}`;
    await tx.execute(
      `INSERT INTO nf_usage_events (id, user_id, product, metric, quantity, cycle_start, metadata, created_at) VALUES (?, ?, 'nexyfab', 'image_gen', 1, 0, NULL, ?)`,
      id, userId, Date.now(),
    );
    return { ok: true, used: used + 1, limit };
  });
}
