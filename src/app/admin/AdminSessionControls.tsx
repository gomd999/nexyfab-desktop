'use client';

import { useEffect, useState } from 'react';
import { useAdminI18n } from './AdminI18nProvider';
import { createCommercialLocalizer } from '@/lib/i18n/commercialLocalizer';

export default function AdminSessionControls() {
  const [email, setEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { locale } = useAdminI18n();
  const L = createCommercialLocalizer(locale);

  useEffect(() => {
    void fetch('/api/admin/auth', { cache: 'no-store' })
      .then(response => response.json())
      .then((data: { email?: string | null }) => setEmail(data.email ?? null))
      .catch(() => undefined);
  }, []);

  async function logout() {
    setBusy(true);
    try {
      await fetch('/api/admin/auth', { method: 'DELETE' });
    } finally {
      window.location.assign('/admin');
    }
  }

  return (
    <div className="flex items-center gap-2">
      {email && <span className="hidden xl:inline text-[11px] text-gray-400 max-w-44 truncate" title={email}>{email}</span>}
      <button
        type="button"
        onClick={() => { void logout(); }}
        disabled={busy}
        className="text-xs text-gray-500 hover:text-red-600 px-2 py-1 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50"
      >
        {busy ? L('종료 중…', 'Signing out…') : L('로그아웃', 'Sign out')}
      </button>
    </div>
  );
}
