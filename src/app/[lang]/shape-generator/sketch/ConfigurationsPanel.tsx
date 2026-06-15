'use client';

/**
 * ConfigurationsPanel — Phase 2.x of NexyFab Pro own-CAD (ADR-013).
 *
 * Standalone UI for design configurations / variants over a FeatureTree
 * (lib/cad/configurations.ts): pick the active config, see each variant's
 * suppressed-node + override counts, and apply the resolved tree back to the
 * host. Presentational — the host owns the FeatureTree + the ConfigurationSet
 * and re-renders SCAD from the resolved tree.
 *
 * Test surface (data-testids):
 *   configurations-panel
 *   configurations-error                 (validation banner, only when invalid)
 *   configurations-empty
 *   configurations-row-{name}
 *   configurations-active-{name}         (radio)
 *   configurations-apply
 */

import React, { useCallback } from 'react';
import type { FeatureTree } from '@/lib/cad/featureTree';
import {
  validateConfigurationSet,
  resolveActive,
  type Configuration,
  type ConfigurationSet,
} from '@/lib/cad/configurations';

export type ConfigurationsLang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

interface Dict {
  title: string;
  empty: string;
  active: string;
  suppressed: string;
  overrides: string;
  apply: string;
}

const dict: Record<ConfigurationsLang, Dict> = {
  ko: { title: '구성(변형)', empty: '구성이 없습니다', active: '활성', suppressed: '억제', overrides: '재정의', apply: '활성 적용' },
  en: { title: 'Configurations', empty: 'No configurations', active: 'Active', suppressed: 'suppressed', overrides: 'overrides', apply: 'Apply active' },
  ja: { title: 'コンフィギュレーション', empty: 'コンフィグなし', active: 'アクティブ', suppressed: '抑制', overrides: '上書き', apply: 'アクティブを適用' },
  zh: { title: '配置(变体)', empty: '暂无配置', active: '激活', suppressed: '抑制', overrides: '覆盖', apply: '应用激活配置' },
  es: { title: 'Configuraciones', empty: 'Sin configuraciones', active: 'Activa', suppressed: 'suprimidos', overrides: 'anulaciones', apply: 'Aplicar activa' },
  ar: { title: 'التكوينات', empty: 'لا توجد تكوينات', active: 'نشط', suppressed: 'مكبوت', overrides: 'تجاوزات', apply: 'تطبيق النشط' },
};

export interface ConfigurationsPanelProps {
  lang?: ConfigurationsLang;
  tree: FeatureTree;
  set: ConfigurationSet;
  /** Switch the active configuration. */
  onActivate: (name: string) => void;
  /** Apply the resolved (active-config) tree back to the host. */
  onApply?: (resolved: FeatureTree) => void;
}

function overrideCount(c: Configuration): number {
  if (!c.paramOverrides) return 0;
  let n = 0;
  for (const node of Object.values(c.paramOverrides)) n += Object.keys(node).length;
  return n;
}

export default function ConfigurationsPanel({
  lang = 'en',
  tree,
  set,
  onActivate,
  onApply,
}: ConfigurationsPanelProps): React.ReactElement {
  const t = dict[lang];
  const validation = validateConfigurationSet(tree, set);

  const handleApply = useCallback(() => {
    if (!onApply || !validation.ok) return;
    onApply(resolveActive(tree, set));
  }, [onApply, validation.ok, tree, set]);

  return (
    <div
      data-testid="configurations-panel"
      dir={lang === 'ar' ? 'rtl' : 'ltr'}
      style={{
        display: 'flex', flexDirection: 'column', gap: 8, padding: 10,
        background: 'var(--nx-panel)', border: '1px solid var(--nx-border)', borderRadius: 6,
        fontFamily: 'system-ui, sans-serif', fontSize: 12, color: 'var(--nx-text)',
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{t.title}</h3>
        {onApply && (
          <button
            type="button"
            data-testid="configurations-apply"
            onClick={handleApply}
            disabled={!validation.ok}
            style={{
              padding: '4px 10px', fontSize: 11,
              background: validation.ok ? '#0e7490' : 'var(--nx-panel-2)',
              color: validation.ok ? '#fff' : 'var(--nx-text-2)',
              border: '1px solid ' + (validation.ok ? '#0e7490' : 'var(--nx-border)'),
              borderRadius: 4, cursor: validation.ok ? 'pointer' : 'not-allowed',
            }}
          >
            {t.apply}
          </button>
        )}
      </header>

      {!validation.ok && (
        <div
          data-testid="configurations-error"
          style={{ fontSize: 11, color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 4, padding: '4px 6px' }}
        >
          <ul style={{ margin: 0, paddingInlineStart: 16 }}>
            {validation.errors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </div>
      )}

      {set.configs.length === 0 ? (
        <div data-testid="configurations-empty" style={{ fontSize: 11, color: 'var(--nx-text-2)', textAlign: 'center', padding: '8px 0' }}>
          {t.empty}
        </div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {set.configs.map((c) => {
            const isActive = c.name === set.active;
            return (
              <li
                key={c.name}
                data-testid={`configurations-row-${c.name}`}
                data-active={isActive ? 'true' : 'false'}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: 6,
                  border: '1px solid var(--nx-border)', borderRadius: 4,
                  background: isActive ? '#ecfeff' : 'var(--nx-panel-2)',
                }}
              >
                <input
                  type="radio"
                  data-testid={`configurations-active-${c.name}`}
                  name="nexyfab-configuration"
                  checked={isActive}
                  onChange={() => onActivate(c.name)}
                  aria-label={`${t.active} ${c.name}`}
                />
                <span style={{ fontWeight: 600, flex: '1 1 auto' }}>{c.name}</span>
                <span style={{ color: 'var(--nx-text-2)', fontSize: 11 }}>
                  {(c.suppress?.length ?? 0)} {t.suppressed} · {overrideCount(c)} {t.overrides}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
