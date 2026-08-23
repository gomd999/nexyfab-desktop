'use client';

import Link from 'next/link';
import { useState, use, useEffect, useCallback } from 'react';
import { createCommercialLocalizer } from '@/lib/i18n/commercialLocalizer';
import { manufacturingRegion, manufacturingTerm } from '@/lib/i18n/manufacturingTerms';
import { formatNumber } from '@/lib/i18n/format';
import { toIsoLang, type IsoLang } from '@/lib/i18n/normalize';

// ─── Types ────────────────────────────────────────────────────────────────────

type ProcessType = string;
type PriceLevel = 'budget' | 'standard' | 'premium';
type SortKey = 'rating' | 'lead_time' | 'price';

const MIN_REVIEWS = 3;

interface Manufacturer {
  id: string;
  name: string;
  nameKo: string;
  region: string;
  processes: ProcessType[];
  certifications: string[];
  rating: number;
  reviewCount: number;
  priceLevel: PriceLevel;
  minLeadTime: number;
  maxLeadTime: number;
  description: string;
  descriptionKo: string;
  website: string | null;
  hasPartnerProfile: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 5;

const GRADIENT_PALETTE: [string, string][] = [
  ['#388bfd', '#1f6feb'],
  ['#f0883e', '#bd561d'],
  ['#3fb950', '#238636'],
  ['#a371f7', '#6e40c9'],
  ['#e3b341', '#9e6a03'],
  ['#79c0ff', '#388bfd'],
  ['#f85149', '#da3633'],
  ['#56d364', '#2ea043'],
];

function gradientForId(id: string): [string, string] {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) & 0xffff;
  return GRADIENT_PALETTE[hash % GRADIENT_PALETTE.length];
}

const PRICE_LABELS: Record<PriceLevel, { labels: Record<IsoLang, string>; color: string }> = {
  budget: { labels: { ko: '저가', en: 'Budget', ja: '低価格', zh: '经济型', es: 'Económico', ar: 'اقتصادي' }, color: '#3fb950' },
  standard: { labels: { ko: '표준', en: 'Standard', ja: '標準', zh: '标准', es: 'Estándar', ar: 'قياسي' }, color: '#e3b341' },
  premium: { labels: { ko: '프리미엄', en: 'Premium', ja: 'プレミアム', zh: '高级', es: 'Premium', ar: 'مميز' }, color: '#a371f7' },
};

function priceLabel(level: PriceLevel, lang: string): string {
  return PRICE_LABELS[level].labels[toIsoLang(lang)];
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function MarketplacePage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = use(params);
  const L = createCommercialLocalizer(lang);

  const [manufacturers, setManufacturers] = useState<Manufacturer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailManufacturer, setDetailManufacturer] = useState<Manufacturer | null>(null);

  const [searchText, setSearchText] = useState('');
  const [processFilter, setProcessFilter] = useState<string[]>([]);
  const [regionFilter, setRegionFilter] = useState<string[]>([]);
  const [certFilter, setCertFilter] = useState<string[]>([]);
  const [priceLevelFilter, setPriceLevelFilter] = useState<PriceLevel[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>('rating');
  const [page, setPage] = useState(1);

  // Start sidebar closed on mobile (< 768px)
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 768 : true
  );

  const loadManufacturers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/nexyfab/manufacturers');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { manufacturers: Manufacturer[] };
      setManufacturers(data.manufacturers ?? []);
    } catch {
      setError('LOAD_FAILED');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadManufacturers(); }, [loadManufacturers]);

  // Derive filter options from actual data
  const allProcesses = [...new Set(manufacturers.flatMap(m => m.processes))].sort();
  const allRegions   = [...new Set(manufacturers.map(m => m.region))].sort();
  const allCerts     = [...new Set(manufacturers.flatMap(m => m.certifications))].sort();

  function toggleArr<T>(arr: T[], val: T): T[] {
    return arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val];
  }

  // Filter
  const q = searchText.toLowerCase().trim();
  let filtered = manufacturers.filter(m => {
    if (q) {
      const processLabels = m.processes.flatMap(p => [
        manufacturingTerm(p, lang), manufacturingTerm(p, 'en'), p,
      ]).join(' ').toLowerCase();
      const certLabels = m.certifications.join(' ').toLowerCase();
      const searchable = [
        m.name, m.nameKo, m.description, m.descriptionKo,
        processLabels, certLabels,
      ].join(' ').toLowerCase();
      if (!searchable.includes(q)) return false;
    }
    if (processFilter.length > 0 && !processFilter.some(p => m.processes.includes(p))) return false;
    if (regionFilter.length > 0 && !regionFilter.includes(m.region)) return false;
    if (certFilter.length > 0 && !certFilter.some(c => m.certifications.includes(c))) return false;
    if (priceLevelFilter.length > 0 && !priceLevelFilter.includes(m.priceLevel)) return false;
    return true;
  });

  // Sort
  filtered = [...filtered].sort((a, b) => {
    if (sortKey === 'rating') {
      // 리뷰 3개 미만은 뒤로
      const aHas = a.reviewCount >= MIN_REVIEWS;
      const bHas = b.reviewCount >= MIN_REVIEWS;
      if (aHas && !bHas) return -1;
      if (!aHas && bHas) return 1;
      return b.rating - a.rating;
    }
    if (sortKey === 'lead_time') return a.minLeadTime - b.minLeadTime;
    if (sortKey === 'price') {
      const order: PriceLevel[] = ['budget', 'standard', 'premium'];
      return order.indexOf(a.priceLevel) - order.indexOf(b.priceLevel);
    }
    return 0;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const activeFilterCount = processFilter.length + regionFilter.length + certFilter.length + priceLevelFilter.length;

  return (
    <div style={{
      minHeight: '100vh', background: 'var(--nx-bg)',
      fontFamily: 'system-ui, -apple-system, sans-serif', color: 'var(--nx-text)',
    }}>
      {/* Header */}
      <div style={{
        borderBottom: '1px solid var(--nx-panel-2)', padding: '14px 32px',
        display: 'flex', alignItems: 'center', gap: 16,
        position: 'sticky', top: 0, background: 'var(--nx-bg)', zIndex: 10,
      }}>
        <Link prefetch href={`/${lang}/shape-generator`} style={{ fontSize: 18, fontWeight: 800, color: 'var(--nx-text)', textDecoration: 'none' }}>
          <span style={{ color: '#8b9cf4' }}>Nexy</span>Fab
        </Link>
        <span style={{ color: 'var(--nx-border)' }}>|</span>
        <span style={{ fontSize: 14, color: 'var(--nx-text-3)' }}>
          {L('제조사 마켓플레이스', 'Manufacturer Marketplace')}
        </span>
        <div style={{ flex: 1 }} />
        <div style={{
          display: 'flex', alignItems: 'center',
          background: 'var(--nx-panel)', border: '1px solid var(--nx-border)',
          borderRadius: 8, padding: '5px 12px', gap: 8,
          flex: '1 1 auto', maxWidth: 260,
        }}>
          <span style={{ fontSize: 13, color: 'var(--nx-text-2)' }}>🔍</span>
          <input
            value={searchText}
            onChange={e => { setSearchText(e.target.value); setPage(1); }}
            placeholder={L('제조사 검색...', 'Search manufacturers...')}
            style={{
              background: 'transparent', border: 'none', outline: 'none',
              color: 'var(--nx-text)', fontSize: 13, width: '100%', minWidth: 0,
            }}
          />
        </div>
        <a href={`/${lang}/nexyfab/orders`} style={{
          fontSize: 12, color: '#388bfd', textDecoration: 'none',
          padding: '5px 12px', borderRadius: 6, border: '1px solid #388bfd33', background: '#388bfd11',
        }}>
          {L('내 주문', 'My Orders')}
        </a>
      </div>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '28px 24px', display: 'flex', gap: 24 }}>

        {/* Sidebar */}
        <div style={{ width: sidebarOpen ? 220 : 40, flexShrink: 0, transition: 'width 0.2s', overflow: 'hidden' }}>
          <div style={{ width: 220 }}>
            <button
              onClick={() => setSidebarOpen(v => !v)}
              style={{
                background: 'transparent', border: 'none', color: 'var(--nx-text-2)',
                fontSize: 13, cursor: 'pointer', padding: '0 0 12px',
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              {sidebarOpen ? '◀' : '▶'}
              {sidebarOpen && (L('필터', 'Filters'))}
              {sidebarOpen && activeFilterCount > 0 && (
                <span style={{
                  background: '#388bfd', color: '#fff', borderRadius: 99,
                  fontSize: 10, fontWeight: 800, padding: '1px 6px',
                }}>
                  {activeFilterCount}
                </span>
              )}
            </button>

            {sidebarOpen && (
              <>
                <FilterSection title={L('정렬', 'Sort')}>
                  {(['rating', 'lead_time', 'price'] as SortKey[]).map(k => (
                    <FilterChip key={k} active={sortKey === k} onClick={() => { setSortKey(k); setPage(1); }}>
                      {k === 'rating' ? (L('평점순', 'Rating'))
                        : k === 'lead_time' ? (L('납기순', 'Lead Time'))
                        : (L('가격순', 'Price'))}
                    </FilterChip>
                  ))}
                </FilterSection>

                {allProcesses.length > 0 && (
                  <FilterSection title={L('공정 유형', 'Process Type')}>
                    {allProcesses.map(p => (
                      <FilterChip key={p} active={processFilter.includes(p)}
                        onClick={() => { setProcessFilter(v => toggleArr(v, p)); setPage(1); }}>
                        {manufacturingTerm(p, lang)}
                      </FilterChip>
                    ))}
                  </FilterSection>
                )}

                {allRegions.length > 1 && (
                  <FilterSection title={L('지역', 'Region')}>
                    {allRegions.map(r => (
                      <FilterChip key={r} active={regionFilter.includes(r)}
                        onClick={() => { setRegionFilter(v => toggleArr(v, r)); setPage(1); }}>
                        {manufacturingRegion(r, lang)}
                      </FilterChip>
                    ))}
                  </FilterSection>
                )}

                {allCerts.length > 0 && (
                  <FilterSection title={L('인증', 'Certifications')}>
                    {allCerts.map(c => (
                      <FilterChip key={c} active={certFilter.includes(c)}
                        onClick={() => { setCertFilter(v => toggleArr(v, c)); setPage(1); }}>
                        {c}
                      </FilterChip>
                    ))}
                  </FilterSection>
                )}

                <FilterSection title={L('가격 수준', 'Price Level')}>
                  {(['budget', 'standard', 'premium'] as PriceLevel[]).map(pl => (
                    <FilterChip key={pl} active={priceLevelFilter.includes(pl)}
                      color={PRICE_LABELS[pl].color}
                      onClick={() => { setPriceLevelFilter(v => toggleArr(v, pl)); setPage(1); }}>
                      {priceLabel(pl, lang)}
                    </FilterChip>
                  ))}
                </FilterSection>

                {activeFilterCount > 0 && (
                  <button
                    onClick={() => {
                      setProcessFilter([]); setRegionFilter([]);
                      setCertFilter([]); setPriceLevelFilter([]); setPage(1);
                    }}
                    style={{
                      width: '100%', marginTop: 4, padding: '7px 0',
                      background: 'transparent', border: '1px solid #f8514933',
                      borderRadius: 6, color: '#f85149', fontSize: 11,
                      cursor: 'pointer', fontWeight: 600,
                    }}
                  >
                    {L('필터 초기화', 'Clear filters')}
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Main content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>
              {L('제조사 목록', 'Manufacturers')}
            </h1>
            {!loading && (
              <span style={{ fontSize: 12, color: 'var(--nx-text-3)' }}>
                {filtered.length}{L('개', ' results')}
              </span>
            )}
            <div style={{ flex: 1 }} />
            {totalPages > 1 && (
              <span style={{ fontSize: 12, color: 'var(--nx-text-3)' }}>
                {page} / {totalPages} {L('페이지', 'pages')}
              </span>
            )}
          </div>

          {/* Loading skeletons */}
          {loading && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {[1, 2, 3].map(i => (
                <div key={i} style={{
                  background: 'var(--nx-panel)', border: '1px solid var(--nx-border)', borderRadius: 12,
                  padding: '18px 20px', height: 120,
                  animation: 'pulse 1.5s ease-in-out infinite',
                }} />
              ))}
            </div>
          )}

          {/* Error */}
          {!loading && error && (
            <div style={{
              background: 'var(--nx-panel)', border: '1px solid #f85149',
              borderRadius: 10, padding: '32px', textAlign: 'center', color: '#f85149',
            }}>
              {error === 'LOAD_FAILED'
                ? (L('데이터를 불러오지 못했습니다.', 'Failed to load manufacturers.'))
                : error}
              <br />
              <button onClick={loadManufacturers} style={{
                marginTop: 12, padding: '6px 16px', borderRadius: 6,
                background: '#f8514922', border: '1px solid #f85149',
                color: '#f85149', cursor: 'pointer', fontSize: 12, fontWeight: 600,
              }}>
                {L('다시 시도', 'Retry')}
              </button>
            </div>
          )}

          {/* Empty state */}
          {!loading && !error && filtered.length === 0 && (
            <div style={{
              background: 'var(--nx-panel)', border: '1px solid var(--nx-border)',
              borderRadius: 10, padding: '48px', textAlign: 'center', color: 'var(--nx-text-3)',
            }}>
              {manufacturers.length === 0
                ? (L('등록된 제조사가 없습니다.', 'No manufacturers registered yet.'))
                : (L('조건에 맞는 제조사가 없습니다.', 'No manufacturers match the selected filters.'))}
            </div>
          )}

          {/* Cards */}
          {!loading && !error && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {paginated.map(m => (
                <ManufacturerCard key={m.id} manufacturer={m} lang={lang} onViewDetail={setDetailManufacturer} />
              ))}
            </div>
          )}

          {/* Pagination */}
          {!loading && totalPages > 1 && (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 28 }}>
              <PageButton disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                ← {L('이전', 'Prev')}
              </PageButton>
              {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                const p = totalPages <= 7 ? i + 1
                  : page <= 4 ? i + 1
                  : page >= totalPages - 3 ? totalPages - 6 + i
                  : page - 3 + i;
                return (
                  <PageButton key={p} active={p === page} onClick={() => setPage(p)}>
                    {p}
                  </PageButton>
                );
              })}
              <PageButton disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                {L('다음', 'Next')} →
              </PageButton>
            </div>
          )}
        </div>
      </div>

      {/* Manufacturer detail drawer */}
      {detailManufacturer && (
        <ManufacturerDetailDrawer
          manufacturer={detailManufacturer}
          lang={lang}
          onClose={() => setDetailManufacturer(null)}
        />
      )}

    </div>
  );
}

// ─── ManufacturerDetailDrawer ─────────────────────────────────────────────────

function ManufacturerDetailDrawer({ manufacturer: m, lang, onClose }: {
  manufacturer: Manufacturer; lang: string; onClose: () => void;
}) {
  const L = createCommercialLocalizer(lang);
  const pl = PRICE_LABELS[m.priceLevel] ?? PRICE_LABELS.standard;
  const [gradFrom, gradTo] = gradientForId(m.id);
  const initials = L(m.nameKo || m.name, m.name).slice(0, 1);
  const desc = L(m.descriptionKo || m.description, m.description);

  function stars(rating: number) {
    const full = Math.round(rating);
    return '★'.repeat(full) + '☆'.repeat(5 - full);
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'stretch' }}>
      {/* Backdrop */}
      <div onClick={onClose} style={{ flex: 1, background: '#00000066' }} />

      {/* Drawer */}
      <div style={{
        width: 'min(calc(100vw - 24px), 420px)', background: 'var(--nx-panel)', borderLeft: '1px solid var(--nx-border)',
        display: 'flex', flexDirection: 'column', color: 'var(--nx-text)',
        fontFamily: 'system-ui, sans-serif', overflowY: 'auto',
      }}>
        {/* Header */}
        <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--nx-panel-2)', display: 'flex', gap: 14, alignItems: 'center' }}>
          <div style={{
            width: 52, height: 52, borderRadius: 12, flexShrink: 0,
            background: `linear-gradient(135deg, ${gradFrom}, ${gradTo})`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 22, fontWeight: 800, color: '#fff',
          }}>
            {initials}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 800 }}>{L(m.nameKo || m.name, m.name)}</div>
            <div style={{ fontSize: 12, color: 'var(--nx-text-3)', marginTop: 2 }}>
              📍 {manufacturingRegion(m.region, lang)}
              {m.hasPartnerProfile && (
                <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: '#388bfd18', color: '#388bfd' }}>
                  {L('파트너', 'Partner')}
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--nx-text-3)', cursor: 'pointer', fontSize: 20, padding: 4, flexShrink: 0 }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Rating + Price */}
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 10, color: 'var(--nx-text-3)', marginBottom: 4 }}>{L('평점', 'Rating')}</div>
              {m.reviewCount >= MIN_REVIEWS ? (
                <>
                  <div style={{ fontSize: 15, color: '#e3b341' }}>{stars(m.rating)}</div>
                  <div style={{ fontSize: 11, color: 'var(--nx-text-2)', marginTop: 2 }}>
                    {m.rating.toFixed(1)} ({formatNumber(m.reviewCount, lang) ?? m.reviewCount} {L('리뷰', 'reviews')})
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 11, color: 'var(--nx-text-3)', marginTop: 2 }}>
                  {L('리뷰 준비 중', 'No reviews yet')}
                  {m.reviewCount > 0 && (
                    <span style={{ marginLeft: 4, color: 'var(--nx-border)' }}>({m.reviewCount}/{MIN_REVIEWS})</span>
                  )}
                </div>
              )}
            </div>
            <div>
              <div style={{ fontSize: 10, color: 'var(--nx-text-3)', marginBottom: 4 }}>{L('가격 수준', 'Price Level')}</div>
              <div style={{
                fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 6,
                background: pl.color + '18', color: pl.color, display: 'inline-block',
              }}>
                {priceLabel(m.priceLevel, lang)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: 'var(--nx-text-3)', marginBottom: 4 }}>{L('납기', 'Lead Time')}</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--nx-text)' }}>
                {m.minLeadTime}–{m.maxLeadTime}{L('일', 'd')}
              </div>
            </div>
          </div>

          {/* Description */}
          {desc && (
            <div>
              <div style={{ fontSize: 10, color: 'var(--nx-text-3)', marginBottom: 6, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                {L('소개', 'About')}
              </div>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--nx-text)', lineHeight: 1.65 }}>{desc}</p>
            </div>
          )}

          {/* Processes */}
          {m.processes.length > 0 && (
            <div>
              <div style={{ fontSize: 10, color: 'var(--nx-text-3)', marginBottom: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                {L('공정 유형', 'Processes')}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {m.processes.map(p => (
                  <span key={p} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, background: 'var(--nx-panel-2)', color: 'var(--nx-text-2)', border: '1px solid var(--nx-border)' }}>
                    {manufacturingTerm(p, lang)}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Certifications */}
          {m.certifications.length > 0 && (
            <div>
              <div style={{ fontSize: 10, color: 'var(--nx-text-3)', marginBottom: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                {L('인증', 'Certifications')}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {m.certifications.map(c => (
                  <span key={c} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, background: '#388bfd11', color: '#388bfd', border: '1px solid #388bfd33' }}>
                    {c}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Website */}
          {m.website && (
            <div>
              <div style={{ fontSize: 10, color: 'var(--nx-text-3)', marginBottom: 6, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                {L('홈페이지', 'Website')}
              </div>
              <a href={m.website} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: '#388bfd', wordBreak: 'break-all' }}>
                🌐 {m.website}
              </a>
            </div>
          )}
        </div>

        {/* CTA */}
        <div style={{ padding: '14px 20px', borderTop: '1px solid var(--nx-panel-2)', display: 'flex', gap: 10 }}>
          <a
            href={`/${lang}/nexyfab/rfq?factoryId=${m.id}`}
            style={{
              flex: 1, display: 'block', padding: '10px 0', textAlign: 'center',
              borderRadius: 8, textDecoration: 'none',
              background: 'linear-gradient(135deg, #388bfd, #8b5cf6)',
              color: '#fff', fontSize: 13, fontWeight: 700,
            }}
          >
            {L('견적 요청', 'Request Quote')}
          </a>
        </div>
      </div>
    </div>
  );
}

// ─── ManufacturerCard ─────────────────────────────────────────────────────────

function ManufacturerCard({ manufacturer: m, lang, onViewDetail }: {
  manufacturer: Manufacturer; lang: string; onViewDetail: (m: Manufacturer) => void;
}) {
  const L = createCommercialLocalizer(lang);
  const [hovered, setHovered] = useState(false);
  const pl = PRICE_LABELS[m.priceLevel] ?? PRICE_LABELS.standard;
  const [gradFrom, gradTo] = gradientForId(m.id);
  const initials = L(m.nameKo || m.name, m.name).slice(0, 1);

  function stars(rating: number) {
    const full = Math.round(rating);
    return '★'.repeat(full) + '☆'.repeat(5 - full);
  }

  const desc = L(m.descriptionKo || m.description, m.description);

  return (
    <div
      style={{
        background: 'var(--nx-panel)',
        border: `1px solid ${hovered ? '#388bfd55' : 'var(--nx-border)'}`,
        borderRadius: 12, padding: '18px 20px',
        display: 'flex', gap: 18, alignItems: 'flex-start',
        transition: 'border-color 0.15s, transform 0.15s',
        transform: hovered ? 'translateY(-1px)' : 'none',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Logo */}
      <div style={{
        width: 54, height: 54, borderRadius: 12, flexShrink: 0,
        background: `linear-gradient(135deg, ${gradFrom}, ${gradTo})`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 24, fontWeight: 800, color: '#fff', userSelect: 'none',
      }}>
        {initials}
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--nx-text)' }}>
            {L(m.nameKo || m.name, m.name)}
          </span>
          <span style={{ fontSize: 11, color: 'var(--nx-text-3)' }}>
            📍 {manufacturingRegion(m.region, lang)}
          </span>
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 6,
            background: pl.color + '18', color: pl.color,
          }}>
            {priceLabel(m.priceLevel, lang)}
          </span>
          {m.hasPartnerProfile && (
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 6,
              background: '#388bfd18', color: '#388bfd',
            }}>
              {L('파트너', 'Partner')}
            </span>
          )}
        </div>

        {desc && (
          <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--nx-text-2)', lineHeight: 1.5 }}>
            {desc}
          </p>
        )}

        {/* Tags */}
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 10 }}>
          {m.processes.map(p => (
            <span key={p} style={{
              fontSize: 10, padding: '2px 8px', borderRadius: 5,
              background: 'var(--nx-panel-2)', color: 'var(--nx-text-2)', border: '1px solid var(--nx-border)',
            }}>
              {manufacturingTerm(p, lang)}
            </span>
          ))}
          {m.certifications.map(c => (
            <span key={c} style={{
              fontSize: 10, padding: '2px 8px', borderRadius: 5,
              background: '#388bfd11', color: '#388bfd', border: '1px solid #388bfd33',
            }}>
              {c}
            </span>
          ))}
        </div>

        {/* Rating + lead time */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 12, flexWrap: 'wrap' }}>
          {m.reviewCount >= MIN_REVIEWS ? (
            <>
              <span style={{ color: '#e3b341', letterSpacing: 1 }}>{stars(m.rating)}</span>
              <span style={{ color: 'var(--nx-text-2)' }}>
                {m.rating.toFixed(1)} ({formatNumber(m.reviewCount, lang) ?? m.reviewCount} {L('리뷰', 'reviews')})
              </span>
            </>
          ) : (
            <span style={{ color: 'var(--nx-text-3)', fontSize: 11 }}>{L('리뷰 준비 중', 'No reviews yet')}</span>
          )}
          <span style={{ color: 'var(--nx-text-3)' }}>|</span>
          <span style={{ color: 'var(--nx-text-2)' }}>
            {L(`납기 ${m.minLeadTime}–${m.maxLeadTime}일`, `Lead ${m.minLeadTime}–${m.maxLeadTime}d`)}
          </span>
          {m.website && (
            <>
              <span style={{ color: 'var(--nx-text-3)' }}>|</span>
              <a href={m.website} target="_blank" rel="noopener noreferrer"
                style={{ fontSize: 11, color: '#388bfd', textDecoration: 'none' }}>
                🌐 {L('홈페이지', 'Website')}
              </a>
            </>
          )}
        </div>
      </div>

      {/* CTA */}
      <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 100 }}>
        <a
          href={`/${lang}/nexyfab/rfq?factoryId=${m.id}`}
          style={{
            display: 'inline-block', padding: '9px 18px',
            borderRadius: 8, textDecoration: 'none',
            background: hovered ? 'linear-gradient(135deg, #388bfd, #8b5cf6)' : 'transparent',
            border: `1px solid ${hovered ? 'transparent' : '#388bfd'}`,
            color: hovered ? '#fff' : '#388bfd',
            fontSize: 12, fontWeight: 700,
            transition: 'background 0.15s, color 0.15s, border-color 0.15s',
            whiteSpace: 'nowrap',
          }}
        >
          {L('견적 요청', 'Request Quote')}
        </a>
        <button
          onClick={() => onViewDetail(m)}
          style={{
            display: 'block', padding: '7px 18px',
            borderRadius: 8, cursor: 'pointer',
            background: 'transparent',
            border: '1px solid var(--nx-border)',
            color: 'var(--nx-text-2)',
            fontSize: 12, fontWeight: 600,
            transition: 'border-color 0.15s, color 0.15s',
            whiteSpace: 'nowrap',
            textAlign: 'center',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--nx-text-2)'; e.currentTarget.style.color = 'var(--nx-text)'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--nx-border)'; e.currentTarget.style.color = 'var(--nx-text-2)'; }}
        >
          {L('상세 보기', 'View Details')}
        </button>
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function FilterSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <p style={{
        margin: '0 0 8px', fontSize: 11, fontWeight: 700,
        color: 'var(--nx-text-2)', textTransform: 'uppercase', letterSpacing: 0.5,
      }}>
        {title}
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        {children}
      </div>
    </div>
  );
}

function FilterChip({ active, onClick, color = '#388bfd', children }: {
  active: boolean; onClick: () => void; color?: string; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '3px 9px', borderRadius: 6, fontSize: 11, cursor: 'pointer',
        border: `1px solid ${active ? color : 'var(--nx-border)'}`,
        background: active ? color + '22' : 'transparent',
        color: active ? color : 'var(--nx-text-2)',
        fontWeight: active ? 700 : 400,
        transition: 'background 0.15s, color 0.15s',
      }}
    >
      {children}
    </button>
  );
}

function PageButton({ children, onClick, disabled, active }: {
  children: React.ReactNode; onClick: () => void; disabled?: boolean; active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '6px 12px', borderRadius: 6, fontSize: 12, cursor: disabled ? 'default' : 'pointer',
        border: `1px solid ${active ? '#388bfd' : 'var(--nx-border)'}`,
        background: active ? '#388bfd22' : 'transparent',
        color: disabled ? 'var(--nx-text-3)' : active ? '#388bfd' : 'var(--nx-text-2)',
        fontWeight: active ? 700 : 400,
        transition: 'background 0.15s',
      }}
    >
      {children}
    </button>
  );
}
