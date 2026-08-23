'use client';

import { useState } from 'react';
import { useAuthStore } from '@/hooks/useAuth';
import { toIsoLang, type IsoLang } from '@/lib/i18n/normalize';
import { getSsoCommercialCopy } from '@/lib/i18n/ssoCommercialStatus';

interface Props {
  lang?: string;
  currentPlan?: string;
}

interface BundleNote {
  title: string;
  detail: string;
}

interface Plan {
  id: 'free' | 'pro_lite' | 'pro' | 'team';
  name: string;
  price: string;
  priceAlt: string;
  priceJa: string;
  period: string;
  periodEn: string;
  periodJa: string;
  features: string[];
  featuresEn: string[];
  featuresJa: string[];
  cta: string;
  ctaEn: string;
  ctaJa: string;
  highlight?: boolean;
  bundleNote?: BundleNote;
  bundleNoteEn?: BundleNote;
  bundleNoteJa?: BundleNote;
}

const PLANS: Plan[] = [
  {
    id: 'free',
    name: 'Free',
    price: '₩0',
    priceAlt: '$0',
    priceJa: '¥0',
    period: '/월',
    periodEn: '/mo',
    periodJa: '/月',
    features: [
      '프로젝트 3개',
      '기본 형상 생성',
      '공유 링크 (72시간)',
      'AI 기능 월 3-5회 체험',
      '커뮤니티 지원',
    ],
    featuresEn: [
      'Up to 3 projects',
      'Basic shape generation',
      'Share link (72 hours)',
      'AI features 3-5 trials/month',
      'Community support',
    ],
    featuresJa: [
      'プロジェクト3件',
      '基本形状生成',
      '共有リンク（72時間）',
      'AI機能 月3-5回お試し',
      'コミュニティサポート',
    ],
    cta: '무료로 시작',
    ctaEn: 'Start Free',
    ctaJa: '無料で始める',
  },
  {
    // Pro Lite — Phase-2 funnel widening tier. Sits between Free (3 projects,
    // limited AI) and Pro (unlimited). Aimed at students / pre-seed HW makers
    // who feel hemmed in by Free but won't yet pay full Pro. Memory:
    // nexyfab-freemium 정책 (Free=1 project full workflow, Pro=2nd project).
    id: 'pro_lite',
    name: 'Pro Lite',
    price: '별도 협의',
    priceAlt: 'Contact us',
    priceJa: 'お問い合わせ',
    period: '',
    periodEn: '',
    periodJa: '',
    features: [
      '프로젝트 5개',
      '풀 형상 + 어셈블리 + 도면',
      '🤖 AI 형상 생성 (월 30회)',
      '🤖 AI DFM 설명 (월 30회)',
      '공유 링크 (14일)',
      'STL / STEP / DXF export',
      '커뮤니티 지원',
    ],
    featuresEn: [
      'Up to 5 projects',
      'Full modeling + assembly + drawing',
      '🤖 AI shape generation (30/mo)',
      '🤖 AI DFM Explainer (30/mo)',
      'Share link (14 days)',
      'STL / STEP / DXF export',
      'Community support',
    ],
    featuresJa: [
      'プロジェクト5件',
      'フルモデリング＋アセンブリ＋図面',
      '🤖 AI形状生成（月30回）',
      '🤖 AI DFM解説（月30回）',
      '共有リンク（14日）',
      'STL / STEP / DXF エクスポート',
      'コミュニティサポート',
    ],
    cta: '문의하기',
    ctaEn: 'Contact us',
    ctaJa: 'お問い合わせ',
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '별도 협의',
    priceAlt: 'Contact us',
    priceJa: 'お問い合わせ',
    period: '',
    periodEn: '',
    periodJa: '',
    highlight: true,
    features: [
      '프로젝트 무제한',
      '고급 AI 형상 생성',
      '🤖 AI DFM 설명 + 단가 영향 (무제한)',
      '🧭 AI 공정 라우터 (무제한)',
      '🎯 AI 공급사 Top 3 매칭 (무제한)',
      '💰 비용 절감 코파일럿 (무제한)',
      '공유 링크 (30일)',
      '견적 자동화',
      '우선 고객 지원',
    ],
    featuresEn: [
      'Unlimited projects',
      'Advanced AI shape generation',
      '🤖 AI DFM Explainer + Cost Impact (unlimited)',
      '🧭 AI Process Router (unlimited)',
      '🎯 AI Supplier Top-3 Match (unlimited)',
      '💰 Design-for-Cost Copilot (unlimited)',
      'Share link (30 days)',
      'Quote automation',
      'Priority support',
    ],
    featuresJa: [
      'プロジェクト無制限',
      '高度なAI形状生成',
      '🤖 AI DFM解説＋コスト影響（無制限）',
      '🧭 AI工程ルーター（無制限）',
      '🎯 AIサプライヤーTop3マッチ（無制限）',
      '💰 コスト最適化コパイロット（無制限）',
      '共有リンク（30日）',
      '見積もり自動化',
      '優先サポート',
    ],
    bundleNote: {
      title: '매칭 플랜 번들 포함',
      detail: '50만원 플랜 → 3개월 / 100만원 플랜 → 6개월',
    },
    bundleNoteEn: {
      title: 'Included with matching plans',
      detail: '$400 plan → 3 months · $800 plan → 6 months',
    },
    bundleNoteJa: {
      title: 'マッチングプラン利用時バンドル',
      detail: '¥60,000プラン → 3ヶ月 / ¥120,000プラン → 6ヶ月',
    },
    cta: '문의하기',
    ctaEn: 'Contact us',
    ctaJa: 'お問い合わせ',
  },
  {
    id: 'team',
    name: 'Team',
    price: '별도 협의',
    priceAlt: 'Contact us',
    priceJa: 'お問い合わせ',
    period: '',
    periodEn: '',
    periodJa: '',
    features: [
      'Pro 모든 기능',
      '팀 워크스페이스',
      '협업 실시간 편집',
      '고급 분석 대시보드',
      '팀원 역할 관리',
      '팀 공유 BOM',
    ],
    featuresEn: [
      'All Pro features',
      'Team workspace',
      'Real-time collaboration',
      'Advanced analytics dashboard',
      'Team member role management',
      'Shared team BOMs',
    ],
    featuresJa: [
      'Pro全機能',
      'チームワークスペース',
      'リアルタイム共同編集',
      '高度な分析ダッシュボード',
      'メンバー権限管理',
      'チーム共有BOM',
    ],
    cta: '문의하기',
    ctaEn: 'Contact us',
    ctaJa: 'お問い合わせ',
  },
];

type PlanCopy = { features: string[]; period: string; cta: string; bundleNote?: BundleNote; price: string };

function getPlanCopy(plan: Plan, lang: IsoLang): PlanCopy {
  // Keep one complete six-key table even where commercial copy is currently
  // shared. This prevents a new locale from silently taking the Korean branch.
  const features: Record<IsoLang, string[]> = {
    ko: plan.features, en: plan.featuresEn, ja: plan.featuresJa,
    zh: plan.featuresEn, es: plan.featuresEn, ar: plan.featuresEn,
  };
  const periods: Record<IsoLang, string> = {
    ko: plan.period, en: plan.periodEn, ja: plan.periodJa,
    zh: plan.periodEn, es: plan.periodEn, ar: plan.periodEn,
  };
  const ctas: Record<IsoLang, string> = {
    ko: plan.cta, en: plan.ctaEn, ja: plan.ctaJa,
    zh: plan.ctaEn, es: plan.ctaEn, ar: plan.ctaEn,
  };
  const notes: Record<IsoLang, BundleNote | undefined> = {
    ko: plan.bundleNote, en: plan.bundleNoteEn, ja: plan.bundleNoteJa,
    zh: plan.bundleNoteEn, es: plan.bundleNoteEn, ar: plan.bundleNoteEn,
  };
  const prices: Record<IsoLang, string> = {
    ko: plan.price, en: plan.priceAlt, ja: plan.priceJa,
    zh: plan.priceAlt, es: plan.priceAlt, ar: plan.priceAlt,
  };
  return { features: features[lang], period: periods[lang], cta: ctas[lang], bundleNote: notes[lang], price: prices[lang] };
}

const LABELS: Record<IsoLang, { current: string; recommended: string; processing: string; demo: string; subject: string }> = {
  ko: { current: '현재 플랜', recommended: '추천', processing: '처리 중...', demo: '데모 결제 (실제 청구 없음) — {plan} 플랜으로 이동 중...', subject: '[NexyFab] 3D 툴 견적 문의 — {plan}' },
  en: { current: 'Current Plan', recommended: 'Recommended', processing: 'Processing...', demo: 'Demo checkout (no charge) — moving to {plan} plan...', subject: '[NexyFab] 3D tool quote inquiry — {plan}' },
  ja: { current: '現在のプラン', recommended: 'おすすめ', processing: '処理中...', demo: 'デモ決済（請求なし）— {plan}プランへ移動中...', subject: '[NexyFab] 3Dツール見積もり — {plan}' },
  zh: { current: '当前方案', recommended: '推荐', processing: '处理中...', demo: '演示结算（不会扣款）— 正在进入 {plan} 方案...', subject: '[NexyFab] 3D工具报价咨询 — {plan}' },
  es: { current: 'Plan actual', recommended: 'Recomendado', processing: 'Procesando...', demo: 'Pago de demostración (sin cargo) — pasando al plan {plan}...', subject: '[NexyFab] Consulta de cotización de herramienta 3D — {plan}' },
  ar: { current: 'الخطة الحالية', recommended: 'موصى بها', processing: 'جارٍ المعالجة...', demo: 'دفع تجريبي (بدون رسوم) — الانتقال إلى خطة {plan}...', subject: '[NexyFab] استفسار عرض سعر أداة ثلاثية الأبعاد — {plan}' },
};

export default function PricingCards({ lang = 'ko', currentPlan }: Props) {
  const { user } = useAuthStore();
  const activePlan = currentPlan ?? user?.plan ?? 'free';
  const iso = toIsoLang(lang);
  const labels = LABELS[iso];
  const ssoCopy = getSsoCommercialCopy(lang);

  const [loading, setLoading] = useState<string | null>(null);
  const [demoNote, setDemoNote] = useState<string | null>(null);

  const _handleUpgrade = async (plan: 'pro' | 'team') => {
    setLoading(plan);
    setDemoNote(null);
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId: plan, lang: iso }),
      });
      const data = await res.json() as {
        url?: string;
        ok?: boolean;
        mock?: boolean;
        error?: string;
      };

      if (!res.ok || data.error) {
        console.error('[PricingCards] checkout error:', data.error);
        setLoading(null);
        return;
      }

      if (data.mock) {
        setDemoNote(labels.demo.replace('{plan}', plan.toUpperCase()));
      }

      if (data.url) {
        window.location.href = data.url;
      }
    } catch {
      setLoading(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '24px' }}>
      {demoNote && (
        <div
          style={{
            background: '#1c1917',
            border: '1px solid #f59e0b',
            borderRadius: '8px',
            padding: '10px 20px',
            color: '#fbbf24',
            fontSize: '14px',
          }}
        >
          ⚡ {demoNote}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          gap: '20px',
          flexWrap: 'wrap',
          justifyContent: 'center',
          width: '100%',
        }}
      >
        {PLANS.map((plan) => {
          const isCurrent = activePlan === plan.id;
          const isHighlight = plan.highlight && !isCurrent;
          const isLoading = loading === plan.id;
          const basePlanCopy = getPlanCopy(plan, iso);
          const planCopy = plan.id === 'team'
            ? {
                ...basePlanCopy,
                features: [
                  ...basePlanCopy.features.slice(0, 4),
                  ssoCopy.teamRoleManagement,
                  ssoCopy.sharedTeamBoms,
                ],
              }
            : basePlanCopy;

          return (
            <div
              key={plan.id}
              style={{
                flex: '1 1 260px',
                maxWidth: '320px',
                background: isHighlight ? '#0f172a' : '#1a1a1a',
                border: `1px solid ${isHighlight ? '#3b82f6' : isCurrent ? '#22c55e' : '#2a2a2a'}`,
                borderRadius: '12px',
                padding: '28px 24px',
                display: 'flex',
                flexDirection: 'column',
                gap: '20px',
                position: 'relative',
                boxShadow: isHighlight ? '0 0 0 1px #3b82f640' : 'none',
                transition: 'border-color 0.2s',
              }}
            >
              {/* Current plan badge */}
              {isCurrent && (
                <div
                  style={{
                    position: 'absolute',
                    top: '-12px',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    background: '#22c55e',
                    color: '#052e16',
                    fontSize: '11px',
                    fontWeight: 700,
                    letterSpacing: '0.5px',
                    padding: '3px 12px',
                    borderRadius: '999px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {labels.current}
                </div>
              )}

              {/* Recommended badge */}
              {plan.highlight && !isCurrent && (
                <div
                  style={{
                    position: 'absolute',
                    top: '-12px',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    background: '#3b82f6',
                    color: '#eff6ff',
                    fontSize: '11px',
                    fontWeight: 700,
                    letterSpacing: '0.5px',
                    padding: '3px 12px',
                    borderRadius: '999px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {labels.recommended}
                </div>
              )}

              {/* Plan name */}
              <div>
                <h3
                  style={{
                    color: isHighlight ? '#60a5fa' : '#e2e8f0',
                    fontSize: '20px',
                    fontWeight: 700,
                    margin: '0 0 4px',
                  }}
                >
                  {plan.name}
                </h3>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                  <span
                    style={{
                      color: '#f8fafc',
                      fontSize: '32px',
                      fontWeight: 800,
                      letterSpacing: '-1px',
                    }}
                  >
                    {planCopy.price}
                  </span>
                  <span style={{ color: '#64748b', fontSize: '14px' }}>
                    {planCopy.period}
                  </span>
                  {iso === 'ko' && (
                    <span style={{ color: '#475569', fontSize: '12px' }}>
                      ({plan.priceAlt})
                    </span>
                  )}
                </div>
              </div>

              {/* Features */}
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '10px', flex: 1 }}>
                {planCopy.features.map((feat) => (
                  <li
                    key={feat}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '8px',
                      color: '#cbd5e1', fontSize: '14px',
                    }}
                  >
                    <span style={{
                      color: isHighlight ? '#60a5fa' : '#22c55e',
                      fontSize: '16px', lineHeight: 1, flexShrink: 0,
                    }}>
                      ✓
                    </span>
                    {feat}
                  </li>
                ))}
              </ul>

              {/* Bundle note (separated from features for readability) */}
              {planCopy.bundleNote && (
                <div
                  style={{
                    background: 'rgba(245,158,11,0.08)',
                    border: '1px solid rgba(245,158,11,0.25)',
                    borderRadius: '8px',
                    padding: '10px 12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '2px',
                  }}
                >
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '6px',
                    color: '#f59e0b', fontSize: '12px', fontWeight: 700,
                  }}>
                    <span aria-hidden="true">★</span>
                    {planCopy.bundleNote.title}
                  </div>
                  <div style={{ color: '#e0b974', fontSize: '11px', lineHeight: 1.5 }}>
                    {planCopy.bundleNote.detail}
                  </div>
                </div>
              )}

              {/* CTA button */}
              <button
                disabled={isCurrent || isLoading}
                onClick={() => {
                  if (isCurrent) return;
                  // Paid tiers are quote-on-request ("별도 협의") — route to an
                  // inquiry instead of self-serve checkout.
                  if (plan.id === 'pro_lite' || plan.id === 'pro' || plan.id === 'team') {
                    window.location.href = `mailto:gomd99914@gmail.com?subject=${encodeURIComponent(labels.subject.replace('{plan}', plan.name))}`;
                  }
                }}
                style={{
                  background: isCurrent
                    ? '#14532d'
                    : isHighlight
                    ? '#3b82f6'
                    : '#1e293b',
                  color: isCurrent ? '#86efac' : '#f8fafc',
                  border: isCurrent
                    ? '1px solid #22c55e'
                    : isHighlight
                    ? 'none'
                    : '1px solid #334155',
                  borderRadius: '8px',
                  padding: '12px',
                  fontSize: '15px',
                  fontWeight: 600,
                  cursor: isCurrent ? 'default' : isLoading ? 'not-allowed' : 'pointer',
                  transition: 'background 0.15s, opacity 0.15s',
                  opacity: isLoading ? 0.7 : 1,
                  width: '100%',
                }}
              >
                {isLoading
                  ? labels.processing
                  : isCurrent
                  ? labels.current
                  : planCopy.cta}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
