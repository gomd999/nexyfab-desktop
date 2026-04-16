'use client';

import { useEffect, useState, use, useCallback, useRef } from 'react';
import type { NexyfabOrder } from '@/types/nexyfab-orders';

const STATUS_STEP_INDEX: Record<NexyfabOrder['status'], number> = {
  placed: 0,
  production: 1,
  qc: 2,
  shipped: 3,
  delivered: 4,
};

const STATUS_COLORS: Record<NexyfabOrder['status'], string> = {
  placed: '#388bfd',
  production: '#f0883e',
  qc: '#e3b341',
  shipped: '#79c0ff',
  delivered: '#3fb950',
};

const STATUS_LABEL: Record<NexyfabOrder['status'], { ko: string; en: string }> = {
  placed:     { ko: '주문 완료',  en: 'Order Placed' },
  production: { ko: '생산 중',    en: 'In Production' },
  qc:         { ko: '품질 검사',  en: 'QC Check' },
  shipped:    { ko: '배송 중',    en: 'Shipped' },
  delivered:  { ko: '배송 완료',  en: 'Delivered' },
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface Milestone {
  id: string; contractId: string; title: string; description: string | null;
  status: string; dueDate: string | null; completedAt: string | null; sortOrder: number;
}

interface QcItem {
  id: string; title: string; criteria: string | null; status: string;
  inspector_note: string | null; checked_by: string | null; checked_at: number | null;
}

interface Shipment {
  id: string; carrier: string; trackingNumber: string; label: string | null;
  status: string; lastStatusText: string | null;
  events: { datetime: string; location: string; description: string }[];
  estimatedDelivery: string | null; deliveredAt: string | null;
}

// ─── OrderDetailDrawer ────────────────────────────────────────────────────────

type DrawerTab = 'milestones' | 'qc' | 'shipment' | 'review';

function OrderDetailDrawer({
  order, isKo, onClose, onReorder,
}: {
  order: NexyfabOrder;
  isKo: boolean;
  onClose: () => void;
  onReorder: (orderId: string) => void;
}) {
  const [tab, setTab] = useState<DrawerTab>('milestones');
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [qcItems, setQcItems] = useState<QcItem[]>([]);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [reviewData, setReviewData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  // Milestone add form
  const [newMsTitle, setNewMsTitle] = useState('');
  const [addingMs, setAddingMs] = useState(false);

  // Shipment add form
  const [newTracking, setNewTracking] = useState('');
  const [newTrackingLabel, setNewTrackingLabel] = useState('');
  const [addingShipment, setAddingShipment] = useState(false);

  // Review form
  const [rating, setRating] = useState(5);
  const [ratingDeadline, setRatingDeadline] = useState(5);
  const [ratingQuality, setRatingQuality] = useState(5);
  const [ratingComm, setRatingComm] = useState(5);
  const [comment, setComment] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);
  const [reviewMsg, setReviewMsg] = useState('');

  // Use contract_id from order if available, else use order.id
  const contractId = (order as any).contractId ?? order.id;

  const fetchTab = useCallback(async (t: DrawerTab) => {
    setLoading(true);
    try {
      if (t === 'milestones') {
        const r = await fetch(`/api/contracts/${contractId}/milestones`);
        const d = await r.json();
        setMilestones(d.milestones ?? []);
      } else if (t === 'qc') {
        const r = await fetch(`/api/contracts/${contractId}/qc`);
        const d = await r.json();
        setQcItems(d.items ?? []);
      } else if (t === 'shipment') {
        const r = await fetch(`/api/contracts/${contractId}/shipments`);
        const d = await r.json();
        setShipments(d.shipments ?? []);
      } else if (t === 'review') {
        const r = await fetch(`/api/reviews?contractId=${contractId}`);
        const d = await r.json();
        setReviewData(d.review ?? null);
      }
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, [contractId]);

  useEffect(() => { fetchTab(tab); }, [tab, fetchTab]);

  const addMilestone = async () => {
    if (!newMsTitle.trim()) return;
    setAddingMs(true);
    try {
      await fetch(`/api/contracts/${contractId}/milestones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newMsTitle.trim() }),
      });
      setNewMsTitle('');
      await fetchTab('milestones');
    } finally { setAddingMs(false); }
  };

  const toggleMilestone = async (ms: Milestone) => {
    const next = ms.status === 'completed' ? 'pending' : 'completed';
    await fetch(`/api/contracts/${contractId}/milestones`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ milestoneId: ms.id, status: next }),
    });
    await fetchTab('milestones');
  };

  const addShipment = async () => {
    if (!newTracking.trim()) return;
    setAddingShipment(true);
    try {
      await fetch(`/api/contracts/${contractId}/shipments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackingNumber: newTracking.trim(), label: newTrackingLabel.trim() || undefined }),
      });
      setNewTracking(''); setNewTrackingLabel('');
      await fetchTab('shipment');
    } finally { setAddingShipment(false); }
  };

  const refreshShipment = async (shipmentId: string) => {
    await fetch(`/api/contracts/${contractId}/shipments`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shipmentId }),
    });
    await fetchTab('shipment');
  };

  const submitReview = async () => {
    setSubmittingReview(true);
    setReviewMsg('');
    try {
      const r = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contractId,
          partnerEmail: (order as any).partnerEmail ?? '',
          rating, categories: { deadline: ratingDeadline, quality: ratingQuality, communication: ratingComm },
          comment,
        }),
      });
      const d = await r.json();
      if (r.ok) { setReviewMsg(isKo ? '리뷰가 등록되었습니다.' : 'Review submitted.'); setReviewData(d.review); }
      else setReviewMsg(d.error ?? (isKo ? '오류가 발생했습니다.' : 'Error occurred.'));
    } finally { setSubmittingReview(false); }
  };

  const S = { // inline style shortcuts
    panel: { flex: 1, overflow: 'auto', padding: '16px 20px' } as React.CSSProperties,
    tabBtn: (active: boolean): React.CSSProperties => ({
      padding: '6px 14px', fontSize: 12, fontWeight: 600, borderRadius: 6, cursor: 'pointer',
      border: 'none', background: active ? '#388bfd' : 'transparent',
      color: active ? '#fff' : '#6e7681',
    }),
    inputRow: { display: 'flex', gap: 8, marginTop: 12 } as React.CSSProperties,
    input: {
      flex: 1, background: '#0d1117', border: '1px solid #30363d', borderRadius: 6,
      padding: '7px 10px', color: '#e6edf3', fontSize: 12,
    } as React.CSSProperties,
    btn: (color: string): React.CSSProperties => ({
      padding: '7px 14px', borderRadius: 6, fontSize: 12, fontWeight: 700,
      border: 'none', cursor: 'pointer', background: color, color: '#fff',
    }),
    msRow: (done: boolean): React.CSSProperties => ({
      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0',
      borderBottom: '1px solid #21262d', opacity: done ? 0.6 : 1,
    }),
    statusBadge: (color: string): React.CSSProperties => ({
      fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 8,
      background: color + '22', color,
    }),
  };

  const SHIP_STATUS_COLOR: Record<string, string> = {
    delivered: '#3fb950', in_transit: '#388bfd', out_for_delivery: '#e3b341',
    exception: '#f85149', pending: '#6e7681',
  };

  const tabs: { id: DrawerTab; label: string }[] = [
    { id: 'milestones', label: isKo ? '마일스톤' : 'Milestones' },
    { id: 'qc', label: isKo ? 'QC 체크리스트' : 'QC Checklist' },
    { id: 'shipment', label: isKo ? '배송 추적' : 'Shipment' },
    { id: 'review', label: isKo ? '리뷰 작성' : 'Review' },
  ];

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 50,
      display: 'flex', alignItems: 'stretch',
    }}>
      {/* Backdrop */}
      <div onClick={onClose} style={{ flex: 1, background: '#00000066' }} />

      {/* Drawer */}
      <div style={{
        width: 420, background: '#161b22', borderLeft: '1px solid #30363d',
        display: 'flex', flexDirection: 'column', color: '#e6edf3',
        fontFamily: 'system-ui, sans-serif',
      }}>
        {/* Header */}
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #21262d', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: '#6e7681' }}>{order.id}</div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{order.partName}</div>
          </div>
          <button
            onClick={() => onReorder(order.id)}
            style={{ ...S.btn('#388bfd22'), color: '#388bfd', border: '1px solid #388bfd55', marginRight: 4 }}
          >
            {isKo ? '재발주' : 'Reorder'}
          </button>
          <a
            href={`/api/contracts/${contractId}/pdf`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ ...S.btn('#21262d'), color: '#8b949e', textDecoration: 'none', border: '1px solid #30363d' }}
          >
            PDF
          </a>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#6e7681', cursor: 'pointer', fontSize: 18, padding: 4 }}>✕</button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, padding: '10px 16px', borderBottom: '1px solid #21262d', background: '#0d1117' }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={S.tabBtn(tab === t.id)}>{t.label}</button>
          ))}
        </div>

        {/* Content */}
        <div style={S.panel}>
          {loading && <div style={{ color: '#6e7681', textAlign: 'center', padding: '40px 0', fontSize: 13 }}>
            {isKo ? '불러오는 중...' : 'Loading...'}
          </div>}

          {/* ── MILESTONES ── */}
          {!loading && tab === 'milestones' && (
            <div>
              <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 12 }}>
                {isKo ? `${milestones.filter(m => m.status === 'completed').length} / ${milestones.length} 완료` : `${milestones.filter(m => m.status === 'completed').length} / ${milestones.length} done`}
              </div>
              {milestones.length === 0 && (
                <div style={{ color: '#484f58', fontSize: 12, padding: '20px 0' }}>{isKo ? '마일스톤이 없습니다.' : 'No milestones yet.'}</div>
              )}
              {milestones.map(ms => (
                <div key={ms.id} style={S.msRow(ms.status === 'completed')}>
                  <button onClick={() => toggleMilestone(ms)} style={{
                    width: 20, height: 20, borderRadius: 4, border: '2px solid',
                    borderColor: ms.status === 'completed' ? '#3fb950' : '#30363d',
                    background: ms.status === 'completed' ? '#3fb950' : 'transparent',
                    color: '#fff', fontSize: 11, cursor: 'pointer', flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {ms.status === 'completed' ? '✓' : ''}
                  </button>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, textDecoration: ms.status === 'completed' ? 'line-through' : 'none' }}>
                      {ms.title}
                    </div>
                    {ms.dueDate && <div style={{ fontSize: 10, color: '#6e7681' }}>{isKo ? '기한: ' : 'Due: '}{ms.dueDate}</div>}
                  </div>
                  <span style={S.statusBadge(ms.status === 'completed' ? '#3fb950' : '#6e7681')}>
                    {ms.status === 'completed' ? (isKo ? '완료' : 'Done') : (isKo ? '대기' : 'Pending')}
                  </span>
                </div>
              ))}
              <div style={S.inputRow}>
                <input value={newMsTitle} onChange={e => setNewMsTitle(e.target.value)}
                  placeholder={isKo ? '마일스톤 제목...' : 'Milestone title...'}
                  style={S.input}
                  onKeyDown={e => e.key === 'Enter' && addMilestone()}
                />
                <button onClick={addMilestone} disabled={addingMs || !newMsTitle.trim()}
                  style={{ ...S.btn('#388bfd'), opacity: addingMs || !newMsTitle.trim() ? 0.5 : 1 }}>
                  {isKo ? '추가' : 'Add'}
                </button>
              </div>
            </div>
          )}

          {/* ── QC CHECKLIST ── */}
          {!loading && tab === 'qc' && (
            <div>
              {qcItems.length === 0 && (
                <div style={{ color: '#484f58', fontSize: 12, padding: '20px 0' }}>{isKo ? 'QC 항목이 없습니다.' : 'No QC items.'}</div>
              )}
              {qcItems.map(item => (
                <div key={item.id} style={{ padding: '10px 0', borderBottom: '1px solid #21262d' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={S.statusBadge(
                      item.status === 'passed' ? '#3fb950' : item.status === 'failed' ? '#f85149' : '#6e7681',
                    )}>
                      {item.status === 'passed' ? (isKo ? '통과' : 'Pass') : item.status === 'failed' ? (isKo ? '실패' : 'Fail') : (isKo ? '대기' : 'Pending')}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{item.title}</span>
                  </div>
                  {item.criteria && <div style={{ fontSize: 11, color: '#6e7681', marginTop: 3 }}>{item.criteria}</div>}
                  {item.inspector_note && <div style={{ fontSize: 11, color: '#8b949e', marginTop: 3 }}>📝 {item.inspector_note}</div>}
                  {item.checked_by && (
                    <div style={{ fontSize: 10, color: '#484f58', marginTop: 2 }}>
                      {isKo ? '검사: ' : 'Inspector: '}{item.checked_by}
                    </div>
                  )}
                </div>
              ))}
              {qcItems.length > 0 && (
                <div style={{ marginTop: 12, padding: '10px 14px', background: '#0d1117', borderRadius: 8, fontSize: 12 }}>
                  <span style={{ color: '#3fb950', fontWeight: 700 }}>
                    {isKo ? '통과 ' : 'Pass '}{qcItems.filter(i => i.status === 'passed').length}
                  </span>
                  <span style={{ color: '#6e7681', margin: '0 6px' }}>/</span>
                  <span style={{ color: '#f85149', fontWeight: 700 }}>
                    {isKo ? '실패 ' : 'Fail '}{qcItems.filter(i => i.status === 'failed').length}
                  </span>
                  <span style={{ color: '#6e7681', margin: '0 6px' }}>/</span>
                  <span style={{ color: '#6e7681' }}>
                    {isKo ? '대기 ' : 'Pending '}{qcItems.filter(i => i.status === 'pending').length}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* ── SHIPMENT ── */}
          {!loading && tab === 'shipment' && (
            <div>
              {shipments.map(shp => (
                <div key={shp.id} style={{ marginBottom: 16, padding: '12px 14px', background: '#0d1117', borderRadius: 8, border: '1px solid #21262d' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <span style={S.statusBadge(SHIP_STATUS_COLOR[shp.status] ?? '#6e7681')}>
                      {shp.status.replace(/_/g, ' ')}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#e6edf3' }}>{shp.carrier.toUpperCase()}</span>
                    <span style={{ fontSize: 11, color: '#6e7681', flex: 1, textAlign: 'right' }}>{shp.trackingNumber}</span>
                    <button onClick={() => refreshShipment(shp.id)} style={{ ...S.btn('#21262d'), fontSize: 10, padding: '3px 8px' }}>↺</button>
                  </div>
                  {shp.lastStatusText && <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 6 }}>{shp.lastStatusText}</div>}
                  {shp.estimatedDelivery && (
                    <div style={{ fontSize: 11, color: '#6e7681', marginBottom: 6 }}>
                      {isKo ? '예상 도착: ' : 'Est. delivery: '}{shp.estimatedDelivery}
                    </div>
                  )}
                  {shp.events.length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      {shp.events.slice(0, 4).map((ev, i) => (
                        <div key={i} style={{ display: 'flex', gap: 8, fontSize: 10, color: '#6e7681', padding: '3px 0', borderBottom: '1px solid #21262d' }}>
                          <span style={{ minWidth: 110, color: '#484f58' }}>{ev.datetime}</span>
                          <span style={{ color: '#8b949e' }}>{ev.location}</span>
                          <span style={{ flex: 1, color: '#e6edf3' }}>{ev.description}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}

              {/* Add tracking */}
              <div style={{ marginTop: 8, padding: '12px', background: '#0d1117', borderRadius: 8, border: '1px solid #21262d' }}>
                <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 8, fontWeight: 600 }}>
                  {isKo ? '배송번호 등록' : 'Add Tracking'}
                </div>
                <input value={newTracking} onChange={e => setNewTracking(e.target.value)}
                  placeholder={isKo ? '운송장 번호' : 'Tracking number'}
                  style={{ ...S.input, marginBottom: 6, display: 'block', width: '100%', boxSizing: 'border-box' }} />
                <input value={newTrackingLabel} onChange={e => setNewTrackingLabel(e.target.value)}
                  placeholder={isKo ? '메모 (선택)' : 'Label (optional)'}
                  style={{ ...S.input, marginBottom: 8, display: 'block', width: '100%', boxSizing: 'border-box' }} />
                <button onClick={addShipment} disabled={addingShipment || !newTracking.trim()}
                  style={{ ...S.btn('#388bfd'), opacity: addingShipment || !newTracking.trim() ? 0.5 : 1, width: '100%' }}>
                  {isKo ? '등록' : 'Register'}
                </button>
              </div>
            </div>
          )}

          {/* ── REVIEW ── */}
          {!loading && tab === 'review' && (
            <div>
              {reviewData ? (
                <div style={{ padding: '14px', background: '#0d1117', borderRadius: 8, border: '1px solid #21262d' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: '#e3b341' }}>
                    {'★'.repeat(reviewData.rating)}{'☆'.repeat(5 - reviewData.rating)} {reviewData.rating}/5
                  </div>
                  <div style={{ display: 'flex', gap: 12, marginBottom: 10, fontSize: 11, color: '#6e7681' }}>
                    <span>{isKo ? '납기: ' : 'Deadline: '}{reviewData.categories?.deadline}/5</span>
                    <span>{isKo ? '품질: ' : 'Quality: '}{reviewData.categories?.quality}/5</span>
                    <span>{isKo ? '소통: ' : 'Comm.: '}{reviewData.categories?.communication}/5</span>
                  </div>
                  {reviewData.comment && <p style={{ fontSize: 13, color: '#e6edf3', margin: 0 }}>{reviewData.comment}</p>}
                  <div style={{ fontSize: 10, color: '#484f58', marginTop: 8 }}>{reviewData.reviewedAt?.slice(0, 10)}</div>
                </div>
              ) : order.status === 'delivered' ? (
                <div>
                  <div style={{ fontSize: 13, color: '#8b949e', marginBottom: 16 }}>
                    {isKo ? '이 주문에 대한 파트너 평가를 남겨주세요.' : 'Leave a review for this order.'}
                  </div>

                  {/* Overall */}
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 11, color: '#6e7681', marginBottom: 6 }}>{isKo ? '종합 평점' : 'Overall'}</div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {[1,2,3,4,5].map(n => (
                        <button key={n} onClick={() => setRating(n)}
                          style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: n <= rating ? '#e3b341' : '#30363d' }}>
                          ★
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Category ratings */}
                  {[
                    { label: isKo ? '납기 준수' : 'On-time delivery', val: ratingDeadline, set: setRatingDeadline },
                    { label: isKo ? '품질' : 'Quality', val: ratingQuality, set: setRatingQuality },
                    { label: isKo ? '소통' : 'Communication', val: ratingComm, set: setRatingComm },
                  ].map(c => (
                    <div key={c.label} style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 11, color: '#6e7681', marginBottom: 4 }}>{c.label}</div>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {[1,2,3,4,5].map(n => (
                          <button key={n} onClick={() => c.set(n)}
                            style={{ background: 'none', border: 'none', fontSize: 16, cursor: 'pointer', color: n <= c.val ? '#e3b341' : '#30363d' }}>
                            ★
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}

                  {/* Comment */}
                  <textarea value={comment} onChange={e => setComment(e.target.value)}
                    placeholder={isKo ? '자세한 후기를 남겨주세요 (선택)' : 'Leave a detailed review (optional)'}
                    rows={3} style={{
                      ...S.input, display: 'block', width: '100%', boxSizing: 'border-box',
                      resize: 'none', marginBottom: 10,
                    }} />

                  {reviewMsg && (
                    <div style={{ fontSize: 12, color: reviewMsg.includes('등록') || reviewMsg.includes('submitted') ? '#3fb950' : '#f85149', marginBottom: 8 }}>
                      {reviewMsg}
                    </div>
                  )}

                  <button onClick={submitReview} disabled={submittingReview}
                    style={{ ...S.btn('#388bfd'), width: '100%', opacity: submittingReview ? 0.6 : 1 }}>
                    {submittingReview ? (isKo ? '제출 중...' : 'Submitting...') : (isKo ? '리뷰 제출' : 'Submit Review')}
                  </button>
                </div>
              ) : (
                <div style={{ color: '#484f58', fontSize: 12, padding: '20px 0' }}>
                  {isKo ? '배송 완료 후 리뷰를 작성할 수 있습니다.' : 'You can review after delivery is complete.'}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function OrdersPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = use(params);
  const isKo = lang === 'ko';

  const [orders, setOrders] = useState<NexyfabOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<NexyfabOrder | null>(null);
  const [reorderMsg, setReorderMsg] = useState('');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadOrders = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const r = await fetch('/api/nexyfab/orders');
      const data = await r.json();
      setOrders(data.orders ?? []);
      setLastUpdated(new Date());
      setError(null);
    } catch {
      if (!silent) setError(isKo ? '불러오기 실패' : 'Failed to load orders');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [isKo]);

  useEffect(() => {
    loadOrders();
    intervalRef.current = setInterval(() => loadOrders(true), 30_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [loadOrders]);

  const handleReorder = useCallback(async (orderId: string) => {
    const order = orders.find(o => o.id === orderId);
    const rfqId = (order as any)?.rfqId;
    if (!rfqId) {
      setReorderMsg(isKo ? 'RFQ ID를 찾을 수 없습니다.' : 'RFQ ID not found.');
      return;
    }
    try {
      const r = await fetch('/api/nexyfab/rfq/repeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rfqId }),
      });
      const d = await r.json();
      if (r.ok) {
        setReorderMsg(isKo ? `재발주 완료! RFQ ID: ${d.rfq?.id ?? ''}` : `Reorder created: ${d.rfq?.id ?? ''}`);
        setSelectedOrder(null);
      } else {
        setReorderMsg(d.error ?? (isKo ? '재발주 실패' : 'Reorder failed'));
      }
    } catch {
      setReorderMsg(isKo ? '오류가 발생했습니다.' : 'Error occurred.');
    }
  }, [orders, isKo]);

  return (
    <div style={{
      minHeight: '100vh', background: '#0d1117',
      fontFamily: 'system-ui, -apple-system, sans-serif', color: '#e6edf3',
    }}>
      {/* Header */}
      <div style={{
        borderBottom: '1px solid #21262d', padding: '16px 32px',
        display: 'flex', alignItems: 'center', gap: 16,
        position: 'sticky', top: 0, background: '#0d1117', zIndex: 10,
      }}>
        <a href={`/${lang}/shape-generator`} style={{
          fontSize: 18, fontWeight: 800, color: '#e6edf3', textDecoration: 'none',
        }}>
          <span style={{ color: '#8b9cf4' }}>Nexy</span>Fab
        </a>
        <span style={{ color: '#30363d' }}>|</span>
        <span style={{ fontSize: 14, color: '#6e7681' }}>
          {isKo ? '주문 추적' : 'Order Tracking'}
        </span>
        <div style={{ flex: 1 }} />
        {lastUpdated && (
          <span style={{ fontSize: 11, color: '#484f58' }}>
            {isKo ? '최근 갱신: ' : 'Updated: '}
            {lastUpdated.toLocaleTimeString(isKo ? 'ko-KR' : 'en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
        )}
        <button
          onClick={() => loadOrders(true)}
          disabled={refreshing}
          style={{
            padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
            border: '1px solid #30363d', background: 'transparent',
            color: refreshing ? '#484f58' : '#8b949e',
            transition: 'color 0.12s, border-color 0.12s',
          }}
        >
          {refreshing ? '↻' : '↺'} {isKo ? '새로고침' : 'Refresh'}
        </button>
        <a href={`/${lang}/nexyfab/marketplace`} style={{
          fontSize: 12, color: '#388bfd', textDecoration: 'none',
          padding: '5px 12px', borderRadius: 6, border: '1px solid #388bfd33',
          background: '#388bfd11',
        }}>
          {isKo ? '제조사 마켓' : 'Marketplace'}
        </a>
      </div>

      <div style={{ maxWidth: 800, margin: '0 auto', padding: '32px 24px' }}>
        {/* Breadcrumb */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#6e7681', marginBottom: 20 }}>
          <a href={`/${lang}/nexyfab`} style={{ color: '#6e7681', textDecoration: 'none' }}
            onMouseEnter={e => (e.currentTarget.style.color = '#388bfd')}
            onMouseLeave={e => (e.currentTarget.style.color = '#6e7681')}>
            {isKo ? '대시보드' : 'Dashboard'}
          </a>
          <span style={{ color: '#30363d' }}>/</span>
          <span style={{ color: '#8b949e' }}>{isKo ? '주문 추적' : 'Order Tracking'}</span>
        </div>

        <h1 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 800 }}>
          {isKo ? '주문 추적' : 'Order Tracking'}
        </h1>
        <p style={{ margin: '0 0 32px', fontSize: 13, color: '#6e7681' }}>
          {isKo ? '실시간 제조 진행 현황을 확인하세요' : 'Track your manufacturing orders in real time'}
        </p>

        {reorderMsg && (
          <div style={{
            background: '#388bfd22', border: '1px solid #388bfd55',
            borderRadius: 8, padding: '10px 16px', color: '#388bfd', fontSize: 13, marginBottom: 20,
          }}>
            {reorderMsg}
            <button onClick={() => setReorderMsg('')} style={{ background: 'none', border: 'none', color: '#388bfd', cursor: 'pointer', marginLeft: 8 }}>✕</button>
          </div>
        )}

        {loading && (
          <div style={{ textAlign: 'center', padding: '80px 0', color: '#6e7681' }}>
            {isKo ? '불러오는 중...' : 'Loading...'}
          </div>
        )}

        {error && (
          <div style={{
            background: '#da363322', border: '1px solid #da363355',
            borderRadius: 8, padding: '14px 16px', color: '#f85149', fontSize: 13,
          }}>
            {error}
          </div>
        )}

        {!loading && !error && orders.length === 0 && (
          <div style={{ textAlign: 'center', padding: '80px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>📦</div>
            <p style={{ color: '#6e7681' }}>
              {isKo ? '아직 주문 내역이 없습니다.' : 'No orders yet.'}
            </p>
            <a href={`/${lang}/nexyfab/marketplace`} style={{
              display: 'inline-block', marginTop: 12, padding: '9px 22px',
              borderRadius: 8, background: '#388bfd', color: '#fff',
              fontSize: 13, fontWeight: 700, textDecoration: 'none',
            }}>
              {isKo ? '제조사 찾기' : 'Find Manufacturers'}
            </a>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {orders.map(order => (
            <OrderCard
              key={order.id}
              order={order}
              isKo={isKo}
              onClick={() => setSelectedOrder(order)}
            />
          ))}
        </div>
      </div>

      {/* Detail Drawer */}
      {selectedOrder && (
        <OrderDetailDrawer
          order={selectedOrder}
          isKo={isKo}
          onClose={() => setSelectedOrder(null)}
          onReorder={handleReorder}
        />
      )}
    </div>
  );
}

// ─── OrderCard ────────────────────────────────────────────────────────────────

function OrderCard({ order, isKo, onClick }: { order: NexyfabOrder; isKo: boolean; onClick: () => void }) {
  const currentStep = STATUS_STEP_INDEX[order.status];
  const totalSteps = order.steps.length;
  const progressPct = Math.round((currentStep / (totalSteps - 1)) * 100);
  const statusColor = STATUS_COLORS[order.status];
  const statusLabel = STATUS_LABEL[order.status][isKo ? 'ko' : 'en'];

  function fmtDate(ts?: number) {
    if (!ts) return '—';
    return new Date(ts).toLocaleDateString(isKo ? 'ko-KR' : 'en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    });
  }

  function fmtKRW(n: number) {
    return n.toLocaleString('ko-KR') + '원';
  }

  return (
    <div
      onClick={onClick}
      style={{
        background: '#161b22', border: '1px solid #30363d',
        borderRadius: 12, overflow: 'hidden', cursor: 'pointer',
        transition: 'border-color 0.15s',
      }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = '#388bfd55')}
      onMouseLeave={e => (e.currentTarget.style.borderColor = '#30363d')}
    >
      {/* Card header */}
      <div style={{
        padding: '14px 20px', borderBottom: '1px solid #21262d',
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      }}>
        <div>
          <p style={{ margin: 0, fontSize: 11, color: '#6e7681' }}>{order.id}</p>
          <p style={{ margin: '2px 0 0', fontSize: 15, fontWeight: 700, color: '#e6edf3' }}>
            {order.partName}
          </p>
        </div>
        <div style={{ flex: 1 }} />
        {/* Click hint */}
        <span style={{ fontSize: 10, color: '#484f58' }}>
          {isKo ? '상세 보기 →' : 'Details →'}
        </span>
        {/* Status badge */}
        <span style={{
          fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 10,
          background: statusColor + '22', color: statusColor,
        }}>
          {statusLabel}
        </span>
      </div>

      {/* Meta row */}
      <div style={{
        padding: '12px 20px', borderBottom: '1px solid #21262d',
        display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 12,
      }}>
        <MetaItem label={isKo ? '제조사' : 'Manufacturer'} value={order.manufacturerName} />
        <MetaItem label={isKo ? '수량' : 'Quantity'} value={`${order.quantity.toLocaleString()}개`} />
        <MetaItem label={isKo ? '총 금액' : 'Total'} value={fmtKRW(order.totalPriceKRW)} />
        <MetaItem label={isKo ? '주문일' : 'Ordered'} value={fmtDate(order.createdAt)} />
        <MetaItem
          label={isKo ? '예상 배송' : 'Est. Delivery'}
          value={fmtDate(order.estimatedDeliveryAt)}
          highlight
        />
      </div>

      {/* Progress bar */}
      <div style={{ padding: '16px 20px 8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 11, color: '#8b949e' }}>
            {isKo ? '진행률' : 'Progress'}
          </span>
          <span style={{ fontSize: 11, fontWeight: 700, color: statusColor }}>
            {progressPct}%
          </span>
        </div>
        <div style={{ height: 5, background: '#21262d', borderRadius: 3, overflow: 'hidden', marginBottom: 20 }}>
          <div style={{
            height: '100%', width: `${progressPct}%`,
            background: `linear-gradient(90deg, #388bfd, ${statusColor})`,
            borderRadius: 3, transition: 'width 0.4s',
          }} />
        </div>

        {/* Step indicators */}
        <div style={{ display: 'flex', alignItems: 'flex-start', position: 'relative' }}>
          <div style={{
            position: 'absolute', top: 12, left: '10%', right: '10%',
            height: 2, background: '#21262d', borderRadius: 1, zIndex: 0,
          }} />
          <div style={{
            position: 'absolute', top: 12, left: '10%',
            width: `${progressPct * 0.8}%`,
            height: 2, background: statusColor, borderRadius: 1, zIndex: 1,
            transition: 'width 0.4s',
          }} />

          {order.steps.map((step, i) => {
            const done = i <= currentStep;
            const active = i === currentStep;
            const ts = step.completedAt ?? step.estimatedAt;
            return (
              <div
                key={i}
                style={{
                  flex: 1, display: 'flex', flexDirection: 'column',
                  alignItems: 'center', gap: 6, position: 'relative', zIndex: 2,
                }}
              >
                <div style={{
                  width: 24, height: 24, borderRadius: '50%',
                  background: done ? statusColor : '#21262d',
                  border: `2px solid ${active ? statusColor : done ? statusColor : '#30363d'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 700, color: done ? '#0d1117' : '#6e7681',
                  boxShadow: active ? `0 0 0 3px ${statusColor}44` : undefined,
                  transition: 'background 0.3s, box-shadow 0.3s',
                }}>
                  {done ? '✓' : String(i + 1)}
                </div>
                <span style={{
                  fontSize: 9, fontWeight: active ? 700 : 400,
                  color: active ? statusColor : done ? '#8b949e' : '#6e7681',
                  textAlign: 'center', lineHeight: 1.3,
                  whiteSpace: 'nowrap',
                }}>
                  {isKo ? step.labelKo : step.label}
                </span>
                {ts && (
                  <span style={{ fontSize: 8, color: '#6e7681', textAlign: 'center' }}>
                    {step.completedAt
                      ? (isKo ? '완료 ' : 'Done ') + fmtDate(ts)
                      : (isKo ? '예정 ' : 'Est. ') + fmtDate(ts)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ height: 12 }} />
    </div>
  );
}

function MetaItem({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <p style={{ margin: 0, fontSize: 10, color: '#6e7681' }}>{label}</p>
      <p style={{ margin: '2px 0 0', fontWeight: 600, color: highlight ? '#3fb950' : '#e6edf3' }}>
        {value}
      </p>
    </div>
  );
}
