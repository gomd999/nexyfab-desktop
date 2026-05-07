'use client';

/**
 * OrderTimeline — Customer-facing timeline panel for a single order.
 *
 * Pulls /api/nexyfab/orders/[id]/events on demand (when expanded) so the
 * orders list stays cheap. Events come from the partner workflow:
 * status_change / note / photo / shipment / delay.
 */
import { useEffect, useState } from 'react';

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

const STATUS_LABEL_KO: Record<string, string> = {
  placed: '주문 접수',
  production: '생산 중',
  qc: '품질 검사',
  shipped: '배송 중',
  delivered: '납품 완료',
};

const STATUS_LABEL_EN: Record<string, string> = {
  placed: 'Placed',
  production: 'Production',
  qc: 'QC',
  shipped: 'Shipped',
  delivered: 'Delivered',
};

const KIND_ICON: Record<OrderEvent['kind'], string> = {
  status_change: '🔄',
  note: '📝',
  photo: '📷',
  shipment: '🚚',
  delay: '⚠️',
};

const KIND_LABEL_KO: Record<OrderEvent['kind'], string> = {
  status_change: '상태 변경',
  note: '진행 메모',
  photo: '사진 업로드',
  shipment: '운송장 등록',
  delay: '지연 안내',
};

const KIND_LABEL_EN: Record<OrderEvent['kind'], string> = {
  status_change: 'Status update',
  note: 'Progress note',
  photo: 'Photo',
  shipment: 'Shipment',
  delay: 'Delay notice',
};

function relTime(ts: number, lang: 'ko' | 'en') {
  const diff = Date.now() - ts;
  const day = 86_400_000;
  if (lang === 'ko') {
    if (diff < 60_000) return '방금';
    if (diff < 3_600_000) return `${Math.round(diff / 60_000)}분 전`;
    if (diff < day) return `${Math.round(diff / 3_600_000)}시간 전`;
    if (diff < 7 * day) return `${Math.round(diff / day)}일 전`;
    return new Date(ts).toLocaleDateString('ko-KR');
  }
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < day) return `${Math.round(diff / 3_600_000)}h ago`;
  if (diff < 7 * day) return `${Math.round(diff / day)}d ago`;
  return new Date(ts).toLocaleDateString();
}

export default function OrderTimeline({ orderId, lang, isDemo }: {
  orderId: string;
  lang: 'ko' | 'en';
  isDemo?: boolean;
}) {
  const [events, setEvents] = useState<OrderEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true); setError(false);
      try {
        if (isDemo) {
          setEvents([
            { id: 'demo-1', orderId, kind: 'status_change', authorEmail: 'system', authorRole: 'system', body: null, photoUrl: null, fromStatus: 'placed', toStatus: 'production', createdAt: Date.now() - 5 * 86_400_000 },
            { id: 'demo-2', orderId, kind: 'note', authorEmail: 'demo', authorRole: 'partner', body: '소재 입고 완료, CNC 가공 시작했습니다.', photoUrl: null, fromStatus: null, toStatus: null, createdAt: Date.now() - 4 * 86_400_000 },
            { id: 'demo-3', orderId, kind: 'note', authorEmail: 'demo', authorRole: 'partner', body: '1차 검사 통과 — 표면 처리 진행 중', photoUrl: null, fromStatus: null, toStatus: null, createdAt: Date.now() - 86_400_000 },
          ]);
          return;
        }
        const res = await fetch(`/api/nexyfab/orders/${orderId}/events`, { credentials: 'include' });
        if (!res.ok) throw new Error('load failed');
        const data = await res.json();
        if (!cancelled) setEvents(data.events ?? []);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [orderId, isDemo]);

  const empty = lang === 'ko' ? '아직 진행 업데이트가 없습니다.' : 'No updates yet.';
  const errMsg = lang === 'ko' ? '타임라인을 불러오지 못했습니다.' : 'Failed to load timeline.';
  const loadingMsg = lang === 'ko' ? '불러오는 중…' : 'Loading…';
  const titleMsg = lang === 'ko' ? '진행 타임라인' : 'Progress Timeline';

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <h3 className="text-sm font-bold text-gray-800 mb-3">{titleMsg}</h3>
      {loading && <div className="text-xs text-gray-400 py-3 text-center">{loadingMsg}</div>}
      {error && <div className="text-xs text-rose-500 py-3 text-center">{errMsg}</div>}
      {!loading && !error && events.length === 0 && (
        <div className="text-xs text-gray-400 py-3 text-center">{empty}</div>
      )}
      {!loading && events.length > 0 && (
        <ol className="space-y-3">
          {events.map(ev => {
            const label = lang === 'ko' ? KIND_LABEL_KO[ev.kind] : KIND_LABEL_EN[ev.kind];
            const stmap = lang === 'ko' ? STATUS_LABEL_KO : STATUS_LABEL_EN;
            return (
              <li key={ev.id} className="flex gap-3 text-sm">
                <div className="w-6 shrink-0 text-center pt-0.5">{KIND_ICON[ev.kind]}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-semibold text-gray-500 uppercase">{label}</div>
                  {ev.kind === 'status_change' ? (
                    <div className="text-gray-700">
                      {stmap[ev.fromStatus ?? 'placed']} → <span className="font-semibold text-blue-700">{stmap[ev.toStatus ?? 'placed']}</span>
                    </div>
                  ) : (
                    <div className="text-gray-800 break-words">{ev.body}</div>
                  )}
                  {ev.photoUrl && (
                    <a href={ev.photoUrl} target="_blank" rel="noreferrer" className="block mt-1.5">
                      <img src={ev.photoUrl} alt="" className="rounded-lg max-h-48 border border-gray-100" />
                    </a>
                  )}
                  <div className="text-[11px] text-gray-400 mt-1">{relTime(ev.createdAt, lang)}</div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
