'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { formatDateTime } from '@/lib/formatDate';
import { createCommercialLocalizer } from '@/lib/i18n/commercialLocalizer';
import { useAdminI18n } from '../AdminI18nProvider';

// ── Types ────────────────────────────────────────────────────────────────────

interface Alert {
  id: string; user_id: string; email: string; name: string;
  alert_type: string; severity: string; details: string | null;
  resolved: number; resolved_by: string | null; resolved_at: number | null;
  created_at: number;
}

interface LoginEntry {
  id: string; user_id: string; email: string; name: string;
  ip: string; country: string | null; user_agent: string | null;
  method: string; success: number; risk_level: string; risk_reason: string | null;
  created_at: number;
}

interface AlertSummary { severity: string; resolved: number; count: number }

// ── Helpers ──────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function timeAgo(ts: number, L: (ko: string, en: string) => string): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return L('방금', 'Just now');
  if (mins < 60) return L(`${mins}분 전`, `${mins} min ago`);
  const hours = Math.floor(mins / 60);
  if (hours < 24) return L(`${hours}시간 전`, `${hours} hr ago`);
  const days = Math.floor(hours / 24);
  return L(`${days}일 전`, `${days} days ago`);
}

function countryFlag(code: string | null): string {
  if (!code || code.length !== 2) return '';
  return String.fromCodePoint(...[...code.toUpperCase()].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
}

const SEVERITY_COLOR: Record<string, string> = {
  critical:   'bg-red-100 text-red-700',
  suspicious: 'bg-amber-100 text-amber-700',
  medium:     'bg-amber-100 text-amber-700',
};

const RISK_COLOR: Record<string, string> = {
  normal:     'bg-green-100 text-green-700',
  suspicious: 'bg-amber-100 text-amber-700',
  critical:   'bg-red-100 text-red-700',
};

const METHOD_COLOR: Record<string, string> = {
  email:  'bg-gray-100 text-gray-600',
  google: 'bg-blue-50 text-blue-600',
  kakao:  'bg-yellow-50 text-yellow-700',
  naver:  'bg-green-50 text-green-700',
};

// ── Page ─────────────────────────────────────────────────────────────────────

export default function AdminSecurityPage() {
  const { copy, locale } = useAdminI18n();
  const L = useMemo(() => createCommercialLocalizer(locale), [locale]);
  const [tab, setTab] = useState<'alerts' | 'history'>('alerts');

  // Alerts
  const [alerts, setAlerts]         = useState<Alert[]>([]);
  const [alertSummary, setAlertSummary] = useState<AlertSummary[]>([]);
  const [alertTotal, setAlertTotal] = useState(0);
  const [alertPage, setAlertPage]   = useState(1);

  // History
  const [history, setHistory]         = useState<LoginEntry[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyPage, setHistoryPage]   = useState(1);

  // Shared
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [toast, setToast]     = useState('');
  const [filterQ, setFilterQ] = useState('');
  const [filterSeverity, setFilterSeverity] = useState('');
  const [filterResolved, setFilterResolved] = useState('0');
  const [filterRisk, setFilterRisk]     = useState('');
  const [filterMethod, setFilterMethod] = useState('');

  // Action states
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [unlockingId, setUnlockingId] = useState<string | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 3500);
  }

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      if (tab === 'alerts') {
        const params = new URLSearchParams({ tab: 'alerts', page: String(alertPage) });
        if (filterSeverity) params.set('severity', filterSeverity);
        if (filterResolved !== '') params.set('resolved', filterResolved);
        if (filterQ) params.set('q', filterQ);
        const res = await fetch(`/api/admin/security?${params}`);
        if (!res.ok) { setError(L('데이터를 불러오지 못했습니다.', 'Could not load security data.')); return; }
        const data = await res.json() as { alerts: Alert[]; total: number; summary: AlertSummary[] };
        setAlerts(data.alerts);
        setAlertTotal(data.total);
        setAlertSummary(data.summary);
      } else {
        const params = new URLSearchParams({ tab: 'history', page: String(historyPage) });
        if (filterQ) params.set('q', filterQ);
        if (filterRisk) params.set('risk', filterRisk);
        if (filterMethod) params.set('method', filterMethod);
        const res = await fetch(`/api/admin/security?${params}`);
        if (!res.ok) { setError(L('데이터를 불러오지 못했습니다.', 'Could not load security data.')); return; }
        const data = await res.json() as { history: LoginEntry[]; total: number };
        setHistory(data.history);
        setHistoryTotal(data.total);
      }
    } finally { setLoading(false); }
  }, [tab, alertPage, historyPage, filterQ, filterSeverity, filterResolved, filterRisk, filterMethod, L]);

  useEffect(() => { void load(); }, [load]);

  async function handleResolve(alertId: string) {
    setResolvingId(alertId);
    try {
      const res = await fetch('/api/admin/security', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alertId }),
      });
      if (res.ok) showToast(L('알림 해결 처리 완료', 'Alert resolved'));
      else showToast(L('오류 발생', 'An error occurred'));
      void load();
    } finally { setResolvingId(null); }
  }

  async function handleUnlock(userId: string, email: string) {
    if (!confirm(L(`${email}의 계정 잠금을 해제하시겠습니까?`, `Unlock ${email}'s account?`))) return;
    setUnlockingId(userId);
    try {
      const res = await fetch('/api/admin/security', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      if (res.ok) showToast(L('계정 잠금 해제 완료', 'Account unlocked'));
      else showToast(L('오류 발생', 'An error occurred'));
      void load();
    } finally { setUnlockingId(null); }
  }

  // Stats
  const unresolvedCritical = alertSummary.filter(s => s.severity === 'critical' && !s.resolved).reduce((a, s) => a + s.count, 0);
  const unresolvedSuspicious = alertSummary.filter(s => s.severity === 'suspicious' && !s.resolved).reduce((a, s) => a + s.count, 0);
  const totalUnresolved = alertSummary.filter(s => !s.resolved).reduce((a, s) => a + s.count, 0);

  const page = tab === 'alerts' ? alertPage : historyPage;
  const total = tab === 'alerts' ? alertTotal : historyTotal;
  const setPage = tab === 'alerts' ? setAlertPage : setHistoryPage;

  return (
    <div className="space-y-5">
      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-gray-900 text-white text-sm px-5 py-3 rounded-xl shadow-xl">
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-black text-gray-900">{copy.securityTitle}</h1>
          <p className="text-sm text-gray-500 mt-0.5">{copy.securityDescription}</p>
        </div>
        <button onClick={() => void load()}
          className="px-4 py-2 text-sm font-semibold rounded-xl border border-gray-200 bg-white hover:bg-gray-50">
          {copy.refresh}
        </button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: L('미처리 알림', 'Open alerts'), value: totalUnresolved.toString(), icon: '🔔', color: totalUnresolved > 0 ? 'text-red-600' : '' },
          { label: L('긴급 (Critical)', 'Critical'), value: unresolvedCritical.toString(), icon: '🚨', color: unresolvedCritical > 0 ? 'text-red-600' : '' },
          { label: L('주의 (Suspicious)', 'Suspicious'), value: unresolvedSuspicious.toString(), icon: '⚠️', color: unresolvedSuspicious > 0 ? 'text-amber-600' : '' },
          { label: L('전체 알림', 'All alerts'), value: alertSummary.reduce((a, s) => a + s.count, 0).toString(), icon: '📊' },
        ].map(k => (
          <div key={k.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <p className="text-xs text-gray-400">{k.icon} {k.label}</p>
            <p className={`text-2xl font-black mt-1 ${k.color || 'text-gray-900'}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        <button onClick={() => setTab('alerts')}
          className={`px-4 py-2 text-sm font-semibold rounded-lg transition ${tab === 'alerts' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
          {copy.securityAlerts} {totalUnresolved > 0 && <span className="ml-1 bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-full">{totalUnresolved}</span>}
        </button>
        <button onClick={() => setTab('history')}
          className={`px-4 py-2 text-sm font-semibold rounded-lg transition ${tab === 'history' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
          {copy.loginHistory}
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-wrap gap-3">
        {tab === 'alerts' ? (
          <>
            <select value={filterSeverity} onChange={e => { setFilterSeverity(e.target.value); setAlertPage(1); }}
              className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400">
              <option value="">{L('전체 위험도', 'All risk levels')}</option>
              <option value="critical">{L('긴급', 'Critical')}</option>
              <option value="suspicious">{L('주의', 'Warning')}</option>
            </select>
            <select value={filterResolved} onChange={e => { setFilterResolved(e.target.value); setAlertPage(1); }}
              className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400">
              <option value="0">{L('미처리', 'Unresolved')}</option>
              <option value="1">{L('처리 완료', 'Resolved')}</option>
              <option value="">{L('전체', 'All')}</option>
            </select>
          </>
        ) : (
          <>
            <select value={filterRisk} onChange={e => { setFilterRisk(e.target.value); setHistoryPage(1); }}
              className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400">
              <option value="">{L('전체 위험도', 'All risk levels')}</option>
              <option value="normal">{L('정상', 'Normal')}</option>
              <option value="suspicious">{L('주의', 'Warning')}</option>
              <option value="critical">{L('긴급', 'Critical')}</option>
            </select>
            <select value={filterMethod} onChange={e => { setFilterMethod(e.target.value); setHistoryPage(1); }}
              className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400">
              <option value="">{L('전체 방식', 'All methods')}</option>
              <option value="email">Email</option>
              <option value="google">Google</option>
              <option value="kakao">Kakao</option>
              <option value="naver">Naver</option>
            </select>
          </>
        )}
        <input value={filterQ} onChange={e => { setFilterQ(e.target.value); setPage(1); }}
placeholder={L('이메일 / 이름 / IP 검색', 'Search email / name / IP')}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400 flex-1 min-w-[160px]" />
      </div>

      {/* Content */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16"><Spinner /></div>
        ) : error ? (
          <p className="text-sm text-red-500 text-center py-10">{error}</p>
        ) : tab === 'alerts' ? (
          alerts.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-16">{L('보안 알림이 없습니다.', 'No security alerts.')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    <th className="px-4 py-3 text-left">{L('위험도', 'Risk level')}</th>
                    <th className="px-4 py-3 text-left">{L('사용자', 'User')}</th>
                    <th className="px-4 py-3 text-left">{L('유형', 'Type')}</th>
                    <th className="px-4 py-3 text-left">{L('상세', 'Details')}</th>
                    <th className="px-4 py-3 text-left">{L('시간', 'Time')}</th>
                    <th className="px-4 py-3 text-left">{L('액션', 'Action')}</th>
                  </tr>
                </thead>
                <tbody>
                  {alerts.map(a => (
                    <tr key={a.id} className={`border-b border-gray-50 hover:bg-gray-50 transition ${a.resolved ? 'opacity-50' : ''}`}>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${SEVERITY_COLOR[a.severity] ?? 'bg-gray-100 text-gray-600'}`}>
                          {a.severity === 'critical' ? L('긴급', 'Critical') : L('주의', 'Warning')}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900 truncate max-w-[120px]">{a.name}</p>
                        <p className="text-xs text-gray-400 truncate max-w-[120px]">{a.email}</p>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-700 font-semibold">{a.alert_type}</td>
                      <td className="px-4 py-3 text-xs text-gray-500 max-w-[250px] truncate">{a.details}</td>
                      <td className="px-4 py-3 text-xs">
                        <p className="text-gray-600">{timeAgo(a.created_at, L)}</p>
                        <p className="text-gray-400">{formatDateTime(a.created_at, locale)}</p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1.5">
                          {!a.resolved && (
                            <button onClick={() => void handleResolve(a.id)} disabled={resolvingId === a.id}
                              className="px-2.5 py-1 text-xs font-bold rounded-lg bg-green-600 hover:bg-green-700 text-white transition disabled:opacity-50">
                              {resolvingId === a.id ? <Spinner /> : L('해결', 'Resolve')}
                            </button>
                          )}
                          <button onClick={() => void handleUnlock(a.user_id, a.email)} disabled={unlockingId === a.user_id}
                            className="px-2.5 py-1 text-xs font-semibold rounded-lg border border-blue-200 text-blue-600 hover:bg-blue-50 transition disabled:opacity-50">
                            {unlockingId === a.user_id ? <Spinner /> : L('잠금해제', 'Unlock')}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          history.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-16">{L('로그인 이력이 없습니다.', 'No login history.')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    <th className="px-4 py-3 text-left">{L('사용자', 'User')}</th>
                    <th className="px-4 py-3 text-left">{L('IP / 국가', 'IP / Country')}</th>
                    <th className="px-4 py-3 text-left">{L('방식', 'Method')}</th>
                    <th className="px-4 py-3 text-left">{L('결과', 'Result')}</th>
                    <th className="px-4 py-3 text-left">{L('위험도', 'Risk level')}</th>
                    <th className="px-4 py-3 text-left">{L('사유', 'Reason')}</th>
                    <th className="px-4 py-3 text-left">{L('시간', 'Time')}</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map(h => (
                    <tr key={h.id} className={`border-b border-gray-50 hover:bg-gray-50 transition ${h.risk_level === 'critical' ? 'bg-red-50/50' : h.risk_level === 'suspicious' ? 'bg-amber-50/30' : ''}`}>
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900 truncate max-w-[120px]">{h.name}</p>
                        <p className="text-xs text-gray-400 truncate max-w-[120px]">{h.email}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-xs font-mono text-gray-700">{h.ip}</p>
                        {h.country && <p className="text-xs text-gray-400">{countryFlag(h.country)} {h.country}</p>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${METHOD_COLOR[h.method] ?? 'bg-gray-100 text-gray-600'}`}>
                          {h.method}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {h.success ? (
                          <span className="text-xs font-semibold text-green-600">{L('성공', 'Success')}</span>
                        ) : (
                          <span className="text-xs font-semibold text-red-500">{L('실패', 'Failed')}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${RISK_COLOR[h.risk_level] ?? ''}`}>
                          {h.risk_level === 'normal' ? L('정상', 'Normal') : h.risk_level === 'suspicious' ? L('주의', 'Warning') : L('긴급', 'Critical')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500 max-w-[200px] truncate" title={h.risk_reason ?? ''}>
                        {h.risk_reason ?? '-'}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <p className="text-gray-600">{timeAgo(h.created_at, L)}</p>
                        <p className="text-gray-400">{formatDateTime(h.created_at, locale)}</p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>

      {/* Pagination */}
      {total > 50 && (
        <div className="flex items-center justify-between text-sm">
          <p className="text-gray-400">{(page - 1) * 50 + 1}–{Math.min(page * 50, total)} / {L(`${total}건`, `${total} records`)}</p>
          <div className="flex gap-2">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)}
              className="px-4 py-2 rounded-xl border border-gray-200 bg-white disabled:opacity-40 hover:bg-gray-50 transition">
              {L('이전', 'Previous')}
            </button>
            <button disabled={page * 50 >= total} onClick={() => setPage(p => p + 1)}
              className="px-4 py-2 rounded-xl border border-gray-200 bg-white disabled:opacity-40 hover:bg-gray-50 transition">
              {L('다음', 'Next')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
