/**
 * stage-notifications.ts — Stage 전환 → 알림 카피 매핑.
 *
 * 워커가 nf_stage_event 한 행을 처리할 때 호출하는 단일 진입점.
 * 알림 채널(이메일/Slack/Webhook)은 dispatcher가 추상화하고, 카피는
 * 본 모듈의 TEMPLATE 테이블에서 결정된다.
 *
 * 템플릿 변수 규칙(BM-3 보강안 §2):
 *   {userName}      유저 표시 이름
 *   {currentStage}  전환 후 stage (예: "C")
 *   {previousStage} 전환 전 stage (예: "A")
 *   {upsellLink}    Stage별 다음 행동 유도 URL
 *   {cumulativeKrw} 누적 거래액 (천 단위 콤마 포맷)
 *
 * 변수는 {key} 형태로 작성하고 renderTemplate가 안전하게 치환한다.
 * 다국어(기능 #42) 도입 시 locale 키만 추가하면 되도록 KR/EN 양쪽을
 * 미리 마련해 둔다.
 */

import { sendEmail } from './email';
import type { Stage } from './stage-engine';

// ─── 템플릿 변수 ────────────────────────────────────────────────────────

export interface TemplateVars {
  userName:      string;
  currentStage:  Stage;
  previousStage: Stage;
  upsellLink:    string;
  cumulativeKrw: number;
}

/**
 * `{key}` 토큰을 안전하게 치환. 정의되지 않은 키는 그대로 두어 디버깅을
 * 용이하게 한다(메일에 `{foo}`가 보이면 즉시 누락 인지).
 */
export function renderTemplate(tpl: string, vars: Partial<TemplateVars>): string {
  return tpl.replace(/\{(\w+)\}/g, (full, key: string) => {
    const v = (vars as Record<string, unknown>)[key];
    if (v === undefined || v === null) return full;
    if (typeof v === 'number') {
      return key.endsWith('Krw') ? v.toLocaleString('ko-KR') : String(v);
    }
    return String(v);
  });
}

// ─── 템플릿 정의 ────────────────────────────────────────────────────────

type Locale = 'ko' | 'en';
type TransitionKey = `${Stage}_${Stage}`;

interface TransitionTemplate {
  subject: string;
  bodyHtml: string;
  /** 콘솔/Slack용 단문 — 1줄 요약. */
  digest:   string;
}

/**
 * 명시된 전환만 알림. 정의되지 않은 (from→to) 조합은 워커가 무음 처리.
 * Stage 정의는 docs/strategy/bm-matrix.md §1과 lockstep.
 */
const TEMPLATES: Partial<Record<TransitionKey, Record<Locale, TransitionTemplate>>> = {
  'A_C': {
    ko: {
      subject: '[NexyFab] {userName}님, 첫 거래 완료를 축하합니다 🎉',
      bodyHtml: `
        <p>{userName}님, 첫 주문이 성공적으로 결제되었습니다.</p>
        <p>이제 <strong>번들 견적</strong>과 <strong>재주문 단축키</strong>를 사용할 수 있습니다.
        다음 주문을 같은 파트너와 진행하면 단가가 자동으로 5~15% 낮아집니다.</p>
        <p><a href="{upsellLink}">번들 견적 만들러 가기 →</a></p>
      `,
      digest: '{userName} → Stage C 진입 (첫 거래)',
    },
    en: {
      subject: '[NexyFab] Welcome to repeat ordering, {userName} 🎉',
      bodyHtml: `
        <p>Hi {userName}, your first order has been paid.</p>
        <p>You now have access to <strong>bundled quotes</strong> and
        <strong>reorder shortcuts</strong> — repeat orders with the same partner
        get an automatic 5–15% discount.</p>
        <p><a href="{upsellLink}">Create a bundled quote →</a></p>
      `,
      digest: '{userName} → Stage C (first order)',
    },
  },
  'C_D': {
    ko: {
      subject: '[NexyFab] 단골 고객 혜택이 열렸습니다',
      bodyHtml: `
        <p>{userName}님, 누적 거래액이 {cumulativeKrw}원을 넘었습니다.</p>
        <p>지금부터 거래 수수료가 <strong>4%로 인하</strong>되며, 우선 견적
        대기열과 마진 분석 대시보드를 사용할 수 있습니다.</p>
        <p><a href="{upsellLink}">대시보드 열기 →</a></p>
      `,
      digest: '{userName} → Stage D (반복 거래, 누적 {cumulativeKrw}원)',
    },
    en: {
      subject: '[NexyFab] Loyalty benefits unlocked',
      bodyHtml: `
        <p>Hi {userName}, your cumulative orders crossed {cumulativeKrw} KRW.</p>
        <p>Transaction fees are now <strong>reduced to 4%</strong>, and you
        get priority quote access plus the margin analytics dashboard.</p>
        <p><a href="{upsellLink}">Open dashboard →</a></p>
      `,
      digest: '{userName} → Stage D (repeat buyer, {cumulativeKrw} KRW)',
    },
  },
  'D_E': {
    ko: {
      subject: '[NexyFab] 엔터프라이즈 견적 라인이 열렸습니다',
      bodyHtml: `
        <p>{userName}님, 조직 단위 거래 규모에 도달했습니다.</p>
        <p>전담 매니저 배정과 SLA 기반 우선 생산을 제공하는
        <strong>엔터프라이즈 라인</strong>을 안내드립니다. 영업 담당자가
        영업일 기준 1일 내에 연락드립니다.</p>
        <p><a href="{upsellLink}">엔터프라이즈 상담 신청 →</a></p>
      `,
      digest: '{userName} → Stage E (엔터프라이즈 후보, 누적 {cumulativeKrw}원)',
    },
    en: {
      subject: '[NexyFab] Enterprise pipeline opened',
      bodyHtml: `
        <p>Hi {userName}, you've reached organization-tier volume.</p>
        <p>You qualify for the <strong>enterprise line</strong>: dedicated account
        manager, SLA-backed production priority. Our sales team will reach out
        within one business day.</p>
        <p><a href="{upsellLink}">Request enterprise consultation →</a></p>
      `,
      digest: '{userName} → Stage E (enterprise prospect, {cumulativeKrw} KRW)',
    },
  },
};

// ─── Dispatcher ────────────────────────────────────────────────────────

export interface NotificationTarget {
  userId:    string;
  email:     string;
  name:      string;
  /** 기본 'ko'. 추후 nf_users.locale 컬럼이 추가되면 그걸 사용. */
  locale?:   Locale;
}

export interface DispatchInput {
  fromStage: Stage;
  toStage:   Stage;
  vars:      TemplateVars;
}

export interface DispatchResult {
  ok:       boolean;
  reason?:  string;
  /** 디버깅/운영용: 워커가 콘솔/Slack에 한 줄 출력할 수 있는 요약. */
  digest?:  string;
}

/**
 * 단일 알림 발송. 실패 시 throw 하지 않고 `{ ok: false, reason }`로 반환 —
 * 워커는 이 결과로 retry_count/last_error를 갱신한다.
 *
 * 템플릿이 없는 전환은 정상 케이스(예: A→D 직행 시 D만 알림)이므로
 * `ok: true, reason: 'no_template'`로 처리해 워커가 재시도하지 않게 한다.
 */
export async function dispatchStageNotification(
  target: NotificationTarget,
  input: DispatchInput,
): Promise<DispatchResult> {
  const tpl = TEMPLATES[`${input.fromStage}_${input.toStage}` as TransitionKey];
  if (!tpl) {
    return { ok: true, reason: 'no_template' };
  }

  const locale = target.locale ?? 'ko';
  const t = tpl[locale] ?? tpl.ko;

  const subject = renderTemplate(t.subject,  input.vars);
  const html    = renderTemplate(t.bodyHtml, input.vars);
  const digest  = renderTemplate(t.digest,   input.vars);

  if (!target.email) {
    // 이메일 없는 유저(드물지만 OAuth 등으로 존재 가능) — 콘솔만 남기고 성공 처리.
    console.log('[stage-notify:no-email]', digest);
    return { ok: true, reason: 'no_email', digest };
  }

  const sent = await sendEmail({ to: target.email, subject, html });
  if (!sent.ok) {
    return { ok: false, reason: sent.error ?? 'send_failed', digest };
  }
  return { ok: true, digest };
}
