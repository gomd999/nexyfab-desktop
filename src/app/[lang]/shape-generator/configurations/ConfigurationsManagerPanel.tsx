'use client';

/**
 * ConfigurationsManagerPanel.tsx — lightweight side panel that lists
 * named configurations and lets the user add / rename / switch /
 * delete them.
 *
 * MANAGER layer. Complements (does NOT replace) the heavy Excel-style
 * `ui/ConfigurationTableV2.tsx`. The split mirrors SolidWorks's UI:
 *
 *   - Manager tree (this file)  — always-on, fast switching, one row
 *     per config, ~200px wide.
 *   - Configuration Table grid  — opened on demand, dense parameter
 *     editor (one cell per `feature × param × config`).
 *
 * Backed by the same `ConfigStore` adapter the heavy table uses, so
 * mutations from either UI stay in sync (no second source of truth).
 *
 * i18n is local to this file — the brief asks us not to edit
 * `configurations/ui/dict.ts`. Six languages, KR canonical per the
 * user's i18n policy.
 *
 * Out of scope:
 *   - Per-cell editing (use the heavy table)
 *   - Parent inheritance editing (use the heavy table)
 *   - Expression vars / global vars (use the heavy table)
 *   - Family export / BOM CSV (already in the heavy table header)
 */

import React, { useCallback, useMemo } from 'react';
import { useConfigurations } from './useConfigurations';
import type { ConfigStore } from './ConfigStore';

// ─── i18n ────────────────────────────────────────────────────────────

type ManagerLang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

interface ManagerDict {
  title: string;
  master: string;
  add: string;
  addPrompt: string;
  defaultName: string;
  rename: string;
  renamePrompt: string;
  del: string;
  delConfirm: string;
  empty: string;
  active: string;
  openTable: string;
  close: string;
}

const DICT: Record<ManagerLang, ManagerDict> = {
  ko: {
    title: '구성 관리자',
    master: '마스터 (기본)',
    add: '+ 구성 추가',
    addPrompt: '새 구성 이름',
    defaultName: '구성',
    rename: '이름 변경',
    renamePrompt: '새 이름',
    del: '삭제',
    delConfirm: '이 구성을 삭제하시겠습니까?',
    empty: '구성이 없습니다 — "+ 구성 추가" 로 시작하세요',
    active: '활성',
    openTable: '구성 테이블 열기',
    close: '닫기',
  },
  en: {
    title: 'Configurations',
    master: 'Master (default)',
    add: '+ Add Configuration',
    addPrompt: 'New configuration name',
    defaultName: 'Config',
    rename: 'Rename',
    renamePrompt: 'New name',
    del: 'Delete',
    delConfirm: 'Delete this configuration?',
    empty: 'No configurations — click "+ Add Configuration" to start',
    active: 'Active',
    openTable: 'Open Configuration Table',
    close: 'Close',
  },
  ja: {
    title: '構成マネージャ',
    master: 'マスター（既定）',
    add: '+ 構成を追加',
    addPrompt: '新しい構成名',
    defaultName: '構成',
    rename: '名前変更',
    renamePrompt: '新しい名前',
    del: '削除',
    delConfirm: 'この構成を削除しますか？',
    empty: '構成がありません — "+ 構成を追加" から開始',
    active: '有効',
    openTable: '構成テーブルを開く',
    close: '閉じる',
  },
  zh: {
    title: '配置管理器',
    master: '主版本（默认）',
    add: '+ 添加配置',
    addPrompt: '新配置名称',
    defaultName: '配置',
    rename: '重命名',
    renamePrompt: '新名称',
    del: '删除',
    delConfirm: '删除此配置？',
    empty: '无配置 — 点击 "+ 添加配置" 开始',
    active: '激活',
    openTable: '打开配置表',
    close: '关闭',
  },
  es: {
    title: 'Configuraciones',
    master: 'Maestro (predeterminado)',
    add: '+ Añadir configuración',
    addPrompt: 'Nombre de la nueva configuración',
    defaultName: 'Config',
    rename: 'Renombrar',
    renamePrompt: 'Nuevo nombre',
    del: 'Eliminar',
    delConfirm: '¿Eliminar esta configuración?',
    empty: 'Sin configuraciones — clic en "+ Añadir configuración"',
    active: 'Activo',
    openTable: 'Abrir Tabla de Configuración',
    close: 'Cerrar',
  },
  ar: {
    title: 'مدير التكوينات',
    master: 'الرئيسي (افتراضي)',
    add: '+ إضافة تكوين',
    addPrompt: 'اسم التكوين الجديد',
    defaultName: 'تكوين',
    rename: 'إعادة تسمية',
    renamePrompt: 'الاسم الجديد',
    del: 'حذف',
    delConfirm: 'حذف هذا التكوين؟',
    empty: 'لا توجد تكوينات — انقر "+ إضافة تكوين" للبدء',
    active: 'نشط',
    openTable: 'فتح جدول التكوين',
    close: 'إغلاق',
  },
};

function pickDict(lang: string | undefined): ManagerDict {
  if (lang && lang in DICT) return DICT[lang as ManagerLang];
  return DICT.en;
}

// ─── Props ───────────────────────────────────────────────────────────

export interface ConfigurationsManagerPanelProps {
  /** Backing store — pass the same instance used by the heavy table so
   *  mutations stay in sync. `null` = render the empty state. */
  store: ConfigStore | null;
  /** UI language — falls back to `en` for unknown locales. */
  lang: string;
  /** Optional close handler — pass when mounted inside a dismissable
   *  shell. When omitted, the close (×) chrome is hidden. */
  onClose?: () => void;
  /** Optional handler called when the user clicks "Open Configuration
   *  Table" — host can use this to mount the heavy `ConfigurationTableV2`
   *  panel. When omitted the button is hidden. */
  onOpenTable?: () => void;
  /** Optional prompt impl — defaults to `window.prompt`. Tests inject. */
  promptFn?: (msg: string, def?: string) => string | null;
  /** Optional confirm impl — defaults to `window.confirm`. Tests inject. */
  confirmFn?: (msg: string) => boolean;
  /** Test scope hook. */
  'data-testid'?: string;
}

// ─── Component ───────────────────────────────────────────────────────

const C = {
  bg: 'var(--nx-panel)',
  bg2: 'var(--nx-panel-2)',
  border: 'var(--nx-border)',
  text: 'var(--nx-text)',
  muted: 'var(--nx-text-2)',
  accent: 'var(--nx-accent-2)',
  active: '#1f6feb22',
  danger: 'var(--nx-error)',
};

export default function ConfigurationsManagerPanel(
  props: ConfigurationsManagerPanelProps,
): React.JSX.Element {
  const { store, lang, onClose, onOpenTable, promptFn: propPrompt, confirmFn: propConfirm } = props;
  const t = pickDict(lang);

  // Memoise prompt/confirm against the prop refs (not the resolved
  // fallback) so the dependency tracking is stable. The fallback
  // closures are recreated only when the corresponding prop is
  // undefined and that prop reference changes.
  const stablePrompt = useMemo(
    () => propPrompt
      ?? ((msg: string, def?: string) => (typeof window !== 'undefined' ? window.prompt(msg, def) : null)),
    [propPrompt],
  );
  const stableConfirm = useMemo(
    () => propConfirm
      ?? ((msg: string) => (typeof window !== 'undefined' ? window.confirm(msg) : false)),
    [propConfirm],
  );

  const cfgs = useConfigurations(store);

  const handleAdd = useCallback(() => {
    if (!store) return;
    const defaultName = `${t.defaultName} ${cfgs.list.length + 1}`;
    const input = stablePrompt(t.addPrompt, defaultName);
    if (input === null) return;
    const trimmed = input.trim();
    cfgs.add(trimmed === '' ? defaultName : trimmed);
  }, [store, t.defaultName, t.addPrompt, cfgs, stablePrompt]);

  const handleRename = useCallback(
    (id: string, currentName: string) => {
      if (!store) return;
      const input = stablePrompt(t.renamePrompt, currentName);
      if (input === null) return;
      const trimmed = input.trim();
      if (trimmed === '') return;
      cfgs.rename(id, trimmed);
    },
    [store, t.renamePrompt, cfgs, stablePrompt],
  );

  const handleDelete = useCallback(
    (id: string) => {
      if (!store) return;
      if (!stableConfirm(t.delConfirm)) return;
      cfgs.remove(id);
    },
    [store, t.delConfirm, cfgs, stableConfirm],
  );

  const handleSwitch = useCallback(
    (id: string | null) => {
      if (!store) return;
      cfgs.switchTo(id);
    },
    [store, cfgs],
  );

  return (
    <div
      data-testid={props['data-testid'] ?? 'configurations-manager-panel'}
      style={panelStyle}
    >
      <div style={headerStyle}>
        <span style={titleStyle}>{t.title}</span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button
            data-testid="cfgmgr-add"
            type="button"
            onClick={handleAdd}
            style={addButtonStyle}
            disabled={!store}
          >
            {t.add}
          </button>
          {onClose && (
            <button
              data-testid="cfgmgr-close"
              type="button"
              onClick={onClose}
              aria-label={t.close}
              style={closeButtonStyle}
            >
              ×
            </button>
          )}
        </div>
      </div>

      <div style={listStyle} data-testid="cfgmgr-list">
        {/* Master row — always present, special-cased (no edit/delete). */}
        <MasterRow
          label={t.master}
          isActive={cfgs.activeId === null}
          onSwitch={() => handleSwitch(null)}
        />

        {cfgs.list.length === 0 ? (
          <div style={emptyStyle} data-testid="cfgmgr-empty">
            {t.empty}
          </div>
        ) : (
          cfgs.list.map(cfg => (
            <ConfigRow
              key={cfg.id}
              id={cfg.id}
              name={cfg.name}
              isActive={cfg.id === cfgs.activeId}
              activeLabel={t.active}
              renameLabel={t.rename}
              deleteLabel={t.del}
              onSwitch={() => handleSwitch(cfg.id)}
              onRename={() => handleRename(cfg.id, cfg.name)}
              onDelete={() => handleDelete(cfg.id)}
            />
          ))
        )}
      </div>

      {onOpenTable && (
        <div style={footerStyle}>
          <button
            data-testid="cfgmgr-open-table"
            type="button"
            onClick={onOpenTable}
            style={openTableButtonStyle}
          >
            {t.openTable}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Row sub-components ──────────────────────────────────────────────

function MasterRow(props: {
  label: string;
  isActive: boolean;
  onSwitch: () => void;
}): React.JSX.Element {
  return (
    <div
      data-testid="cfgmgr-row-master"
      style={rowStyle(props.isActive)}
      onClick={props.onSwitch}
      role="button"
      tabIndex={0}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          props.onSwitch();
        }
      }}
    >
      <span style={activeDotStyle(props.isActive)}>{props.isActive ? '●' : '○'}</span>
      <span style={{ flex: 1, color: 'var(--nx-text)', fontStyle: 'italic' }}>{props.label}</span>
    </div>
  );
}

interface ConfigRowProps {
  id: string;
  name: string;
  isActive: boolean;
  activeLabel: string;
  renameLabel: string;
  deleteLabel: string;
  onSwitch: () => void;
  onRename: () => void;
  onDelete: () => void;
}

function ConfigRow(props: ConfigRowProps): React.JSX.Element {
  // Stop edit/delete clicks from bubbling into the row's switch handler.
  const stop = (handler: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    handler();
  };
  return (
    <div
      data-testid={`cfgmgr-row-${props.id}`}
      style={rowStyle(props.isActive)}
      onClick={props.onSwitch}
      role="button"
      tabIndex={0}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          props.onSwitch();
        }
      }}
    >
      <span style={activeDotStyle(props.isActive)} title={props.isActive ? props.activeLabel : ''}>
        {props.isActive ? '●' : '○'}
      </span>
      <span style={nameStyle(props.isActive)}>{props.name}</span>
      <button
        data-testid={`cfgmgr-rename-${props.id}`}
        type="button"
        onClick={stop(props.onRename)}
        title={props.renameLabel}
        style={iconButtonStyle}
        aria-label={props.renameLabel}
      >
        ✎
      </button>
      <button
        data-testid={`cfgmgr-delete-${props.id}`}
        type="button"
        onClick={stop(props.onDelete)}
        title={props.deleteLabel}
        style={delIconButtonStyle}
        aria-label={props.deleteLabel}
      >
        ✕
      </button>
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────

const panelStyle: React.CSSProperties = {
  background: C.bg,
  border: `1px solid ${C.border}`,
  borderRadius: 6,
  display: 'flex',
  flexDirection: 'column',
  minWidth: 220,
  maxWidth: 320,
  fontSize: 12,
  color: C.text,
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '8px 10px',
  borderBottom: `1px solid ${C.border}`,
  background: C.bg2,
};

const titleStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: C.text,
};

const addButtonStyle: React.CSSProperties = {
  padding: '3px 8px',
  borderRadius: 4,
  border: `1px solid ${C.accent}`,
  background: `${C.accent}22`,
  color: C.accent,
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
};

const closeButtonStyle: React.CSSProperties = {
  width: 20,
  height: 20,
  padding: 0,
  borderRadius: 4,
  background: 'transparent',
  border: 'none',
  color: C.muted,
  fontSize: 14,
  cursor: 'pointer',
};

const listStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  maxHeight: 360,
  overflow: 'auto',
};

const emptyStyle: React.CSSProperties = {
  padding: 16,
  textAlign: 'center',
  color: C.muted,
  fontSize: 11,
};

function rowStyle(isActive: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '5px 10px',
    borderBottom: `1px solid ${C.border}`,
    background: isActive ? C.active : 'transparent',
    cursor: 'pointer',
    outline: 'none',
  };
}

function activeDotStyle(isActive: boolean): React.CSSProperties {
  return {
    width: 14,
    color: isActive ? C.accent : C.muted,
    fontSize: 11,
    textAlign: 'center',
  };
}

function nameStyle(isActive: boolean): React.CSSProperties {
  return {
    flex: 1,
    fontWeight: isActive ? 700 : 500,
    color: C.text,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  };
}

const iconButtonStyle: React.CSSProperties = {
  width: 20,
  height: 20,
  padding: 0,
  borderRadius: 3,
  background: 'transparent',
  border: 'none',
  color: C.muted,
  fontSize: 11,
  cursor: 'pointer',
};

const delIconButtonStyle: React.CSSProperties = {
  ...iconButtonStyle,
  color: C.danger,
};

const footerStyle: React.CSSProperties = {
  padding: 8,
  borderTop: `1px solid ${C.border}`,
  display: 'flex',
  justifyContent: 'center',
};

const openTableButtonStyle: React.CSSProperties = {
  padding: '4px 10px',
  borderRadius: 4,
  border: `1px solid ${C.border}`,
  background: 'transparent',
  color: C.muted,
  fontSize: 11,
  cursor: 'pointer',
};
