'use client';

import { useState, useEffect, useCallback } from 'react';
import { usePartnerLang } from '../_lib/partnerLang';
import { quotePanelsDict, type QuotePanelsDict } from '../_lib/dicts/quotePanels';

interface PartnerOrder {
  id: string;
  rfqId?: string | null;
  partName: string;
  manufacturerName: string;
  quantity: number;
  totalPriceKRW: number;
  status: string;
  steps: { label: string; labelKo: string; completedAt?: number; estimatedAt?: number }[];
  createdAt: number;
  estimatedDeliveryAt: number;
  paymentStatus?: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  placed:     '#388bfd',
  production: '#f0883e',
  qc:         '#e3b341',
  shipped:    '#79c0ff',
  delivered:  '#3fb950',
};

function statusLabel(s: string, t: QuotePanelsDict): string {
  switch (s) {
    case 'placed':     return t.poStatus_placed;
    case 'production': return t.poStatus_production;
    case 'qc':         return t.poStatus_qc;
    case 'shipped':    return t.poStatus_shipped;
    case 'delivered':  return t.poStatus_delivered;
    default:           return s;
  }
}

const NEXT_STATUS: Record<string, string> = {
  placed: 'production',
  production: 'qc',
  qc: 'shipped',
  shipped: 'delivered',
};

function nextLabel(s: string, t: QuotePanelsDict): string {
  switch (s) {
    case 'placed':     return t.poNext_placed;
    case 'production': return t.poNext_production;
    case 'qc':         return t.poNext_qc;
    case 'shipped':    return t.poNext_shipped;
    default:           return '';
  }
}

interface Props {
  session: string;
  onClose: () => void;
}

export default function PartnerOrdersPanel({ session, onClose }: Props) {
  const lang = usePartnerLang();
  const t = quotePanelsDict(lang);
  const [orders, setOrders] = useState<PartnerOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const url = statusFilter ? `/api/partner/orders?status=${statusFilter}` : '/api/partner/orders';
      const r = await fetch(url, { headers: { Authorization: `Bearer ${session}` } });
      const d = await r.json() as { orders?: PartnerOrder[] };
      setOrders(d.orders ?? []);
    } catch {
      setMsg(t.poErrorLoad);
    } finally {
      setLoading(false);
    }
  }, [session, statusFilter, t]);

  useEffect(() => { loadOrders(); }, [loadOrders]);

  async function advanceStatus(order: PartnerOrder) {
    const next = NEXT_STATUS[order.status];
    if (!next) return;
    setUpdating(order.id);
    setMsg('');
    try {
      const r = await fetch('/api/partner/orders', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session}`,
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({ orderId: order.id, status: next }),
      });
      const d = await r.json() as { ok?: boolean; error?: string };
      if (d.ok) {
        setOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: next } : o));
        setMsg(t.poUpdateSuccess(order.partName, statusLabel(next, t)));
      } else {
        setMsg(`❌ ${d.error ?? t.poUpdateFail}`);
      }
    } catch {
      setMsg(t.poErrorGeneric);
    } finally {
      setUpdating(null);
    }
  }

  const LOCALE: Record<string, string> = {
    ko: 'ko-KR', en: 'en-US', ja: 'ja-JP', cn: 'zh-CN', es: 'es-ES', ar: 'ar-SA',
  };
  function fmtDate(ts: number) {
    return new Date(ts).toLocaleDateString(LOCALE[lang] ?? 'en-US', { month: 'short', day: 'numeric' });
  }
  function fmtMoney(n: number) {
    try {
      return new Intl.NumberFormat(LOCALE[lang] ?? 'en-US', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 }).format(n);
    } catch { return `₩${n.toLocaleString()}`; }
  }

  const C = {
    bg: '#0d1117', panel: '#161b22', border: '#30363d', text: '#e6edf3',
    muted: '#8b949e', dim: '#6e7681', accent: '#388bfd',
  };

  const filtered = statusFilter ? orders.filter(o => o.status === statusFilter) : orders;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 60,
      background: '#00000088', display: 'flex', alignItems: 'flex-end',
    }}>
      <div style={{
        width: '100%', maxWidth: 680, margin: '0 auto',
        background: C.panel, borderRadius: '16px 16px 0 0',
        border: `1px solid ${C.border}`, borderBottom: 'none',
        maxHeight: '90vh', display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 16, fontWeight: 800, color: C.text }}>{t.poHeader}</span>
          <span style={{ fontSize: 12, color: C.dim }}>{t.poCount(filtered.length)}</span>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.muted, fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>

        {/* Status filter */}
        <div style={{ display: 'flex', gap: 6, padding: '10px 20px', borderBottom: `1px solid ${C.border}`, flexWrap: 'wrap' }}>
          {(['', 'placed', 'production', 'qc', 'shipped', 'delivered'] as const).map(s => (
            <button key={s} onClick={() => setStatusFilter(s)} style={{
              padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: 'pointer',
              border: `1px solid ${statusFilter === s ? C.accent : C.border}`,
              background: statusFilter === s ? C.accent + '22' : 'transparent',
              color: statusFilter === s ? C.accent : C.muted,
            }}>
              {s === '' ? t.poFilterAll : statusLabel(s, t)}
            </button>
          ))}
        </div>

        {/* Message */}
        {msg && (
          <div style={{
            margin: '10px 20px 0', padding: '8px 12px', borderRadius: 8, fontSize: 12,
            background: msg.startsWith('✅') ? '#3fb95018' : '#f8514918',
            color: msg.startsWith('✅') ? '#3fb950' : '#f85149',
            border: `1px solid ${msg.startsWith('✅') ? '#3fb95044' : '#f8514944'}`,
          }}>
            {msg}
          </div>
        )}

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px 24px' }}>
          {loading && (
            <div style={{ color: C.dim, textAlign: 'center', padding: '40px 0', fontSize: 13 }}>{t.poLoading}</div>
          )}
          {!loading && filtered.length === 0 && (
            <div style={{ textAlign: 'center', padding: '60px 0', color: C.dim, fontSize: 13 }}>
              {statusFilter ? t.poEmptyFiltered : t.poEmpty}
            </div>
          )}
          {!loading && filtered.map(order => {
            const slColor = STATUS_COLORS[order.status] ?? '#6e7681';
            const slLabel = statusLabel(order.status, t);
            const nextStatus = NEXT_STATUS[order.status];
            const nextBtnLabel = nextLabel(order.status, t);
            const currentStep = ['placed','production','qc','shipped','delivered'].indexOf(order.status);
            const pct = Math.round((currentStep / 4) * 100);
            const isPaid = order.paymentStatus === 'paid';

            return (
              <div key={order.id} style={{
                background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10,
                padding: '14px 16px', marginBottom: 12,
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{order.partName}</span>
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
                        background: slColor + '22', color: slColor,
                      }}>{slLabel}</span>
                      {isPaid && (
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 8, background: '#3fb95022', color: '#3fb950' }}>{t.poBadgePaid}</span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>
                      {order.id} · {t.poOrderQty(order.quantity.toLocaleString())} · {fmtMoney(order.totalPriceKRW)}
                    </div>
                    <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>
                      {t.poOrderedOn(fmtDate(order.createdAt))} · {t.poDueOn(fmtDate(order.estimatedDeliveryAt))}
                    </div>

                    {/* Progress bar */}
                    <div style={{ marginTop: 10, height: 4, background: C.border, borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: slColor, transition: 'width 0.4s' }} />
                    </div>
                  </div>

                  {/* Buttons */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
                  {nextStatus && (
                    <button
                      onClick={() => advanceStatus(order)}
                      disabled={updating === order.id}
                      style={{
                        padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700,
                        border: 'none', cursor: updating === order.id ? 'default' : 'pointer',
                        background: updating === order.id ? C.border : 'linear-gradient(135deg,#388bfd,#8b5cf6)',
                        color: updating === order.id ? C.muted : '#fff',
                        whiteSpace: 'nowrap', flexShrink: 0,
                        opacity: updating === order.id ? 0.7 : 1,
                      }}
                    >
                      {updating === order.id ? t.poBtnProcessing : `→ ${nextBtnLabel}`}
                    </button>
                  )}
                  {!nextStatus && order.status === 'delivered' && (
                    <span style={{ fontSize: 11, color: '#3fb950', fontWeight: 700 }}>{t.poBtnDeliveredDone}</span>
                  )}
                  <a
                    href={`/api/nexyfab/orders/${order.id}/pdf`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                      border: `1px solid ${C.border}`, color: C.muted, textDecoration: 'none',
                      background: 'transparent', textAlign: 'center',
                    }}
                  >
                    {t.poBtnPdf}
                  </a>
                  <a
                    href={`/api/nexyfab/orders/${order.id}/tax-invoice`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                      border: `1px solid #e3b34155`, color: '#e3b341', textDecoration: 'none',
                      background: 'transparent', textAlign: 'center',
                    }}
                  >
                    {t.poBtnTaxInvoice}
                  </a>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
