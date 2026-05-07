'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { COTS_PARTS, type COTSPart } from './cotsData';

// ─── i18n dict ────────────────────────────────────────────────────────────────

const dict = {
  ko: {
    title: '표준 부품 카탈로그',
    searchPlaceholder: '이름, 규격 검색...',
    noResults: '검색 결과 없음',
    weight: '무게',
    price: '단가',
    insert: '추가',
    footerShowing: (shown: number, total: number) => `${shown}개 부품 표시 중 (전체 ${total}개)`,
    footerVat: '가격은 VAT 별도 기준입니다.',
    cat: { all: '전체', bolt: '볼트', nut: '너트', bearing: '베어링', collar: '칼라', clip: '클립', washer: '와셔' },
  },
  en: {
    title: 'COTS Parts Catalog',
    searchPlaceholder: 'Search name, standard...',
    noResults: 'No results found',
    weight: 'Wt',
    price: 'Price',
    insert: 'Insert',
    footerShowing: (shown: number, total: number) => `Showing ${shown} of ${total} parts`,
    footerVat: 'Prices excl. VAT.',
    cat: { all: 'All', bolt: 'Bolt', nut: 'Nut', bearing: 'Bearing', collar: 'Collar', clip: 'Clip', washer: 'Washer' },
  },
  ja: {
    title: 'COTS 部品カタログ',
    searchPlaceholder: '名称、規格で検索...',
    noResults: '該当なし',
    weight: '重量',
    price: '単価',
    insert: '追加',
    footerShowing: (shown: number, total: number) => `${shown} / ${total} 件表示`,
    footerVat: '価格は税別です。',
    cat: { all: 'すべて', bolt: 'ボルト', nut: 'ナット', bearing: 'ベアリング', collar: 'カラー', clip: 'クリップ', washer: 'ワッシャー' },
  },
  zh: {
    title: 'COTS 零件目录',
    searchPlaceholder: '搜索名称、规格...',
    noResults: '无结果',
    weight: '重量',
    price: '单价',
    insert: '插入',
    footerShowing: (shown: number, total: number) => `显示 ${shown} / ${total} 个零件`,
    footerVat: '价格不含增值税。',
    cat: { all: '全部', bolt: '螺栓', nut: '螺母', bearing: '轴承', collar: '卡环', clip: '夹子', washer: '垫圈' },
  },
  es: {
    title: 'Catálogo de Piezas COTS',
    searchPlaceholder: 'Buscar nombre, estándar...',
    noResults: 'Sin resultados',
    weight: 'Peso',
    price: 'Precio',
    insert: 'Insertar',
    footerShowing: (shown: number, total: number) => `Mostrando ${shown} de ${total} piezas`,
    footerVat: 'Precios sin IVA.',
    cat: { all: 'Todo', bolt: 'Perno', nut: 'Tuerca', bearing: 'Rodamiento', collar: 'Collar', clip: 'Clip', washer: 'Arandela' },
  },
  ar: {
    title: 'كتالوج قطع COTS',
    searchPlaceholder: 'بحث بالاسم أو المعيار...',
    noResults: 'لا توجد نتائج',
    weight: 'الوزن',
    price: 'السعر',
    insert: 'إدراج',
    footerShowing: (shown: number, total: number) => `عرض ${shown} من ${total}`,
    footerVat: 'الأسعار بدون ضريبة القيمة المضافة.',
    cat: { all: 'الكل', bolt: 'برغي', nut: 'صمولة', bearing: 'محمل', collar: 'طوق', clip: 'مشبك', washer: 'حلقة' },
  },
} as const;

type CatKey = keyof typeof dict.ko.cat;

// ─── Props ────────────────────────────────────────────────────────────────────

interface COTSPanelProps {
  open: boolean;
  onClose: () => void;
  onInsert: (part: COTSPart) => void;
  lang?: string;
}

// ─── Palette ──────────────────────────────────────────────────────────────────

const C = {
  bg: '#161b22',
  panel: '#1c2128',
  card: '#21262d',
  cardHover: '#30363d',
  border: '#30363d',
  accent: '#388bfd',
  text: '#c9d1d9',
  dim: '#8b949e',
  success: '#3fb950',
  warn: '#e3b341',
  danger: '#f85149',
  overlay: 'rgba(0,0,0,0.55)',
};

// ─── Category config ──────────────────────────────────────────────────────────

type CategoryFilter = 'all' | COTSPart['category'];

interface CategoryTab {
  key: CategoryFilter;
  labelEn: string;
  labelKo: string;
  color: string;
}

const CATEGORY_TABS: CategoryTab[] = [
  { key: 'all',     labelEn: 'All',     labelKo: '전체',  color: C.accent },
  { key: 'bolt',    labelEn: 'Bolt',    labelKo: '볼트',  color: '#e3b341' },
  { key: 'nut',     labelEn: 'Nut',     labelKo: '너트',  color: '#3fb950' },
  { key: 'bearing', labelEn: 'Bearing', labelKo: '베어링', color: '#d2a8ff' },
  { key: 'collar',  labelEn: 'Collar',  labelKo: '칼라',  color: '#79c0ff' },
  { key: 'clip',    labelEn: 'Clip',    labelKo: '클립',  color: '#ff9a72' },
  { key: 'washer',  labelEn: 'Washer',  labelKo: '와셔',  color: '#56d364' },
];

const CATEGORY_COLOR: Record<COTSPart['category'], string> = {
  bolt:    '#e3b341',
  nut:     '#3fb950',
  bearing: '#d2a8ff',
  collar:  '#79c0ff',
  clip:    '#ff9a72',
  washer:  '#56d364',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatKRW(n: number): string {
  return n.toLocaleString('ko-KR') + '원';
}

function formatWeight(g: number): string {
  return g >= 1000 ? `${(g / 1000).toFixed(2)}kg` : `${g}g`;
}

function buildParamSummary(params: Record<string, number>): string {
  return Object.entries(params)
    .slice(0, 4)
    .map(([k, v]) => `${k}=${v}`)
    .join('  ');
}

// ─── Inline styles ────────────────────────────────────────────────────────────

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: C.overlay,
  zIndex: 1200,
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'flex-end',
};

const drawerStyle: React.CSSProperties = {
  width: 340,
  height: '100vh',
  background: C.bg,
  borderLeft: `1px solid ${C.border}`,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  fontFamily: 'system-ui, sans-serif',
  color: C.text,
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '12px 16px',
  borderBottom: `1px solid ${C.border}`,
  background: '#1b1f27',
  flexShrink: 0,
};

const searchInputStyle: React.CSSProperties = {
  width: '100%',
  background: C.card,
  border: `1px solid ${C.border}`,
  borderRadius: 6,
  color: C.text,
  fontSize: 13,
  padding: '7px 10px',
  outline: 'none',
  boxSizing: 'border-box',
  fontFamily: 'system-ui, sans-serif',
};

const tabRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 4,
  padding: '8px 12px',
  flexWrap: 'wrap',
  borderBottom: `1px solid ${C.border}`,
  background: '#1b1f27',
  flexShrink: 0,
};

const scrollStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: '8px 10px',
};

const cardStyle: React.CSSProperties = {
  background: C.card,
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  padding: '10px 12px',
  marginBottom: 8,
  transition: 'background 0.15s',
  cursor: 'default',
};

const footerStyle: React.CSSProperties = {
  padding: '10px 16px',
  borderTop: `1px solid ${C.border}`,
  fontSize: 11,
  color: C.dim,
  background: '#1b1f27',
  flexShrink: 0,
};

// ─── Part Card ────────────────────────────────────────────────────────────────

interface PartCardProps {
  part: COTSPart;
  onInsert: (part: COTSPart) => void;
  isKo: boolean;
  tt: (typeof dict)[keyof typeof dict];
}

function PartCard({ part, onInsert, isKo, tt }: PartCardProps) {
  const [hovered, setHovered] = useState(false);
  const color = CATEGORY_COLOR[part.category];
  const label = isKo ? part.nameKo : part.name;

  return (
    <div
      style={{
        ...cardStyle,
        background: hovered ? C.cardHover : C.card,
        borderColor: hovered ? C.accent + '55' : C.border,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Name + badge row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 5 }}>
        <span
          style={{
            display: 'inline-block',
            padding: '1px 7px',
            borderRadius: 10,
            fontSize: 10,
            fontWeight: 700,
            background: color + '22',
            color,
            border: `1px solid ${color}55`,
            flexShrink: 0,
            alignSelf: 'center',
          }}
        >
          {tt.cat[part.category as CatKey] ?? part.category}
        </span>
        <span style={{ fontSize: 12, fontWeight: 600, color: C.text, lineHeight: 1.4 }}>
          {label}
        </span>
      </div>

      {/* Standard + params */}
      <div style={{ fontSize: 11, color: C.dim, marginBottom: 6 }}>
        <span
          style={{
            background: '#30363d',
            borderRadius: 4,
            padding: '1px 5px',
            marginRight: 6,
            fontSize: 10,
            color: C.accent,
          }}
        >
          {part.standard}
        </span>
        {buildParamSummary(part.params)}
      </div>

      {/* Weight + price + insert */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: C.dim }}>
          {tt.weight}: <span style={{ color: C.text }}>{formatWeight(part.unitWeightG)}</span>
        </span>
        <span style={{ fontSize: 11, color: C.dim }}>
          {tt.price}: <span style={{ color: C.success }}>{formatKRW(part.unitPriceKRW)}</span>
        </span>
        <span style={{ fontSize: 10, color: C.dim, flex: 1, textAlign: 'right' }}>
          {part.suppliers.join(' · ')}
        </span>
        <button
          onClick={() => onInsert(part)}
          style={{
            padding: '3px 12px',
            borderRadius: 5,
            border: `1px solid ${C.accent}66`,
            background: C.accent + '22',
            color: C.accent,
            fontSize: 11,
            cursor: 'pointer',
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          {tt.insert}
        </button>
      </div>
    </div>
  );
}

// ─── COTSPanel ────────────────────────────────────────────────────────────────

export default function COTSPanel({ open, onClose, onInsert, lang }: COTSPanelProps) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? 'en';
  const langMap: Record<string, keyof typeof dict> = {
    kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
  };
  const resolvedLang: keyof typeof dict = langMap[seg] ?? (lang === 'ko' ? 'ko' : 'en');
  const tt = dict[resolvedLang];
  const isKo = resolvedLang === 'ko';
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>('all');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return COTS_PARTS.filter((p) => {
      const matchCat = activeCategory === 'all' || p.category === activeCategory;
      if (!matchCat) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.nameKo.includes(q) ||
        p.standard.toLowerCase().includes(q) ||
        p.id.includes(q)
      );
    });
  }, [search, activeCategory]);

  const handleInsert = useCallback(
    (part: COTSPart) => {
      onInsert(part);
    },
    [onInsert],
  );

  if (!open) return null;

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={drawerStyle} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={headerStyle}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>
            {tt.title}
          </span>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: C.dim,
              cursor: 'pointer',
              fontSize: 18,
              lineHeight: 1,
              padding: '0 2px',
            }}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Search */}
        <div style={{ padding: '10px 12px', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tt.searchPlaceholder}
            style={searchInputStyle}
          />
        </div>

        {/* Category tabs */}
        <div style={tabRowStyle}>
          {CATEGORY_TABS.map((tab) => {
            const isActive = activeCategory === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveCategory(tab.key)}
                style={{
                  padding: '3px 10px',
                  borderRadius: 12,
                  border: `1px solid ${isActive ? tab.color + '99' : C.border}`,
                  background: isActive ? tab.color + '22' : 'transparent',
                  color: isActive ? tab.color : C.dim,
                  fontSize: 11,
                  fontWeight: isActive ? 700 : 400,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                {tt.cat[tab.key as CatKey] ?? (isKo ? tab.labelKo : tab.labelEn)}
              </button>
            );
          })}
        </div>

        {/* Part list */}
        <div style={scrollStyle}>
          {filtered.length === 0 ? (
            <div style={{ textAlign: 'center', color: C.dim, padding: '40px 0', fontSize: 13 }}>
              {tt.noResults}
            </div>
          ) : (
            filtered.map((part) => (
              <PartCard key={part.id} part={part} onInsert={handleInsert} isKo={isKo} tt={tt} />
            ))
          )}
        </div>

        {/* Footer */}
        <div style={footerStyle}>
          {tt.footerShowing(filtered.length, COTS_PARTS.length)}
          {' · '}
          {tt.footerVat}
        </div>
      </div>
    </div>
  );
}
