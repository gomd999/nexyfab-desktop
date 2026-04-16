'use client';

import { use, useState } from 'react';
import { COTS_PARTS, COTSPart } from '@/app/[lang]/shape-generator/cots/cotsData';

const CATEGORIES = ['All', 'bolt', 'nut', 'bearing', 'collar', 'clip', 'washer'] as const;
type Category = (typeof CATEGORIES)[number];

const CATEGORY_LABELS: Record<Category, { ko: string; en: string }> = {
  All:     { ko: '전체', en: 'All' },
  bolt:    { ko: '볼트', en: 'Bolt' },
  nut:     { ko: '너트', en: 'Nut' },
  bearing: { ko: '베어링', en: 'Bearing' },
  collar:  { ko: '칼라', en: 'Collar' },
  clip:    { ko: '클립', en: 'Clip' },
  washer:  { ko: '와셔', en: 'Washer' },
};

export default function CotsPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = use(params);
  const isKo = lang === 'ko';

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<Category>('All');
  const [selected, setSelected] = useState<COTSPart[]>([]);

  const filtered = COTS_PARTS.filter(p => {
    const matchCat = category === 'All' || p.category === category;
    const q = search.toLowerCase();
    const matchSearch =
      !q ||
      p.id.toLowerCase().includes(q) ||
      p.name.toLowerCase().includes(q) ||
      p.nameKo.includes(q) ||
      p.standard.toLowerCase().includes(q) ||
      p.suppliers.some(s => s.toLowerCase().includes(q));
    return matchCat && matchSearch;
  });

  const addToQuote = (part: COTSPart) => {
    setSelected(prev =>
      prev.find(p => p.id === part.id) ? prev : [...prev, part]
    );
  };

  const removeFromQuote = (id: string) => {
    setSelected(prev => prev.filter(p => p.id !== id));
  };

  const formatParams = (params: Record<string, number>) =>
    Object.entries(params)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0d1117',
      color: '#e6edf3',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      {/* Header */}
      <div style={{
        borderBottom: '1px solid #21262d',
        padding: '20px 28px',
        position: 'sticky',
        top: 0,
        background: '#0d1117',
        zIndex: 10,
      }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>
          🔩 {isKo ? 'COTS 부품 카탈로그' : 'COTS Parts Catalog'}
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6e7681' }}>
          {isKo
            ? '규격 부품을 검색하고 견적에 추가하세요'
            : 'Search standard parts and add them to your RFQ'}
        </p>
      </div>

      <div style={{ display: 'flex', gap: 0, height: 'calc(100vh - 81px)' }}>
        {/* Main content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 28px' }}>
          {/* Search + filter bar */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={isKo ? '부품명, 규격, 공급사 검색...' : 'Search parts, standards, suppliers...'}
              style={{
                flex: 1,
                minWidth: 220,
                padding: '8px 12px',
                borderRadius: 8,
                background: '#161b22',
                border: '1px solid #30363d',
                color: '#e6edf3',
                fontSize: 13,
                outline: 'none',
              }}
            />
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {CATEGORIES.map(cat => (
                <button
                  key={cat}
                  onClick={() => setCategory(cat)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 6,
                    border: `1px solid ${category === cat ? '#388bfd' : '#30363d'}`,
                    background: category === cat ? '#388bfd1a' : 'transparent',
                    color: category === cat ? '#388bfd' : '#8b949e',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.12s',
                  }}
                >
                  {isKo ? CATEGORY_LABELS[cat].ko : CATEGORY_LABELS[cat].en}
                </button>
              ))}
            </div>
          </div>

          {/* Count */}
          <p style={{ margin: '0 0 12px', fontSize: 12, color: '#6e7681' }}>
            {filtered.length}{isKo ? '개 부품' : ' parts'}
          </p>

          {/* Table */}
          <div style={{
            background: '#161b22',
            border: '1px solid #30363d',
            borderRadius: 10,
            overflow: 'hidden',
          }}>
            <table style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 12,
            }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #30363d', background: '#0d1117' }}>
                  {[
                    isKo ? 'ID' : 'ID',
                    isKo ? '이름' : 'Name',
                    isKo ? '규격' : 'Standard',
                    isKo ? '파라미터' : 'Parameters',
                    isKo ? '무게(g)' : 'Weight(g)',
                    isKo ? '단가(₩)' : 'Price(₩)',
                    isKo ? '공급사' : 'Suppliers',
                    '',
                  ].map((h, i) => (
                    <th
                      key={i}
                      style={{
                        padding: '10px 12px',
                        textAlign: 'left',
                        color: '#8b949e',
                        fontWeight: 600,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ padding: '40px', textAlign: 'center', color: '#6e7681' }}>
                      {isKo ? '검색 결과가 없습니다' : 'No results found'}
                    </td>
                  </tr>
                ) : (
                  filtered.map((part, idx) => {
                    const inQuote = selected.some(p => p.id === part.id);
                    return (
                      <tr
                        key={part.id}
                        style={{
                          borderBottom: idx < filtered.length - 1 ? '1px solid #21262d' : 'none',
                          transition: 'background 0.1s',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = '#1c2128'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                      >
                        <td style={{ padding: '9px 12px', color: '#6e7681', fontFamily: 'monospace', fontSize: 11 }}>
                          {part.id}
                        </td>
                        <td style={{ padding: '9px 12px', color: '#e6edf3', fontWeight: 600 }}>
                          {isKo ? part.nameKo : part.name}
                        </td>
                        <td style={{ padding: '9px 12px', color: '#8b949e', whiteSpace: 'nowrap' }}>
                          {part.standard}
                        </td>
                        <td style={{ padding: '9px 12px', color: '#8b949e', fontFamily: 'monospace', fontSize: 11 }}>
                          {formatParams(part.params)}
                        </td>
                        <td style={{ padding: '9px 12px', color: '#8b949e', textAlign: 'right' }}>
                          {part.unitWeightG}
                        </td>
                        <td style={{ padding: '9px 12px', color: '#3fb950', fontWeight: 600, textAlign: 'right' }}>
                          {part.unitPriceKRW.toLocaleString()}
                        </td>
                        <td style={{ padding: '9px 12px', color: '#8b949e' }}>
                          {part.suppliers.join(', ')}
                        </td>
                        <td style={{ padding: '9px 12px', textAlign: 'right' }}>
                          <button
                            onClick={() => inQuote ? removeFromQuote(part.id) : addToQuote(part)}
                            style={{
                              padding: '4px 10px',
                              borderRadius: 6,
                              border: `1px solid ${inQuote ? '#3fb950' : '#388bfd'}`,
                              background: inQuote ? '#3fb9501a' : '#388bfd1a',
                              color: inQuote ? '#3fb950' : '#388bfd',
                              fontSize: 11,
                              fontWeight: 600,
                              cursor: 'pointer',
                              whiteSpace: 'nowrap',
                              transition: 'all 0.12s',
                            }}
                          >
                            {inQuote
                              ? (isKo ? '✓ 추가됨' : '✓ Added')
                              : (isKo ? '+ 견적 추가' : '+ Add to RFQ')}
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* RFQ sidebar */}
        {selected.length > 0 && (
          <div style={{
            width: 260,
            minWidth: 260,
            borderLeft: '1px solid #30363d',
            background: '#161b22',
            overflowY: 'auto',
            padding: '20px 16px',
            flexShrink: 0,
          }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700, color: '#e6edf3' }}>
              💬 {isKo ? '선택된 부품' : 'Selected Parts'} ({selected.length})
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
              {selected.map(part => (
                <div key={part.id} style={{
                  background: '#0d1117',
                  border: '1px solid #30363d',
                  borderRadius: 8,
                  padding: '10px 12px',
                  position: 'relative',
                }}>
                  <p style={{ margin: '0 0 2px', fontSize: 12, fontWeight: 600, color: '#e6edf3', paddingRight: 20 }}>
                    {isKo ? part.nameKo : part.name}
                  </p>
                  <p style={{ margin: 0, fontSize: 11, color: '#3fb950' }}>
                    ₩{part.unitPriceKRW.toLocaleString()}
                  </p>
                  <button
                    onClick={() => removeFromQuote(part.id)}
                    style={{
                      position: 'absolute',
                      top: 8,
                      right: 8,
                      background: 'none',
                      border: 'none',
                      color: '#6e7681',
                      cursor: 'pointer',
                      fontSize: 12,
                      padding: 0,
                      lineHeight: 1,
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <div style={{
              borderTop: '1px solid #30363d',
              paddingTop: 12,
              marginBottom: 12,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span style={{ color: '#8b949e' }}>{isKo ? '소계' : 'Subtotal'}</span>
                <span style={{ fontWeight: 700, color: '#e6edf3' }}>
                  ₩{selected.reduce((s, p) => s + p.unitPriceKRW, 0).toLocaleString()}
                </span>
              </div>
            </div>
            <a
              href={`/${lang}/nexyfab/rfq`}
              style={{
                display: 'block',
                textAlign: 'center',
                padding: '10px 0',
                borderRadius: 8,
                background: 'linear-gradient(135deg, #388bfd, #8b5cf6)',
                color: '#fff',
                fontSize: 13,
                fontWeight: 700,
                textDecoration: 'none',
                transition: 'opacity 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.opacity = '0.85'; }}
              onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
            >
              {isKo ? '견적 요청하기 →' : 'Send RFQ →'}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
