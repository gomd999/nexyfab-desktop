'use client';

import { useState } from 'react';
import { useAuthStore } from '@/hooks/useAuth';

interface Props {
  lang?: string;
  currentPlan?: string;
}

interface Plan {
  id: 'free' | 'pro' | 'team';
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
      '커뮤니티 지원',
    ],
    featuresEn: [
      'Up to 3 projects',
      'Basic shape generation',
      'Share link (72 hours)',
      'Community support',
    ],
    featuresJa: [
      'プロジェクト3件',
      '基本形状生成',
      '共有リンク（72時間）',
      'コミュニティサポート',
    ],
    cta: '무료로 시작',
    ctaEn: 'Start Free',
    ctaJa: '無料で始める',
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '₩29,000',
    priceAlt: '$20',
    priceJa: '¥3,500',
    period: '/월',
    periodEn: '/mo',
    periodJa: '/月',
    highlight: true,
    features: [
      '프로젝트 무제한',
      '고급 AI 형상 생성',
      '공유 링크 (30일)',
      '견적 자동화',
      '우선 고객 지원',
      '매칭 플랜 이용 시 번들 포함 (50만원 플랜 3개월 · 100만원 플랜 6개월)',
    ],
    featuresEn: [
      'Unlimited projects',
      'Advanced AI shape generation',
      'Share link (30 days)',
      'Quote automation',
      'Priority support',
      'Included with matching plans ($400 plan → 3 months · $800 plan → 6 months)',
    ],
    featuresJa: [
      'プロジェクト無制限',
      '高度なAI形状生成',
      '共有リンク（30日）',
      '見積もり自動化',
      '優先サポート',
      'マッチングプラン利用時バンドル含む（¥60,000プラン3ヶ月・¥120,000プラン6ヶ月）',
    ],
    cta: 'Pro 시작하기',
    ctaEn: 'Start Pro',
    ctaJa: 'Proを始める',
  },
  {
    id: 'team',
    name: 'Team',
    price: '₩42,000',
    priceAlt: '$30',
    priceJa: '¥4,500',
    period: '/월',
    periodEn: '/mo',
    periodJa: '/月',
    features: [
      'Pro 모든 기능',
      '팀 워크스페이스',
      '협업 실시간 편집',
      '고급 분석 대시보드',
      '전용 계정 매니저',
      'SLA 99.9% 보장',
    ],
    featuresEn: [
      'All Pro features',
      'Team workspace',
      'Real-time collaboration',
      'Advanced analytics dashboard',
      'Dedicated account manager',
      'SLA 99.9% guarantee',
    ],
    featuresJa: [
      'Pro全機能',
      'チームワークスペース',
      'リアルタイム共同編集',
      '高度な分析ダッシュボード',
      '専任アカウントマネージャー',
      'SLA 99.9%保証',
    ],
    cta: 'Team 시작하기',
    ctaEn: 'Start Team',
    ctaJa: 'Teamを始める',
  },
];

export default function PricingCards({ lang = 'ko', currentPlan }: Props) {
  const { user } = useAuthStore();
  const activePlan = currentPlan ?? user?.plan ?? 'free';
  const isKo = lang === 'ko' || lang === 'kr';
  const isJa = lang === 'ja';

  const [loading, setLoading] = useState<string | null>(null);
  const [demoNote, setDemoNote] = useState<string | null>(null);

  const handleUpgrade = async (plan: 'pro' | 'team') => {
    setLoading(plan);
    setDemoNote(null);
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId: plan, lang }),
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
        setDemoNote(`데모 결제 (실제 청구 없음) — ${plan.toUpperCase()} 플랜으로 이동 중...`);
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
                  {isKo ? '현재 플랜' : isJa ? '現在のプラン' : 'Current Plan'}
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
                  {isKo ? '추천' : isJa ? 'おすすめ' : 'Recommended'}
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
                    {isKo ? plan.price : isJa ? plan.priceJa : plan.priceAlt}
                  </span>
                  <span style={{ color: '#64748b', fontSize: '14px' }}>
                    {isKo ? plan.period : isJa ? plan.periodJa : plan.periodEn}
                  </span>
                  {isKo && (
                    <span style={{ color: '#475569', fontSize: '12px' }}>
                      ({plan.priceAlt})
                    </span>
                  )}
                </div>
              </div>

              {/* Features */}
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '10px', flex: 1 }}>
                {(isKo ? plan.features : isJa ? plan.featuresJa : plan.featuresEn).map((feat) => {
                  const isBundle = feat.includes('번들') || feat.includes('플랜') || feat.includes('matching plan') || feat.includes('バンドル') || feat.includes('マッチング');
                  return (
                    <li
                      key={feat}
                      style={isBundle ? {
                        display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '12px',
                        color: '#f59e0b', background: 'rgba(245,158,11,0.08)', borderRadius: '6px',
                        padding: '6px 8px', marginTop: '4px',
                      } : {
                        display: 'flex', alignItems: 'center', gap: '8px', color: '#cbd5e1', fontSize: '14px',
                      }}
                    >
                      <span style={{ color: isBundle ? '#f59e0b' : isHighlight ? '#60a5fa' : '#22c55e', fontSize: isBundle ? '14px' : '16px', lineHeight: 1, flexShrink: 0 }}>
                        {isBundle ? '★' : '✓'}
                      </span>
                      {feat}
                    </li>
                  );
                })}
              </ul>

              {/* CTA button */}
              <button
                disabled={isCurrent || isLoading}
                onClick={() => {
                  if (!isCurrent && (plan.id === 'pro' || plan.id === 'team')) {
                    handleUpgrade(plan.id);
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
                  cursor: isCurrent ? 'default' : 'pointer',
                  transition: 'background 0.15s, opacity 0.15s',
                  opacity: isLoading ? 0.7 : 1,
                  width: '100%',
                }}
              >
                {isLoading
                  ? (isKo ? '처리 중...' : 'Processing...')
                  : isCurrent
                  ? (isKo ? '현재 플랜' : isJa ? '現在のプラン' : 'Current Plan')
                  : (isKo ? plan.cta : isJa ? plan.ctaJa : plan.ctaEn)}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
