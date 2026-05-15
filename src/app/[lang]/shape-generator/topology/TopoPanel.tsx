'use client';
/**
 * TopoPanel – Topological Naming Debug & Inspector Panel
 *
 * Shows the current topological map in the right sidebar:
 *  - List of all stable face IDs with their geometric signature
 *  - Semantic tags (top, front, etc.)
 *  - Generation counter (how many rebuilds have happened)
 *  - Face matching status (new/stable/lost)
 *  - Click to select/highlight a face in the viewport
 */

import React, { useState } from 'react';
import type { TopologicalMap, StableFace } from './TopologicalNaming';

// ─── i18n ────────────────────────────────────────────────────────────────────

const dict = {
  ko: {
    title: '위상 ID 맵',
    subtitle: '면 ID가 재구성 후에도 유지됩니다',
    generation: '세대',
    faces: '면',
    faceId: '면 ID',
    tag: '의미',
    area: '면적',
    normal: '법선',
    centroid: '무게중심',
    index: '인덱스',
    noFaces: '면 없음 — 형상을 생성하세요',
    search: '면 ID 또는 태그 검색…',
    all: '전체',
    top: '상단', bottom: '하단', front: '앞면', back: '뒷면', left: '왼쪽', right: '오른쪽',
  },
  en: {
    title: 'Topological ID Map',
    subtitle: 'Face IDs persist across parametric rebuilds',
    generation: 'Generation',
    faces: 'faces',
    faceId: 'Face ID',
    tag: 'Semantic',
    area: 'Area',
    normal: 'Normal',
    centroid: 'Centroid',
    index: 'Index',
    noFaces: 'No faces — generate a shape first',
    search: 'Search face ID or tag…',
    all: 'All',
    top: 'Top', bottom: 'Bottom', front: 'Front', back: 'Back', left: 'Left', right: 'Right',
  },
} as const;
type DictLang = keyof typeof dict;

const TAGS = ['top', 'bottom', 'front', 'back', 'left', 'right'] as const;

const TAG_COLORS: Record<string, string> = {
  top:    'var(--nx-ok)',
  bottom: 'var(--nx-error)',
  front:  'var(--nx-accent)',
  back:   '#bc8cff',
  left:   'var(--nx-warn)',
  right:  'var(--nx-accent-2)',
};

// ─── Props ───────────────────────────────────────────────────────────────────

interface TopoPanelProps {
  map: TopologicalMap;
  /** Currently hovered/selected face index in the 3D viewport */
  selectedFaceIndex?: number | null;
  /** Called when user clicks a row to highlight that face */
  onSelectFace?: (faceIndex: number) => void;
  lang?: string;
  visible?: boolean;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function TopoPanel({
  map,
  selectedFaceIndex,
  onSelectFace,
  lang = 'en',
  visible = true,
}: TopoPanelProps) {
  const langKey = (lang === 'ko' || lang === 'kr') ? 'ko' : 'en';
  const t = dict[langKey as DictLang] ?? dict.en;

  const [search, setSearch] = useState('');
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  if (!visible) return null;

  const allFaces: StableFace[] = Object.values(map.faces);

  const filtered = allFaces.filter(f => {
    if (tagFilter && f.tag !== tagFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        f.stableId.toLowerCase().includes(q) ||
        (f.tag || '').toLowerCase().includes(q) ||
        (f.originFeatureId || '').toLowerCase().includes(q)
      );
    }
    return true;
  }).sort((a, b) => a.faceIndex - b.faceIndex);

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      background: 'var(--nx-bg)',
      border: '1px solid var(--nx-panel-2)',
      borderRadius: 10,
      overflow: 'hidden',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 14px',
        borderBottom: '1px solid var(--nx-panel-2)',
        background: 'linear-gradient(135deg, rgba(56,139,253,0.08), rgba(188,140,255,0.08))',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
          <span style={{ fontSize: 14 }}>🏷️</span>
          <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--nx-text)' }}>{t.title}</span>
          <span style={{
            marginLeft: 'auto',
            fontSize: 10, fontWeight: 700,
            color: 'var(--nx-accent)',
            background: 'rgba(56,139,253,0.12)',
            border: '1px solid rgba(56,139,253,0.3)',
            borderRadius: 4,
            padding: '1px 6px',
          }}>
            {t.generation} {map.generation}
          </span>
        </div>
        <div style={{ fontSize: 10, color: 'var(--nx-text-2)' }}>
          {t.subtitle} · {allFaces.length} {t.faces}
        </div>
      </div>

      {/* Tag filter chips */}
      <div style={{
        display: 'flex', gap: 4, padding: '8px 12px',
        borderBottom: '1px solid var(--nx-panel-2)',
        flexWrap: 'wrap',
      }}>
        <button
          onClick={() => setTagFilter(null)}
          style={{
            padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 700,
            border: tagFilter === null ? '1px solid var(--nx-accent)' : '1px solid var(--nx-border)',
            background: tagFilter === null ? 'var(--nx-accent-soft)' : 'var(--nx-panel)',
            color: tagFilter === null ? 'var(--nx-accent-2)' : 'var(--nx-text-3)',
            cursor: 'pointer',
          }}
        >
          {t.all}
        </button>
        {TAGS.map(tag => {
          const count = allFaces.filter(f => f.tag === tag).length;
          if (count === 0) return null;
          const active = tagFilter === tag;
          const color = TAG_COLORS[tag] ?? 'var(--nx-text-2)';
          return (
            <button
              key={tag}
              onClick={() => setTagFilter(active ? null : tag)}
              style={{
                padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 700,
                border: active ? `1px solid ${color}` : '1px solid var(--nx-border)',
                background: active ? `${color}22` : 'var(--nx-panel)',
                color: active ? color : 'var(--nx-text-3)',
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 3,
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, display: 'inline-block' }} />
              {t[tag as keyof typeof t] ?? tag}
              <span style={{ opacity: 0.7 }}>({count})</span>
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div style={{ padding: '6px 12px', borderBottom: '1px solid var(--nx-panel-2)' }}>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={t.search}
          style={{
            width: '100%', boxSizing: 'border-box',
            background: 'var(--nx-panel)', border: '1px solid var(--nx-border)',
            borderRadius: 6, color: 'var(--nx-text)', fontSize: 11,
            padding: '5px 8px', outline: 'none',
          }}
        />
      </div>

      {/* Face list */}
      <div className="nf-scroll" style={{ flex: 1, overflowY: 'auto', maxHeight: 340 }}>
        {filtered.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', fontSize: 11, color: 'var(--nx-border-strong)', fontStyle: 'italic' }}>
            {t.noFaces}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
            <thead>
              <tr style={{ background: 'var(--nx-panel)', position: 'sticky', top: 0, zIndex: 1 }}>
                {[t.index, t.tag, t.faceId, t.area].map(col => (
                  <th key={col} style={{
                    padding: '4px 8px', textAlign: 'left',
                    color: 'var(--nx-text-3)', fontWeight: 700, fontSize: 9,
                    textTransform: 'uppercase', letterSpacing: '0.05em',
                    borderBottom: '1px solid var(--nx-panel-2)',
                  }}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(face => {
                const isSelected = face.faceIndex === selectedFaceIndex;
                const tagColor = TAG_COLORS[face.tag ?? ''] ?? 'var(--nx-text-2)';
                return (
                  <tr
                    key={face.stableId}
                    onClick={() => onSelectFace?.(face.faceIndex)}
                    style={{
                      background: isSelected ? 'rgba(56,139,253,0.1)' : 'transparent',
                      cursor: onSelectFace ? 'pointer' : 'default',
                      transition: 'background 0.1s',
                      borderBottom: '1px solid var(--nx-panel)',
                    }}
                    onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'var(--nx-panel)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = isSelected ? 'rgba(56,139,253,0.1)' : 'transparent'; }}
                  >
                    <td style={{ padding: '4px 8px', color: 'var(--nx-text-3)', fontFamily: 'monospace' }}>
                      {face.faceIndex}
                    </td>
                    <td style={{ padding: '4px 8px' }}>
                      <span style={{
                        padding: '1px 6px', borderRadius: 8,
                        fontSize: 9, fontWeight: 700,
                        background: `${tagColor}20`,
                        color: tagColor, border: `1px solid ${tagColor}40`,
                      }}>
                        {t[face.tag as keyof typeof t] ?? face.tag ?? '—'}
                      </span>
                    </td>
                    <td style={{ padding: '4px 8px', fontFamily: 'monospace', color: 'var(--nx-text-2)', fontSize: 9 }}>
                      {face.stableId.slice(0, 16)}…
                    </td>
                    <td style={{ padding: '4px 8px', color: 'var(--nx-text)', fontFamily: 'monospace' }}>
                      {face.signature.area.toFixed(1)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Selected face detail */}
      {selectedFaceIndex != null && (() => {
        const face = Object.values(map.faces).find(f => f.faceIndex === selectedFaceIndex);
        if (!face) return null;
        const _tagColor = TAG_COLORS[face.tag ?? ''] ?? 'var(--nx-text-2)';
        return (
          <div style={{
            padding: '8px 12px',
            borderTop: '1px solid var(--nx-panel-2)',
            background: 'rgba(56,139,253,0.05)',
          }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--nx-text-3)', textTransform: 'uppercase', marginBottom: 4, letterSpacing: '0.05em' }}>
              {t.faceId}
            </div>
            <div style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--nx-accent-2)', marginBottom: 4, wordBreak: 'break-all' }}>
              {face.stableId}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 10, color: 'var(--nx-text-2)' }}>
                {t.normal}: <span style={{ color: 'var(--nx-text)', fontFamily: 'monospace' }}>
                  [{face.signature.normal.map(v => v.toFixed(2)).join(', ')}]
                </span>
              </div>
              <div style={{ fontSize: 10, color: 'var(--nx-text-2)' }}>
                {t.area}: <span style={{ color: 'var(--nx-text)', fontFamily: 'monospace' }}>
                  {face.signature.area.toFixed(1)} mm²
                </span>
              </div>
            </div>
            <div style={{ fontSize: 10, color: 'var(--nx-text-2)', marginTop: 2 }}>
              {t.centroid}: <span style={{ color: 'var(--nx-text)', fontFamily: 'monospace' }}>
                [{face.signature.centroid.map(v => v.toFixed(1)).join(', ')}]
              </span>
            </div>
            {face.originFeatureId && (
              <div style={{ fontSize: 9, color: 'var(--nx-text-3)', marginTop: 4, fontFamily: 'monospace' }}>
                Origin: {face.originFeatureId.slice(0, 24)}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
