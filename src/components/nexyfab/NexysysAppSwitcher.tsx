'use client';

import { toIsoLang, type IsoLang } from '@/lib/i18n/normalize';

/**
 * NexysysAppSwitcher
 * Subtle product-family indicator at the bottom of the NexyFab sidebar.
 * Shows sibling products (NexyFlow, NexyFab, NexyWise) as small pill icons.
 * Current product is highlighted; others link to their respective sites.
 */

interface Product {
  id: string;
  short: string;       // 2-3 char abbreviation shown in pill
  name: string;
  tagline: Record<IsoLang, string>; // shown in hover tooltip
  color: string;       // accent color
  url: string;         // external URL
  current?: boolean;
}

const PRODUCTS: Product[] = [
  {
    id: 'nexyflow',
    short: 'NF',
    name: 'NexyFlow',
    tagline: {
      ko: '협업 그룹웨어', en: 'Collaboration groupware', ja: 'コラボレーション・グループウェア',
      zh: '协作群件', es: 'Suite de colaboración', ar: 'منصة تعاون جماعي',
    },
    color: '#22d3ee',
    url: process.env.NEXT_PUBLIC_NEXYFLOW_URL ?? 'https://nexyflow.nexysys.com',
  },
  {
    id: 'nexyfab',
    short: 'FAB',
    name: 'NexyFab',
    tagline: {
      ko: '제조 견적 플랫폼', en: 'Manufacturing quotation platform', ja: '製造見積プラットフォーム',
      zh: '制造报价平台', es: 'Plataforma de cotización de fabricación', ar: 'منصة عروض أسعار التصنيع',
    },
    color: '#8b9cf4',
    url: '#',
    current: true,
  },
  {
    id: 'nexywise',
    short: 'NW',
    name: 'NexyWise',
    tagline: {
      ko: '비즈니스 인텔리전스', en: 'Business intelligence', ja: 'ビジネスインテリジェンス',
      zh: '商业智能', es: 'Inteligencia empresarial', ar: 'ذكاء الأعمال',
    },
    color: '#34d399',
    url: process.env.NEXT_PUBLIC_NEXYWISE_URL ?? 'https://nexywise.nexysys.com',
  },
];

export default function NexysysAppSwitcher({ collapsed, lang = 'en' }: { collapsed?: boolean; lang?: string }) {
  const locale = toIsoLang(lang);
  return (
    <>
      <style precedence="default" href="nxs-app-switcher">{`
        .nxs-switcher { display: flex; flex-direction: column; gap: 6px; }
        .nxs-label { display: block; }
        .nxs-tooltip {
          position: absolute;
          bottom: calc(100% + 6px);
          left: 50%;
          transform: translateX(-50%);
          background: #1c2128;
          border: 1px solid #30363d;
          border-radius: 6px;
          padding: 6px 10px;
          white-space: nowrap;
          pointer-events: none;
          opacity: 0;
          transition: opacity 0.15s;
          z-index: 100;
        }
        .nxs-pill:hover .nxs-tooltip { opacity: 1; }
        @media (max-width: 768px) {
          .nxs-label { display: none !important; }
        }
      `}</style>

      <div className="nxs-switcher" style={{ padding: '10px 12px 0' }}>
        {/* Section label */}
        <p
          className="nxs-label"
          style={{
            margin: 0,
            fontSize: 9,
            fontWeight: 700,
            color: 'var(--nx-text-2)',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
        >
          Nexysys
        </p>

        {/* Product pills */}
        <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
          {PRODUCTS.map(p => (
            <div
              key={p.id}
              className="nxs-pill"
              style={{ position: 'relative', flex: collapsed ? undefined : 1 }}
            >
              {/* Tooltip */}
              <div className="nxs-tooltip">
                <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: p.color }}>{p.name}</p>
                <p style={{ margin: 0, fontSize: 10, color: '#8b949e' }}>{p.tagline[locale]}</p>
              </div>

              {/* Pill button */}
              {p.current ? (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: 22,
                    borderRadius: 4,
                    background: `${p.color}1f`,
                    border: `1px solid ${p.color}55`,
                    fontSize: 9,
                    fontWeight: 800,
                    color: p.color,
                    letterSpacing: '0.04em',
                    cursor: 'default',
                    userSelect: 'none',
                    paddingInline: 5,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {p.short}
                </div>
              ) : (
                <a
                  href={p.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: 22,
                    borderRadius: 4,
                    background: 'transparent',
                    border: '1px solid #30363d',
                    fontSize: 9,
                    fontWeight: 700,
                    color: 'var(--nx-text-2)',
                    letterSpacing: '0.04em',
                    textDecoration: 'none',
                    transition: 'all 0.12s',
                    paddingInline: 5,
                    whiteSpace: 'nowrap',
                    width: '100%',
                    boxSizing: 'border-box',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.color = p.color;
                    e.currentTarget.style.borderColor = `${p.color}55`;
                    e.currentTarget.style.background = `${p.color}0f`;
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.color = 'var(--nx-text-2)';
                    e.currentTarget.style.borderColor = '#30363d';
                    e.currentTarget.style.background = 'transparent';
                  }}
                >
                  {p.short}
                </a>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
