'use client';

// Anti-poach signal review queue.
//
// Lists signals from /api/admin/anti-poach for ops triage. Each row
// shows the kind, severity, evidence snapshot, and a verdict dropdown.
// Submitting a verdict locks the row (reviewed_at gets set) — the cron
// dedupes 30d so a triaged signal won't re-fire unless the underlying
// pattern repeats with new entities.
//
// Design: dense table, no drill-in. The evidence object is small enough
// to render inline, and forcing ops into a detail page slows triage.

import React, { useCallback, useEffect, useState } from 'react';

interface Signal {
  id: string;
  kind: 'orphan_order' | 'repeat_pair' | 'quick_cancel' | string;
  buyerId: string | null;
  partnerEmail: string | null;
  refId: string | null;
  severity: 'low' | 'medium' | 'high' | string;
  details: Record<string, unknown> | null;
  detectedAt: number;
  reviewedAt: number | null;
  reviewedBy: string | null;
  verdict: string | null;
}

interface Counts { open: number; reviewed: number }

const KIND_LABELS: Record<string, { ko: string; emoji: string; color: string }> = {
  orphan_order: { ko: '에스크로 누락 주문',  emoji: '💸', color: '#dc2626' },
  repeat_pair:  { ko: '반복 노출 미체결',    emoji: '🔁', color: '#d97706' },
  quick_cancel: { ko: '견적 후 즉시 취소',   emoji: '⚡', color: '#d97706' },
};

const VERDICT_LABELS: Record<string, string> = {
  false_positive:         '✓ 정상 (오탐)',
  warning_sent:           '⚠️ 경고 발송',
  enforcement_initiated:  '🚨 위반 처리 개시',
};

const STATUS_TABS = ['open', 'reviewed', 'all'] as const;
type StatusTab = typeof STATUS_TABS[number];

export default function AntiPoachAdminPage() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [counts, setCounts] = useState<Counts>({ open: 0, reviewed: 0 });
  const [tab, setTab] = useState<StatusTab>('open');
  const [kindFilter, setKindFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [pendingVerdict, setPendingVerdict] = useState<Record<string, { verdict: string; notes: string }>>({});
  const [submitting, setSubmitting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ status: tab });
      if (kindFilter !== 'all') params.set('kind', kindFilter);
      const res = await fetch(`/api/admin/anti-poach?${params}`, { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json() as { signals: Signal[]; counts: Counts };
      setSignals(data.signals);
      setCounts(data.counts);
    } finally {
      setLoading(false);
    }
  }, [tab, kindFilter]);

  useEffect(() => { void load(); }, [load]);

  const submitVerdict = async (signalId: string) => {
    const p = pendingVerdict[signalId];
    if (!p?.verdict) return;
    setSubmitting(signalId);
    try {
      const res = await fetch('/api/admin/anti-poach', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signalId, verdict: p.verdict, notes: p.notes || undefined }),
      });
      if (res.ok) {
        setPendingVerdict(prev => { const next = { ...prev }; delete next[signalId]; return next; });
        await load();
      }
    } finally {
      setSubmitting(null);
    }
  };

  const updatePending = (signalId: string, key: 'verdict' | 'notes', value: string) => {
    setPendingVerdict(prev => ({
      ...prev,
      [signalId]: { ...(prev[signalId] ?? { verdict: '', notes: '' }), [key]: value },
    }));
  };

  return (
    <div style={pageStyle}>
      <h1 style={titleStyle}>🛡️ Anti-Poach 시그널 검토</h1>
      <p style={subtitleStyle}>
        파트너 약관 §6 (24개월 거래 우회 금지) 위반 의심 신호를 운영자가 검토합니다.
        매주 월요일 cron이 새 시그널을 추가합니다.
      </p>

      <div style={statsRowStyle}>
        <div style={statCardStyle}>
          <div style={statLabelStyle}>미검토</div>
          <div style={{ ...statValueStyle, color: counts.open > 0 ? '#dc2626' : '#059669' }}>{counts.open}</div>
        </div>
        <div style={statCardStyle}>
          <div style={statLabelStyle}>검토 완료</div>
          <div style={{ ...statValueStyle, color: '#6b7280' }}>{counts.reviewed}</div>
        </div>
      </div>

      <div style={filterRowStyle}>
        <div style={tabBarStyle}>
          {STATUS_TABS.map(s => (
            <button key={s} onClick={() => setTab(s)} style={{
              ...tabBtnStyle,
              background: tab === s ? '#1f6feb' : 'transparent',
              color: tab === s ? '#fff' : '#9ca3af',
            }}>{s === 'open' ? '미검토' : s === 'reviewed' ? '검토 완료' : '전체'}</button>
          ))}
        </div>
        <select value={kindFilter} onChange={e => setKindFilter(e.target.value)} style={selectStyle}>
          <option value="all">전체 종류</option>
          {Object.entries(KIND_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v.emoji} {v.ko}</option>
          ))}
        </select>
        <button onClick={() => void load()} style={refreshBtnStyle}>↻ 새로고침</button>
      </div>

      {loading && <div style={mutedStyle}>불러오는 중…</div>}
      {!loading && signals.length === 0 && (
        <div style={emptyStyle}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>🎉</div>
          <div>{tab === 'open' ? '미검토 시그널이 없습니다.' : '시그널이 없습니다.'}</div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {signals.map(s => {
          const kind = KIND_LABELS[s.kind] ?? { ko: s.kind, emoji: '❓', color: '#6b7280' };
          const isReviewed = s.reviewedAt !== null;
          const p = pendingVerdict[s.id] ?? { verdict: '', notes: '' };
          return (
            <div key={s.id} style={{
              ...rowStyle,
              borderLeft: `4px solid ${kind.color}`,
              opacity: isReviewed ? 0.7 : 1,
            }}>
              <div style={rowHeaderStyle}>
                <span style={{ fontSize: 14, fontWeight: 700 }}>
                  {kind.emoji} {kind.ko}
                </span>
                <span style={{
                  ...severityChipStyle,
                  background: s.severity === 'high' ? '#7f1d1d' : s.severity === 'medium' ? '#78350f' : '#374151',
                  color: '#fff',
                }}>
                  {s.severity}
                </span>
                <span style={{ flex: 1 }} />
                <span style={timeStyle}>{new Date(s.detectedAt).toLocaleString('ko-KR')}</span>
              </div>

              <div style={evidenceBlockStyle}>
                {s.buyerId && <div><b>Buyer:</b> {s.buyerId.slice(0, 16)}</div>}
                {s.partnerEmail && <div><b>Partner:</b> {s.partnerEmail}</div>}
                {s.refId && <div><b>Ref:</b> {s.refId}</div>}
                {s.details && (
                  <pre style={detailsPreStyle}>{JSON.stringify(s.details, null, 2)}</pre>
                )}
              </div>

              {isReviewed ? (
                <div style={verdictDisplayStyle}>
                  <strong>{VERDICT_LABELS[s.verdict ?? ''] ?? s.verdict}</strong>
                  <span style={{ color: '#6b7280', marginLeft: 8 }}>
                    by {s.reviewedBy?.slice(0, 12)} · {new Date(s.reviewedAt!).toLocaleString('ko-KR')}
                  </span>
                </div>
              ) : (
                <div style={verdictFormStyle}>
                  <select
                    value={p.verdict}
                    onChange={e => updatePending(s.id, 'verdict', e.target.value)}
                    style={selectStyle}
                  >
                    <option value="">— 판정 선택 —</option>
                    {Object.entries(VERDICT_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                  <input
                    value={p.notes}
                    onChange={e => updatePending(s.id, 'notes', e.target.value)}
                    placeholder="검토 메모 (선택)"
                    style={notesInputStyle}
                  />
                  <button
                    onClick={() => void submitVerdict(s.id)}
                    disabled={!p.verdict || submitting === s.id}
                    style={{
                      ...submitBtnStyle,
                      opacity: (!p.verdict || submitting === s.id) ? 0.5 : 1,
                      cursor: (!p.verdict || submitting === s.id) ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {submitting === s.id ? '저장 중…' : '판정 저장'}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  padding: 24, color: '#e6edf3',
  fontFamily: 'system-ui, sans-serif', background: '#0d1117', minHeight: '100vh',
};
const titleStyle: React.CSSProperties = { fontSize: 24, fontWeight: 800, marginBottom: 4 };
const subtitleStyle: React.CSSProperties = { fontSize: 13, color: '#8b949e', margin: 0, lineHeight: 1.6 };
const statsRowStyle: React.CSSProperties = { display: 'flex', gap: 12, margin: '20px 0' };
const statCardStyle: React.CSSProperties = {
  flex: 1, padding: 16, background: '#161b22', border: '1px solid #30363d', borderRadius: 10,
};
const statLabelStyle: React.CSSProperties = { fontSize: 11, color: '#8b949e', marginBottom: 4 };
const statValueStyle: React.CSSProperties = { fontSize: 28, fontWeight: 800 };
const filterRowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap',
};
const tabBarStyle: React.CSSProperties = {
  display: 'flex', gap: 4, background: '#161b22', padding: 4, borderRadius: 8, border: '1px solid #30363d',
};
const tabBtnStyle: React.CSSProperties = {
  padding: '6px 14px', fontSize: 12, fontWeight: 600, borderRadius: 4,
  border: 'none', cursor: 'pointer', transition: 'all 0.12s',
};
const selectStyle: React.CSSProperties = {
  padding: '6px 10px', fontSize: 12, background: '#161b22',
  border: '1px solid #30363d', borderRadius: 6, color: '#e6edf3', outline: 'none',
};
const refreshBtnStyle: React.CSSProperties = {
  padding: '6px 12px', fontSize: 12, background: 'transparent',
  border: '1px solid #30363d', borderRadius: 6, color: '#9ca3af', cursor: 'pointer',
};
const mutedStyle: React.CSSProperties = { color: '#8b949e', fontSize: 13, padding: 24, textAlign: 'center' };
const emptyStyle: React.CSSProperties = {
  padding: 48, textAlign: 'center', background: '#161b22',
  borderRadius: 10, color: '#8b949e', fontSize: 14,
};
const rowStyle: React.CSSProperties = {
  background: '#161b22', borderRadius: 10, padding: 14,
  borderLeftWidth: 4, borderLeftStyle: 'solid',
};
const rowHeaderStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10,
};
const severityChipStyle: React.CSSProperties = {
  padding: '2px 8px', fontSize: 10, fontWeight: 700, borderRadius: 4, letterSpacing: 0.5,
};
const timeStyle: React.CSSProperties = { fontSize: 11, color: '#6e7681' };
const evidenceBlockStyle: React.CSSProperties = {
  fontSize: 12, color: '#c9d1d9', marginBottom: 10, lineHeight: 1.7,
  padding: 10, background: '#0d1117', borderRadius: 6,
};
const detailsPreStyle: React.CSSProperties = {
  marginTop: 6, padding: 8, background: '#010409', borderRadius: 4,
  fontSize: 11, color: '#79c0ff', overflowX: 'auto', whiteSpace: 'pre-wrap',
};
const verdictDisplayStyle: React.CSSProperties = {
  padding: 10, background: '#0d1117', borderRadius: 6, fontSize: 12, color: '#c9d1d9',
};
const verdictFormStyle: React.CSSProperties = {
  display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
};
const notesInputStyle: React.CSSProperties = {
  flex: 1, minWidth: 200, padding: '6px 10px', fontSize: 12,
  background: '#0d1117', border: '1px solid #30363d', borderRadius: 6, color: '#e6edf3', outline: 'none',
};
const submitBtnStyle: React.CSSProperties = {
  padding: '6px 14px', fontSize: 12, fontWeight: 700,
  background: '#1f6feb', color: '#fff', border: 'none', borderRadius: 6,
};
