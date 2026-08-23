'use client';

// Partner Hub — the landing screen for the partner portal. Mirrors the
// customer-side Hub (`/[lang]/nexyfab/hub`) so the two surfaces feel
// related: a personalised greeting, three operational summary cards
// (today's RFQs, upcoming settlement, portfolio views), and an
// onboarding-funnel progress strip.
//
// Auth is the legacy `partnerSession` localStorage flow — same as every
// other /partner/* page. We do not block render on auth here; the per-card
// fetches handle 401 and silently degrade so the page is still readable
// for first-time visitors who came in via the cross-surface entry on the
// customer sidebar.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePartnerLang } from '../_lib/partnerLang';
import { partnerDict } from '../_lib/partnerDict';

interface HubSummary {
  todayRfqCount: number;
  upcomingSettlementKrw: number;
  portfolioViews7d: number;
  funnel: { step1: boolean; step2: boolean; step3: boolean; step4: boolean };
  company?: string | null;
}

const LOCALE_FOR_LANG: Record<string, string> = {
  ko: 'ko-KR', en: 'en-US', ja: 'ja-JP', cn: 'zh-CN', es: 'es-ES', ar: 'ar-SA',
};

function formatKrw(n: number, lang: string): string {
  return new Intl.NumberFormat(LOCALE_FOR_LANG[lang] ?? 'en-US', {
    style: 'currency', currency: 'KRW', maximumFractionDigits: 0,
  }).format(n);
}

export default function PartnerHubPage() {
  const lang = usePartnerLang();
  const t = partnerDict(lang);
  const [summary, setSummary] = useState<HubSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const session =
          typeof window !== 'undefined' ? localStorage.getItem('partnerSession') : null;
        const res = await fetch('/api/partner/hub-summary', {
          headers: session ? { Authorization: `Bearer ${session}` } : undefined,
        });
        if (!res.ok) throw new Error('non-200');
        const data = (await res.json()) as HubSummary;
        if (!cancelled) setSummary(data);
      } catch {
        // Degrade to the "no data" state — the funnel still renders so
        // unauthenticated visitors get a sense of what's behind login.
        if (!cancelled) {
          setSummary({
            todayRfqCount: 0,
            upcomingSettlementKrw: 0,
            portfolioViews7d: 0,
            funnel: { step1: false, step2: false, step3: false, step4: false },
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const funnelSteps = [
    { label: t.funnelStep1, done: summary?.funnel.step1 ?? false, href: '/partner/register' },
    { label: t.funnelStep2, done: summary?.funnel.step2 ?? false, href: '/partner/profile' },
    { label: t.funnelStep3, done: summary?.funnel.step3 ?? false, href: '/partner/portfolio' },
    { label: t.funnelStep4, done: summary?.funnel.step4 ?? false, href: '/partner/quotes' },
  ];

  return (
    <main className="min-h-screen bg-gray-50 px-6 py-8 md:px-10 md:py-10">
      <header className="mb-8 flex items-baseline justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">
            NexyFab · {t.brandSubtitle}
          </p>
          <h1 className="text-2xl md:text-3xl font-extrabold text-gray-900 mt-1">
            {t.hubTitle}
            {summary?.company ? `, ${summary.company}` : ''}
          </h1>
          <p className="text-sm text-gray-500 mt-1">{t.hubSubtitle}</p>
        </div>
        <Link
          href={`/?lang=${lang}`}
          prefetch={false}
          className="text-sm text-blue-600 font-medium hover:underline"
        >
          ← {t.goBackToCustomerSurface}
        </Link>
      </header>

      {/* Summary cards */}
      <section
        className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8"
        aria-label={t.brandSubtitle}
      >
        <Link
          href="/partner/quotes"
          prefetch={false}
          className="block rounded-2xl bg-white border border-gray-100 p-5 hover:shadow-md transition-shadow"
        >
          <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider">
            {t.cardTodayRfqTitle}
          </p>
          <p className="text-3xl font-extrabold text-gray-900 mt-2">
            {loading ? '·' : summary?.todayRfqCount ?? 0}
          </p>
          <p className="text-xs text-gray-500 mt-2 leading-relaxed">{t.cardTodayRfqDesc}</p>
        </Link>

        <Link
          href="/partner/settlements"
          prefetch={false}
          className="block rounded-2xl bg-white border border-gray-100 p-5 hover:shadow-md transition-shadow"
        >
          <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider">
            {t.cardSettlementTitle}
          </p>
          <p className="text-3xl font-extrabold text-gray-900 mt-2">
            {loading ? '·' : formatKrw(summary?.upcomingSettlementKrw ?? 0, lang)}
          </p>
          <p className="text-xs text-gray-500 mt-2 leading-relaxed">{t.cardSettlementDesc}</p>
        </Link>

        <Link
          href="/partner/portfolio"
          prefetch={false}
          className="block rounded-2xl bg-white border border-gray-100 p-5 hover:shadow-md transition-shadow"
        >
          <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider">
            {t.cardPortfolioTitle}
          </p>
          <p className="text-3xl font-extrabold text-gray-900 mt-2">
            {loading ? '·' : summary?.portfolioViews7d ?? 0}
          </p>
          <p className="text-xs text-gray-500 mt-2 leading-relaxed">{t.cardPortfolioDesc}</p>
        </Link>
      </section>

      {/* Onboarding funnel */}
      <section className="rounded-2xl bg-white border border-gray-100 p-6">
        <h2 className="text-sm font-bold text-gray-900 mb-4">{t.funnelHeader}</h2>
        <ol className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {funnelSteps.map((step, i) => (
            <li key={step.label}>
              <Link
                href={step.href}
                prefetch={false}
                className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors ${
                  step.done
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    : 'border-gray-200 bg-gray-50 text-gray-700 hover:bg-white'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${
                    step.done
                      ? 'bg-emerald-500 text-white'
                      : 'bg-gray-300 text-gray-700'
                  }`}
                >
                  {step.done ? '✓' : i + 1}
                </span>
                <span className="text-sm font-medium">{step.label}</span>
              </Link>
            </li>
          ))}
        </ol>
      </section>

      {/* Empty-state hint when there are no RFQs */}
      {!loading && summary?.todayRfqCount === 0 && (
        <p className="mt-6 text-sm text-gray-500" role="status">
          {t.emptyTodayRfq}
        </p>
      )}
    </main>
  );
}
