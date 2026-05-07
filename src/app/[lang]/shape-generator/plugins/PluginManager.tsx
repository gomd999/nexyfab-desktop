'use client';

import React, { useState, useCallback, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import { pluginRegistry } from './PluginRegistry';
import type { RegisteredPlugin } from './PluginAPI';

/* ─── i18n dict ──────────────────────────────────────────────────────────── */

const dict = {
  ko: { title: '플러그인 관리자', registered: '개 등록됨', empty: '등록된 플러그인이 없습니다',
        autoload: '예제 플러그인이 자동으로 로드됩니다', apiVer: '플러그인 API v1.0',
        builtin: '내장 예제 플러그인 포함', disable: '비활성화', enable: '활성화',
        author: '작성자', version: '버전', registrations: '등록 항목',
        btn: '버튼', shape: '형상', panel: '패널', unregister: '플러그인 제거' },
  en: { title: 'Plugin Manager', registered: 'registered', empty: 'No plugins registered',
        autoload: 'Example plugins are auto-loaded', apiVer: 'Plugin API v1.0',
        builtin: 'Includes built-in example plugins', disable: 'Disable', enable: 'Enable',
        author: 'Author', version: 'Version', registrations: 'Registrations',
        btn: 'btn', shape: 'shape', panel: 'panel', unregister: 'Unregister Plugin' },
  ja: { title: 'プラグインマネージャー', registered: '件登録済み', empty: '登録されたプラグインはありません',
        autoload: 'サンプルプラグインは自動ロードされます', apiVer: 'プラグイン API v1.0',
        builtin: '組み込みサンプルプラグインを含む', disable: '無効化', enable: '有効化',
        author: '作成者', version: 'バージョン', registrations: '登録項目',
        btn: 'ボタン', shape: '形状', panel: 'パネル', unregister: 'プラグイン解除' },
  zh: { title: '插件管理器', registered: '已注册', empty: '没有已注册的插件',
        autoload: '示例插件自动加载', apiVer: '插件 API v1.0',
        builtin: '包含内置示例插件', disable: '禁用', enable: '启用',
        author: '作者', version: '版本', registrations: '注册项',
        btn: '按钮', shape: '形状', panel: '面板', unregister: '卸载插件' },
  es: { title: 'Gestor de Plugins', registered: 'registrados', empty: 'Sin plugins registrados',
        autoload: 'Los plugins de ejemplo se cargan automáticamente', apiVer: 'API de Plugin v1.0',
        builtin: 'Incluye plugins de ejemplo integrados', disable: 'Desactivar', enable: 'Activar',
        author: 'Autor', version: 'Versión', registrations: 'Registros',
        btn: 'btn', shape: 'forma', panel: 'panel', unregister: 'Eliminar Plugin' },
  ar: { title: 'مدير الإضافات', registered: 'مسجلة', empty: 'لا توجد إضافات مسجلة',
        autoload: 'يتم تحميل إضافات الأمثلة تلقائيًا', apiVer: 'واجهة الإضافات v1.0',
        builtin: 'يتضمن إضافات أمثلة مدمجة', disable: 'تعطيل', enable: 'تفعيل',
        author: 'المؤلف', version: 'الإصدار', registrations: 'التسجيلات',
        btn: 'زر', shape: 'شكل', panel: 'لوحة', unregister: 'إلغاء التسجيل' },
};
const langMap: Record<string, keyof typeof dict> = {
  kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
};

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
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? (isKo ? 'ko' : 'en');
  const t = dict[langMap[seg] ?? (isKo ? 'ko' : 'en')];

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
                {t.title}
              </h3>
              <div style={{ fontSize: 10, color: C.textDim, marginTop: 2 }}>
                {plugins.length} {t.registered}
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
                {t.empty}
              </div>
              <div style={{ fontSize: 11, marginTop: 6, color: '#484f58' }}>
                {t.autoload}
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
                  tt={t}
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
          <span>{t.apiVer}</span>
          <span>{t.builtin}</span>
        </div>
      </div>
    </div>
  );
}

/* ─── Plugin Card ─────────────────────────────────────────────────────────── */

function PluginCard({ plugin, expanded, onToggleExpand, onToggleEnabled, onUnregister, tt }: {
  plugin: RegisteredPlugin;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggleEnabled: (id: string, enabled: boolean) => void;
  onUnregister: (id: string) => void;
  tt: typeof dict[keyof typeof dict];
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
          title={plugin.enabled ? tt.disable : tt.enable}
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
            <div style={{ color: C.textDim }}>{tt.author}</div>
            <div style={{ color: C.text, fontWeight: 600 }}>{m.author}</div>
            <div style={{ color: C.textDim }}>{tt.version}</div>
            <div style={{ color: C.text, fontWeight: 600 }}>{m.version}</div>
            <div style={{ color: C.textDim }}>{tt.registrations}</div>
            <div style={{ color: C.text, fontWeight: 600 }}>
              {plugin.toolbarButtons.length > 0 && `${plugin.toolbarButtons.length} ${tt.btn} `}
              {plugin.shapes.length > 0 && `${plugin.shapes.length} ${tt.shape} `}
              {plugin.panels.length > 0 && `${plugin.panels.length} ${tt.panel}`}
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
            {tt.unregister}
          </button>
        </div>
      )}
    </div>
  );
}
