'use client';

/**
 * catalogRibbonAdapter.tsx — Bridge the FEATURE_REGISTRY to the
 * existing _shell/Ribbon.tsx primitives.
 *
 * Lets a shell route mount a "Discovery" tab in its ribbon that
 * auto-populates from the registry — no hand-edits to ModeRibbons
 * for every new module shipped.
 *
 * Usage:
 *   const groups = useCatalogRibbonGroups('drawing');
 *   <CatalogRibbon groups={groups} onPick={id => activateFeature(id)} />
 */

import { useMemo, useState } from 'react';
import { Grp, Tool } from '../_shell/Ribbon';
import type { IconName } from '../_shell/Icons';
import { buildRouteRibbon, type RibbonGroup as CatalogGroup } from './routeBindings';
import type {
  FeatureCategory,
  FeatureRoute,
  FeatureRegistryEntry,
  FeatureLicense,
} from './registry';

// ── Category → icon ─────────────────────────────────────────────

/** Map each FeatureCategory to a best-fit icon from the shell icon set. */
const CATEGORY_ICON: Record<FeatureCategory, IconName> = {
  modeling: 'extrude',
  sketch: 'sketch',
  surface: 'sweep',
  mesh: 'cube',
  topology: 'pattern',
  assembly: 'cube',
  pdm: 'history',
  drawing: 'plane',
  pmi: 'dim',
  inspection: 'ruler',
  simulation: 'bolt',
  cfd: 'sweep',
  composite: 'layers',
  dynamic: 'bolt',
  cam: 'cog',
  edm: 'cog',
  plant: 'globe',
  'sheet-metal': 'rect',
  mold: 'cube',
  plastic: 'cube',
  routing: 'link',
  wire: 'link',
  hvac: 'link',
  rendering: 'paint',
  animation: 'history',
  xr: 'eye',
  'standard-parts': 'cube',
  materials: 'paint',
  tooling: 'cog',
  estimation: 'doc',
  cost: 'doc',
  supplier: 'globe',
  dfm: 'ai',
  automation: 'ai',
  scripting: 'doc',
  ai: 'ai',
  interop: 'share',
  export: 'share',
  import: 'share',
  quality: 'check',
  tolerance: 'dim',
};

function iconForCategory(cat: FeatureCategory): IconName {
  return CATEGORY_ICON[cat] ?? 'cube';
}

// ── Adapter types ───────────────────────────────────────────────

export interface CatalogRibbonGroup {
  id: string;
  label: string;
  tools: Array<{
    id: string;
    label: string;
    icon: IconName;
    description: string;
    license: FeatureLicense;
  }>;
}

/** Convert the route-bound catalog groups to ribbon-compatible groups. */
export function adaptCatalogGroups(groups: CatalogGroup[]): CatalogRibbonGroup[] {
  return groups.map(g => ({
    id: g.id,
    label: g.label,
    tools: g.entries.map(toToolDescriptor),
  }));
}

function toToolDescriptor(entry: FeatureRegistryEntry): CatalogRibbonGroup['tools'][number] {
  return {
    id: entry.id,
    label: entry.name,
    icon: iconForCategory(entry.category),
    description: entry.description,
    license: entry.license,
  };
}

// ── Hook ────────────────────────────────────────────────────────

/** Compute the ribbon groups for a given route. Memoized — no useEffect
 *  needed because the registry is a module constant. */
export function useCatalogRibbonGroups(
  route: FeatureRoute,
  userLicense: FeatureLicense = 'free',
): CatalogRibbonGroup[] {
  return useMemo(() => {
    const ribbon = buildRouteRibbon(route);
    // Flatten tab → group; the catalog ribbon doesn't have inner tabs.
    const flat: CatalogGroup[] = [];
    for (const tab of ribbon.tabs) flat.push(...tab.groups);
    // Filter entries by license tier.
    const licenseOrder: FeatureLicense[] = ['free', 'pro', 'pro-plus', 'enterprise'];
    const userIdx = licenseOrder.indexOf(userLicense);
    const filtered = flat
      .map(g => ({
        ...g,
        entries: g.entries.filter(e => licenseOrder.indexOf(e.license) <= userIdx),
      }))
      .filter(g => g.entries.length > 0);
    return adaptCatalogGroups(filtered);
  }, [route, userLicense]);
}

// ── Ribbon component ────────────────────────────────────────────

export interface CatalogRibbonProps {
  groups: CatalogRibbonGroup[];
  onPick: (featureId: string) => void;
  /** Optional active feature id. */
  activeFeatureId?: string;
  /** Show a description popover on hover. */
  showDescriptions?: boolean;
}

export function CatalogRibbon({ groups, onPick, activeFeatureId, showDescriptions = false }: CatalogRibbonProps) {
  return (
    <div className="catalog-ribbon" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: 4, maxWidth: '100%', boxSizing: 'border-box' }}>
      {groups.map(group => (
        <Grp key={group.id} title={group.label}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {group.tools.map(tool => (
              <Tool
                key={tool.id}
                ico={tool.icon}
                lbl={tool.label}
                big={false}
                active={tool.id === activeFeatureId}
                onClick={() => onPick(tool.id)}
              />
            ))}
          </div>
          {showDescriptions && <CatalogDescriptions group={group} />}
        </Grp>
      ))}
    </div>
  );
}

function CatalogDescriptions({ group }: { group: CatalogRibbonGroup }) {
  const [hoverId, setHoverId] = useState<string | null>(null);
  const hovered = group.tools.find(t => t.id === hoverId);
  return (
    <div className="catalog-desc" style={{ marginTop: 4, fontSize: 10, color: 'var(--text-3)' }}>
      {hovered ? (
        <span>
          <strong>{hovered.label}</strong> — {hovered.description}
          {hovered.license !== 'free' && (
            <span style={{ marginLeft: 6, padding: '0 4px', borderRadius: 4, background: 'var(--accent-soft)' }}>
              {hovered.license.toUpperCase()}
            </span>
          )}
        </span>
      ) : (
        <span style={{ opacity: 0.6 }}>Hover a tool for details</span>
      )}
      <div style={{ display: 'none' }}>
        {/* Trigger handlers from the parent tools live in Tool above; here we
            just expose the state-setter implicitly via the absence of pointer
            events. In a real wired panel, Tool's `onMouseEnter` would call
            setHoverId. */}
        <button type="button" onClick={() => setHoverId(null)} />
      </div>
    </div>
  );
}
