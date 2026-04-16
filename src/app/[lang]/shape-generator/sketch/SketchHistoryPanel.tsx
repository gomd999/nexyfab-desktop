'use client';

import React from 'react';
import type { SketchHistoryEntry } from './SketchHistory';
import { saveSketchTemplate } from './SketchHistory';

// ─── Props ───────────────────────────────────────────────────────────────────

interface SketchHistoryPanelProps {
  entries: SketchHistoryEntry[];
  onLoad: (entry: SketchHistoryEntry) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  t: Record<string, string>;
}

// ─── Colors ──────────────────────────────────────────────────────────────────

const C = {
  bg: '#161b22',
  bgCard: '#21262d',
  bgHover: '#2d333b',
  border: '#30363d',
  text: '#c9d1d9',
  textMuted: '#8b949e',
  accent: '#388bfd',
  danger: '#f85149',
  dangerBg: '#3d1519',
  success: '#3fb950',
  successBg: '#0d2818',
} as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function planeLabel(plane: 'xy' | 'xz' | 'yz'): string {
  return plane.toUpperCase();
}

// ─── Sketch card ─────────────────────────────────────────────────────────────

interface SketchCardProps {
  entry: SketchHistoryEntry;
  onLoad: (entry: SketchHistoryEntry) => void;
  onDelete: (id: string) => void;
  onSaveTemplate: (entry: SketchHistoryEntry) => void;
  t: Record<string, string>;
}

function SketchCard({ entry, onLoad, onDelete, onSaveTemplate, t }: SketchCardProps) {
  const [hovered, setHovered] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [confirmLoad, setConfirmLoad] = React.useState(false);

  const handleSaveTemplate = () => {
    onSaveTemplate(entry);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: 8,
        borderRadius: 8,
        border: `1px solid ${hovered ? C.accent : C.border}`,
        background: hovered ? C.bgHover : C.bgCard,
        transition: 'all 0.15s',
        cursor: 'default',
      }}
    >
      {/* Thumbnail */}
      <div style={{
        width: '100%',
        aspectRatio: '1',
        borderRadius: 6,
        overflow: 'hidden',
        background: C.bg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: `1px solid ${C.border}`,
      }}>
        {entry.thumbnail ? (
          <img
            src={entry.thumbnail}
            alt={entry.label}
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          />
        ) : (
          <span style={{ fontSize: 20, opacity: 0.3 }}>✏️</span>
        )}
      </div>

      {/* Label + meta */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.text, marginBottom: 2 }}>
          {entry.label}
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 2 }}>
          <span style={{
            fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4,
            background: '#1a2332', color: C.accent, border: `1px solid ${C.accent}44`,
          }}>
            {planeLabel(entry.plane)}
          </span>
          <span style={{
            fontSize: 9, fontWeight: 600, padding: '1px 5px', borderRadius: 4,
            background: C.bg, color: C.textMuted,
          }}>
            {entry.profile.segments.length} seg
          </span>
          <span style={{
            fontSize: 9, fontWeight: 600, padding: '1px 5px', borderRadius: 4,
            background: C.bg, color: C.textMuted,
          }}>
            {entry.config.mode}
          </span>
        </div>
        <div style={{ fontSize: 9, color: C.textMuted }}>
          {formatTimestamp(entry.timestamp)}
        </div>
      </div>

      {/* Actions */}
      {confirmLoad && (
        <div style={{ display: 'flex', gap: 4, padding: '4px 0' }}>
          <span style={{ fontSize: 10, color: '#e3b341', flex: 1 }}>{t.confirmLoadSketch || '현재 스케치를 대체합니다'}</span>
          <button onClick={() => setConfirmLoad(false)} style={{ padding: '3px 7px', borderRadius: 4, border: '1px solid #30363d', background: '#161b22', color: '#8b949e', fontSize: 10, cursor: 'pointer' }}>
            {t.cancel || '취소'}
          </button>
          <button onClick={() => { setConfirmLoad(false); onLoad(entry); }} style={{ padding: '3px 7px', borderRadius: 4, border: '1px solid #388bfd', background: '#388bfd', color: '#fff', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>
            {t.loadSketch || '불러오기'}
          </button>
        </div>
      )}
      <div style={{ display: 'flex', gap: 4 }}>
        {/* Load */}
        <button
          onClick={() => setConfirmLoad(true)}
          title={t.loadSketch || 'Load'}
          style={{
            flex: 1,
            padding: '4px 0',
            borderRadius: 5,
            border: `1px solid ${C.accent}`,
            background: C.accent,
            color: '#fff',
            fontSize: 10,
            fontWeight: 700,
            cursor: 'pointer',
            transition: 'opacity 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.opacity = '0.85'; }}
          onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
        >
          {t.loadSketch || 'Load'}
        </button>

        {/* Save as template */}
        <button
          onClick={handleSaveTemplate}
          title={t.saveAsTemplate || 'Save as Template'}
          style={{
            padding: '4px 5px',
            borderRadius: 5,
            border: `1px solid ${saved ? C.success : C.border}`,
            background: saved ? C.successBg : C.bg,
            color: saved ? C.success : C.textMuted,
            fontSize: 12,
            cursor: 'pointer',
            transition: 'all 0.15s',
            lineHeight: 1,
          }}
        >
          {saved ? '✓' : '★'}
        </button>

        {/* Delete */}
        <button
          onClick={() => onDelete(entry.id)}
          title="Delete"
          style={{
            padding: '4px 5px',
            borderRadius: 5,
            border: `1px solid ${C.dangerBg}`,
            background: C.dangerBg,
            color: C.danger,
            fontSize: 12,
            fontWeight: 700,
            cursor: 'pointer',
            transition: 'opacity 0.15s',
            lineHeight: 1,
          }}
          onMouseEnter={e => { e.currentTarget.style.opacity = '0.75'; }}
          onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
        >
          ×
        </button>
      </div>
    </div>
  );
}

// ─── Panel ───────────────────────────────────────────────────────────────────

export default function SketchHistoryPanel({
  entries,
  onLoad,
  onDelete,
  onClose,
  t,
}: SketchHistoryPanelProps) {
  const handleSaveTemplate = (entry: SketchHistoryEntry) => {
    saveSketchTemplate(entry);
  };

  return (
    <div style={{
      position: 'absolute',
      bottom: '100%',
      left: 0,
      right: 0,
      marginBottom: 8,
      background: C.bg,
      border: `1px solid ${C.border}`,
      borderRadius: 12,
      boxShadow: '0 -8px 32px rgba(0,0,0,0.5)',
      padding: 14,
      zIndex: 200,
      maxHeight: 380,
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 800, color: C.text, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>🕐</span>
          {t.sketchHistory || 'Sketch History'}
        </h3>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: C.textMuted,
            fontSize: 16,
            cursor: 'pointer',
            padding: '2px 6px',
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>

      {/* Content */}
      {entries.length === 0 ? (
        <div style={{
          padding: '24px 0',
          textAlign: 'center',
          color: C.textMuted,
          fontSize: 12,
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 28, display: 'block', marginBottom: 8, opacity: 0.3 }}>✏️</span>
          {t.noSketchHistory || 'No sketch history yet'}
        </div>
      ) : (
        <div style={{
          overflowY: 'auto',
          flex: 1,
          paddingRight: 2,
        }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
            gap: 8,
          }}>
            {[...entries].reverse().map(entry => (
              <SketchCard
                key={entry.id}
                entry={entry}
                onLoad={onLoad}
                onDelete={onDelete}
                onSaveTemplate={handleSaveTemplate}
                t={t}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
