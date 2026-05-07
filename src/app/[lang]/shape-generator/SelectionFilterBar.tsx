'use client';

import React from 'react';

export type SelectionFilter = 'vertex' | 'edge' | 'face' | 'body';

interface SelectionFilterBarProps {
  activeFilters: SelectionFilter[];
  onToggle: (filter: SelectionFilter) => void;
  lang: string;
}

const FILTER_LABELS: Record<string, Record<SelectionFilter | 'title' | 'all' | 'none', string>> = {
  ko: { title: '선택 필터', vertex: '정점', edge: '엣지', face: '면', body: '바디', all: '전체 선택', none: '전체 해제' },
  en: { title: 'Selection Filter', vertex: 'Vertex', edge: 'Edge', face: 'Face', body: 'Body', all: 'All', none: 'None' },
  ja: { title: '選択フィルター', vertex: '頂点', edge: 'エッジ', face: '面', body: 'ボディ', all: '全選択', none: '全解除' },
  cn: { title: '选择过滤', vertex: '顶点', edge: '边', face: '面', body: '体', all: '全选', none: '全部取消' },
  es: { title: 'Filtro de Selección', vertex: 'Vértice', edge: 'Arista', face: 'Cara', body: 'Cuerpo', all: 'Todos', none: 'Ninguno' },
  ar: { title: 'مرشح التحديد', vertex: 'رأس', edge: 'حافة', face: 'وجه', body: 'جسم', all: 'الكل', none: 'لا شيء' },
};

const FILTERS: { id: SelectionFilter; icon: string }[] = [
  { id: 'vertex', icon: '•' },
  { id: 'edge', icon: '╱' },
  { id: 'face', icon: '▢' },
  { id: 'body', icon: '■' },
];

function lbl(lang: string, key: string): string {
  return (FILTER_LABELS[lang] ?? FILTER_LABELS.en)[key as SelectionFilter] ?? (FILTER_LABELS.en[key as SelectionFilter] ?? key);
}

export default function SelectionFilterBar({ activeFilters, onToggle, lang }: SelectionFilterBarProps) {
  const allActive = FILTERS.every(f => activeFilters.includes(f.id));

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 2,
      padding: '2px 8px', height: 26,
      background: '#161b22', borderBottom: '1px solid #21262d',
      flexShrink: 0,
      direction: lang === 'ar' ? 'rtl' : 'ltr',
    }}>
      <span style={{ color: '#6e7681', fontSize: 10, fontWeight: 700, marginRight: 4 }}>
        {lbl(lang, 'title')}:
      </span>
      {FILTERS.map(f => {
        const active = activeFilters.includes(f.id);
        return (
          <button
            key={f.id}
            onClick={() => onToggle(f.id)}
            title={lbl(lang, f.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 3,
              padding: '2px 8px', borderRadius: 4,
              border: active ? '1px solid #388bfd' : '1px solid transparent',
              background: active ? 'rgba(56,139,253,0.15)' : 'transparent',
              color: active ? '#58a6ff' : '#6e7681',
              fontSize: 10, fontWeight: 700, cursor: 'pointer',
              fontFamily: 'system-ui, sans-serif',
              transition: 'all 0.12s',
            }}
            onMouseEnter={e => { if (!active) e.currentTarget.style.color = '#c9d1d9'; }}
            onMouseLeave={e => { if (!active) e.currentTarget.style.color = '#6e7681'; }}
          >
            <span style={{ fontSize: 12, lineHeight: 1 }}>{f.icon}</span>
            {lbl(lang, f.id)}
          </button>
        );
      })}
      <div style={{ flex: 1 }} />
      <button
        onClick={() => {
          FILTERS.forEach(f => {
            if (allActive && activeFilters.includes(f.id)) onToggle(f.id);
            if (!allActive && !activeFilters.includes(f.id)) onToggle(f.id);
          });
        }}
        style={{
          padding: '1px 6px', borderRadius: 3,
          border: '1px solid #21262d', background: 'transparent',
          color: '#6e7681', fontSize: 9, fontWeight: 700,
          cursor: 'pointer', fontFamily: 'system-ui, sans-serif',
        }}
      >
        {allActive ? lbl(lang, 'none') : lbl(lang, 'all')}
      </button>
    </div>
  );
}
