'use client';

/**
 * /partner/orders — Partner-side order workflow.
 *
 * Kanban-style 4-column view (생산 중 / 품질 검사 / 배송 중 / 완료).
 * Click a card to open the detail drawer where the partner can:
 *   - advance to next status (POST /api/partner/orders PATCH)
 *   - drop a note, photo, shipment number, or delay report (POST .../events)
 *
 * Multi-dimensional metrics are loaded once at the top so partners see
 * exactly which axis (납기/응답/품질/소통) needs improvement, never a
 * single composite credit score (per project memory: feedback_metric_design).
 */
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import PartnerNav from '../PartnerNav';

interface OrderRow {
  id: string;
  rfqId: string | null;
  userId: string;
  partName: string;
  manufacturerName: string;
  quantity: number;
  totalPriceKRW: number;
  status: 'placed' | 'production' | 'qc' | 'shipped' | 'delivered';
  steps: Array<{ label: string; labelKo: string; completedAt?: number; estimatedAt?: number }>;
  createdAt: number;
  estimatedDeliveryAt: number;
  partnerEmail: string | null;
}

interface OrderEvent {
  id: string;
  orderId: string;
  kind: 'status_change' | 'note' | 'photo' | 'shipment' | 'delay';
  authorEmail: string;
  authorRole: string;
  body: string | null;
  photoUrl: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  createdAt: number;
}

interface MetricsSummary {
  windowDays: number;
  onTimeRate: number | null;
  onTimeCount: number;
  lateCount: number;
  avgLeadTimeDays: number | null;
  avgResponseMinutes: number | null;
  responseSamples: number;
  qualityAvg: number | null;
  communicationAvg: number | null;
  deadlineRatingAvg: number | null;
  reviewCount: number;
  reorderRate: number | null;
}

const STATUS_FLOW: Array<OrderRow['status']> = ['placed', 'production', 'qc', 'shipped', 'delivered'];
const STATUS_LABEL: Record<OrderRow['status'], string> = {
  placed: '주문 접수',
  production: '생산 중',
  qc: '품질 검사',
  shipped: '배송 중',
  delivered: '완료',
};

const COLUMNS: Array<{ key: OrderRow['status']; label: string; tone: string }> = [
  { key: 'production', label: '🏭 생산 중', tone: 'border-amber-200 bg-amber-50/40' },
  { key: 'qc',         label: '🔍 품질 검사', tone: 'border-purple-200 bg-purple-50/40' },
  { key: 'shipped',    label: '🚚 배송 중', tone: 'border-sky-200 bg-sky-50/40' },
  { key: 'delivered',  label: '✅ 완료',    tone: 'border-emerald-200 bg-emerald-50/40' },
];

function won(n: number) { return `₩${n.toLocaleString('ko-KR')}`; }

function relTime(ts: number) {
  const diff = Date.now() - ts;
  const day = 86_400_000;
  if (diff < 60_000) return '방금';
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}분 전`;
  if (diff < day) return `${Math.round(diff / 3_600_000)}시간 전`;
  if (diff < 7 * day) return `${Math.round(diff / day)}일 전`;
  return new Date(ts).toLocaleDateString('ko-KR');
}

function MetricsBar({ m }: { m: MetricsSummary }) {
  const cards = [
    { label: '납기 준수율', value: m.onTimeRate != null ? `${m.onTimeRate}%` : '—', sub: `완료 ${m.onTimeCount + m.lateCount}건`, tone: 'text-emerald-700 bg-emerald-50' },
    { label: '평균 리드타임', value: m.avgLeadTimeDays != null ? `${m.avgLeadTimeDays}일` : '—', sub: '주문→납품', tone: 'text-blue-700 bg-blue-50' },
    { label: '평균 응답속도', value: m.avgResponseMinutes != null
        ? (m.avgResponseMinutes >= 60 ? `${Math.round(m.avgResponseMinutes / 60)}시간` : `${m.avgResponseMinutes}분`)
        : '—', sub: `${m.responseSamples}건 견적`, tone: 'text-purple-700 bg-purple-50' },
    { label: '품질 평점', value: m.qualityAvg != null ? `★ ${m.qualityAvg}` : '—', sub: `${m.reviewCount}건`, tone: 'text-amber-700 bg-amber-50' },
    { label: '소통 평점', value: m.communicationAvg != null ? `★ ${m.communicationAvg}` : '—', sub: `${m.reviewCount}건`, tone: 'text-rose-700 bg-rose-50' },
    { label: '재주문률', value: m.reorderRate != null ? `${m.reorderRate}%` : '—', sub: `최근 ${m.windowDays}일`, tone: 'text-indigo-700 bg-indigo-50' },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-6 gap-2 mb-4">
      {cards.map(c => (
        <div key={c.label} className={`rounded-xl px-3 py-2.5 ${c.tone} border border-transparent`}>
          <div className="text-[11px] font-semibold opacity-80">{c.label}</div>
          <div className="text-lg font-black mt-0.5">{c.value}</div>
          <div className="text-[10px] opacity-70 mt-0.5">{c.sub}</div>
        </div>
      ))}
    </div>
  );
}

function OrderCard({ order, onClick, isLate }: {
  order: OrderRow; onClick: () => void; isLate: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`block w-full text-left bg-white rounded-xl p-3 border border-gray-100 shadow-sm hover:shadow-md hover:border-blue-200 transition
        ${isLate ? 'ring-2 ring-rose-300' : ''}`}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <span className="text-[11px] font-mono text-gray-400">{order.id}</span>
        {isLate && <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-700">납기 초과</span>}
      </div>
      <div className="text-sm font-bold text-gray-900 truncate">{order.partName}</div>
      <div className="text-xs text-gray-500 mt-0.5">{order.quantity.toLocaleString()}개 · {won(order.totalPriceKRW)}</div>
      <div className="text-[11px] text-gray-400 mt-1.5 flex items-center justify-between">
        <span>납기 {new Date(order.estimatedDeliveryAt).toLocaleDateString('ko-KR')}</span>
        <span>{relTime(order.createdAt)} 주문</span>
      </div>
    </button>
  );
}

export default function PartnerOrdersPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [metrics, setMetrics] = useState<MetricsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<OrderRow | null>(null);
  const [events, setEvents] = useState<OrderEvent[]>([]);
  const [eventLoading, setEventLoading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [noteInput, setNoteInput] = useState('');
  const [shipmentInput, setShipmentInput] = useState('');
  const [delayInput, setDelayInput] = useState('');

  const session = () => (typeof window !== 'undefined' ? localStorage.getItem('partnerSession') ?? '' : '');

  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      if (session() === 'demo') {
        const now = Date.now();
        const demo: OrderRow[] = [
          { id: 'ORD-2026-A12B3C', rfqId: null, userId: 'u1', partName: 'EV 배터리 브라켓', manufacturerName: 'Demo 제조사', quantity: 50, totalPriceKRW: 3_500_000, status: 'production', steps: [], createdAt: now - 2 * 86_400_000, estimatedDeliveryAt: now + 9 * 86_400_000, partnerEmail: 'demo' },
          { id: 'ORD-2026-D44E5F', rfqId: null, userId: 'u2', partName: '스마트워치 하우징', manufacturerName: 'Demo 제조사', quantity: 200, totalPriceKRW: 1_200_000, status: 'qc', steps: [], createdAt: now - 8 * 86_400_000, estimatedDeliveryAt: now + 1 * 86_400_000, partnerEmail: 'demo' },
          { id: 'ORD-2026-G77H8I', rfqId: null, userId: 'u3', partName: '드론 프로펠러 가드', manufacturerName: 'Demo 제조사', quantity: 30, totalPriceKRW: 850_000, status: 'shipped', steps: [], createdAt: now - 10 * 86_400_000, estimatedDeliveryAt: now - 1 * 86_400_000, partnerEmail: 'demo' },
          { id: 'ORD-2026-J11K2L', rfqId: null, userId: 'u4', partName: '산업용 로봇팔 부품', manufacturerName: 'Demo 제조사', quantity: 5, totalPriceKRW: 8_800_000, status: 'delivered', steps: [], createdAt: now - 25 * 86_400_000, estimatedDeliveryAt: now - 11 * 86_400_000, partnerEmail: 'demo' },
        ];
        setOrders(demo);
        setMetrics({
          windowDays: 90,
          onTimeRate: 91.7, onTimeCount: 11, lateCount: 1,
          avgLeadTimeDays: 13.2,
          avgResponseMinutes: 42, responseSamples: 18,
          qualityAvg: 4.6, communicationAvg: 4.8, deadlineRatingAvg: 4.5, reviewCount: 9,
          reorderRate: 33.3,
        });
        return;
      }

      const res = await fetch('/api/partner/orders?limit=50', {
        headers: { Authorization: `Bearer ${session()}` },
      });
      if (!res.ok) throw new Error('load failed');
      const data = await res.json();
      setOrders(data.orders ?? []);

      const mres = await fetch('/api/partner/metrics?windowDays=90', {
        headers: { Authorization: `Bearer ${session()}` },
      });
      if (mres.ok) {
        const mdata = await mres.json();
        setMetrics(mdata.metrics);
      }
    } catch (err) {
      console.error('[partner/orders] load failed:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!session()) { router.replace('/partner/login'); return; }
    loadOrders();
  }, [router, loadOrders]);

  async function openOrder(order: OrderRow) {
    setSelected(order);
    setEvents([]);
    setNoteInput(''); setShipmentInput(''); setDelayInput('');
    if (session() === 'demo') {
      setEvents([
        { id: 'e1', orderId: order.id, kind: 'status_change', authorEmail: 'system', authorRole: 'system', body: null, photoUrl: null, fromStatus: 'placed', toStatus: 'production', createdAt: Date.now() - 86_400_000 },
        { id: 'e2', orderId: order.id, kind: 'note', authorEmail: 'demo', authorRole: 'partner', body: '소재 입고 완료, 가공 시작했습니다.', photoUrl: null, fromStatus: null, toStatus: null, createdAt: Date.now() - 3_600_000 },
      ]);
      return;
    }
    setEventLoading(true);
    try {
      const res = await fetch(`/api/partner/orders/${order.id}/events`, {
        headers: { Authorization: `Bearer ${session()}` },
      });
      const data = await res.json();
      setEvents(data.events ?? []);
    } catch (err) {
      console.error('[partner/orders] events load failed:', err);
    } finally {
      setEventLoading(false);
    }
  }

  async function advance() {
    if (!selected) return;
    const idx = STATUS_FLOW.indexOf(selected.status);
    const next = STATUS_FLOW[idx + 1];
    if (!next) return;
    setAdvancing(true);
    try {
      if (session() === 'demo') {
        setOrders(prev => prev.map(o => o.id === selected.id ? { ...o, status: next } : o));
        setSelected({ ...selected, status: next });
        return;
      }
      const res = await fetch('/api/partner/orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session()}` },
        body: JSON.stringify({ orderId: selected.id, status: next }),
      });
      if (!res.ok) throw new Error();
      setOrders(prev => prev.map(o => o.id === selected.id ? { ...o, status: next } : o));
      setSelected({ ...selected, status: next });
      // Reload events to pick up the auto-recorded status_change row
      openOrder({ ...selected, status: next });
    } catch (err) {
      alert('상태 변경에 실패했습니다.');
    } finally {
      setAdvancing(false);
    }
  }

  async function postEvent(kind: 'note' | 'shipment' | 'delay', body: string) {
    if (!selected || !body.trim()) return;
    setPosting(true);
    try {
      if (session() === 'demo') {
        setEvents(prev => [{
          id: `tmp-${Date.now()}`, orderId: selected.id, kind, authorEmail: 'demo', authorRole: 'partner',
          body, photoUrl: null, fromStatus: null, toStatus: null, createdAt: Date.now(),
        }, ...prev]);
      } else {
        const res = await fetch(`/api/partner/orders/${selected.id}/events`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session()}` },
          body: JSON.stringify({ kind, body }),
        });
        if (!res.ok) throw new Error();
        await openOrder(selected);
      }
      if (kind === 'note') setNoteInput('');
      if (kind === 'shipment') setShipmentInput('');
      if (kind === 'delay') setDelayInput('');
    } catch {
      alert('등록에 실패했습니다.');
    } finally {
      setPosting(false);
    }
  }

  const grouped: Record<OrderRow['status'], OrderRow[]> = {
    placed: [], production: [], qc: [], shipped: [], delivered: [],
  };
  for (const o of orders) {
    if (o.status === 'placed') grouped.production.push(o); // placed before production payment — show in 생산 column anyway
    else grouped[o.status].push(o);
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <PartnerNav />
      <main className="flex-1 p-6 overflow-auto pb-24 md:pb-6">
        <div className="max-w-7xl mx-auto">
          <div className="mb-4">
            <h1 className="text-2xl font-black text-gray-900">주문 워크플로우</h1>
            <p className="text-sm text-gray-500 mt-1">진행 중 주문을 단계별로 관리하고, 사진·메모를 등록하면 고객에게 실시간 공유됩니다.</p>
          </div>

          {metrics && <MetricsBar m={metrics} />}

          {loading ? (
            <div className="text-center py-20 text-gray-400 text-sm">불러오는 중…</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
              {COLUMNS.map(col => (
                <div key={col.key} className={`rounded-2xl border ${col.tone} p-3 min-h-[200px]`}>
                  <div className="flex items-center justify-between mb-2 px-1">
                    <div className="text-sm font-bold text-gray-800">{col.label}</div>
                    <span className="text-xs font-semibold text-gray-500">{grouped[col.key].length}</span>
                  </div>
                  <div className="space-y-2">
                    {grouped[col.key].length === 0 && (
                      <div className="text-xs text-gray-400 px-1 py-3 text-center">없음</div>
                    )}
                    {grouped[col.key].map(o => {
                      const isLate = o.status !== 'delivered' && Date.now() > o.estimatedDeliveryAt;
                      return <OrderCard key={o.id} order={o} onClick={() => openOrder(o)} isLate={isLate} />;
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {selected && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-stretch justify-end" onClick={() => setSelected(null)}>
          <div className="bg-white w-full max-w-xl h-full overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="bg-gray-900 text-white px-6 py-5 sticky top-0 z-10">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs text-gray-400 font-mono">{selected.id}</div>
                  <h2 className="text-lg font-black mt-0.5">{selected.partName}</h2>
                  <div className="text-xs text-gray-300 mt-1">
                    {selected.quantity.toLocaleString()}개 · {won(selected.totalPriceKRW)}
                  </div>
                </div>
                <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-white text-2xl leading-none">×</button>
              </div>
              <div className="flex items-center gap-2 mt-3">
                <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-blue-600">현재: {STATUS_LABEL[selected.status]}</span>
                {selected.status !== 'delivered' && (
                  <button
                    onClick={advance}
                    disabled={advancing}
                    className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 transition"
                  >
                    {advancing ? '처리 중…' : `→ ${STATUS_LABEL[STATUS_FLOW[STATUS_FLOW.indexOf(selected.status) + 1]]}`}
                  </button>
                )}
              </div>
            </div>

            <div className="p-6 space-y-5">
              {/* 빠른 입력 */}
              <section>
                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">진행 메모</h3>
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input
                      value={noteInput}
                      onChange={e => setNoteInput(e.target.value)}
                      placeholder="고객에게 공유할 진행 상황 (예: 가공 80% 완료)"
                      className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400"
                    />
                    <button
                      onClick={() => postEvent('note', noteInput)}
                      disabled={posting || !noteInput.trim()}
                      className="px-3 py-2 text-sm font-bold rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
                    >
                      등록
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={shipmentInput}
                      onChange={e => setShipmentInput(e.target.value)}
                      placeholder="운송장 번호 + 택배사 (예: 한진 123456789)"
                      className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400"
                    />
                    <button
                      onClick={() => postEvent('shipment', shipmentInput)}
                      disabled={posting || !shipmentInput.trim()}
                      className="px-3 py-2 text-sm font-bold rounded-lg bg-sky-600 hover:bg-sky-700 text-white disabled:opacity-50"
                    >
                      등록
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={delayInput}
                      onChange={e => setDelayInput(e.target.value)}
                      placeholder="지연 사유 (예: 소재 수급 지연 +3일 예상)"
                      className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400"
                    />
                    <button
                      onClick={() => postEvent('delay', delayInput)}
                      disabled={posting || !delayInput.trim()}
                      className="px-3 py-2 text-sm font-bold rounded-lg bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-50"
                    >
                      알림
                    </button>
                  </div>
                </div>
              </section>

              {/* 타임라인 */}
              <section>
                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">타임라인</h3>
                {eventLoading ? (
                  <div className="text-center py-6 text-gray-400 text-xs">불러오는 중…</div>
                ) : events.length === 0 ? (
                  <div className="text-center py-6 text-gray-400 text-xs">아직 이벤트가 없습니다.</div>
                ) : (
                  <ol className="space-y-3">
                    {events.map(ev => (
                      <li key={ev.id} className="flex gap-3 text-sm">
                        <div className="w-6 shrink-0 text-center pt-0.5">
                          {ev.kind === 'status_change' && '🔄'}
                          {ev.kind === 'note' && '📝'}
                          {ev.kind === 'photo' && '📷'}
                          {ev.kind === 'shipment' && '🚚'}
                          {ev.kind === 'delay' && '⚠️'}
                        </div>
                        <div className="flex-1">
                          {ev.kind === 'status_change' ? (
                            <div className="text-gray-700">
                              상태 변경: <span className="font-semibold">{STATUS_LABEL[(ev.fromStatus ?? 'placed') as OrderRow['status']]}</span>
                              {' → '}
                              <span className="font-semibold text-blue-700">{STATUS_LABEL[(ev.toStatus ?? 'placed') as OrderRow['status']]}</span>
                            </div>
                          ) : (
                            <div className="text-gray-800">{ev.body}</div>
                          )}
                          {ev.photoUrl && (
                            <a href={ev.photoUrl} target="_blank" rel="noreferrer" className="block mt-1">
                              <img src={ev.photoUrl} alt="" className="rounded-lg max-h-48 border border-gray-100" />
                            </a>
                          )}
                          <div className="text-[11px] text-gray-400 mt-1">{relTime(ev.createdAt)} · {ev.authorRole}</div>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
