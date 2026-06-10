'use client';

// B5 — Side-by-side multi-quote comparison.
//
// When 2+ manufacturers have quoted, the buyer needs to see them ranked
// side-by-side rather than one-row-each. This component:
//   - Lists quotes as columns
//   - Highlights "best in column" for price, lead time, validity
//   - Sort toggle: by price / by lead / by amount
//   - Each column has Accept/Reject inline
//
// Per memory rule (no single composite score): we don't compute an
// overall "winner" — buyer sees each dimension and decides their own
// priority weighting.

import React, { useState } from 'react';

interface QuoteForRFQ {
  id: string;
  factoryName: string;
  estimatedAmount: number;
  estimatedDays: number | null;
  note: string | null;
  status: string;
  validUntil: string | null;
}

const dict = {
  ko: {
    title: '🏆 견적 비교',
    subtitle: '차원별로 우수한 항목이 강조됩니다',
    sortBy: '정렬',
    sortPrice: '가격',
    sortLead: '납기',
    sortName: '제조사명',
    rowFactory: '제조사',
    rowPrice: '단가',
    rowLead: '납기 (영업일)',
    rowNote: '비고',
    rowValid: '유효 기한',
    rowAction: '결정',
    accept: '✓ 수락',
    reject: '✕ 거절',
    bestPrice: '최저가',
    bestLead: '최단납기',
    none: '—',
  },
  en: {
    title: '🏆 Quote comparison',
    subtitle: 'Best-in-dimension highlighted',
    sortBy: 'Sort',
    sortPrice: 'Price',
    sortLead: 'Lead',
    sortName: 'Name',
    rowFactory: 'Factory',
    rowPrice: 'Unit price',
    rowLead: 'Lead (biz days)',
    rowNote: 'Note',
    rowValid: 'Valid until',
    rowAction: 'Action',
    accept: '✓ Accept',
    reject: '✕ Decline',
    bestPrice: 'Lowest',
    bestLead: 'Fastest',
    none: '—',
  },
};

export interface QuoteComparisonViewProps {
  lang: 'ko' | 'en';
  quotes: QuoteForRFQ[];
  acting: string | null;
  onAction: (quoteId: string, action: 'accept' | 'reject') => void;
}

export default function QuoteComparisonView({ lang, quotes, acting, onAction }: QuoteComparisonViewProps) {
  const t = dict[lang];
  const [sortBy, setSortBy] = useState<'price' | 'lead' | 'name'>('price');

  if (quotes.length < 2) return null;  // single quote: use the existing row layout

  const sorted = quotes.slice().sort((a, b) => {
    if (sortBy === 'price') return a.estimatedAmount - b.estimatedAmount;
    if (sortBy === 'lead') return (a.estimatedDays ?? Infinity) - (b.estimatedDays ?? Infinity);
    return a.factoryName.localeCompare(b.factoryName);
  });

  const minPrice = Math.min(...quotes.map(q => q.estimatedAmount));
  const minLead = Math.min(...quotes.map(q => q.estimatedDays ?? Infinity));

  return (
    <div style={containerStyle}>
      <div style={headerRow}>
        <div>
          <div style={titleStyle}>{t.title}</div>
          <div style={subtitleStyle}>{t.subtitle}</div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#9ca3af' }}>{t.sortBy}</span>
          {([['price', t.sortPrice], ['lead', t.sortLead], ['name', t.sortName]] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setSortBy(key)}
              style={{
                ...sortBtn,
                background: sortBy === key ? '#1f6feb' : 'transparent',
                color: sortBy === key ? '#fff' : '#9ca3af',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thLabelStyle}>{t.rowFactory}</th>
              {sorted.map(q => (
                <th key={q.id} style={thCellStyle}>{q.factoryName}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={tdLabelStyle}>{t.rowPrice}</td>
              {sorted.map(q => {
                const best = q.estimatedAmount === minPrice;
                return (
                  <td key={q.id} style={{ ...tdCellStyle, background: best ? '#0d3819' : 'transparent' }}>
                    <div style={{ fontWeight: 700, color: best ? '#7ee787' : 'var(--nx-text)' }}>
                      {q.estimatedAmount.toLocaleString('ko-KR')}원
                    </div>
                    {best && <div style={badgeStyle}>{t.bestPrice}</div>}
                  </td>
                );
              })}
            </tr>
            <tr>
              <td style={tdLabelStyle}>{t.rowLead}</td>
              {sorted.map(q => {
                const best = q.estimatedDays !== null && q.estimatedDays === minLead;
                return (
                  <td key={q.id} style={{ ...tdCellStyle, background: best ? '#0d3819' : 'transparent' }}>
                    <div style={{ fontWeight: 700, color: best ? '#7ee787' : 'var(--nx-text)' }}>
                      {q.estimatedDays ?? t.none}
                    </div>
                    {best && q.estimatedDays !== null && <div style={badgeStyle}>{t.bestLead}</div>}
                  </td>
                );
              })}
            </tr>
            <tr>
              <td style={tdLabelStyle}>{t.rowNote}</td>
              {sorted.map(q => (
                <td key={q.id} style={tdCellStyle}>
                  <div style={{ fontSize: 11, color: 'var(--nx-text)', lineHeight: 1.4 }}>{q.note ?? t.none}</div>
                </td>
              ))}
            </tr>
            <tr>
              <td style={tdLabelStyle}>{t.rowValid}</td>
              {sorted.map(q => (
                <td key={q.id} style={tdCellStyle}>
                  <div style={{ fontSize: 11, color: 'var(--nx-text)' }}>{q.validUntil ?? t.none}</div>
                </td>
              ))}
            </tr>
            <tr>
              <td style={tdLabelStyle}>{t.rowAction}</td>
              {sorted.map(q => (
                <td key={q.id} style={tdCellStyle}>
                  <div style={{ display: 'flex', gap: 4, flexDirection: 'column' }}>
                    <button
                      onClick={() => onAction(q.id, 'accept')}
                      disabled={acting === q.id}
                      style={acceptBtn}
                    >
                      {acting === q.id ? '...' : t.accept}
                    </button>
                    <button
                      onClick={() => onAction(q.id, 'reject')}
                      disabled={!!acting}
                      style={rejectBtn}
                    >
                      {t.reject}
                    </button>
                  </div>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  background: 'var(--nx-bg)',
  border: '1px solid #1f6feb',
  borderRadius: 10,
  padding: 14,
  marginBottom: 12,
};
const headerRow: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
  marginBottom: 10, flexWrap: 'wrap', gap: 8,
};
const titleStyle: React.CSSProperties = { fontSize: 14, fontWeight: 800, color: '#79c0ff' };
const subtitleStyle: React.CSSProperties = { fontSize: 11, color: 'var(--nx-text-2)', marginTop: 2 };
const sortBtn: React.CSSProperties = {
  padding: '3px 10px', fontSize: 11, fontWeight: 600,
  borderRadius: 12, border: '1px solid var(--nx-border)', cursor: 'pointer',
};
const tableStyle: React.CSSProperties = {
  width: '100%', borderCollapse: 'collapse', fontSize: 12,
};
const thLabelStyle: React.CSSProperties = {
  textAlign: 'left', padding: '6px 8px',
  color: 'var(--nx-text-2)', fontWeight: 600, borderBottom: '1px solid var(--nx-border)',
};
const thCellStyle: React.CSSProperties = {
  padding: '6px 8px', fontSize: 12, fontWeight: 700, color: 'var(--nx-text)',
  borderBottom: '1px solid var(--nx-border)', textAlign: 'left',
};
const tdLabelStyle: React.CSSProperties = {
  padding: '8px', color: 'var(--nx-text-2)', fontSize: 11,
  borderTop: '1px solid var(--nx-panel-2)', verticalAlign: 'top', whiteSpace: 'nowrap',
};
const tdCellStyle: React.CSSProperties = {
  padding: '8px', borderTop: '1px solid var(--nx-panel-2)', verticalAlign: 'top',
};
const badgeStyle: React.CSSProperties = {
  marginTop: 4, display: 'inline-block',
  padding: '1px 6px', fontSize: 9, fontWeight: 700,
  background: '#7ee78722', color: '#7ee787', borderRadius: 8,
};
const acceptBtn: React.CSSProperties = {
  padding: '4px 10px', fontSize: 11, fontWeight: 700,
  borderRadius: 6, border: 'none',
  background: '#3fb950', color: '#fff', cursor: 'pointer',
};
const rejectBtn: React.CSSProperties = {
  padding: '4px 10px', fontSize: 11, fontWeight: 600,
  borderRadius: 6, border: '1px solid #f8514955',
  background: 'transparent', color: '#f85149', cursor: 'pointer',
};
