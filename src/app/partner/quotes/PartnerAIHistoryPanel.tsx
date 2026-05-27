'use client';

/**
 * PartnerAIHistoryPanel — 파트너 사이드 AI 이력 뷰어.
 * rfq_responder / order_priority / capacity_match / quote_accuracy 이력을 표시.
 * /api/partner/ai-history 엔드포인트(getPartnerAuth)를 사용.
 */

import { useCallback, useEffect, useState } from 'react';
import type { AIHistoryFeature } from '@/lib/ai-history';
import { usePartnerLang } from '../_lib/partnerLang';
import { quotePanelsDict, type QuotePanelsDict } from '../_lib/dicts/quotePanels';

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

const FEATURE_COLORS: Record<PartnerFeature | 'all', string> = {
  all:            C.textMuted,
  rfq_responder:  C.green,
  order_priority: C.accent,
  capacity_match: C.teal,
  quote_accuracy: C.purple,
};
const FEATURE_ICONS: Record<PartnerFeature | 'all', string> = {
  all: '📜', rfq_responder: '📥', order_priority: '🏆', capacity_match: '🔗', quote_accuracy: '📊',
};
function featureLabel(f: PartnerFeature | 'all', t: QuotePanelsDict): string {
  switch (f) {
    case 'all':            return t.aihFilterAll;
    case 'rfq_responder':  return t.aihFilterRfqResponder;
    case 'order_priority': return t.aihFilterOrderPriority;
    case 'capacity_match': return t.aihFilterCapacityMatch;
    case 'quote_accuracy': return t.aihFilterQuoteAccuracy;
  }
}

function timeAgo(ts: number, t: QuotePanelsDict): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60)    return t.aihRelSeconds(s);
  if (s < 3600)  return t.notifRelMinutes(Math.round(s / 60));
  if (s < 86400) return t.notifRelHours(Math.round(s / 3600));
  return t.notifRelDays(Math.round(s / 86400));
}

export default function PartnerAIHistoryPanel({ session, onClose }: Props) {
  const lang = usePartnerLang();
  const t = quotePanelsDict(lang);
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
      setError(e instanceof Error ? e.message : t.aihLoadFail);
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => { void load(filter); }, [filter, load]);

  async function remove(id: string) {
    if (!confirm(t.aihConfirmDelete)) return;
    try {
      const res = await fetch(`/api/partner/ai-history?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session}` },
      });
      if (!res.ok) throw new Error();
      setRecords(prev => prev.filter(r => r.id !== id));
      if (expandedId === id) setExpandedId(null);
    } catch {
      alert(t.aihDeleteFail);
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
          <span style={{ fontSize: 18 }} aria-hidden="true">📜</span>
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: C.text }}>{t.aihTitle}</p>
            <p style={{ margin: 0, fontSize: 11, color: C.textMuted }}>{t.aihSubtitle}</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.textMuted, fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>

        {/* 필터 칩 */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '10px 16px', borderBottom: `1px solid ${C.border}` }}>
          {(['all', 'rfq_responder', 'order_priority', 'capacity_match', 'quote_accuracy'] as (PartnerFeature | 'all')[]).map(f => {
            const color = FEATURE_COLORS[f];
            const icon = FEATURE_ICONS[f];
            const active = filter === f;
            return (
              <button key={f} onClick={() => setFilter(f)} style={{
                padding: '4px 10px', borderRadius: 999, fontSize: 10, fontWeight: 700, cursor: 'pointer',
                border: `1px solid ${active ? color : C.border}`,
                background: active ? `${color}22` : 'transparent',
                color: active ? color : C.textMuted,
                display: 'flex', alignItems: 'center', gap: 4,
              }}>
                {icon} {featureLabel(f, t)}
              </button>
            );
          })}
        </div>

        {/* 본문 */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 16px 16px' }}>
          {loading && <p style={{ color: C.textMuted, fontSize: 12, textAlign: 'center', padding: '24px 0' }}>{t.aihLoading}</p>}
          {error && <p style={{ color: C.red, fontSize: 12, padding: 10 }}>{error}</p>}
          {!loading && !error && records.length === 0 && (
            <p style={{ color: C.textMuted, fontSize: 12, textAlign: 'center', padding: '32px 0' }}>{t.aihEmpty}</p>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {records.map(r => {
              const featureKey = (r.feature as PartnerFeature) in FEATURE_COLORS ? (r.feature as PartnerFeature) : 'all';
              const color = FEATURE_COLORS[featureKey];
              const icon = FEATURE_ICONS[featureKey];
              const label = featureLabel(featureKey, t);
              const expanded = expandedId === r.id;
              return (
                <div key={r.id} style={{ border: `1px solid ${C.border}`, borderRadius: 8, background: C.card, overflow: 'hidden' }}>
                  <button
                    onClick={() => setExpandedId(expanded ? null : r.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 12px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}
                  >
                    <span style={{ fontSize: 16 }} aria-hidden="true">{icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: '0 0 2px', fontSize: 11, fontWeight: 700, color, textTransform: 'uppercase' }}>
                        {label} · {timeAgo(r.createdAt, t)}
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
                          {t.aihDeleteBtn}
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
