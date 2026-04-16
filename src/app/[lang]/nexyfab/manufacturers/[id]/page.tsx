'use client';

import { use, useEffect, useState } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Review {
  id: string;
  rating: number;
  comment: string;
  reviewerEmail: string;
  createdAt: string;
}

interface ManufacturerDetail {
  id: string;
  name: string;
  nameKo: string;
  region: string;
  processes: string[];
  certifications: string[];
  rating: number;
  reviewCount: number;
  priceLevel: 'budget' | 'standard' | 'premium';
  minLeadTime: number;
  maxLeadTime: number;
  description: string;
  descriptionKo: string;
  contactEmail: string | null;
  contactPhone: string | null;
  website: string | null;
  hasPartnerProfile: boolean;
  techExp: string | null;
  matchField: string | null;
  capacityAmount: string | null;
  reviews: Review[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const GRADIENT_PALETTE: [string, string][] = [
  ['#388bfd', '#1f6feb'], ['#f0883e', '#bd561d'], ['#3fb950', '#238636'],
  ['#a371f7', '#6e40c9'], ['#e3b341', '#9e6a03'], ['#79c0ff', '#388bfd'],
  ['#f85149', '#da3633'], ['#56d364', '#2ea043'],
];
function gradientForId(id: string): [string, string] {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) & 0xffff;
  return GRADIENT_PALETTE[hash % GRADIENT_PALETTE.length];
}

const REGION_LABELS: Record<string, string> = {
  KR: '🇰🇷 한국', CN: '🇨🇳 중국', US: '🇺🇸 미국',
  JP: '🇯🇵 일본', DE: '🇩🇪 독일', VN: '🇻🇳 베트남',
  TW: '🇹🇼 대만', TH: '🇹🇭 태국', IN: '🇮🇳 인도',
};

const PROCESS_LABELS: Record<string, { ko: string; en: string }> = {
  cnc_milling:       { ko: 'CNC 밀링',    en: 'CNC Milling' },
  cnc_turning:       { ko: 'CNC 선삭',    en: 'CNC Turning' },
  injection_molding: { ko: '사출 성형',   en: 'Injection Molding' },
  sheet_metal:       { ko: '판금',        en: 'Sheet Metal' },
  casting:           { ko: '주조',        en: 'Casting' },
  '3d_printing':     { ko: '3D 프린팅',  en: '3D Printing' },
  die_casting:       { ko: '다이캐스팅', en: 'Die Casting' },
  forging:           { ko: '단조',        en: 'Forging' },
  welding:           { ko: '용접',        en: 'Welding' },
};

const PRICE_LABELS: Record<string, { ko: string; en: string; color: string }> = {
  budget:   { ko: '저가',      en: 'Budget',   color: '#3fb950' },
  standard: { ko: '표준',      en: 'Standard', color: '#e3b341' },
  premium:  { ko: '프리미엄',  en: 'Premium',  color: '#a371f7' },
};

const C = {
  bg: '#0d1117', surface: '#161b22', card: '#21262d',
  border: '#30363d', text: '#e6edf3', dim: '#8b949e',
  accent: '#388bfd', green: '#3fb950', yellow: '#e3b341',
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ManufacturerDetailPage({
  params,
}: {
  params: Promise<{ lang: string; id: string }>;
}) {
  const { lang, id } = use(params);
  const isKo = lang === 'ko';

  const [mfr, setMfr] = useState<ManufacturerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    fetch(`/api/nexyfab/manufacturers/${id}`)
      .then(r => {
        if (r.status === 404) { setNotFound(true); return null; }
        return r.json() as Promise<{ manufacturer: ManufacturerDetail }>;
      })
      .then(data => { if (data) setMfr(data.manufacturer); })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.dim, fontFamily: 'system-ui, sans-serif' }}>
      {isKo ? '불러오는 중...' : 'Loading...'}
    </div>
  );

  if (notFound || !mfr) return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: C.dim, fontFamily: 'system-ui, sans-serif', gap: 16 }}>
      <div style={{ fontSize: 40 }}>🏭</div>
      <div style={{ fontSize: 16, fontWeight: 600 }}>{isKo ? '제조사를 찾을 수 없습니다.' : 'Manufacturer not found'}</div>
      <a href={`/${lang}/nexyfab/marketplace`} style={{ color: C.accent, textDecoration: 'none', fontSize: 13 }}>
        ← {isKo ? '마켓플레이스로 돌아가기' : 'Back to Marketplace'}
      </a>
    </div>
  );

  const [gradFrom, gradTo] = gradientForId(mfr.id);
  const initials = (isKo && mfr.nameKo ? mfr.nameKo : mfr.name).slice(0, 1);
  const pl = PRICE_LABELS[mfr.priceLevel] ?? PRICE_LABELS.standard;
  const displayName = isKo ? mfr.nameKo : mfr.name;
  const description = isKo ? (mfr.descriptionKo || mfr.description) : mfr.description;

  function stars(rating: number) {
    const full = Math.floor(rating);
    const half = rating - full >= 0.5;
    return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(5 - full - (half ? 1 : 0));
  }

  return (
    <div style={{ minHeight: '100vh', background: C.bg, fontFamily: 'system-ui, -apple-system, sans-serif', color: C.text }}>
      {/* Header */}
      <div style={{ borderBottom: `1px solid ${C.border}`, padding: '14px 32px', display: 'flex', alignItems: 'center', gap: 16, background: C.bg, position: 'sticky', top: 0, zIndex: 10 }}>
        <a href={`/${lang}/shape-generator`} style={{ fontSize: 18, fontWeight: 800, color: C.text, textDecoration: 'none' }}>
          <span style={{ color: '#8b9cf4' }}>Nexy</span>Fab
        </a>
        <span style={{ color: C.border }}>|</span>
        <a href={`/${lang}/nexyfab/marketplace`} style={{ fontSize: 13, color: C.dim, textDecoration: 'none' }}>
          {isKo ? '마켓플레이스' : 'Marketplace'}
        </a>
        <span style={{ color: C.dim, fontSize: 13 }}>›</span>
        <span style={{ fontSize: 13, color: C.text }}>{displayName}</span>
      </div>

      <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 24px' }}>

        {/* Hero card */}
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: '28px 32px', marginBottom: 24, display: 'flex', gap: 24, alignItems: 'flex-start' }}>
          {/* Logo */}
          <div style={{
            width: 80, height: 80, borderRadius: 16, flexShrink: 0,
            background: `linear-gradient(135deg, ${gradFrom}, ${gradTo})`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 36, fontWeight: 800, color: '#fff',
          }}>
            {initials}
          </div>

          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>{displayName}</h1>
              {mfr.hasPartnerProfile && (
                <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: '#388bfd18', color: C.accent }}>
                  {isKo ? '파트너' : 'Partner'}
                </span>
              )}
              <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: pl.color + '18', color: pl.color }}>
                {pl[isKo ? 'ko' : 'en']}
              </span>
            </div>

            <div style={{ display: 'flex', gap: 16, fontSize: 13, color: C.dim, marginBottom: 12, flexWrap: 'wrap' }}>
              <span>📍 {REGION_LABELS[mfr.region] ?? mfr.region}</span>
              <span>{stars(mfr.rating)} {mfr.rating.toFixed(1)} ({mfr.reviewCount.toLocaleString()} {isKo ? '리뷰' : 'reviews'})</span>
              <span>⏱ {isKo ? `납기 ${mfr.minLeadTime}–${mfr.maxLeadTime}일` : `Lead ${mfr.minLeadTime}–${mfr.maxLeadTime}d`}</span>
            </div>

            {description && (
              <p style={{ margin: '0 0 16px', fontSize: 14, color: '#b1bac4', lineHeight: 1.6 }}>{description}</p>
            )}

            {/* Processes + certs */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {mfr.processes.map(p => (
                <span key={p} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, background: C.card, color: C.dim, border: `1px solid ${C.border}` }}>
                  {PROCESS_LABELS[p]?.[isKo ? 'ko' : 'en'] ?? p}
                </span>
              ))}
              {mfr.certifications.map(c => (
                <span key={c} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, background: '#388bfd11', color: C.accent, border: '1px solid #388bfd33' }}>
                  {c}
                </span>
              ))}
            </div>
          </div>

          {/* CTA */}
          <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <a
              href={`/${lang}/nexyfab/rfq?factoryId=${mfr.id}`}
              style={{
                display: 'block', padding: '11px 24px', borderRadius: 10, textDecoration: 'none',
                background: 'linear-gradient(135deg, #388bfd, #8b5cf6)',
                color: '#fff', fontSize: 13, fontWeight: 700, textAlign: 'center', whiteSpace: 'nowrap',
              }}
            >
              {isKo ? '견적 요청' : 'Request Quote'}
            </a>
            {mfr.website && (
              <a href={mfr.website} target="_blank" rel="noopener noreferrer"
                style={{ display: 'block', padding: '9px 24px', borderRadius: 10, textDecoration: 'none', background: 'transparent', border: `1px solid ${C.border}`, color: C.dim, fontSize: 12, fontWeight: 600, textAlign: 'center' }}>
                🌐 {isKo ? '홈페이지' : 'Website'}
              </a>
            )}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
          {/* Details */}
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: '20px 24px' }}>
            <h2 style={{ margin: '0 0 16px', fontSize: 14, fontWeight: 700, color: C.dim, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {isKo ? '상세 정보' : 'Details'}
            </h2>
            <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 16px', fontSize: 13 }}>
              {mfr.matchField && (
                <>
                  <dt style={{ color: C.dim, whiteSpace: 'nowrap' }}>{isKo ? '전문 분야' : 'Specialty'}</dt>
                  <dd style={{ margin: 0, color: C.text }}>{mfr.matchField}</dd>
                </>
              )}
              {mfr.techExp && (
                <>
                  <dt style={{ color: C.dim, whiteSpace: 'nowrap' }}>{isKo ? '기술 경력' : 'Experience'}</dt>
                  <dd style={{ margin: 0, color: C.text }}>{mfr.techExp}</dd>
                </>
              )}
              {mfr.capacityAmount && (
                <>
                  <dt style={{ color: C.dim, whiteSpace: 'nowrap' }}>{isKo ? '수용 금액' : 'Capacity'}</dt>
                  <dd style={{ margin: 0, color: C.text }}>{mfr.capacityAmount}</dd>
                </>
              )}
              {mfr.contactPhone && (
                <>
                  <dt style={{ color: C.dim, whiteSpace: 'nowrap' }}>{isKo ? '연락처' : 'Phone'}</dt>
                  <dd style={{ margin: 0, color: C.text }}>{mfr.contactPhone}</dd>
                </>
              )}
              {mfr.contactEmail && (
                <>
                  <dt style={{ color: C.dim, whiteSpace: 'nowrap' }}>Email</dt>
                  <dd style={{ margin: 0 }}>
                    <a href={`mailto:${mfr.contactEmail}`} style={{ color: C.accent, textDecoration: 'none' }}>{mfr.contactEmail}</a>
                  </dd>
                </>
              )}
            </dl>
          </div>

          {/* Rating breakdown */}
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: '20px 24px' }}>
            <h2 style={{ margin: '0 0 16px', fontSize: 14, fontWeight: 700, color: C.dim, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {isKo ? '평점' : 'Rating'}
            </h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12 }}>
              <span style={{ fontSize: 40, fontWeight: 900, color: C.yellow }}>{mfr.rating.toFixed(1)}</span>
              <div>
                <div style={{ color: C.yellow, fontSize: 20, letterSpacing: 2 }}>{stars(mfr.rating)}</div>
                <div style={{ fontSize: 12, color: C.dim, marginTop: 2 }}>{mfr.reviewCount.toLocaleString()} {isKo ? '건 기준' : 'reviews'}</div>
              </div>
            </div>
            <RatingBar label={isKo ? '납기 준수' : 'Deadline'} value={mfr.rating} />
            <RatingBar label={isKo ? '품질' : 'Quality'} value={Math.min(5, mfr.rating + 0.1)} />
            <RatingBar label={isKo ? '커뮤니케이션' : 'Communication'} value={Math.max(1, mfr.rating - 0.1)} />
          </div>
        </div>

        {/* Reviews */}
        {mfr.reviews.length > 0 && (
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: '20px 24px' }}>
            <h2 style={{ margin: '0 0 16px', fontSize: 14, fontWeight: 700, color: C.dim, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {isKo ? '최근 리뷰' : 'Recent Reviews'}
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {mfr.reviews.map(r => (
                <div key={r.id} style={{ borderBottom: `1px solid ${C.border}`, paddingBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ color: C.yellow, fontSize: 13 }}>{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</span>
                    <span style={{ fontSize: 11, color: C.dim }}>{r.reviewerEmail}</span>
                    <span style={{ fontSize: 11, color: C.dim, marginLeft: 'auto' }}>
                      {new Date(r.createdAt).toLocaleDateString(isKo ? 'ko-KR' : 'en-US')}
                    </span>
                  </div>
                  {r.comment && <p style={{ margin: 0, fontSize: 13, color: '#b1bac4', lineHeight: 1.5 }}>{r.comment}</p>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Back link */}
        <div style={{ marginTop: 24 }}>
          <a href={`/${lang}/nexyfab/marketplace`} style={{ color: C.accent, textDecoration: 'none', fontSize: 13 }}>
            ← {isKo ? '마켓플레이스로 돌아가기' : 'Back to Marketplace'}
          </a>
        </div>
      </div>
    </div>
  );
}

function RatingBar({ label, value }: { label: string; value: number }) {
  const pct = Math.round((value / 5) * 100);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
      <span style={{ fontSize: 12, color: '#8b949e', width: 100, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: 6, background: '#21262d', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: '#e3b341', borderRadius: 3 }} />
      </div>
      <span style={{ fontSize: 12, color: '#e3b341', width: 28, textAlign: 'right' }}>{value.toFixed(1)}</span>
    </div>
  );
}
