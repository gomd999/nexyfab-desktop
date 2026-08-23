'use client';

import { use } from 'react';
import PricingCards from '@/components/nexyfab/PricingCards';
import VerificationBanner from '@/components/nexyfab/VerificationBanner';
import { useAuthStore } from '@/hooks/useAuth';
import { createCommercialLocalizer } from '@/lib/i18n/commercialLocalizer';
import { toIsoLang, type IsoLang } from '@/lib/i18n/normalize';
import { getSsoCommercialCopy } from '@/lib/i18n/ssoCommercialStatus';

type Copy = { title: string; description: string; aiLabel: string; aiHeading: string; trialNote: string; faqTitle: string; enterpriseTitle: string; enterpriseDescription: string; enterpriseCta: string };
const COPY: Record<IsoLang, Copy> = {
  ko: { title: '브라우저에서 설계, AI가 판단, 제조사가 만든다', description: '무료로 시작하고, 필요할 때 업그레이드하세요. 구독은 언제든 취소할 수 있습니다.', aiLabel: '새로운 AI 기능', aiHeading: '4가지 AI가 설계 → 견적 → 공급사를 한 번에', trialNote: '무료 플랜은 각 기능을 월 3–5회 체험 — Pro부터 무제한', faqTitle: '자주 묻는 질문', enterpriseTitle: '대규모 팀이나 맞춤 계약이 필요하신가요?', enterpriseDescription: '', enterpriseCta: 'Enterprise 문의' },
  en: { title: 'Design. Analyze. Manufacture.', description: "Start free, upgrade when you're ready. Cancel anytime.", aiLabel: 'New AI Features', aiHeading: 'Four AIs from design to supplier in one flow', trialNote: 'Free plan: 3–5 trials/month per feature — Pro: unlimited', faqTitle: 'FAQ', enterpriseTitle: 'Need Enterprise or a custom contract?', enterpriseDescription: '', enterpriseCta: 'Contact Enterprise' },
  ja: { title: '設計。解析。製造。', description: '無料で始めて、必要なときにアップグレード。いつでも解約できます。', aiLabel: '新しいAI機能', aiHeading: '設計から見積もり、サプライヤーまで4つのAIで一つの流れ', trialNote: '無料プランは各機能を月3〜5回 — Proは無制限', faqTitle: 'よくある質問', enterpriseTitle: '大規模チームやカスタム契約が必要ですか？', enterpriseDescription: '', enterpriseCta: 'Enterpriseに問い合わせ' },
  zh: { title: '设计。分析。制造。', description: '免费开始，准备好后再升级。随时可以取消。', aiLabel: '全新 AI 功能', aiHeading: '四种 AI 打通设计、报价与供应商流程', trialNote: '免费方案：每项功能每月试用 3–5 次 — Pro：无限使用', faqTitle: '常见问题', enterpriseTitle: '需要企业版或定制合同吗？', enterpriseDescription: '', enterpriseCta: '联系 Enterprise' },
  es: { title: 'Diseña. Analiza. Fabrica.', description: 'Empieza gratis y actualiza cuando quieras. Cancela en cualquier momento.', aiLabel: 'Nuevas funciones de IA', aiHeading: 'Cuatro IA conectan diseño, cotización y proveedores', trialNote: 'Plan gratuito: 3–5 pruebas al mes por función — Pro: ilimitado', faqTitle: 'Preguntas frecuentes', enterpriseTitle: '¿Necesitas Enterprise o un contrato personalizado?', enterpriseDescription: '', enterpriseCta: 'Contactar con Enterprise' },
  ar: { title: 'صمّم. حلّل. صنّع.', description: 'ابدأ مجاناً وقم بالترقية عندما تكون مستعداً. يمكنك الإلغاء في أي وقت.', aiLabel: 'ميزات ذكاء اصطناعي جديدة', aiHeading: 'أربع أدوات ذكاء اصطناعي من التصميم إلى المورد في تدفق واحد', trialNote: 'الخطة المجانية: 3–5 تجارب شهرياً لكل ميزة — Pro: استخدام غير محدود', faqTitle: 'الأسئلة الشائعة', enterpriseTitle: 'هل تحتاج إلى Enterprise أو عقد مخصص؟', enterpriseDescription: '', enterpriseCta: 'تواصل مع Enterprise' },
};

type Feature = { icon: string; accent: string; ko: [string, string]; en: [string, string]; localized?: Record<Exclude<IsoLang, 'ko' | 'en'>, [string, string]> };
const FEATURES: Feature[] = [
  { icon: '🤖', accent: '#388bfd', ko: ['AI DFM 설명 + 단가 영향', 'DFM 이슈의 근본 원인과 각 수정안의 실시간 단가 변화를 보여줍니다.'], en: ['AI DFM Explainer + Cost Impact', 'Explains DFM root cause and shows real-time cost delta for each fix.'], localized: { ja: ['AI DFM解説 + コスト影響', 'DFMの原因と各修正によるコスト差をリアルタイムで表示します。'], zh: ['AI DFM 说明 + 成本影响', '解释 DFM 根因并显示每项修复的实时成本变化。'], es: ['Explicador DFM con IA + impacto en costes', 'Explica la causa del DFM y muestra el cambio de coste de cada corrección。'], ar: ['شرح DFM بالذكاء الاصطناعي + تأثير التكلفة', 'يوضح سبب مشكلة DFM ويعرض تغير التكلفة لكل إصلاح.'] } },
  { icon: '🧭', accent: '#a371f7', ko: ['AI 공정 라우터', '형상·재질·수량에 최적인 제조 공정을 추천하고 단가·리드타임을 비교합니다.'], en: ['AI Process Router', 'Recommends the optimal process for your shape and compares cost & lead time.'], localized: { ja: ['AI工程ルーター', '形状・材質・数量に最適な工程を提案し、コストとリードタイムを比較します。'], zh: ['AI 工艺路由器', '为形状推荐最佳工艺，并比较成本和交期。'], es: ['Enrutador de procesos con IA', 'Recomienda el proceso óptimo y compara coste y plazo.'], ar: ['موجّه العمليات بالذكاء الاصطناعي', 'يوصي بالعملية المثلى ويقارن التكلفة ومدة التنفيذ.'] } },
  { icon: '🎯', accent: '#39c5bb', ko: ['AI 공급사 Top 3', '재질·공정·수량을 분석해 최적 공급사 Top 3와 RFQ 작성 포인트를 제시합니다.'], en: ['AI Supplier Top-3', 'Top-3 suppliers ranked by fit with tailored RFQ talking points.'], localized: { ja: ['AIサプライヤーTop 3', '適合度で上位3社をランキングし、RFQの要点を提案します。'], zh: ['AI 供应商 Top-3', '按匹配度排名前三家供应商，并提供 RFQ 要点。'], es: ['Top 3 proveedores con IA', 'Clasifica los tres proveedores más adecuados y propone puntos para la RFQ.'], ar: ['أفضل 3 مورّدين بالذكاء الاصطناعي', 'يرتّب أفضل ثلاثة مورّدين ويقترح نقاط RFQ مخصصة.'] } },
  { icon: '💰', accent: '#d29922', ko: ['비용 절감 코파일럿', '"비용 20% 줄여줘" 같은 자연어로 설계·재료·공정 변경 제안을 받습니다.'], en: ['Design-for-Cost Copilot', 'Ask "cut cost by 20%" in plain language — get design, material, and process changes.'], localized: { ja: ['コスト最適化コパイロット', '「コストを20%削減」のように依頼し、設計・材料・工程の変更案を得られます。'], zh: ['设计降本 Copilot', '用自然语言提出“降低 20% 成本”，获取设计、材料和工艺建议。'], es: ['Copiloto de diseño para costes', 'Pide reducir un 20% el coste y recibe cambios de diseño, material y proceso.'], ar: ['مساعد خفض التكلفة', 'اطلب خفض التكلفة 20% بلغة طبيعية واحصل على تغييرات في التصميم والمواد والعملية.'] } },
  { icon: '⌖', accent: '#7ee787', ko: ['PMI / MBD (Y14.41)', 'GD&T 풀 스펙 + 데이텀 타겟 + 표면조도 + STEP AP242 export.'], en: ['PMI / MBD (Y14.41)', 'Full GD&T + datum targets + surface finish + STEP AP242 export.'] },
  { icon: '📚', accent: '#79c0ff', ko: ['엔지니어링 카탈로그 RAG', '베어링·시일·재료·끼워맞춤·볼트 가이드를 LLM이 인용하여 적용.'], en: ['Engineering Catalog RAG', 'Bearings, seals, materials, fits, bolts — RAG-cited and applied.'] },
  { icon: '🧰', accent: '#f0b34c', ko: ['표준 라이브러리 (DIN/JIS/ASME)', 'DIN 625 베어링, DIN 6885 키, ASME 패스너, 드릴 사이즈 lookup.'], en: ['Standards Library (DIN/JIS/ASME)', 'DIN 625 bearings, DIN 6885 keys, ASME fasteners, drill size lookup.'] },
  { icon: '💨', accent: '#56d4dd', ko: ['시뮬레이션 6종 (Pro+)', 'CFD · MBD · 5축 CAM · 사출 충전 · 광학 · 열 — Pro 월 20회, Team 100회.'], en: ['Simulation Suite (Pro+)', 'CFD · MBD · 5-axis CAM · mold fill · optics · thermal — Pro 20/mo, Team 100/mo.'] },
];

const FAQ: Array<{ ko: string; en: string; aKo: string; aEn: string }> = [
  { ko: 'Free 플랜은 어디까지 쓸 수 있나요?', en: 'What does the Free plan include?', aKo: '프로젝트 3개까지 저장하고 STL 내보내기와 기본 AI 채팅을 무료로 사용할 수 있습니다. DFM 분석, FEA, 비용 추정은 Pro부터 가능합니다.', aEn: 'Up to 3 saved projects, STL export, and basic AI chat. DFM analysis, FEA, and cost estimation require Pro.' },
  { ko: 'Pro와 Team의 차이는?', en: 'What is the difference between Pro and Team?', aKo: 'Pro는 개인용으로 모든 분석 기능과 무제한 프로젝트를 제공합니다. Team은 실시간 협업과 공유 워크스페이스를 추가합니다.', aEn: 'Pro is for individuals with all analysis features and unlimited projects. Team adds real-time collaboration and shared workspaces.' },
  { ko: '3D 모델러를 단독으로 사용할 수 있나요?', en: 'Can I use the 3D Modeler standalone?', aKo: '예. Pro 플랜으로 전체 3D Modeler를 사용할 수 있습니다. NexyFab 매칭 플랜에는 Pro 이용권이 포함됩니다.', aEn: 'Yes — the Pro plan gives full 3D Modeler access. NexyFab matching plans include Pro access.' },
  { ko: '결제는 어떻게 이루어지나요?', en: 'How does billing work?', aKo: 'Stripe를 통한 카드 결제입니다. 매월 자동 갱신되며 언제든 해지할 수 있습니다.', aEn: 'Monthly Stripe card billing. Cancel anytime — access continues until the end of the billing period.' },
  { ko: 'Enterprise는 어떻게 신청하나요?', en: 'How do I get Enterprise?', aKo: '아래 Enterprise 문의 버튼을 통해 연락해 주시면 맞춤 견적을 제공합니다.', aEn: 'Contact us via the Enterprise button below for a custom quote.' },
];
const FAQ_LOCALES: Record<Exclude<IsoLang, 'ko' | 'en'>, Array<{ q: string; a: string }>> = {
  ja: [
    { q: '無料プランには何が含まれますか？', a: '最大3件のプロジェクト保存、STLエクスポート、基本AIチャットを利用できます。DFM解析、FEA、コスト見積もりはProが必要です。' },
    { q: 'ProとTeamの違いは？', a: 'Proは個人向けで、すべての解析機能と無制限プロジェクトを提供します。Teamではリアルタイム共同作業と共有ワークスペースが追加されます。' },
    { q: '3Dモデラーを単独で使えますか？', a: 'はい。Proプランで3Dモデラーをフルに利用できます。NexyFabのマッチングプランにはPro利用が含まれます。' },
    { q: '請求はどのように行われますか？', a: 'Stripeによる月次カード請求です。いつでも解約でき、請求期間の終了まで利用できます。' },
    { q: 'Enterpriseを利用するには？', a: '下のEnterpriseボタンからお問い合わせください。カスタム見積もりをご案内します。' },
  ],
  zh: [
    { q: '免费方案包含哪些内容？', a: '可保存最多 3 个项目、导出 STL 并使用基础 AI 聊天。DFM 分析、FEA 和成本估算需要 Pro。' },
    { q: 'Pro 和 Team 有什么区别？', a: 'Pro 面向个人，提供全部分析功能和无限项目。Team 增加实时协作和共享工作区。' },
    { q: '可以单独使用 3D 建模器吗？', a: '可以。Pro 方案提供完整的 3D 建模器访问权限，NexyFab 匹配方案也包含 Pro 使用权。' },
    { q: '如何计费？', a: '通过 Stripe 按月刷卡计费。可以随时取消，当前计费周期结束前仍可使用。' },
    { q: '如何获得 Enterprise？', a: '请通过下方 Enterprise 按钮联系我们，我们会提供定制报价。' },
  ],
  es: [
    { q: '¿Qué incluye el plan Free?', a: 'Incluye hasta 3 proyectos guardados, exportación STL y chat básico con IA. El análisis DFM, FEA y los costes requieren Pro.' },
    { q: '¿Cuál es la diferencia entre Pro y Team?', a: 'Pro es para usuarios individuales con todas las funciones de análisis y proyectos ilimitados. Team añade colaboración en tiempo real y espacios compartidos.' },
    { q: '¿Puedo usar el modelador 3D de forma independiente?', a: 'Sí. El plan Pro ofrece acceso completo al modelador 3D y los planes de matching de NexyFab incluyen acceso Pro.' },
    { q: '¿Cómo funciona la facturación?', a: 'Facturación mensual con tarjeta mediante Stripe. Cancela cuando quieras y conserva el acceso hasta el final del periodo.' },
    { q: '¿Cómo obtengo Enterprise?', a: 'Contacta con nosotros mediante el botón Enterprise para recibir un presupuesto personalizado.' },
  ],
  ar: [
    { q: 'ماذا تتضمن الخطة المجانية؟', a: 'تتضمن حفظ 3 مشاريع كحد أقصى وتصدير STL ومحادثة أساسية بالذكاء الاصطناعي. يلزم Pro لتحليل DFM وFEA وتقدير التكلفة.' },
    { q: 'ما الفرق بين Pro وTeam؟', a: 'Pro للأفراد مع جميع ميزات التحليل ومشاريع غير محدودة. تضيف Team التعاون الفوري ومساحات العمل المشتركة.' },
    { q: 'هل يمكنني استخدام المصمم ثلاثي الأبعاد بشكل مستقل؟', a: 'نعم. تمنحك خطة Pro وصولاً كاملاً إلى المصمم ثلاثي الأبعاد، وتتضمن خطط المطابقة في NexyFab وصول Pro.' },
    { q: 'كيف تتم الفوترة؟', a: 'فوترة شهرية بالبطاقة عبر Stripe. يمكنك الإلغاء في أي وقت ويستمر الوصول حتى نهاية فترة الفوترة.' },
    { q: 'كيف أحصل على Enterprise؟', a: 'تواصل معنا عبر زر Enterprise أدناه للحصول على عرض مخصص.' },
  ],
};

export default function NexyfabPricingPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = use(params);
  const iso = toIsoLang(lang);
  const L = createCommercialLocalizer(lang);
  const copy = COPY[iso];
  const ssoCopy = getSsoCommercialCopy(lang);
  const user = useAuthStore(s => s.user);
  const faqByLocale: Record<IsoLang, Array<{ q: string; a: string }>> = {
    ko: FAQ.map(item => ({ q: item.ko, a: item.aKo })),
    en: FAQ.map(item => ({ q: item.en, a: item.aEn })),
    ja: FAQ_LOCALES.ja, zh: FAQ_LOCALES.zh, es: FAQ_LOCALES.es, ar: FAQ_LOCALES.ar,
  };
  const faq = faqByLocale[iso];

  return <div style={{ minHeight: '100vh', background: '#0d1117', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
    <VerificationBanner lang={lang} />
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '60px 24px' }}>
      <div style={{ textAlign: 'center', marginBottom: 56 }}>
        <p style={{ margin: '0 0 12px', fontSize: 12, fontWeight: 700, color: '#388bfd', letterSpacing: '0.1em', textTransform: 'uppercase' }}>NexyFab Pricing</p>
        <h1 style={{ margin: '0 0 16px', fontSize: 36, fontWeight: 800, color: '#e6edf3', lineHeight: 1.2 }}>{copy.title}</h1>
        <p style={{ margin: '0 auto', fontSize: 16, color: '#6e7681', maxWidth: 520 }}>{copy.description}</p>
      </div>
      <div style={{ marginBottom: 56 }}>
        <p style={{ textAlign: 'center', margin: '0 0 8px', fontSize: 11, fontWeight: 700, color: '#a371f7', letterSpacing: '0.1em', textTransform: 'uppercase' }}>{copy.aiLabel}</p>
        <h2 style={{ textAlign: 'center', margin: '0 0 28px', fontSize: 22, fontWeight: 800, color: '#e6edf3' }}>{copy.aiHeading}</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          {FEATURES.map(feature => {
            const catalogPair = [L(feature.ko[0], feature.en[0]), L(feature.ko[1], feature.en[1])] as [string, string];
            const localizedPair: Partial<Record<Exclude<IsoLang, 'ko' | 'en'>, [string, string]>> = feature.localized ?? {};
            const pairs: Record<IsoLang, [string, string]> = { ko: feature.ko, en: feature.en, ja: localizedPair.ja ?? catalogPair, zh: localizedPair.zh ?? catalogPair, es: localizedPair.es ?? catalogPair, ar: localizedPair.ar ?? catalogPair };
            const [title, description] = pairs[iso];
            return <div key={feature.en[0]} style={{ background: '#161b22', border: `1px solid ${feature.accent}33`, borderRadius: 10, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ fontSize: 20 }}>{feature.icon}</span><span style={{ fontSize: 13, fontWeight: 800, color: feature.accent }}>{title}</span></div>
              <p style={{ margin: 0, fontSize: 12, color: '#8b949e', lineHeight: 1.5 }}>{description}</p>
            </div>;
          })}
        </div>
        <p style={{ textAlign: 'center', margin: '14px 0 0', fontSize: 12, color: '#6e7681' }}>{copy.trialNote}</p>
      </div>
      <PricingCards lang={lang} currentPlan={user?.plan} />
      <div style={{ marginTop: 72 }}>
        <h2 style={{ textAlign: 'center', margin: '0 0 32px', fontSize: 22, fontWeight: 700, color: '#e6edf3' }}>{copy.faqTitle}</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 640, margin: '0 auto' }}>{faq.map((item, i) => <div key={i} style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 10, padding: '16px 20px' }}><p style={{ margin: '0 0 6px', fontWeight: 700, fontSize: 13, color: '#e6edf3' }}>Q. {item.q}</p><p style={{ margin: 0, fontSize: 12, color: '#8b949e', lineHeight: 1.6 }}>{item.a}</p></div>)}</div>
      </div>
      <div style={{ marginTop: 56, textAlign: 'center', padding: '32px', background: '#161b22', border: '1px solid #30363d', borderRadius: 14 }}>
        <p style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700, color: '#e6edf3' }}>{copy.enterpriseTitle}</p>
        <div style={{ display: 'inline-block', marginBottom: 10, padding: '4px 10px', borderRadius: 999, background: '#d299221a', color: '#d29922', fontSize: 11, fontWeight: 700 }}>{ssoCopy.availabilityBadge}</div>
        <p style={{ margin: '0 0 20px', fontSize: 13, color: '#8b949e' }}>{ssoCopy.pricingDisclosure}</p>
        <a href="mailto:enterprise@nexyfab.com" style={{ display: 'inline-block', padding: '10px 28px', borderRadius: 8, background: '#21262d', border: '1px solid #d29922', color: '#d29922', fontSize: 13, fontWeight: 700, textDecoration: 'none' }}>{copy.enterpriseCta}</a>
      </div>
    </div>
  </div>;
}
