'use client';
// ─── Enterprise Audit Log Page ────────────────────────────────────────────────
// Displays audit log entries from /api/nexyfab/audit with filters and CSV export.
// Inline styles, dark theme, bilingual ko/en.

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useAuthStore } from '@/hooks/useAuth';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AuditEntry {
  id: string;
  userId: string;
  action: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  ip?: string;
  createdAt: number;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const S = {
  page: {
    minHeight: '100vh',
    background: '#0f1117',
    color: '#e5e7eb',
    fontFamily: "'Inter', 'Noto Sans KR', sans-serif",
    padding: '40px 24px',
  } as React.CSSProperties,
  card: {
    background: '#1a1d27',
    border: '1px solid #2d3748',
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
  } as React.CSSProperties,
  input: {
    background: '#0f1117',
    border: '1px solid #374151',
    borderRadius: 8,
    color: '#e5e7eb',
    fontSize: 13,
    padding: '7px 11px',
    outline: 'none',
    minWidth: 160,
  } as React.CSSProperties,
  label: {
    fontSize: 12,
    color: '#9ca3af',
    marginBottom: 4,
    display: 'block',
  } as React.CSSProperties,
  th: {
    padding: '10px 12px',
    fontSize: 12,
    fontWeight: 600,
    color: '#9ca3af',
    textAlign: 'left',
    borderBottom: '1px solid #2d3748',
    whiteSpace: 'nowrap',
    background: '#12141c',
  } as React.CSSProperties,
  td: {
    padding: '9px 12px',
    fontSize: 13,
    color: '#d1d5db',
    borderBottom: '1px solid #1f2937',
    maxWidth: 240,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  } as React.CSSProperties,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
}

function actionBadgeColor(action: string): string {
  if (action.startsWith('project')) return '#1d4ed8';
  if (action.startsWith('rfq')) return '#065f46';
  if (action.startsWith('export')) return '#7c3aed';
  if (action.startsWith('sso')) return '#92400e';
  return '#374151';
}

function entriestoCSV(entries: AuditEntry[]): string {
  const header = ['id', 'userId', 'action', 'resourceId', 'ip', 'createdAt', 'metadata'];
  const rows = entries.map(e => [
    e.id,
    e.userId,
    e.action,
    e.resourceId ?? '',
    e.ip ?? '',
    new Date(e.createdAt).toISOString(),
    JSON.stringify(e.metadata ?? {}),
  ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
  return [header.join(','), ...rows].join('\n');
}

// ─── Non-enterprise gate ──────────────────────────────────────────────────────

function NotEnterprise() {
  const { lang } = useParams<{ lang: string }>();
  return (
    <div style={{ ...S.page, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ ...S.card, textAlign: 'center', maxWidth: 480 }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>🔒</div>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
          Enterprise 플랜이 필요합니다
        </div>
        <div style={{ fontSize: 14, color: '#6b7280' }}>
          Enterprise plan required to access audit logs.
        </div>
        <div style={{ marginTop: 16 }}>
          <a href={`/${lang}/nexyfab/pricing`} style={{ color: '#3B82F6', fontSize: 13 }}>플랜 업그레이드 / Upgrade →</a>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AuditLogPage() {
  const { user } = useAuthStore();

  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [filterAction, setFilterAction] = useState('');
  const [filterUserId, setFilterUserId] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');

  const planHeader = { 'x-nexyfab-plan': user?.plan ?? '' };

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '500' });
      if (filterAction) params.set('action', filterAction);
      if (filterUserId) params.set('userId', filterUserId);
      const res = await fetch(`/api/nexyfab/audit?${params.toString()}`, { headers: planHeader });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error ?? 'Failed to load audit logs');
        return;
      }
      const data: { entries: AuditEntry[] } = await res.json();

      let result = data.entries;

      // Client-side date range filter
      if (filterDateFrom) {
        const from = new Date(filterDateFrom).getTime();
        result = result.filter(e => e.createdAt >= from);
      }
      if (filterDateTo) {
        const to = new Date(filterDateTo).getTime() + 86_400_000; // inclusive
        result = result.filter(e => e.createdAt <= to);
      }

      setEntries(result);
    } catch {
      setError('네트워크 오류 / Network error');
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterAction, filterUserId, filterDateFrom, filterDateTo, user?.plan]);

  useEffect(() => {
    if (user?.plan === 'enterprise') fetchLogs();
    else setLoading(false);
  }, [user?.plan, fetchLogs]);

  // ── CSV export ─────────────────────────────────────────────────────────────

  const exportCSV = () => {
    const csv = entriestoCSV(entries);
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Gate ───────────────────────────────────────────────────────────────────

  if (!loading && user?.plan !== 'enterprise') return <NotEnterprise />;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={S.page}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: 28, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0, marginBottom: 4 }}>
              감사 로그 / Audit Logs
            </h1>
            <p style={{ color: '#6b7280', fontSize: 13, margin: 0 }}>
              Enterprise 계정의 모든 활동 기록 / Full activity history for your organization
            </p>
          </div>
          <button
            style={{
              padding: '8px 16px', background: '#1a1d27', border: '1px solid #374151',
              borderRadius: 8, color: '#e5e7eb', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}
            onClick={exportCSV}
            disabled={entries.length === 0}
          >
            CSV 내보내기 / Export CSV
          </button>
        </div>

        {/* Filters */}
        <div style={{ ...S.card, display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label style={S.label}>액션 prefix / Action prefix</label>
            <input
              style={S.input}
              placeholder="project, rfq, export…"
              value={filterAction}
              onChange={e => setFilterAction(e.target.value)}
            />
          </div>
          <div>
            <label style={S.label}>사용자 ID / User ID</label>
            <input
              style={S.input}
              placeholder="ent-user-001"
              value={filterUserId}
              onChange={e => setFilterUserId(e.target.value)}
            />
          </div>
          <div>
            <label style={S.label}>날짜 시작 / Date from</label>
            <input
              type="date"
              style={S.input}
              value={filterDateFrom}
              onChange={e => setFilterDateFrom(e.target.value)}
            />
          </div>
          <div>
            <label style={S.label}>날짜 종료 / Date to</label>
            <input
              type="date"
              style={S.input}
              value={filterDateTo}
              onChange={e => setFilterDateTo(e.target.value)}
            />
          </div>
          <button
            style={{
              padding: '7px 16px', background: '#3B82F6', border: 'none',
              borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}
            onClick={fetchLogs}
          >
            필터 적용 / Apply
          </button>
          <button
            style={{
              padding: '7px 14px', background: 'transparent', border: '1px solid #374151',
              borderRadius: 8, color: '#9ca3af', fontSize: 13, cursor: 'pointer',
            }}
            onClick={() => {
              setFilterAction('');
              setFilterUserId('');
              setFilterDateFrom('');
              setFilterDateTo('');
            }}
          >
            초기화 / Reset
          </button>
        </div>

        {/* Error */}
        {error && (
          <div style={{ background: '#450a0a', border: '1px solid #7f1d1d', borderRadius: 8, padding: '10px 14px', marginBottom: 16, color: '#fca5a5', fontSize: 13 }}>
            {error}
          </div>
        )}

        {/* Table */}
        <div style={{ ...S.card, padding: 0, overflow: 'hidden' }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>
              불러오는 중… / Loading…
            </div>
          ) : entries.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>
              로그가 없습니다 / No audit entries found.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={S.th}>시간 / Time</th>
                    <th style={S.th}>액션 / Action</th>
                    <th style={S.th}>사용자 / User</th>
                    <th style={S.th}>리소스 ID / Resource</th>
                    <th style={S.th}>IP</th>
                    <th style={S.th}>메타데이터 / Metadata</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e, i) => (
                    <tr
                      key={e.id}
                      style={{ background: i % 2 === 0 ? 'transparent' : '#15182000' }}
                    >
                      <td style={{ ...S.td, color: '#9ca3af', fontSize: 12, whiteSpace: 'nowrap' }}>
                        {fmtTime(e.createdAt)}
                      </td>
                      <td style={S.td}>
                        <span
                          style={{
                            display: 'inline-block',
                            background: actionBadgeColor(e.action),
                            color: '#e5e7eb',
                            fontSize: 11,
                            fontWeight: 600,
                            padding: '2px 8px',
                            borderRadius: 4,
                          }}
                        >
                          {e.action}
                        </span>
                      </td>
                      <td style={S.td}>{e.userId}</td>
                      <td style={{ ...S.td, color: '#60A5FA' }}>
                        {e.resourceId ?? <span style={{ color: '#4b5563' }}>—</span>}
                      </td>
                      <td style={{ ...S.td, color: '#9ca3af', fontSize: 12 }}>
                        {e.ip ?? <span style={{ color: '#4b5563' }}>—</span>}
                      </td>
                      <td style={{ ...S.td, color: '#6b7280', fontSize: 11 }}>
                        {e.metadata
                          ? JSON.stringify(e.metadata).slice(0, 80) + (JSON.stringify(e.metadata).length > 80 ? '…' : '')
                          : <span style={{ color: '#374151' }}>—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer count */}
        {!loading && entries.length > 0 && (
          <div style={{ fontSize: 12, color: '#4b5563', textAlign: 'right', marginTop: 8 }}>
            총 {entries.length}개 항목 / {entries.length} entries
          </div>
        )}
      </div>
    </div>
  );
}
