/**
 * Q5 — Outreach message templates for ops team.
 *
 * Pre-written Korean message bodies the operator can copy/paste into
 * KakaoTalk or paste into an email. Each template has placeholders
 * (e.g. {{factoryName}}) that the admin UI fills in from the RFQ
 * context.
 *
 * Templates are intentionally short, polite, and Korean-business-formal
 * (존댓말 + "께서" / "드립니다" 톤). They avoid making promises about
 * volume or pricing — those are negotiated per RFQ.
 */

export interface OutreachTemplate {
  id: string;
  /** When in the funnel this template applies. */
  stage: 'initial' | 'follow_up' | 'quote_request' | 'thanks_decline' | 'signup_invite';
  channel: 'kakao' | 'email' | 'either';
  title_ko: string;
  /** Subject for email; ignored for kakao. */
  subject_ko?: string;
  body_ko: string;
  /** Variable names the body references (for UI hints). */
  variables: string[];
}

export const OUTREACH_TEMPLATES: OutreachTemplate[] = [
  {
    id: 'initial_kakao',
    stage: 'initial',
    channel: 'kakao',
    title_ko: '첫 컨택 — 카톡 (간단)',
    body_ko: `안녕하세요, NexyFab 운영팀입니다.

{{factoryName}} 귀사의 가공 기술을 확인하고
저희 고객 RFQ 한 건을 추천드리고자 연락드립니다.

[RFQ 요약]
- 제품: {{shapeName}}
- 수량: {{quantity}}개
- 재질: {{materialName}}
- 희망 납기: {{deadline}}

견적 검토 가능하시면 회신 부탁드립니다.
도면(STEP/STL)은 회신 시 공유해드립니다.

NexyFab 드림`,
    variables: ['factoryName', 'shapeName', 'quantity', 'materialName', 'deadline'],
  },
  {
    id: 'initial_email',
    stage: 'initial',
    channel: 'email',
    title_ko: '첫 컨택 — 이메일 (정중)',
    subject_ko: '[NexyFab] {{shapeName}} 가공 견적 문의 — 수량 {{quantity}}개',
    body_ko: `{{factoryName}} 담당자님께,

안녕하세요, NexyFab 운영팀입니다.

귀사를 가공 분야 잠재 협력사로 추천드리며,
저희 고객의 RFQ 한 건의 견적 검토를 정중히 요청드립니다.

━━━━━ 프로젝트 요약 ━━━━━
• 제품명: {{shapeName}}
• 수량: {{quantity}}개
• 재질: {{materialName}}
• 공정: {{process}}
• 희망 납기: {{deadline}}
• 비고: {{note}}

도면 파일(STEP/STL)은 NDA 동의 후 공유드립니다.
회신 가능 여부와 검토에 필요한 추가 정보가 있으시면
회신 부탁드립니다.

감사합니다.

NexyFab 운영팀
{{operatorName}}
nexyfab@nexysys.com`,
    variables: ['factoryName', 'shapeName', 'quantity', 'materialName', 'process', 'deadline', 'note', 'operatorName'],
  },
  {
    id: 'follow_up_3day',
    stage: 'follow_up',
    channel: 'either',
    title_ko: '후속 컨택 (3일 후 무응답)',
    subject_ko: '[NexyFab] 견적 검토 문의 재연락 — {{shapeName}}',
    body_ko: `{{factoryName}} 담당자님,

안녕하세요. 며칠 전 견적 문의드린 건 관련 재연락드립니다.

[원 RFQ]
• 제품: {{shapeName}}
• 수량: {{quantity}}개
• 희망 납기: {{deadline}}

가능 여부 짧게라도 회신 주시면 감사하겠습니다.
검토가 어려우신 경우에도 회신 부탁드립니다.

NexyFab 드림`,
    variables: ['factoryName', 'shapeName', 'quantity', 'deadline'],
  },
  {
    id: 'quote_request_full',
    stage: 'quote_request',
    channel: 'either',
    title_ko: '도면 첨부 견적 요청',
    subject_ko: '[NexyFab] 견적서 작성 부탁드립니다 — {{shapeName}}',
    body_ko: `{{factoryName}} 담당자님,

검토 의향 주셔서 감사합니다.
첨부드린 도면 기준으로 견적서 작성 부탁드립니다.

━━━━━ 견적서 양식 ━━━━━
1. 단가 (수량 {{quantity}}개 기준)
2. 총액 (부가세 별도)
3. 납기 (영업일 기준)
4. 결제 조건
5. 유효 기한
6. 비고 (재질·표면·공차 가정 등)

NexyFab 정산 안내:
• 거래는 NexyFab 플랫폼을 통해 진행됩니다 (안전거래).
• NexyFab 수수료 8%가 견적가에서 공제됩니다.
• 거래 완료 후 D+30일에 일괄 송금됩니다.

상세 약관 + 가입 안내는 회신 시 매직 링크로 보내드립니다.

NexyFab 드림`,
    variables: ['factoryName', 'shapeName', 'quantity'],
  },
  {
    id: 'thanks_decline',
    stage: 'thanks_decline',
    channel: 'either',
    title_ko: '거절 회신에 감사 (관계 유지)',
    subject_ko: '[NexyFab] 검토 회신 감사드립니다',
    body_ko: `{{factoryName}} 담당자님,

검토 회신해주셔서 감사합니다.
이번 건은 진행이 어렵다고 이해했습니다.

향후 귀사 가공 분야에 맞는 RFQ가 있을 때
다시 연락드려도 될까요?

좋은 하루 되세요.

NexyFab 드림`,
    variables: ['factoryName'],
  },
  {
    id: 'signup_invite_magic',
    stage: 'signup_invite',
    channel: 'either',
    title_ko: '파트너 가입 매직 링크 (견적 도착 후)',
    subject_ko: '[NexyFab] 견적 등록 + 파트너 가입 안내',
    body_ko: `{{factoryName}} 담당자님,

견적 검토 진행 감사드립니다.

견적서 등록과 향후 거래 관리를 위해
NexyFab 파트너 가입을 안내드립니다.

🔗 1분 가입 링크 (개인정보 사전 입력됨):
{{inviteLink}}

가입 시 안내사항:
• 사업자 등록 번호와 담당자 연락처를 입력합니다.
• 파트너 약관에 동의하시면 즉시 활성화됩니다.
• 가입 후 본 RFQ 견적을 바로 작성하실 수 있습니다.

링크는 7일간 유효합니다.

NexyFab 드림`,
    variables: ['factoryName', 'inviteLink'],
  },
];

export function getTemplate(id: string): OutreachTemplate | null {
  return OUTREACH_TEMPLATES.find(t => t.id === id) ?? null;
}

export function listByStage(stage: OutreachTemplate['stage']): OutreachTemplate[] {
  return OUTREACH_TEMPLATES.filter(t => t.stage === stage);
}

/** Render a template by replacing {{var}} occurrences. Missing vars stay
 *  visible as {{var}} so the operator notices and fills manually. */
export function renderTemplate(tpl: OutreachTemplate, vars: Record<string, string>): { subject?: string; body: string } {
  const replace = (s: string) =>
    s.replace(/\{\{(\w+)\}\}/g, (m, k) => vars[k] ?? m);
  return {
    subject: tpl.subject_ko ? replace(tpl.subject_ko) : undefined,
    body: replace(tpl.body_ko),
  };
}
