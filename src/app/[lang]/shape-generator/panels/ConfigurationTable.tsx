'use client';

/**
 * Configuration Table panel (F5).
 *
 * Excel-style view of all configurations: rows = configs, columns = params +
 * feature suppress flags. Click a cell to edit. Replaces the per-config
 * picker in DesignVariantsPanel for users who manage many size variants
 * (S/M/L/XL of the same base shape).
 *
 * Reuses NfabConfigurationV1 (already in the .nfab file format) so configs
 * round-trip through save/load without schema changes.
 */

import React, { useMemo, useState } from 'react';
import type { NfabConfigurationV1 } from '../io/nfabFormat';
import type { FeatureInstance } from '../features/types';

interface ConfigurationTableProps {
  configurations: NfabConfigurationV1[];
  features: FeatureInstance[];
  activeConfigurationId: string | null;
  onSelect: (id: string | null) => void;
  onUpdate: (config: NfabConfigurationV1) => void;
  onAdd: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  lang: 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';
  onClose?: () => void;
}

const dict = {
  ko: { title: '구성 테이블', config: '구성', params: '파라미터', features: '피처', add: '+ 행 추가', delete: '삭제', activate: '적용', empty: '구성 없음 — "+행 추가"로 시작', noParams: '파라미터 없음' },
  en: { title: 'Configuration Table', config: 'Configuration', params: 'Parameters', features: 'Features', add: '+ Add row', delete: 'Delete', activate: 'Activate', empty: 'No configurations — click "+ Add row" to start', noParams: 'No parameters' },
  ja: { title: '構成テーブル', config: '構成', params: 'パラメータ', features: 'フィーチャー', add: '+ 行を追加', delete: '削除', activate: '適用', empty: '構成なし — "+行を追加"で開始', noParams: 'パラメータなし' },
  zh: { title: '配置表', config: '配置', params: '参数', features: '特征', add: '+ 添加行', delete: '删除', activate: '应用', empty: '暂无配置 — 点击"+ 添加行"开始', noParams: '无参数' },
  es: { title: 'Tabla de Configuración', config: 'Configuración', params: 'Parámetros', features: 'Características', add: '+ Añadir fila', delete: 'Eliminar', activate: 'Activar', empty: 'Sin configuraciones — clic "+ Añadir fila" para empezar', noParams: 'Sin parámetros' },
  ar: { title: 'جدول التكوين', config: 'تكوين', params: 'المعلمات', features: 'الميزات', add: '+ إضافة صف', delete: 'حذف', activate: 'تنشيط', empty: 'لا توجد تكوينات — انقر "+ إضافة صف" للبدء', noParams: 'لا توجد معلمات' },
};

const C = {
  bg: '#161b22',
  border: '#30363d',
  text: '#c9d1d9',
  muted: '#8b949e',
  accent: '#58a6ff',
  active: '#1f6feb22',
  cellBg: '#0d1117',
  danger: '#f85149',
};

export default function ConfigurationTable({
  configurations,
  features,
  activeConfigurationId,
  onSelect,
  onUpdate,
  onAdd,
  onDelete,
  onRename,
  lang,
  onClose,
}: ConfigurationTableProps) {
  const t = dict[lang] ?? dict.en;
  const [editingCell, setEditingCell] = useState<{ configId: string; key: string } | null>(null);

  // Collect all unique param keys across configurations + base features.
  const paramKeys = useMemo(() => {
    const set = new Set<string>();
    for (const c of configurations) {
      for (const k of Object.keys(c.params)) set.add(k);
    }
    return [...set].sort();
  }, [configurations]);

  // Feature names — use type + short id.
  const featureCols = features.filter(f => f.type !== 'sketch');

  if (configurations.length === 0) {
    return (
      <div style={{
        position: 'fixed', right: 16, top: 64, width: 520, maxHeight: '70vh',
        background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8,
        boxShadow: '0 8px 32px rgba(0,0,0,0.6)', zIndex: 200, overflow: 'hidden',
      }}>
        <Header title={t.title} onAdd={onAdd} addLabel={t.add} onClose={onClose} />
        <div style={{ padding: 24, color: C.muted, fontSize: 12, textAlign: 'center' }}>
          {t.empty}
        </div>
      </div>
    );
  }

  return (
    <div style={{
      position: 'fixed', right: 16, top: 64, width: 'min(900px, calc(100vw - 32px))',
      maxHeight: '70vh', background: C.bg, border: `1px solid ${C.border}`,
      borderRadius: 8, boxShadow: '0 8px 32px rgba(0,0,0,0.6)', zIndex: 200,
      display: 'flex', flexDirection: 'column',
    }}>
      <Header title={t.title} onAdd={onAdd} addLabel={t.add} onClose={onClose} />
      <div style={{ overflow: 'auto', flex: 1 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr style={{ background: '#21262d', position: 'sticky', top: 0 }}>
              <th style={cellHeaderStyle}>{t.config}</th>
              {paramKeys.map(k => (
                <th key={k} style={cellHeaderStyle} title={k}>
                  <span style={{ color: C.accent }}>{k}</span>
                </th>
              ))}
              {featureCols.map(f => (
                <th key={f.id} style={cellHeaderStyle} title={f.id}>
                  <span style={{ color: C.muted }}>{f.type}</span>
                </th>
              ))}
              <th style={cellHeaderStyle}></th>
            </tr>
          </thead>
          <tbody>
            {configurations.map(cfg => {
              const isActive = cfg.id === activeConfigurationId;
              return (
                <tr
                  key={cfg.id}
                  style={{
                    background: isActive ? C.active : 'transparent',
                    borderBottom: `1px solid ${C.border}`,
                  }}
                >
                  <td style={cellStyle}>
                    <input
                      type="text"
                      value={cfg.name}
                      onChange={e => onRename(cfg.id, e.target.value)}
                      style={{
                        background: 'transparent', color: C.text, border: 'none',
                        fontSize: 11, fontWeight: isActive ? 700 : 500, width: 100, outline: 'none',
                      }}
                    />
                    <button
                      onClick={() => onSelect(isActive ? null : cfg.id)}
                      style={{
                        marginLeft: 4, padding: '1px 6px', borderRadius: 3,
                        border: `1px solid ${isActive ? C.accent : C.border}`,
                        background: isActive ? C.accent : 'transparent',
                        color: isActive ? '#fff' : C.muted,
                        fontSize: 9, cursor: 'pointer',
                      }}
                      title={t.activate}
                    >
                      {isActive ? '●' : '○'}
                    </button>
                  </td>
                  {paramKeys.map(k => {
                    const v = cfg.params[k];
                    const editing = editingCell?.configId === cfg.id && editingCell?.key === k;
                    return (
                      <td key={k} style={cellStyle}>
                        {editing ? (
                          <input
                            type="number"
                            defaultValue={typeof v === 'number' ? v : ''}
                            autoFocus
                            onBlur={(e) => {
                              const num = parseFloat(e.target.value);
                              if (Number.isFinite(num)) {
                                onUpdate({ ...cfg, params: { ...cfg.params, [k]: num } });
                              }
                              setEditingCell(null);
                            }}
                            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                            style={{
                              width: 60, padding: '2px 4px', background: C.cellBg,
                              color: C.text, border: `1px solid ${C.accent}`, borderRadius: 3, fontSize: 11,
                            }}
                          />
                        ) : (
                          <span
                            onClick={() => setEditingCell({ configId: cfg.id, key: k })}
                            style={{ cursor: 'pointer', color: typeof v === 'number' ? C.text : C.muted }}
                          >
                            {typeof v === 'number' ? v.toFixed(2) : '—'}
                          </span>
                        )}
                      </td>
                    );
                  })}
                  {featureCols.map(f => {
                    const enabled = cfg.featureEnabled?.[f.id] !== false;
                    return (
                      <td key={f.id} style={cellStyle}>
                        <button
                          onClick={() => {
                            const nextEnabled = { ...(cfg.featureEnabled ?? {}), [f.id]: !enabled };
                            onUpdate({ ...cfg, featureEnabled: nextEnabled });
                          }}
                          title={enabled ? 'Suppress' : 'Unsuppress'}
                          style={{
                            width: 18, height: 18, padding: 0, borderRadius: 3,
                            border: `1px solid ${enabled ? C.accent : C.border}`,
                            background: enabled ? C.accent + '33' : 'transparent',
                            color: enabled ? C.accent : C.muted,
                            fontSize: 11, cursor: 'pointer',
                          }}
                        >
                          {enabled ? '✓' : '·'}
                        </button>
                      </td>
                    );
                  })}
                  <td style={cellStyle}>
                    <button
                      onClick={() => { if (confirm(`Delete "${cfg.name}"?`)) onDelete(cfg.id); }}
                      title={t.delete}
                      style={{
                        background: 'transparent', border: 'none', color: C.danger,
                        fontSize: 12, cursor: 'pointer', padding: '2px 4px',
                      }}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Header({ title, onAdd, addLabel, onClose }: { title: string; onAdd: () => void; addLabel: string; onClose?: () => void }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '10px 14px', borderBottom: `1px solid ${C.border}`,
    }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>📊 {title}</span>
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          onClick={onAdd}
          style={{
            padding: '4px 10px', borderRadius: 4, border: `1px solid ${C.accent}`,
            background: C.accent + '22', color: C.accent, fontSize: 11, fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {addLabel}
        </button>
        {onClose && (
          <button
            onClick={onClose}
            style={{
              width: 22, height: 22, padding: 0, borderRadius: 4,
              background: 'transparent', border: 'none', color: C.muted,
              fontSize: 16, cursor: 'pointer',
            }}
          >×</button>
        )}
      </div>
    </div>
  );
}

const cellHeaderStyle: React.CSSProperties = {
  padding: '6px 8px', textAlign: 'left', fontSize: 10, fontWeight: 600,
  color: C.muted, borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap',
};

const cellStyle: React.CSSProperties = {
  padding: '4px 8px', whiteSpace: 'nowrap',
};
