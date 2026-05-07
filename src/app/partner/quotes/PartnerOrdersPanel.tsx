'use client';

import { useState, useEffect, useCallback } from 'react';

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

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  placed:     { label: '주문 접수',  color: '#388bfd' },
  production: { label: '생산 중',   color: '#f0883e' },
  qc:         { label: '품질 검사', color: '#e3b341' },
  shipped:    { label: '배송 중',   color: '#79c0ff' },
  delivered:  { label: '납품 완료', color: '#3fb950' },
};

const NEXT_STATUS: Record<string, string> = {
  placed: 'production',
  production: 'qc',
  qc: 'shipped',
  shipped: 'delivered',
};

const NEXT_LABEL: Record<string, string> = {
  placed:     '생산 시작',
  production: 'QC 시작',
  qc:         '배송 시작',
  shipped:    '납품 완료',
};

interface Props {
  session: string;
  onClose: () => void;
}

export default function PartnerOrdersPanel({ session, onClose }: Props) {
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
      setMsg('주문 목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [session, statusFilter]);

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
        setMsg(`✅ ${order.partName} 상태가 "${STATUS_LABELS[next]?.label}"으로 업데이트됐습니다.`);
      } else {
        setMsg(`❌ ${d.error ?? '업데이트 실패'}`);
      }
    } catch {
      setMsg('❌ 오류가 발생했습니다.');
    } finally {
      setUpdating(null);
    }
  }

  function fmtDate(ts: number) {
    return new Date(ts).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
  }
  function won(n: number) { return n.toLocaleString('ko-KR') + '원'; }

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
          <span style={{ fontSize: 16, fontWeight: 800, color: C.text }}>📦 담당 주문 관리</span>
          <span style={{ fontSize: 12, color: C.dim }}>({filtered.length}건)</span>
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
              {s === '' ? '전체' : STATUS_LABELS[s]?.label ?? s}
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
            <div style={{ color: C.dim, textAlign: 'center', padding: '40px 0', fontSize: 13 }}>불러오는 중...</div>
          )}
          {!loading && filtered.length === 0 && (
            <div style={{ textAlign: 'center', padding: '60px 0', color: C.dim, fontSize: 13 }}>
              {statusFilter ? '해당 상태의 주문이 없습니다.' : '담당 주문이 없습니다.'}
            </div>
          )}
          {!loading && filtered.map(order => {
            const sl = STATUS_LABELS[order.status];
            const nextStatus = NEXT_STATUS[order.status];
            const nextLabel = NEXT_LABEL[order.status];
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
                        background: (sl?.color ?? '#6e7681') + '22', color: sl?.color ?? '#6e7681',
                      }}>{sl?.label ?? order.status}</span>
                      {isPaid && (
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 8, background: '#3fb95022', color: '#3fb950' }}>결제완료</span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>
                      {order.id} · 수량 {order.quantity.toLocaleString()}개 · {won(order.totalPriceKRW)}
                    </div>
                    <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>
                      주문일 {fmtDate(order.createdAt)} · 납기 예정 {fmtDate(order.estimatedDeliveryAt)}
                    </div>

                    {/* Progress bar */}
                    <div style={{ marginTop: 10, height: 4, background: C.border, borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: sl?.color ?? C.accent, transition: 'width 0.4s' }} />
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
                      {updating === order.id ? '처리 중...' : `→ ${nextLabel}`}
                    </button>
                  )}
                  {!nextStatus && order.status === 'delivered' && (
                    <span style={{ fontSize: 11, color: '#3fb950', fontWeight: 700 }}>✓ 납품 완료</span>
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
                    📄 PDF
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
                    🧾 세금계산서
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
