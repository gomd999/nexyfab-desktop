'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAdminI18n } from '../AdminI18nProvider';
import { createCommercialLocalizer } from '@/lib/i18n/commercialLocalizer';
import { formatDate } from '@/lib/i18n/format';

interface AccessEmail {
  id: string;
  email: string;
  active: boolean;
  addedBy: string | null;
  createdAt: number;
  updatedAt: number;
}

export default function AdminAccessEmailsPage() {
  const { copy, locale } = useAdminI18n();
  const L = useMemo(() => createCommercialLocalizer(locale), [locale]);
  const [emails, setEmails] = useState<AccessEmail[]>([]);
  const [currentEmail, setCurrentEmail] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyEmail, setBusyEmail] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/admin/access-emails', { cache: 'no-store' });
      const data = await response.json() as { emails?: AccessEmail[]; currentEmail?: string; error?: string };
      if (!response.ok) throw new Error(L('목록을 불러오지 못했습니다.', 'Unable to load the list.'));
      setEmails(data.emails ?? []);
      setCurrentEmail(data.currentEmail ?? '');
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : L('목록을 불러오지 못했습니다.', 'Unable to load the list.') });
    } finally {
      setLoading(false);
    }
  }, [L]);

  useEffect(() => { void load(); }, [load]);

  async function addEmail(event: React.FormEvent) {
    event.preventDefault();
    if (!newEmail.trim()) return;
    setBusyEmail(newEmail);
    setMessage(null);
    try {
      const response = await fetch('/api/admin/access-emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newEmail }),
      });
      if (!response.ok) throw new Error(L('관리자 이메일을 추가하지 못했습니다.', 'Unable to add the admin email.'));
      setNewEmail('');
      setMessage({ kind: 'ok', text: L('관리자 이메일을 추가했습니다.', 'Admin email added.') });
      await load();
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : L('관리자 이메일을 추가하지 못했습니다.', 'Unable to add the admin email.') });
    } finally {
      setBusyEmail(null);
    }
  }

  async function toggle(entry: AccessEmail) {
    setBusyEmail(entry.email);
    setMessage(null);
    try {
      const response = await fetch('/api/admin/access-emails', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: entry.email, active: !entry.active }),
      });
      if (!response.ok) throw new Error(L('관리자 이메일 상태를 변경하지 못했습니다.', 'Unable to update the admin email status.'));
      setMessage({ kind: 'ok', text: entry.active ? L('관리자 이메일을 비활성화했습니다.', 'Admin email deactivated.') : L('관리자 이메일을 다시 활성화했습니다.', 'Admin email reactivated.') });
      await load();
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : L('관리자 이메일 상태를 변경하지 못했습니다.', 'Unable to update the admin email status.') });
    } finally {
      setBusyEmail(null);
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-black text-gray-900">{copy.accessTitle}</h1>
        <p className="text-sm text-gray-500 mt-1">{copy.accessDescription}</p>
      </div>

      <section className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
        <h2 className="font-bold text-gray-900 mb-1">{copy.accessAdd}</h2>
        <p className="text-xs text-gray-500 mb-4">{L('추가 즉시 로그인할 수 있으며 등록 안내 메일이 발송됩니다.', 'The address can sign in immediately, and an enrollment email will be sent.')}</p>
        <form onSubmit={addEmail} className="flex gap-2 flex-col sm:flex-row">
          <input
            type="email"
            value={newEmail}
            onChange={(event) => setNewEmail(event.target.value)}
            placeholder="admin@example.com"
            className="flex-1 px-4 py-2.5 rounded-xl border border-gray-300 text-sm outline-none focus:border-blue-500"
          />
          <button disabled={!newEmail.trim() || busyEmail !== null} className="px-5 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-bold disabled:opacity-50">
            {copy.accessAdd}
          </button>
        </form>
      </section>

      {message && (
        <div role="status" className={`rounded-xl px-4 py-3 text-sm border ${message.kind === 'ok' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
          {message.text}
        </div>
      )}

      <section className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-gray-900">{copy.accessList}</h2>
            <p className="text-xs text-gray-500 mt-0.5">{L('현재 로그인:', 'Signed in as:')} {currentEmail || L('확인 중…', 'Checking…')}</p>
          </div>
          <span className="text-xs text-gray-500">{L(`활성 ${emails.filter(item => item.active).length}명`, `${emails.filter(item => item.active).length} active`)}</span>
        </div>
        {loading ? (
          <div className="p-8 text-sm text-gray-400 text-center">{L('불러오는 중…', 'Loading…')}</div>
        ) : emails.length === 0 ? (
          <div className="p-8 text-sm text-red-600 text-center">{L('활성 관리자 이메일이 없습니다. 배포 환경의 ADMIN_BOOTSTRAP_EMAILS를 확인하세요.', 'There are no active admin emails. Check ADMIN_BOOTSTRAP_EMAILS in the deployment environment.')}</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {emails.map(entry => {
              const isCurrent = entry.email === currentEmail;
              return (
                <div key={entry.id} className="px-6 py-4 flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-gray-900 break-all">{entry.email}</span>
                      {isCurrent && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">{L('현재 세션', 'Current session')}</span>}
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${entry.active ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>{entry.active ? L('활성', 'Active') : L('비활성', 'Inactive')}</span>
                    </div>
                    <div className="text-[11px] text-gray-400 mt-1">{L('추가:', 'Added:')} {formatDate(entry.createdAt, locale, { dateStyle: 'medium', timeStyle: 'short' }) ?? '-'} · {L('추가자:', 'Added by:')} {entry.addedBy ?? '-'}</div>
                  </div>
                  <button
                    type="button"
                    disabled={busyEmail !== null || isCurrent}
                    onClick={() => { void toggle(entry); }}
                    title={isCurrent ? L('현재 로그인한 이메일은 비활성화할 수 없습니다.', 'The currently signed-in email cannot be deactivated.') : undefined}
                    className={`px-4 py-2 rounded-lg text-xs font-bold border disabled:opacity-40 ${entry.active ? 'border-red-200 text-red-600 hover:bg-red-50' : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'}`}
                  >
                    {entry.active ? L('비활성화', 'Deactivate') : L('활성화', 'Activate')}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-800 leading-6">
        {L('마지막 활성 이메일과 현재 로그인한 이메일은 비활성화할 수 없습니다. 이메일을 비활성화하면 해당 주소의 기존 관리자 세션도 즉시 폐기됩니다.', 'You cannot deactivate the last active email or the email currently signed in. Deactivating an email immediately revokes its existing admin sessions.')}
      </div>
    </div>
  );
}
