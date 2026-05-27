'use client';

import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { usePartnerLang } from '../_lib/partnerLang';
import { loginDict, type LoginDict } from '../_lib/dicts/login';

function mapErrCode(err: string | null, t: LoginDict): string {
  if (!err) return '';
  switch (err) {
    case 'state_mismatch':       return t.errStateMismatch;
    case 'token_exchange_failed':return t.errTokenExchange;
    case 'invalid_token':        return t.errInvalidToken;
    case 'no_token':             return t.errNoToken;
    case 'sso_unconfigured':     return t.errSsoUnconfigured;
    default:                     return '';
  }
}

function PartnerLoginPageInner() {
  const router = useRouter();
  const search = useSearchParams();
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showLegacy, setShowLegacy] = useState(false);
  const lang = usePartnerLang();
  const t = loginDict(lang);

  // SSO entry — always go through `/partner/oauth/start`. That route
  // performs env detection server-side and redirects back here with
  // `?err=sso_unconfigured` when CLIENT_ID is missing, so the client
  // doesn't need a separate `NEXT_PUBLIC_*` flag.
  const ssoStartHref = `/partner/oauth/start?lang=${encodeURIComponent(lang)}&return_to=${encodeURIComponent(`/partner/hub?lang=${lang}`)}`;

  // Surface OAuth callback errors on first paint.
  useEffect(() => {
    const err = search?.get('err');
    if (err) {
      setError(mapErrCode(err, t));
      // If SSO is unconfigured, auto-expand the legacy form so the
      // partner has somewhere to go.
      if (err === 'sso_unconfigured') setShowLegacy(true);
    }
  }, [search, t]);

  useEffect(() => {
    // Already authenticated? Bounce to hub. Two checks:
    //   1. legacy localStorage session (pre-cutover partners)
    //   2. SSO cookie sentinel `nf_partner_sso=1` set by callback
    const sso = typeof document !== 'undefined' && document.cookie.split('; ').some(c => c.startsWith('nf_partner_sso=1'));
    if (sso) { router.replace(`/partner/hub?lang=${lang}`); return; }
    const session = localStorage.getItem('partnerSession');
    if (!session) return;
    if (session === 'demo') { router.replace(`/partner/hub?lang=${lang}`); return; }
    fetch(`/api/partner/auth?session=${session}`)
      .then(r => r.json())
      .then(d => { if (d.valid) router.replace(`/partner/hub?lang=${lang}`); })
      .catch(() => {});
  }, [router, lang]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/partner/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), token: token.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || t.errLogin);
        return;
      }

      localStorage.setItem('partnerSession', data.sessionToken);
      localStorage.setItem('partnerInfo', JSON.stringify(data.partner));
      router.push(`/partner/hub?lang=${lang}`);
    } catch {
      setError(t.errServer);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden" style={{ background: '#f4f6fb' }}>
      {/* NexyFlow-style background blobs */}
      <div className="absolute pointer-events-none" style={{ top: '-20%', right: '-10%', width: 600, height: 600, background: 'rgba(96, 165, 250, 0.10)', borderRadius: '50%', filter: 'blur(120px)' }} />
      <div className="absolute pointer-events-none" style={{ bottom: '-20%', left: '-10%', width: 600, height: 600, background: 'rgba(245, 158, 11, 0.10)', borderRadius: '50%', filter: 'blur(120px)' }} />
      <style>{`@keyframes nfPartnerScaleIn { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }`}</style>

      <div className="w-full max-w-md relative" style={{ zIndex: 1, animation: 'nfPartnerScaleIn 0.25s ease-out' }}>
        {/* Brand */}
        <div className="text-center mb-8">
          <Link href="/" prefetch={false} className="inline-block">
            <span className="text-2xl font-black text-gray-900">NexyFab</span>
          </Link>
          <h1 className="text-xl font-bold text-gray-800 mt-3">{t.pageTitle}</h1>
          <p className="text-sm text-gray-500 mt-1">{t.pageSubtitle}</p>
        </div>

        {/* Callback / submit error banner */}
        {error && (
          <div role="alert" className="mb-4 px-4 py-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl font-semibold flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        {/* NexySys unified SSO — primary CTA. Always shown; the
            `/partner/oauth/start` route handles env-absent fallback
            by sending users back here with `?err=sso_unconfigured`. */}
        <div className="mb-4 bg-white rounded-2xl shadow-sm border-2 border-blue-200 p-6">
          <p className="text-xs font-bold text-blue-600 uppercase tracking-wide text-center mb-3">{t.ssoCardKicker}</p>
          <a
            href={ssoStartHref}
            className="w-full inline-block text-center py-3 bg-gray-900 hover:bg-black text-white font-bold rounded-xl transition text-sm"
          >
            {t.ssoCardBtn}
          </a>
          <p className="mt-2 text-center text-[11px] text-gray-400">
            {t.ssoCardHint}
          </p>
        </div>

        {/* Legacy access-code form — collapsed by default; expanded
            when toggled or when the SSO route returns `sso_unconfigured`. */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <button
            type="button"
            onClick={() => setShowLegacy(v => !v)}
            className="w-full px-6 py-3 text-left text-xs font-semibold text-gray-500 hover:bg-gray-50 flex items-center justify-between"
            aria-expanded={showLegacy}
          >
            <span>{showLegacy ? t.legacyToggleHide : t.legacyToggleShow}</span>
            <span className="text-gray-300">{showLegacy ? '−' : '+'}</span>
          </button>
          {showLegacy && (
            <div className="px-6 pb-6">
              <p className="text-[11px] text-gray-400 mb-3">
                {t.legacyHint}
              </p>
              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                    {t.emailLabel}
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                    placeholder={t.emailPlaceholder}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                    {t.codeLabel}
                  </label>
                  <input
                    type="text"
                    value={token}
                    onChange={e => setToken(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    required
                    placeholder={t.codePlaceholder}
                    maxLength={6}
                    inputMode="numeric"
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition font-mono tracking-widest text-center text-lg"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading || email.length < 3 || token.length !== 6}
                  className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition disabled:opacity-50 text-sm"
                >
                  {loading ? t.submitting : t.submit}
                </button>
              </form>

              <p className="mt-6 text-center text-xs text-gray-400">
                {t.noCode}{' '}
                <span className="text-gray-600">{t.contactStaff}</span>
              </p>

              <p className="mt-3 text-center text-xs text-gray-400">
                {t.noAccount}{' '}
                <Link href={`/partner/register?lang=${lang}`} prefetch={false} className="text-blue-600 font-semibold hover:underline">{t.applyAsPartner}</Link>
              </p>
            </div>
          )}
        </div>

        {/* Demo entry */}
        <div className="mt-4 bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wide text-center mb-3">{t.demoKicker}</p>
          <button
            onClick={() => {
              localStorage.setItem('partnerSession', 'demo');
              localStorage.setItem('partnerInfo', JSON.stringify({
                email: 'demo-partner@nexyfab.com',
                company: 'Demo 제조사',
                factoryId: 'demo-factory-001',
                factoryName: 'Demo 제조사',
              }));
              router.push(`/partner/hub?lang=${lang}`);
            }}
            className="w-full py-3 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold rounded-xl transition text-sm border border-blue-200"
          >
            {t.demoBtn}
          </button>
          <p className="text-xs text-gray-400 text-center mt-2">{t.demoNote}</p>
        </div>

        <p className="text-center mt-4 text-xs text-gray-400">
          {t.inquiryLine}{' '}
          <a href="mailto:partner@nexyfab.com" className="text-gray-500 hover:underline">partner@nexyfab.com</a>
        </p>

        <p className="text-center mt-2 text-xs text-gray-400">
          {t.unifiedLoginPrefix}
          <Link href="/login" prefetch={false} className="text-blue-600 font-semibold hover:underline">{t.unifiedLoginLink}</Link>
          {t.unifiedLoginSuffix}
        </p>
      </div>
    </div>
  );
}

export default function PartnerLoginPage() {
  // useSearchParams requires a Suspense boundary in app-router pages.
  return (
    <Suspense fallback={null}>
      <PartnerLoginPageInner />
    </Suspense>
  );
}
