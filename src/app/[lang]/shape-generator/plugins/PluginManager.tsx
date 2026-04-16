'use client';

import React, { useState, useCallback, useSyncExternalStore } from 'react';
import { pluginRegistry } from './PluginRegistry';
import type { RegisteredPlugin } from './PluginAPI';

/* ─── Styles ──────────────────────────────────────────────────────────────── */

const C = {
  bg: '#0d1117',
  panel: '#161b22',
  card: '#21262d',
  border: '#30363d',
  accent: '#388bfd',
  text: '#c9d1d9',
  textDim: '#8b949e',
  success: '#3fb950',
  danger: '#f85149',
  warn: '#d29922',
};

/* ─── Component ───────────────────────────────────────────────────────────── */

interface PluginManagerProps {
  visible: boolean;
  onClose: () => void;
  isKo: boolean;
}

export default function PluginManager({ visible, onClose, isKo }: PluginManagerProps) {
  const plugins = useSyncExternalStore(
    (cb) => pluginRegistry.subscribe(cb),
    () => pluginRegistry.getSnapshot(),
    () => pluginRegistry.getSnapshot(),
  );

  const [expandedId, setExpandedId] = useState<string | null>(null);

  const handleToggle = useCallback((id: string, enabled: boolean) => {
    pluginRegistry.setEnabled(id, enabled);
  }, []);

  const handleUnregister = useCallback((id: string) => {
    pluginRegistry.unregisterPlugin(id);
  }, []);

  if (!visible) return null;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1100,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: C.panel, borderRadius: 14, padding: 0, width: '90%', maxWidth: 520,
          maxHeight: '80vh', overflow: 'hidden', display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.6)', border: `1px solid ${C.border}`,
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px', borderBottom: `1px solid ${C.border}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 20 }}>🧩</span>
            <div>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: C.text }}>
                {isKo ? '플러그인 관리자' : 'Plugin Manager'}
              </h3>
              <div style={{ fontSize: 10, color: C.textDim, marginTop: 2 }}>
                {plugins.length} {isKo ? '개 등록됨' : 'registered'}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              border: 'none', background: C.card, cursor: 'pointer', fontSize: 12, color: C.textDim,
              width: 28, height: 28, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.12s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = C.border; e.currentTarget.style.color = C.text; }}
            onMouseLeave={e => { e.currentTarget.style.background = C.card; e.currentTarget.style.color = C.textDim; }}
          >
            ✕
          </button>
        </div>

        {/* Plugin list */}
        <div style={{ flex: 1, overflow: 'auto', padding: '12px 16px' }}>
          {plugins.length === 0 ? (
            <div style={{
              textAlign: 'center', padding: '40px 20px', color: C.textDim, fontSize: 13,
            }}>
              <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.5 }}>🧩</div>
              <div style={{ fontWeight: 600 }}>
                {isKo ? '등록된 플러그인이 없습니다' : 'No plugins registered'}
              </div>
              <div style={{ fontSize: 11, marginTop: 6, color: '#484f58' }}>
                {isKo ? '예제 플러그인이 자동으로 로드됩니다' : 'Example plugins are auto-loaded'}
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {plugins.map((plugin: RegisteredPlugin) => (
                <PluginCard
                  key={plugin.manifest.id}
                  plugin={plugin}
                  expanded={expandedId === plugin.manifest.id}
                  onToggleExpand={() => setExpandedId(prev =>
                    prev === plugin.manifest.id ? null : plugin.manifest.id,
                  )}
                  onToggleEnabled={handleToggle}
                  onUnregister={handleUnregister}
                  isKo={isKo}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 20px', borderTop: `1px solid ${C.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          fontSize: 10, color: C.textDim,
        }}>
          <span>{isKo ? '플러그인 API v1.0' : 'Plugin API v1.0'}</span>
          <span>{isKo ? '내장 예제 플러그인 포함' : 'Includes built-in example plugins'}</span>
        </div>
      </div>
    </div>
  );
}

/* ─── Plugin Card ─────────────────────────────────────────────────────────── */

function PluginCard({ plugin, expanded, onToggleExpand, onToggleEnabled, onUnregister, isKo }: {
  plugin: RegisteredPlugin;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggleEnabled: (id: string, enabled: boolean) => void;
  onUnregister: (id: string) => void;
  isKo: boolean;
}) {
  const m = plugin.manifest;

  return (
    <div style={{
      background: C.card, borderRadius: 10, border: `1px solid ${C.border}`,
      overflow: 'hidden', transition: 'border-color 0.15s',
    }}>
      {/* Card header */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
          cursor: 'pointer',
        }}
        onClick={onToggleExpand}
      >
        {/* Status indicator */}
        <div style={{
          width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
          background: plugin.enabled ? C.success : C.textDim,
          boxShadow: plugin.enabled ? `0 0 6px ${C.success}40` : 'none',
        }} />

        {/* Info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{m.name}</span>
            <span style={{
              fontSize: 9, fontWeight: 600, color: C.textDim,
              background: C.bg, padding: '1px 6px', borderRadius: 4,
            }}>
              v{m.version}
            </span>
          </div>
          <div style={{ fontSize: 10, color: C.textDim, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {m.description}
          </div>
        </div>

        {/* Toggle switch */}
        <button
          onClick={e => { e.stopPropagation(); onToggleEnabled(m.id, !plugin.enabled); }}
          title={plugin.enabled ? (isKo ? '비활성화' : 'Disable') : (isKo ? '활성화' : 'Enable')}
          style={{
            width: 36, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer',
            background: plugin.enabled ? C.accent : '#484f58',
            position: 'relative', transition: 'background 0.2s', flexShrink: 0,
          }}
        >
          <div style={{
            width: 14, height: 14, borderRadius: '50%', background: '#fff',
            position: 'absolute', top: 3,
            left: plugin.enabled ? 19 : 3,
            transition: 'left 0.2s',
          }} />
        </button>

        {/* Expand chevron */}
        <span style={{ fontSize: 10, color: C.textDim, transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
          ▼
        </span>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div style={{ padding: '0 14px 12px', borderTop: `1px solid ${C.border}` }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 10, fontSize: 11 }}>
            <div style={{ color: C.textDim }}>{isKo ? '작성자' : 'Author'}</div>
            <div style={{ color: C.text, fontWeight: 600 }}>{m.author}</div>
            <div style={{ color: C.textDim }}>{isKo ? '버전' : 'Version'}</div>
            <div style={{ color: C.text, fontWeight: 600 }}>{m.version}</div>
            <div style={{ color: C.textDim }}>{isKo ? '등록 항목' : 'Registrations'}</div>
            <div style={{ color: C.text, fontWeight: 600 }}>
              {plugin.toolbarButtons.length > 0 && `${plugin.toolbarButtons.length} ${isKo ? '버튼' : 'btn'} `}
              {plugin.shapes.length > 0 && `${plugin.shapes.length} ${isKo ? '형상' : 'shape'} `}
              {plugin.panels.length > 0 && `${plugin.panels.length} ${isKo ? '패널' : 'panel'}`}
              {plugin.toolbarButtons.length === 0 && plugin.shapes.length === 0 && plugin.panels.length === 0 && '-'}
            </div>
          </div>

          <button
            onClick={() => onUnregister(m.id)}
            style={{
              marginTop: 10, width: '100%', padding: '6px 0', borderRadius: 6,
              border: `1px solid ${C.danger}40`, background: `${C.danger}10`,
              color: C.danger, fontSize: 11, fontWeight: 700, cursor: 'pointer',
              transition: 'all 0.12s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = `${C.danger}20`; }}
            onMouseLeave={e => { e.currentTarget.style.background = `${C.danger}10`; }}
          >
            {isKo ? '플러그인 제거' : 'Unregister Plugin'}
          </button>
        </div>
      )}
    </div>
  );
}
