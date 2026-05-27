'use client';

// LegacyMigrationBanner — shown to partners still authenticated via the
// legacy access-code session (localStorage `partnerSession`) but who do
// NOT yet have a NexySys SSO cookie. Encourages them to upgrade so we
// can deprecate the legacy path.
//
// Skipped for:
//   - demo sessions (`partnerSession === 'demo'`)
//   - SSO-authenticated partners (`nf_partner_sso=1` cookie present)
//   - sessions where the partner already dismissed within 7 days
//
// Snooze is stored client-side (localStorage). We don't need a server
// record — losing the dismiss across devices is fine for a soft nudge.

import { useEffect, useState } from 'react';
import { usePartnerLang } from './_lib/partnerLang';
import { migrationDict } from './_lib/dicts/migration';

const SNOOZE_KEY = 'nf_partner_migration_snoozed_until';
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

function hasSsoCookie(): boolean {
  if (typeof document === 'undefined') return false;
  return document.cookie.split('; ').some(c => c.startsWith('nf_partner_sso=1'));
}

function isLegacySession(): boolean {
  if (typeof window === 'undefined') return false;
  if (hasSsoCookie()) return false;
  const session = window.localStorage.getItem('partnerSession');
  if (!session) return false;
  if (session === 'demo') return false;
  return true;
}

function isSnoozed(): boolean {
  if (typeof window === 'undefined') return true;
  const raw = window.localStorage.getItem(SNOOZE_KEY);
  if (!raw) return false;
  const until = Number(raw);
  if (!Number.isFinite(until)) return false;
  return Date.now() < until;
}

export default function LegacyMigrationBanner() {
  const lang = usePartnerLang();
  const t = migrationDict(lang);
  const [show, setShow] = useState(false);

  useEffect(() => {
    setShow(isLegacySession() && !isSnoozed());
  }, []);

  if (!show) return null;

  const ssoStartHref = `/partner/oauth/start?lang=${encodeURIComponent(lang)}&return_to=${encodeURIComponent(typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/partner/hub')}`;

  function snooze() {
    try {
      window.localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
    } catch { /* localStorage may be unavailable */ }
    setShow(false);
  }

  return (
    <div
      role="region"
      aria-label={t.title}
      className="border-b border-blue-100 bg-blue-50/70 backdrop-blur"
    >
      <div className="max-w-6xl mx-auto px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-bold text-blue-600 uppercase tracking-wide">{t.kicker}</p>
          <p className="text-sm font-bold text-gray-800 mt-0.5">{t.title}</p>
          <p className="text-xs text-gray-600 mt-0.5">{t.body}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <a
            href={ssoStartHref}
            className="px-4 py-2 bg-gray-900 hover:bg-black text-white text-xs font-bold rounded-lg transition whitespace-nowrap"
          >
            {t.cta}
          </a>
          <button
            type="button"
            onClick={snooze}
            className="px-3 py-2 text-xs font-semibold text-gray-500 hover:text-gray-700 transition whitespace-nowrap"
          >
            {t.dismiss}
          </button>
        </div>
      </div>
    </div>
  );
}
