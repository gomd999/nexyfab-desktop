'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';

const CheckoutModal = dynamic(
  () => import('@/components/billing/CheckoutModal'),
  { ssr: false },
);

// ─── Types ────────────────────────────────────────────────────────────────────

interface FxSuggestion {
  currency: string;
  amount: number;
  formatted: string;
  rateNote?: string;
}

interface PlanInfo {
  plan: string;
  priceKrw?: number;
  basePrice: number;
  totalPrice: number;
  totalPriceFormatted: string;
  isCurrent: boolean;
  limits: Record<string, number>;
  taxInfo: string | null;
  isNativeCurrency?: boolean;
  fxSuggestion?: FxSuggestion | null;
}

interface UsageItem {
  metric: string;
  used: number;
  limit: number;
  overage: number;
  chargeKrw: number;
  usagePct: number;
}

interface Invoice {
  id: string;
  total_amount_krw: number;
  display_amount?: number;
  display_currency?: string;
  currency: string;
  status: string;
  created_at: number;
  paid_at: number | null;
  description: string;
}

interface TaxInvoice {
  id: string;
  invoice_id: string;
  mgt_key: string;
  buyer_corp_name: string;
  supply_amount_krw: number;
  tax_amount_krw: number;
  total_amount_krw: number;
  status: string;
  nts_send_dt: string | null;
  created_at: number;
}

interface PaymentMethod {
  id: string;
  label: string;
  labelEn: string;
  icon: string;
  provider: string;
}

interface BillingProfile {
  country: string;
  currency: string;
  detectedCountry: string;
  bizRegNo: string | null;
  corpName: string | null;
  ceoName:  string | null;
  bizAddress: string | null;
  bizEmail: string | null;
  taxExempt: boolean;
  tax: { rate: number; name: string; nameLocal: string; included: boolean; requiresId: boolean };
  paymentMethods: PaymentMethod[];
}

interface PricingData {
  country: string;
  currency: string;
  displayCurrency: string;
  isNativeCurrency: boolean;
  tier: 'tier1' | 'tier2';
  tier2Note?: string;
  plans: PlanInfo[];
  usageOverages: { metric: string; price: number; priceFormatted: string; fxSuggestion?: FxSuggestion | null }[];
  paymentMethods: PaymentMethod[];
  availableCurrencies: string[];
  tax: { rate: number; name: string; nameLocal: string; included: boolean };
  fxMeta: null | { base: string; displayIn: string; rate: number | null; cachedAt: number | null; ageMinutes: number | null; disclaimer: string };
}

interface PortalData {
  user:         { email: string; name: string; memberSince: number };
  org:          { id: string; name: string } | null;
  plan:         string;
  subscription: { id: string; status: string; current_period_end: number } | null;
  invoices:     Invoice[];
  usage:        { items: UsageItem[]; totalOverageKrw: number };
  billing:      { cycleEnd: number; estimatedTotalKrw: number; currency: string };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PLAN_LABELS: Record<string, string> = {
  free: 'Free', pro: 'Pro', team: 'Team', enterprise: 'Enterprise',
};
const PLAN_COLORS: Record<string, string> = {
  free: 'bg-gray-100 text-gray-600',
  pro:  'bg-blue-100 text-blue-700',
  team: 'bg-purple-100 text-purple-700',
  enterprise: 'bg-amber-100 text-amber-700',
};
const METRIC_LABELS: Record<string, string> = {
  rfq_submission: 'RFQ 제출',
  render_3d:      '3D 렌더링',
  team_seat:      '팀 멤버',
  api_call_1k:    'API 호출 (1k)',
  storage_gb:     '스토리지 (GB)',
};
const STATUS_LABELS: Record<string, string> = {
  paid: '결제 완료', open: '미결제', past_due: '연체',
  uncollectible: '수금 불가', void: '취소됨',
};
const STATUS_COLORS: Record<string, string> = {
  paid: 'bg-green-100 text-green-700',
  open: 'bg-blue-100 text-blue-700',
  past_due: 'bg-red-100 text-red-700',
  uncollectible: 'bg-gray-100 text-gray-500',
  void: 'bg-gray-100 text-gray-400',
};
const TAX_INVOICE_STATUS: Record<string, { label: string; color: string }> = {
  issued: { label: '발행 완료', color: 'bg-green-100 text-green-700' },
  sent:   { label: '국세청 전송', color: 'bg-blue-100 text-blue-700' },
  failed: { label: '발행 실패', color: 'bg-red-100 text-red-700' },
};
const COUNTRY_FLAGS: Record<string, string> = {
  KR: '🇰🇷', JP: '🇯🇵', CN: '🇨🇳', US: '🇺🇸', SG: '🇸🇬',
  AU: '🇦🇺', GB: '🇬🇧', DE: '🇩🇪', FR: '🇫🇷', TH: '🇹🇭',
};

function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' });
}
function wonOrLocal(amount: number, displayAmount?: number, displayCurrency?: string) {
  if (displayAmount && displayCurrency && displayCurrency !== 'KRW') {
    return `${displayAmount.toLocaleString()} ${displayCurrency}`;
  }
  return amount.toLocaleString('ko-KR') + '원';
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function UsageBar({ item }: { item: UsageItem }) {
  const pct = item.usagePct;
  const bar = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-400' : 'bg-blue-500';
  return (
    <div>
      <div className="flex justify-between text-xs text-gray-600 mb-1">
        <span>{METRIC_LABELS[item.metric] ?? item.metric}</span>
        <span className={item.overage > 0 ? 'text-red-600 font-semibold' : ''}>
          {item.used.toLocaleString()} / {item.limit === 99999 ? '무제한' : item.limit.toLocaleString()}
        </span>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${bar}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
      <h2 className="text-base font-bold text-gray-900 mb-4">{title}</h2>
      {children}
    </div>
  );
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'overview',    label: '개요' },
  { id: 'plan',        label: '플랜 변경' },
  { id: 'payment',     label: '결제 수단' },
  { id: 'invoices',    label: '청구 내역' },
  { id: 'org',         label: '조직 관리' },
  { id: 'tax-invoice', label: '세금계산서' },
  { id: 'profile',     label: '사업자 정보' },
];

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BillingSettingsPage() {
  const { lang }   = useParams<{ lang: string }>();
  const router     = useRouter();
  const searchParams = useSearchParams();

  const [tab, setTab]       = useState('overview');
  const [portal, setPortal] = useState<PortalData | null>(null);
  const [pricing, setPricing] = useState<PricingData | null>(null);
  const [profile, setProfile] = useState<BillingProfile | null>(null);
  const [taxInvoices, setTaxInvoices] = useState<TaxInvoice[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [planLoading, setPlanLoading] = useState(false);
  const [cancelConfirm, setCancelConfirm] = useState(false);

  // Checkout modal
  const [checkoutPlan, setCheckoutPlan] = useState<string | null>(null);
  const [checkoutSuccess, setCheckoutSuccess] = useState(false);
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'annual'>('monthly');

  // Tax invoice modal
  const [taxModal, setTaxModal] = useState<Invoice | null>(null);
  const [taxForm, setTaxForm]   = useState({ bizRegNo: '', corpName: '', ceoName: '', bizEmail: '', bizAddress: '' });
  const [taxSubmitting, setTaxSubmitting] = useState(false);

  // Profile form
  const [profileForm, setProfileForm] = useState({
    country: 'KR', currency: 'KRW', bizRegNo: '', corpName: '', ceoName: '', bizAddress: '', bizEmail: '',
  });
  const [profileSaving, setProfileSaving] = useState(false);

  // Org management
  const [orgData, setOrgData] = useState<{ id: string; name: string } | null>(null);
  const [orgMembers, setOrgMembers] = useState<{ user_id: string; email: string; name: string; role: string; joined_at: number }[]>([]);
  const [orgInvites, setOrgInvites] = useState<{ id: string; email: string; role: string; expires_at: number }[]>([]);
  const [orgLoading, setOrgLoading] = useState(false);
  const [orgForm, setOrgForm] = useState({ name: '', businessNumber: '' });
  const [orgCreating, setOrgCreating] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [portalRes, pricingRes, profileRes, taxRes] = await Promise.all([
        fetch('/api/billing/portal?product=nexyfab'),
        fetch('/api/billing/pricing'),
        fetch('/api/billing/profile'),
        fetch('/api/billing/tax-invoice'),
      ]);
      if (portalRes.status === 401) { router.replace(`/${lang}/nexyfab`); return; }

      const [p, pr, pf, ti] = await Promise.all([
        portalRes.json() as Promise<PortalData>,
        pricingRes.json() as Promise<PricingData>,
        profileRes.json() as Promise<BillingProfile>,
        taxRes.json() as Promise<{ invoices: TaxInvoice[] }>,
      ]);
      setPortal(p);
      setPricing(pr);
      setProfile(pf);
      setTaxInvoices(ti.invoices ?? []);
      if (p.org) setOrgData(p.org);
      // Load org members if org exists
      if (p.org?.id) {
        fetch('/api/nexyfab/orgs/invite').then(r => r.json()).then(d => {
          setOrgMembers(d.members ?? []);
          setOrgInvites(d.invites ?? []);
        }).catch(() => {});
      }
      setProfileForm({
        country:    pf.country ?? 'KR',
        currency:   pf.currency ?? 'KRW',
        bizRegNo:   pf.bizRegNo ?? '',
        corpName:   pf.corpName ?? '',
        ceoName:    pf.ceoName ?? '',
        bizAddress: pf.bizAddress ?? '',
        bizEmail:   pf.bizEmail ?? '',
      });
    } catch {
      setError('정보를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [lang, router]);

  useEffect(() => { void loadAll(); }, [loadAll]);

  // Toss 결제 완료 후 리다이렉트 감지
  useEffect(() => {
    if (searchParams.get('checkout') === 'success') {
      setCheckoutSuccess(true);
      setTab('overview');
      void loadAll();
      // URL에서 파라미터 제거
      router.replace(window.location.pathname, { scroll: false });
      setTimeout(() => setCheckoutSuccess(false), 4000);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Plan change → open checkout modal ────────────────────────────────────
  // TODO: BETA 플래그 제거 시 isBeta = false 또는 삭제
  const isBeta = true;

  function handlePlanSelect(plan: string) {
    if (isBeta) {
      setError('BETA 기간에는 결제가 지원되지 않습니다. 정식 오픈 시 이용해주세요.');
      return;
    }
    if (plan === 'enterprise') {
      window.location.href = 'mailto:sales@nexysys.com?subject=Enterprise%20문의';
      return;
    }
    setCheckoutPlan(plan);
  }

  async function handleCancel() {
    if (isBeta) { setError('BETA 기간에는 구독 변경이 지원되지 않습니다.'); setCancelConfirm(false); return; }
    setPlanLoading(true);
    await fetch('/api/billing/subscription', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product: 'nexyfab' }),
    });
    setCancelConfirm(false);
    setPlanLoading(false);
    await loadAll();
  }

  // ── Tax invoice ────────────────────────────────────────────────────────────
  async function handleTaxIssue(e: React.FormEvent) {
    e.preventDefault();
    if (!taxModal) return;
    setTaxSubmitting(true);
    try {
      const res = await fetch('/api/billing/tax-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoiceId:     taxModal.id,
          buyerBizRegNo: taxForm.bizRegNo.replace(/-/g, ''),
          buyerCorpName: taxForm.corpName,
          buyerCeoName:  taxForm.ceoName,
          buyerEmail:    taxForm.bizEmail,
          buyerAddress:  taxForm.bizAddress,
        }),
      });
      const d = await res.json() as { error?: string };
      if (!res.ok) { setError(d.error ?? '발행 실패'); return; }
      setTaxModal(null);
      await loadAll();
      setTab('tax-invoice');
    } finally { setTaxSubmitting(false); }
  }

  // ── Profile save ───────────────────────────────────────────────────────────
  async function handleProfileSave(e: React.FormEvent) {
    e.preventDefault();
    setProfileSaving(true);
    try {
      const res = await fetch('/api/billing/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          country:    profileForm.country,
          currency:   profileForm.currency,
          bizRegNo:   profileForm.bizRegNo,
          corpName:   profileForm.corpName,
          ceoName:    profileForm.ceoName,
          bizAddress: profileForm.bizAddress,
          bizEmail:   profileForm.bizEmail,
        }),
      });
      if (!res.ok) { const d = await res.json() as { error: string }; setError(d.error); return; }
      await loadAll();
    } finally { setProfileSaving(false); }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400 text-sm">결제 정보 불러오는 중...</p>
      </div>
    );
  }
  if (!portal) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-red-400 text-sm">{error || '데이터를 불러올 수 없습니다.'}</p>
      </div>
    );
  }

  const country  = profile?.country ?? 'KR';
  const currency = profile?.currency ?? 'KRW';
  const flag     = COUNTRY_FLAGS[country] ?? '🌐';
  const isKorea  = country === 'KR';
  const taxCfg   = profile?.tax;

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      {/* Checkout Modal */}
      {checkoutPlan && (() => {
        const planInfo = pricing?.plans.find(p => p.plan === checkoutPlan);
        const monthlyPrice = planInfo?.totalPrice ?? 0;
        const annualTotal  = Math.round(monthlyPrice * 12 * 0.8 * 100) / 100;
        // Format annual price in the same currency style as monthly
        const annualFormatted = planInfo?.totalPriceFormatted
          ? planInfo.totalPriceFormatted.replace(/[\d,]+(\.\d+)?/, annualTotal.toLocaleString())
          : '';
        return (
          <CheckoutModal
            plan={checkoutPlan}
            product="nexyfab"
            country={country}
            period={billingPeriod}
            priceFormatted={planInfo?.totalPriceFormatted ?? ''}
            annualFormatted={annualFormatted}
            onSuccess={() => {
              setCheckoutPlan(null);
              setCheckoutSuccess(true);
              void loadAll();
              setTab('overview');
              setTimeout(() => setCheckoutSuccess(false), 4000);
            }}
            onClose={() => setCheckoutPlan(null)}
          />
        );
      })()}

      <div className="max-w-4xl mx-auto space-y-5">

        {/* BETA 안내 배너 — TODO: 결제 연동 완료 시 제거 */}
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-xl px-4 py-3 flex items-center gap-2">
          <span className="text-lg">🚧</span>
          <div>
            <span className="font-bold">BETA</span> — 현재 결제 기능은 준비 중입니다. 플랜 변경 및 결제는 정식 오픈 시 이용 가능합니다.
          </div>
        </div>

        {/* 결제 성공 배너 */}
        {checkoutSuccess && (
          <div className="bg-green-50 border border-green-200 text-green-800 text-sm rounded-xl px-4 py-3 flex items-center gap-2">
            <span className="text-lg">✅</span>
            <span className="font-semibold">결제 완료!</span> 플랜이 성공적으로 활성화되었습니다.
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-black text-gray-900">결제 & 구독</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {portal.user.email} · 가입일 {formatDate(portal.user.memberSince)}
              <span className="ml-2">{flag} {country} · {currency}</span>
            </p>
          </div>
          <button
            onClick={() => setTab('profile')}
            className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
          >
            {flag} 국가/통화 변경
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3 flex justify-between">
            {error}
            <button onClick={() => setError('')} className="text-red-400 hover:text-red-600">✕</button>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 bg-white rounded-xl border border-gray-100 p-1 overflow-x-auto">
          {TABS.map(t => (
            (!isKorea && t.id === 'tax-invoice') ? null : (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-4 py-2 text-sm font-medium rounded-lg whitespace-nowrap transition ${
                  tab === t.id
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {t.label}
              </button>
            )
          ))}
        </div>

        {/* ── Overview ──────────────────────────────────────────────────── */}
        {tab === 'overview' && (
          <>
            {/* Current plan card */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <div className="flex items-start justify-between flex-wrap gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className={`text-sm font-bold px-3 py-1 rounded-full ${PLAN_COLORS[portal.plan]}`}>
                      {PLAN_LABELS[portal.plan]}
                    </span>
                    {portal.subscription && (
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        portal.subscription.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                      }`}>
                        {portal.subscription.status === 'active' ? '활성' : portal.subscription.status}
                      </span>
                    )}
                    {taxCfg && taxCfg.rate > 0 && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
                        {taxCfg.nameLocal} {Math.round(taxCfg.rate * 100)}% {taxCfg.included ? '포함' : '별도'}
                      </span>
                    )}
                  </div>
                  {portal.subscription && (
                    <p className="text-sm text-gray-500">
                      다음 갱신: {formatDate(portal.subscription.current_period_end)}
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-400">이번 달 예상 청구</p>
                  <p className="text-2xl font-black text-gray-900">
                    {pricing?.plans.find(p => p.plan === portal.plan)?.totalPriceFormatted
                      ?? portal.billing.estimatedTotalKrw.toLocaleString('ko-KR') + '원'}
                  </p>
                  {portal.usage.totalOverageKrw > 0 && (
                    <p className="text-xs text-amber-600">초과 사용료 포함</p>
                  )}
                </div>
              </div>

              {portal.subscription && portal.plan !== 'free' && (
                <div className="mt-4 pt-4 border-t border-gray-100 flex justify-end">
                  {cancelConfirm ? (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-red-600">정말 해지하시겠습니까?</span>
                      <button onClick={() => void handleCancel()} disabled={planLoading}
                        className="px-3 py-1.5 text-xs font-bold rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">
                        해지 확인
                      </button>
                      <button onClick={() => setCancelConfirm(false)}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-gray-200 text-gray-600">
                        취소
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => setCancelConfirm(true)} className="text-xs text-gray-400 hover:text-red-500 underline">
                      구독 해지
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Usage */}
            {portal.usage.items.length > 0 && (
              <SectionCard title="이번 달 사용량">
                <div className="space-y-4">
                  {portal.usage.items.map(item => <UsageBar key={item.metric} item={item} />)}
                </div>
                {portal.usage.totalOverageKrw > 0 && (
                  <div className="mt-4 pt-4 border-t border-gray-100 flex justify-between text-sm">
                    <span className="text-gray-600">초과 사용 요금</span>
                    <span className="font-bold text-red-600">{portal.usage.totalOverageKrw.toLocaleString('ko-KR')}원</span>
                  </div>
                )}
              </SectionCard>
            )}

            {/* Recent invoices preview */}
            <SectionCard title="최근 청구">
              {portal.invoices.slice(0, 3).map(inv => (
                <div key={inv.id} className="flex items-center justify-between py-2.5 border-b border-gray-50 last:border-0">
                  <div>
                    <p className="text-sm text-gray-800 truncate max-w-xs">{inv.description || '청구서'}</p>
                    <p className="text-xs text-gray-400">{formatDate(inv.created_at)}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${STATUS_COLORS[inv.status] ?? 'bg-gray-100 text-gray-500'}`}>
                      {STATUS_LABELS[inv.status] ?? inv.status}
                    </span>
                    <span className="text-sm font-bold text-gray-900">
                      {wonOrLocal(inv.total_amount_krw, inv.display_amount, inv.display_currency)}
                    </span>
                  </div>
                </div>
              ))}
              <button onClick={() => setTab('invoices')} className="mt-3 text-xs text-blue-600 hover:underline">
                전체 보기 →
              </button>
            </SectionCard>
          </>
        )}

        {/* ── Plan Selection ─────────────────────────────────────────────── */}
        {tab === 'plan' && pricing && (
          <SectionCard title={`플랜 변경 (${flag} ${pricing.isNativeCurrency ? currency : 'USD'})`}>

            {/* Monthly / Annual toggle */}
            <div className="flex justify-center mb-5">
              <div className="inline-flex items-center bg-gray-100 rounded-xl p-1 gap-1">
                <button
                  onClick={() => setBillingPeriod('monthly')}
                  className={`px-4 py-2 text-sm font-semibold rounded-lg transition ${
                    billingPeriod === 'monthly'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  월간 결제
                </button>
                <button
                  onClick={() => setBillingPeriod('annual')}
                  className={`px-4 py-2 text-sm font-semibold rounded-lg transition flex items-center gap-1.5 ${
                    billingPeriod === 'annual'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  연간 결제
                  <span className="text-xs font-bold px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">20% 할인</span>
                </button>
              </div>
            </div>

            {/* tier2: 현지 통화이지만 PPP 가격표 미지원 안내 */}
            {pricing.tier === 'tier2' && (
              <div className="mb-4 flex items-start gap-2 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
                <span className="shrink-0">🌐</span>
                <div>
                  <p className="text-xs font-semibold text-blue-700">현지 통화 결제 지원</p>
                  <p className="text-xs text-blue-600 mt-0.5">
                    현지 통화({currency})로 청구되며 Airwallex를 통해 사용 가능한 결제 수단이 자동으로 표시됩니다.
                    현지화 가격이 필요하신 경우 프로필에서 지원 국가로 변경해 주세요.
                  </p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {pricing.plans.map(info => {
                const monthlyPrice  = info.totalPrice;
                const annualMonthly = Math.round(monthlyPrice * 0.8 * 100) / 100; // per-month equivalent
                const annualTotal   = Math.round(monthlyPrice * 12 * 0.8 * 100) / 100;

                // Format helper — replace numeric portion in formatted string
                function fmtPrice(val: number) {
                  return info.totalPriceFormatted.replace(/[\d,]+(\.\d+)?/, val.toLocaleString());
                }

                const displayPrice     = billingPeriod === 'annual' ? fmtPrice(annualMonthly) : info.totalPriceFormatted;
                const displayPeriodTag = billingPeriod === 'annual' ? '/월 (연간)' : '/월';

                return (
                  <div key={info.plan} className={`rounded-xl border-2 p-4 flex flex-col gap-2 transition-all ${
                    info.isCurrent ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300 bg-white'
                  }`}>
                    <div className="flex items-center justify-between">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${PLAN_COLORS[info.plan]}`}>
                        {PLAN_LABELS[info.plan]}
                      </span>
                      <div className="flex items-center gap-1">
                        {billingPeriod === 'annual' && info.plan !== 'free' && (
                          <span className="text-xs font-bold px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">-20%</span>
                        )}
                        {info.isCurrent && <span className="text-xs text-blue-600 font-semibold">현재</span>}
                      </div>
                    </div>
                    <div>
                      {info.plan === 'free' ? (
                        <div className="text-lg font-black text-gray-900">
                          {info.totalPriceFormatted}
                          <span className="text-xs font-normal text-gray-400">/월</span>
                        </div>
                      ) : (
                        <>
                          <div className="text-lg font-black text-gray-900">
                            {displayPrice}
                            <span className="text-xs font-normal text-gray-400">{displayPeriodTag}</span>
                          </div>
                          {billingPeriod === 'annual' && (
                            <p className="text-xs text-green-600 mt-0.5 font-medium">
                              연 {fmtPrice(annualTotal)} 일시 결제
                            </p>
                          )}
                        </>
                      )}
                      {/* 환율 제안 */}
                      {info.fxSuggestion && (
                        <p className="text-xs text-gray-400 mt-0.5">
                          ≈ {info.fxSuggestion.formatted}
                          <span className="text-gray-300"> (오늘 환율)</span>
                        </p>
                      )}
                    </div>
                    {info.taxInfo && <p className="text-xs text-gray-400">{info.taxInfo}</p>}
                    {!info.isCurrent && info.plan !== 'free' && (
                      <button
                        disabled={planLoading}
                        onClick={() => void handlePlanSelect(info.plan)}
                        className="mt-auto w-full py-2 text-xs font-bold rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 transition"
                      >
                        {info.plan === 'enterprise' ? '문의하기' : '업그레이드'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Usage overages */}
            <div className="mt-6">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">초과 사용 요금</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {pricing.usageOverages.map(u => (
                  <div key={u.metric} className="bg-gray-50 rounded-lg px-3 py-2">
                    <p className="text-xs text-gray-500">{METRIC_LABELS[u.metric] ?? u.metric}</p>
                    <p className="text-sm font-bold text-gray-800">{u.priceFormatted}<span className="text-xs font-normal text-gray-400">/건</span></p>
                  </div>
                ))}
              </div>
            </div>
          </SectionCard>
        )}

        {/* ── Payment Methods ────────────────────────────────────────────── */}
        {tab === 'payment' && (
          <SectionCard title={`결제 수단 (${flag} ${country})`}>
            {profile?.paymentMethods && profile.paymentMethods.length > 0 ? (
              <div className="space-y-2">
                {profile.paymentMethods.map(m => (
                  <div key={m.id} className="flex items-center justify-between p-3 border border-gray-100 rounded-xl">
                    <div className="flex items-center gap-3">
                      <span className="text-xl">{m.icon}</span>
                      <div>
                        <p className="text-sm font-medium text-gray-800">{m.label}</p>
                        <p className="text-xs text-gray-400">{m.labelEn} · {m.provider}</p>
                      </div>
                    </div>
                    <button className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition">
                      {m.provider === 'toss' ? '카카오/네이버페이' : '등록'}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400 text-center py-8">이 지역에서 지원하는 결제 수단이 없습니다.</p>
            )}
            <p className="mt-4 text-xs text-gray-400 text-center">
              결제는 Airwallex {isKorea ? '/ Toss Payments' : ''}를 통해 안전하게 처리됩니다.
            </p>
          </SectionCard>
        )}

        {/* ── Invoices ───────────────────────────────────────────────────── */}
        {tab === 'invoices' && (
          <SectionCard title="청구 내역">
            {portal.invoices.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">청구 내역이 없습니다.</p>
            ) : (
              <div className="space-y-1">
                {portal.invoices.map(inv => (
                  <div key={inv.id} className="flex items-center justify-between py-3 border-b border-gray-50 last:border-0 flex-wrap gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-800 truncate">{inv.description || inv.id}</p>
                      <p className="text-xs text-gray-400">
                        {formatDate(inv.created_at)}
                        {inv.paid_at && <span> · 결제 {formatDate(inv.paid_at)}</span>}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 flex-wrap">
                      <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${STATUS_COLORS[inv.status] ?? 'bg-gray-100 text-gray-500'}`}>
                        {STATUS_LABELS[inv.status] ?? inv.status}
                      </span>
                      <span className="text-sm font-bold text-gray-900">
                        {wonOrLocal(inv.total_amount_krw, inv.display_amount, inv.display_currency)}
                      </span>
                      {isKorea && inv.status === 'paid' && (
                        <button
                          onClick={() => {
                            setTaxModal(inv);
                            setTaxForm({
                              bizRegNo:   profile?.bizRegNo ?? '',
                              corpName:   profile?.corpName ?? '',
                              ceoName:    profile?.ceoName ?? '',
                              bizEmail:   profile?.bizEmail ?? '',
                              bizAddress: profile?.bizAddress ?? '',
                            });
                          }}
                          className="px-2.5 py-1 text-xs font-semibold rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
                        >
                          세금계산서
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        )}

        {/* ── Tax Invoice (Korea only) ───────────────────────────────────── */}
        {tab === 'tax-invoice' && isKorea && (
          <SectionCard title="전자세금계산서">
            <p className="text-xs text-gray-500 mb-4">
              법인/개인사업자 고객은 청구서마다 전자세금계산서를 발행받을 수 있습니다. 발행 즉시 국세청 전송됩니다.
            </p>
            {taxInvoices.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">발행된 세금계산서가 없습니다.<br />
                <span className="text-xs">결제 완료된 청구서에서 「세금계산서」버튼을 클릭하세요.</span>
              </p>
            ) : (
              <div className="space-y-2">
                {taxInvoices.map(ti => {
                  const s = TAX_INVOICE_STATUS[ti.status] ?? { label: ti.status, color: 'bg-gray-100 text-gray-500' };
                  return (
                    <div key={ti.id} className="flex items-center justify-between py-3 border-b border-gray-50 last:border-0 flex-wrap gap-2">
                      <div>
                        <p className="text-sm font-medium text-gray-800">{ti.buyer_corp_name}</p>
                        <p className="text-xs text-gray-400 font-mono">{ti.mgt_key}</p>
                        <p className="text-xs text-gray-400">
                          공급가액 {ti.supply_amount_krw.toLocaleString('ko-KR')}원 + 세액 {ti.tax_amount_krw.toLocaleString('ko-KR')}원
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${s.color}`}>{s.label}</span>
                        <span className="text-sm font-bold text-gray-900">{ti.total_amount_krw.toLocaleString('ko-KR')}원</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>
        )}

        {/* ── Billing Profile ─────────────────────────────────────────────── */}
        {/* ── Org Management ─────────────────────────────────────────── */}
        {tab === 'org' && (
          <SectionCard title="조직 관리">
            {!orgData ? (
              /* 조직 생성 폼 */
              <div>
                <p className="text-sm text-gray-600 mb-4">
                  기업 계정으로 전환하면 팀 멤버를 초대하고 조직 단위로 빌링을 관리할 수 있습니다.
                </p>
                <div className="space-y-3 max-w-sm">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">회사명 *</label>
                    <input type="text" value={orgForm.name}
                      onChange={e => setOrgForm(f => ({ ...f, name: e.target.value }))}
                      placeholder="(주)회사명"
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">사업자등록번호</label>
                    <input type="text" value={orgForm.businessNumber}
                      onChange={e => setOrgForm(f => ({ ...f, businessNumber: e.target.value.replace(/\D/g, '') }))}
                      placeholder="0000000000" maxLength={10}
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400" />
                  </div>
                  <button
                    disabled={orgCreating || orgForm.name.trim().length < 2}
                    onClick={async () => {
                      setOrgCreating(true);
                      try {
                        const res = await fetch('/api/nexyfab/orgs', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ name: orgForm.name.trim(), businessNumber: orgForm.businessNumber || undefined }),
                        });
                        const data = await res.json();
                        if (!res.ok) { setError(data.error); return; }
                        setOrgData(data.org);
                        loadAll();
                      } catch { setError('조직 생성에 실패했습니다.'); }
                      finally { setOrgCreating(false); }
                    }}
                    className="px-5 py-2.5 text-sm font-bold rounded-lg bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-50 transition"
                  >
                    {orgCreating ? '생성 중...' : '기업 계정으로 전환'}
                  </button>
                </div>
              </div>
            ) : (
              /* 조직 관리 */
              <div className="space-y-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center text-lg font-bold text-purple-700">
                    {orgData.name.charAt(0)}
                  </div>
                  <div>
                    <p className="text-sm font-bold text-gray-900">{orgData.name}</p>
                    <p className="text-xs text-gray-400">조직 ID: {orgData.id.slice(0, 8)}...</p>
                  </div>
                </div>

                {/* 멤버 목록 */}
                <div>
                  <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">멤버 ({orgMembers.length}명)</h4>
                  <div className="space-y-1">
                    {orgMembers.map(m => (
                      <div key={m.user_id} className="flex items-center justify-between py-2 px-3 bg-gray-50 rounded-lg">
                        <div>
                          <p className="text-sm font-medium text-gray-800">{m.name}</p>
                          <p className="text-xs text-gray-400">{m.email}</p>
                        </div>
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                          m.role === 'owner' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'
                        }`}>
                          {m.role === 'owner' ? '소유자' : m.role === 'admin' ? '관리자' : '멤버'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 대기 중 초대 */}
                {orgInvites.length > 0 && (
                  <div>
                    <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">대기 중 초대</h4>
                    <div className="space-y-1">
                      {orgInvites.map(inv => (
                        <div key={inv.id} className="flex items-center justify-between py-2 px-3 bg-amber-50 rounded-lg">
                          <p className="text-sm text-gray-700">{inv.email}</p>
                          <span className="text-xs text-amber-600">
                            {new Date(inv.expires_at).toLocaleDateString('ko-KR')}까지
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 초대 폼 */}
                <div className="border-t border-gray-100 pt-4">
                  <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">멤버 초대</h4>
                  <div className="flex gap-2">
                    <input type="email" value={inviteEmail}
                      onChange={e => setInviteEmail(e.target.value)}
                      placeholder="이메일 주소"
                      className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400" />
                    <button
                      disabled={inviting || !inviteEmail.includes('@')}
                      onClick={async () => {
                        setInviting(true);
                        try {
                          const res = await fetch('/api/nexyfab/orgs/invite', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ email: inviteEmail }),
                          });
                          const data = await res.json();
                          if (!res.ok) { setError(data.error); return; }
                          setOrgInvites(prev => [...prev, data.invite]);
                          setInviteEmail('');
                        } catch { setError('초대 발송에 실패했습니다.'); }
                        finally { setInviting(false); }
                      }}
                      className="px-4 py-2 text-sm font-bold rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 transition whitespace-nowrap"
                    >
                      {inviting ? '발송 중...' : '초대'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </SectionCard>
        )}

        {tab === 'profile' && (
          <SectionCard title="사업자 정보 & 국가 설정">
            <form onSubmit={(e) => void handleProfileSave(e)} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">국가 *</label>
                  <select
                    value={profileForm.country}
                    onChange={e => {
                      const c = e.target.value;
                      const currencyMap: Record<string, string> = {
                        KR:'KRW', JP:'JPY', CN:'CNY', IN:'INR', ID:'IDR',
                        PH:'PHP', VN:'VND', TH:'THB', MY:'MYR', SG:'SGD',
                        AU:'AUD', US:'USD', BR:'BRL', MX:'MXN',
                        GB:'GBP', DE:'EUR', FR:'EUR', TR:'TRY',
                        AE:'AED', SA:'SAR', EG:'EGP', NG:'NGN',
                        __other__: 'USD',
                      };
                      setProfileForm(f => ({ ...f, country: c === '__other__' ? (pricing?.country ?? 'US') : c, currency: currencyMap[c] ?? 'USD' }));
                    }}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400"
                  >
                    {/* Tier 2 국가가 감지된 경우 상단에 표시 */}
                    {pricing?.tier === 'tier2' && pricing.country !== profileForm.country && (
                      <option value={pricing.country}>
                        🌐 {pricing.country} (현재 위치 · USD)
                      </option>
                    )}
                    <optgroup label="아시아">
                      {[['CN','🇨🇳 중국'],['IN','🇮🇳 인도'],['ID','🇮🇩 인도네시아'],
                        ['PH','🇵🇭 필리핀'],['VN','🇻🇳 베트남'],['JP','🇯🇵 일본'],
                        ['TH','🇹🇭 태국'],['MY','🇲🇾 말레이시아'],['KR','🇰🇷 한국'],
                        ['SG','🇸🇬 싱가포르']].map(([code, label]) => (
                        <option key={code} value={code}>{label}</option>
                      ))}
                    </optgroup>
                    <optgroup label="아메리카">
                      {[['US','🇺🇸 미국'],['BR','🇧🇷 브라질'],['MX','🇲🇽 멕시코']].map(([code, label]) => (
                        <option key={code} value={code}>{label}</option>
                      ))}
                    </optgroup>
                    <optgroup label="유럽">
                      {[['DE','🇩🇪 독일'],['FR','🇫🇷 프랑스'],['GB','🇬🇧 영국'],['TR','🇹🇷 터키']].map(([code, label]) => (
                        <option key={code} value={code}>{label}</option>
                      ))}
                    </optgroup>
                    <optgroup label="오세아니아">
                      {[['AU','🇦🇺 호주']].map(([code, label]) => (
                        <option key={code} value={code}>{label}</option>
                      ))}
                    </optgroup>
                    <optgroup label="중동/아프리카">
                      {[['AE','🇦🇪 UAE'],['SA','🇸🇦 사우디아라비아'],['EG','🇪🇬 이집트'],['NG','🇳🇬 나이지리아']].map(([code, label]) => (
                        <option key={code} value={code}>{label}</option>
                      ))}
                    </optgroup>
                    <optgroup label="기타 국가 (USD)">
                      <option value="__other__">기타 국가 — USD 카드결제</option>
                    </optgroup>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">결제 통화 *</label>
                  <select
                    value={profileForm.currency}
                    onChange={e => setProfileForm(f => ({ ...f, currency: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400"
                  >
                    {['KRW','JPY','USD','CNY','SGD','AUD','GBP','EUR'].map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="border-t border-gray-100 pt-4">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">
                  사업자 정보 {profileForm.country === 'KR' ? '(세금계산서 발행 필수)' : '(세금 신고용)'}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">
                      {profileForm.country === 'KR' ? '사업자등록번호' : '세금 ID / VAT 번호'}
                    </label>
                    <input
                      type="text"
                      value={profileForm.bizRegNo}
                      onChange={e => setProfileForm(f => ({ ...f, bizRegNo: e.target.value }))}
                      placeholder={profileForm.country === 'KR' ? '0000000000 (10자리)' : 'Tax ID / VAT Number'}
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">상호명 / 법인명</label>
                    <input type="text" value={profileForm.corpName}
                      onChange={e => setProfileForm(f => ({ ...f, corpName: e.target.value }))}
                      placeholder="회사명"
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">대표자명</label>
                    <input type="text" value={profileForm.ceoName}
                      onChange={e => setProfileForm(f => ({ ...f, ceoName: e.target.value }))}
                      placeholder="대표자"
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">세금계산서 수신 이메일</label>
                    <input type="email" value={profileForm.bizEmail}
                      onChange={e => setProfileForm(f => ({ ...f, bizEmail: e.target.value }))}
                      placeholder="billing@company.com"
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400" />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-gray-600 mb-1">사업장 주소</label>
                    <input type="text" value={profileForm.bizAddress}
                      onChange={e => setProfileForm(f => ({ ...f, bizAddress: e.target.value }))}
                      placeholder="주소"
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400" />
                  </div>
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button type="submit" disabled={profileSaving}
                  className="px-5 py-2.5 text-sm font-bold rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 transition">
                  {profileSaving ? '저장 중...' : '저장하기'}
                </button>
              </div>
            </form>
          </SectionCard>
        )}

        <p className="text-center text-xs text-gray-400">
          결제는 Airwallex{isKorea ? ' / Toss Payments' : ''}를 통해 안전하게 처리됩니다.
          카드 정보는 Nexysys 서버에 저장되지 않습니다.
        </p>
      </div>

      {/* ── Tax Invoice Modal ──────────────────────────────────────────────── */}
      {taxModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setTaxModal(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="bg-gray-900 text-white px-6 py-4 rounded-t-2xl">
              <h2 className="text-base font-bold">전자세금계산서 발행</h2>
              <p className="text-xs text-gray-400 mt-0.5">{taxModal.description}</p>
            </div>
            <form onSubmit={(e) => void handleTaxIssue(e)} className="p-6 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">사업자등록번호 * (10자리)</label>
                <input type="text" required maxLength={10} value={taxForm.bizRegNo}
                  onChange={e => setTaxForm(f => ({ ...f, bizRegNo: e.target.value.replace(/\D/g, '') }))}
                  placeholder="0000000000"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">상호명 *</label>
                <input type="text" required value={taxForm.corpName}
                  onChange={e => setTaxForm(f => ({ ...f, corpName: e.target.value }))}
                  placeholder="(주)회사명"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">대표자명 *</label>
                <input type="text" required value={taxForm.ceoName}
                  onChange={e => setTaxForm(f => ({ ...f, ceoName: e.target.value }))}
                  placeholder="홍길동"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">수신 이메일 *</label>
                <input type="email" required value={taxForm.bizEmail}
                  onChange={e => setTaxForm(f => ({ ...f, bizEmail: e.target.value }))}
                  placeholder="billing@company.com"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400" />
              </div>
              <div className="bg-amber-50 rounded-lg px-3 py-2 text-xs text-amber-700">
                공급가액 {Math.round(taxModal.total_amount_krw / 1.1).toLocaleString('ko-KR')}원
                + 세액 {(taxModal.total_amount_krw - Math.round(taxModal.total_amount_krw / 1.1)).toLocaleString('ko-KR')}원
                = 합계 {taxModal.total_amount_krw.toLocaleString('ko-KR')}원
              </div>
              <div className="flex gap-2 pt-1">
                <button type="submit" disabled={taxSubmitting}
                  className="flex-1 py-2.5 text-sm font-bold rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 transition">
                  {taxSubmitting ? '발행 중...' : '세금계산서 발행'}
                </button>
                <button type="button" onClick={() => setTaxModal(null)}
                  className="px-5 py-2.5 text-sm font-semibold rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
                  취소
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
