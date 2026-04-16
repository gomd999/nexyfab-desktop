'use client';

import { use, useCallback, useEffect, useState } from 'react';

interface RfqRow {
  id: string;
  shape_name: string | null;
  material_id: string | null;
  quantity: number;
  volume_cm3: number | null;
  dfm_score: number | null;
  status: string;
  assigned_factory_name: string | null;
  created_at: number;
}

interface MatchResult {
  factoryName: string;
  score: number;
}

interface RfqMatchState {
  loading: boolean;
  result: MatchResult | null;
  error: string;
}

const T = {
  ko: {
    title: 'RFQ 자동 매칭',
    id: 'RFQ ID',
    shape: '형상',
    material: '재료',
    qty: '수량',
    volume: '부피 (cm³)',
    score: 'DFM 점수',
    status: '상태',
    created: '생성일',
    autoMatch: '자동 매칭',
    matching: '매칭 중...',
    matchAll: '전체 자동 매칭',
    matchingAll: '매칭 중...',
    refresh: '새로고침',
    loading: '로딩 중...',
    empty: '대기 중인 RFQ가 없습니다.',
    loadFail: 'RFQ 목록을 불러오지 못했습니다.',
    matchFactory: (name: string, score: number) => `${name} (${score}점)`,
    matchFail: '매칭 실패',
    progress: (done: number, total: number) => `${done} / ${total} 처리됨`,
    allDone: (n: number) => `전체 ${n}건 매칭 완료`,
    pending: '대기',
    assigned: '배정됨',
    expired: '만료',
    noFactory: '공장 없음',
  },
  en: {
    title: 'RFQ Auto-Matching',
    id: 'RFQ ID',
    shape: 'Shape',
    material: 'Material',
    qty: 'Qty',
    volume: 'Volume (cm³)',
    score: 'DFM Score',
    status: 'Status',
    created: 'Created',
    autoMatch: 'Auto Match',
    matching: 'Matching...',
    matchAll: 'Auto Match All',
    matchingAll: 'Matching...',
    refresh: 'Refresh',
    loading: 'Loading...',
    empty: 'No pending RFQs.',
    loadFail: 'Failed to load RFQs.',
    matchFactory: (name: string, score: number) => `${name} (score: ${score})`,
    matchFail: 'Match failed',
    progress: (done: number, total: number) => `${done} / ${total} done`,
    allDone: (n: number) => `All ${n} matched`,
    pending: 'Pending',
    assigned: 'Assigned',
    expired: 'Expired',
    noFactory: 'No factory',
  },
};

function StatusBadge({ status, t }: { status: string; t: typeof T.ko }) {
  const cfg: Record<string, { bg: string; fg: string; border: string; label: string }> = {
    pending:  { bg: '#1c2d3e', fg: '#58a6ff', border: '#1f6feb55', label: t.pending },
    assigned: { bg: '#1f4e2b', fg: '#3fb950', border: '#2ea04333', label: t.assigned },
    expired:  { bg: '#21262d', fg: '#6e7681', border: '#484f5833', label: t.expired },
  };
  const style = cfg[status] ?? cfg.pending;
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 10px',
      borderRadius: 99,
      fontSize: 12,
      fontWeight: 600,
      background: style.bg,
      color: style.fg,
      border: `1px solid ${style.border}`,
    }}>
      {style.label}
    </span>
  );
}

function ScoreBar({ score }: { score: number }) {
  const pct = Math.min(100, Math.max(0, score));
  const color = pct >= 70 ? '#3fb950' : pct >= 40 ? '#d29922' : '#f85149';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 100 }}>
      <div style={{ flex: 1, background: '#21262d', borderRadius: 4, height: 8, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, background: color, height: '100%', borderRadius: 4, transition: 'width 0.4s ease' }} />
      </div>
      <span style={{ fontSize: 12, color, fontWeight: 600, minWidth: 28, textAlign: 'right' }}>{pct}</span>
    </div>
  );
}

export default function AdminRfqMatchingPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = use(params);
  const t = lang === 'ko' ? T.ko : T.en;

  const [rfqs, setRfqs] = useState<RfqRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState('');

  // Per-row match state
  const [matchState, setMatchState] = useState<Record<string, RfqMatchState>>({});

  // Bulk match progress
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [bulkMsg, setBulkMsg] = useState('');

  const fetchRfqs = useCallback(async () => {
    setLoading(true);
    setLoadErr('');
    try {
      const res = await fetch('/api/admin/rfq?status=pending&limit=30', { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { rfqs: RfqRow[] };
      setRfqs(data.rfqs ?? []);
      // Reset match state for removed RFQs
      setMatchState((prev) => {
        const ids = new Set((data.rfqs ?? []).map((r: RfqRow) => r.id));
        const next: Record<string, RfqMatchState> = {};
        for (const id of Object.keys(prev)) {
          if (ids.has(id)) next[id] = prev[id];
        }
        return next;
      });
    } catch {
      setLoadErr(t.loadFail);
    } finally {
      setLoading(false);
    }
  }, [t.loadFail]);

  useEffect(() => {
    void fetchRfqs();
  }, [fetchRfqs]);

  const runAutoMatch = async (rfqId: string): Promise<boolean> => {
    setMatchState((prev) => ({
      ...prev,
      [rfqId]: { loading: true, result: null, error: '' },
    }));
    try {
      const res = await fetch('/api/admin/rfq/auto-match', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rfqId }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json() as { factoryName: string; score: number };
      setMatchState((prev) => ({
        ...prev,
        [rfqId]: { loading: false, result: { factoryName: data.factoryName, score: data.score }, error: '' },
      }));
      // Update the RFQ status in the list
      setRfqs((prev) => prev.map((r) => r.id === rfqId ? { ...r, status: 'assigned', assigned_factory_name: data.factoryName } : r));
      return true;
    } catch {
      setMatchState((prev) => ({
        ...prev,
        [rfqId]: { loading: false, result: null, error: t.matchFail },
      }));
      return false;
    }
  };

  const handleMatchAll = async () => {
    const pending = rfqs.filter((r) => r.status === 'pending');
    if (pending.length === 0) return;
    setBulkRunning(true);
    setBulkProgress({ done: 0, total: pending.length });
    setBulkMsg('');
    let done = 0;
    for (const rfq of pending) {
      await runAutoMatch(rfq.id);
      done++;
      setBulkProgress({ done, total: pending.length });
    }
    setBulkMsg(t.allDone(pending.length));
    setBulkRunning(false);
    setBulkProgress(null);
  };

  const fmtDate = (ms: number) =>
    new Date(ms).toLocaleDateString(lang === 'ko' ? 'ko-KR' : 'en-US', {
      year: 'numeric', month: '2-digit', day: '2-digit',
    });

  const pendingCount = rfqs.filter((r) => r.status === 'pending').length;

  return (
    <div style={{ minHeight: '100vh', background: '#0d1117', color: '#c9d1d9', padding: '32px 24px', fontFamily: 'system-ui, sans-serif' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#f0f6fc' }}>{t.title}</h1>
          {!loading && (
            <span style={{ fontSize: 13, color: '#8b949e', marginTop: 4, display: 'block' }}>
              {lang === 'ko' ? `대기 중: ${pendingCount}건` : `Pending: ${pendingCount}`}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button
            onClick={handleMatchAll}
            disabled={bulkRunning || pendingCount === 0 || loading}
            style={{
              background: bulkRunning ? '#1a3a5c' : '#1f6feb',
              border: 'none',
              color: '#fff',
              padding: '8px 16px',
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 600,
              cursor: (bulkRunning || pendingCount === 0) ? 'not-allowed' : 'pointer',
              opacity: (bulkRunning || pendingCount === 0) ? 0.6 : 1,
            }}
          >
            {bulkRunning
              ? (bulkProgress ? t.progress(bulkProgress.done, bulkProgress.total) : t.matchingAll)
              : t.matchAll}
          </button>
          <button
            onClick={fetchRfqs}
            disabled={loading}
            style={{ background: '#21262d', border: '1px solid #30363d', color: '#c9d1d9', padding: '8px 14px', borderRadius: 6, fontSize: 13, cursor: loading ? 'not-allowed' : 'pointer' }}
          >
            {loading ? '...' : t.refresh}
          </button>
        </div>
      </div>

      {/* Bulk message */}
      {bulkMsg && (
        <div style={{ background: '#1f4e2b', border: '1px solid #2ea04333', color: '#3fb950', borderRadius: 6, padding: '10px 14px', marginBottom: 16, fontSize: 13 }}>
          {bulkMsg}
        </div>
      )}
      {loadErr && (
        <div style={{ background: '#4e1f1f', border: '1px solid #f8514933', color: '#f85149', borderRadius: 6, padding: '10px 14px', marginBottom: 16, fontSize: 13 }}>
          {loadErr}
        </div>
      )}

      {/* Table */}
      <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 48, textAlign: 'center', color: '#8b949e' }}>{t.loading}</div>
        ) : rfqs.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: '#8b949e' }}>{t.empty}</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#0d1117', borderBottom: '1px solid #30363d' }}>
                  {[t.id, t.shape, t.material, t.qty, t.volume, t.score, t.status, t.created, t.autoMatch].map((col) => (
                    <th key={col} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: '#8b949e', whiteSpace: 'nowrap' }}>
                      {col}
                    </th>
                  ))}
                  <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: '#8b949e', whiteSpace: 'nowrap' }}>
                    {lang === 'ko' ? '매칭 결과' : 'Match Result'}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rfqs.map((rfq, i) => {
                  const ms = matchState[rfq.id];
                  return (
                    <tr
                      key={rfq.id}
                      style={{ borderBottom: i < rfqs.length - 1 ? '1px solid #21262d' : 'none', background: i % 2 === 0 ? 'transparent' : '#0d111766' }}
                    >
                      {/* ID */}
                      <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontSize: 11, color: '#8b949e', whiteSpace: 'nowrap' }}>
                        {rfq.id.slice(0, 8).toUpperCase()}
                      </td>
                      {/* Shape */}
                      <td style={{ padding: '10px 14px', color: '#c9d1d9' }}>
                        {rfq.shape_name ?? '—'}
                      </td>
                      {/* Material */}
                      <td style={{ padding: '10px 14px', color: '#c9d1d9' }}>
                        {rfq.material_id ?? '—'}
                      </td>
                      {/* Qty */}
                      <td style={{ padding: '10px 14px', color: '#c9d1d9', textAlign: 'right' }}>
                        {rfq.quantity.toLocaleString()}
                      </td>
                      {/* Volume */}
                      <td style={{ padding: '10px 14px', color: '#c9d1d9', textAlign: 'right' }}>
                        {rfq.volume_cm3 !== null ? rfq.volume_cm3.toFixed(2) : '—'}
                      </td>
                      {/* DFM Score */}
                      <td style={{ padding: '10px 14px' }}>
                        {rfq.dfm_score !== null ? (
                          <ScoreBar score={rfq.dfm_score} />
                        ) : (
                          <span style={{ color: '#484f58' }}>—</span>
                        )}
                      </td>
                      {/* Status */}
                      <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                        <StatusBadge status={rfq.status} t={t} />
                      </td>
                      {/* Created */}
                      <td style={{ padding: '10px 14px', color: '#8b949e', whiteSpace: 'nowrap', fontFamily: 'monospace', fontSize: 11 }}>
                        {fmtDate(rfq.created_at)}
                      </td>
                      {/* Auto Match button */}
                      <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                        <button
                          onClick={() => runAutoMatch(rfq.id)}
                          disabled={ms?.loading || rfq.status === 'assigned'}
                          style={{
                            background: rfq.status === 'assigned' ? '#1f4e2b' : '#21262d',
                            border: `1px solid ${rfq.status === 'assigned' ? '#2ea04333' : '#30363d'}`,
                            color: rfq.status === 'assigned' ? '#3fb950' : '#c9d1d9',
                            padding: '5px 12px',
                            borderRadius: 5,
                            fontSize: 12,
                            cursor: (ms?.loading || rfq.status === 'assigned') ? 'not-allowed' : 'pointer',
                            opacity: ms?.loading ? 0.6 : 1,
                          }}
                        >
                          {ms?.loading ? t.matching : rfq.status === 'assigned' ? (lang === 'ko' ? '완료' : 'Done') : t.autoMatch}
                        </button>
                      </td>
                      {/* Match result */}
                      <td style={{ padding: '10px 14px', minWidth: 180 }}>
                        {ms?.error ? (
                          <span style={{ color: '#f85149', fontSize: 12 }}>{ms.error}</span>
                        ) : ms?.result ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <span style={{ color: '#f0f6fc', fontSize: 12, fontWeight: 600 }}>{ms.result.factoryName}</span>
                            <ScoreBar score={ms.result.score} />
                          </div>
                        ) : rfq.assigned_factory_name && rfq.status === 'assigned' ? (
                          <span style={{ color: '#3fb950', fontSize: 12 }}>{rfq.assigned_factory_name}</span>
                        ) : (
                          <span style={{ color: '#484f58', fontSize: 12 }}>—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
