'use client';
// ─── UpgradePrompt ────────────────────────────────────────────────────────────
// Modal shown when a Free user tries to access a Pro/Team feature.

import { useState } from 'react';
import type { UserPlan } from '@/hooks/useAuth';

interface UpgradePromptProps {
  open: boolean;
  onClose: () => void;
  feature: string;         // human-readable feature name
  featureKo?: string;
  requiredPlan?: UserPlan;
  lang?: string;
  onLogin?: () => void;
}

const PLAN_FEATURES: Record<string, { label: string; labelKo: string; icon: string; plan: string }[]> = {
  pro: [
    { label: 'DFM Analysis', labelKo: 'DFM 제조 분석', icon: '🔬', plan: 'Pro' },
    { label: 'FEA Stress Analysis', labelKo: 'FEA 응력 해석', icon: '⚗️', plan: 'Pro' },
    { label: 'Cost Estimation', labelKo: '비용 자동 추정', icon: '💰', plan: 'Pro' },
    { label: 'STEP/DXF/GLTF Export', labelKo: 'STEP/DXF/GLTF 내보내기', icon: '📤', plan: 'Pro' },
    { label: 'Cloud Save', labelKo: '클라우드 저장', icon: '☁️', plan: 'Pro' },
    { label: 'IP-Protected Share Link', labelKo: 'IP 보호 공유 링크', icon: '🔒', plan: 'Pro' },
    { label: 'Quote Requests', labelKo: '제조사 견적 요청', icon: '💬', plan: 'Pro' },
  ],
};

export default function UpgradePrompt({
  open, onClose, feature, featureKo, requiredPlan = 'pro', lang = 'ko', onLogin,
}: UpgradePromptProps) {
  const [hoveredPlan, setHoveredPlan] = useState<string | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  // Normalise URL lang segment to ISO code ('kr' is not valid ISO — use 'ko')
  const isoLang = lang === 'kr' ? 'ko' : lang;
  const isKo = isoLang === 'ko';

  const handleUpgrade = async (plan: 'pro' | 'team') => {
    setCheckoutLoading(plan);
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId: plan, lang: isoLang }),
      });
      const data = await res.json() as { url?: string; ok?: boolean };
      if (data.url) window.location.href = data.url;
    } catch {
      // fallback
    } finally {
      setCheckoutLoading(null);
    }
  };

  if (!open) return null;

  const featureLabel = isKo ? (featureKo ?? feature) : feature;
  const planFeatures = PLAN_FEATURES[requiredPlan] ?? PLAN_FEATURES.pro;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={isKo ? '업그레이드 플랜 선택' : 'Upgrade plan'}
      style={{
        position: 'fixed', inset: 0, zIndex: 9500,
        background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }} onClick={onClose}>
      <div style={{
        background: '#161b22', border: '1px solid #30363d',
        borderRadius: 16, padding: '32px 28px', width: 440,
        boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
        fontFamily: 'system-ui, sans-serif',
        position: 'relative',
      }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>⚡</div>
          <h2 style={{ margin: '0 0 6px', fontSize: 18, color: '#e6edf3', fontWeight: 800 }}>
            {isKo ? `"${featureLabel}" — Pro 전용 기능` : `"${featureLabel}" is a Pro feature`}
          </h2>
          <p style={{ margin: 0, fontSize: 13, color: '#6e7681' }}>
            {isKo
              ? 'Pro로 업그레이드하면 아래 기능을 모두 사용할 수 있습니다'
              : 'Upgrade to Pro to unlock all features below'}
          </p>
        </div>

        {/* Feature list */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr',
          gap: 8, marginBottom: 24,
        }}>
          {planFeatures.map(item => (
            <div key={item.label} style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '8px 10px', borderRadius: 8,
              background: '#0d1117', border: '1px solid #21262d',
            }}>
              <span style={{ fontSize: 14 }}>{item.icon}</span>
              <span style={{ fontSize: 11, color: '#8b949e' }}>
                {isKo ? item.labelKo : item.label}
              </span>
            </div>
          ))}
        </div>

        {/* Pricing */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
          {[
            { plan: 'pro' as const, label: 'Pro', price: '₩29,000', priceEn: '$20', priceJa: '¥3,500', period: isKo ? '/월' : isoLang === 'ja' ? '/月' : '/mo', color: '#388bfd' },
            { plan: 'team' as const, label: 'Team', price: '₩79,000', priceEn: '$57', priceJa: '¥8,500', period: isKo ? '/월/seat' : isoLang === 'ja' ? '/月/seat' : '/mo/seat', color: '#a371f7' },
          ].map(item => (
            <div
              key={item.plan}
              onClick={() => void handleUpgrade(item.plan)}
              onMouseEnter={() => setHoveredPlan(item.plan)}
              onMouseLeave={() => setHoveredPlan(null)}
              style={{
                flex: 1, padding: '14px 16px', borderRadius: 10,
                border: `1px solid ${hoveredPlan === item.plan ? item.color : '#30363d'}`,
                background: hoveredPlan === item.plan ? `${item.color}0d` : '#0d1117',
                cursor: 'pointer', transition: 'all 0.15s', textAlign: 'center',
                opacity: checkoutLoading === item.plan ? 0.7 : 1,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 800, color: item.color, marginBottom: 4 }}>
                {checkoutLoading === item.plan ? '...' : item.label}
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#e6edf3' }}>
                {isKo ? item.price : isoLang === 'ja' ? item.priceJa : item.priceEn}
              </div>
              <div style={{ fontSize: 10, color: '#6e7681' }}>
                {item.period}
              </div>
            </div>
          ))}
        </div>

        {/* CTA buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button
            onClick={() => void handleUpgrade('pro')}
            disabled={!!checkoutLoading}
            aria-label={isKo ? 'Pro 플랜으로 업그레이드' : 'Upgrade to Pro plan'}
            style={{
              width: '100%', padding: '11px 0', borderRadius: 8, border: 'none',
              background: 'linear-gradient(135deg, #388bfd, #8b5cf6)',
              color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
              opacity: checkoutLoading ? 0.7 : 1,
            }}>
            ⚡ {checkoutLoading === 'pro' ? (isKo ? '처리 중...' : 'Processing...') : (isKo ? 'Pro로 업그레이드' : 'Upgrade to Pro')}
          </button>
          {onLogin && (
            <button onClick={onLogin} style={{
              padding: '9px 0', borderRadius: 8,
              border: '1px solid #30363d', background: 'transparent',
              color: '#8b949e', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}>
              {isKo ? '이미 Pro이신가요? 로그인' : 'Already Pro? Log in'}
            </button>
          )}
        </div>

        <button
          onClick={onClose}
          aria-label={isKo ? '닫기' : 'Close dialog'}
          style={{
            position: 'absolute', top: 12, right: 14,
            background: 'none', border: 'none', color: '#6e7681',
            fontSize: 18, cursor: 'pointer',
          }}>✕</button>
      </div>
    </div>
  );
}
