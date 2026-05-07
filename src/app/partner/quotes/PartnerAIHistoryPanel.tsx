'use client';

/**
 * PartnerAIHistoryPanel — 파트너 사이드 AI 이력 뷰어.
 * rfq_responder / order_priority / capacity_match / quote_accuracy 이력을 표시.
 * /api/partner/ai-history 엔드포인트(getPartnerAuth)를 사용.
 */

import { useCallback, useEffect, useState } from 'react';
import type { AIHistoryFeature } from '@/lib/ai-history';

type PartnerFeature = 'rfq_responder' | 'order_priority' | 'capacity_match' | 'quote_accuracy';

interface HistoryRecord {
  id: string;
  feature: AIHistoryFeature;
  projectId: string | null;
  title: string;
  payload: unknown;
  context: unknown;
  createdAt: number;
}

interface Props {
  session: string;
  onClose: () => void;
}

const C = {
  bg: '#0d1117', surface: '#161b22', card: '#21262d', border: '#30363d',
  text: '#e6edf3', textDim: '#8b949e', textMuted: '#6e7681',
  accent: '#388bfd', green: '#3fb950', yellow: '#d29922', red: '#f85149',
  purple: '#8b5cf6', teal: '#2dd4bf',
};

const FEATURE_META: Record<PartnerFeature | 'all', { icon: string; label: string; color: string }> = {
  all:            { icon: '📜', label: '전체',       color: C.textMuted },
  rfq_responder:  { icon: '📥', label: 'RFQ 회신',   color: C.green },
  order_priority: { icon: '🏆', label: 'AI 우선순위', color: C.accent },
  capacity_match: { icon: '🔗', label: '캐파 매칭',   color: C.teal },
  quote_accuracy: { icon: '📊', label: '견적 정확도', color: C.purple },
};

function timeAgo(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60)    return `${s}초 전`;
  if (s < 3600)  return `${Math.round(s / 60)}분 전`;
  if (s < 86400) return `${Math.round(s / 3600)}시간 전`;
  return `${Math.round(s / 86400)}일 전`;
}

export default function PartnerAIHistoryPanel({ session, onClose }: Props) {
  const [filter, setFilter] = useState<PartnerFeature | 'all'>('all');
  const [records, setRecords] = useState<HistoryRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async (f: PartnerFeature | 'all') => {
    setLoading(true);
    setError(null);
    try {
      const qs = f !== 'all' ? `?feature=${f}` : '';
      const res = await fetch(`/api/partner/ai-history${qs}`, {
        headers: { Authorization: `Bearer ${session}` },
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { records?: HistoryRecord[] };
      setRecords(data.records ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : '불러오기 실패');
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => { void load(filter); }, [filter, load]);

  async function remove(id: string) {
    if (!confirm('이 이력을 삭제할까요?')) return;
    try {
      const res = await fetch(`/api/partner/ai-history?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session}` },
      });
      if (!res.ok) throw new Error();
      setRecords(prev => prev.filter(r => r.id !== id));
      if (expandedId === id) setExpandedId(null);
    } catch {
      alert('삭제에 실패했습니다.');
    }
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9300, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{ background: C.surface, borderRadius: 16, border: `1px solid ${C.border}`, width: '100%', maxWidth: 560, maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}
        onClick={e => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 18 }}>📜</span>
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: C.text }}>AI 사용 이력</p>
            <p style={{ margin: 0, fontSize: 11, color: C.textMuted }}>파트너 AI 기능 실행 결과</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.textMuted, fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>

        {/* 필터 칩 */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '10px 16px', borderBottom: `1px solid ${C.border}` }}>
          {(Object.keys(FEATURE_META) as (PartnerFeature | 'all')[]).map(f => {
            const meta = FEATURE_META[f];
            const active = filter === f;
            return (
              <button key={f} onClick={() => setFilter(f)} style={{
                padding: '4px 10px', borderRadius: 999, fontSize: 10, fontWeight: 700, cursor: 'pointer',
                border: `1px solid ${active ? meta.color : C.border}`,
                background: active ? `${meta.color}22` : 'transparent',
                color: active ? meta.color : C.textMuted,
                display: 'flex', alignItems: 'center', gap: 4,
              }}>
                {meta.icon} {meta.label}
              </button>
            );
          })}
        </div>

        {/* 본문 */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 16px 16px' }}>
          {loading && <p style={{ color: C.textMuted, fontSize: 12, textAlign: 'center', padding: '24px 0' }}>불러오는 중…</p>}
          {error && <p style={{ color: C.red, fontSize: 12, padding: 10 }}>{error}</p>}
          {!loading && !error && records.length === 0 && (
            <p style={{ color: C.textMuted, fontSize: 12, textAlign: 'center', padding: '32px 0' }}>저장된 AI 이력이 없습니다.</p>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {records.map(r => {
              const meta = FEATURE_META[r.feature as PartnerFeature] ?? FEATURE_META.all;
              const expanded = expandedId === r.id;
              return (
                <div key={r.id} style={{ border: `1px solid ${C.border}`, borderRadius: 8, background: C.card, overflow: 'hidden' }}>
                  <button
                    onClick={() => setExpandedId(expanded ? null : r.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 12px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}
                  >
                    <span style={{ fontSize: 16 }}>{meta.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: '0 0 2px', fontSize: 11, fontWeight: 700, color: meta.color, textTransform: 'uppercase' }}>
                        {meta.label} · {timeAgo(r.createdAt)}
                      </p>
                      <p style={{ margin: 0, fontSize: 12, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.title}
                      </p>
                    </div>
                    <span style={{ fontSize: 10, color: C.textMuted }}>{expanded ? '▼' : '▶'}</span>
                  </button>

                  {expanded && (
                    <div style={{ padding: '8px 12px 12px', borderTop: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <pre style={{ margin: 0, padding: 8, borderRadius: 4, background: C.bg, border: `1px solid ${C.border}`, fontSize: 10, color: C.text, overflowX: 'auto', maxHeight: 240, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {JSON.stringify(r.payload, null, 2)}
                      </pre>
                      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <button onClick={() => remove(r.id)} style={{ padding: '3px 10px', borderRadius: 4, border: `1px solid ${C.red}44`, background: 'transparent', color: C.red, fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>
                          🗑 삭제
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
