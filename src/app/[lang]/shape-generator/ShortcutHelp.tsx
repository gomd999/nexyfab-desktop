'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { shapeDict } from './shapeDict';
import {
  loadCustomShortcuts,
  saveCustomShortcuts,
  DEFAULT_SHORTCUTS,
} from './shortcutConfig';

type Lang = keyof typeof shapeDict;

interface ShortcutHelpProps {
  visible: boolean;
  onClose: () => void;
  lang: string;
}

interface ShortcutItem {
  id: string;
  keys: string[];
  label: string;
  customizable?: boolean;
}

interface ShortcutCategory {
  title: string;
  items: ShortcutItem[];
}

// Re-export for backward-compat callers
export { loadCustomShortcuts, saveCustomShortcuts };
export function getCustomKey(actionId: string, defaultKey: string): string {
  const map = loadCustomShortcuts();
  return map[actionId] ?? defaultKey;
}

export default function ShortcutHelp({ visible, onClose, lang }: ShortcutHelpProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const t = shapeDict[lang as Lang] ?? shapeDict.en;
  const isKo = lang === 'ko';

  const [editMode, setEditMode] = useState(false);
  const [customKeys, setCustomKeys] = useState<Record<string, string>>({});
  const [capturingId, setCapturingId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  // Load saved shortcuts when panel opens
  useEffect(() => {
    if (visible) setCustomKeys(loadCustomShortcuts());
  }, [visible]);

  // Key capture handler
  useEffect(() => {
    if (!visible) return;
    const handler = (e: KeyboardEvent) => {
      if (capturingId) {
        e.preventDefault();
        e.stopPropagation();
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
          setCustomKeys(prev => ({ ...prev, [capturingId]: e.key.toUpperCase() }));
          setCapturingId(null);
          setDirty(true);
        } else if (e.key === 'Escape') {
          setCapturingId(null);
        }
        return;
      }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [visible, onClose, capturingId]);

  const handleSave = useCallback(() => {
    saveCustomShortcuts(customKeys);
    setDirty(false);
    setEditMode(false);
    window.dispatchEvent(new CustomEvent('nexyfab:shortcuts-updated'));
  }, [customKeys]);

  const handleReset = useCallback(() => {
    saveCustomShortcuts({});
    setCustomKeys({});
    setDirty(false);
    window.dispatchEvent(new CustomEvent('nexyfab:shortcuts-updated'));
  }, []);

  if (!visible) return null;

  // Effective display key for a customizable item
  const dk = (id: string) => customKeys[id] ?? DEFAULT_SHORTCUTS[id] ?? '';

  const categories: ShortcutCategory[] = [
    {
      title: isKo ? '일반' : 'General',
      items: [
        { id: 'undo',        keys: ['Ctrl', 'Z'],        label: isKo ? '실행 취소'          : 'Undo' },
        { id: 'redo',        keys: ['Ctrl', 'Shift', 'Z'], label: isKo ? '다시 실행'         : 'Redo' },
        { id: 'save',        keys: ['Ctrl', 'S'],        label: isKo ? '저장 (.nfab)'       : 'Save (.nfab)' },
        { id: 'saveCloud',   keys: ['Ctrl', 'Shift', 'S'], label: isKo ? '클라우드 저장'     : 'Cloud save' },
        { id: 'open',        keys: ['Ctrl', 'O'],        label: isKo ? '열기 (.nfab)'       : 'Open (.nfab)' },
        { id: 'cmd_palette', keys: ['Ctrl', 'K'],        label: isKo ? '커맨드 팔레트'       : 'Command palette' },
        { id: 'cancel',      keys: ['Esc'],              label: isKo ? '취소 / 닫기'         : 'Cancel / Close' },
        { id: 'showHelp',    keys: ['?'],                label: isKo ? '단축키 도움말'        : 'Shortcut help' },
      ],
    },
    {
      title: isKo ? '3D 뷰포트' : '3D Viewport',
      items: [
        { id: 'translate', keys: [dk('translate')], label: isKo ? '이동 기즈모'   : 'Translate gizmo',  customizable: true },
        { id: 'rotate',    keys: [dk('rotate')],    label: isKo ? '회전 기즈모'   : 'Rotate gizmo',     customizable: true },
        { id: 'scale',     keys: [dk('scale')],     label: isKo ? '스케일 기즈모' : 'Scale gizmo',      customizable: true },
        { id: 'view_fit',  keys: [dk('view_fit')],  label: isKo ? '카메라 맞추기' : 'Fit to view',      customizable: true },
        { id: 'measure',   keys: [dk('measure')],   label: isKo ? '측정 토글'     : 'Toggle measure',   customizable: true },
        { id: 'dims',      keys: [dk('dims')],      label: isKo ? '치수 토글'     : 'Toggle dimensions',customizable: true },
        { id: 'perf',      keys: [dk('perf')],      label: isKo ? '성능 모니터'   : 'Performance monitor', customizable: true },
        { id: 'v_front',   keys: ['5'],             label: isKo ? '정면 뷰'       : 'Front view' },
        { id: 'v_top',     keys: ['7'],             label: isKo ? '상단 뷰'       : 'Top view' },
        { id: 'v_right',   keys: ['6'],             label: isKo ? '우측 뷰'       : 'Right view' },
        { id: 'v_iso',     keys: ['0'],             label: isKo ? '등각 뷰'       : 'Isometric' },
        { id: 'v_vertex',  keys: ['1'],             label: isKo ? '버텍스 편집'   : 'Vertex edit mode' },
        { id: 'v_edge',    keys: ['2'],             label: isKo ? '에지 편집'     : 'Edge edit mode' },
        { id: 'v_face',    keys: ['3'],             label: isKo ? '페이스 편집'   : 'Face edit mode' },
      ],
    },
    {
      title: isKo ? '스케치 모드' : 'Sketch Mode',
      items: [
        { id: 'sketch', keys: [dk('sketch')], label: isKo ? '스케치 모드 전환' : 'Toggle sketch mode', customizable: true },
      ],
    },
    {
      title: isKo ? '스케치 도구 (스케치 모드에서만)' : 'Sketch Tools (sketch mode only)',
      items: [
        { id: 'sk_line',         keys: [dk('sk_line')],         label: isKo ? '선'     : 'Line',        customizable: true },
        { id: 'sk_arc',          keys: [dk('sk_arc')],          label: isKo ? '호'     : 'Arc',         customizable: true },
        { id: 'sk_circle',       keys: [dk('sk_circle')],       label: isKo ? '원'     : 'Circle',      customizable: true },
        { id: 'sk_rect',         keys: [dk('sk_rect')],         label: isKo ? '직사각형': 'Rectangle',  customizable: true },
        { id: 'sk_polygon',      keys: [dk('sk_polygon')],      label: isKo ? '다각형' : 'Polygon',     customizable: true },
        { id: 'sk_ellipse',      keys: [dk('sk_ellipse')],      label: isKo ? '타원'   : 'Ellipse',     customizable: true },
        { id: 'sk_slot',         keys: [dk('sk_slot')],         label: isKo ? '슬롯'   : 'Slot',        customizable: true },
        { id: 'sk_spline',       keys: [dk('sk_spline')],       label: isKo ? '스플라인': 'Spline',     customizable: true },
        { id: 'sk_fillet',       keys: [dk('sk_fillet')],       label: isKo ? '필렛'   : 'Fillet',      customizable: true },
        { id: 'sk_mirror',       keys: [dk('sk_mirror')],       label: isKo ? '미러'   : 'Mirror',      customizable: true },
        { id: 'sk_offset',       keys: [dk('sk_offset')],       label: isKo ? '오프셋' : 'Offset',      customizable: true },
        { id: 'sk_trim',         keys: [dk('sk_trim')],         label: isKo ? '트림'   : 'Trim',        customizable: true },
        { id: 'sk_select',       keys: [dk('sk_select')],       label: isKo ? '선택'   : 'Select',      customizable: true },
        { id: 'sk_dimension',    keys: [dk('sk_dimension')],    label: isKo ? '치수'   : 'Dimension',   customizable: true },
        { id: 'sk_construction', keys: [dk('sk_construction')], label: isKo ? '보조선' : 'Construction',customizable: true },
      ],
    },
  ];

  return (
    <div
      ref={overlayRef}
      onClick={(e) => { if (e.target === overlayRef.current && !capturingId) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
      }}
    >
      <div style={{
        background: '#161b22', border: '1px solid #30363d', borderRadius: 12,
        padding: '20px 24px', width: 520, maxWidth: '95vw',
        boxShadow: '0 16px 48px rgba(0,0,0,0.4)',
        display: 'flex', flexDirection: 'column', maxHeight: '90vh',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: '#c9d1d9', letterSpacing: -0.3 }}>
            ⌨️ {isKo ? '키보드 단축키' : 'Keyboard Shortcuts'}
          </h2>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {editMode ? (
              <>
                <button onClick={handleReset} style={btnStyle('#f85149')}>
                  {isKo ? '초기화' : 'Reset all'}
                </button>
                <button
                  onClick={handleSave}
                  style={btnStyle(dirty ? '#3fb950' : '#484f58')}
                >
                  {isKo ? '저장' : 'Save'}
                </button>
                <button
                  onClick={() => { setEditMode(false); setCustomKeys(loadCustomShortcuts()); setCapturingId(null); }}
                  style={btnStyle('#8b949e')}
                >
                  {isKo ? '취소' : 'Cancel'}
                </button>
              </>
            ) : (
              <button onClick={() => setEditMode(true)} style={btnStyle('#58a6ff')}>
                ✏️ {isKo ? '단축키 편집' : 'Customize'}
              </button>
            )}
            <button
              onClick={onClose}
              style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '2px 6px', borderRadius: 4 }}
              onMouseEnter={e => { e.currentTarget.style.color = '#c9d1d9'; e.currentTarget.style.background = '#21262d'; }}
              onMouseLeave={e => { e.currentTarget.style.color = '#8b949e'; e.currentTarget.style.background = 'none'; }}
            >
              ×
            </button>
          </div>
        </div>

        {editMode && (
          <div style={{ fontSize: 10, color: '#f0883e', background: '#f0883e0a', borderRadius: 5, padding: '5px 10px', marginBottom: 10, border: '1px solid #f0883e22' }}>
            {isKo
              ? '🖊 편집 모드: 변경할 키 버튼 클릭 후 새 키를 누르세요'
              : '🖊 Edit mode: click a key badge, then press the new key'}
          </div>
        )}

        {/* Scrollable categories */}
        <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {categories.map((cat) => (
            <div key={cat.title}>
              <div style={{
                fontSize: 10, fontWeight: 700, color: '#8b949e', textTransform: 'uppercase',
                letterSpacing: 1.2, marginBottom: 7, paddingBottom: 4, borderBottom: '1px solid #21262d',
              }}>
                {cat.title}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '5px 14px', alignItems: 'center' }}>
                {cat.items.map((item) => {
                  const isCapturing = capturingId === item.id;
                  return (
                    <React.Fragment key={item.id}>
                      {/* Key badges */}
                      <div style={{ display: 'flex', gap: 3, justifyContent: 'flex-end', alignItems: 'center' }}>
                        {item.keys.map((key, ki) => (
                          <React.Fragment key={ki}>
                            {ki > 0 && <span style={{ color: '#484f58', fontSize: 10 }}>+</span>}
                            {editMode && item.customizable && item.keys.length === 1 ? (
                              <button
                                onClick={() => setCapturingId(isCapturing ? null : item.id)}
                                style={{
                                  display: 'inline-block', padding: '2px 8px', borderRadius: 4,
                                  background: isCapturing ? '#f0883e22' : '#21262d',
                                  border: `1px solid ${isCapturing ? '#f0883e' : '#388bfd'}`,
                                  color: isCapturing ? '#f0883e' : '#58a6ff',
                                  fontSize: 11, fontWeight: 700,
                                  fontFamily: 'ui-monospace, monospace',
                                  lineHeight: '18px', minWidth: 24, textAlign: 'center',
                                  cursor: 'pointer',
                                }}
                                title={isKo ? '클릭 후 새 키를 누르세요' : 'Click then press a new key'}
                              >
                                {isCapturing ? '…' : key}
                              </button>
                            ) : (
                              <kbd style={kbdStyle}>
                                {key}
                              </kbd>
                            )}
                          </React.Fragment>
                        ))}
                      </div>
                      {/* Label + custom indicator */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 12, color: '#c9d1d9', fontWeight: 500 }}>{item.label}</span>
                        {item.customizable && customKeys[item.id] && (
                          <span style={{ fontSize: 9, color: '#3fb950', fontWeight: 700 }}>
                            {isKo ? '● 사용자 지정' : '● custom'}
                          </span>
                        )}
                      </div>
                    </React.Fragment>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{ marginTop: 14, paddingTop: 10, borderTop: '1px solid #21262d', fontSize: 10, color: '#484f58', textAlign: 'center' }}>
          {isKo ? 'Esc 또는 바깥 클릭으로 닫기 · ? 키로 언제든지 열기' : 'Esc or click outside to close · press ? anytime to open'}
        </div>
      </div>
    </div>
  );
}

// ── Style helpers ──────────────────────────────────────────────────────────────

function btnStyle(color: string): React.CSSProperties {
  return {
    padding: '4px 10px', borderRadius: 5,
    border: `1px solid ${color}30`,
    background: `${color}10`,
    color, fontSize: 11, fontWeight: 700, cursor: 'pointer',
  };
}

const kbdStyle: React.CSSProperties = {
  display: 'inline-block', padding: '2px 8px', borderRadius: 4,
  background: '#21262d', border: '1px solid #484f58',
  color: '#c9d1d9', fontSize: 11, fontWeight: 600,
  fontFamily: 'ui-monospace, monospace',
  lineHeight: '18px', minWidth: 24, textAlign: 'center',
};
