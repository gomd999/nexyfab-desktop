import * as THREE from 'three';
import { downloadBlob } from '@/lib/platform';
import type { DXFEntity } from './dxfParser';
import type { SketchProfile } from '../sketch/types';

// ─── DXF ASCII Exporter ───────────────────────────────────────────────────

/**
 * Generate DXF ASCII text from an array of DXFEntity objects.
 */
// AutoCAD Color Index values we reuse for sheet-metal layers.
const LAYER_COLORS: Record<string, number> = {
  '0': 7,           // white/black default
  CUT: 7,           // outline — laser cut path
  BEND_UP: 1,       // red — mountain fold
  BEND_DOWN: 5,     // blue — valley fold
  ANNOTATE: 3,      // green — text / dimensions
};

function generateDXFText(entities: DXFEntity[]): string {
  const lines: string[] = [];

  // Collect every layer referenced by the entities so we can declare them
  // in the LAYER table. '0' is always declared.
  const layerSet = new Set<string>(['0']);
  for (const e of entities) {
    if (e.layer) layerSet.add(e.layer);
  }

  // ── HEADER section ──
  lines.push('  0', 'SECTION');
  lines.push('  2', 'HEADER');
  lines.push('  9', '$ACADVER');
  lines.push('  1', 'AC1015'); // AutoCAD 2000
  lines.push('  9', '$INSUNITS');
  lines.push(' 70', '4'); // millimeters
  lines.push('  0', 'ENDSEC');

  // ── TABLES section ──
  lines.push('  0', 'SECTION');
  lines.push('  2', 'TABLES');

  // LTYPE table
  lines.push('  0', 'TABLE');
  lines.push('  2', 'LTYPE');
  lines.push(' 70', '1');
  lines.push('  0', 'LTYPE');
  lines.push('  2', 'CONTINUOUS');
  lines.push(' 70', '0');
  lines.push('  3', 'Solid line');
  lines.push(' 72', '65');
  lines.push(' 73', '0');
  lines.push(' 40', '0.0');
  lines.push('  0', 'ENDTAB');

  // LAYER table — one record per referenced layer
  lines.push('  0', 'TABLE');
  lines.push('  2', 'LAYER');
  lines.push(' 70', String(layerSet.size));
  for (const name of layerSet) {
    const color = LAYER_COLORS[name] ?? 7;
    lines.push('  0', 'LAYER');
    lines.push('  2', name);
    lines.push(' 70', '0');
    lines.push(' 62', String(color));
    lines.push('  6', 'CONTINUOUS');
  }
  lines.push('  0', 'ENDTAB');

  lines.push('  0', 'ENDSEC');

  // ── ENTITIES section ──
  lines.push('  0', 'SECTION');
  lines.push('  2', 'ENTITIES');

  for (const entity of entities) {
    const layer = entity.layer ?? '0';
    switch (entity.type) {
      case 'LINE':
        if (entity.points.length >= 2) {
          lines.push('  0', 'LINE');
          lines.push('  8', layer);
          lines.push(' 10', entity.points[0][0].toFixed(6));
          lines.push(' 20', entity.points[0][1].toFixed(6));
          lines.push(' 30', '0.0');
          lines.push(' 11', entity.points[1][0].toFixed(6));
          lines.push(' 21', entity.points[1][1].toFixed(6));
          lines.push(' 31', '0.0');
        }
        break;

      case 'ARC':
        if (entity.center && entity.radius != null) {
          lines.push('  0', 'ARC');
          lines.push('  8', layer);
          lines.push(' 10', entity.center[0].toFixed(6));
          lines.push(' 20', entity.center[1].toFixed(6));
          lines.push(' 30', '0.0');
          lines.push(' 40', entity.radius.toFixed(6));
          lines.push(' 50', (entity.startAngle ?? 0).toFixed(6));
          lines.push(' 51', (entity.endAngle ?? 360).toFixed(6));
        }
        break;

      case 'CIRCLE':
        if (entity.center && entity.radius != null) {
          lines.push('  0', 'CIRCLE');
          lines.push('  8', layer);
          lines.push(' 10', entity.center[0].toFixed(6));
          lines.push(' 20', entity.center[1].toFixed(6));
          lines.push(' 30', '0.0');
          lines.push(' 40', entity.radius.toFixed(6));
        }
        break;

      case 'TEXT':
        if (entity.text && entity.points.length >= 1) {
          lines.push('  0', 'TEXT');
          lines.push('  8', layer);
          lines.push(' 10', entity.points[0][0].toFixed(6));
          lines.push(' 20', entity.points[0][1].toFixed(6));
          lines.push(' 30', '0.0');
          lines.push(' 40', (entity.textHeight ?? 2.5).toFixed(6));
          // Strip DXF-unfriendly chars: AutoCAD reads 1-byte strings, so we
          // keep ASCII and replace any control or non-printable characters.
          const safe = entity.text.replace(/[\x00-\x1f\x7f]/g, ' ');
          lines.push('  1', safe);
        }
        break;

      case 'POLYLINE':
      case 'LWPOLYLINE':
      case 'SPLINE':
        // Write as LWPOLYLINE
        if (entity.points.length > 0) {
          lines.push('  0', 'LWPOLYLINE');
          lines.push('  8', layer);
          lines.push(' 90', String(entity.points.length));
          // Check if closed: last point ~= first point
          const first = entity.points[0];
          const last = entity.points[entity.points.length - 1];
          const isClosed = entity.points.length > 2 &&
            Math.abs(first[0] - last[0]) < 1e-6 &&
            Math.abs(first[1] - last[1]) < 1e-6;
          lines.push(' 70', isClosed ? '1' : '0');
          const count = isClosed ? entity.points.length - 1 : entity.points.length;
          for (let i = 0; i < count; i++) {
            lines.push(' 10', entity.points[i][0].toFixed(6));
            lines.push(' 20', entity.points[i][1].toFixed(6));
          }
        }
        break;
    }
  }

  lines.push('  0', 'ENDSEC');

  // ── EOF ──
  lines.push('  0', 'EOF');

  return lines.join('\n');
}

/**
 * Export DXF entities to a downloadable file.
 */
export async function exportDXF(entities: DXFEntity[], filename = 'shape-design'): Promise<void> {
  const text = generateDXFText(entities);
  const blob = new Blob([text], { type: 'application/dxf' });
  await downloadBlob(`${filename}.dxf`, blob);
}

// ─── Sheet-metal flat pattern DXF ───────────────────────────────────────────

import type { FlatPatternResult } from '../features/sheetMetal';

/**
 * Turn a flat pattern result into a layered DXF suitable for a laser cutter +
 * press brake. Layers emitted:
 *   - CUT       : outer blank rectangle (laser path)
 *   - BEND_UP   : mountain-fold bend lines
 *   - BEND_DOWN : valley-fold bend lines
 *   - ANNOTATE  : angle/radius/K-factor text labels + bend table block
 *
 * Coordinates are mm, origin at the bottom-left of the blank. The blank's
 * width runs along +X and its length along +Y, matching how an operator lays
 * the sheet on the press-brake table.
 */
export function flatPatternToDXFEntities(pattern: FlatPatternResult): DXFEntity[] {
  const { width, length, bendTable } = pattern;
  const entities: DXFEntity[] = [];

  // ── CUT layer: outer rectangle as a closed LWPOLYLINE ──
  entities.push({
    type: 'LWPOLYLINE',
    layer: 'CUT',
    points: [
      [0, 0],
      [width, 0],
      [width, length],
      [0, length],
      [0, 0],
    ],
  });

  // ── Bend lines + annotations ──
  // Text height scales with the blank so small parts still get readable labels.
  const textH = Math.max(2.5, Math.min(6, length / 60));
  const textPadding = Math.max(1, width * 0.02);

  for (const b of bendTable) {
    const y = b.position;
    const layer = b.direction === 'up' ? 'BEND_UP' : 'BEND_DOWN';

    // Bend line across the full width at the bend position
    entities.push({
      type: 'LINE',
      layer,
      points: [[0, y], [width, y]],
    });

    // Label on the ANNOTATE layer: angle / radius / direction
    const label = `${b.direction === 'up' ? '↑' : '↓'} ${b.angle.toFixed(0)}° R${b.radius.toFixed(1)} k=${b.kFactor.toFixed(2)}`;
    entities.push({
      type: 'TEXT',
      layer: 'ANNOTATE',
      points: [[textPadding, y + textPadding * 0.5]],
      text: label,
      textHeight: textH,
    });
  }

  // ── Bend table block (bottom-right, outside the cut rectangle) ──
  // Operators like having the full table on the same sheet as the part so
  // they don't need to cross-reference a separate job sheet.
  const tableX = width + textPadding * 4;
  const tableLineHeight = textH * 1.6;
  let tableY = length - textH;

  entities.push({
    type: 'TEXT',
    layer: 'ANNOTATE',
    points: [[tableX, tableY]],
    text: `BEND TABLE  ${pattern.material}  t=${pattern.thickness}mm  ${width.toFixed(1)}x${length.toFixed(1)}`,
    textHeight: textH,
  });
  tableY -= tableLineHeight;
  entities.push({
    type: 'TEXT',
    layer: 'ANNOTATE',
    points: [[tableX, tableY]],
    text: '#   POS     ANG    R      DIR    BA      BD',
    textHeight: textH * 0.85,
  });
  tableY -= tableLineHeight;

  for (const b of bendTable) {
    const row = `${(b.index + 1).toString().padStart(2, ' ')}  ${b.position.toFixed(1).padStart(6, ' ')}  ${b.angle.toFixed(0).padStart(3, ' ')}°  ${b.radius.toFixed(1).padStart(5, ' ')}  ${b.direction.padEnd(4, ' ')}  ${b.bendAllowance.toFixed(2).padStart(5, ' ')}  ${b.bendDeduction.toFixed(2).padStart(5, ' ')}`;
    entities.push({
      type: 'TEXT',
      layer: 'ANNOTATE',
      points: [[tableX, tableY]],
      text: row,
      textHeight: textH * 0.85,
    });
    tableY -= tableLineHeight;
  }

  return entities;
}

/**
 * Convenience: serialize a flat pattern straight to a downloadable DXF.
 */
export async function exportSheetMetalDXF(
  pattern: FlatPatternResult,
  filename = 'flat-pattern',
): Promise<void> {
  const entities = flatPatternToDXFEntities(pattern);
  const text = generateDXFText(entities);
  const blob = new Blob([text], { type: 'application/dxf' });
  await downloadBlob(`${filename}.dxf`, blob);
}

/**
 * Project 3D geometry edges onto a 2D plane.
 * Uses EdgesGeometry to extract sharp edges, then projects along the specified axis.
 */
export function geometryToDXFEntities(
  geometry: THREE.BufferGeometry,
  projectionAxis: 'xy' | 'xz' | 'yz' = 'xy',
): DXFEntity[] {
  const edgesGeo = new THREE.EdgesGeometry(geometry, 15); // 15 degree threshold
  const pos = edgesGeo.attributes.position;
  const entities: DXFEntity[] = [];

  for (let i = 0; i < pos.count; i += 2) {
    const x1 = pos.getX(i), y1 = pos.getY(i), z1 = pos.getZ(i);
    const x2 = pos.getX(i + 1), y2 = pos.getY(i + 1), z2 = pos.getZ(i + 1);

    let p1: [number, number], p2: [number, number];
    switch (projectionAxis) {
      case 'xy': p1 = [x1, y1]; p2 = [x2, y2]; break;
      case 'xz': p1 = [x1, z1]; p2 = [x2, z2]; break;
      case 'yz': p1 = [y1, z1]; p2 = [y2, z2]; break;
    }

    // Skip zero-length edges after projection
    const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
    if (Math.abs(dx) < 1e-8 && Math.abs(dy) < 1e-8) continue;

    entities.push({ type: 'LINE', points: [p1, p2] });
  }

  edgesGeo.dispose();
  return entities;
}

/**
 * Convert a sketch profile (from the sketch system) directly to DXF entities.
 */
export function sketchProfileToDXF(profile: SketchProfile): DXFEntity[] {
  const entities: DXFEntity[] = [];

  for (const seg of profile.segments) {
    switch (seg.type) {
      case 'line': {
        if (seg.points.length >= 2) {
          entities.push({
            type: 'LINE',
            points: [[seg.points[0].x, seg.points[0].y], [seg.points[1].x, seg.points[1].y]],
          });
        }
        break;
      }
      case 'arc': {
        // Arc defined by 3 points: start, through, end
        if (seg.points.length >= 3) {
          const [start, through, end] = seg.points;
          const circle = circleThrough3(start.x, start.y, through.x, through.y, end.x, end.y);
          if (circle) {
            const { cx, cy, r } = circle;
            const sa = Math.atan2(start.y - cy, start.x - cx) * 180 / Math.PI;
            const ea = Math.atan2(end.y - cy, end.x - cx) * 180 / Math.PI;
            // Generate polyline approximation for points
            const pts: [number, number][] = [];
            const saRad = sa * Math.PI / 180;
            let eaRad = ea * Math.PI / 180;
            if (eaRad <= saRad) eaRad += 2 * Math.PI;
            for (let i = 0; i <= 32; i++) {
              const t = i / 32;
              const a = saRad + (eaRad - saRad) * t;
              pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
            }
            entities.push({
              type: 'ARC',
              points: pts,
              center: [cx, cy],
              radius: r,
              startAngle: ((sa % 360) + 360) % 360,
              endAngle: ((ea % 360) + 360) % 360,
            });
          }
        }
        break;
      }
      case 'circle': {
        // Circle defined by [center, edgePoint]
        if (seg.points.length >= 2) {
          const cx = seg.points[0].x, cy = seg.points[0].y;
          const ex = seg.points[1].x, ey = seg.points[1].y;
          const r = Math.sqrt((ex - cx) ** 2 + (ey - cy) ** 2);
          const pts: [number, number][] = [];
          for (let i = 0; i <= 64; i++) {
            const a = (i / 64) * 2 * Math.PI;
            pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
          }
          entities.push({ type: 'CIRCLE', points: pts, center: [cx, cy], radius: r });
        }
        break;
      }
      case 'rect': {
        // Rectangle: two corner points
        if (seg.points.length >= 2) {
          const [c1, c2] = seg.points;
          entities.push({
            type: 'LWPOLYLINE',
            points: [
              [c1.x, c1.y], [c2.x, c1.y], [c2.x, c2.y], [c1.x, c2.y], [c1.x, c1.y],
            ],
          });
        }
        break;
      }
      case 'polygon': {
        // Polygon: [center, edgePoint] => regular polygon
        if (seg.points.length >= 2) {
          const cx = seg.points[0].x, cy = seg.points[0].y;
          const ex = seg.points[1].x, ey = seg.points[1].y;
          const r = Math.sqrt((ex - cx) ** 2 + (ey - cy) ** 2);
          const sides = 6; // Default hexagon
          const pts: [number, number][] = [];
          for (let i = 0; i <= sides; i++) {
            const a = (i / sides) * 2 * Math.PI - Math.PI / 2;
            pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
          }
          entities.push({ type: 'LWPOLYLINE', points: pts });
        }
        break;
      }
    }
  }

  return entities;
}

// ─── Helper ───────────────────────────────────────────────────────────────

function circleThrough3(
  ax: number, ay: number, bx: number, by: number, cx: number, cy: number,
): { cx: number; cy: number; r: number } | null {
  const D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(D) < 1e-10) return null;
  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / D;
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / D;
  return { cx: ux, cy: uy, r: Math.sqrt((ax - ux) ** 2 + (ay - uy) ** 2) };
}
