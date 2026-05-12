'use client';

// B4 — Auto-quote card. Fires on geometry availability and shows
// instant price + recommended process before the user picks anything
// manually. Falls through silently on error so the manual flow still
// works as the fallback.

import React, { useEffect, useState } from 'react';

interface ProcessCandidate {
  process: string;
  processName: string;
  material: string;
  materialName: string;
  rationale: string;
  estimatedUnitKrw: number;
  estimatedTotalKrw: number;
  leadTimeDays: number;
  confidence: 'high' | 'medium' | 'low';
}

interface AutoQuoteResp {
  ok: boolean;
  primary: ProcessCandidate;
  alternatives: ProcessCandidate[];
  classification: {
    sizeBand: string;
    wallProxy: string;
    complexity: number;
  };
}

const dict = {
  ko: {
    title: '⚡ 즉시 견적 (AI 추천)',
    subtitle: '업로드하신 파일을 자동 분석한 1차 추정입니다',
    leadTime: '납기',
    days: '일',
    perUnit: '단가',
    total: '총액',
    confidence: '신뢰도',
    confidenceHigh: '높음',
    confidenceMed: '보통',
    confidenceLow: '낮음',
    alternatives: '대안',
    refine: '아래에서 재질·공정 직접 선택해 정밀 견적',
    classification: '형상 분류',
    loading: '분석 중…',
  },
  en: {
    title: '⚡ Instant quote (AI pick)',
    subtitle: 'First-pass estimate from your uploaded file',
    leadTime: 'Lead',
    days: 'd',
    perUnit: 'Unit',
    total: 'Total',
    confidence: 'Confidence',
    confidenceHigh: 'High',
    confidenceMed: 'Med',
    confidenceLow: 'Low',
    alternatives: 'Alternatives',
    refine: 'Pick material + process below for a refined quote',
    classification: 'Shape',
    loading: 'Analyzing…',
  },
};

export interface AutoQuoteCardProps {
  lang: 'ko' | 'en';
  geometry: {
    volume_cm3: number;
    surface_area_cm2: number;
    bbox: { w: number; h: number; d: number };
  } | null;
  quantity: number;
  /** Called when the user clicks "use this" on a candidate — pre-fills
   *  the parent form so the manual estimate runs against this pick. */
  onApply: (process: string, material: string) => void;
}

const fmt = (n: number) => n.toLocaleString('ko-KR');

export default function AutoQuoteCard({ lang, geometry, quantity, onApply }: AutoQuoteCardProps) {
  const t = dict[lang];
  const [data, setData] = useState<AutoQuoteResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!geometry) { setData(null); return; }
    let cancelled = false;
    setLoading(true); setError(null);
    (async () => {
      try {
        const res = await fetch('/api/quick-quote/auto-quote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ geometry, quantity }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json() as AutoQuoteResp;
        if (!cancelled) setData(body);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [geometry, quantity]);

  if (!geometry) return null;
  if (loading) {
    return (
      <div style={cardStyle}>
        <div style={titleRow}>
          <span style={titleStyle}>{t.title}</span>
        </div>
        <div style={{ color: '#6b7280', fontSize: 13, padding: '12px 0' }}>{t.loading}</div>
      </div>
    );
  }
  if (error || !data) return null;  // silent fail — manual flow still available

  const confLabel = (c: ProcessCandidate['confidence']) =>
    c === 'high' ? t.confidenceHigh : c === 'medium' ? t.confidenceMed : t.confidenceLow;

  return (
    <div style={cardStyle}>
      <div style={titleRow}>
        <div>
          <div style={titleStyle}>{t.title}</div>
          <div style={subtitleStyle}>{t.subtitle}</div>
        </div>
        <div style={{ fontSize: 11, color: '#6b7280' }}>
          {t.classification}: {data.classification.sizeBand} · {data.classification.wallProxy} · cx{data.classification.complexity.toFixed(1)}
        </div>
      </div>

      <PrimaryCandidate cand={data.primary} t={t} confLabel={confLabel} onApply={onApply} highlighted />

      {data.alternatives.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            {t.alternatives}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
            {data.alternatives.map(alt => (
              <PrimaryCandidate key={alt.process} cand={alt} t={t} confLabel={confLabel} onApply={onApply} />
            ))}
          </div>
        </div>
      )}

      <div style={{ marginTop: 12, padding: '8px 12px', background: '#f8fafc', borderRadius: 6, fontSize: 12, color: '#475569' }}>
        💡 {t.refine}
      </div>
    </div>
  );
}

function PrimaryCandidate({
  cand, t, confLabel, onApply, highlighted = false,
}: {
  cand: ProcessCandidate;
  t: typeof dict.ko;
  confLabel: (c: ProcessCandidate['confidence']) => string;
  onApply: (process: string, material: string) => void;
  highlighted?: boolean;
}) {
  return (
    <div style={{
      padding: 12,
      background: highlighted ? '#eff6ff' : '#fff',
      border: highlighted ? '2px solid #3b82f6' : '1px solid #e5e7eb',
      borderRadius: 8,
      marginTop: highlighted ? 12 : 0,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>{cand.processName}</div>
          <div style={{ fontSize: 11, color: '#6b7280' }}>{cand.materialName}</div>
        </div>
        <span style={{
          padding: '2px 8px', fontSize: 10, fontWeight: 600,
          borderRadius: 10,
          background: cand.confidence === 'high' ? '#dcfce7' : cand.confidence === 'medium' ? '#fef3c7' : '#fee2e2',
          color: cand.confidence === 'high' ? '#166534' : cand.confidence === 'medium' ? '#854d0e' : '#991b1b',
        }}>
          {confLabel(cand.confidence)}
        </span>
      </div>
      <div style={{ fontSize: 11, color: '#475569', marginBottom: 8, lineHeight: 1.4 }}>{cand.rationale}</div>
      <div style={{ display: 'flex', gap: 12, fontSize: 12, color: '#374151', marginBottom: 8, alignItems: 'baseline' }}>
        <span><strong>{t.perUnit}</strong> {fmt(cand.estimatedUnitKrw)}원</span>
        <span><strong>{t.total}</strong> {fmt(cand.estimatedTotalKrw)}원</span>
        <span style={{ color: '#6b7280' }}>{t.leadTime} {cand.leadTimeDays}{t.days}</span>
      </div>
      <button
        onClick={() => onApply(cand.process, cand.material)}
        style={{
          padding: '6px 14px', fontSize: 11, fontWeight: 700,
          background: highlighted ? '#3b82f6' : '#fff',
          color: highlighted ? '#fff' : '#3b82f6',
          border: '1px solid #3b82f6',
          borderRadius: 6,
          cursor: 'pointer',
        }}
      >
        {highlighted ? '이 추천으로 진행 →' : '이 옵션 선택'}
      </button>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  padding: 16,
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 10,
  marginBottom: 16,
  boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
};
const titleRow: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
  marginBottom: 12,
};
const titleStyle: React.CSSProperties = { fontSize: 14, fontWeight: 700, color: '#111827' };
const subtitleStyle: React.CSSProperties = { fontSize: 11, color: '#6b7280', marginTop: 2 };
