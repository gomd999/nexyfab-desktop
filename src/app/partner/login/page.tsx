'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { usePartnerLang } from '../_lib/partnerLang';
import { loginDict } from '../_lib/dicts/login';

export default function PartnerLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const lang = usePartnerLang();
  const t = loginDict(lang);
  // NexySys unified SSO entry — opt-in via env until auth-server Phase 2
  // ships. When unset, the SSO card stays hidden so we never advertise a
  // broken button.
  const nexysysSsoUrl = process.env.NEXT_PUBLIC_NEXYSYS_OAUTH_URL;

  useEffect(() => {
    // If a session already exists → hub.
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
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Brand */}
        <div className="text-center mb-8">
          <Link href="/" prefetch={false} className="inline-block">
            <span className="text-2xl font-black text-gray-900">NexyFab</span>
          </Link>
          <h1 className="text-xl font-bold text-gray-800 mt-3">{t.pageTitle}</h1>
          <p className="text-sm text-gray-500 mt-1">{t.pageSubtitle}</p>
        </div>

        {/* NexySys unified SSO — preferred entry once auth-server Phase 2
            ships. Promoted above the legacy access-code form so new
            partners default to SSO. Hidden when
            NEXT_PUBLIC_NEXYSYS_OAUTH_URL is unset so we never advertise a
            broken button. */}
        {nexysysSsoUrl && (
          <div className="mb-4 bg-white rounded-2xl shadow-sm border-2 border-blue-100 p-6">
            <p className="text-xs font-bold text-blue-600 uppercase tracking-wide text-center mb-3">{t.ssoCardKicker}</p>
            <a
              href={`${nexysysSsoUrl}?return_to=${encodeURIComponent(`/partner/hub?lang=${lang}`)}`}
              className="w-full inline-block text-center py-3 bg-gray-900 hover:bg-black text-white font-bold rounded-xl transition text-sm"
            >
              {t.ssoCardBtn}
            </a>
            <p className="mt-2 text-center text-[11px] text-gray-400">
              {t.ssoCardHint}
            </p>
          </div>
        )}

        <div className={`bg-white rounded-2xl shadow-sm border border-gray-100 p-8 ${nexysysSsoUrl ? 'opacity-90' : ''}`}>
          {nexysysSsoUrl && (
            <p className="text-[11px] text-gray-400 mb-3 text-center">
              {t.legacyHint}
            </p>
          )}
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
                autoFocus
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

            {error && (
              <div className="px-4 py-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl font-semibold">
                {error}
              </div>
            )}

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
