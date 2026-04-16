'use client';

import { useEffect, useState, useCallback } from 'react';

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

function fmtFull(ts: number) {
  return new Date(ts).toLocaleString('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return '방금';
  if (mins < 60) return `${mins}분 전`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  return `${days}일 전`;
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
  const [authed, setAuthed]   = useState(false);
  const [pw, setPw]           = useState('');
  const [pwError, setPwError] = useState(false);

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

  async function login() {
    const res = await fetch('/api/admin/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    });
    if (res.ok) { setAuthed(true); setPwError(false); }
    else setPwError(true);
  }

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
        if (!res.ok) { setError('데이터를 불러오지 못했습니다.'); return; }
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
        if (!res.ok) { setError('데이터를 불러오지 못했습니다.'); return; }
        const data = await res.json() as { history: LoginEntry[]; total: number };
        setHistory(data.history);
        setHistoryTotal(data.total);
      }
    } finally { setLoading(false); }
  }, [tab, alertPage, historyPage, filterQ, filterSeverity, filterResolved, filterRisk, filterMethod]);

  useEffect(() => { if (authed) void load(); }, [authed, load]);

  async function handleResolve(alertId: string) {
    setResolvingId(alertId);
    try {
      const res = await fetch('/api/admin/security', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alertId }),
      });
      if (res.ok) showToast('알림 해결 처리 완료');
      else showToast('오류 발생');
      void load();
    } finally { setResolvingId(null); }
  }

  async function handleUnlock(userId: string, email: string) {
    if (!confirm(`${email}의 계정 잠금을 해제하시겠습니까?`)) return;
    setUnlockingId(userId);
    try {
      const res = await fetch('/api/admin/security', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      if (res.ok) showToast('계정 잠금 해제 완료');
      else showToast('오류 발생');
      void load();
    } finally { setUnlockingId(null); }
  }

  // Stats
  const unresolvedCritical = alertSummary.filter(s => s.severity === 'critical' && !s.resolved).reduce((a, s) => a + s.count, 0);
  const unresolvedSuspicious = alertSummary.filter(s => s.severity === 'suspicious' && !s.resolved).reduce((a, s) => a + s.count, 0);
  const totalUnresolved = alertSummary.filter(s => !s.resolved).reduce((a, s) => a + s.count, 0);

  // ── Login gate ─────────────────────────────────────────────────────────────
  if (!authed) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 w-full max-w-sm">
          <div className="text-center mb-6">
            <div className="text-3xl mb-2">🛡️</div>
            <h1 className="text-xl font-black text-gray-900">보안 모니터링</h1>
            <p className="text-xs text-gray-400 mt-1">관리자 인증 필요</p>
          </div>
          <input type="password" value={pw} onChange={e => setPw(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && void login()}
            placeholder="관리자 비밀번호"
            className={`w-full px-4 py-2.5 rounded-xl border text-sm mb-3 outline-none ${pwError ? 'border-red-400 bg-red-50' : 'border-gray-200 focus:border-blue-400'}`} />
          <button onClick={() => void login()}
            className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-sm transition">
            로그인
          </button>
          {pwError && <p className="text-red-500 text-xs text-center mt-2">비밀번호가 틀렸습니다</p>}
        </div>
      </div>
    );
  }

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
          <h1 className="text-2xl font-black text-gray-900">보안 모니터링</h1>
          <p className="text-sm text-gray-500 mt-0.5">로그인 이상 탐지 및 보안 알림</p>
        </div>
        <button onClick={() => void load()}
          className="px-4 py-2 text-sm font-semibold rounded-xl border border-gray-200 bg-white hover:bg-gray-50">
          새로고침
        </button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: '미처리 알림', value: totalUnresolved.toString(), icon: '🔔', color: totalUnresolved > 0 ? 'text-red-600' : '' },
          { label: '긴급 (Critical)', value: unresolvedCritical.toString(), icon: '🚨', color: unresolvedCritical > 0 ? 'text-red-600' : '' },
          { label: '주의 (Suspicious)', value: unresolvedSuspicious.toString(), icon: '⚠️', color: unresolvedSuspicious > 0 ? 'text-amber-600' : '' },
          { label: '전체 알림', value: alertSummary.reduce((a, s) => a + s.count, 0).toString(), icon: '📊' },
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
          보안 알림 {totalUnresolved > 0 && <span className="ml-1 bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-full">{totalUnresolved}</span>}
        </button>
        <button onClick={() => setTab('history')}
          className={`px-4 py-2 text-sm font-semibold rounded-lg transition ${tab === 'history' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
          로그인 이력
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-wrap gap-3">
        {tab === 'alerts' ? (
          <>
            <select value={filterSeverity} onChange={e => { setFilterSeverity(e.target.value); setAlertPage(1); }}
              className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400">
              <option value="">전체 위험도</option>
              <option value="critical">긴급</option>
              <option value="suspicious">주의</option>
            </select>
            <select value={filterResolved} onChange={e => { setFilterResolved(e.target.value); setAlertPage(1); }}
              className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400">
              <option value="0">미처리</option>
              <option value="1">처리 완료</option>
              <option value="">전체</option>
            </select>
          </>
        ) : (
          <>
            <select value={filterRisk} onChange={e => { setFilterRisk(e.target.value); setHistoryPage(1); }}
              className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400">
              <option value="">전체 위험도</option>
              <option value="normal">정상</option>
              <option value="suspicious">주의</option>
              <option value="critical">긴급</option>
            </select>
            <select value={filterMethod} onChange={e => { setFilterMethod(e.target.value); setHistoryPage(1); }}
              className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400">
              <option value="">전체 방식</option>
              <option value="email">Email</option>
              <option value="google">Google</option>
              <option value="kakao">Kakao</option>
              <option value="naver">Naver</option>
            </select>
          </>
        )}
        <input value={filterQ} onChange={e => { setFilterQ(e.target.value); setPage(1); }}
          placeholder="이메일 / 이름 / IP 검색"
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
            <p className="text-sm text-gray-400 text-center py-16">보안 알림이 없습니다.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    <th className="px-4 py-3 text-left">위험도</th>
                    <th className="px-4 py-3 text-left">사용자</th>
                    <th className="px-4 py-3 text-left">유형</th>
                    <th className="px-4 py-3 text-left">상세</th>
                    <th className="px-4 py-3 text-left">시간</th>
                    <th className="px-4 py-3 text-left">액션</th>
                  </tr>
                </thead>
                <tbody>
                  {alerts.map(a => (
                    <tr key={a.id} className={`border-b border-gray-50 hover:bg-gray-50 transition ${a.resolved ? 'opacity-50' : ''}`}>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${SEVERITY_COLOR[a.severity] ?? 'bg-gray-100 text-gray-600'}`}>
                          {a.severity === 'critical' ? '긴급' : '주의'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900 truncate max-w-[120px]">{a.name}</p>
                        <p className="text-xs text-gray-400 truncate max-w-[120px]">{a.email}</p>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-700 font-semibold">{a.alert_type}</td>
                      <td className="px-4 py-3 text-xs text-gray-500 max-w-[250px] truncate">{a.details}</td>
                      <td className="px-4 py-3 text-xs">
                        <p className="text-gray-600">{timeAgo(a.created_at)}</p>
                        <p className="text-gray-400">{fmtFull(a.created_at)}</p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1.5">
                          {!a.resolved && (
                            <button onClick={() => void handleResolve(a.id)} disabled={resolvingId === a.id}
                              className="px-2.5 py-1 text-xs font-bold rounded-lg bg-green-600 hover:bg-green-700 text-white transition disabled:opacity-50">
                              {resolvingId === a.id ? <Spinner /> : '해결'}
                            </button>
                          )}
                          <button onClick={() => void handleUnlock(a.user_id, a.email)} disabled={unlockingId === a.user_id}
                            className="px-2.5 py-1 text-xs font-semibold rounded-lg border border-blue-200 text-blue-600 hover:bg-blue-50 transition disabled:opacity-50">
                            {unlockingId === a.user_id ? <Spinner /> : '잠금해제'}
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
            <p className="text-sm text-gray-400 text-center py-16">로그인 이력이 없습니다.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    <th className="px-4 py-3 text-left">사용자</th>
                    <th className="px-4 py-3 text-left">IP / 국가</th>
                    <th className="px-4 py-3 text-left">방식</th>
                    <th className="px-4 py-3 text-left">결과</th>
                    <th className="px-4 py-3 text-left">위험도</th>
                    <th className="px-4 py-3 text-left">사유</th>
                    <th className="px-4 py-3 text-left">시간</th>
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
                          <span className="text-xs font-semibold text-green-600">성공</span>
                        ) : (
                          <span className="text-xs font-semibold text-red-500">실패</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${RISK_COLOR[h.risk_level] ?? ''}`}>
                          {h.risk_level === 'normal' ? '정상' : h.risk_level === 'suspicious' ? '주의' : '긴급'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500 max-w-[200px] truncate" title={h.risk_reason ?? ''}>
                        {h.risk_reason ?? '-'}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <p className="text-gray-600">{timeAgo(h.created_at)}</p>
                        <p className="text-gray-400">{fmtFull(h.created_at)}</p>
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
          <p className="text-gray-400">{(page - 1) * 50 + 1}–{Math.min(page * 50, total)} / {total}건</p>
          <div className="flex gap-2">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)}
              className="px-4 py-2 rounded-xl border border-gray-200 bg-white disabled:opacity-40 hover:bg-gray-50 transition">
              이전
            </button>
            <button disabled={page * 50 >= total} onClick={() => setPage(p => p + 1)}
              className="px-4 py-2 rounded-xl border border-gray-200 bg-white disabled:opacity-40 hover:bg-gray-50 transition">
              다음
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
