'use client';

// M2 — Partner profile preview card.
//
// Displayed before sending RFQ to a specific partner (M3) or when
// hovering a partner row in directory listings. Shows:
//   - Identity (name, region, industry)
//   - Capabilities (processes, certifications)
//   - Multi-dim metrics (납기 / 품질 / 응답 / 소통) — each as its own pill
//   - 1-3 recent review snippets with the dimensional ratings inline
//   - Cold-start badges when there's no metric history yet
//
// Per memory rule: never collapse metrics into a single composite score.

import React, { useEffect, useState } from 'react';
import { toIsoLang } from '@/lib/i18n/normalize';
import PartnerMetricsBar, { type PartnerMetrics } from '@/app/[lang]/shape-generator/analysis/PartnerMetricsBar';

interface PreviewResp {
  ok: boolean;
  partner: {
    id: string;
    name: string;
    region: string | null;
    industry: string | null;
    description: string | null;
    processes: string[];
    certifications: string[];
    partnerEmail: string | null;
    ageDays: number;
    isColdStart: boolean;
    coldStartBadges: string[];
    metrics: PartnerMetrics;
    recentReviews: Array<{
      rating: number;
      deadline: number;
      quality: number;
      communication: number;
      comment: string | null;
      reviewedAt: string;
    }>;
  };
}

const dict = {
  ko: {
    loading: '불러오는 중…',
    notFound: '파트너 정보를 찾을 수 없습니다.',
    region: '지역',
    industry: '분야',
    age: '운영',
    yearsSuffix: '년',
    daysSuffix: '일',
    processes: '제조 공정',
    certifications: '인증',
    metrics: '운영 지표 (90일)',
    recentReviews: '최근 리뷰',
    noReviews: '아직 리뷰가 없습니다',
    coldStart: '신규 파트너',
    sample: 'n=',
    reviewMeta: (d: number, q: number, c: number) => `납기 ${d}/5 · 품질 ${q}/5 · 소통 ${c}/5`,
  },
  en: {
    loading: 'Loading…',
    notFound: 'Partner not found.',
    region: 'Region',
    industry: 'Industry',
    age: 'Operating',
    yearsSuffix: ' yr',
    daysSuffix: ' days',
    processes: 'Processes',
    certifications: 'Certifications',
    metrics: 'Ops metrics (90d)',
    recentReviews: 'Recent reviews',
    noReviews: 'No reviews yet',
    coldStart: 'New partner',
    sample: 'n=',
    reviewMeta: (d: number, q: number, c: number) => `Deadline ${d}/5 · Quality ${q}/5 · Comm ${c}/5`,
  },
  ja: {
    loading: '読み込み中…',
    notFound: 'パートナー情報が見つかりません。',
    region: '地域',
    industry: '分野',
    age: '運営',
    yearsSuffix: '年',
    daysSuffix: '日',
    processes: '製造工程',
    certifications: '認証',
    metrics: '運営指標 (90 日)',
    recentReviews: '最近のレビュー',
    noReviews: 'まだレビューがありません',
    coldStart: '新規パートナー',
    sample: 'n=',
    reviewMeta: (d: number, q: number, c: number) => `納期 ${d}/5 · 品質 ${q}/5 · 対応 ${c}/5`,
  },
  zh: {
    loading: '加载中…',
    notFound: '未找到合作伙伴信息。',
    region: '地区',
    industry: '领域',
    age: '经营',
    yearsSuffix: '年',
    daysSuffix: '天',
    processes: '制造工艺',
    certifications: '认证',
    metrics: '运营指标（90 天）',
    recentReviews: '最新评价',
    noReviews: '暂无评价',
    coldStart: '新合作伙伴',
    sample: 'n=',
    reviewMeta: (d: number, q: number, c: number) => `交期 ${d}/5 · 质量 ${q}/5 · 沟通 ${c}/5`,
  },
  es: {
    loading: 'Cargando…',
    notFound: 'No se ha encontrado el socio.',
    region: 'Región',
    industry: 'Sector',
    age: 'Actividad',
    yearsSuffix: ' años',
    daysSuffix: ' días',
    processes: 'Procesos de fabricación',
    certifications: 'Certificaciones',
    metrics: 'Indicadores (90 días)',
    recentReviews: 'Reseñas recientes',
    noReviews: 'Todavía no hay reseñas',
    coldStart: 'Socio nuevo',
    sample: 'n=',
    reviewMeta: (d: number, q: number, c: number) => `Plazo ${d}/5 · Calidad ${q}/5 · Comunicación ${c}/5`,
  },
  ar: {
    loading: 'جارٍ التحميل…',
    notFound: 'تعذّر العثور على بيانات الشريك.',
    region: 'المنطقة',
    industry: 'المجال',
    age: 'مدة النشاط',
    yearsSuffix: ' سنة',
    daysSuffix: ' يوم',
    processes: 'عمليات التصنيع',
    certifications: 'الشهادات',
    metrics: 'مؤشرات التشغيل (90 يوماً)',
    recentReviews: 'أحدث التقييمات',
    noReviews: 'لا توجد تقييمات بعد',
    coldStart: 'شريك جديد',
    sample: 'n=',
    reviewMeta: (d: number, q: number, c: number) => `التسليم ${d}/5 · الجودة ${q}/5 · التواصل ${c}/5`,
  },
};

export interface PartnerPreviewCardProps {
  /** ⚠ 260802: `'ko' | 'en'` 이라 부모가 다른 언어를 넘길 수조차 없었다. */
  lang: string;
  partnerEmail: string;
}

export default function PartnerPreviewCard({ lang, partnerEmail }: PartnerPreviewCardProps) {
  // ⚠ 260802: 2분기라 ja·zh·es·ar 이 영어로 떨어졌다.
  const t = dict[toIsoLang(lang)] ?? dict.en;
  const [data, setData] = useState<PreviewResp['partner'] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    (async () => {
      try {
        const res = await fetch(`/api/nexyfab/partner/${encodeURIComponent(partnerEmail)}/preview`);
        if (!res.ok) {
          throw new Error(res.status === 404 ? t.notFound : `HTTP ${res.status}`);
        }
        const body = await res.json() as PreviewResp;
        if (!cancelled) setData(body.partner);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => { cancelled = true; };
  }, [partnerEmail, t.notFound]);

  if (error) return <div style={errStyle}>{error}</div>;
  if (!data) return <div style={mutedStyle}>{t.loading}</div>;

  const ageLabel = data.ageDays >= 365
    ? `${Math.floor(data.ageDays / 365)}${t.yearsSuffix}`
    : `${data.ageDays}${t.daysSuffix}`;

  return (
    <div style={containerStyle}>
      {/* Header: name + cold-start chip if applicable */}
      <div style={headerRow}>
        <div>
          <div style={nameStyle}>{data.name}</div>
          <div style={subtitleStyle}>
            {data.region && <span>{t.region}: {data.region}</span>}
            {data.industry && <span> · {t.industry}: {data.industry}</span>}
            <span> · {t.age} {ageLabel}</span>
          </div>
        </div>
        {data.isColdStart && data.coldStartBadges.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {data.coldStartBadges.map(b => (
              <span key={b} style={coldBadgeStyle}>{b}</span>
            ))}
          </div>
        )}
      </div>

      {data.description && (
        <p style={descStyle}>{data.description}</p>
      )}

      {/* Capabilities */}
      {data.processes.length > 0 && (
        <Row label={t.processes}>
          {data.processes.map(p => <Chip key={p} text={p} accent="#79c0ff" />)}
        </Row>
      )}
      {data.certifications.length > 0 && (
        <Row label={t.certifications}>
          {data.certifications.map(c => <Chip key={c} text={c} accent="#3fb950" />)}
        </Row>
      )}

      {/* Multi-dim metrics — reuses B3 component */}
      <Row label={t.metrics}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <PartnerMetricsBar lang={lang} metrics={data.metrics} variant="full" />
        </div>
      </Row>

      {/* Recent reviews */}
      <div style={{ marginTop: 8 }}>
        <div style={sectionLabelStyle}>{t.recentReviews}</div>
        {data.recentReviews.length === 0 ? (
          <div style={mutedStyle}>{t.noReviews}</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {data.recentReviews.map((r, i) => (
              <div key={i} style={reviewBlockStyle}>
                <div style={{ fontSize: 11, color: '#e3b341', marginBottom: 3 }}>
                  {'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)} {r.rating}/5
                </div>
                {r.comment && (
                  <div style={{ fontSize: 12, color: '#c9d1d9', lineHeight: 1.4 }}>
                    {'\u201c'}
                    {r.comment}
                    {'\u201d'}
                  </div>
                )}
                <div style={{ fontSize: 10, color: '#8b949e', marginTop: 3 }}>
                  {t.reviewMeta(r.deadline, r.quality, r.communication)} · {r.reviewedAt.slice(0, 10)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={rowStyle}>
      <span style={rowLabelStyle}>{label}</span>
      <div style={{ flex: 1, display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>{children}</div>
    </div>
  );
}

function Chip({ text, accent }: { text: string; accent: string }) {
  return (
    <span style={{
      padding: '2px 7px', fontSize: 11, fontWeight: 600,
      borderRadius: 10,
      border: `1px solid ${accent}55`,
      background: `${accent}11`,
      color: accent,
      whiteSpace: 'nowrap',
    }}>{text}</span>
  );
}

const containerStyle: React.CSSProperties = {
  background: '#0d1117', border: '1px solid #30363d', borderRadius: 10,
  padding: 14, color: '#c9d1d9',
};
const headerRow: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
  marginBottom: 8, gap: 12, flexWrap: 'wrap',
};
const nameStyle: React.CSSProperties = { fontSize: 15, fontWeight: 800, color: '#e6edf3' };
const subtitleStyle: React.CSSProperties = { fontSize: 11, color: '#8b949e', marginTop: 2 };
const descStyle: React.CSSProperties = {
  margin: '0 0 10px', fontSize: 12, color: '#c9d1d9',
  lineHeight: 1.5,
};
const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'baseline', gap: 10,
  marginTop: 8, paddingTop: 8, borderTop: '1px solid #21262d',
};
const rowLabelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: '#58a6ff',
  textTransform: 'uppercase', letterSpacing: 0.5,
  width: 120, flexShrink: 0,
};
const sectionLabelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: '#58a6ff',
  marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5,
};
const mutedStyle: React.CSSProperties = { fontSize: 11, color: '#8b949e', padding: 8 };
const errStyle: React.CSSProperties = {
  padding: 12, fontSize: 12, color: '#ffa198',
  background: 'rgba(248,81,73,0.12)', borderRadius: 8,
};
const coldBadgeStyle: React.CSSProperties = {
  padding: '2px 7px', fontSize: 10, fontWeight: 700,
  borderRadius: 10,
  background: '#d2992222', color: '#d29922',
  border: '1px solid #d29922',
};
const reviewBlockStyle: React.CSSProperties = {
  padding: 8, background: '#161b22',
  borderRadius: 6, border: '1px solid #21262d',
};
