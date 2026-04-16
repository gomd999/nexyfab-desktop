'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CostEstimate {
  process: string;
  unitCost: number;
  leadTime: string;
  confidence: string;
}

interface RFQEntry {
  rfqId: string;
  shapeName: string;
  materialId: string;
  quantity: number;
  volume_cm3: number;
  costEstimates?: CostEstimate[];
  note?: string;
  status: 'pending' | 'assigned' | 'quoted' | 'accepted' | 'rejected';
  assignedFactoryName?: string;
  assignedAt?: string;
  quoteAmount?: number;
  manufacturerNote?: string;
  createdAt: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const C = {
  bg: '#0d1117',
  surface: '#161b22',
  card: '#21262d',
  border: '#30363d',
  text: '#e6edf3',
  textDim: '#8b949e',
  textMuted: '#6e7681',
  accent: '#388bfd',
  green: '#3fb950',
  yellow: '#d29922',
  red: '#f85149',
  blue: '#388bfd',
};

const STATUS_META: Record<
  RFQEntry['status'],
  { labelKo: string; labelEn: string; color: string; bg: string }
> = {
  pending:  { labelKo: '검토 중',     labelEn: 'Pending',   color: '#d29922', bg: '#d2992220' },
  assigned: { labelKo: '제조사 배정', labelEn: 'Assigned',  color: '#a78bfa', bg: '#a78bfa20' },
  quoted:   { labelKo: '견적 완료',   labelEn: 'Quoted',    color: '#388bfd', bg: '#388bfd20' },
  accepted: { labelKo: '수락됨',     labelEn: 'Accepted',  color: '#3fb950', bg: '#3fb95020' },
  rejected: { labelKo: '거절됨',     labelEn: 'Rejected',  color: '#f85149', bg: '#f8514920' },
};

const PROCESS_LABELS: Record<string, { en: string; ko: string }> = {
  cnc_milling:      { en: 'CNC Milling',      ko: 'CNC 밀링' },
  cnc_turning:      { en: 'CNC Turning',      ko: 'CNC 선반' },
  injection_molding:{ en: 'Injection Molding', ko: '사출 성형' },
  sheet_metal:      { en: 'Sheet Metal',      ko: '판금 가공' },
  casting:          { en: 'Casting',          ko: '주조' },
  '3d_printing':    { en: '3D Printing',      ko: '3D 프린팅' },
};

// ─── Page Component ───────────────────────────────────────────────────────────

export default function RFQPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = use(params);
  const router = useRouter();
  const isKo = lang === 'ko';

  const [rfqs, setRfqs] = useState<RFQEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [compareRfq, setCompareRfq] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);

    fetch('/api/nexyfab/rfq', { signal: controller.signal })
      .then(r => r.json())
      .then(data => {
        setRfqs(data.rfqs ?? []);
        setLoading(false);
      })
      .catch(err => {
        if (err.name !== 'AbortError') {
          setError(isKo ? '데이터를 불러오지 못했습니다.' : 'Failed to load RFQs.');
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [isKo]);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{
      minHeight: '100vh',
      background: C.bg,
      fontFamily: 'system-ui, -apple-system, sans-serif',
      color: C.text,
    }}>
      {/* Header */}
      <div style={{
        borderBottom: `1px solid #21262d`,
        padding: '16px 32px',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        position: 'sticky',
        top: 0,
        background: C.bg,
        zIndex: 10,
      }}>
        <a
          href={`/${lang}/shape-generator`}
          style={{ fontSize: 18, fontWeight: 800, color: C.text, textDecoration: 'none' }}
        >
          <span style={{ color: '#8b9cf4' }}>Nexy</span>Fab
        </a>
        <span style={{ color: C.border }}>|</span>
        <span style={{ fontSize: 14, color: C.textMuted }}>
          {isKo ? '견적 요청 내역' : 'Quote Requests'}
        </span>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => router.push(`/${lang}/shape-generator`)}
          style={{
            padding: '7px 16px',
            borderRadius: 8,
            border: 'none',
            background: 'linear-gradient(135deg, #388bfd, #8b5cf6)',
            color: '#fff',
            fontSize: 13,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          {isKo ? '+ 새 형상 제작' : '+ New Design'}
        </button>
      </div>

      {/* Body */}
      <div style={{ maxWidth: 860, margin: '0 auto', padding: '32px 24px' }}>
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 800 }}>
            {isKo ? '견적 요청 목록' : 'RFQ List'}
          </h1>
          <p style={{ margin: 0, fontSize: 13, color: C.textMuted }}>
            {isKo
              ? '제출한 견적 요청과 제조사의 응답을 확인하세요.'
              : 'Track your submitted quote requests and manufacturer responses.'}
          </p>
        </div>

        {loading ? (
          <LoadingState isKo={isKo} />
        ) : error ? (
          <ErrorState message={error} />
        ) : rfqs.length === 0 ? (
          <EmptyState isKo={isKo} lang={lang} router={router} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {rfqs.map(rfq => (
              <RFQCard
                key={rfq.rfqId}
                rfq={rfq}
                isKo={isKo}
                expanded={expandedId === rfq.rfqId}
                onToggle={() =>
                  setExpandedId(prev => (prev === rfq.rfqId ? null : rfq.rfqId))
                }
                onCompare={() => setCompareRfq({ id: rfq.rfqId, name: rfq.shapeName })}
              />
            ))}
          </div>
        )}

        {/* Quote compare modal */}
        {compareRfq && (
          <QuoteCompareModal
            rfqId={compareRfq.id}
            rfqName={compareRfq.name}
            isKo={isKo}
            onClose={() => setCompareRfq(null)}
          />
        )}
      </div>
    </div>
  );
}

// ─── Quote types ──────────────────────────────────────────────────────────────

interface QuoteForRFQ {
  id: string;
  factoryName: string;
  partnerEmail: string | null;
  estimatedAmount: number;
  estimatedDays: number | null;
  note: string | null;
  status: string;
  validUntil: string | null;
  createdAt: string;
}

// ─── RFQ Timeline ─────────────────────────────────────────────────────────────

const TIMELINE_STEPS: {
  statusKey: RFQEntry['status'];
  labelKo: string;
  labelEn: string;
  icon: string;
}[] = [
  { statusKey: 'pending',  labelKo: '접수',   labelEn: 'Received', icon: '📋' },
  { statusKey: 'assigned', labelKo: '배정',   labelEn: 'Assigned',  icon: '🏭' },
  { statusKey: 'quoted',   labelKo: '견적',   labelEn: 'Quoted',    icon: '💬' },
  { statusKey: 'accepted', labelKo: '수락',   labelEn: 'Accepted',  icon: '✅' },
];

const STATUS_ORDER: Record<RFQEntry['status'], number> = {
  pending: 0, assigned: 1, quoted: 2, accepted: 3, rejected: -1,
};

function RFQTimeline({ rfq, isKo }: { rfq: RFQEntry; isKo: boolean }) {
  const currentOrder = STATUS_ORDER[rfq.status] ?? 0;
  const isRejected = rfq.status === 'rejected';

  return (
    <div style={{ margin: '4px 0 8px' }}>
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        {/* Connector line */}
        <div style={{
          position: 'absolute', top: '50%', left: '10%', right: '10%', height: 2,
          background: C.border, transform: 'translateY(-50%)', zIndex: 0,
        }} />
        {/* Progress fill */}
        {!isRejected && currentOrder > 0 && (
          <div style={{
            position: 'absolute', top: '50%', left: '10%',
            width: `${(currentOrder / (TIMELINE_STEPS.length - 1)) * 80}%`,
            height: 2,
            background: C.accent, transform: 'translateY(-50%)', zIndex: 1,
            transition: 'width 0.4s ease',
          }} />
        )}

        {/* Steps */}
        {TIMELINE_STEPS.map((step, i) => {
          const stepOrder = STATUS_ORDER[step.statusKey];
          const done = !isRejected && currentOrder >= stepOrder;
          const active = !isRejected && currentOrder === stepOrder;

          return (
            <div key={step.statusKey} style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, zIndex: 2,
            }}>
              {/* Circle */}
              <div style={{
                width: active ? 32 : 26, height: active ? 32 : 26,
                borderRadius: '50%',
                background: isRejected && i === 0 ? C.red
                  : done ? (active ? C.accent : C.green)
                  : C.card,
                border: `2px solid ${isRejected && i === 0 ? C.red : done ? (active ? C.accent : C.green) : C.border}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: active ? 14 : 11,
                transition: 'all 0.2s',
                boxShadow: active ? `0 0 0 4px ${C.accent}30` : 'none',
              }}>
                {isRejected && i > 0 ? '' : (done ? (active ? step.icon : '✓') : step.icon)}
              </div>
              {/* Label */}
              <span style={{
                fontSize: 10, fontWeight: active ? 700 : 500,
                color: active ? C.accent : done ? C.text : C.textMuted,
                whiteSpace: 'nowrap',
              }}>
                {isKo ? step.labelKo : step.labelEn}
              </span>
            </div>
          );
        })}

        {/* Rejected overlay */}
        {isRejected && (
          <div style={{
            position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)',
            padding: '3px 10px', borderRadius: 12, background: `${C.red}20`,
            border: `1px solid ${C.red}40`, color: C.red, fontSize: 10, fontWeight: 700,
            zIndex: 3,
          }}>
            {isKo ? '거절됨' : 'Rejected'}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function LoadingState({ isKo }: { isKo: boolean }) {
  return (
    <div style={{ textAlign: 'center', padding: '60px 0', color: C.textMuted }}>
      <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.4 }}>⏳</div>
      <p style={{ margin: 0 }}>{isKo ? '불러오는 중...' : 'Loading...'}</p>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div style={{
      textAlign: 'center', padding: '60px 0', color: C.red,
      background: '#f8514912', borderRadius: 12, border: `1px solid ${C.red}30`,
    }}>
      <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
      <p style={{ margin: 0 }}>{message}</p>
    </div>
  );
}

function EmptyState({
  isKo,
  lang,
  router,
}: {
  isKo: boolean;
  lang: string;
  router: ReturnType<typeof useRouter>;
}) {
  return (
    <div style={{ textAlign: 'center', padding: '80px 0' }}>
      <div style={{ fontSize: 52, marginBottom: 16, opacity: 0.5 }}>📋</div>
      <h2 style={{ margin: '0 0 10px', fontSize: 18, color: C.text }}>
        {isKo ? '아직 견적 요청이 없습니다' : 'No quote requests yet'}
      </h2>
      <p style={{ margin: '0 0 24px', fontSize: 13, color: C.textMuted }}>
        {isKo
          ? '형상 생성기에서 형상을 설계한 뒤 견적을 요청하세요.'
          : 'Design a shape in the shape generator and submit an RFQ.'}
      </p>
      <button
        onClick={() => router.push(`/${lang}/shape-generator`)}
        style={{
          padding: '10px 26px',
          borderRadius: 8,
          border: 'none',
          background: 'linear-gradient(135deg, #388bfd, #8b5cf6)',
          color: '#fff',
          fontSize: 14,
          fontWeight: 700,
          cursor: 'pointer',
        }}
      >
        {isKo ? '형상 생성기로 이동' : 'Go to Shape Generator'}
      </button>
    </div>
  );
}

// ─── RFQ Card ─────────────────────────────────────────────────────────────────

interface RFQCardProps {
  rfq: RFQEntry;
  isKo: boolean;
  expanded: boolean;
  onToggle: () => void;
  onCompare?: () => void;
}

function RFQCard({ rfq, isKo, expanded, onToggle, onCompare }: RFQCardProps) {
  const meta = STATUS_META[rfq.status];
  const date = new Date(rfq.createdAt).toLocaleDateString(isKo ? 'ko-KR' : 'en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  });

  // Find best cost estimate
  const bestEst = rfq.costEstimates?.[0];

  return (
    <div style={{
      background: C.surface,
      border: `1px solid ${expanded ? C.accent : C.border}`,
      borderRadius: 12,
      overflow: 'hidden',
      transition: 'border-color 0.15s',
    }}>
      {/* Card header — always visible */}
      <button
        onClick={onToggle}
        style={{
          width: '100%',
          background: 'none',
          border: 'none',
          padding: '16px 20px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          textAlign: 'left',
          color: C.text,
        }}
      >
        {/* Shape icon */}
        <div style={{
          width: 42,
          height: 42,
          borderRadius: 10,
          background: C.card,
          border: `1px solid ${C.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 20,
          flexShrink: 0,
        }}>
          🧊
        </div>

        {/* Name + material */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: '0 0 2px', fontWeight: 700, fontSize: 14, color: C.text }}>
            {rfq.shapeName}
          </p>
          <p style={{ margin: 0, fontSize: 12, color: C.textMuted }}>
            {isKo ? '소재: ' : 'Material: '}{rfq.materialId}
            {' · '}
            {isKo ? '수량: ' : 'Qty: '}{rfq.quantity.toLocaleString()}
            {rfq.volume_cm3 > 0 && ` · ${rfq.volume_cm3.toFixed(1)} cm³`}
          </p>
        </div>

        {/* Cost estimate (if any) */}
        {bestEst && (
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <p style={{ margin: '0 0 2px', fontSize: 13, fontWeight: 700, color: C.accent }}>
              ${(bestEst.unitCost * rfq.quantity).toLocaleString()}
            </p>
            <p style={{ margin: 0, fontSize: 11, color: C.textMuted }}>
              {isKo ? '예상 금액' : 'Est. total'}
            </p>
          </div>
        )}

        {/* Status badge */}
        <div style={{
          padding: '4px 10px',
          borderRadius: 20,
          background: meta.bg,
          color: meta.color,
          fontSize: 11,
          fontWeight: 700,
          flexShrink: 0,
          whiteSpace: 'nowrap',
        }}>
          {isKo ? meta.labelKo : meta.labelEn}
        </div>

        {/* Date */}
        <div style={{ fontSize: 11, color: C.textMuted, flexShrink: 0 }}>
          {date}
        </div>

        {/* Chevron */}
        <div style={{
          fontSize: 10,
          color: C.textMuted,
          transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
          transition: 'transform 0.2s',
          flexShrink: 0,
        }}>
          ▼
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div style={{
          borderTop: `1px solid ${C.border}`,
          padding: '16px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}>

          {/* Progress timeline */}
          <RFQTimeline rfq={rfq} isKo={isKo} />

          {/* Cost estimates table */}
          {rfq.costEstimates && rfq.costEstimates.length > 0 && (
            <div>
              <p style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 700, color: C.textDim }}>
                {isKo ? '공정별 예상 비용' : 'Cost Estimates by Process'}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {rfq.costEstimates.map((est, i) => {
                  const pLabel = PROCESS_LABELS[est.process];
                  return (
                    <div key={i} style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      background: C.card,
                      borderRadius: 8,
                      padding: '8px 12px',
                    }}>
                      <span style={{ fontSize: 12, color: C.text, flex: 1 }}>
                        {pLabel ? (isKo ? pLabel.ko : pLabel.en) : est.process}
                      </span>
                      <span style={{ fontSize: 12, color: C.textMuted }}>
                        ${est.unitCost.toFixed(2)}{isKo ? '/개' : '/unit'}
                      </span>
                      <span style={{ fontSize: 12, color: C.textMuted }}>
                        {est.leadTime}
                      </span>
                      <ConfidenceBadge confidence={est.confidence} />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 제조사 배정 정보 */}
          {rfq.status === 'assigned' && rfq.assignedFactoryName && (
            <div style={{
              background: '#a78bfa15',
              border: '1px solid #a78bfa30',
              borderRadius: 8,
              padding: '10px 14px',
            }}>
              <p style={{ margin: '0 0 4px', fontSize: 12, fontWeight: 700, color: '#a78bfa' }}>
                {isKo ? '담당 제조사' : 'Assigned Manufacturer'}
              </p>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: C.text }}>
                {rfq.assignedFactoryName}
              </p>
              <p style={{ margin: '4px 0 0', fontSize: 11, color: C.textMuted }}>
                {isKo
                  ? '제조사가 배정됐습니다. 견적서 작성 중입니다.'
                  : 'A manufacturer has been assigned and is preparing your quote.'}
              </p>
            </div>
          )}

          {/* Quote amount from manufacturer */}
          {rfq.quoteAmount !== undefined && (
            <div style={{
              background: '#3fb95015',
              border: '1px solid #3fb95030',
              borderRadius: 8,
              padding: '10px 14px',
            }}>
              <p style={{ margin: '0 0 4px', fontSize: 12, fontWeight: 700, color: C.green }}>
                {isKo ? '제조사 견적가' : 'Manufacturer Quote'}
              </p>
              <p style={{ margin: 0, fontSize: 18, fontWeight: 800, color: C.text }}>
                ${rfq.quoteAmount.toLocaleString()}
              </p>
            </div>
          )}

          {/* Manufacturer note */}
          {rfq.manufacturerNote && (
            <div style={{
              background: C.card,
              borderRadius: 8,
              padding: '10px 14px',
            }}>
              <p style={{ margin: '0 0 4px', fontSize: 11, fontWeight: 700, color: C.textMuted }}>
                {isKo ? '제조사 메모' : 'Manufacturer Note'}
              </p>
              <p style={{ margin: 0, fontSize: 13, color: C.text }}>
                {rfq.manufacturerNote}
              </p>
            </div>
          )}

          {/* User note */}
          {rfq.note && (
            <div>
              <p style={{ margin: '0 0 4px', fontSize: 11, fontWeight: 700, color: C.textMuted }}>
                {isKo ? '요청 메모' : 'Request Note'}
              </p>
              <p style={{ margin: 0, fontSize: 13, color: C.text }}>{rfq.note}</p>
            </div>
          )}

          {/* RFQ ID footer */}
          <div style={{
            borderTop: `1px solid ${C.border}`,
            paddingTop: 10,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <span style={{ fontSize: 10, color: C.textMuted, fontFamily: 'monospace' }}>
              RFQ #{rfq.rfqId.slice(0, 8).toUpperCase()}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {(rfq.status === 'quoted' || rfq.status === 'accepted') && onCompare && (
                <button
                  onClick={e => { e.stopPropagation(); onCompare(); }}
                  style={{
                    padding: '4px 12px', borderRadius: 6,
                    border: `1px solid ${C.accent}`,
                    background: `${C.accent}15`, color: C.accent,
                    fontSize: 11, fontWeight: 700, cursor: 'pointer',
                    transition: 'all 0.12s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = C.accent; e.currentTarget.style.color = '#fff'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = `${C.accent}15`; e.currentTarget.style.color = C.accent; }}
                >
                  {isKo ? '견적 비교' : 'Compare Quotes'}
                </button>
              )}
              <span style={{ fontSize: 10, color: C.textMuted }}>
                {isKo ? '응답 예정: 24-48시간' : 'Est. response: 24-48h'}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Quote Compare Modal ──────────────────────────────────────────────────────

function QuoteCompareModal({
  rfqId, rfqName, isKo, onClose,
}: {
  rfqId: string;
  rfqName: string;
  isKo: boolean;
  onClose: () => void;
}) {
  const [quotes, setQuotes] = useState<QuoteForRFQ[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/nexyfab/rfq/${rfqId}/quotes`)
      .then(r => r.json())
      .then(d => { setQuotes(d.quotes ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [rfqId]);

  const min = quotes.reduce((m, q) => q.estimatedAmount < m ? q.estimatedAmount : m, Infinity);
  const max = quotes.reduce((m, q) => q.estimatedAmount > m ? q.estimatedAmount : m, 0);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 9999, padding: 20,
      }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{
        background: C.surface, borderRadius: 16, border: `1px solid ${C.border}`,
        width: '100%', maxWidth: 680, maxHeight: '85vh', overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 20px', borderBottom: `1px solid ${C.border}`,
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontSize: 15, fontWeight: 800, color: C.text }}>
              {isKo ? '견적 비교' : 'Quote Comparison'}
            </p>
            <p style={{ margin: 0, fontSize: 12, color: C.textMuted }}>{rfqName}</p>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: C.textMuted, fontSize: 18, cursor: 'pointer', lineHeight: 1 }}
          >✕</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
          {loading ? (
            <p style={{ textAlign: 'center', color: C.textMuted, padding: '40px 0' }}>
              {isKo ? '불러오는 중...' : 'Loading...'}
            </p>
          ) : quotes.length === 0 ? (
            <p style={{ textAlign: 'center', color: C.textMuted, padding: '40px 0' }}>
              {isKo ? '아직 수신된 견적이 없습니다' : 'No quotes received yet'}
            </p>
          ) : (
            <>
              {/* Summary bar */}
              <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
                {[
                  { label: isKo ? '총 견적 수' : 'Quotes', value: quotes.length.toString(), color: C.accent },
                  { label: isKo ? '최저가' : 'Lowest', value: `$${min.toLocaleString()}`, color: C.green },
                  { label: isKo ? '최고가' : 'Highest', value: `$${max.toLocaleString()}`, color: C.red },
                  { label: isKo ? '차이' : 'Spread', value: `$${(max - min).toLocaleString()}`, color: C.yellow },
                ].map((s, i) => (
                  <div key={i} style={{
                    flex: 1, background: C.card, borderRadius: 8, padding: '8px 10px', textAlign: 'center',
                    border: `1px solid ${C.border}`,
                  }}>
                    <p style={{ margin: '0 0 2px', fontSize: 10, color: C.textMuted }}>{s.label}</p>
                    <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: s.color }}>{s.value}</p>
                  </div>
                ))}
              </div>

              {/* Quote cards */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {quotes.map((q, i) => {
                  const isLowest = q.estimatedAmount === min;
                  const vsMin = min > 0 ? Math.round(((q.estimatedAmount - min) / min) * 100) : 0;
                  const expired = q.validUntil ? new Date(q.validUntil) < new Date() : false;
                  const barW = max > 0 ? Math.max(8, Math.round((q.estimatedAmount / max) * 100)) : 8;

                  return (
                    <div
                      key={q.id}
                      onClick={() => setSelected(selected === q.id ? null : q.id)}
                      style={{
                        background: C.card, borderRadius: 10, padding: '12px 14px',
                        border: `1px solid ${selected === q.id ? C.accent : isLowest ? C.green + '55' : C.border}`,
                        cursor: 'pointer', transition: 'border-color 0.15s',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, width: 18 }}>
                          #{i + 1}
                        </span>
                        <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: C.text }}>
                          {q.factoryName}
                        </span>
                        {isLowest && (
                          <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 10, background: `${C.green}22`, color: C.green, fontWeight: 700 }}>
                            {isKo ? '최저가' : 'BEST'}
                          </span>
                        )}
                        {expired && (
                          <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 10, background: `${C.red}22`, color: C.red, fontWeight: 700 }}>
                            {isKo ? '만료' : 'EXPIRED'}
                          </span>
                        )}
                        <span style={{ fontSize: 16, fontWeight: 800, color: isLowest ? C.green : C.text }}>
                          ${q.estimatedAmount.toLocaleString()}
                        </span>
                      </div>

                      {/* Price bar */}
                      <div style={{ height: 5, background: '#0d1117', borderRadius: 3, overflow: 'hidden', marginBottom: 6 }}>
                        <div style={{
                          width: `${barW}%`, height: '100%', borderRadius: 3,
                          background: isLowest ? C.green : C.accent,
                          transition: 'width 0.3s',
                        }} />
                      </div>

                      <div style={{ display: 'flex', gap: 12, fontSize: 11, color: C.textMuted }}>
                        {!isLowest && vsMin > 0 && (
                          <span style={{ color: C.yellow }}>+{vsMin}% {isKo ? '대비 최저가' : 'vs lowest'}</span>
                        )}
                        {q.estimatedDays && (
                          <span>⏱ {q.estimatedDays}{isKo ? '일' : 'd'}</span>
                        )}
                        {q.validUntil && (
                          <span>📅 {new Date(q.validUntil).toLocaleDateString(isKo ? 'ko-KR' : 'en-US', { month: 'short', day: 'numeric' })}</span>
                        )}
                      </div>

                      {selected === q.id && q.note && (
                        <div style={{
                          marginTop: 8, padding: '8px 10px', borderRadius: 6,
                          background: '#0d1117', border: `1px solid ${C.border}`,
                          fontSize: 12, color: C.textMuted, lineHeight: 1.5,
                        }}>
                          {q.note}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ConfidenceBadge({ confidence }: { confidence: string }) {
  const colorMap: Record<string, string> = {
    high: '#3fb950',
    medium: '#d29922',
    low: '#f85149',
  };
  const color = colorMap[confidence.toLowerCase()] ?? '#8b949e';
  return (
    <span style={{
      fontSize: 10,
      padding: '2px 6px',
      borderRadius: 4,
      background: `${color}20`,
      color,
      fontWeight: 700,
    }}>
      {confidence.toUpperCase()}
    </span>
  );
}
