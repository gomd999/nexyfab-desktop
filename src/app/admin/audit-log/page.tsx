'use client';

// /admin/audit-log — standalone audit viewer for nf_admin_audit.
//
// /admin/settings has a sidebar showing the most recent rows; this page
// is the full-history searchable view with filters for incident
// investigation ("who rotated this key", "all breaker trips this week").

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAdminI18n } from '../AdminI18nProvider';
import { createCommercialLocalizer } from '@/lib/i18n/commercialLocalizer';
import { formatDate } from '@/lib/i18n/format';

interface AuditRow {
  id: string;
  adminUserId: string;
  action: string;
  target: string | null;
  oldValueHash: string | null;
  newValueHash: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: number;
}

interface AuditResp { rows: AuditRow[] }

const WINDOW_OPTIONS = [
  { label: '24h',  value: 24 },
  { label: '7d',   value: 24 * 7 },
  { label: '30d',  value: 24 * 30 },
];

export default function AuditLogPage() {
  const { locale } = useAdminI18n();
  const L = createCommercialLocalizer(locale);
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [windowH, setWindowH] = useState<number>(24 * 7);
  const [actionFilter, setActionFilter] = useState('');
  const [targetFilter, setTargetFilter] = useState('');
  const [adminFilter, setAdminFilter] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ windowH: String(windowH), limit: '300' });
      if (actionFilter) qs.set('action', actionFilter);
      if (targetFilter) qs.set('target', targetFilter);
      if (adminFilter)  qs.set('adminUserId', adminFilter);
      const res = await fetch(`/api/admin/admin-actions?${qs}`, { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json() as AuditResp;
      setRows(data.rows);
    } finally {
      setLoading(false);
    }
  }, [windowH, actionFilter, targetFilter, adminFilter]);

  useEffect(() => { void load(); }, [load]);

  // Derive distinct actions for the filter dropdown — UX nicety.
  const distinctActions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) set.add(r.action);
    return Array.from(set).sort();
  }, [rows]);

  return (
    <div style={pageStyle}>
      <h1 style={titleStyle}>📜 Admin Audit Log</h1>
      <p style={subtitleStyle}>
        {L(
          '모든 관리자 변경 작업의 영구 기록입니다. 최근 30일을 검색할 수 있으며 값은 SHA-256 해시로만 기록되어 평문이 노출되지 않습니다.',
          'Permanent record of all admin mutations. Search the last 30 days; values are stored only as SHA-256 hashes, never as plaintext.',
        )}
      </p>

      <div style={filterRowStyle}>
        <div style={tabBarStyle}>
          {WINDOW_OPTIONS.map(w => (
            <button key={w.value} onClick={() => setWindowH(w.value)} style={{
              ...tabBtnStyle,
              background: windowH === w.value ? '#1f6feb' : 'transparent',
              color: windowH === w.value ? '#fff' : '#9ca3af',
            }}>{w.label}</button>
          ))}
        </div>
        <select
          value={actionFilter}
          onChange={e => setActionFilter(e.target.value)}
          style={selectStyle}
        >
          <option value="">{L('전체 작업', 'All actions')}</option>
          {distinctActions.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <input
          value={targetFilter}
          onChange={e => setTargetFilter(e.target.value)}
          placeholder={L('대상 (예: toss.secret_key)', 'Target (e.g. toss.secret_key)')}
          style={inputStyle}
        />
        <input
          value={adminFilter}
          onChange={e => setAdminFilter(e.target.value)}
          placeholder="admin user id"
          style={inputStyle}
        />
        <button onClick={() => void load()} style={refreshBtnStyle}>↻</button>
      </div>

      <div style={summaryStyle}>
        {L(`총 ${rows.length}건 · 최근 ${windowH}시간`, `${rows.length} total · last ${windowH}h`)}
        {loading && <span style={{ color: '#6e7681', marginLeft: 8 }}>{L('· 불러오는 중…', '· Loading…')}</span>}
      </div>

      <div style={panelStyle}>
        {rows.length === 0 && !loading && (
          <div style={emptyStyle}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>📭</div>
            <div>{L('해당 조건에 일치하는 로그가 없습니다.', 'No logs match these filters.')}</div>
          </div>
        )}
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>{L('시각', 'Time')}</th>
              <th style={thStyle}>Action</th>
              <th style={thStyle}>Target</th>
              <th style={thStyle}>Admin</th>
              <th style={thStyle}>Diff</th>
              <th style={thStyle}>IP</th>
              <th style={thStyle}>Metadata</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} style={trStyle}>
                <td style={tdStyle}>{formatDate(r.createdAt, locale, { dateStyle: 'medium', timeStyle: 'short' }) ?? '-'}</td>
                <td style={tdStyle}>
                  <code style={{ background: '#0d1117', padding: '1px 6px', borderRadius: 3, color: '#79c0ff' }}>
                    {r.action}
                  </code>
                </td>
                <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 11 }}>{r.target ?? '-'}</td>
                <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 11 }}>{r.adminUserId.slice(0, 14)}</td>
                <td style={{ ...tdStyle, fontSize: 10, color: '#6e7681', fontFamily: 'monospace' }}>
                  {r.oldValueHash || r.newValueHash
                    ? `${r.oldValueHash?.slice(0, 6) ?? '∅'} → ${r.newValueHash?.slice(0, 6) ?? '∅'}`
                    : '-'}
                </td>
                <td style={{ ...tdStyle, fontSize: 10 }}>{r.ipAddress ?? '-'}</td>
                <td style={{ ...tdStyle, fontSize: 10, fontFamily: 'monospace', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.metadata ? JSON.stringify(r.metadata) : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  padding: 24, color: '#e6edf3',
  fontFamily: 'system-ui, sans-serif', background: '#0d1117', minHeight: '100vh',
};
const titleStyle: React.CSSProperties = { fontSize: 24, fontWeight: 800, marginBottom: 4 };
const subtitleStyle: React.CSSProperties = { fontSize: 13, color: '#8b949e', margin: '0 0 20px' };
const filterRowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap',
};
const tabBarStyle: React.CSSProperties = {
  display: 'flex', gap: 4, background: '#161b22',
  padding: 4, borderRadius: 8, border: '1px solid #30363d',
};
const tabBtnStyle: React.CSSProperties = {
  padding: '6px 12px', fontSize: 12, fontWeight: 600,
  borderRadius: 4, border: 'none', cursor: 'pointer', transition: 'all 0.12s',
};
const selectStyle: React.CSSProperties = {
  padding: '6px 10px', fontSize: 12, background: '#161b22',
  border: '1px solid #30363d', borderRadius: 6, color: '#e6edf3', outline: 'none',
};
const inputStyle: React.CSSProperties = {
  padding: '6px 10px', fontSize: 12, background: '#0d1117',
  border: '1px solid #30363d', borderRadius: 6,
  color: '#e6edf3', outline: 'none', minWidth: 160, fontFamily: 'monospace',
};
const refreshBtnStyle: React.CSSProperties = {
  padding: '6px 12px', fontSize: 12, background: 'transparent',
  border: '1px solid #30363d', borderRadius: 6, color: '#9ca3af', cursor: 'pointer',
};
const summaryStyle: React.CSSProperties = {
  fontSize: 12, color: '#8b949e', marginBottom: 12,
};
const panelStyle: React.CSSProperties = {
  background: '#161b22', border: '1px solid #30363d', borderRadius: 10, padding: 14,
};
const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 12 };
const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #30363d',
  color: '#8b949e', fontWeight: 600, fontSize: 11,
};
const trStyle: React.CSSProperties = { borderBottom: '1px solid #21262d' };
const tdStyle: React.CSSProperties = { padding: '6px 10px', color: '#c9d1d9', fontSize: 11 };
const emptyStyle: React.CSSProperties = {
  padding: 48, textAlign: 'center', background: '#0d1117', borderRadius: 10, color: '#8b949e', fontSize: 14,
};
