'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const SUPPORT = typeof process !== 'undefined' && process.env.NEXT_PUBLIC_SUPPORT_EMAIL
  ? process.env.NEXT_PUBLIC_SUPPORT_EMAIL
  : 'support@nexyfab.com';

type RefundDict = {
  kicker: string;
  title: string;
  desc1: string;
  desc2: string;
  s1Title: string;
  s1List: string[];
  s2Title: string;
  s2List: string[];
  s3Title: string;
  s3List: string[];
  s4Title: string;
  s4List: string[];
  s5Title: string;
  s5Desc: string;
  termsLink: string;
};

const dict: Record<'ko' | 'en' | 'ja' | 'zh', RefundDict> = {
  ko: {
    kicker: 'NexyFab · 환불 및 취소 안내',
    title: '환불 및 취소 안내',
    desc1: '결제·구독·제조 주문 등 유형별 환불·취소 절차를 안내합니다.',
    desc2: '세부 위약금·단계별 규정은 이용약관을 함께 확인해 주세요.',
    s1Title: '1. 공통 원칙',
    s1List: [
      '실제 결제는 토스페이먼츠(국내), Stripe·Airwallex(해외) 등 결제 대행사를 통해 이루어지며, 카드사·결제사의 취소·환불 처리 기간이 별도로 적용될 수 있습니다.',
      '본 안내와 이용약관이 상충하는 경우 이용약관이 우선합니다.',
    ],
    s2Title: '2. SaaS 구독(플랜) 환불',
    s2List: [
      '구독은 계정의 요금·결제 화면에서 해지할 수 있으며, 해지 후 현재 과금 주기 종료 시점까지 서비스가 유지된 뒤 무료 플랜 등으로 전환됩니다.',
      `구독 결제일로부터 7일 이내에 서비스를 이용하지 않은 경우, 이메일(${SUPPORT})로 전액 환불을 요청할 수 있습니다. 이후에는 환불이 제공되지 않을 수 있습니다.`,
      '연간 플랜 등 프로모션 조건이 있는 경우, 환불 시 할인 적용이 취소될 수 있습니다.',
    ],
    s3Title: '3. 제조 주문 등 플랫폼 결제 환불',
    s3List: [
      '결제 완료된 제조 주문에 대해서는 주문 상세 화면에서 환불 요청을 접수할 수 있습니다.',
      '접수 후 영업일 기준 1~3일 내 검토되며, 주문 상태·진행 단계에 따라 환불 가능 여부 및 금액이 달라질 수 있습니다.',
      '고객과 제조 파트너 간 별도 계약으로 진행되는 금액·분쟁은 당사자 간 협의를 우선합니다.',
    ],
    s4Title: '4. 매칭·프로젝트 수수료',
    s4List: [
      '매칭 신청비·중개 수수료 등은 이용약관 제8조(비용 및 위약금) 및 프로젝트 단계에 따릅니다.',
      '적합한 파트너를 찾지 못한 경우의 No-Risk 환불 등은 이용약관 및 별도 안내를 따릅니다.',
    ],
    s5Title: '5. 문의',
    s5Desc: '환불·취소와 관련하여 아래 이메일로 문의해 주시면 영업일 기준으로 답변드립니다.',
    termsLink: '이용약관 전문 보기',
  },
  en: {
    kicker: 'NexyFab · Refunds & Cancellations',
    title: 'Refund & Cancellation Policy',
    desc1: 'How refunds and cancellations work for subscriptions, orders, and fees.',
    desc2: 'For penalties and stage-specific rules, please also read our Terms of Use.',
    s1Title: '1. General principles',
    s1List: [
      'Payments are processed via providers such as Toss Payments (KR), Stripe, or Airwallex; card issuer or PSP timelines may apply.',
      'If this page conflicts with the Terms of Use, the Terms of Use prevail.',
    ],
    s2Title: '2. SaaS subscription refunds',
    s2List: [
      'You may cancel your subscription from your account billing area; access continues until the end of the paid period.',
      `If you have not used the service within 7 days of the subscription charge, you may request a full refund by email (${SUPPORT}). Refunds may not be available after that window.`,
      'Annual or promotional plans may be recalculated if a refund voids a discount.',
    ],
    s3Title: '3. Manufacturing order payments',
    s3List: [
      'For eligible paid orders, you may submit a refund request from the order detail page.',
      'We typically review within 1–3 business days; eligibility and amount depend on order status and progress.',
      'Amounts or disputes governed by a direct contract between you and a manufacturer are primarily resolved between the parties.',
    ],
    s4Title: '4. Matching and project fees',
    s4List: [
      'Matching fees and brokerage are governed by Article 8 of the Terms of Use and the project stage.',
      'No-Risk matching refunds, if applicable, follow the Terms of Use and any separate notices.',
    ],
    s5Title: '5. Contact',
    s5Desc: 'For refund or cancellation questions, email us and we will respond on business days.',
    termsLink: 'View Terms of Use',
  },
  ja: {
    kicker: 'NexyFab · 返金・キャンセル',
    title: '返金・キャンセルについて',
    desc1: 'サブスクリプション、注文、手数料ごとの返金・キャンセル手順です。',
    desc2: '段階別の違約金等は利用規約もご確認ください。',
    s1Title: '1. 共通原則',
    s1List: [
      '決済はToss、Stripe、Airwallex等の決済代行を通じて行われ、カード会社・PSPの処理日数が適用される場合があります。',
      '本ページと利用規約が抵触する場合は利用規約が優先します。',
    ],
    s2Title: '2. SaaSサブスクリプション',
    s2List: [
      '解約はアカウントの請求画面から可能で、現在の請求期間終了まで利用が継続されます。',
      `課金日から7日以内にサービス未利用の場合、メール（${SUPPORT}）で全額返金を申請できます。その後は返金できない場合があります。`,
    ],
    s3Title: '3. 製造注文の決済',
    s3List: [
      '対象の有料注文は注文詳細から返金申請が可能です。',
      '営業日1〜3日程度で審査し、注文状態により可否・金額が変わります。',
    ],
    s4Title: '4. マッチング・プロジェクト手数料',
    s4List: [
      '手数料・違約金は利用規約第8条およびプロジェクト段階に従います。',
    ],
    s5Title: '5. お問い合わせ',
    s5Desc: '返金・キャンセルに関するご質問はメールでお問い合わせください。',
    termsLink: '利用規約を見る',
  },
  zh: {
    kicker: 'NexyFab · 退款与取消',
    title: '退款与取消说明',
    desc1: '说明订阅、订单及各类费用的退款与取消流程。',
    desc2: '阶段性违约金等请以《服务条款》为准。',
    s1Title: '1. 一般原则',
    s1List: [
      '付款通过 Toss、Stripe、Airwallex 等支付机构处理，卡组织或支付机构处理时限可能适用。',
      '如本说明与《服务条款》冲突，以《服务条款》为准。',
    ],
    s2Title: '2. SaaS 订阅退款',
    s2List: [
      '可在账户账单页面取消订阅，当前计费周期结束前服务仍然有效。',
      `订阅付款日起 7 日内若未使用服务，可通过邮件（${SUPPORT}）申请全额退款；之后可能无法退款。`,
    ],
    s3Title: '3. 制造订单支付',
    s3List: [
      '符合条件的已付款订单可在订单详情页提交退款申请。',
      '通常在 1–3 个工作日内审核，是否退款及金额取决于订单状态与进度。',
    ],
    s4Title: '4. 匹配与项目费用',
    s4List: [
      '匹配费、佣金等遵循《服务条款》第八条及项目阶段约定。',
    ],
    s5Title: '5. 联系方式',
    s5Desc: '退款与取消相关问题请发邮件咨询，我们将在工作日回复。',
    termsLink: '查看服务条款',
  },
};

export default function RefundPolicyPage() {
  const pathname = usePathname();
  const langCode = pathname.split('/')[1] || 'en';
  const lang = (['en', 'kr', 'ja', 'cn', 'es', 'ar'].includes(langCode) ? langCode : 'en') as string;

  const langMap: Record<string, keyof typeof dict> = { kr: 'ko', en: 'en', ja: 'ja', cn: 'zh', es: 'en', ar: 'en' };
  const t = dict[langMap[lang] ?? 'en'];

  const section = (title: string, items: string[]) => (
    <div>
      <h2 style={{ fontSize: '22px', fontWeight: 800, marginBottom: '12px', color: '#111' }}>{title}</h2>
      <ul style={{ paddingLeft: '20px', listStyleType: 'disc', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  );

  return (
    <main style={{ minHeight: '100vh', backgroundColor: '#fff', paddingBottom: '80px' }}>
      <section style={{ textAlign: 'center', padding: '100px 20px 60px', backgroundColor: '#f8f9fb', marginBottom: '40px' }}>
        <p style={{ fontSize: '14px', letterSpacing: '0.15em', color: '#0056ff', marginBottom: '16px', fontWeight: 800 }}>{t.kicker}</p>
        <h1 style={{ fontSize: '42px', fontWeight: 900, marginBottom: '20px', color: '#111' }}>{t.title}</h1>
        <p style={{ color: '#555', fontSize: '16px', maxWidth: '700px', margin: '0 auto', lineHeight: 1.6 }}>
          {t.desc1}<br />{t.desc2}
        </p>
      </section>

      <section style={{ maxWidth: '800px', margin: '0 auto', padding: '0 20px', lineHeight: 1.8, color: '#333', fontSize: '16px', display: 'flex', flexDirection: 'column', gap: '36px' }}>
        {section(t.s1Title, t.s1List)}
        {section(t.s2Title, t.s2List)}
        {section(t.s3Title, t.s3List)}
        {section(t.s4Title, t.s4List)}

        <div>
          <h2 style={{ fontSize: '22px', fontWeight: 800, marginBottom: '12px', color: '#111' }}>{t.s5Title}</h2>
          <p style={{ marginBottom: '10px' }}>{t.s5Desc}</p>
          <p style={{ margin: 0 }}>
            <a href={`mailto:${SUPPORT}`} style={{ color: '#0b5cff', fontWeight: 700 }}>{SUPPORT}</a>
          </p>
        </div>

        <p style={{ margin: 0, paddingTop: '8px' }}>
          <Link href={`/${lang}/terms-of-use/`} prefetch style={{ color: '#0b5cff', fontWeight: 600 }}>
            {t.termsLink} →
          </Link>
        </p>
      </section>
    </main>
  );
}
