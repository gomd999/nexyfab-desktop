'use client';

import Link from 'next/link';
import { use, useEffect, useState, useCallback, useRef } from 'react';
import type { NexyfabOrder } from '@/types/nexyfab-orders';
import { useToast } from '@/hooks/useToast';
import { toIsoLang } from '@/lib/i18n/normalize';
import { createCommercialLocalizer } from '@/lib/i18n/commercialLocalizer';
import { formatDate, formatMoney, formatNumber } from '@/lib/i18n/format';

type Tab = 'new' | 'progress' | 'done';

const STATUS_TO_TAB: Record<NexyfabOrder['status'], Tab> = {
  placed: 'new',
  production: 'progress',
  qc: 'progress',
  shipped: 'done',
  delivered: 'done',
};

const NEXT_STATUS: Partial<Record<NexyfabOrder['status'], NexyfabOrder['status']>> = {
  placed: 'production',
  production: 'qc',
  qc: 'shipped',
};

function maskUserId(uid: string): string {
  return uid.length > 4 ? uid.slice(0, 4) + '***' : uid + '***';
}

function fmtKRW(n: number, lang: string) {
  return formatMoney(n, lang, 'KRW') ?? '';
}

function fmtDate(ts: number, lang: string) {
  return formatDate(ts, lang, { year: 'numeric', month: 'short', day: 'numeric' }) ?? '';
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ManufacturerDashboardPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = use(params);
  const isKo = toIsoLang(lang) === 'ko';
  const L = createCommercialLocalizer(lang);
  const toast = useToast();

  const [orders, setOrders] = useState<NexyfabOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('new');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadOrders = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const r = await fetch('/api/nexyfab/orders');
      const data = await r.json() as { orders?: NexyfabOrder[] };
      setOrders(data.orders ?? []);
      setError(null);
    } catch {
      if (!silent) setError('LOAD_FAILED');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOrders();
    intervalRef.current = setInterval(() => loadOrders(true), 30_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [loadOrders]);

  // ── Action: advance status ──────────────────────────────────────────────────
  const handleAction = useCallback(async (order: NexyfabOrder) => {
    const nextStatus = NEXT_STATUS[order.status];
    if (!nextStatus) return;
    setActionLoading(order.id);
    try {
      const r = await fetch(`/api/nexyfab/orders/${order.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!r.ok) throw new Error('Failed');
      await loadOrders(true);
      toast.success(L('주문 상태가 업데이트되었습니다.', 'Order status updated.'));
    } catch {
      toast.error(L('상태 변경에 실패했습니다.', 'Failed to update status.'));
    } finally {
      setActionLoading(null);
    }
  }, [loadOrders, toast, isKo]);

  // ── Stats ──────────────────────────────────────────────────────────────────
  const totalOrders = orders.length;
  const inProgressOrders = orders.filter(o => o.status === 'production' || o.status === 'qc').length;

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const revenueThisMonth = orders
    .filter(o => o.createdAt >= startOfMonth)
    .reduce((sum, o) => sum + o.totalPriceKRW, 0);

  // ── Tab filtering ─────────────────────────────────────────────────────────
  const tabOrders = orders.filter(o => STATUS_TO_TAB[o.status] === tab);

  // ─────────────────────────────────────────────────────────────────────────────

  const tabs: { key: Tab; ko: string; en: string; count: number }[] = [
    { key: 'new', ko: '신규 주문', en: 'New Orders', count: orders.filter(o => STATUS_TO_TAB[o.status] === 'new').length },
    { key: 'progress', ko: '진행 중', en: 'In Progress', count: orders.filter(o => STATUS_TO_TAB[o.status] === 'progress').length },
    { key: 'done', ko: '완료', en: 'Completed', count: orders.filter(o => STATUS_TO_TAB[o.status] === 'done').length },
  ];

  return (
    <div style={{
      minHeight: '100vh', background: 'var(--nx-bg)', color: 'var(--nx-text)',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      {/* ── Header ── */}
      <div style={{
        borderBottom: '1px solid var(--nx-panel-2)', padding: '16px 32px',
        display: 'flex', alignItems: 'center', gap: 16,
        position: 'sticky', top: 0, background: 'var(--nx-bg)', zIndex: 10,
      }}>
        <Link prefetch href={`/${lang}/shape-generator`} style={{ textDecoration: 'none' }}>
          <span style={{ fontSize: 20, fontWeight: 800, color: '#388bfd' }}>Nexy</span>
          <span style={{ fontSize: 20, fontWeight: 800, color: '#3fb950' }}>Fab</span>
        </Link>
        <span style={{ color: 'var(--nx-border)' }}>/</span>
        <span style={{ fontSize: 16, fontWeight: 600 }}>
          {L('제조 대시보드', 'Manufacturer Dashboard')}
        </span>
        <div style={{ flex: 1 }} />
        <a href={`/${lang}/nexyfab/orders`} style={{
          fontSize: 12, color: 'var(--nx-text-2)', textDecoration: 'none', padding: '6px 12px',
          border: '1px solid var(--nx-border)', borderRadius: 6,
        }}>
          {L('내 주문', 'My Orders')}
        </a>
      </div>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 24px' }}>
        {/* ── Stats Banner ── */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 32,
        }}>
          <StatCard
            label={L('전체 주문', 'Total Orders')}
            value={String(totalOrders)}
            icon="📋"
            color="#388bfd"
          />
          <StatCard
            label={L('진행 중', 'In Progress')}
            value={String(inProgressOrders)}
            icon="⚙️"
            color="#f0883e"
          />
          <StatCard
            label={L('이번 달 매출', 'Revenue (Month)')}
            value={fmtKRW(revenueThisMonth, lang)}
            icon="💰"
            color="#3fb950"
          />
        </div>

        {/* ── Tabs ── */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: '1px solid var(--nx-panel-2)' }}>
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                padding: '10px 18px', fontSize: 13, fontWeight: 600,
                background: 'none', border: 'none', cursor: 'pointer',
                color: tab === t.key ? 'var(--nx-text)' : 'var(--nx-text-2)',
                borderBottom: tab === t.key ? '2px solid #388bfd' : '2px solid transparent',
                marginBottom: -1, transition: 'color 0.15s',
                display: 'flex', alignItems: 'center', gap: 8,
              }}
            >
              {L(t.ko, t.en)}
              {t.count > 0 && (
                <span style={{
                  fontSize: 10, padding: '1px 7px', borderRadius: 12,
                  background: tab === t.key ? '#388bfd22' : 'var(--nx-panel-2)',
                  color: tab === t.key ? '#388bfd' : 'var(--nx-text-2)',
                }}>
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ── Content ── */}
        {loading && (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--nx-text-3)' }}>
            {L('불러오는 중...', 'Loading...')}
          </div>
        )}

        {error && (
          <div style={{
            background: '#da363322', border: '1px solid #da363355',
            borderRadius: 8, padding: '14px 16px', color: '#f85149', fontSize: 13, marginBottom: 16,
          }}>
            {error === 'LOAD_FAILED' ? (L('불러오기 실패', 'Failed to load orders')) : error}
          </div>
        )}

        {!loading && !error && tabOrders.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--nx-text-3)' }}>
            {L('해당 주문이 없습니다.', 'No orders in this category.')}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {tabOrders.map(order => (
            <ManufacturerOrderCard
              key={order.id}
              order={order}
              lang={lang}
              isKo={isKo}
              actionLoading={actionLoading === order.id}
              onAction={handleAction}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, icon, color }: { label: string; value: string; icon: string; color: string }) {
  return (
    <div style={{
      background: 'var(--nx-panel)', border: '1px solid var(--nx-border)',
      borderRadius: 12, padding: '20px 24px',
      display: 'flex', alignItems: 'center', gap: 16,
    }}>
      <div style={{
        width: 44, height: 44, borderRadius: 10, fontSize: 22,
        background: color + '18', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {icon}
      </div>
      <div>
        <div style={{ fontSize: 11, color: 'var(--nx-text-2)', marginBottom: 4 }}>{label}</div>
        <div style={{ fontSize: 22, fontWeight: 800, color, fontFamily: 'monospace' }}>{value}</div>
      </div>
    </div>
  );
}

// ─── Order Card ───────────────────────────────────────────────────────────────

const STATUS_ACTION: Record<NexyfabOrder['status'], { ko: string; en: string; color: string } | null> = {
  placed:     { ko: '생산 시작', en: 'Start Production', color: '#388bfd' },
  production: { ko: 'QC 검사', en: 'Send to QC', color: '#e3b341' },
  qc:         { ko: '배송 처리', en: 'Mark Shipped', color: '#3fb950' },
  shipped:    null,
  delivered:  null,
};

const STATUS_BADGE: Record<NexyfabOrder['status'], { ko: string; en: string; color: string }> = {
  placed:     { ko: '주문 완료', en: 'Order Placed', color: '#388bfd' },
  production: { ko: '생산 중', en: 'In Production', color: '#f0883e' },
  qc:         { ko: '품질 검사', en: 'QC Check', color: '#e3b341' },
  shipped:    { ko: '배송 중', en: 'Shipped', color: '#79c0ff' },
  delivered:  { ko: '배송 완료', en: 'Delivered', color: '#3fb950' },
};

function ManufacturerOrderCard({
  order, lang, isKo, actionLoading, onAction,
}: {
  order: NexyfabOrder;
  lang: string;
  isKo: boolean;
  actionLoading: boolean;
  onAction: (order: NexyfabOrder) => void;
}) {
  const L = createCommercialLocalizer(lang);
  const actionDef = STATUS_ACTION[order.status];
  const badge = STATUS_BADGE[order.status];

  return (
    <div style={{
      background: 'var(--nx-panel)', border: '1px solid var(--nx-border)',
      borderRadius: 12, overflow: 'hidden',
    }}>
      {/* Header row */}
      <div style={{
        padding: '14px 20px', borderBottom: '1px solid var(--nx-panel-2)',
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      }}>
        <div>
          <p style={{ margin: 0, fontSize: 10, color: 'var(--nx-text-3)', fontFamily: 'monospace' }}>{order.id}</p>
          <p style={{ margin: '3px 0 0', fontSize: 15, fontWeight: 700, color: 'var(--nx-text)' }}>
            {order.partName}
          </p>
        </div>
        <div style={{ flex: 1 }} />
        {/* Status badge */}
        <span style={{
          fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 10,
          background: badge.color + '22', color: badge.color,
        }}>
          {L(badge.ko, badge.en)}
        </span>
      </div>

      {/* Meta + action row */}
      <div style={{
        padding: '14px 20px',
        display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap',
      }}>
        <MetaItem label={L('고객', 'Customer')} value={maskUserId(order.userId)} />
        <MetaItem label={L('수량', 'Qty')} value={`${formatNumber(order.quantity, lang)}${L('개', ' pcs')}`} />
        <MetaItem label={L('금액', 'Price')} value={fmtKRW(order.totalPriceKRW, lang)} />
        <MetaItem label={L('주문일', 'Date')} value={fmtDate(order.createdAt, lang)} />
        <div style={{ flex: 1 }} />

        {/* Action button or completion badge */}
        {actionDef ? (
          <button
            onClick={() => onAction(order)}
            disabled={actionLoading}
            style={{
              padding: '9px 18px', borderRadius: 8, fontSize: 13, fontWeight: 700,
              background: actionLoading ? 'var(--nx-panel-2)' : actionDef.color + '22',
              color: actionLoading ? 'var(--nx-text-3)' : actionDef.color,
              border: `1px solid ${actionLoading ? 'var(--nx-border)' : actionDef.color + '66'}`,
              cursor: actionLoading ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s',
            }}
          >
            {actionLoading
              ? (L('처리 중...', 'Processing...'))
              : L(actionDef.ko, actionDef.en)}
          </button>
        ) : (
          <span style={{
            fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 8,
            background: 'var(--nx-panel-2)', color: 'var(--nx-text-3)', border: '1px solid var(--nx-border)',
          }}>
            {order.status === 'shipped'
              ? (L('배송 완료 확인 대기', 'Awaiting delivery confirm'))
              : (L('완료', 'Completed'))}
          </span>
        )}
      </div>
    </div>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p style={{ margin: 0, fontSize: 10, color: 'var(--nx-text-3)' }}>{label}</p>
      <p style={{ margin: '2px 0 0', fontSize: 13, fontWeight: 600, color: 'var(--nx-text)' }}>{value}</p>
    </div>
  );
}
