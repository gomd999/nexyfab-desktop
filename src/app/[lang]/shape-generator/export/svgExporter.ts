/**
 * svgExporter.ts — Generic SVG writer for 2D drawings.
 *
 * `drawing/lineArt.ts` already emits a minimal SVG for line art; this
 * module is the general SVG document builder used by:
 *
 *   - Drawing exports (DXF-style sheet → SVG for web preview).
 *   - Parametric configurators (every variant ships a thumbnail).
 *   - Vinyl-cutter / laser job sheets.
 *
 * Capabilities:
 *
 *   - Primitives: line, polyline, polygon, rect, circle, arc, path, text.
 *   - Styles: stroke, fill, dash, opacity, transforms.
 *   - Groups + layers for organization.
 *   - Document-level: viewBox, units, title, custom CSS.
 *   - Path optimization: tiny segments below epsilon are collapsed.
 */

export type Point2D = { x: number; y: number };

export interface Style {
  stroke?: string;
  fill?: string;
  strokeWidth?: number;
  strokeDasharray?: number[];
  opacity?: number;
}

export type Primitive =
  | { kind: 'line'; start: Point2D; end: Point2D; style?: Style }
  | { kind: 'polyline'; points: Point2D[]; style?: Style }
  | { kind: 'polygon'; points: Point2D[]; style?: Style }
  | { kind: 'rect'; x: number; y: number; width: number; height: number; style?: Style; rx?: number; ry?: number }
  | { kind: 'circle'; cx: number; cy: number; r: number; style?: Style }
  | { kind: 'arc'; cx: number; cy: number; r: number; startAngleRad: number; endAngleRad: number; style?: Style; clockwise?: boolean }
  | { kind: 'path'; d: string; style?: Style }
  | { kind: 'text'; x: number; y: number; text: string; fontSize: number; style?: Style; anchor?: 'start' | 'middle' | 'end' };

export interface SvgLayer {
  id: string;
  label: string;
  primitives: Primitive[];
  visible: boolean;
}

export interface SvgDocument {
  /** Viewport size in user units. */
  viewBox: { x: number; y: number; width: number; height: number };
  /** Final SVG width/height attrs (px). Defaults to viewBox dims. */
  widthPx?: number;
  heightPx?: number;
  title?: string;
  layers: SvgLayer[];
  /** CSS rules to embed in `<style>`. */
  css?: string;
  /** Coordinate system Y-axis: 'down' (default screen) or 'up' (CAD). */
  yAxisDirection?: 'down' | 'up';
}

// ── Top-level entry ─────────────────────────────────────────────

export interface ExportOptions {
  /** Collapse path segments shorter than this (svg units). */
  minSegmentLength: number;
  /** Decimal precision for numeric output. */
  precision: number;
  /** Pretty-print with line breaks + indentation. */
  prettyPrint: boolean;
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  minSegmentLength: 0,
  precision: 3,
  prettyPrint: true,
};

export function writeSvg(doc: SvgDocument, options: Partial<ExportOptions> = {}): string {
  const opts = { ...DEFAULT_EXPORT_OPTIONS, ...options };
  const widthPx = doc.widthPx ?? doc.viewBox.width;
  const heightPx = doc.heightPx ?? doc.viewBox.height;
  const lines: string[] = [];
  const yFlip = doc.yAxisDirection === 'up';

  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${widthPx}" height="${heightPx}" viewBox="${fmt(doc.viewBox.x, opts.precision)} ${fmt(doc.viewBox.y, opts.precision)} ${fmt(doc.viewBox.width, opts.precision)} ${fmt(doc.viewBox.height, opts.precision)}">`);
  if (doc.title) lines.push(`  <title>${escapeXml(doc.title)}</title>`);
  if (doc.css) {
    lines.push(`  <style>`);
    lines.push(doc.css);
    lines.push(`  </style>`);
  }
  if (yFlip) {
    lines.push(`  <g transform="scale(1, -1) translate(0, ${fmt(-doc.viewBox.height, opts.precision)})">`);
  }
  for (const layer of doc.layers) {
    if (!layer.visible) continue;
    lines.push(`  <g id="${escapeAttr(layer.id)}" data-layer="${escapeAttr(layer.label)}">`);
    for (const prim of layer.primitives) {
      const line = renderPrimitive(prim, opts);
      if (line) lines.push(`    ${line}`);
    }
    lines.push(`  </g>`);
  }
  if (yFlip) lines.push('  </g>');
  lines.push('</svg>');
  return opts.prettyPrint ? lines.join('\n') : lines.join('');
}

// ── Primitive rendering ────────────────────────────────────────

function renderPrimitive(prim: Primitive, opts: ExportOptions): string {
  const style = primToStyle(prim.style ?? {});
  switch (prim.kind) {
    case 'line':
      if (opts.minSegmentLength > 0) {
        const dx = prim.end.x - prim.start.x;
        const dy = prim.end.y - prim.start.y;
        if (Math.hypot(dx, dy) < opts.minSegmentLength) return '';
      }
      return `<line x1="${fmt(prim.start.x, opts.precision)}" y1="${fmt(prim.start.y, opts.precision)}" x2="${fmt(prim.end.x, opts.precision)}" y2="${fmt(prim.end.y, opts.precision)}"${style}/>`;
    case 'polyline':
      return `<polyline points="${pointsToString(prim.points, opts)}"${style}/>`;
    case 'polygon':
      return `<polygon points="${pointsToString(prim.points, opts)}"${style}/>`;
    case 'rect': {
      const rxAttr = prim.rx ? ` rx="${fmt(prim.rx, opts.precision)}"` : '';
      const ryAttr = prim.ry ? ` ry="${fmt(prim.ry, opts.precision)}"` : '';
      return `<rect x="${fmt(prim.x, opts.precision)}" y="${fmt(prim.y, opts.precision)}" width="${fmt(prim.width, opts.precision)}" height="${fmt(prim.height, opts.precision)}"${rxAttr}${ryAttr}${style}/>`;
    }
    case 'circle':
      return `<circle cx="${fmt(prim.cx, opts.precision)}" cy="${fmt(prim.cy, opts.precision)}" r="${fmt(prim.r, opts.precision)}"${style}/>`;
    case 'arc':
      return arcToPath(prim, opts);
    case 'path':
      return `<path d="${prim.d}"${style}/>`;
    case 'text': {
      const anchor = prim.anchor ? ` text-anchor="${prim.anchor}"` : '';
      return `<text x="${fmt(prim.x, opts.precision)}" y="${fmt(prim.y, opts.precision)}" font-size="${fmt(prim.fontSize, opts.precision)}"${anchor}${style}>${escapeXml(prim.text)}</text>`;
    }
  }
}

function arcToPath(arc: Extract<Primitive, { kind: 'arc' }>, opts: ExportOptions): string {
  const x1 = arc.cx + arc.r * Math.cos(arc.startAngleRad);
  const y1 = arc.cy + arc.r * Math.sin(arc.startAngleRad);
  const x2 = arc.cx + arc.r * Math.cos(arc.endAngleRad);
  const y2 = arc.cy + arc.r * Math.sin(arc.endAngleRad);
  const deltaRad = arc.endAngleRad - arc.startAngleRad;
  const largeArc = Math.abs(deltaRad) > Math.PI ? 1 : 0;
  const sweep = (arc.clockwise ?? false) ? 0 : 1;
  const style = primToStyle(arc.style ?? {});
  const d = `M ${fmt(x1, opts.precision)},${fmt(y1, opts.precision)} A ${fmt(arc.r, opts.precision)},${fmt(arc.r, opts.precision)} 0 ${largeArc} ${sweep} ${fmt(x2, opts.precision)},${fmt(y2, opts.precision)}`;
  return `<path d="${d}"${style}/>`;
}

function pointsToString(points: Point2D[], opts: ExportOptions): string {
  return points.map(p => `${fmt(p.x, opts.precision)},${fmt(p.y, opts.precision)}`).join(' ');
}

function primToStyle(style: Style): string {
  const attrs: string[] = [];
  if (style.stroke !== undefined) attrs.push(`stroke="${style.stroke}"`);
  if (style.fill !== undefined) attrs.push(`fill="${style.fill}"`);
  if (style.strokeWidth !== undefined) attrs.push(`stroke-width="${style.strokeWidth}"`);
  if (style.strokeDasharray && style.strokeDasharray.length > 0) attrs.push(`stroke-dasharray="${style.strokeDasharray.join(',')}"`);
  if (style.opacity !== undefined) attrs.push(`opacity="${style.opacity}"`);
  return attrs.length === 0 ? '' : ' ' + attrs.join(' ');
}

function fmt(v: number, precision: number): string {
  return v.toFixed(precision).replace(/\.?0+$/, '') || '0';
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(s: string): string {
  return escapeXml(s);
}

// ── Convenience document builders ──────────────────────────────

export function emptyDocument(width: number, height: number): SvgDocument {
  return {
    viewBox: { x: 0, y: 0, width, height },
    layers: [],
  };
}

export function addLayer(doc: SvgDocument, id: string, label?: string): SvgLayer {
  const layer: SvgLayer = { id, label: label ?? id, primitives: [], visible: true };
  doc.layers.push(layer);
  return layer;
}

export function fitDocumentToContent(doc: SvgDocument, marginUnits: number = 0): void {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const layer of doc.layers) {
    for (const prim of layer.primitives) {
      const box = primitiveBoundingBox(prim);
      if (box.minX < minX) minX = box.minX;
      if (box.minY < minY) minY = box.minY;
      if (box.maxX > maxX) maxX = box.maxX;
      if (box.maxY > maxY) maxY = box.maxY;
    }
  }
  if (!isFinite(minX)) return;
  doc.viewBox = {
    x: minX - marginUnits,
    y: minY - marginUnits,
    width: (maxX - minX) + 2 * marginUnits,
    height: (maxY - minY) + 2 * marginUnits,
  };
}

function primitiveBoundingBox(prim: Primitive): { minX: number; minY: number; maxX: number; maxY: number } {
  switch (prim.kind) {
    case 'line':
      return { minX: Math.min(prim.start.x, prim.end.x), minY: Math.min(prim.start.y, prim.end.y), maxX: Math.max(prim.start.x, prim.end.x), maxY: Math.max(prim.start.y, prim.end.y) };
    case 'polyline':
    case 'polygon': {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of prim.points) {
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
      }
      return { minX, minY, maxX, maxY };
    }
    case 'rect':
      return { minX: prim.x, minY: prim.y, maxX: prim.x + prim.width, maxY: prim.y + prim.height };
    case 'circle':
      return { minX: prim.cx - prim.r, minY: prim.cy - prim.r, maxX: prim.cx + prim.r, maxY: prim.cy + prim.r };
    case 'arc':
      return { minX: prim.cx - prim.r, minY: prim.cy - prim.r, maxX: prim.cx + prim.r, maxY: prim.cy + prim.r };
    case 'text':
      return { minX: prim.x, minY: prim.y - prim.fontSize, maxX: prim.x + prim.text.length * prim.fontSize * 0.6, maxY: prim.y };
    case 'path':
      return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }
}

// ── Stats ───────────────────────────────────────────────────────

export interface SvgStats {
  layerCount: number;
  primitiveCount: number;
  primitivesByKind: Record<string, number>;
}

export function summarize(doc: SvgDocument): SvgStats {
  const byKind: Record<string, number> = {};
  let total = 0;
  for (const layer of doc.layers) {
    for (const prim of layer.primitives) {
      byKind[prim.kind] = (byKind[prim.kind] ?? 0) + 1;
      total++;
    }
  }
  return {
    layerCount: doc.layers.length,
    primitiveCount: total,
    primitivesByKind: byKind,
  };
}
