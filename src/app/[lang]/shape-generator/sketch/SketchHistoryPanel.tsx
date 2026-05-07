'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import type { SketchHistoryEntry } from './SketchHistory';
import { saveSketchTemplate } from './SketchHistory';

// ─── i18n dict ───────────────────────────────────────────────────────────────
const dict = {
  ko: {
    sketchHistory: 'Sketch 히스토리',
    noSketchHistory: '아직 스케치 기록이 없습니다',
    loadSketch: '불러오기',
    saveAsTemplate: '템플릿으로 저장',
    cancel: '취소',
    confirmLoadSketch: '현재 스케치를 대체합니다',
    deleteTitle: '삭제',
    loadTitle: '불러오기',
  },
  en: {
    sketchHistory: 'Sketch History',
    noSketchHistory: 'No sketch history yet',
    loadSketch: 'Load',
    saveAsTemplate: 'Save as Template',
    cancel: 'Cancel',
    confirmLoadSketch: 'This will replace the current sketch',
    deleteTitle: 'Delete',
    loadTitle: 'Load',
  },
  ja: {
    sketchHistory: 'Sketch 履歴',
    noSketchHistory: 'まだスケッチ履歴がありません',
    loadSketch: '読み込む',
    saveAsTemplate: 'テンプレートとして保存',
    cancel: 'キャンセル',
    confirmLoadSketch: '現在のスケッチを置き換えます',
    deleteTitle: '削除',
    loadTitle: '読み込む',
  },
  zh: {
    sketchHistory: 'Sketch 历史',
    noSketchHistory: '暂无草图历史记录',
    loadSketch: '加载',
    saveAsTemplate: '保存为模板',
    cancel: '取消',
    confirmLoadSketch: '将替换当前草图',
    deleteTitle: '删除',
    loadTitle: '加载',
  },
  es: {
    sketchHistory: 'Historial de Sketch',
    noSketchHistory: 'Aún no hay historial de bocetos',
    loadSketch: 'Cargar',
    saveAsTemplate: 'Guardar como plantilla',
    cancel: 'Cancelar',
    confirmLoadSketch: 'Esto reemplazará el boceto actual',
    deleteTitle: 'Eliminar',
    loadTitle: 'Cargar',
  },
  ar: {
    sketchHistory: 'سجل Sketch',
    noSketchHistory: 'لا يوجد سجل رسم بعد',
    loadSketch: 'تحميل',
    saveAsTemplate: 'حفظ كقالب',
    cancel: 'إلغاء',
    confirmLoadSketch: 'سيحل هذا محل الرسم الحالي',
    deleteTitle: 'حذف',
    loadTitle: 'تحميل',
  },
} as const;

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
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? 'en';
  const langMap: Record<string, keyof typeof dict> = {
    kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
  };
  const tt = dict[langMap[seg] ?? 'en'];

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
          <span style={{ fontSize: 10, color: '#e3b341', flex: 1 }}>{t.confirmLoadSketch || tt.confirmLoadSketch}</span>
          <button onClick={() => setConfirmLoad(false)} style={{ padding: '3px 7px', borderRadius: 4, border: '1px solid #30363d', background: '#161b22', color: '#8b949e', fontSize: 10, cursor: 'pointer' }}>
            {t.cancel || tt.cancel}
          </button>
          <button onClick={() => { setConfirmLoad(false); onLoad(entry); }} style={{ padding: '3px 7px', borderRadius: 4, border: '1px solid #388bfd', background: '#388bfd', color: '#fff', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>
            {t.loadSketch || tt.loadSketch}
          </button>
        </div>
      )}
      <div style={{ display: 'flex', gap: 4 }}>
        {/* Load */}
        <button
          onClick={() => setConfirmLoad(true)}
          title={t.loadSketch || tt.loadTitle}
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
          {t.loadSketch || tt.loadSketch}
        </button>

        {/* Save as template */}
        <button
          onClick={handleSaveTemplate}
          title={t.saveAsTemplate || tt.saveAsTemplate}
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
          title={tt.deleteTitle}
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
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? 'en';
  const langMap: Record<string, keyof typeof dict> = {
    kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
  };
  const tt = dict[langMap[seg] ?? 'en'];

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
          {t.sketchHistory || tt.sketchHistory}
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
          {t.noSketchHistory || tt.noSketchHistory}
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
