'use client';

/**
 * FeatureCatalogPanel — drop-in panel that renders the registry-driven
 * catalog ribbon for a route and lazy-loads/launches a feature on click.
 *
 * Self-contained: pass the current route + license + the catalog i18n
 * strings, and it handles loader registration, lazy import, status, and
 * a result strip. Mount it in any shell route (or behind ⌘K) without
 * touching the page monolith.
 */

import { useState } from 'react';
import { useCatalogRibbonGroups, CatalogRibbon } from './catalogRibbonAdapter';
import { useFeatureLauncher } from './useFeatureLauncher';
import { runWithExample } from './featureLauncher';
import type { FeatureRoute, FeatureLicense } from './registry';

export interface CatalogPanelDict {
  catalogTitle: string;
  catalogLoading: string;
  catalogReady: string;
  catalogRun: string;
  catalogFailed: string;
  catalogEmpty: string;
}

export interface FeatureCatalogPanelProps {
  /** Single route (back-compat). Ignored when `routes` is provided. */
  route?: FeatureRoute;
  /** Multiple domains the user can switch between via a selector. */
  routes?: FeatureRoute[];
  /** Localized labels for the route selector (keyed by route). */
  routeLabels?: Partial<Record<FeatureRoute, string>>;
  license?: FeatureLicense;
  dict: CatalogPanelDict;
  /** Called when the user runs a ready feature (with the launched descriptor). */
  onRun?: (featureId: string, entryFunctionName: string | null) => void;
}

export function FeatureCatalogPanel({ route, routes, routeLabels, license = 'free', dict, onRun }: FeatureCatalogPanelProps) {
  const domainRoutes: FeatureRoute[] = routes && routes.length > 0 ? routes : route ? [route] : ['modeling'];
  const [activeRoute, setActiveRoute] = useState<FeatureRoute>(domainRoutes[0]!);
  const groups = useCatalogRibbonGroups(activeRoute, license);
  const { activeId, status, launched, error, launch } = useFeatureLauncher();
  const [demoResult, setDemoResult] = useState<unknown>(null);
  const [demoError, setDemoError] = useState<string | null>(null);

  // Reset demo output whenever the active feature changes.
  const shownFor = launched?.id ?? null;
  const runDemo = () => {
    if (!launched) return;
    setDemoError(null);
    try {
      const out = runWithExample(launched);
      setDemoResult(out);
      onRun?.(launched.id, launched.entryFunctionName);
    } catch (e) {
      setDemoResult(null);
      setDemoError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="feature-catalog-panel" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>{dict.catalogTitle}</div>
        {domainRoutes.length > 1 && (
          <select
            value={activeRoute}
            onChange={(e) => { setDemoResult(null); setDemoError(null); setActiveRoute(e.target.value as FeatureRoute); }}
            style={{
              marginLeft: 'auto', height: 22, padding: '0 6px', borderRadius: 4, fontSize: 11,
              border: '1px solid var(--border, var(--nx-border))',
              background: 'var(--panel-2, var(--nx-bg))', color: 'var(--text-2, var(--nx-text))',
            }}
          >
            {domainRoutes.map(r => (
              <option key={r} value={r}>{routeLabels?.[r] ?? r}</option>
            ))}
          </select>
        )}
      </div>

      {groups.length === 0 ? (
        <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{dict.catalogEmpty}</div>
      ) : (
        <CatalogRibbon
          groups={groups}
          onPick={(id) => { setDemoResult(null); setDemoError(null); launch(id); }}
          activeFeatureId={activeId ?? undefined}
          showDescriptions
        />
      )}

      <CatalogStatusStrip
        status={status}
        activeId={activeId}
        launchedName={launched?.name ?? null}
        entryFn={launched?.entryFunctionName ?? null}
        error={error}
        dict={dict}
        onRun={launched && status === 'ready' && launched.hasExample ? runDemo : undefined}
      />

      {status === 'ready' && shownFor && (demoResult != null || demoError) && (
        <pre
          style={{
            margin: 0, padding: '6px 8px', borderRadius: 6, fontSize: 10,
            background: 'var(--panel-3, var(--panel-2))', color: 'var(--text-2)',
            maxHeight: 160, overflow: 'auto', whiteSpace: 'pre-wrap',
          }}
        >
          {demoError
            ? `${dict.catalogFailed} — ${demoError}`
            : JSON.stringify(demoResult, null, 2)}
        </pre>
      )}
    </div>
  );
}

interface StatusStripProps {
  status: ReturnType<typeof useFeatureLauncher>['status'];
  activeId: string | null;
  launchedName: string | null;
  entryFn: string | null;
  error: string | null;
  dict: CatalogPanelDict;
  onRun?: () => void;
}

function CatalogStatusStrip({ status, activeId, launchedName, entryFn, error, dict, onRun }: StatusStripProps) {
  if (status === 'idle' || !activeId) return null;

  return (
    <div
      className="catalog-status"
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        fontSize: 11, padding: '4px 8px', borderRadius: 6,
        background: 'var(--panel-2)', color: 'var(--text-2)',
      }}
    >
      {status === 'loading' && <span>{dict.catalogLoading}</span>}
      {status === 'failed' && (
        <span style={{ color: 'var(--error)' }}>
          {dict.catalogFailed}{error ? ` — ${error}` : ''}
        </span>
      )}
      {status === 'ready' && launchedName && (
        <>
          <span style={{ color: 'var(--ok)' }}>✓ {dict.catalogReady}</span>
          <strong>{launchedName}</strong>
          {entryFn && <code style={{ opacity: 0.7 }}>{entryFn}()</code>}
          {onRun && (
            <button
              type="button"
              onClick={onRun}
              style={{
                marginLeft: 'auto', padding: '2px 10px', borderRadius: 4,
                border: '1px solid var(--accent-line)', background: 'var(--accent-soft)',
                color: 'var(--accent)', cursor: 'pointer', fontSize: 11,
              }}
            >
              {dict.catalogRun}
            </button>
          )}
        </>
      )}
    </div>
  );
}
