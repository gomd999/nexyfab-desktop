'use client';

// Q2 — Operator-facing Concierge admin.
//
// One row per RFQ in 'pending' or 'quoted' status that's a candidate for
// hands-on outreach. Click a row → drawer with the recommended factories,
// their current contact status, and a status dropdown. Adding a factory
// to the recommendation list searches the directory.
//
// This is the single screen ops uses to push deals: see what needs
// attention, click to update, send a follow-up message via the template
// library (Q5).

import React, { useCallback, useEffect, useState } from 'react';

interface RfqSummary {
  rfqId: string;
  shapeName: string | null;
  status: string;
  createdAt: number;
  conciergeCount: number;
  lastConciergeAt: number | null;
}

interface ConciergeEntry {
  id: string;
  factoryId: string;
  displayName: string;
  region: string | null;
  status: string;
  note: string | null;
  publicNote: boolean;
  lastActionAt: number;
  lastActionBy: string | null;
  partnerEmail: string | null;
}

interface FactorySearchResult {
  id: string;
  name: string;
  region: string | null;
  industry: string | null;
}

const STATUS_LABELS: Record<string, string> = {
  recommended:    '📋 추천됨',
  contacted:      '📞 컨택 시도',
  responded:      '💬 응답 받음',
  quote_drafting: '📨 견적 작성 중',
  quote_received: '✅ 견적 도착',
  partner_signup: '🔓 가입 완료',
  declined:       '✋ 거절',
};

export default function ConciergeAdminPage() {
  const [rfqs, setRfqs] = useState<RfqSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [entries, setEntries] = useState<ConciergeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<FactorySearchResult[]>([]);

  // Load RFQ list (pending / quoted only — those are concierge candidates).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/nexyfab/admin/rfq-list?statuses=pending,quoted', {
          credentials: 'include',
        });
        if (!res.ok) {
          // Fallback: hit the regular RFQ admin endpoint
          const r2 = await fetch('/api/admin/rfq?status=pending', { credentials: 'include' });
          if (r2.ok) {
            const data = await r2.json() as { rfqs?: Array<{ id: string; shape_name: string | null; status: string; created_at: number }> };
            if (!cancelled && data.rfqs) {
              setRfqs(data.rfqs.map(r => ({
                rfqId: r.id, shapeName: r.shape_name, status: r.status, createdAt: r.created_at,
                conciergeCount: 0, lastConciergeAt: null,
              })));
            }
          }
        } else {
          const data = await res.json() as { rfqs: RfqSummary[] };
          if (!cancelled) setRfqs(data.rfqs);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const loadEntries = useCallback(async (rfqId: string) => {
    setSelected(rfqId);
    const res = await fetch(`/api/nexyfab/concierge/${encodeURIComponent(rfqId)}`, {
      credentials: 'include',
    });
    if (res.ok) {
      const data = await res.json() as { entries: ConciergeEntry[] };
      setEntries(data.entries);
    }
  }, []);

  const updateStatus = useCallback(async (factoryId: string, status: string, note?: string) => {
    if (!selected) return;
    const res = await fetch(`/api/nexyfab/concierge/${encodeURIComponent(selected)}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ factoryId, status, note, publicNote: true }),
    });
    if (res.ok) await loadEntries(selected);
  }, [selected, loadEntries]);

  const searchFactories = useCallback(async (q: string) => {
    setSearch(q);
    if (q.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    try {
      const res = await fetch(`/api/factories?search=${encodeURIComponent(q)}&limit=10`);
      if (res.ok) {
        const data = await res.json() as { factories?: FactorySearchResult[] };
        setSearchResults(data.factories ?? []);
      }
    } catch { /* silent */ }
  }, []);

  return (
    <div style={pageStyle}>
      <h1 style={titleStyle}>📞 Concierge Admin</h1>
      <p style={subtitleStyle}>
        진행 중 RFQ에 추천 공장을 추가하고, 컨택 상황을 갱신합니다. 고객은 공장명 블러 + 상태만 봅니다.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 16, marginTop: 20 }}>
        {/* Left — RFQ list */}
        <div style={panelStyle}>
          <h3 style={panelTitleStyle}>RFQ ({rfqs.length})</h3>
          {loading && <div style={mutedStyle}>…</div>}
          {!loading && rfqs.length === 0 && <div style={mutedStyle}>대기 중인 RFQ 없음</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {rfqs.map(r => (
              <button
                key={r.rfqId}
                onClick={() => loadEntries(r.rfqId)}
                style={{
                  ...rfqRowStyle,
                  background: selected === r.rfqId ? '#1f6feb33' : 'transparent',
                  borderColor: selected === r.rfqId ? '#1f6feb' : '#30363d',
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 700, color: '#e6edf3' }}>
                  {r.shapeName ?? r.rfqId.slice(0, 8)}
                </div>
                <div style={{ fontSize: 10, color: '#8b949e', marginTop: 2 }}>
                  {r.rfqId.slice(0, 12)} · {r.status} · {new Date(r.createdAt).toLocaleDateString()}
                </div>
                {r.conciergeCount > 0 && (
                  <div style={{ fontSize: 10, color: '#79c0ff', marginTop: 2 }}>
                    Concierge {r.conciergeCount}건
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Right — Concierge editor */}
        <div style={panelStyle}>
          {!selected ? (
            <div style={mutedStyle}>← 좌측에서 RFQ를 선택하세요</div>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h3 style={panelTitleStyle}>RFQ {selected.slice(0, 12)} — 추천 공장</h3>
                <a href={`/api/nexyfab/concierge/${selected}`} target="_blank" rel="noreferrer" style={miniLinkStyle}>raw JSON</a>
              </div>

              {/* Add factory */}
              <div style={addBoxStyle}>
                <input
                  value={search}
                  onChange={e => void searchFactories(e.target.value)}
                  placeholder="공장명 검색 (2자 이상)"
                  style={inputStyle}
                />
                {searchResults.length > 0 && (
                  <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 6, padding: 6, marginTop: 4, maxHeight: 200, overflowY: 'auto' }}>
                    {searchResults.map(f => (
                      <button
                        key={f.id}
                        onClick={() => { void updateStatus(f.id, 'recommended'); setSearch(''); setSearchResults([]); }}
                        style={searchResultStyle}
                      >
                        <div style={{ fontWeight: 600, color: '#e6edf3' }}>{f.name}</div>
                        <div style={{ fontSize: 10, color: '#8b949e' }}>{f.region ?? '-'} · {f.industry ?? '-'}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Entries */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
                {entries.length === 0 && <div style={mutedStyle}>아직 추천된 공장이 없습니다</div>}
                {entries.map(e => (
                  <div key={e.id} style={entryRowStyle}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#e6edf3' }}>{e.displayName}</div>
                      <div style={{ fontSize: 10, color: '#8b949e' }}>
                        {e.region ?? '-'} · {e.lastActionAt ? new Date(e.lastActionAt).toLocaleString() : '-'}
                      </div>
                      {e.note && <div style={{ fontSize: 11, color: '#c9d1d9', marginTop: 2 }}>📝 {e.note}</div>}
                    </div>
                    <select
                      value={e.status}
                      onChange={evt => void updateStatus(e.factoryId, evt.target.value)}
                      style={selectStyle}
                    >
                      {Object.entries(STATUS_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  padding: 24, color: '#e6edf3',
  fontFamily: 'system-ui, sans-serif', background: '#0d1117', minHeight: '100vh',
};
const titleStyle: React.CSSProperties = { fontSize: 24, fontWeight: 800, marginBottom: 4 };
const subtitleStyle: React.CSSProperties = { fontSize: 13, color: '#8b949e', margin: 0 };
const panelStyle: React.CSSProperties = {
  background: '#161b22', border: '1px solid #30363d', borderRadius: 10, padding: 14,
};
const panelTitleStyle: React.CSSProperties = { fontSize: 14, fontWeight: 700, margin: '0 0 10px', color: '#e6edf3' };
const mutedStyle: React.CSSProperties = { fontSize: 12, color: '#8b949e', padding: 12, textAlign: 'center' };
const rfqRowStyle: React.CSSProperties = {
  textAlign: 'left', padding: 10, borderRadius: 6,
  border: '1px solid #30363d', cursor: 'pointer',
  background: 'transparent', color: '#c9d1d9', transition: 'all 0.12s',
};
const addBoxStyle: React.CSSProperties = {
  padding: 10, background: '#0d1117', border: '1px solid #30363d', borderRadius: 8, marginBottom: 8,
};
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '6px 8px', fontSize: 12,
  background: '#161b22', border: '1px solid #30363d',
  borderRadius: 4, color: '#e6edf3', outline: 'none',
};
const searchResultStyle: React.CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left',
  padding: '6px 8px', fontSize: 11, border: 'none',
  background: 'transparent', color: '#c9d1d9', cursor: 'pointer',
};
const entryRowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'flex-start', gap: 10,
  padding: 10, background: '#0d1117', borderRadius: 8, border: '1px solid #21262d',
};
const selectStyle: React.CSSProperties = {
  padding: '6px 8px', fontSize: 11,
  background: '#161b22', border: '1px solid #30363d',
  borderRadius: 4, color: '#e6edf3', outline: 'none',
  flexShrink: 0,
};
const miniLinkStyle: React.CSSProperties = {
  fontSize: 10, color: '#79c0ff', textDecoration: 'underline',
};
