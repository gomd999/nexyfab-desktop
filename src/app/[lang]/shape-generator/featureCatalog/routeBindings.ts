/**
 * routeBindings.ts — Route-specific feature menu organization.
 *
 * Each top-level shell route (Modeling / Drawing / Render / etc) shows
 * a *different* ribbon + side-panel set. The registry already tags
 * each feature with its route(s); this module organizes them into
 * groups + tabs the way a CAD ribbon expects.
 *
 * Output structure:
 *
 *   route → tab → group → entries[]
 *
 * matches Office-style ribbon + SolidWorks CommandManager UX.
 */

import {
  FEATURE_REGISTRY,
  findByRoute,
  type FeatureRoute,
  type FeatureRegistryEntry,
  type FeatureCategory,
} from './registry';

export interface RibbonGroup {
  id: string;
  label: string;
  entries: FeatureRegistryEntry[];
}

export interface RibbonTab {
  id: string;
  label: string;
  groups: RibbonGroup[];
}

export interface RouteRibbon {
  route: FeatureRoute;
  tabs: RibbonTab[];
}

// ── Per-route tab layout ─────────────────────────────────────────

/** Categories grouped into the labeled tabs that appear in each
 *  route's ribbon. */
const ROUTE_TAB_LAYOUT: Record<FeatureRoute, Array<{ tabId: string; tabLabel: string; categories: FeatureCategory[] }>> = {
  hub: [
    { tabId: 'start', tabLabel: 'Start', categories: ['automation', 'interop'] },
  ],
  modeling: [
    { tabId: 'modeling', tabLabel: 'Modeling', categories: ['modeling', 'mesh', 'topology'] },
    { tabId: 'surface', tabLabel: 'Surface', categories: ['surface'] },
    { tabId: 'sim', tabLabel: 'Simulate', categories: ['simulation', 'cfd', 'dynamic', 'composite'] },
    { tabId: 'std', tabLabel: 'Standard Parts', categories: ['standard-parts', 'materials'] },
  ],
  sketch: [
    { tabId: 'sketch', tabLabel: 'Sketch', categories: ['sketch'] },
  ],
  assembly: [
    { tabId: 'mate', tabLabel: 'Mate', categories: ['assembly'] },
    { tabId: 'std', tabLabel: 'Standard Parts', categories: ['standard-parts'] },
    { tabId: 'pdm', tabLabel: 'PDM', categories: ['pdm'] },
  ],
  drawing: [
    { tabId: 'view', tabLabel: 'View', categories: ['drawing'] },
    { tabId: 'annotate', tabLabel: 'Annotate', categories: ['pmi', 'tolerance'] },
  ],
  render: [
    { tabId: 'visual', tabLabel: 'Visual', categories: ['rendering', 'animation'] },
  ],
  inspection: [
    { tabId: 'inspect', tabLabel: 'Inspect', categories: ['inspection', 'quality', 'tolerance', 'pmi'] },
  ],
  cam: [
    { tabId: 'mill', tabLabel: 'Mill', categories: ['cam'] },
    { tabId: 'edm', tabLabel: 'EDM', categories: ['edm'] },
  ],
  mold: [
    { tabId: 'mold', tabLabel: 'Mold', categories: ['mold', 'plastic'] },
  ],
  'sheet-metal': [
    { tabId: 'sm', tabLabel: 'Sheet Metal', categories: ['sheet-metal', 'surface'] },
  ],
  plant: [
    { tabId: 'plant', tabLabel: 'Plant', categories: ['plant', 'standard-parts'] },
    { tabId: 'flow', tabLabel: 'Flow', categories: ['cfd'] },
  ],
  wiring: [
    { tabId: 'wire', tabLabel: 'Wire', categories: ['wire'] },
  ],
  hvac: [
    { tabId: 'duct', tabLabel: 'Duct', categories: ['hvac'] },
  ],
  cost: [
    { tabId: 'estimate', tabLabel: 'Estimate', categories: ['cost', 'estimation', 'supplier'] },
  ],
  dfm: [
    { tabId: 'dfm', tabLabel: 'DFM', categories: ['dfm'] },
  ],
};

/** Build the ribbon definition for a single route. */
export function buildRouteRibbon(route: FeatureRoute): RouteRibbon {
  const tabs: RibbonTab[] = [];
  const layout = ROUTE_TAB_LAYOUT[route];
  if (!layout) return { route, tabs };

  const featuresOnRoute = findByRoute(route);

  for (const tabDef of layout) {
    const groups: RibbonGroup[] = [];
    for (const cat of tabDef.categories) {
      const entries = featuresOnRoute.filter(e => e.category === cat);
      if (entries.length === 0) continue;
      groups.push({
        id: `${tabDef.tabId}-${cat}`,
        label: categoryLabel(cat),
        entries,
      });
    }
    if (groups.length > 0) {
      tabs.push({ id: tabDef.tabId, label: tabDef.tabLabel, groups });
    }
  }
  return { route, tabs };
}

const CATEGORY_LABELS: Record<FeatureCategory, string> = {
  modeling: 'Modeling', sketch: 'Sketch', surface: 'Surfaces',
  mesh: 'Mesh', topology: 'Topology',
  assembly: 'Assembly', pdm: 'PDM',
  drawing: 'Drawing', pmi: 'PMI', inspection: 'Inspection',
  simulation: 'Simulation', cfd: 'CFD', composite: 'Composite', dynamic: 'Dynamic',
  cam: 'CAM', edm: 'EDM', plant: 'Plant 3D',
  'sheet-metal': 'Sheet Metal', mold: 'Mold', plastic: 'Plastic Flow',
  routing: 'Routing', wire: 'Wire Harness', hvac: 'HVAC',
  rendering: 'Rendering', animation: 'Animation', xr: 'XR',
  'standard-parts': 'Standard Parts', materials: 'Materials', tooling: 'Tooling',
  estimation: 'Estimation', cost: 'Cost', supplier: 'Suppliers', dfm: 'DFM',
  automation: 'Automation', scripting: 'Scripting', ai: 'AI',
  interop: 'Interop', export: 'Export', import: 'Import',
  quality: 'Quality', tolerance: 'Tolerance',
};

function categoryLabel(cat: FeatureCategory): string {
  return CATEGORY_LABELS[cat] ?? cat;
}

/** Build ribbons for every route at once — used by the shell on init. */
export function buildAllRibbons(): Record<FeatureRoute, RouteRibbon> {
  const routes: FeatureRoute[] = [
    'hub', 'modeling', 'sketch', 'assembly', 'drawing', 'render',
    'inspection', 'cam', 'mold', 'sheet-metal', 'plant',
    'wiring', 'hvac', 'cost', 'dfm',
  ];
  const out: Partial<Record<FeatureRoute, RouteRibbon>> = {};
  for (const r of routes) out[r] = buildRouteRibbon(r);
  return out as Record<FeatureRoute, RouteRibbon>;
}

// ── Cross-route discovery ────────────────────────────────────────

/** Features that appear in *multiple* routes (e.g. surface flatten
 *  shows up in both Modeling and Sheet Metal). Used to surface
 *  "also available in X" hints. */
export function multiRouteFeatures(): Array<{ entry: FeatureRegistryEntry; routes: FeatureRoute[] }> {
  return FEATURE_REGISTRY
    .filter(e => e.routes.length > 1)
    .map(e => ({ entry: e, routes: e.routes }));
}

/** Get the "primary" route for a feature — the first one in its
 *  routes array. Used when a feature should focus exactly one route. */
export function primaryRoute(entry: FeatureRegistryEntry): FeatureRoute {
  return entry.routes[0] ?? 'modeling';
}

// ── Suggestion engine ───────────────────────────────────────────

/** Given a currently-open route + the user's recent feature usage,
 *  suggest the next likely feature. Simple co-occurrence: features
 *  that share categories/tags with the recently used set rank higher. */
export interface SuggestionScore {
  entry: FeatureRegistryEntry;
  score: number;
}

export function suggestNext(
  recentFeatureIds: string[],
  currentRoute: FeatureRoute,
  maxResults: number = 5,
): SuggestionScore[] {
  const recent = recentFeatureIds.map(id => FEATURE_REGISTRY.find(e => e.id === id)).filter((e): e is FeatureRegistryEntry => e != null);
  if (recent.length === 0) {
    return findByRoute(currentRoute).slice(0, maxResults).map(e => ({ entry: e, score: 0 }));
  }
  const recentCategories = new Set(recent.map(r => r.category));
  const recentTags = new Set(recent.flatMap(r => r.tags));
  const recentIds = new Set(recent.map(r => r.id));

  const candidates = findByRoute(currentRoute);
  const scored: SuggestionScore[] = candidates
    .filter(c => !recentIds.has(c.id))
    .map(c => {
      let score = 0;
      if (recentCategories.has(c.category)) score += 3;
      for (const t of c.tags) if (recentTags.has(t)) score += 1;
      return { entry: c, score };
    })
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, maxResults);
}
