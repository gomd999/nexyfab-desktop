'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';

const UpgradePrompt = dynamic(() => import('../freemium/UpgradePrompt'), { ssr: false });

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Manufacturer {
  id: string;
  name: string;
  nameKo: string;
  region: string;
  processes: string[];
  minLeadTime: number;
  maxLeadTime: number;
  rating: number;
  reviewCount: number;
  priceLevel: 'low' | 'medium' | 'high';
  certifications: string[];
  description: string;
  descriptionKo: string;
}

interface ManufacturerMatchProps {
  process?: string;
  volume_cm3?: number;
  materialId?: string;
  bbox?: { w: number; h: number; d: number };
  lang?: string;
  partName?: string;
  /** Approximate triangle count — a complexity signal (organic shapes favor 3D printing). */
  triangleCount?: number;
  /** Whether the design has overhangs/undercuts that would be impossible on CNC. */
  hasUndercuts?: boolean;
  onSelectManufacturer: (m: Manufacturer) => void;
}

interface QuoteState {
  manufacturer: Manufacturer;
  quantity: number;
  submitting: boolean;
  orderId?: string;  // set on success
  error?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const C = {
  bg: '#161b22',
  card: '#21262d',
  border: '#30363d',
  text: '#c9d1d9',
  textDim: '#8b949e',
  textMuted: '#6e7681',
  accent: '#388bfd',
  green: '#3fb950',
  yellow: '#d29922',
};

const REGION_FLAGS: Record<string, string> = {
  KR: '🇰🇷',
  US: '🇺🇸',
  DE: '🇩🇪',
  CN: '🇨🇳',
  JP: '🇯🇵',
};

const REGION_LABELS: Record<string, { en: string; ko: string }> = {
  KR: { en: 'Korea',  ko: '한국' },
  US: { en: 'USA',    ko: '미국' },
  DE: { en: 'Germany',ko: '독일' },
  CN: { en: 'China',  ko: '중국' },
  JP: { en: 'Japan',  ko: '일본' },
};

const PROCESS_LABELS: Record<string, { en: string; ko: string }> = {
  cnc_milling:       { en: 'CNC Milling',       ko: 'CNC 밀링' },
  cnc_turning:       { en: 'CNC Turning',        ko: 'CNC 선반' },
  injection_molding: { en: 'Injection Molding',  ko: '사출 성형' },
  sheet_metal:       { en: 'Sheet Metal',        ko: '판금 가공' },
  casting:           { en: 'Casting',            ko: '주조' },
  '3d_printing':     { en: '3D Printing',        ko: '3D 프린팅' },
};

const PRICE_META: Record<string, { labelEn: string; labelKo: string; color: string }> = {
  low:    { labelEn: 'Low',    labelKo: '저가',   color: '#3fb950' },
  medium: { labelEn: 'Medium', labelKo: '중가',   color: '#d29922' },
  high:   { labelEn: 'High',   labelKo: '고가',   color: '#f0883e' },
};

// Rough KRW-per-cm³ for a finished part, covering material + machining + margin.
// Order-of-magnitude only — real quotes come from the mfr after RFQ review.
const MATERIAL_BASE_KRW_PER_CM3: Record<string, number> = {
  aluminum:        350,
  steel:           280,
  stainless_steel: 520,
  titanium:        1800,
  copper:          900,
  brass:           750,
  abs:             120,
  pla:             90,
  nylon:           180,
  pc:              220,
  resin:           260,
  wood:            80,
  default:         300,
};

const PRICE_LEVEL_MULT: Record<'low' | 'medium' | 'high', number> = {
  low:    0.8,
  medium: 1.0,
  high:   1.35,
};

const MIN_ORDER_KRW = 30_000;

function estimateOrderTotalKRW(
  volume_cm3: number | undefined,
  materialId: string | undefined,
  priceLevel: 'low' | 'medium' | 'high',
  quantity: number,
): number {
  const vol = volume_cm3 && volume_cm3 > 0 ? volume_cm3 : 10;
  const base = MATERIAL_BASE_KRW_PER_CM3[materialId ?? ''] ?? MATERIAL_BASE_KRW_PER_CM3.default;
  const unit = vol * base * PRICE_LEVEL_MULT[priceLevel];
  return Math.max(MIN_ORDER_KRW, Math.round(unit * Math.max(1, quantity)));
}

type SortKey = 'match' | 'lead_time' | 'rating' | 'price';

const ALL_REGIONS = ['KR', 'US', 'DE', 'CN', 'JP'];
const ALL_PROCESSES = Object.keys(PROCESS_LABELS);

// ─── Material → best processes ───────────────────────────────────────────────

const MATERIAL_PROCESS_AFFINITY: Record<string, string[]> = {
  aluminum:        ['cnc_milling', 'cnc_turning', 'sheet_metal', '3d_printing'],
  steel:           ['cnc_milling', 'cnc_turning', 'casting', 'sheet_metal'],
  stainless_steel: ['cnc_milling', 'cnc_turning', '3d_printing'],
  titanium:        ['3d_printing', 'cnc_milling', 'cnc_turning'],
  copper:          ['cnc_milling', 'cnc_turning', 'casting'],
  brass:           ['cnc_milling', 'cnc_turning'],
  abs:             ['3d_printing', 'injection_molding'],
  pla:             ['3d_printing'],
  nylon:           ['3d_printing', 'injection_molding'],
  pc:              ['3d_printing', 'injection_molding'],
  resin:           ['3d_printing'],
  wood:            ['cnc_milling'],
  default:         ['cnc_milling', 'cnc_turning', '3d_printing'],
};

// Materials where 3D printing is a viable / often-preferred route
const PRINTABLE_MATERIALS = new Set([
  'abs', 'pla', 'nylon', 'pc', 'resin', 'aluminum', 'titanium', 'stainless_steel',
]);

/**
 * Compute a 0-100 match score for a manufacturer given the current shape context.
 * Components:
 *  - Process affinity (0–40 pts): does this mfr handle a process that suits the material?
 *  - Size fit (0–25 pts): estimated bounding box vs typical mfr capacity
 *  - Rating (0–20 pts): proportional to 5-star rating
 *  - Lead time (0–15 pts): shorter is better (≤5d = max)
 */
function computeMatchScore(
  m: Manufacturer,
  materialId: string | undefined,
  bbox: { w: number; h: number; d: number } | undefined,
  ctx?: { triangleCount?: number; hasUndercuts?: boolean },
): number {
  let score = 0;

  // ── Compute "3D printing preference" signal ──
  // Strong when: small parts, complex geometry (high tri count), undercuts,
  // or material is a printable polymer.
  const maxDim = bbox ? Math.max(bbox.w, bbox.h, bbox.d) : 150;
  const isPrintable = PRINTABLE_MATERIALS.has(materialId ?? '');
  const triCount = ctx?.triangleCount ?? 0;
  const isComplex = triCount > 5000;
  const isVeryComplex = triCount > 20000;
  const isSmall = maxDim < 100;
  const hasUndercuts = ctx?.hasUndercuts ?? false;

  // Score 0–4 — higher means "3D printing is a strong fit"
  let printPreferenceScore = 0;
  if (isPrintable)    printPreferenceScore += 1;
  if (isSmall)        printPreferenceScore += 1;
  if (isComplex)      printPreferenceScore += 1;
  if (isVeryComplex)  printPreferenceScore += 1;
  if (hasUndercuts)   printPreferenceScore += 2; // CNC literally cannot machine undercuts
  const prefersPrinting = printPreferenceScore >= 2;

  // ── Process affinity (0–45 pts) ──
  const affinities = MATERIAL_PROCESS_AFFINITY[materialId ?? ''] ?? MATERIAL_PROCESS_AFFINITY.default;
  const hasAffinity = m.processes.some(p => affinities.includes(p));
  const primaryMatch = m.processes[0] && affinities[0] && m.processes[0] === affinities[0];
  const offers3DPrinting = m.processes.includes('3d_printing');

  let affinityScore = hasAffinity ? (primaryMatch ? 40 : 28) : 8;
  // Boost manufacturers offering 3D printing when the part prefers it
  if (prefersPrinting && offers3DPrinting) {
    affinityScore = Math.max(affinityScore, 40) + Math.min(5, printPreferenceScore);
  }
  // Penalize CNC-only shops for undercut-heavy parts
  if (hasUndercuts && !offers3DPrinting) {
    affinityScore -= 10;
  }
  score += Math.max(0, affinityScore);

  // ── Size fit (0–25 pts) ──
  const sizeScore =
    maxDim < 50   ? (m.minLeadTime <= 5 ? 25 : 18)  // micro parts: fast shops preferred
    : maxDim < 300 ? 25
    : maxDim < 600 ? 20
    : 12;                                              // very large — not all can handle
  // Small parts → 3D printing shops are extra fast-turnaround friendly
  score += isSmall && offers3DPrinting ? sizeScore + 3 : sizeScore;

  // ── Rating (0–20 pts) ──
  score += (m.rating / 5) * 20;

  // ── Lead time (0–15 pts) ──
  score += m.minLeadTime <= 5 ? 15 : m.minLeadTime <= 10 ? 10 : m.minLeadTime <= 20 ? 5 : 2;

  return Math.min(100, Math.round(score));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function renderStars(rating: number) {
  const full = Math.floor(rating);
  const half = rating - full >= 0.5;
  return (
    <span style={{ color: '#d29922', fontSize: 12 }}>
      {'★'.repeat(full)}
      {half ? '½' : ''}
      {'☆'.repeat(5 - full - (half ? 1 : 0))}
      <span style={{ color: C.textMuted, marginLeft: 4 }}>{rating.toFixed(1)}</span>
    </span>
  );
}

function priceLevelSort(p: 'low' | 'medium' | 'high'): number {
  return p === 'low' ? 0 : p === 'medium' ? 1 : 2;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ManufacturerMatch({
  process: initialProcess,
  volume_cm3,
  materialId,
  bbox,
  lang = 'ko',
  partName,
  triangleCount,
  hasUndercuts,
  onSelectManufacturer,
}: ManufacturerMatchProps) {
  const isKo = lang === 'ko';

  const [all, setAll] = useState<Manufacturer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requiresPro, setRequiresPro] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [quoteState, setQuoteState] = useState<QuoteState | null>(null);

  // Filters
  const [regionFilter, setRegionFilter] = useState<string>('');
  const [processFilter, setProcessFilter] = useState<string>(initialProcess ?? '');
  const [sortBy, setSortBy] = useState<SortKey>('match');

  // Fetch manufacturers — Pro-gated; surface upgrade CTA on 403 instead of dead-end error.
  const fetchManufacturers = useCallback(async () => {
    setLoading(true);
    setError(null);
    setRequiresPro(false);

    const url = new URL('/api/nexyfab/manufacturers', window.location.origin);
    if (processFilter) url.searchParams.set('process', processFilter);
    if (regionFilter) url.searchParams.set('region', regionFilter);

    try {
      const res = await fetch(url.toString());
      if (res.status === 403) {
        const body = await res.json().catch(() => ({} as { requiresPro?: boolean }));
        if (body?.requiresPro) {
          setRequiresPro(true);
          setAll([]);
          return;
        }
      }
      if (!res.ok) {
        setError(isKo ? '데이터를 불러오지 못했습니다.' : 'Failed to load manufacturers.');
        return;
      }
      const data = await res.json() as { manufacturers?: Manufacturer[] };
      setAll(data.manufacturers ?? []);
    } catch {
      setError(isKo ? '데이터를 불러오지 못했습니다.' : 'Failed to load manufacturers.');
    } finally {
      setLoading(false);
    }
  }, [processFilter, regionFilter, isKo]);

  useEffect(() => {
    fetchManufacturers();
  }, [fetchManufacturers]);

  // Attach match scores — only recompute when data or shape context changes, NOT on sort change
  const scored = useMemo(
    () => all.map(m => ({
      ...m,
      matchScore: computeMatchScore(m, materialId, bbox, { triangleCount, hasUndercuts }),
    })),
    [all, materialId, bbox, triangleCount, hasUndercuts],
  );

  // Sort — recompute only when scored list or sort key changes
  const sorted = useMemo(() => {
    return [...scored].sort((a, b) => {
      if (sortBy === 'match')     return b.matchScore - a.matchScore;
      if (sortBy === 'lead_time') return a.minLeadTime - b.minLeadTime;
      if (sortBy === 'rating')    return b.rating - a.rating;
      if (sortBy === 'price')     return priceLevelSort(a.priceLevel) - priceLevelSort(b.priceLevel);
      return 0;
    });
  }, [scored, sortBy]);

  const topScore = sorted[0]?.matchScore ?? 0;

  // ── Quote request ───────────────────────────────────────────────────────────

  const handleOpenQuote = useCallback((m: Manufacturer) => {
    setQuoteState({ manufacturer: m, quantity: 1, submitting: false });
  }, []);

  const handleSubmitQuote = useCallback(async () => {
    if (!quoteState) return;
    setQuoteState(s => s ? { ...s, submitting: true, error: undefined } : s);
    try {
      const mfr = quoteState.manufacturer;
      const totalPriceKRW = estimateOrderTotalKRW(
        volume_cm3,
        materialId,
        mfr.priceLevel,
        quoteState.quantity,
      );
      const res = await fetch('/api/nexyfab/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partName: partName ?? 'Custom Part',
          manufacturerName: isKo ? mfr.nameKo : mfr.name,
          quantity: quoteState.quantity,
          totalPriceKRW,
          estimatedLeadDays: mfr.minLeadTime,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setQuoteState(s => s ? { ...s, submitting: false, orderId: data.order?.id ?? 'new' } : s);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setQuoteState(s => s ? { ...s, submitting: false, error: msg } : s);
    }
  }, [quoteState, partName, materialId, volume_cm3, isKo]);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{
      background: C.bg,
      border: `1px solid ${C.border}`,
      borderRadius: 12,
      overflow: 'hidden',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      color: C.text,
      position: 'relative',
    }}>

      {/* ── Quote request modal ── */}
      {quoteState && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 20,
          background: 'rgba(13,17,23,0.88)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: 12,
        }}>
          <div style={{
            background: '#161b22', border: '1px solid #30363d', borderRadius: 12,
            padding: '24px 28px', width: 320, boxShadow: '0 16px 48px rgba(0,0,0,0.6)',
          }}>
            {quoteState.orderId ? (
              /* ── Success state ── */
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 36, marginBottom: 10 }}>✅</div>
                <p style={{ fontSize: 15, fontWeight: 700, color: '#3fb950', marginBottom: 6 }}>
                  {isKo ? '견적 요청 완료!' : 'Quote Requested!'}
                </p>
                <p style={{ fontSize: 12, color: '#8b949e', marginBottom: 20, lineHeight: 1.5 }}>
                  {isKo
                    ? `${quoteState.manufacturer.nameKo}에 요청이 전달되었습니다.`
                    : `Your request was sent to ${quoteState.manufacturer.name}.`}
                </p>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                  <a
                    href={`/${lang}/nexyfab/orders`}
                    style={{
                      display: 'block', padding: '8px 20px', borderRadius: 8,
                      background: 'linear-gradient(135deg, #388bfd, #8b5cf6)',
                      color: '#fff', fontSize: 12, fontWeight: 700, textDecoration: 'none',
                    }}
                  >
                    {isKo ? '주문 현황 보기 →' : 'Track Order →'}
                  </a>
                  <button
                    onClick={() => setQuoteState(null)}
                    style={{
                      padding: '8px 14px', borderRadius: 8, border: '1px solid #30363d',
                      background: 'transparent', color: '#8b949e', fontSize: 12, cursor: 'pointer',
                    }}
                  >
                    {isKo ? '닫기' : 'Close'}
                  </button>
                </div>
              </div>
            ) : (
              /* ── Form state ── */
              <>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#e6edf3', marginBottom: 4 }}>
                  {isKo ? '견적 요청' : 'Request Quote'}
                </div>
                <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 18 }}>
                  {isKo ? quoteState.manufacturer.nameKo : quoteState.manufacturer.name}
                  {partName && <> · {partName}</>}
                </div>

                <label style={{ fontSize: 11, color: '#8b949e', display: 'block', marginBottom: 6 }}>
                  {isKo ? '수량 (개)' : 'Quantity (pcs)'}
                </label>
                <input
                  type="number"
                  min={1}
                  value={quoteState.quantity}
                  onChange={e => setQuoteState(s => s ? { ...s, quantity: Math.max(1, parseInt(e.target.value) || 1) } : s)}
                  style={{
                    width: '100%', padding: '7px 10px', borderRadius: 6,
                    border: '1px solid #30363d', background: '#0d1117',
                    color: '#e6edf3', fontSize: 13, outline: 'none',
                    boxSizing: 'border-box', marginBottom: 16,
                  }}
                />

                {quoteState.error && (
                  <p style={{ fontSize: 11, color: '#f85149', marginBottom: 12 }}>
                    {quoteState.error}
                  </p>
                )}

                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => setQuoteState(null)}
                    style={{
                      flex: 1, padding: '8px 0', borderRadius: 8, border: '1px solid #30363d',
                      background: 'transparent', color: '#8b949e', fontSize: 12, cursor: 'pointer',
                    }}
                  >
                    {isKo ? '취소' : 'Cancel'}
                  </button>
                  <button
                    onClick={handleSubmitQuote}
                    disabled={quoteState.submitting}
                    style={{
                      flex: 2, padding: '8px 0', borderRadius: 8, border: 'none',
                      background: quoteState.submitting ? '#388bfd88' : 'linear-gradient(135deg, #388bfd, #8b5cf6)',
                      color: '#fff', fontSize: 12, fontWeight: 700, cursor: quoteState.submitting ? 'default' : 'pointer',
                    }}
                  >
                    {quoteState.submitting
                      ? (isKo ? '요청 중...' : 'Submitting...')
                      : (isKo ? '견적 요청하기' : 'Submit Request')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      {/* Panel header */}
      <div style={{
        padding: '14px 18px',
        borderBottom: `1px solid ${C.border}`,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        <span style={{ fontSize: 16 }}>🏭</span>
        <span style={{ fontWeight: 700, fontSize: 14, color: C.text }}>
          {isKo ? '제조사 매칭' : 'Manufacturer Match'}
        </span>
        {volume_cm3 !== undefined && (
          <span style={{
            marginLeft: 'auto',
            fontSize: 11,
            color: C.textMuted,
          }}>
            {isKo ? `부피: ${volume_cm3.toFixed(1)} cm³` : `Volume: ${volume_cm3.toFixed(1)} cm³`}
          </span>
        )}
      </div>

      {/* Filter / Sort row */}
      <div style={{
        padding: '10px 18px',
        borderBottom: `1px solid ${C.border}`,
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
        alignItems: 'center',
      }}>
        {/* Region selector */}
        <select
          value={regionFilter}
          onChange={e => setRegionFilter(e.target.value)}
          style={selectStyle}
        >
          <option value="">{isKo ? '전체 지역' : 'All Regions'}</option>
          {ALL_REGIONS.map(r => (
            <option key={r} value={r}>
              {REGION_FLAGS[r]} {REGION_LABELS[r]?.[isKo ? 'ko' : 'en'] ?? r}
            </option>
          ))}
        </select>

        {/* Process selector */}
        <select
          value={processFilter}
          onChange={e => setProcessFilter(e.target.value)}
          style={selectStyle}
        >
          <option value="">{isKo ? '전체 공정' : 'All Processes'}</option>
          {ALL_PROCESSES.map(p => (
            <option key={p} value={p}>
              {PROCESS_LABELS[p]?.[isKo ? 'ko' : 'en'] ?? p}
            </option>
          ))}
        </select>

        <div style={{ flex: 1 }} />

        {/* Sort */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, color: C.textMuted }}>
            {isKo ? '정렬:' : 'Sort:'}
          </span>
          {(['match', 'rating', 'lead_time', 'price'] as SortKey[]).map(key => (
            <button
              key={key}
              onClick={() => setSortBy(key)}
              style={{
                padding: '4px 10px',
                borderRadius: 6,
                border: `1px solid ${sortBy === key ? C.accent : C.border}`,
                background: sortBy === key ? `${C.accent}20` : 'transparent',
                color: sortBy === key ? C.accent : C.textDim,
                fontSize: 11,
                cursor: 'pointer',
                fontWeight: sortBy === key ? 700 : 400,
              }}
            >
              {key === 'match'     ? (isKo ? '✦ 매칭' : '✦ Match')
               : key === 'rating'    ? (isKo ? '평점' : 'Rating')
               : key === 'lead_time' ? (isKo ? '납기' : 'Lead Time')
               : (isKo ? '가격' : 'Price')}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div style={{ maxHeight: 460, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: C.textMuted }}>
            {isKo ? '불러오는 중...' : 'Loading...'}
          </div>
        ) : requiresPro ? (
          <div style={{ padding: '36px 28px', textAlign: 'center' }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>🔒</div>
            <p style={{ fontSize: 14, fontWeight: 700, color: '#e6edf3', margin: '0 0 6px' }}>
              {isKo ? 'Pro 플랜 전용 기능' : 'Pro Plan Feature'}
            </p>
            <p style={{ fontSize: 12, color: C.textMuted, lineHeight: 1.6, margin: '0 0 18px', maxWidth: 360, marginLeft: 'auto', marginRight: 'auto' }}>
              {isKo
                ? '제조사 매칭으로 재질·형상에 가장 적합한 공급사를 자동 추천받고 견적 요청까지 한 번에 진행할 수 있어요.'
                : 'Manufacturer Match auto-ranks suppliers for your material and geometry, then sends quote requests in one click.'}
            </p>
            <button
              onClick={() => setShowUpgradeModal(true)}
              style={{
                padding: '9px 20px', borderRadius: 8, border: 'none',
                background: 'linear-gradient(135deg, #388bfd, #8b5cf6)',
                color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer',
              }}
            >
              ⚡ {isKo ? 'Pro로 업그레이드' : 'Upgrade to Pro'}
            </button>
            <UpgradePrompt
              open={showUpgradeModal}
              onClose={() => setShowUpgradeModal(false)}
              feature="Manufacturer Match"
              featureKo="제조사 매칭"
              requiredPlan="pro"
              lang={lang}
            />
          </div>
        ) : error ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#f85149' }}>
            {error}
          </div>
        ) : sorted.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: C.textMuted }}>
            {isKo ? '조건에 맞는 제조사가 없습니다.' : 'No manufacturers match your filters.'}
          </div>
        ) : (
          sorted.map((m, idx) => (
            <ManufacturerCard
              key={m.id}
              manufacturer={m}
              matchScore={m.matchScore}
              isTopMatch={idx === 0 && m.matchScore >= 70 && m.matchScore === topScore}
              isKo={isKo}
              onSelect={() => onSelectManufacturer(m)}
              onRequestQuote={() => handleOpenQuote(m)}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ─── ManufacturerCard ─────────────────────────────────────────────────────────

interface ManufacturerCardProps {
  manufacturer: Manufacturer;
  matchScore: number;
  isTopMatch: boolean;
  isKo: boolean;
  onSelect: () => void;
  onRequestQuote: () => void;
}

function ManufacturerCard({ manufacturer: m, matchScore, isTopMatch, isKo, onSelect, onRequestQuote }: ManufacturerCardProps) {
  const [hovered, setHovered] = useState(false);
  const price = PRICE_META[m.priceLevel];
  const flag = REGION_FLAGS[m.region] ?? '🌐';
  const scoreColor = matchScore >= 85 ? '#3fb950' : matchScore >= 65 ? '#d29922' : '#8b949e';

  return (
    <div
      style={{
        padding: '14px 18px',
        borderBottom: `1px solid ${C.border}`,
        background: hovered ? C.card : 'transparent',
        transition: 'background 0.12s',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 14,
        cursor: 'pointer',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onSelect}
    >
      {/* Flag + region */}
      <div style={{
        width: 40,
        height: 40,
        borderRadius: 8,
        background: '#0d1117',
        border: `1px solid ${C.border}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 22,
        flexShrink: 0,
      }}>
        {flag}
      </div>

      {/* Main info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, fontSize: 13, color: C.text }}>
            {isKo ? m.nameKo : m.name}
          </span>
          {isTopMatch && (
            <span style={{
              fontSize: 9, padding: '2px 7px', borderRadius: 10,
              background: 'linear-gradient(90deg,#388bfd,#8b5cf6)', color: '#fff', fontWeight: 800,
            }}>
              ✦ {isKo ? 'TOP 매칭' : 'TOP MATCH'}
            </span>
          )}
          <span style={{
            fontSize: 9,
            padding: '2px 6px',
            borderRadius: 4,
            background: `${price.color}20`,
            color: price.color,
            fontWeight: 700,
          }}>
            {isKo ? price.labelKo : price.labelEn}
          </span>
        </div>

        {/* Stars + review count */}
        <div style={{ marginBottom: 6 }}>
          {renderStars(m.rating)}
          <span style={{ fontSize: 11, color: C.textMuted, marginLeft: 4 }}>
            ({m.reviewCount.toLocaleString()})
          </span>
        </div>

        {/* Processes */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
          {m.processes.map(p => (
            <span key={p} style={{
              fontSize: 10,
              padding: '2px 7px',
              borderRadius: 4,
              background: '#388bfd18',
              color: C.accent,
              border: `1px solid #388bfd30`,
            }}>
              {PROCESS_LABELS[p]?.[isKo ? 'ko' : 'en'] ?? p}
            </span>
          ))}
        </div>

        {/* Description */}
        <p style={{ margin: 0, fontSize: 11, color: C.textMuted, lineHeight: 1.5 }}>
          {isKo ? m.descriptionKo : m.description}
        </p>

        {/* Certs */}
        {m.certifications.length > 0 && (
          <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
            {m.certifications.map(c => (
              <span key={c} style={{
                fontSize: 9,
                padding: '1px 5px',
                borderRadius: 3,
                background: '#3fb95015',
                color: C.green,
                border: `1px solid #3fb95030`,
              }}>
                {c}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Match score + lead time + select button */}
      <div style={{ flexShrink: 0, textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
        {/* Match score meter */}
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 10, color: scoreColor, fontWeight: 700, marginBottom: 3 }}>
            {matchScore}% {isKo ? '매칭' : 'match'}
          </div>
          <div style={{ width: 60, height: 4, background: '#21262d', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{
              width: `${matchScore}%`, height: '100%', borderRadius: 3,
              background: matchScore >= 85 ? '#3fb950' : matchScore >= 65 ? '#d29922' : '#8b949e',
              transition: 'width 0.4s ease',
            }} />
          </div>
        </div>
        <div>
          <p style={{ margin: '0 0 2px', fontSize: 12, fontWeight: 700, color: C.text }}>
            {m.minLeadTime}–{m.maxLeadTime}
          </p>
          <p style={{ margin: 0, fontSize: 10, color: C.textMuted }}>
            {isKo ? '영업일' : 'biz days'}
          </p>
        </div>

        <button
          onClick={e => { e.stopPropagation(); onRequestQuote(); }}
          style={{
            padding: '5px 12px',
            borderRadius: 6,
            border: 'none',
            background: 'linear-gradient(135deg, #388bfd, #8b5cf6)',
            color: '#fff',
            fontSize: 11,
            fontWeight: 700,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {isKo ? '견적 요청' : 'Request Quote'}
        </button>
        <button
          onClick={e => { e.stopPropagation(); onSelect(); }}
          style={{
            padding: '5px 12px',
            borderRadius: 6,
            border: `1px solid ${C.border}`,
            background: 'transparent',
            color: C.textDim,
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'border-color 0.15s, color 0.15s',
            whiteSpace: 'nowrap',
          }}
        >
          {isKo ? '선택' : 'Select'}
        </button>
      </div>
    </div>
  );
}

// ─── Shared styles ────────────────────────────────────────────────────────────

const selectStyle: React.CSSProperties = {
  padding: '5px 10px',
  borderRadius: 6,
  border: `1px solid ${C.border}`,
  background: '#0d1117',
  color: C.text,
  fontSize: 12,
  outline: 'none',
  cursor: 'pointer',
};
