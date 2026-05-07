'use client';
import React, { useState, useCallback } from 'react';
import { usePathname } from 'next/navigation';

const dict = {
  ko: { title: '어셈블리 브라우저', empty: '어셈블리에 파트가 없습니다', hide: '숨기기', show: '표시', solid: '불투명', transparent: '투명' },
  en: { title: 'Assembly Browser', empty: 'No parts in assembly', hide: 'Hide', show: 'Show', solid: 'Solid', transparent: 'Transparent' },
  ja: { title: 'アセンブリブラウザ', empty: 'アセンブリにパーツがありません', hide: '非表示', show: '表示', solid: '不透明', transparent: '透明' },
  zh: { title: '装配浏览器', empty: '装配中无零件', hide: '隐藏', show: '显示', solid: '实体', transparent: '透明' },
  es: { title: 'Navegador de Ensamblaje', empty: 'Sin piezas en el ensamblaje', hide: 'Ocultar', show: 'Mostrar', solid: 'Sólido', transparent: 'Transparente' },
  ar: { title: 'متصفح التجميع', empty: 'لا توجد أجزاء في التجميع', hide: 'إخفاء', show: 'إظهار', solid: 'صلب', transparent: 'شفاف' },
};

interface PartInfo {
  name: string;
  visible: boolean;
  transparent: boolean;
}

interface AssemblyBrowserProps {
  parts: PartInfo[];
  assemblyName: string;
  onToggleVisible: (index: number) => void;
  onToggleTransparent: (index: number) => void;
  onSelectPart: (index: number) => void;
  selectedIndex: number | null;
}

export default function AssemblyBrowser({
  parts,
  assemblyName,
  onToggleVisible,
  onToggleTransparent,
  onSelectPart,
  selectedIndex,
}: AssemblyBrowserProps) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? 'en';
  const langMap: Record<string, keyof typeof dict> = {
    kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
  };
  const t = dict[langMap[seg] ?? 'en'];
  const [expanded, setExpanded] = useState(true);

  const toggleExpand = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);

  return (
    <div
      style={{
        background: '#fff',
        borderRadius: 16,
        border: '1px solid #e5e7eb',
        padding: 16,
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: expanded ? 10 : 0,
        }}
      >
        <h3
          style={{
            fontSize: 14,
            fontWeight: 800,
            color: '#374151',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            margin: 0,
          }}
        >
          <span style={{ fontSize: 16 }}>🗂️</span>
          {t.title}
        </h3>
      </div>

      {/* Root node */}
      <div
        onClick={toggleExpand}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 8px',
          borderRadius: 8,
          background: '#f9fafb',
          border: '1px solid #e5e7eb',
          cursor: 'pointer',
          marginBottom: expanded ? 6 : 0,
          userSelect: 'none',
        }}
      >
        <span
          style={{
            fontSize: 10,
            color: '#6b7280',
            fontFamily: 'monospace',
            width: 14,
            textAlign: 'center',
            flexShrink: 0,
          }}
        >
          {expanded ? '▼' : '▶'}
        </span>
        <span style={{ fontSize: 14 }}>📦</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#374151', flex: 1 }}>
          {assemblyName}
        </span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: '#6366f1',
            background: '#ede9fe',
            borderRadius: 8,
            padding: '1px 7px',
            flexShrink: 0,
          }}
        >
          {parts.length}
        </span>
      </div>

      {/* Part list */}
      {expanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingLeft: 14 }}>
          {parts.length === 0 ? (
            <div style={{ padding: '12px 0', textAlign: 'center' }}>
              <p style={{ color: '#9ca3af', fontSize: 12, margin: 0 }}>{t.empty}</p>
            </div>
          ) : (
            parts.map((part, idx) => {
              const isSelected = idx === selectedIndex;

              return (
                <div
                  key={idx}
                  onClick={() => onSelectPart(idx)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '5px 8px',
                    borderRadius: 8,
                    border: isSelected ? '2px solid #6366f1' : '1px solid transparent',
                    background: isSelected ? '#f5f3ff' : 'transparent',
                    cursor: 'pointer',
                    transition: 'all 0.12s',
                  }}
                >
                  {/* Tree indent line */}
                  <span
                    style={{
                      width: 10,
                      height: 1,
                      background: '#d1d5db',
                      flexShrink: 0,
                    }}
                  />

                  {/* Part icon */}
                  <span style={{ fontSize: 13, flexShrink: 0 }}>🔧</span>

                  {/* Part name */}
                  <span
                    style={{
                      flex: 1,
                      fontSize: 12,
                      fontWeight: 600,
                      color: isSelected ? '#6366f1' : '#374151',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {part.name}
                  </span>

                  {/* Visibility toggle */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleVisible(idx);
                    }}
                    title={part.visible ? t.hide : t.show}
                    style={{
                      padding: '1px 4px',
                      border: 'none',
                      background: 'transparent',
                      cursor: 'pointer',
                      fontSize: 13,
                      flexShrink: 0,
                      opacity: part.visible ? 1 : 0.35,
                      transition: 'opacity 0.12s',
                    }}
                  >
                    👁️
                  </button>

                  {/* Transparency toggle */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleTransparent(idx);
                    }}
                    title={part.transparent ? t.solid : t.transparent}
                    style={{
                      padding: '1px 4px',
                      border: 'none',
                      background: 'transparent',
                      cursor: 'pointer',
                      fontSize: 13,
                      flexShrink: 0,
                      opacity: part.transparent ? 1 : 0.35,
                      transition: 'opacity 0.12s',
                    }}
                  >
                    👻
                  </button>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
