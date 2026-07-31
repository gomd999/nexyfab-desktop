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

type Locale = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';
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
    ja: {
      subject: '[NexyFab] {userName} 様、初回のお取引ありがとうございます 🎉',
      bodyHtml: `
        <p>{userName} 様、初回のご注文の決済が完了しました。</p>
        <p>これより <strong>バンドル見積</strong> と <strong>再注文ショートカット</strong> をご利用いただけます。
        同じパートナーへの再注文では単価が自動で 5〜15% 下がります。</p>
        <p><a href="{upsellLink}">バンドル見積を作成する →</a></p>
      `,
      digest: '{userName} → Stage C 到達（初回取引）',
    },
    zh: {
      subject: '[NexyFab] {userName}，祝贺您完成首次交易 🎉',
      bodyHtml: `
        <p>{userName}，您的首笔订单已成功付款。</p>
        <p>现在您可以使用<strong>打包报价</strong>和<strong>再次下单快捷方式</strong>。
        与同一合作伙伴再次下单时，单价将自动下调 5~15%。</p>
        <p><a href="{upsellLink}">去创建打包报价 →</a></p>
      `,
      digest: '{userName} → 进入 Stage C（首次交易）',
    },
    es: {
      subject: '[NexyFab] Enhorabuena por su primer pedido, {userName} 🎉',
      bodyHtml: `
        <p>Hola {userName}: su primer pedido se ha pagado correctamente.</p>
        <p>Ya puede usar los <strong>presupuestos agrupados</strong> y los
        <strong>accesos directos de repetición</strong>: al repetir pedido con el mismo socio,
        el precio unitario baja automáticamente entre un 5 % y un 15 %.</p>
        <p><a href="{upsellLink}">Crear un presupuesto agrupado →</a></p>
      `,
      digest: '{userName} → Etapa C (primer pedido)',
    },
    ar: {
      subject: '[NexyFab] تهانينا يا {userName} على إتمام أول عملية 🎉',
      bodyHtml: `
        <p>مرحباً {userName}، تم دفع طلبك الأول بنجاح.</p>
        <p>أصبح بإمكانك الآن استخدام <strong>عروض الأسعار المجمّعة</strong> و
        <strong>اختصارات إعادة الطلب</strong> — وعند إعادة الطلب مع الشريك نفسه
        ينخفض سعر الوحدة تلقائياً بنسبة ٥٪ إلى ١٥٪.</p>
        <p><a href="{upsellLink}">إنشاء عرض سعر مجمّع ←</a></p>
      `,
      digest: '{userName} ← المرحلة C (أول عملية)',
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
    ja: {
      subject: '[NexyFab] リピート特典が開放されました',
      bodyHtml: `
        <p>{userName} 様、累計取引額が {cumulativeKrw} ウォンを超えました。</p>
        <p>本日より取引手数料が <strong>4% に引き下げ</strong> となり、優先見積キューと
        マージン分析ダッシュボードをご利用いただけます。</p>
        <p><a href="{upsellLink}">ダッシュボードを開く →</a></p>
      `,
      digest: '{userName} → Stage D（リピート、累計 {cumulativeKrw} ウォン）',
    },
    zh: {
      subject: '[NexyFab] 常客权益已开通',
      bodyHtml: `
        <p>{userName}，您的累计交易额已超过 {cumulativeKrw} 韩元。</p>
        <p>自即日起交易手续费<strong>下调至 4%</strong>，并可使用优先报价队列
        与毛利分析看板。</p>
        <p><a href="{upsellLink}">打开看板 →</a></p>
      `,
      digest: '{userName} → Stage D（重复交易，累计 {cumulativeKrw} 韩元）',
    },
    es: {
      subject: '[NexyFab] Ventajas de cliente recurrente activadas',
      bodyHtml: `
        <p>Hola {userName}: sus pedidos acumulados han superado los {cumulativeKrw} KRW.</p>
        <p>A partir de ahora la comisión por transacción <strong>baja al 4 %</strong> y dispone de
        cola de presupuestos prioritaria y del panel de análisis de márgenes.</p>
        <p><a href="{upsellLink}">Abrir el panel →</a></p>
      `,
      digest: '{userName} → Etapa D (cliente recurrente, {cumulativeKrw} KRW)',
    },
    ar: {
      subject: '[NexyFab] تم تفعيل مزايا العميل المتكرر',
      bodyHtml: `
        <p>مرحباً {userName}، تجاوز إجمالي طلباتك {cumulativeKrw} وون.</p>
        <p>من الآن تنخفض رسوم المعاملات إلى <strong>٤٪</strong>، ويتاح لك طابور عروض
        الأسعار ذو الأولوية ولوحة تحليل الهوامش.</p>
        <p><a href="{upsellLink}">فتح لوحة التحكم ←</a></p>
      `,
      digest: '{userName} ← المرحلة D (عميل متكرر، {cumulativeKrw} وون)',
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
    ja: {
      subject: '[NexyFab] エンタープライズ見積ラインが開きました',
      bodyHtml: `
        <p>{userName} 様、組織単位の取引規模に到達しました。</p>
        <p>専任マネージャーの配置と SLA に基づく優先生産を提供する
        <strong>エンタープライズライン</strong>をご案内します。営業担当より
        1 営業日以内にご連絡いたします。</p>
        <p><a href="{upsellLink}">エンタープライズ相談を申し込む →</a></p>
      `,
      digest: '{userName} → Stage E（エンタープライズ候補、累計 {cumulativeKrw} ウォン）',
    },
    zh: {
      subject: '[NexyFab] 企业级报价通道已开通',
      bodyHtml: `
        <p>{userName}，您已达到组织级交易规模。</p>
        <p>我们为您提供<strong>企业通道</strong>：专属客户经理与基于 SLA 的优先生产。
        销售团队将在一个工作日内与您联系。</p>
        <p><a href="{upsellLink}">申请企业咨询 →</a></p>
      `,
      digest: '{userName} → Stage E（企业候选，累计 {cumulativeKrw} 韩元）',
    },
    es: {
      subject: '[NexyFab] Canal de presupuestos para empresas abierto',
      bodyHtml: `
        <p>Hola {userName}: ha alcanzado un volumen de nivel corporativo.</p>
        <p>Le presentamos la <strong>línea para empresas</strong>: gestor de cuenta dedicado
        y prioridad de producción con SLA. Nuestro equipo comercial se pondrá en contacto
        en un día hábil.</p>
        <p><a href="{upsellLink}">Solicitar asesoramiento para empresas →</a></p>
      `,
      digest: '{userName} → Etapa E (candidato corporativo, {cumulativeKrw} KRW)',
    },
    ar: {
      subject: '[NexyFab] تم فتح مسار عروض الأسعار للمؤسسات',
      bodyHtml: `
        <p>مرحباً {userName}، لقد بلغت حجم التعامل على مستوى المؤسسات.</p>
        <p>نقدّم لك <strong>مسار المؤسسات</strong>: مدير حساب مخصّص وأولوية إنتاج
        مدعومة باتفاقية مستوى خدمة. سيتواصل معك فريق المبيعات خلال يوم عمل واحد.</p>
        <p><a href="{upsellLink}">طلب استشارة للمؤسسات ←</a></p>
      `,
      digest: '{userName} ← المرحلة E (مرشّح مؤسسي، {cumulativeKrw} وون)',
    },
  },
};

// ─── Dispatcher ────────────────────────────────────────────────────────

export interface NotificationTarget {
  userId:    string;
  email:     string;
  name:      string;
  /**
   * 기본 'ko'.
   *
   * ⚠ 260802: 템플릿은 6언어를 갖췄지만 **`nf_users` 에 locale 컬럼이 없어**
   *   호출측이 값을 못 넘긴다 — 실제로는 아직 전원 'ko' 로 나간다.
   *   「번역했다」와 「그 언어로 나간다」는 다르다. 컬럼이 생기면 그때 닿는다.
   */
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
