/**
 * layerAutoAssign.ts — Auto-assign drawing entities to standard
 * layers (per ISO 128 / ANSI Y14.2).
 *
 * Drawing entities have semantic meanings:
 *
 *   - **Object lines**: visible edges (continuous, thick).
 *   - **Hidden lines**: invisible edges (dashed, medium).
 *   - **Centerlines**: axes of symmetry (long-dash dotted, thin).
 *   - **Dimension lines**: dimensions + extension (continuous, thin).
 *   - **Section lines**: cutting plane indicator (long-dash double-dot).
 *   - **Phantom lines**: alt positions / adjacent parts (long-dash double-short-dash).
 *   - **Construction**: helper geometry.
 *   - **Text**: annotations.
 *
 * Standard layer names + line styles per CAD convention. Module
 * routes each entity to the right layer + applies the line style.
 */

export type EntityType =
  | 'visible-edge'
  | 'hidden-edge'
  | 'centerline'
  | 'dimension'
  | 'extension-line'
  | 'section-cut'
  | 'phantom'
  | 'construction'
  | 'text'
  | 'hatch'
  | 'leader'
  | 'symbol';

export type LineStyle = 'continuous' | 'dashed' | 'long-dash-dot' | 'long-dash-double-dot' | 'long-dash-short-dash' | 'dotted';
export type LineWeight = 'thin' | 'medium' | 'thick';

export interface LayerSpec {
  name: string;
  color: string;
  lineStyle: LineStyle;
  lineWeight: LineWeight;
  /** True if normally printed (false = hidden). */
  printable: boolean;
}

export const STANDARD_LAYERS: Record<string, LayerSpec> = {
  OBJECT: { name: 'OBJECT', color: '#FFFFFF', lineStyle: 'continuous', lineWeight: 'thick', printable: true },
  HIDDEN: { name: 'HIDDEN', color: '#888888', lineStyle: 'dashed', lineWeight: 'medium', printable: true },
  CENTER: { name: 'CENTER', color: '#FF0000', lineStyle: 'long-dash-dot', lineWeight: 'thin', printable: true },
  DIM: { name: 'DIM', color: '#00FFFF', lineStyle: 'continuous', lineWeight: 'thin', printable: true },
  SECTION: { name: 'SECTION', color: '#FFFF00', lineStyle: 'long-dash-double-dot', lineWeight: 'thick', printable: true },
  PHANTOM: { name: 'PHANTOM', color: '#A0A0FF', lineStyle: 'long-dash-short-dash', lineWeight: 'thin', printable: true },
  CONSTRUCTION: { name: 'CONSTRUCTION', color: '#404040', lineStyle: 'dotted', lineWeight: 'thin', printable: false },
  TEXT: { name: 'TEXT', color: '#FFFFFF', lineStyle: 'continuous', lineWeight: 'thin', printable: true },
  HATCH: { name: 'HATCH', color: '#888888', lineStyle: 'continuous', lineWeight: 'thin', printable: true },
};

// ── Mapping ───────────────────────────────────────────────────

const TYPE_TO_LAYER: Record<EntityType, string> = {
  'visible-edge': 'OBJECT',
  'hidden-edge': 'HIDDEN',
  centerline: 'CENTER',
  dimension: 'DIM',
  'extension-line': 'DIM',
  'section-cut': 'SECTION',
  phantom: 'PHANTOM',
  construction: 'CONSTRUCTION',
  text: 'TEXT',
  hatch: 'HATCH',
  leader: 'DIM',
  symbol: 'TEXT',
};

export interface DrawingEntity {
  id: string;
  type: EntityType;
}

export interface AssignedEntity {
  id: string;
  type: EntityType;
  layer: string;
  style: LineStyle;
  weight: LineWeight;
}

export interface LayerAssignment {
  entities: AssignedEntity[];
  layersUsed: LayerSpec[];
  /** Entities per layer. */
  layerCounts: Record<string, number>;
}

// ── Top-level entry ────────────────────────────────────────────

export function assignLayers(entities: DrawingEntity[]): LayerAssignment {
  const assigned: AssignedEntity[] = [];
  const usedLayers = new Set<string>();
  const counts: Record<string, number> = {};

  for (const ent of entities) {
    const layerName = TYPE_TO_LAYER[ent.type];
    const layer = STANDARD_LAYERS[layerName]!;
    usedLayers.add(layerName);
    counts[layerName] = (counts[layerName] ?? 0) + 1;
    assigned.push({
      id: ent.id,
      type: ent.type,
      layer: layer.name,
      style: layer.lineStyle,
      weight: layer.lineWeight,
    });
  }

  return {
    entities: assigned,
    layersUsed: [...usedLayers].map(name => STANDARD_LAYERS[name]!),
    layerCounts: counts,
  };
}

// ── Customization ─────────────────────────────────────────────

/** Override the mapping for a specific entity type. */
export function customizeMapping(type: EntityType, layerName: keyof typeof STANDARD_LAYERS): void {
  TYPE_TO_LAYER[type] = layerName;
}

/** Reset to defaults. */
export function resetMapping(): void {
  TYPE_TO_LAYER['visible-edge'] = 'OBJECT';
  TYPE_TO_LAYER['hidden-edge'] = 'HIDDEN';
  TYPE_TO_LAYER['centerline'] = 'CENTER';
  TYPE_TO_LAYER['dimension'] = 'DIM';
  TYPE_TO_LAYER['extension-line'] = 'DIM';
  TYPE_TO_LAYER['section-cut'] = 'SECTION';
  TYPE_TO_LAYER['phantom'] = 'PHANTOM';
  TYPE_TO_LAYER['construction'] = 'CONSTRUCTION';
  TYPE_TO_LAYER['text'] = 'TEXT';
  TYPE_TO_LAYER['hatch'] = 'HATCH';
  TYPE_TO_LAYER['leader'] = 'DIM';
  TYPE_TO_LAYER['symbol'] = 'TEXT';
}

// ── Summary ────────────────────────────────────────────────────

export interface AssignmentSummary {
  totalEntities: number;
  layerCount: number;
  mostUsedLayer: string;
  printableCount: number;
}

export function summarize(result: LayerAssignment): AssignmentSummary {
  let mostUsed = '';
  let mostCount = 0;
  for (const [layer, count] of Object.entries(result.layerCounts)) {
    if (count > mostCount) {
      mostCount = count;
      mostUsed = layer;
    }
  }
  const printable = result.layersUsed.filter(l => l.printable).reduce((s, l) =>
    s + (result.layerCounts[l.name] ?? 0), 0);
  return {
    totalEntities: result.entities.length,
    layerCount: result.layersUsed.length,
    mostUsedLayer: mostUsed,
    printableCount: printable,
  };
}
