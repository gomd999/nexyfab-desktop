'use client';

/**
 * AIHistoryPanel.tsx — Recent AI feature outputs browser (Phase 5c).
 *
 * Lists the current user's past Cost Copilot / Process Router / Supplier Top-3
 * / DFM Explainer runs from `nf_ai_history`, with a feature-type filter and a
 * per-row delete. Clicking a row expands the stored payload + context as JSON
 * so users can recover prior outputs without spending AI credits.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import type { AIHistoryFeature } from '@/lib/ai-history';

type Feature = AIHistoryFeature;

interface HistoryRecord {
  id: string;
  feature: Feature;
  projectId: string | null;
  title: string;
  payload: unknown;
  context: unknown;
  createdAt: number;
}

interface CostCopilotSuggestion {
  id: string;
  title?: string;
  titleKo?: string;
  paramDeltas?: Record<string, number>;
  materialSwap?: string;
  processSwap?: string;
  estimatedSavingsPercent?: number;
}

interface CostCopilotPayloadShape {
  suggestions?: CostCopilotSuggestion[];
}

export interface ApplySuggestionArgs {
  paramDeltas?: Record<string, number>;
  materialSwap?: string;
}

const C = {
  bg: '#161b22',
  card: '#21262d',
  border: '#30363d',
  accent: '#388bfd',
  purple: '#a371f7',
  gold: '#d29922',
  green: '#3fb950',
  red: '#f85149',
  text: '#c9d1d9',
  dim: '#8b949e',
};

const dict = {
  ko: {
    title: 'AI 사용 이력',
    subtitle: '최근 AI 실행 결과를 다시 보기',
    currentProjectOnly: '현재 프로젝트만',
    loading: '불러오는 중…',
    noResults: '아직 저장된 AI 결과가 없습니다.',
    reapply: '재적용',
    payload: '결과',
    context: '컨텍스트',
    delete: '삭제',
    confirmDelete: '이 기록을 삭제할까요?',
    deleteFailed: '삭제 실패',
    feat: {
      all: '전체',
      ai_supplier_match: '공급사 Top-3',
      dfm_insights: 'DFM 인사이트',
      rfq_writer: 'RFQ 작성기',
      cert_filter: '인증 필터',
      rfq_responder: 'RFQ 회신',
      quote_negotiator: '견적 협상',
      order_priority: '수주 우선순위',
      change_detector: '변경 감지',
      capacity_match: '캐파 매칭',
      quote_accuracy: '견적 정확도',
    },
    secondsAgo: (s: number) => `${s}초 전`,
    minutesAgo: (m: number) => `${m}분 전`,
    hoursAgo: (h: number) => `${h}시간 전`,
    daysAgo: (d: number) => `${d}일 전`,
  },
  en: {
    title: 'AI History',
    subtitle: 'Revisit your recent AI runs',
    currentProjectOnly: 'Current project only',
    loading: 'Loading…',
    noResults: 'No saved AI results yet.',
    reapply: 'Re-apply',
    payload: 'Payload',
    context: 'Context',
    delete: 'Delete',
    confirmDelete: 'Delete this record?',
    deleteFailed: 'Delete failed',
    feat: {
      all: 'All',
      ai_supplier_match: 'Supplier Top-3',
      dfm_insights: 'DFM Insights',
      rfq_writer: 'RFQ Writer',
      cert_filter: 'Cert Filter',
      rfq_responder: 'RFQ Responder',
      quote_negotiator: 'Negotiator',
      order_priority: 'Order Priority',
      change_detector: 'Change Detector',
      capacity_match: 'Capacity Match',
      quote_accuracy: 'Quote Accuracy',
    },
    secondsAgo: (s: number) => `${s}s ago`,
    minutesAgo: (m: number) => `${m}m ago`,
    hoursAgo: (h: number) => `${h}h ago`,
    daysAgo: (d: number) => `${d}d ago`,
  },
  ja: {
    title: 'AI利用履歴',
    subtitle: '最近のAI実行結果を確認',
    currentProjectOnly: '現在のプロジェクトのみ',
    loading: '読み込み中…',
    noResults: '保存されたAI結果はまだありません。',
    reapply: '再適用',
    payload: '結果',
    context: 'コンテキスト',
    delete: '削除',
    confirmDelete: 'この記録を削除しますか？',
    deleteFailed: '削除失敗',
    feat: {
      all: 'すべて',
      ai_supplier_match: 'サプライヤーTop-3',
      dfm_insights: 'DFMインサイト',
      rfq_writer: 'RFQ作成',
      cert_filter: '認証フィルタ',
      rfq_responder: 'RFQ返信',
      quote_negotiator: '見積交渉',
      order_priority: '受注優先順位',
      change_detector: '変更検知',
      capacity_match: 'キャパマッチ',
      quote_accuracy: '見積精度',
    },
    secondsAgo: (s: number) => `${s}秒前`,
    minutesAgo: (m: number) => `${m}分前`,
    hoursAgo: (h: number) => `${h}時間前`,
    daysAgo: (d: number) => `${d}日前`,
  },
  zh: {
    title: 'AI使用历史',
    subtitle: '查看最近的AI执行结果',
    currentProjectOnly: '仅当前项目',
    loading: '加载中…',
    noResults: '暂无已保存的AI结果。',
    reapply: '重新应用',
    payload: '结果',
    context: '上下文',
    delete: '删除',
    confirmDelete: '删除此记录？',
    deleteFailed: '删除失败',
    feat: {
      all: '全部',
      ai_supplier_match: '供应商Top-3',
      dfm_insights: 'DFM洞察',
      rfq_writer: 'RFQ撰写',
      cert_filter: '认证筛选',
      rfq_responder: 'RFQ回复',
      quote_negotiator: '报价协商',
      order_priority: '订单优先级',
      change_detector: '变更检测',
      capacity_match: '产能匹配',
      quote_accuracy: '报价精度',
    },
    secondsAgo: (s: number) => `${s}秒前`,
    minutesAgo: (m: number) => `${m}分钟前`,
    hoursAgo: (h: number) => `${h}小时前`,
    daysAgo: (d: number) => `${d}天前`,
  },
  es: {
    title: 'Historial de IA',
    subtitle: 'Revisa tus ejecuciones recientes de IA',
    currentProjectOnly: 'Solo proyecto actual',
    loading: 'Cargando…',
    noResults: 'Aún no hay resultados de IA guardados.',
    reapply: 'Reaplicar',
    payload: 'Resultado',
    context: 'Contexto',
    delete: 'Eliminar',
    confirmDelete: '¿Eliminar este registro?',
    deleteFailed: 'Error al eliminar',
    feat: {
      all: 'Todos',
      ai_supplier_match: 'Proveedores Top-3',
      dfm_insights: 'Insights DFM',
      rfq_writer: 'Redactor RFQ',
      cert_filter: 'Filtro Cert.',
      rfq_responder: 'Respuesta RFQ',
      quote_negotiator: 'Negociador',
      order_priority: 'Prioridad de Pedido',
      change_detector: 'Detector de Cambios',
      capacity_match: 'Match de Capacidad',
      quote_accuracy: 'Precisión Cotización',
    },
    secondsAgo: (s: number) => `hace ${s}s`,
    minutesAgo: (m: number) => `hace ${m}m`,
    hoursAgo: (h: number) => `hace ${h}h`,
    daysAgo: (d: number) => `hace ${d}d`,
  },
  ar: {
    title: 'سجل الذكاء الاصطناعي',
    subtitle: 'راجع عمليات الذكاء الاصطناعي الأخيرة',
    currentProjectOnly: 'المشروع الحالي فقط',
    loading: 'جارٍ التحميل…',
    noResults: 'لا توجد نتائج محفوظة بعد.',
    reapply: 'إعادة تطبيق',
    payload: 'النتيجة',
    context: 'السياق',
    delete: 'حذف',
    confirmDelete: 'حذف هذا السجل؟',
    deleteFailed: 'فشل الحذف',
    feat: {
      all: 'الكل',
      ai_supplier_match: 'أفضل 3 موردين',
      dfm_insights: 'رؤى DFM',
      rfq_writer: 'محرر RFQ',
      cert_filter: 'فلتر الشهادات',
      rfq_responder: 'رد RFQ',
      quote_negotiator: 'المفاوض',
      order_priority: 'أولوية الطلب',
      change_detector: 'كاشف التغييرات',
      capacity_match: 'مطابقة السعة',
      quote_accuracy: 'دقة التسعير',
    },
    secondsAgo: (s: number) => `منذ ${s} ث`,
    minutesAgo: (m: number) => `منذ ${m} د`,
    hoursAgo: (h: number) => `منذ ${h} س`,
    daysAgo: (d: number) => `منذ ${d} ي`,
  },
};

const FEATURE_META: Record<Feature | 'all', { icon: string; color: string; labelKey: keyof typeof dict.en.feat | 'cost_copilot' | 'process_router' }> = {
  all:               { icon: '📜', color: C.dim,    labelKey: 'all' },
  cost_copilot:      { icon: '💰', color: C.gold,   labelKey: 'cost_copilot' },
  process_router:    { icon: '🧭', color: C.accent, labelKey: 'process_router' },
  ai_supplier_match: { icon: '🎯', color: C.green,  labelKey: 'ai_supplier_match' },
  dfm_insights:      { icon: '🤖', color: C.purple, labelKey: 'dfm_insights' },
  rfq_writer:        { icon: '✉️', color: C.gold,   labelKey: 'rfq_writer' },
  cert_filter:       { icon: '🛡️', color: C.purple, labelKey: 'cert_filter' },
  rfq_responder:     { icon: '📥', color: C.green,  labelKey: 'rfq_responder' },
  quote_negotiator:  { icon: '⚖️', color: C.gold,   labelKey: 'quote_negotiator' },
  order_priority:    { icon: '🏆', color: C.accent, labelKey: 'order_priority' },
  change_detector:   { icon: '🔍', color: C.purple, labelKey: 'change_detector' },
  capacity_match:    { icon: '🔗', color: '#2dd4bf', labelKey: 'capacity_match' },
  quote_accuracy:    { icon: '📊', color: C.purple, labelKey: 'quote_accuracy' },
};

/** Cost Copilot / Process Router are product names → kept English across langs */
function featureLabel(key: Feature | 'all', t: typeof dict.en): string {
  if (key === 'cost_copilot') return 'Cost Copilot';
  if (key === 'process_router') return 'Process Router';
  return t.feat[key];
}

function formatTimeAgo(ts: number, t: typeof dict.en): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60)      return t.secondsAgo(s);
  if (s < 3600)    return t.minutesAgo(Math.round(s / 60));
  if (s < 86400)   return t.hoursAgo(Math.round(s / 3600));
  return t.daysAgo(Math.round(s / 86400));
}

interface AIHistoryPanelProps {
  lang: string;
  onClose: () => void;
  /** Optional current project id; when set + toggle on, filters records to it. */
  projectId?: string;
  /** Re-apply a stored Cost Copilot suggestion to the current design. */
  onApplySuggestion?: (args: ApplySuggestionArgs) => void;
}

export default function AIHistoryPanel({ lang, onClose, projectId, onApplySuggestion }: AIHistoryPanelProps) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? 'en';
  const langMap: Record<string, keyof typeof dict> = {
    kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
  };
  // prefer URL-derived language; fall back to lang prop then 'en'
  const resolvedKey = langMap[seg] ?? langMap[lang] ?? 'en';
  const t = dict[resolvedKey];
  const isKo = resolvedKey === 'ko';

  const [filter, setFilter] = useState<Feature | 'all'>('all');
  const [projectOnly, setProjectOnly] = useState<boolean>(true);
  const [records, setRecords] = useState<HistoryRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async (f: Feature | 'all', usePid: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (f !== 'all') params.set('feature', f);
      if (usePid && projectId) params.set('projectId', projectId);
      const qs = params.toString();
      const res = await fetch(`/api/nexyfab/ai-history${qs ? `?${qs}` : ''}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { records?: HistoryRecord[] };
      setRecords(data.records ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(filter, projectOnly); }, [filter, projectOnly, load]);

  const remove = useCallback(async (id: string) => {
    if (!confirm(t.confirmDelete)) return;
    try {
      const res = await fetch(`/api/nexyfab/ai-history?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRecords(prev => prev.filter(r => r.id !== id));
      if (expandedId === id) setExpandedId(null);
    } catch (e) {
      alert(t.deleteFailed + ': ' + (e instanceof Error ? e.message : String(e)));
    }
  }, [t, expandedId]);

  return (
    <div style={{
      position: 'fixed', top: 48, right: 16, zIndex: 900,
      width: 440, maxHeight: 'calc(100vh - 80px)',
      background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12,
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 16px', borderBottom: `1px solid ${C.border}`,
        background: `linear-gradient(135deg, ${C.accent}11, transparent)`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18 }}>📜</span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: C.text }}>
              {t.title}
            </div>
            <div style={{ fontSize: 10, color: C.dim }}>
              {t.subtitle}
            </div>
          </div>
        </div>
        <button onClick={onClose} style={{
          background: 'none', border: 'none', color: C.dim, fontSize: 18, cursor: 'pointer', padding: 4,
        }}>✕</button>
      </div>

      {/* Filter chips */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 6,
        padding: '10px 16px', borderBottom: `1px solid ${C.border}`,
      }}>
        {(['all', 'cost_copilot', 'process_router', 'ai_supplier_match', 'dfm_insights', 'rfq_writer', 'cert_filter', 'rfq_responder', 'quote_negotiator', 'order_priority', 'change_detector', 'capacity_match', 'quote_accuracy'] as const).map(f => {
          const meta = FEATURE_META[f];
          const active = filter === f;
          return (
            <button key={f} onClick={() => setFilter(f)} style={{
              padding: '4px 10px', borderRadius: 999,
              border: `1px solid ${active ? meta.color : C.border}`,
              background: active ? `${meta.color}22` : 'transparent',
              color: active ? meta.color : C.dim,
              fontSize: 10, fontWeight: 700, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 4,
            }}>
              <span>{meta.icon}</span>
              <span>{featureLabel(f, t)}</span>
            </button>
          );
        })}
      </div>

      {/* Project-scope toggle */}
      {projectId && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 16px', borderBottom: `1px solid ${C.border}`,
          fontSize: 11, color: C.dim,
        }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={projectOnly}
              onChange={e => setProjectOnly(e.target.checked)}
              style={{ accentColor: C.accent, cursor: 'pointer' }}
            />
            <span style={{ color: projectOnly ? C.accent : C.dim, fontWeight: 700 }}>
              📁 {t.currentProjectOnly}
            </span>
          </label>
        </div>
      )}

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 16px 16px' }}>
        {loading && (
          <div style={{ color: C.dim, fontSize: 12, textAlign: 'center', padding: '24px 0' }}>
            {t.loading}
          </div>
        )}

        {error && (
          <div style={{
            padding: 10, borderRadius: 6,
            border: `1px solid ${C.red}44`, background: `${C.red}11`,
            color: C.red, fontSize: 11,
          }}>
            {error}
          </div>
        )}

        {!loading && !error && records.length === 0 && (
          <div style={{ color: C.dim, fontSize: 12, textAlign: 'center', padding: '32px 0' }}>
            {t.noResults}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {records.map(r => {
            const meta = FEATURE_META[r.feature] ?? FEATURE_META.all;
            const expanded = expandedId === r.id;
            return (
              <div key={r.id} style={{
                border: `1px solid ${C.border}`, borderRadius: 8, background: C.card,
                overflow: 'hidden',
              }}>
                <button
                  onClick={() => setExpandedId(expanded ? null : r.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    width: '100%', padding: '10px 12px',
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <span style={{ fontSize: 16 }}>{meta.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 11, fontWeight: 700, color: meta.color,
                      textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 2,
                    }}>
                      {featureLabel(r.feature, t)} · {formatTimeAgo(r.createdAt, t)}
                    </div>
                    <div style={{
                      fontSize: 12, color: C.text, lineHeight: 1.3,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {r.title}
                    </div>
                  </div>
                  <span style={{ fontSize: 10, color: C.dim }}>{expanded ? '▼' : '▶'}</span>
                </button>

                {expanded && (
                  <div style={{
                    padding: '8px 12px 12px', borderTop: `1px solid ${C.border}`,
                    display: 'flex', flexDirection: 'column', gap: 8,
                  }}>
                    {/* Re-apply suggestions (Cost Copilot only) */}
                    {r.feature === 'cost_copilot' && onApplySuggestion && (() => {
                      const payload = r.payload as CostCopilotPayloadShape | null;
                      const suggestions = (payload?.suggestions ?? []).filter(
                        s => s.paramDeltas || s.materialSwap,
                      );
                      if (suggestions.length === 0) return null;
                      return (
                        <div>
                          <div style={{ fontSize: 10, fontWeight: 700, color: C.gold, marginBottom: 4 }}>
                            ⚡ {t.reapply}
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {suggestions.map(s => (
                              <button
                                key={s.id}
                                onClick={() => onApplySuggestion({
                                  paramDeltas: s.paramDeltas,
                                  materialSwap: s.materialSwap,
                                })}
                                style={{
                                  padding: '7px 10px', borderRadius: 6,
                                  border: `1px solid ${C.gold}66`, background: `${C.gold}11`,
                                  color: C.text, fontSize: 11, fontWeight: 700,
                                  cursor: 'pointer', textAlign: 'left',
                                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                                }}
                              >
                                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {(isKo ? s.titleKo : s.title) ?? s.id}
                                </span>
                                <span style={{ fontSize: 10, color: C.gold, flexShrink: 0 }}>
                                  {s.estimatedSavingsPercent && s.estimatedSavingsPercent > 0
                                    ? `-${s.estimatedSavingsPercent}%`
                                    : '▶'}
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: C.dim, marginBottom: 4 }}>
                        {t.payload}
                      </div>
                      <pre style={{
                        margin: 0, padding: 8, borderRadius: 4,
                        background: C.bg, border: `1px solid ${C.border}`,
                        fontSize: 10, color: C.text, overflowX: 'auto',
                        maxHeight: 260, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                      }}>
                        {JSON.stringify(r.payload, null, 2)}
                      </pre>
                    </div>
                    {r.context !== null && r.context !== undefined && (
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: C.dim, marginBottom: 4 }}>
                          {t.context}
                        </div>
                        <pre style={{
                          margin: 0, padding: 8, borderRadius: 4,
                          background: C.bg, border: `1px solid ${C.border}`,
                          fontSize: 10, color: C.dim, overflowX: 'auto',
                          maxHeight: 160, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                        }}>
                          {JSON.stringify(r.context, null, 2)}
                        </pre>
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <button onClick={() => remove(r.id)} style={{
                        padding: '4px 10px', borderRadius: 4,
                        border: `1px solid ${C.red}44`, background: 'transparent',
                        color: C.red, fontSize: 10, fontWeight: 700, cursor: 'pointer',
                      }}>
                        🗑 {t.delete}
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
  );
}
