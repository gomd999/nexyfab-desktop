'use client';

import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { COTS_PARTS, COTSPart } from '@/app/[lang]/shape-generator/cots/cotsData';
import { isKorean } from '@/lib/i18n/normalize';

// Handoff key — the COTS selection is stashed here so the RFQ page can pick it
// up and prefill the request (previously the "Send RFQ" link dropped the
// selection entirely). (2026-06-09 follow-up #1)
const COTS_RFQ_STASH_KEY = 'nexyfab_cots_rfq';

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
  const isKo = isKorean(lang);
  const router = useRouter();

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

  const formatParams = (keyValues: Record<string, number>) =>
    Object.entries(keyValues)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--nx-bg)',
      color: 'var(--nx-text)',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      {/* Header */}
      <div style={{
        borderBottom: '1px solid var(--nx-panel-2)',
        padding: '20px 28px',
        position: 'sticky',
        top: 0,
        background: 'var(--nx-bg)',
        zIndex: 10,
      }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>
          🔩 {isKo ? 'COTS 부품 카탈로그' : 'COTS Parts Catalog'}
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--nx-text-3)' }}>
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
                background: 'var(--nx-panel)',
                border: '1px solid var(--nx-border)',
                color: 'var(--nx-text)',
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
                    border: `1px solid ${category === cat ? 'var(--nx-accent)' : 'var(--nx-border)'}`,
                    background: category === cat ? '#388bfd1a' : 'transparent',
                    color: category === cat ? 'var(--nx-accent)' : 'var(--nx-text-2)',
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
          <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--nx-text-3)' }}>
            {filtered.length}{isKo ? '개 부품' : ' parts'}
          </p>

          {/* Table */}
          <div style={{
            background: 'var(--nx-panel)',
            border: '1px solid var(--nx-border)',
            borderRadius: 10,
            overflow: 'hidden',
          }}>
            <table style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 12,
            }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--nx-border)', background: 'var(--nx-bg)' }}>
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
                        color: 'var(--nx-text-2)',
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
                    <td colSpan={8} style={{ padding: '40px', textAlign: 'center', color: 'var(--nx-text-3)' }}>
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
                          borderBottom: idx < filtered.length - 1 ? '1px solid var(--nx-panel-2)' : 'none',
                          transition: 'background 0.1s',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'var(--nx-panel-2)'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                      >
                        <td style={{ padding: '9px 12px', color: 'var(--nx-text-3)', fontFamily: 'monospace', fontSize: 11 }}>
                          {part.id}
                        </td>
                        <td style={{ padding: '9px 12px', color: 'var(--nx-text)', fontWeight: 600 }}>
                          {isKo ? part.nameKo : part.name}
                        </td>
                        <td style={{ padding: '9px 12px', color: 'var(--nx-text-2)', whiteSpace: 'nowrap' }}>
                          {part.standard}
                        </td>
                        <td style={{ padding: '9px 12px', color: 'var(--nx-text-2)', fontFamily: 'monospace', fontSize: 11 }}>
                          {formatParams(part.params)}
                        </td>
                        <td style={{ padding: '9px 12px', color: 'var(--nx-text-2)', textAlign: 'right' }}>
                          {part.unitWeightG}
                        </td>
                        <td style={{ padding: '9px 12px', color: 'var(--nx-ok)', fontWeight: 600, textAlign: 'right' }}>
                          {part.unitPriceKRW.toLocaleString()}
                        </td>
                        <td style={{ padding: '9px 12px', color: 'var(--nx-text-2)' }}>
                          {part.suppliers.join(', ')}
                        </td>
                        <td style={{ padding: '9px 12px', textAlign: 'right' }}>
                          <button
                            onClick={() => inQuote ? removeFromQuote(part.id) : addToQuote(part)}
                            style={{
                              padding: '4px 10px',
                              borderRadius: 6,
                              border: `1px solid ${inQuote ? 'var(--nx-ok)' : 'var(--nx-accent)'}`,
                              background: inQuote ? '#3fb9501a' : '#388bfd1a',
                              color: inQuote ? 'var(--nx-ok)' : 'var(--nx-accent)',
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
            borderLeft: '1px solid var(--nx-border)',
            background: 'var(--nx-panel)',
            overflowY: 'auto',
            padding: '20px 16px',
            flexShrink: 0,
          }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700, color: 'var(--nx-text)' }}>
              💬 {isKo ? '선택된 부품' : 'Selected Parts'} ({selected.length})
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
              {selected.map(part => (
                <div key={part.id} style={{
                  background: 'var(--nx-bg)',
                  border: '1px solid var(--nx-border)',
                  borderRadius: 8,
                  padding: '10px 12px',
                  position: 'relative',
                }}>
                  <p style={{ margin: '0 0 2px', fontSize: 12, fontWeight: 600, color: 'var(--nx-text)', paddingRight: 20 }}>
                    {isKo ? part.nameKo : part.name}
                  </p>
                  <p style={{ margin: 0, fontSize: 11, color: 'var(--nx-ok)' }}>
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
                      color: 'var(--nx-text-3)',
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
              borderTop: '1px solid var(--nx-border)',
              paddingTop: 12,
              marginBottom: 12,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span style={{ color: 'var(--nx-text-2)' }}>{isKo ? '소계' : 'Subtotal'}</span>
                <span style={{ fontWeight: 700, color: 'var(--nx-text)' }}>
                  ₩{selected.reduce((s, p) => s + p.unitPriceKRW, 0).toLocaleString()}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                try {
                  const payload = selected.map(p => ({
                    id: p.id, name: p.name, nameKo: p.nameKo,
                    standard: p.standard, qty: 1, unitPriceKRW: p.unitPriceKRW,
                  }));
                  sessionStorage.setItem(COTS_RFQ_STASH_KEY, JSON.stringify(payload));
                } catch { /* ignore */ }
                router.push(`/${lang}/nexyfab/rfq?from=cots`);
              }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'center',
                padding: '10px 0',
                border: 'none',
                borderRadius: 8,
                background: 'linear-gradient(135deg, var(--nx-accent), #8b5cf6)',
                color: '#fff',
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'opacity 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.opacity = '0.85'; }}
              onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
            >
              {isKo ? '견적 요청하기 →' : 'Send RFQ →'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
