'use client';

import { useEffect, useState, use, useCallback, useMemo, useRef, Suspense } from 'react';
import type { NexyfabOrder, NexyfabOrderStatus } from '@/types/nexyfab-orders';
import { useAuthStore } from '@/hooks/useAuth';
import AuthModal from '@/components/nexyfab/AuthModal';
import NexyfabNav from '@/components/nexyfab/NexyfabNav';
import OrderTimeline from './OrderTimeline';
import { formatDate, formatDday } from '@/lib/formatDate';
import { isKorean } from '@/lib/i18n/normalize';

/** Toss v1 CDN (`js.tosspayments.com/v1/payment`) — avoid augmenting global `Window` (billing CheckoutModal uses Toss v2). */
type TossPaymentsV1 = (clientKey: string) => {
  requestPayment: (method: string, opts: Record<string, unknown>) => Promise<void>;
};

function getTossPaymentsV1(): TossPaymentsV1 | undefined {
  return typeof window !== 'undefined'
    ? (window as unknown as { TossPayments?: TossPaymentsV1 }).TossPayments
    : undefined;
}

// ─── Status helpers ───────────────────────────────────────────────────────────

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

// ─── Demo data ────────────────────────────────────────────────────────────────

const DEMO_STEPS = [
  { label: 'Placed',     labelKo: '주문 완료',  completedAt: Date.now() - 14 * 86400000 },
  { label: 'Production', labelKo: '생산 중',    estimatedAt: Date.now() - 5 * 86400000 },
  { label: 'QC',         labelKo: '품질 검사',  estimatedAt: Date.now() + 3 * 86400000 },
  { label: 'Shipped',    labelKo: '배송 중',    estimatedAt: Date.now() + 7 * 86400000 },
  { label: 'Delivered',  labelKo: '납품 완료',  estimatedAt: Date.now() + 12 * 86400000 },
];

const DEMO_ORDERS: NexyfabOrder[] = [
  {
    id: 'DEMO-001',
    rfqId: 'RFQ-DEMO-001',
    userId: 'demo',
    partName: '알루미늄 브라켓 A-100',
    manufacturerName: '대우정밀 주식회사',
    quantity: 500,
    totalPriceKRW: 4_500_000,
    totalPrice: 4_500_000,
    currency: 'KRW',
    status: 'production',
    steps: DEMO_STEPS,
    createdAt: Date.now() - 14 * 86400000,
    estimatedDeliveryAt: Date.now() + 12 * 86400000,
  },
  {
    id: 'DEMO-002',
    rfqId: 'RFQ-DEMO-002',
    userId: 'demo',
    partName: '스테인리스 플랜지 SUS304',
    manufacturerName: '한국정밀가공 협동조합',
    quantity: 200,
    totalPriceKRW: 2_800_000,
    totalPrice: 2_800_000,
    currency: 'KRW',
    status: 'qc',
    steps: DEMO_STEPS.map((s, i) => ({
      ...s,
      completedAt: i <= 2 ? Date.now() - (10 - i * 3) * 86400000 : undefined,
      estimatedAt: i > 2 ? Date.now() + i * 4 * 86400000 : undefined,
    })),
    createdAt: Date.now() - 22 * 86400000,
    estimatedDeliveryAt: Date.now() + 6 * 86400000,
  },
  {
    id: 'DEMO-003',
    rfqId: 'RFQ-DEMO-003',
    userId: 'demo',
    partName: 'CNC 선삭 축 φ25×300',
    manufacturerName: '삼성정밀 기계',
    quantity: 100,
    totalPriceKRW: 1_200_000,
    totalPrice: 1_200_000,
    currency: 'KRW',
    status: 'delivered',
    steps: DEMO_STEPS.map((s, i) => ({
      ...s,
      completedAt: Date.now() - (20 - i * 4) * 86400000,
      estimatedAt: undefined,
    })),
    createdAt: Date.now() - 35 * 86400000,
    estimatedDeliveryAt: Date.now() - 2 * 86400000,
  },
];

// ─── Toss Payment helper ──────────────────────────────────────────────────────

async function openTossPayment(opts: {
  orderId: string; token: string | null; lang: string;
  onSuccess: () => void; onError: (msg: string) => void;
}) {
  try {
    const res = await fetch(`/api/nexyfab/orders/${opts.orderId}/payment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
        'X-Requested-With': 'XMLHttpRequest',
      },
    });
    const data = await res.json() as { tossOrderId?: string; amount?: number; orderName?: string; clientKey?: string; error?: string };
    if (!res.ok || !data.tossOrderId) { opts.onError(data.error ?? '결제 정보 생성 실패'); return; }
    if (!data.clientKey) { opts.onError('NEXT_PUBLIC_TOSS_CLIENT_KEY 환경변수를 설정하세요.'); return; }

    const baseUrl = window.location.origin;
    const successUrl = `${baseUrl}/${opts.lang}/nexyfab/orders?payment=success&orderId=${opts.orderId}&tossOrderId=${data.tossOrderId}&amount=${data.amount}`;
    const failUrl    = `${baseUrl}/${opts.lang}/nexyfab/orders?payment=fail`;

    // Toss JS SDK 동적 로드
    await new Promise<void>((resolve, reject) => {
      if (getTossPaymentsV1()) { resolve(); return; }
      const s = document.createElement('script');
      s.src = 'https://js.tosspayments.com/v1/payment';
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Toss SDK 로드 실패'));
      document.head.appendChild(s);
    });

    const tossFn = getTossPaymentsV1();
    if (!tossFn) { opts.onError('Toss Payments SDK를 불러오지 못했습니다.'); return; }
    const toss = tossFn(data.clientKey);
    await toss.requestPayment('카드', {
      amount: data.amount,
      orderId: data.tossOrderId,
      orderName: data.orderName,
      successUrl,
      failUrl,
    });
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string };
    if (err?.code !== 'USER_CANCEL') opts.onError(err?.message ?? '결제 오류');
  }
}

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

interface ReviewData {
  rating: number;
  categories?: { deadline?: number; quality?: number; communication?: number };
  comment?: string;
  reviewedAt?: string;
}

// ─── Loading Skeleton ─────────────────────────────────────────────────────────

function OrderSkeleton() {
  return (
    <div style={{
      background: '#161b22', border: '1px solid #21262d',
      borderRadius: 12, overflow: 'hidden', marginBottom: 20,
    }}>
      <style precedence="default" href="orders-skeleton">{`
        @keyframes nf-shimmer {
          0%   { background-position: -600px 0; }
          100% { background-position: 600px 0; }
        }
        .nf-skel {
          background: linear-gradient(90deg, #21262d 25%, #30363d 50%, #21262d 75%);
          background-size: 600px 100%;
          animation: nf-shimmer 1.4s infinite linear;
          border-radius: 4px;
        }
      `}</style>
      {/* Header skeleton */}
      <div style={{ padding: '14px 20px', borderBottom: '1px solid #21262d', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div>
          <div className="nf-skel" style={{ height: 10, width: 120, marginBottom: 6 }} />
          <div className="nf-skel" style={{ height: 16, width: 200 }} />
        </div>
        <div style={{ flex: 1 }} />
        <div className="nf-skel" style={{ height: 22, width: 70, borderRadius: 10 }} />
      </div>
      {/* Meta skeleton */}
      <div style={{ padding: '12px 20px', borderBottom: '1px solid #21262d', display: 'flex', gap: 24 }}>
        {[100, 80, 110, 90, 100].map((w, i) => (
          <div key={i}>
            <div className="nf-skel" style={{ height: 9, width: w * 0.6, marginBottom: 5 }} />
            <div className="nf-skel" style={{ height: 13, width: w }} />
          </div>
        ))}
      </div>
      {/* Stepper skeleton */}
      <div style={{ padding: '20px 20px 28px', display: 'flex', justifyContent: 'space-between' }}>
        {[0,1,2,3,4].map(i => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <div className="nf-skel" style={{ width: 24, height: 24, borderRadius: '50%' }} />
            <div className="nf-skel" style={{ height: 8, width: 44 }} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── OrderDetailDrawer ────────────────────────────────────────────────────────

type DrawerTab = 'milestones' | 'qc' | 'shipment' | 'review' | 'timeline' | 'defects';

// ── 불량·RMA 상태 라벨 (Phase 7-5d) ─────────────────────────────────────────
type DefectStatus = 'reported' | 'under_review' | 'approved' | 'rejected' | 'resolved' | 'disputed';
type DefectSeverity = 'minor' | 'major' | 'critical';
type DefectKind = 'wrong_part' | 'damaged' | 'out_of_spec' | 'missing_quantity' | 'late_delivery' | 'other';

interface DefectSummary {
  id: string;
  orderId: string;
  reporterEmail: string;
  partnerEmail: string | null;
  status: DefectStatus;
  severity: DefectSeverity;
  kind: DefectKind;
  description: string;
  rmaNumber: string | null;
  rmaInstructions: string | null;
  partnerResponse: string | null;
  resolutionNote: string | null;
  createdAt: number;
}

const DEFECT_STATUS_COLOR: Record<DefectStatus, string> = {
  reported: '#e3b341',
  under_review: '#388bfd',
  approved: '#a371f7',
  rejected: '#484f58',
  resolved: '#3fb950',
  disputed: '#f85149',
};

function OrderDetailDrawer({
  order, isKo, token, onClose, onReorder,
}: {
  order: NexyfabOrder;
  isKo: boolean;
  token: string | null;
  onClose: () => void;
  onReorder: (orderId: string) => void;
}) {
  const [tab, setTab] = useState<DrawerTab>('milestones');
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [qcItems, setQcItems] = useState<QcItem[]>([]);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [reviewData, setReviewData] = useState<ReviewData | null>(null);
  const [defects, setDefects] = useState<DefectSummary[]>([]);
  const [loading, setLoading] = useState(false);

  const [newMsTitle, setNewMsTitle] = useState('');
  const [addingMs, setAddingMs] = useState(false);
  const [newTracking, setNewTracking] = useState('');
  const [newTrackingLabel, setNewTrackingLabel] = useState('');
  const [addingShipment, setAddingShipment] = useState(false);

  const [rating, setRating] = useState(5);
  const [ratingDeadline, setRatingDeadline] = useState(5);
  const [ratingQuality, setRatingQuality] = useState(5);
  const [ratingComm, setRatingComm] = useState(5);
  const [comment, setComment] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);
  const [reviewMsg, setReviewMsg] = useState('');
  const [drawerError, setDrawerError] = useState<string | null>(null);

  // 불량 제기 폼 상태 (Phase 7-5d)
  const [defectKind, setDefectKind] = useState<DefectKind>('out_of_spec');
  const [defectSeverity, setDefectSeverity] = useState<DefectSeverity>('major');
  const [defectDescription, setDefectDescription] = useState('');
  const [submittingDefect, setSubmittingDefect] = useState(false);
  const [defectMsg, setDefectMsg] = useState('');
  const [showDefectForm, setShowDefectForm] = useState(false);

  const isDemo = order.id.startsWith('DEMO-');
  const contractId = order.contractId ?? order.id;

  const authHeaders = useMemo(
    () => (token ? { Authorization: `Bearer ${token}` } : undefined),
    [token],
  );

  const fetchTab = useCallback(async (t: DrawerTab) => {
    if (isDemo) return;
    setLoading(true);
    setDrawerError(null);
    try {
      if (t === 'milestones') {
        const r = await fetch(`/api/contracts/${contractId}/milestones`, { headers: authHeaders });
        if (!r.ok) throw new Error('milestones');
        const d = await r.json() as { milestones?: Milestone[] };
        setMilestones(d.milestones ?? []);
      } else if (t === 'qc') {
        const r = await fetch(`/api/contracts/${contractId}/qc`, { headers: authHeaders });
        if (!r.ok) throw new Error('qc');
        const d = await r.json() as { items?: QcItem[] };
        setQcItems(d.items ?? []);
      } else if (t === 'shipment') {
        const r = await fetch(`/api/contracts/${contractId}/shipments`, { headers: authHeaders });
        if (!r.ok) throw new Error('shipments');
        const d = await r.json() as { shipments?: Shipment[] };
        setShipments(d.shipments ?? []);
      } else if (t === 'review') {
        const r = await fetch(`/api/reviews?contractId=${contractId}`, { headers: authHeaders });
        if (!r.ok) throw new Error('review');
        const d = await r.json() as { review?: ReviewData };
        setReviewData(d.review ?? null);
      } else if (t === 'defects') {
        const r = await fetch(`/api/nexyfab/orders/${order.id}/defects`, { headers: authHeaders });
        if (!r.ok) throw new Error('defects');
        const d = await r.json() as { defects?: DefectSummary[] };
        setDefects(d.defects ?? []);
      }
    } catch {
      setDrawerError('LOAD_FAILED');
    } finally {
      setLoading(false);
    }
  }, [contractId, isDemo, authHeaders, order.id]);

  useEffect(() => { fetchTab(tab); }, [tab, fetchTab]);

  const addMilestone = async () => {
    if (!newMsTitle.trim() || isDemo) return;
    setAddingMs(true);
    setDrawerError(null);
    try {
      const r = await fetch(`/api/contracts/${contractId}/milestones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ title: newMsTitle.trim() }),
      });
      if (!r.ok) throw new Error('add milestone');
      setNewMsTitle('');
      await fetchTab('milestones');
    } catch {
      setDrawerError('MS_ADD_FAILED');
    } finally { setAddingMs(false); }
  };

  const toggleMilestone = async (ms: Milestone) => {
    if (isDemo) return;
    setDrawerError(null);
    try {
      const next = ms.status === 'completed' ? 'pending' : 'completed';
      const r = await fetch(`/api/contracts/${contractId}/milestones`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ milestoneId: ms.id, status: next }),
      });
      if (!r.ok) throw new Error('toggle');
      await fetchTab('milestones');
    } catch {
      setDrawerError('MS_UPDATE_FAILED');
    }
  };

  const addShipment = async () => {
    if (!newTracking.trim() || isDemo) return;
    setAddingShipment(true);
    setDrawerError(null);
    try {
      const r = await fetch(`/api/contracts/${contractId}/shipments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ trackingNumber: newTracking.trim(), label: newTrackingLabel.trim() || undefined }),
      });
      if (!r.ok) throw new Error('add shipment');
      setNewTracking(''); setNewTrackingLabel('');
      await fetchTab('shipment');
    } catch {
      setDrawerError('SHIP_ADD_FAILED');
    } finally { setAddingShipment(false); }
  };

  const refreshShipment = async (shipmentId: string) => {
    if (isDemo) return;
    setDrawerError(null);
    try {
      const r = await fetch(`/api/contracts/${contractId}/shipments`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ shipmentId }),
      });
      if (!r.ok) throw new Error('refresh');
      await fetchTab('shipment');
    } catch {
      setDrawerError('SHIP_REFRESH_FAILED');
    }
  };

  const submitReview = async () => {
    if (isDemo) { setReviewMsg('REVIEW_DEMO'); return; }
    setSubmittingReview(true);
    setReviewMsg('');
    try {
      const r = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          contractId,
          partnerEmail: (order as NexyfabOrder & { partnerEmail?: string }).partnerEmail ?? order.manufacturerName,
          rating, categories: { deadline: ratingDeadline, quality: ratingQuality, communication: ratingComm },
          comment,
        }),
      });
      const d = await r.json() as { ok?: boolean; review?: ReviewData; error?: string };
      if (r.ok) { setReviewMsg('REVIEW_OK'); setReviewData(d.review ?? null); }
      else setReviewMsg(d.error ?? 'REVIEW_ERROR');
    } finally { setSubmittingReview(false); }
  };

  const submitDefect = async () => {
    if (isDemo) { setDefectMsg(isKo ? '데모 모드에서는 불량 제기를 할 수 없습니다.' : 'Cannot report defect in demo mode.'); return; }
    if (defectDescription.trim().length < 10) {
      setDefectMsg(isKo ? '설명을 10자 이상 입력해주세요.' : 'Description must be at least 10 characters.');
      return;
    }
    setSubmittingDefect(true);
    setDefectMsg('');
    try {
      const r = await fetch(`/api/nexyfab/orders/${order.id}/defects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          kind: defectKind,
          severity: defectSeverity,
          description: defectDescription.trim(),
        }),
      });
      const d = await r.json() as { defect?: DefectSummary; error?: string };
      if (r.ok && d.defect) {
        setDefects(prev => [d.defect!, ...prev]);
        setDefectDescription('');
        setShowDefectForm(false);
        setDefectMsg(isKo ? '불량이 접수되었습니다. 공급사 응답을 기다려주세요.' : 'Defect submitted. Awaiting supplier response.');
      } else {
        setDefectMsg(d.error ?? (isKo ? '제출 실패' : 'Submit failed'));
      }
    } finally { setSubmittingDefect(false); }
  };

  const transitionDefect = async (defectId: string, to: DefectStatus, extra?: Partial<Record<'partnerResponse' | 'resolutionNote' | 'rmaInstructions', string>>) => {
    setDrawerError(null);
    try {
      const r = await fetch(`/api/nexyfab/defects/${defectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ status: to, ...extra }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({})) as { error?: string };
        setDrawerError(d.error ?? 'DEFECT_TRANSITION_FAILED');
        return;
      }
      await fetchTab('defects');
    } catch {
      setDrawerError('DEFECT_TRANSITION_FAILED');
    }
  };

  const S = {
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

  const canReview = order.status === 'delivered' && !reviewData;
  const canReportDefect = order.status === 'delivered';
  const tabs: { id: DrawerTab; label: string }[] = [
    { id: 'timeline', label: isKo ? '진행 타임라인' : 'Timeline' },
    { id: 'milestones', label: isKo ? '마일스톤' : 'Milestones' },
    { id: 'qc', label: isKo ? 'QC 체크리스트' : 'QC Checklist' },
    { id: 'shipment', label: isKo ? '배송 추적' : 'Shipment' },
    { id: 'review', label: canReview ? (isKo ? '⭐ 리뷰 작성' : '⭐ Review') : (isKo ? '리뷰' : 'Review') },
    ...(canReportDefect
      ? [{ id: 'defects' as DrawerTab, label: isKo ? '⚠ 이슈·RMA' : '⚠ Issues·RMA' }]
      : []),
  ];

  // Demo milestone data
  const demoMilestones: Milestone[] = isDemo ? [
    { id: 'm1', contractId, title: '자재 발주 완료', description: null, status: 'completed', dueDate: null, completedAt: formatDate(order.createdAt + 86400000 * 2), sortOrder: 1 },
    { id: 'm2', contractId, title: '가공 1차 완료', description: null, status: 'completed', dueDate: null, completedAt: formatDate(order.createdAt + 86400000 * 7), sortOrder: 2 },
    { id: 'm3', contractId, title: '도장 및 표면처리', description: null, status: order.status === 'delivered' ? 'completed' : 'pending', dueDate: formatDate(order.estimatedDeliveryAt - 86400000 * 5), completedAt: null, sortOrder: 3 },
    { id: 'm4', contractId, title: '최종 검수 및 포장', description: null, status: order.status === 'delivered' ? 'completed' : 'pending', dueDate: formatDate(order.estimatedDeliveryAt - 86400000 * 2), completedAt: null, sortOrder: 4 },
  ] : [];

  const displayMilestones = isDemo ? demoMilestones : milestones;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 50,
      display: 'flex', alignItems: 'stretch',
    }}>
      {/* Backdrop */}
      <div onClick={onClose} style={{ flex: 1, background: '#00000066' }} />

      {/* Drawer */}
      <div style={{
        width: 'min(calc(100vw - 24px), 420px)', background: '#161b22', borderLeft: '1px solid #30363d',
        display: 'flex', flexDirection: 'column', color: '#e6edf3',
        fontFamily: 'system-ui, sans-serif',
      }}>
        {/* Header */}
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #21262d', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ fontSize: 11, color: '#6e7681' }}>{order.id}</div>
              {isDemo && (
                <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 6, background: '#e3b34122', color: '#e3b341' }}>
                  DEMO
                </span>
              )}
            </div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{order.partName}</div>
          </div>
          {!isDemo && (
            <button
              onClick={() => onReorder(order.id)}
              style={{ ...S.btn('#388bfd22'), color: '#388bfd', border: '1px solid #388bfd55', marginRight: 4 }}
            >
              {isKo ? '재발주' : 'Reorder'}
            </button>
          )}
          {!isDemo && (
            <>
              <a
                href={`/api/nexyfab/orders/${order.id}/pdf`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ ...S.btn('#21262d'), color: '#8b949e', textDecoration: 'none', border: '1px solid #30363d' }}
              >
                📄 PDF
              </a>
              <a
                href={`/api/nexyfab/orders/${order.id}/tax-invoice`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ ...S.btn('#21262d'), color: '#e3b341', textDecoration: 'none', border: '1px solid #e3b34155' }}
              >
                🧾 세금계산서
              </a>
            </>
          )}
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#6e7681', cursor: 'pointer', fontSize: 18, padding: 4 }}>✕</button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, padding: '10px 16px', borderBottom: '1px solid #21262d', background: '#0d1117', flexWrap: 'wrap' }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={S.tabBtn(tab === t.id)}>{t.label}</button>
          ))}
        </div>

        {/* Content */}
        <div style={S.panel}>
          {drawerError && (
            <div style={{
              background: '#f8514918', border: '1px solid #f8514944', borderRadius: 8,
              padding: '8px 12px', marginBottom: 12, fontSize: 12, color: '#f85149',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
            }}>
              <span>{
                drawerError === 'LOAD_FAILED' ? (isKo ? '데이터를 불러오지 못했습니다.' : 'Failed to load data.') :
                drawerError === 'MS_ADD_FAILED' ? (isKo ? '마일스톤 추가에 실패했습니다.' : 'Failed to add milestone.') :
                drawerError === 'MS_UPDATE_FAILED' ? (isKo ? '마일스톤 업데이트에 실패했습니다.' : 'Failed to update milestone.') :
                drawerError === 'SHIP_ADD_FAILED' ? (isKo ? '배송 정보 등록에 실패했습니다.' : 'Failed to register tracking.') :
                drawerError === 'SHIP_REFRESH_FAILED' ? (isKo ? '배송 정보 갱신에 실패했습니다.' : 'Failed to refresh shipment.') :
                drawerError
              }</span>
              <button onClick={() => setDrawerError(null)}
                style={{ background: 'none', border: 'none', color: '#f85149', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>✕</button>
            </div>
          )}
          {loading && (
            <div style={{ color: '#6e7681', textAlign: 'center', padding: '40px 0', fontSize: 13 }}>
              {isKo ? '불러오는 중...' : 'Loading...'}
            </div>
          )}

          {/* ── TIMELINE ── */}
          {tab === 'timeline' && (
            <OrderTimeline orderId={order.id} lang={isKo ? 'ko' : 'en'} isDemo={isDemo} />
          )}

          {/* ── MILESTONES ── */}
          {(!loading || isDemo) && tab === 'milestones' && (
            <div>
              <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 12 }}>
                {isKo
                  ? `${displayMilestones.filter(m => m.status === 'completed').length} / ${displayMilestones.length} 완료`
                  : `${displayMilestones.filter(m => m.status === 'completed').length} / ${displayMilestones.length} done`}
              </div>
              {displayMilestones.length === 0 && (
                <div style={{ color: '#484f58', fontSize: 12, padding: '20px 0' }}>
                  {isKo ? '마일스톤이 없습니다.' : 'No milestones yet.'}
                </div>
              )}
              {displayMilestones.map(ms => (
                <div key={ms.id} style={S.msRow(ms.status === 'completed')}>
                  <button onClick={() => toggleMilestone(ms)} style={{
                    width: 20, height: 20, borderRadius: 4, border: '2px solid',
                    borderColor: ms.status === 'completed' ? '#3fb950' : '#30363d',
                    background: ms.status === 'completed' ? '#3fb950' : 'transparent',
                    color: '#fff', fontSize: 11, cursor: isDemo ? 'default' : 'pointer', flexShrink: 0,
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
              {!isDemo && (
                <div style={S.inputRow}>
                  <input
                    value={newMsTitle}
                    onChange={e => setNewMsTitle(e.target.value)}
                    placeholder={isKo ? '마일스톤 제목...' : 'Milestone title...'}
                    style={S.input}
                    onKeyDown={e => e.key === 'Enter' && addMilestone()}
                  />
                  <button onClick={addMilestone} disabled={addingMs || !newMsTitle.trim()}
                    style={{ ...S.btn('#388bfd'), opacity: addingMs || !newMsTitle.trim() ? 0.5 : 1 }}>
                    {isKo ? '추가' : 'Add'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── QC CHECKLIST ── */}
          {!loading && tab === 'qc' && (
            <div>
              {isDemo ? (
                <div style={{ padding: '12px 14px', background: '#0d1117', borderRadius: 8, border: '1px solid #21262d', fontSize: 12, color: '#6e7681' }}>
                  {isKo ? '실제 계약 후 QC 체크리스트가 표시됩니다.' : 'QC checklist will be shown after a real order is placed.'}
                </div>
              ) : (
                <>
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
                </>
              )}
            </div>
          )}

          {/* ── SHIPMENT ── */}
          {!loading && tab === 'shipment' && (
            <div>
              {isDemo ? (
                <div style={{ padding: '12px 14px', background: '#0d1117', borderRadius: 8, border: '1px solid #21262d', fontSize: 12, color: '#6e7681' }}>
                  {isKo ? '배송 번호가 등록되면 실시간 추적이 가능합니다.' : 'Once a tracking number is added, real-time tracking will be available.'}
                </div>
              ) : (
                <>
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
                </>
              )}
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
                  <textarea
                    value={comment}
                    onChange={e => setComment(e.target.value)}
                    placeholder={isKo ? '자세한 후기를 남겨주세요 (선택)' : 'Leave a detailed review (optional)'}
                    rows={3}
                    style={{
                      ...S.input, display: 'block', width: '100%', boxSizing: 'border-box',
                      resize: 'none', marginBottom: 10,
                    }}
                  />

                  {reviewMsg && (
                    <div style={{ fontSize: 12, color: reviewMsg === 'REVIEW_OK' ? '#3fb950' : '#f85149', marginBottom: 8 }}>
                      {reviewMsg === 'REVIEW_OK' ? (isKo ? '리뷰가 등록되었습니다.' : 'Review submitted.') :
                       reviewMsg === 'REVIEW_DEMO' ? (isKo ? '데모 모드에서는 리뷰를 제출할 수 없습니다.' : 'Cannot submit review in demo mode.') :
                       reviewMsg === 'REVIEW_ERROR' ? (isKo ? '오류가 발생했습니다.' : 'Error occurred.') :
                       reviewMsg}
                    </div>
                  )}

                  <button
                    onClick={submitReview}
                    disabled={submittingReview}
                    style={{ ...S.btn('#388bfd'), width: '100%', opacity: submittingReview ? 0.6 : 1 }}
                  >
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

          {/* ── DEFECTS / RMA (Phase 7-5d) ── */}
          {!loading && tab === 'defects' && (
            <div>
              {defects.length === 0 && !showDefectForm && (
                <div style={{
                  padding: '14px', background: '#0d1117', borderRadius: 8, border: '1px solid #21262d',
                  fontSize: 12, color: '#8b949e', marginBottom: 12,
                }}>
                  {isKo
                    ? '접수된 불량·RMA 이슈가 없습니다. 받은 제품에 문제가 있으면 아래 버튼으로 제기할 수 있습니다.'
                    : 'No defects or RMA issues. If the delivered part has a problem, report it below.'}
                  <div style={{ fontSize: 10, color: '#484f58', marginTop: 6 }}>
                    {isKo ? '배송 후 30일 이내, 주문당 미해결 이슈 최대 3건.' : 'Within 30 days of delivery, max 3 open issues per order.'}
                  </div>
                </div>
              )}

              {defects.map(d => (
                <div key={d.id} style={{
                  padding: '12px', background: '#0d1117', borderRadius: 8,
                  border: '1px solid #21262d', marginBottom: 10,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#6e7681' }}>{d.id}</span>
                    <span style={{
                      fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 8,
                      background: DEFECT_STATUS_COLOR[d.status] + '22',
                      color: DEFECT_STATUS_COLOR[d.status],
                    }}>
                      {d.status.toUpperCase()}
                    </span>
                    <span style={{
                      fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 8,
                      background: d.severity === 'critical' ? '#f8514922'
                                : d.severity === 'major' ? '#e3b34122' : '#6e768122',
                      color: d.severity === 'critical' ? '#f85149'
                            : d.severity === 'major' ? '#e3b341' : '#8b949e',
                    }}>
                      {d.severity}
                    </span>
                    <span style={{ fontSize: 10, color: '#6e7681', marginLeft: 'auto' }}>
                      {new Date(d.createdAt).toISOString().slice(0, 10)}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#e6edf3', marginBottom: 4 }}>
                    {d.kind.replace(/_/g, ' ')}
                  </div>
                  <div style={{ fontSize: 12, color: '#c9d1d9', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                    {d.description}
                  </div>

                  {d.rmaNumber && (
                    <div style={{
                      marginTop: 8, padding: '6px 10px', borderRadius: 6,
                      background: '#a371f711', border: '1px solid #a371f733',
                      fontSize: 11, color: '#a371f7', fontFamily: 'monospace',
                    }}>
                      🧾 RMA: <b>{d.rmaNumber}</b>
                      {d.rmaInstructions && (
                        <div style={{ fontSize: 11, color: '#c9d1d9', fontFamily: 'system-ui', marginTop: 4, whiteSpace: 'pre-wrap' }}>
                          {d.rmaInstructions}
                        </div>
                      )}
                    </div>
                  )}

                  {d.partnerResponse && (
                    <div style={{
                      marginTop: 8, padding: '6px 10px', borderRadius: 6,
                      background: '#388bfd11', border: '1px solid #388bfd33',
                      fontSize: 11, color: '#c9d1d9', whiteSpace: 'pre-wrap',
                    }}>
                      💬 <b style={{ color: '#388bfd' }}>{isKo ? '공급사 응답' : 'Supplier response'}</b>
                      <div style={{ marginTop: 4 }}>{d.partnerResponse}</div>
                    </div>
                  )}

                  {d.resolutionNote && (
                    <div style={{
                      marginTop: 8, padding: '6px 10px', borderRadius: 6,
                      background: '#3fb95011', border: '1px solid #3fb95033',
                      fontSize: 11, color: '#c9d1d9', whiteSpace: 'pre-wrap',
                    }}>
                      ✓ <b style={{ color: '#3fb950' }}>{isKo ? '해결 확인' : 'Resolved'}</b>
                      <div style={{ marginTop: 4 }}>{d.resolutionNote}</div>
                    </div>
                  )}

                  {/* 구매자 액션: approved → resolved, rejected → disputed, reported → rejected(철회) */}
                  {d.status === 'approved' && (
                    <button
                      onClick={() => {
                        const note = window.prompt(isKo ? '해결 내용을 간단히 입력하세요 (선택)' : 'Resolution note (optional)') ?? '';
                        transitionDefect(d.id, 'resolved', { resolutionNote: note });
                      }}
                      style={{ ...S.btn('#3fb950'), marginTop: 8, width: '100%' }}
                    >
                      ✓ {isKo ? '해결 확인' : 'Mark Resolved'}
                    </button>
                  )}
                  {d.status === 'rejected' && (
                    <button
                      onClick={() => transitionDefect(d.id, 'disputed')}
                      style={{ ...S.btn('#f85149'), marginTop: 8, width: '100%' }}
                    >
                      ⚠ {isKo ? '이의 제기' : 'Dispute'}
                    </button>
                  )}
                  {d.status === 'reported' && (
                    <button
                      onClick={() => {
                        if (window.confirm(isKo ? '이 이슈를 철회하시겠습니까?' : 'Withdraw this issue?')) {
                          transitionDefect(d.id, 'rejected');
                        }
                      }}
                      style={{ ...S.btn('#484f58'), marginTop: 8, width: '100%', fontSize: 11 }}
                    >
                      {isKo ? '철회' : 'Withdraw'}
                    </button>
                  )}
                </div>
              ))}

              {/* 신규 제기 폼 */}
              {showDefectForm ? (
                <div style={{
                  padding: '12px', background: '#161b22', borderRadius: 8,
                  border: '1px solid #30363d', marginTop: 8,
                }}>
                  <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10, color: '#e6edf3' }}>
                    {isKo ? '불량·이슈 제기' : 'Report a Defect'}
                  </div>

                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 10, color: '#6e7681', marginBottom: 4 }}>{isKo ? '유형' : 'Kind'}</div>
                    <select value={defectKind} onChange={e => setDefectKind(e.target.value as DefectKind)} style={{ ...S.input, width: '100%' }}>
                      <option value="wrong_part">{isKo ? '다른 부품' : 'Wrong part'}</option>
                      <option value="damaged">{isKo ? '파손' : 'Damaged'}</option>
                      <option value="out_of_spec">{isKo ? '규격 미달' : 'Out of spec'}</option>
                      <option value="missing_quantity">{isKo ? '수량 부족' : 'Missing quantity'}</option>
                      <option value="late_delivery">{isKo ? '지연 배송' : 'Late delivery'}</option>
                      <option value="other">{isKo ? '기타' : 'Other'}</option>
                    </select>
                  </div>

                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 10, color: '#6e7681', marginBottom: 4 }}>{isKo ? '심각도' : 'Severity'}</div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {(['minor', 'major', 'critical'] as DefectSeverity[]).map(s => (
                        <button
                          key={s}
                          onClick={() => setDefectSeverity(s)}
                          style={{
                            flex: 1, padding: '6px 0', borderRadius: 6,
                            border: `1px solid ${defectSeverity === s ? '#f85149' : '#30363d'}`,
                            background: defectSeverity === s ? '#f8514922' : 'transparent',
                            color: defectSeverity === s ? '#f85149' : '#8b949e',
                            fontSize: 11, fontWeight: 700, cursor: 'pointer',
                          }}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>

                  <textarea
                    value={defectDescription}
                    onChange={e => setDefectDescription(e.target.value)}
                    placeholder={isKo
                      ? '문제 내용을 최소 10자 이상 상세히 기술해주세요. 사진이 있다면 S3/R2 에 업로드 후 key 를 첨부할 수 있습니다.'
                      : 'Describe the issue (min 10 chars). Photos can be attached by uploading to storage and providing the key.'}
                    rows={4}
                    style={{ ...S.input, display: 'block', width: '100%', boxSizing: 'border-box', resize: 'none', marginBottom: 10 }}
                  />

                  {defectMsg && (
                    <div style={{
                      fontSize: 11, color: defectMsg.startsWith('제출') || defectMsg.startsWith('Defect') ? '#3fb950' : '#f85149',
                      marginBottom: 8,
                    }}>
                      {defectMsg}
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      onClick={() => { setShowDefectForm(false); setDefectDescription(''); setDefectMsg(''); }}
                      style={{ ...S.btn('#484f58'), flex: 1 }}
                    >
                      {isKo ? '취소' : 'Cancel'}
                    </button>
                    <button
                      onClick={submitDefect}
                      disabled={submittingDefect}
                      style={{ ...S.btn('#f85149'), flex: 2, opacity: submittingDefect ? 0.6 : 1 }}
                    >
                      {submittingDefect ? (isKo ? '제출 중…' : 'Submitting…') : (isKo ? '제출' : 'Submit')}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowDefectForm(true)}
                  style={{ ...S.btn('#f85149'), width: '100%', marginTop: 4 }}
                >
                  ⚠ {isKo ? '새 이슈 제기' : 'Report New Issue'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

function OrdersPageInner({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = use(params);
  const isKo = isKorean(lang);

  const { user, token } = useAuthStore();
  const [showAuth, setShowAuth] = useState(false);

  const [orders, setOrders] = useState<NexyfabOrder[]>([]);
  const [totalOrders, setTotalOrders] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<NexyfabOrder | null>(null);
  const [reorderMsg, setReorderMsg] = useState('');
  const [paymentMsg, setPaymentMsg] = useState('');
  const [payingOrderId, setPayingOrderId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<NexyfabOrderStatus | ''>('');
  const [ordersPage, setOrdersPage] = useState(1);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const ORDERS_PAGE_SIZE = 20;

  // Whether we're showing demo data
  const isDemo = !user;

  const loadOrders = useCallback(async (silent = false, opts?: { status?: string; page?: number }) => {
    if (!user || !token) {
      setOrders(DEMO_ORDERS);
      setTotalOrders(DEMO_ORDERS.length);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const currentStatus = opts?.status ?? statusFilter;
      const currentPage   = opts?.page   ?? ordersPage;
      const params = new URLSearchParams({
        limit: String(ORDERS_PAGE_SIZE),
        page:  String(currentPage),
        ...(currentStatus ? { status: currentStatus } : {}),
      });
      const r = await fetch(`/api/nexyfab/orders?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await r.json() as { orders?: NexyfabOrder[]; total?: number };
      setOrders(data.orders ?? []);
      setTotalOrders(data.total ?? 0);
      setLastUpdated(new Date());
      setError(null);
    } catch {
      if (!silent) setError('LOAD_FAILED');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user, token, statusFilter, ordersPage]);

  useEffect(() => {
    loadOrders();
    if (user && token) {
      intervalRef.current = setInterval(() => loadOrders(true), 30_000);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [loadOrders, user, token]);

  // Toss 결제 완료 후 return URL 파라미터 처리
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const sp = new URLSearchParams(window.location.search);
    const payment = sp.get('payment');
    const orderId = sp.get('orderId');
    const tossOrderId = sp.get('tossOrderId');
    const amount = sp.get('amount');
    if (payment === 'success' && orderId && tossOrderId && amount && token) {
      const paymentKey = sp.get('paymentKey') ?? '';
      fetch(`/api/nexyfab/orders/${orderId}/payment`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({ paymentKey, tossOrderId, amount: Number(amount) }),
      }).then(r => r.json()).then((d: { ok?: boolean; error?: string }) => {
        if (d.ok) { setPaymentMsg('결제가 완료되었습니다. 주문이 생산 단계로 이동했습니다.'); loadOrders(true); }
        else setPaymentMsg(d.error ?? '결제 승인 처리 중 오류가 발생했습니다.');
      }).catch(() => setPaymentMsg('결제 승인 처리 중 오류가 발생했습니다.'));
      // Clean up URL
      const clean = window.location.pathname;
      window.history.replaceState({}, '', clean);
    } else if (payment === 'fail') {
      setPaymentMsg('결제가 취소되었거나 실패했습니다.');
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [token, loadOrders]);

  const handleReorder = useCallback(async (orderId: string) => {
    const order = orders.find(o => o.id === orderId);
    const rfqId = order?.rfqId;
    if (!rfqId) {
      setReorderMsg('REORDER_NO_RFQ');
      return;
    }
    try {
      const r = await fetch('/api/nexyfab/rfq/repeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ rfqId }),
      });
      const d = await r.json() as { rfq?: { id: string }; error?: string };
      if (r.ok) {
        setReorderMsg(`REORDER_OK:${d.rfq?.id ?? ''}`);
        setSelectedOrder(null);
      } else {
        setReorderMsg(d.error ?? 'REORDER_FAILED');
      }
    } catch {
      setReorderMsg('REORDER_ERROR');
    }
  }, [orders, token]);

  return (
    <div style={{
      minHeight: '100vh', background: '#0d1117',
      fontFamily: 'system-ui, -apple-system, sans-serif', color: '#e6edf3',
      display: 'flex',
    }}>
      {/* Sidebar nav */}
      <NexyfabNav lang={lang} />

      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Top bar */}
        <div style={{
          borderBottom: '1px solid #21262d', padding: '14px 28px',
          display: 'flex', alignItems: 'center', gap: 14,
          position: 'sticky', top: 0, background: '#0d1117', zIndex: 10,
        }}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>
            {isKo ? '주문 추적' : 'Order Tracking'}
          </span>
          {isDemo && (
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 8,
              background: '#e3b34122', color: '#e3b341', letterSpacing: '0.05em',
            }}>
              DEMO
            </span>
          )}
          <div style={{ flex: 1 }} />
          {lastUpdated && (
            <span style={{ fontSize: 11, color: '#484f58' }}>
              {isKo ? '최근 갱신 ' : 'Updated '}
              {lastUpdated.toLocaleTimeString(isKo ? 'ko-KR' : 'en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
          {user && (
            <button
              onClick={() => loadOrders(true)}
              disabled={refreshing}
              style={{
                padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                border: '1px solid #30363d', background: 'transparent',
                color: refreshing ? '#484f58' : '#8b949e',
              }}
            >
              {refreshing ? '↻' : '↺'} {isKo ? '새로고침' : 'Refresh'}
            </button>
          )}
          <a
            href={`/${lang}/nexyfab/marketplace`}
            style={{
              fontSize: 12, color: '#388bfd', textDecoration: 'none',
              padding: '5px 12px', borderRadius: 6, border: '1px solid #388bfd33',
              background: '#388bfd11',
            }}
          >
            {isKo ? '제조사 마켓' : 'Marketplace'}
          </a>
        </div>

        <div style={{ flex: 1, maxWidth: 860, margin: '0 auto', padding: '28px 24px', width: '100%', boxSizing: 'border-box' }}>
          {/* Breadcrumb */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#6e7681', marginBottom: 20 }}>
            <a
              href={`/${lang}/nexyfab`}
              style={{ color: '#6e7681', textDecoration: 'none' }}
              onMouseEnter={e => (e.currentTarget.style.color = '#388bfd')}
              onMouseLeave={e => (e.currentTarget.style.color = '#6e7681')}
            >
              {isKo ? '대시보드' : 'Dashboard'}
            </a>
            <span style={{ color: '#30363d' }}>/</span>
            <span style={{ color: '#8b949e' }}>{isKo ? '주문 추적' : 'Order Tracking'}</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, marginBottom: 6 }}>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>
              {isKo ? '주문 추적' : 'Order Tracking'}
            </h1>
            {!isDemo && (
              <span style={{ fontSize: 13, color: '#6e7681', marginBottom: 2 }}>
                {isKo ? `총 ${orders.length}건` : `${orders.length} orders`}
              </span>
            )}
          </div>
          <p style={{ margin: '0 0 16px', fontSize: 13, color: '#6e7681' }}>
            {isKo ? '실시간 제조 진행 현황을 확인하세요' : 'Track your manufacturing orders in real time'}
          </p>

          {/* Status filter */}
          {!loading && orders.length > 0 && (
            <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
              {([
                { value: '' as const,          labelKo: '전체',     labelEn: 'All' },
                { value: 'placed' as const,     labelKo: '주문 완료', labelEn: 'Placed' },
                { value: 'production' as const, labelKo: '생산 중',  labelEn: 'Production' },
                { value: 'qc' as const,         labelKo: 'QC 검사',  labelEn: 'QC' },
                { value: 'shipped' as const,    labelKo: '배송 중',  labelEn: 'Shipped' },
                { value: 'delivered' as const,  labelKo: '완료',     labelEn: 'Delivered' },
              ] satisfies { value: NexyfabOrderStatus | ''; labelKo: string; labelEn: string }[]).map(opt => (
                <button
                  key={opt.value}
                  onClick={() => { setStatusFilter(opt.value); setOrdersPage(1); loadOrders(false, { status: opt.value, page: 1 }); }}
                  style={{
                    padding: '5px 12px', borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                    border: `1px solid ${statusFilter === opt.value ? '#388bfd' : '#30363d'}`,
                    background: statusFilter === opt.value ? '#388bfd20' : 'transparent',
                    color: statusFilter === opt.value ? '#388bfd' : '#8b949e',
                    transition: 'all 0.12s',
                  }}
                >
                  {isKo ? opt.labelKo : opt.labelEn}
                </button>
              ))}
            </div>
          )}

          {/* Demo banner */}
          {isDemo && (
            <div style={{
              background: '#e3b34111', border: '1px solid #e3b34133',
              borderRadius: 10, padding: '12px 18px', marginBottom: 24,
              display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
            }}>
              <span style={{ fontSize: 20 }}>🔍</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#e3b341', marginBottom: 2 }}>
                  {isKo ? '데모 데이터입니다' : 'You are viewing demo data'}
                </div>
                <div style={{ fontSize: 12, color: '#8b949e' }}>
                  {isKo ? '로그인하면 실제 주문 내역을 확인할 수 있습니다.' : 'Log in to view your real orders.'}
                </div>
              </div>
              <button
                onClick={() => setShowAuth(true)}
                style={{
                  padding: '7px 18px', borderRadius: 8, border: 'none', cursor: 'pointer',
                  background: 'linear-gradient(135deg, #388bfd, #8b5cf6)',
                  color: '#fff', fontSize: 13, fontWeight: 700,
                }}
              >
                {isKo ? '로그인' : 'Sign in'}
              </button>
            </div>
          )}

          {/* Payment message */}
          {paymentMsg && (
            <div style={{
              background: paymentMsg.startsWith('결제가 완료') ? '#388bfd22' : '#f8514918',
              border: `1px solid ${paymentMsg.startsWith('결제가 완료') ? '#388bfd55' : '#f8514944'}`,
              borderRadius: 8, padding: '10px 16px',
              color: paymentMsg.startsWith('결제가 완료') ? '#388bfd' : '#f85149',
              fontSize: 13, marginBottom: 20,
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span style={{ flex: 1 }}>{paymentMsg}</span>
              <button onClick={() => setPaymentMsg('')} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 16 }}>✕</button>
            </div>
          )}

          {/* Reorder message */}
          {reorderMsg && (
            <div style={{
              background: reorderMsg.startsWith('REORDER_OK') ? '#388bfd22' : '#f8514918',
              border: `1px solid ${reorderMsg.startsWith('REORDER_OK') ? '#388bfd55' : '#f8514944'}`,
              borderRadius: 8, padding: '10px 16px',
              color: reorderMsg.startsWith('REORDER_OK') ? '#388bfd' : '#f85149',
              fontSize: 13, marginBottom: 20,
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span style={{ flex: 1 }}>
                {reorderMsg.startsWith('REORDER_OK:')
                  ? (isKo ? `재발주 완료! RFQ ID: ${reorderMsg.slice(11)}` : `Reorder created: ${reorderMsg.slice(11)}`)
                  : reorderMsg === 'REORDER_NO_RFQ' ? (isKo ? 'RFQ ID를 찾을 수 없습니다.' : 'RFQ ID not found.')
                  : reorderMsg === 'REORDER_FAILED' ? (isKo ? '재발주 실패' : 'Reorder failed')
                  : reorderMsg === 'REORDER_ERROR' ? (isKo ? '오류가 발생했습니다.' : 'Error occurred.')
                  : reorderMsg}
              </span>
              <button onClick={() => setReorderMsg('')} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 16 }}>✕</button>
            </div>
          )}

          {/* Loading skeleton */}
          {loading && (
            <>
              <OrderSkeleton />
              <OrderSkeleton />
            </>
          )}

          {/* Error */}
          {error && (
            <div style={{
              background: '#da363322', border: '1px solid #da363355',
              borderRadius: 8, padding: '14px 16px', color: '#f85149', fontSize: 13,
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <span style={{ flex: 1 }}>
                {error === 'LOAD_FAILED' ? (isKo ? '불러오기 실패' : 'Failed to load orders') : error}
              </span>
              <button
                onClick={() => loadOrders()}
                style={{
                  padding: '5px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                  border: '1px solid #f85149', background: 'transparent', color: '#f85149', flexShrink: 0,
                }}
              >
                {isKo ? '다시 시도' : 'Retry'}
              </button>
            </div>
          )}

          {/* Empty state (logged in, no orders) */}
          {!loading && !error && user && orders.length === 0 && (
            <div style={{ textAlign: 'center', padding: '80px 0' }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>📦</div>
              <p style={{ color: '#6e7681', marginBottom: 16 }}>
                {isKo ? '아직 주문 내역이 없습니다.' : 'No orders yet.'}
              </p>
              <a
                href={`/${lang}/nexyfab/marketplace`}
                style={{
                  display: 'inline-block', padding: '9px 22px',
                  borderRadius: 8, background: '#388bfd', color: '#fff',
                  fontSize: 13, fontWeight: 700, textDecoration: 'none',
                }}
              >
                {isKo ? '제조사 찾기' : 'Find Manufacturers'}
              </a>
            </div>
          )}

          {/* Order cards */}
          {!loading && !error && (() => {
            const totalOrderPages = Math.max(1, Math.ceil(totalOrders / ORDERS_PAGE_SIZE));
            return (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                  {orders.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '40px 0', color: '#6e7681', fontSize: 13 }}>
                      {isKo ? '해당 상태의 주문이 없습니다.' : 'No orders match the selected filter.'}
                    </div>
                  )}
                  {orders.map(order => (
                    <OrderCard
                      key={order.id}
                      order={order}
                      isKo={isKo}
                      isDemo={isDemo}
                      paying={payingOrderId === order.id}
                      token={token}
                      onClick={() => setSelectedOrder(order)}
                      onPay={user && token && order.payment_status !== 'paid' && order.paymentStatus !== 'paid' && order.status === 'placed'
                        ? () => {
                        setPayingOrderId(order.id);
                        openTossPayment({
                          orderId: order.id, token, lang,
                          onSuccess: () => { setPayingOrderId(null); loadOrders(true); },
                          onError: msg => { setPayingOrderId(null); setPaymentMsg(msg); },
                        });
                      } : undefined}
                    />
                  ))}
                </div>
                {totalOrderPages > 1 && (
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 24, alignItems: 'center' }}>
                    <button
                      disabled={ordersPage <= 1}
                      onClick={() => { const p = ordersPage - 1; setOrdersPage(p); loadOrders(false, { page: p }); }}
                      style={{
                        padding: '6px 14px', borderRadius: 6, fontSize: 12, cursor: ordersPage <= 1 ? 'default' : 'pointer',
                        border: '1px solid #30363d', background: 'transparent',
                        color: ordersPage <= 1 ? '#484f58' : '#8b949e',
                      }}
                    >
                      ← {isKo ? '이전' : 'Prev'}
                    </button>
                    <span style={{ fontSize: 12, color: '#6e7681' }}>
                      {ordersPage} / {totalOrderPages}
                    </span>
                    <button
                      disabled={ordersPage >= totalOrderPages}
                      onClick={() => { const p = ordersPage + 1; setOrdersPage(p); loadOrders(false, { page: p }); }}
                      style={{
                        padding: '6px 14px', borderRadius: 6, fontSize: 12,
                        cursor: ordersPage >= totalOrderPages ? 'default' : 'pointer',
                        border: '1px solid #30363d', background: 'transparent',
                        color: ordersPage >= totalOrderPages ? '#484f58' : '#8b949e',
                      }}
                    >
                      {isKo ? '다음' : 'Next'} →
                    </button>
                  </div>
                )}
              </>
            );
          })()}
        </div>
      </div>

      {/* Detail Drawer */}
      {selectedOrder && (
        <OrderDetailDrawer
          order={selectedOrder}
          isKo={isKo}
          token={token}
          onClose={() => setSelectedOrder(null)}
          onReorder={handleReorder}
        />
      )}

      {/* Auth modal */}
      <AuthModal open={showAuth} onClose={() => setShowAuth(false)} />
    </div>
  );
}

export default function OrdersPage({ params }: { params: Promise<{ lang: string }> }) {
  return (
    <Suspense fallback={null}>
      <OrdersPageInner params={params} />
    </Suspense>
  );
}

// ─── OrderCard ────────────────────────────────────────────────────────────────

function OrderCard({
  order, isKo, isDemo, paying, onClick, onPay, token,
}: {
  order: NexyfabOrder;
  isKo: boolean;
  isDemo: boolean;
  paying?: boolean;
  onClick: () => void;
  onPay?: () => void;
  token?: string | null;
}) {
  const [showRefund, setShowRefund] = useState(false);
  const [refundReason, setRefundReason] = useState('');
  const [refunding, setRefunding] = useState(false);
  const [refundMsg, setRefundMsg] = useState('');

  const isPaid = order.payment_status === 'paid' || order.paymentStatus === 'paid';
  const canRefund = isPaid && order.status === 'placed' && !isDemo && !order.refund_requested_at;
  const refundRequested = !!order.refund_requested_at;

  async function submitRefundRequest(e: React.MouseEvent) {
    e.stopPropagation();
    setRefunding(true);
    setRefundMsg('');
    try {
      const res = await fetch(`/api/nexyfab/orders/${order.id}/refund-request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ reason: refundReason }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (res.ok) {
        setRefundMsg(isKo ? '환불 요청이 접수되었습니다. 영업일 기준 1-3일 내 처리됩니다.' : 'Refund request submitted. Processing takes 1-3 business days.');
        setShowRefund(false);
      } else {
        setRefundMsg(data.error ?? (isKo ? '환불 요청 실패' : 'Refund request failed'));
      }
    } catch {
      setRefundMsg(isKo ? '요청 중 오류가 발생했습니다.' : 'An error occurred.');
    } finally {
      setRefunding(false);
    }
  }

  const currentStep = STATUS_STEP_INDEX[order.status];
  const totalSteps = order.steps.length;
  const progressPct = totalSteps > 1 ? Math.round((currentStep / (totalSteps - 1)) * 100) : 100;
  const statusColor = STATUS_COLORS[order.status];
  const statusLabel = STATUS_LABEL[order.status][isKo ? 'ko' : 'en'];

  function fmtKRW(n: number) {
    return n.toLocaleString('ko-KR') + '원';
  }

  const dday = formatDday(new Date(order.estimatedDeliveryAt));

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
          <p style={{ margin: 0, fontSize: 11, color: '#6e7681' }}>
            {order.id}
            {isDemo && (
              <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: '#e3b34122', color: '#e3b341' }}>DEMO</span>
            )}
          </p>
          <p style={{ margin: '2px 0 0', fontSize: 15, fontWeight: 700, color: '#e6edf3' }}>
            {order.partName}
          </p>
        </div>
        <div style={{ flex: 1 }} />
        {onPay && (
          <button
            onClick={e => { e.stopPropagation(); onPay(); }}
            disabled={paying}
            style={{
              padding: '5px 14px', borderRadius: 6, fontSize: 12, fontWeight: 700,
              border: 'none', cursor: paying ? 'default' : 'pointer',
              background: paying ? '#388bfd44' : 'linear-gradient(135deg,#388bfd,#8b5cf6)',
              color: '#fff', opacity: paying ? 0.7 : 1, marginRight: 6,
            }}
          >
            {paying ? (isKo ? '처리 중...' : 'Processing...') : (isKo ? '결제하기' : 'Pay')}
          </button>
        )}
        {refundRequested && (
          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 8, background: '#f8514922', color: '#f85149', border: '1px solid #f8514944' }}>
            {isKo ? '환불 요청 중' : 'Refund Pending'}
          </span>
        )}
        {canRefund && !showRefund && (
          <button
            onClick={e => { e.stopPropagation(); setShowRefund(true); }}
            style={{
              padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
              border: '1px solid #f8514966', background: 'transparent',
              color: '#f85149', cursor: 'pointer', marginRight: 4,
            }}
          >
            {isKo ? '환불 요청' : 'Refund'}
          </button>
        )}
        <span style={{ fontSize: 10, color: '#484f58' }}>
          {isKo ? '상세 보기 →' : 'Details →'}
        </span>
        {/* 리뷰 미작성 뱃지 */}
        {order.status === 'delivered' && !(order as NexyfabOrder & { hasReview?: boolean }).hasReview && (
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 8,
            background: '#e3b34122', color: '#e3b341', border: '1px solid #e3b34144',
          }}>
            ⭐ {isKo ? '리뷰 작성' : 'Review'}
          </span>
        )}
        {/* Status badge */}
        <span style={{
          fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 10,
          background: statusColor + '22', color: statusColor,
        }}>
          {statusLabel}
        </span>
      </div>

      {/* Refund request panel */}
      {showRefund && (
        <div
          onClick={e => e.stopPropagation()}
          style={{ padding: '12px 20px', borderBottom: '1px solid #21262d', background: '#1a0d0d' }}
        >
          <p style={{ margin: '0 0 8px', fontSize: 12, color: '#f85149', fontWeight: 600 }}>
            {isKo ? '환불 요청 사유를 입력하세요' : 'Please enter your refund reason'}
          </p>
          <textarea
            value={refundReason}
            onChange={e => setRefundReason(e.target.value)}
            placeholder={isKo ? '사유 입력 (선택)' : 'Reason (optional)'}
            rows={2}
            style={{
              width: '100%', background: '#0d1117', border: '1px solid #30363d',
              borderRadius: 6, padding: '7px 10px', color: '#e6edf3', fontSize: 12,
              resize: 'none', boxSizing: 'border-box',
            }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button onClick={submitRefundRequest} disabled={refunding} style={{ padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 700, border: 'none', cursor: 'pointer', background: '#f85149', color: '#fff', opacity: refunding ? 0.6 : 1 }}>
              {refunding ? (isKo ? '요청 중...' : 'Submitting...') : (isKo ? '환불 요청 제출' : 'Submit Request')}
            </button>
            <button onClick={e => { e.stopPropagation(); setShowRefund(false); }} style={{ padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, border: '1px solid #30363d', background: 'transparent', color: '#8b949e', cursor: 'pointer' }}>
              {isKo ? '취소' : 'Cancel'}
            </button>
          </div>
          {refundMsg && <p style={{ margin: '8px 0 0', fontSize: 11, color: '#f85149' }}>{refundMsg}</p>}
        </div>
      )}
      {refundMsg && !showRefund && (
        <div style={{ padding: '8px 20px', background: '#1a0d0d', borderBottom: '1px solid #21262d' }}>
          <p style={{ margin: 0, fontSize: 11, color: '#3fb950' }}>{refundMsg}</p>
        </div>
      )}

      {/* Meta row */}
      <div style={{
        padding: '12px 20px', borderBottom: '1px solid #21262d',
        display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 12,
      }}>
        <MetaItem label={isKo ? '제조사' : 'Manufacturer'} value={order.manufacturerName} />
        <MetaItem label={isKo ? '수량' : 'Qty'} value={`${order.quantity.toLocaleString()}${isKo ? '개' : ' pcs'}`} />
        <MetaItem label={isKo ? '계약금액' : 'Amount'} value={fmtKRW(order.totalPriceKRW)} />
        <MetaItem label={isKo ? '주문일' : 'Ordered'} value={formatDate(order.createdAt)} />
        <div>
          <p style={{ margin: 0, fontSize: 10, color: '#6e7681' }}>{isKo ? '납기 예정' : 'Est. Delivery'}</p>
          <p style={{ margin: '2px 0 0', fontWeight: 600, color: '#3fb950', display: 'flex', alignItems: 'center', gap: 6 }}>
            {formatDate(order.estimatedDeliveryAt)}
            {dday && (
              <span style={{
                fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 6,
                background: dday.color + '22', color: dday.color,
              }}>
                {dday.label}
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Carrier tracking strip — shown when shipping-webhook has posted events */}
      {order.tracking && <TrackingStrip tracking={order.tracking} isKo={isKo} />}

      {/* Progress bar + stepper */}
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
        <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', marginLeft: -20, marginRight: -20, paddingLeft: 20, paddingRight: 20 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', position: 'relative', minWidth: 300 }}>
          {/* Track line */}
          <div style={{
            position: 'absolute', top: 11, left: '10%', right: '10%',
            height: 2, background: '#21262d', borderRadius: 1, zIndex: 0,
          }} />
          <div style={{
            position: 'absolute', top: 11, left: '10%',
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
                  alignItems: 'center', gap: 5, position: 'relative', zIndex: 2,
                }}
              >
                <div style={{
                  width: 22, height: 22, borderRadius: '50%',
                  background: done ? statusColor : '#21262d',
                  border: `2px solid ${active ? statusColor : done ? statusColor : '#30363d'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, fontWeight: 700, color: done ? '#0d1117' : '#6e7681',
                  boxShadow: active ? `0 0 0 3px ${statusColor}44` : undefined,
                  transition: 'background 0.3s, box-shadow 0.3s',
                }}>
                  {done ? '✓' : String(i + 1)}
                </div>
                <span style={{
                  fontSize: 9, fontWeight: active ? 700 : 400,
                  color: active ? statusColor : done ? '#8b949e' : '#6e7681',
                  textAlign: 'center', lineHeight: 1.3, whiteSpace: 'nowrap',
                }}>
                  {isKo ? step.labelKo : step.label}
                </span>
                {ts && (
                  <span style={{ fontSize: 8, color: '#6e7681', textAlign: 'center' }}>
                    {step.completedAt
                      ? (isKo ? '완료 ' : 'Done ') + formatDate(ts)
                      : (isKo ? '예정 ' : 'Est. ') + formatDate(ts)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
        </div>
      </div>

      <div style={{ height: 14 }} />
    </div>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p style={{ margin: 0, fontSize: 10, color: '#6e7681' }}>{label}</p>
      <p style={{ margin: '2px 0 0', fontWeight: 600, color: '#e6edf3' }}>{value}</p>
    </div>
  );
}

// ─── Carrier deep-link + label ────────────────────────────────────────────────

const CARRIER_LABEL: Record<string, string> = {
  cj: 'CJ대한통운', hanjin: '한진택배', lotte: '롯데택배', logen: '로젠택배',
  ems: 'EMS / 우체국', fedex: 'FedEx', dhl: 'DHL',
};

function carrierTrackingUrl(carrier: string, tn: string): string | null {
  const t = encodeURIComponent(tn);
  switch (carrier) {
    case 'cj':     return `https://www.cjlogistics.com/ko/tool/parcel/tracking?gnbInvcNo=${t}`;
    case 'hanjin': return `https://www.hanjin.com/Delivery/Delivery_freight_tracking?inputNo=${t}`;
    case 'lotte':  return `https://www.lotteglogis.com/home/reservation/tracking/index?InvNo=${t}`;
    case 'logen':  return `https://www.ilogen.com/web/personal/trace/${t}`;
    case 'ems':    return `https://service.epost.go.kr/trace.RetrieveEmsRigiTraceList.comm?POST_CODE=${t}`;
    case 'fedex':  return `https://www.fedex.com/fedextrack/?trknbr=${t}`;
    case 'dhl':    return `https://www.dhl.com/global-en/home/tracking/tracking-express.html?submit=1&tracking-id=${t}`;
    default:       return null;
  }
}

const TRACKING_EVENT_LABEL: Record<string, { ko: string; en: string }> = {
  in_transit:       { ko: '운송 중',     en: 'In Transit' },
  out_for_delivery: { ko: '배송 중',     en: 'Out for Delivery' },
  delivered:        { ko: '배송 완료',   en: 'Delivered' },
  exception:        { ko: '배송 예외',   en: 'Exception' },
};

interface TrackingStripProps {
  tracking: NonNullable<NexyfabOrder['tracking']>;
  isKo: boolean;
}

function TrackingStrip({ tracking, isKo }: TrackingStripProps) {
  const url = carrierTrackingUrl(tracking.carrier, tracking.number);
  const carrierName = CARRIER_LABEL[tracking.carrier] ?? tracking.carrier.toUpperCase();
  const eventLabel = tracking.lastEvent
    ? TRACKING_EVENT_LABEL[tracking.lastEvent]?.[isKo ? 'ko' : 'en'] ?? tracking.lastEvent
    : null;
  const updated = tracking.updatedAt ? formatDate(tracking.updatedAt) : null;
  const isDelivered = tracking.lastEvent === 'delivered';
  const accent = isDelivered ? '#3fb950' : '#79c0ff';

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        margin: '0 20px 12px',
        padding: '10px 14px',
        borderRadius: 8,
        border: `1px solid ${accent}33`,
        background: `${accent}0d`,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
        fontSize: 12,
      }}
    >
      <span style={{ fontSize: 14 }}>📦</span>
      <span style={{ fontWeight: 700, color: '#e6edf3' }}>{carrierName}</span>
      <span style={{ fontFamily: 'monospace', color: '#c9d1d9' }}>{tracking.number}</span>
      {eventLabel && (
        <span style={{
          fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
          background: `${accent}22`, color: accent,
        }}>
          {eventLabel}
        </span>
      )}
      {updated && (
        <span style={{ fontSize: 10, color: '#6e7681' }}>
          {isKo ? '업데이트 ' : 'Updated '}{updated}
        </span>
      )}
      <div style={{ flex: 1 }} />
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontSize: 11, fontWeight: 700, color: accent,
            textDecoration: 'none', padding: '4px 10px',
            border: `1px solid ${accent}66`, borderRadius: 6,
          }}
        >
          {isKo ? '추적 열기 →' : 'Track →'}
        </a>
      )}
    </div>
  );
}
