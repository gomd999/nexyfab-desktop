'use client';

import Link from 'next/link';
import { use, useEffect, useState, useCallback } from 'react';
import { useToast } from '@/hooks/useToast';
import { isKorean } from '@/lib/i18n/normalize';
import { fmtKRW } from './fmtKRW';

// ─── Types ────────────────────────────────────────────────────────────────────

type PlanId = 'free' | 'pro' | 'enterprise';
type BillingCycle = 'monthly' | 'yearly';

interface PlanFeature {
  ko: string;
  en: string;
}

interface PlanDef {
  id: PlanId;
  nameKo: string;
  nameEn: string;
  monthly: number | null;
  yearly: number | null;
  color: string;
  features: PlanFeature[];
  popular?: boolean;
}

// ─── Plan definitions ─────────────────────────────────────────────────────────

const PLANS: PlanDef[] = [
  {
    id: 'free',
    nameKo: '무료',
    nameEn: 'Free',
    monthly: 0,
    yearly: 0,
    color: '#3fb950',
    features: [
      { ko: '파라메트릭 설계', en: 'Parametric design' },
      { ko: '기본 내보내기 (STL/OBJ)', en: 'Basic export (STL/OBJ)' },
      { ko: '공유 링크 1개/월', en: '1 share link/month' },
      { ko: '프로젝트 3개', en: '3 projects' },
    ],
  },
  {
    id: 'pro',
    nameKo: '프로',
    nameEn: 'Pro',
    monthly: 49_000,
    yearly: 490_000,
    color: '#388bfd',
    popular: true,
    features: [
      { ko: '모든 Free 기능', en: 'All Free features' },
      { ko: 'DFM/FEA 분석', en: 'DFM/FEA analysis' },
      { ko: '무제한 공유 링크', en: 'Unlimited share links' },
      { ko: '프로젝트 50개', en: '50 projects' },
      { ko: 'AI 어드바이저', en: 'AI advisor' },
      { ko: 'BOM 내보내기', en: 'BOM export' },
    ],
  },
  {
    id: 'enterprise',
    nameKo: '엔터프라이즈',
    nameEn: 'Enterprise',
    monthly: 149_000,
    yearly: 1_490_000,
    color: '#8b5cf6',
    features: [
      { ko: '모든 Pro 기능', en: 'All Pro features' },
      { ko: '팀 협업', en: 'Team collaboration' },
      { ko: '커스텀 제조사 연동', en: 'Custom manufacturer integration' },
      { ko: 'ERP 연동', en: 'ERP integration' },
      { ko: '전용 지원', en: 'Dedicated support' },
    ],
  },
];

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BillingPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = use(params);
  const isKo = isKorean(lang);

  const [cycle, setCycle] = useState<BillingCycle>('monthly');
  const [currentPlan, setCurrentPlan] = useState<PlanId>('free');
  const [loadingPlan, setLoadingPlan] = useState<PlanId | null>(null);
  const [betaStatus, setBetaStatus] = useState<{ enabled: boolean; allowed: boolean; contact: string } | null>(null);
  const toast = useToast();

  // ── Fetch current plan ─────────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/billing/portal', { credentials: 'same-origin' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.plan) setCurrentPlan(d.plan as PlanId); })
      .catch(() => {});
  }, []);

  // ── Closed-beta payment gate: hide/show banner + block denied attempts ────
  useEffect(() => {
    fetch('/api/billing/beta-status', { credentials: 'same-origin' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setBetaStatus(d as { enabled: boolean; allowed: boolean; contact: string }); })
      .catch(() => {});
  }, []);

  // ── Handle URL params on mount ─────────────────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const sp = new URLSearchParams(window.location.search);
    if (sp.get('success') === '1') {
      toast.success(isKo ? '결제가 완료되었습니다! 플랜이 업그레이드됩니다.' : 'Payment successful! Your plan will be upgraded.');
      // Clean up URL
      window.history.replaceState({}, '', window.location.pathname);
    } else if (sp.get('cancel') === '1') {
      toast.error(isKo ? '결제가 취소되었습니다.' : 'Payment cancelled.');
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [isKo, toast]);

  // ── Upgrade handler ────────────────────────────────────────────────────────
  // Routes through Dodo Payments (MoR). KRW or any currency — Dodo handles
  // conversion and tax. UI label keeps KRW pricing; final charge is shown on
  // the Dodo hosted checkout page in the user's actual currency.
  const handleUpgrade = useCallback(async (planId: PlanId) => {
    if (planId === 'free' || planId === currentPlan) return;
    setLoadingPlan(planId);
    try {
      // Server uses 'annual'; UI uses 'yearly'. Translate on the wire.
      const apiCycle = cycle === 'yearly' ? 'annual' : 'monthly';
      const r = await fetch('/api/billing/dodo/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: planId, cycle: apiCycle }),
      });
      const data = await r.json() as {
        url?: string;
        subscriptionId?: string;
        error?: string;
        message?: string;
        contact?: string;
      };

      if (r.status === 403 && data.error === 'billing_beta_only') {
        toast.error(isKo
          ? '현재 베타 사용자에게만 결제가 허용됩니다.'
          : 'Payment is currently restricted to pre-approved beta users.');
        return;
      }
      if (r.status === 503 && data.error === 'dodo_product_not_configured') {
        toast.error(isKo
          ? '결제 상품이 아직 준비되지 않았습니다. 잠시 후 다시 시도해주세요.'
          : 'Payment product is not yet configured. Please try again later.');
        return;
      }
      if (!r.ok || !data.url) {
        toast.error(data.message ?? data.error ?? (isKo ? '결제 페이지를 열 수 없습니다.' : 'Could not open checkout.'));
        return;
      }
      window.location.href = data.url;
    } catch {
      toast.error(isKo ? '네트워크 오류가 발생했습니다.' : 'Network error.');
    } finally {
      setLoadingPlan(null);
    }
  }, [cycle, currentPlan, isKo, toast]);

  return (
    <div style={{
      minHeight: '100vh', background: 'var(--nx-bg)', color: 'var(--nx-text)',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      {/* ── Header ── */}
      <div style={{
        borderBottom: '1px solid var(--nx-panel-2)', padding: '16px 32px',
        display: 'flex', alignItems: 'center', gap: 16,
        position: 'sticky', top: 0, background: 'var(--nx-bg)', zIndex: 10,
      }}>
        <Link prefetch href={`/${lang}/shape-generator`} style={{ textDecoration: 'none' }}>
          <span style={{ fontSize: 20, fontWeight: 800, color: '#388bfd' }}>Nexy</span>
          <span style={{ fontSize: 20, fontWeight: 800, color: '#3fb950' }}>Fab</span>
        </Link>
        <span style={{ color: 'var(--nx-border)' }}>/</span>
        <span style={{ fontSize: 16, fontWeight: 600 }}>
          {isKo ? '요금제' : 'Billing & Plans'}
        </span>
        <div style={{ flex: 1 }} />
        <a href={`/${lang}/nexyfab/settings`} style={{
          fontSize: 12, color: 'var(--nx-text-2)', textDecoration: 'none',
          padding: '6px 12px', border: '1px solid var(--nx-border)', borderRadius: 6,
        }}>
          {isKo ? '설정' : 'Settings'}
        </a>
      </div>

      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '48px 24px' }}>
        {/* ── Closed-beta banner ── */}
        {/* Only renders when payment is restricted to a pre-approved allowlist
            and the current user is not on it. */}
        {betaStatus?.enabled && !betaStatus.allowed && (
          <div style={{
            border: '1px solid #d4a017', background: '#3a2d0c', borderRadius: 10,
            padding: '14px 18px', marginBottom: 32, display: 'flex', gap: 12, alignItems: 'flex-start',
          }}>
            <span style={{ fontSize: 18, color: '#d4a017', lineHeight: 1 }}>⚠</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#f0c14b', marginBottom: 4 }}>
                {isKo ? '현재 베타 서비스' : 'Closed beta'}
              </div>
              <div style={{ fontSize: 13, color: '#e0c97a', lineHeight: 1.5 }}>
                {isKo
                  ? '결제는 사전 승인된 사용자만 가능합니다.'
                  : 'Payment is open to pre-approved users only.'}
              </div>
              <div style={{ fontSize: 12, color: '#c9b06e', marginTop: 6 }}>
                {isKo ? '사전 신청: ' : 'Request access: '}
                <a
                  href={`mailto:${betaStatus.contact}`}
                  style={{ color: '#f0c14b', textDecoration: 'underline' }}
                >
                  {betaStatus.contact}
                </a>
              </div>
            </div>
          </div>
        )}

        {/* ── Title ── */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <h1 style={{ fontSize: 32, fontWeight: 800, color: 'var(--nx-text)', margin: '0 0 12px' }}>
            {isKo ? '당신에게 맞는 플랜을 선택하세요' : 'Choose the right plan for you'}
          </h1>
          <p style={{ fontSize: 15, color: 'var(--nx-text-2)', margin: 0 }}>
            {isKo
              ? '언제든지 업그레이드하거나 다운그레이드할 수 있습니다.'
              : 'Upgrade or downgrade at any time.'}
          </p>
        </div>

        {/* ── Billing cycle toggle ── */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 12, marginBottom: 40,
        }}>
          <span style={{ fontSize: 13, color: cycle === 'monthly' ? 'var(--nx-text)' : 'var(--nx-text-2)', fontWeight: 600 }}>
            {isKo ? '월간' : 'Monthly'}
          </span>
          <button
            onClick={() => setCycle(prev => prev === 'monthly' ? 'yearly' : 'monthly')}
            style={{
              width: 52, height: 28, borderRadius: 14,
              background: 'var(--nx-panel-2)', border: '1px solid var(--nx-border)',
              cursor: 'pointer', position: 'relative', transition: 'background 0.2s',
              padding: 0,
            }}
          >
            <span style={{
              position: 'absolute', top: 3,
              left: cycle === 'yearly' ? 25 : 3,
              width: 20, height: 20, borderRadius: '50%',
              background: cycle === 'yearly' ? '#388bfd' : 'var(--nx-text-3)',
              transition: 'left 0.2s, background 0.2s',
              display: 'block',
            }} />
          </button>
          <span style={{ fontSize: 13, color: cycle === 'yearly' ? 'var(--nx-text)' : 'var(--nx-text-2)', fontWeight: 600 }}>
            {isKo ? '연간' : 'Yearly'}
            <span style={{
              marginLeft: 6, fontSize: 10, padding: '1px 7px', borderRadius: 10,
              background: '#3fb95022', color: '#3fb950', border: '1px solid #3fb95044',
            }}>
              {isKo ? '17% 할인' : '17% off'}
            </span>
          </span>
        </div>

        {/* ── Plan cards ── */}
        <style precedence="default" href="nf-billing">{`
          .nf-plan-grid { grid-template-columns: repeat(3, 1fr) !important; }
          @media (max-width: 860px) { .nf-plan-grid { grid-template-columns: 1fr !important; } }
        `}</style>
        <div className="nf-plan-grid" style={{
          display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 20,
        }}>
          {PLANS.map(plan => {
            const isCurrent = plan.id === currentPlan;
            const price = cycle === 'monthly' ? plan.monthly : plan.yearly;
            const isLoading = loadingPlan === plan.id;

            return (
              <div
                key={plan.id}
                style={{
                  background: 'var(--nx-panel)',
                  border: `1px solid ${plan.popular ? plan.color + '66' : 'var(--nx-border)'}`,
                  borderRadius: 14, overflow: 'hidden',
                  position: 'relative',
                  boxShadow: plan.popular ? `0 0 24px ${plan.color}22` : undefined,
                }}
              >
                {/* Popular badge */}
                {plan.popular && (
                  <div style={{
                    position: 'absolute', top: 0, right: 0,
                    background: plan.color, color: '#fff',
                    fontSize: 10, fontWeight: 700, padding: '3px 12px',
                    borderBottomLeftRadius: 10,
                  }}>
                    {isKo ? '인기' : 'Popular'}
                  </div>
                )}

                <div style={{ padding: '28px 24px' }}>
                  {/* Plan name */}
                  <div style={{
                    fontSize: 11, fontWeight: 700, color: plan.color,
                    textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6,
                  }}>
                    {isKo ? plan.nameKo : plan.nameEn}
                  </div>

                  {/* Price */}
                  <div style={{ marginBottom: 20 }}>
                    <span style={{ fontSize: 32, fontWeight: 800, color: 'var(--nx-text)', fontFamily: 'monospace' }}>
                      {fmtKRW(price, isKo)}
                    </span>
                    {price !== null && price > 0 && (
                      <span style={{ fontSize: 12, color: 'var(--nx-text-2)', marginLeft: 4 }}>
                        /{isKo ? (cycle === 'monthly' ? '월' : '년') : (cycle === 'monthly' ? 'mo' : 'yr')}
                      </span>
                    )}
                  </div>

                  {/* Current plan badge / upgrade button */}
                  {isCurrent ? (
                    <div style={{
                      padding: '10px 16px', borderRadius: 8, textAlign: 'center',
                      background: plan.color + '18', color: plan.color,
                      border: `1px solid ${plan.color}44`,
                      fontSize: 13, fontWeight: 700, marginBottom: 24,
                    }}>
                      {isKo ? '현재 플랜' : 'Current Plan'}
                    </div>
                  ) : plan.id === 'free' ? (
                    <div style={{
                      padding: '10px 16px', borderRadius: 8, textAlign: 'center',
                      background: 'var(--nx-panel-2)', color: 'var(--nx-text-3)',
                      border: '1px solid var(--nx-border)',
                      fontSize: 13, marginBottom: 24,
                    }}>
                      {isKo ? '기본 플랜' : 'Default plan'}
                    </div>
                  ) : (
                    <button
                      onClick={() => handleUpgrade(plan.id)}
                      disabled={isLoading}
                      style={{
                        width: '100%', padding: '10px 16px', borderRadius: 8,
                        fontSize: 13, fontWeight: 700, cursor: isLoading ? 'not-allowed' : 'pointer',
                        background: isLoading ? 'var(--nx-panel-2)' : plan.color,
                        color: isLoading ? 'var(--nx-text-3)' : '#fff',
                        border: 'none', marginBottom: 24,
                        transition: 'opacity 0.15s',
                        opacity: isLoading ? 0.7 : 1,
                      }}
                    >
                      {isLoading
                        ? (isKo ? '처리 중...' : 'Processing...')
                        : (isKo ? '업그레이드' : 'Upgrade')}
                    </button>
                  )}

                  {/* Feature list */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {plan.features.map((f, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                        <span style={{ color: plan.color, fontSize: 14, flexShrink: 0 }}>✓</span>
                        <span style={{ fontSize: 13, color: 'var(--nx-text)', lineHeight: 1.4 }}>
                          {isKo ? f.ko : f.en}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* ── FAQ / Note ── */}
        <div style={{
          marginTop: 48, padding: '24px', background: 'var(--nx-panel)',
          border: '1px solid var(--nx-border)', borderRadius: 12,
        }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700, color: 'var(--nx-text)' }}>
            {isKo ? '자주 묻는 질문' : 'FAQ'}
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <FaqItem
              q={isKo ? '언제든지 취소할 수 있나요?' : 'Can I cancel anytime?'}
              a={isKo
                ? '네, 언제든지 취소할 수 있으며 청구 주기 종료까지 서비스를 이용할 수 있습니다.'
                : 'Yes, you can cancel anytime and continue using the service until the end of your billing period.'}
            />
            <FaqItem
              q={isKo ? '결제 방법은 무엇인가요?' : 'What payment methods are accepted?'}
              a={isKo
                ? 'Visa, Mastercard, 국내 카드 등 주요 신용카드를 지원합니다.'
                : 'Major credit cards including Visa, Mastercard, and domestic cards are supported.'}
            />
            <FaqItem
              q={isKo ? '연간 요금제의 할인은 어떻게 적용되나요?' : 'How does the annual discount work?'}
              a={isKo
                ? '연간 결제 시 월간 대비 약 17% 할인된 가격으로 제공됩니다.'
                : 'Annual billing offers approximately 17% off compared to monthly billing.'}
            />
          </div>
        </div>
      </div>

    </div>
  );
}

function FaqItem({ q, a }: { q: string; a: string }) {
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--nx-text)', marginBottom: 3 }}>{q}</div>
      <div style={{ fontSize: 12, color: 'var(--nx-text-2)', lineHeight: 1.5 }}>{a}</div>
    </div>
  );
}
