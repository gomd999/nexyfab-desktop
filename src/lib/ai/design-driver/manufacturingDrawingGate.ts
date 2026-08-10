/**
 * Manufacturing drawing work-packet builder.
 *
 * The sheet geometry is exclusively the OCCT HLR output generated from the
 * round-trip-verified STEP body. Planned dimensions are included only after
 * NamedTopology measurement succeeded. The generated sheets are deliberately
 * marked ENGINEERING REVIEW REQUIRED: this gate proves packet completeness,
 * not a human approval signature or a released revision.
 */

import { createHash } from 'node:crypto';
import { formatTolerance } from '@/lib/drawing/dimension';
import { paperDimensions, type PaperSize } from '@/lib/drawing/sheet';
import type { DrawingArtifact, PlannedMeasurement } from './drawingGate';
import type { ExactDrawingArtifact, ExactDrawingViewArtifact } from './exactDrawingGate';
import type { DesignPlan, GateResult, PlanPart } from './types';

const REQUIRED_VIEWS = ['front', 'top', 'right'] as const;
const MAIN_DIMENSION_ROWS = 18;
const CONTINUATION_DIMENSION_ROWS = 48;
const SVG_PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz0-9eE+.,\s-]+$/;

export interface ManufacturingDrawingDimensionRow {
  id: string;
  bodyId: string;
  view: 'front' | 'top' | 'right';
  kind: PlannedMeasurement['spec']['kind'];
  value: number;
  unit: 'mm' | 'deg';
  display: string;
  tolerance: string;
  refs: string[];
}

export interface ManufacturingDrawingSheetArtifact {
  schema: 'nexyfab.manufacturing-drawing-sheet.v1';
  partId: string;
  bodyId: string;
  role: 'geometry-and-dimensions' | 'dimension-continuation';
  sheetNumber: number;
  sheetCount: number;
  paperSize: PaperSize;
  widthMm: number;
  heightMm: number;
  sourceStepSha256: string;
  exactViewCount: number;
  dimensionCount: number;
  releaseStatus: 'engineering-review-required';
  svgSha256: string;
  svg: string;
}

export interface ManufacturingDrawingArtifact {
  ok: boolean;
  partId: string;
  sheets: ManufacturingDrawingSheetArtifact[];
  plannedDimensionCount: number;
  includedDimensionCount: number;
  exactGeometrySheetCount: number;
  releaseEligible: false;
  releaseBlockers: string[];
  reason?: string;
}

interface ExactSvgPaths {
  viewBox: string;
  visible: string[];
  hidden: string[];
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function finite(value: number): string {
  if (!Number.isFinite(value)) throw new Error(`non-finite drawing value: ${value}`);
  return Number(value.toFixed(6)).toString();
}

function readExactSvg(svg: string): ExactSvgPaths {
  if (/<(?:script|foreignObject)\b|\son[a-z]+\s*=|\b(?:href|xlink:href)\s*=/i.test(svg)) {
    throw new Error('exact HLR SVG contains disallowed active or external content');
  }
  const root = svg.match(/<svg\b[^>]*\bviewBox="([^"]+)"[^>]*>/i);
  if (!root) throw new Error('exact HLR SVG has no viewBox');
  const numbers = root[1]!.trim().split(/[ ,]+/).map(Number);
  if (numbers.length !== 4 || numbers.some(value => !Number.isFinite(value)) || numbers[2]! <= 0 || numbers[3]! <= 0) {
    throw new Error(`invalid exact HLR viewBox '${root[1]}'`);
  }
  const visible: string[] = [];
  const hidden: string[] = [];
  const paths = svg.matchAll(/<path\s+data-layer="(visible|hidden)"\s+d="([^"]+)"\s*\/>/gi);
  for (const match of paths) {
    const d = match[2]!.trim();
    if (!d || !SVG_PATH_DATA.test(d)) throw new Error('exact HLR SVG contains invalid path data');
    (match[1]!.toLowerCase() === 'visible' ? visible : hidden).push(d);
  }
  if (visible.length === 0) throw new Error('exact HLR SVG has no visible path');
  return { viewBox: numbers.map(finite).join(' '), visible, hidden };
}

function displayDimension(measurement: PlannedMeasurement): ManufacturingDrawingDimensionRow {
  if (!measurement.result?.ok) {
    throw new Error(`dimension '${measurement.spec.id}' has no successful measurement`);
  }
  const { spec, result } = measurement;
  const value = finite(result.value);
  const prefix = spec.kind === 'diametric' ? 'Ø' : spec.kind === 'radial' ? 'R' : '';
  const suffix = result.unit === 'deg' ? '°' : ' mm';
  return {
    id: spec.id,
    bodyId: spec.bodyId,
    view: spec.view,
    kind: spec.kind,
    value: result.value,
    unit: result.unit,
    display: `${prefix}${value}${suffix}`,
    tolerance: spec.tolerance ? formatTolerance(spec.tolerance).trim() : '',
    refs: [...spec.refs],
  };
}

function renderExactView(
  view: ExactDrawingViewArtifact,
  box: { x: number; y: number; width: number; height: number },
): string[] {
  const paths = readExactSvg(view.svg);
  const visible = paths.visible.map(d => `<path d="${d}"/>`).join('');
  const hidden = paths.hidden.map(d => `<path d="${d}"/>`).join('');
  return [
    `<g data-view="${view.view}" data-body-id="${escapeXml(view.bodyId)}" data-source-step-sha256="${view.sourceStepSha256}">`,
    `<rect x="${finite(box.x)}" y="${finite(box.y)}" width="${finite(box.width)}" height="${finite(box.height)}" fill="none" stroke="#b8b8b8" stroke-width="0.15"/>`,
    `<svg x="${finite(box.x + 3)}" y="${finite(box.y + 5)}" width="${finite(box.width - 6)}" height="${finite(box.height - 12)}" viewBox="${paths.viewBox}" preserveAspectRatio="xMidYMid meet" overflow="visible">`,
    `<g fill="none" stroke="#000" stroke-width="0.25" vector-effect="non-scaling-stroke">${visible}</g>`,
    `<g fill="none" stroke="#555" stroke-width="0.18" stroke-dasharray="2 1" vector-effect="non-scaling-stroke">${hidden}</g>`,
    '</svg>',
    `<text x="${finite(box.x + box.width / 2)}" y="${finite(box.y + box.height - 2)}" text-anchor="middle" font-size="3" font-family="Arial,sans-serif">${view.view.toUpperCase()} · EXACT HLR</text>`,
    '</g>',
  ];
}

function renderDimensionTable(
  rows: ReadonlyArray<ManufacturingDrawingDimensionRow>,
  box: { x: number; y: number; width: number; height: number },
  title: string,
): string[] {
  const rowHeight = Math.min(4.5, (box.height - 8) / Math.max(rows.length + 1, 2));
  const columns = [0, 0.22, 0.34, 0.50, 0.70, 1].map(value => box.x + box.width * value);
  const out = [
    `<rect x="${finite(box.x)}" y="${finite(box.y)}" width="${finite(box.width)}" height="${finite(box.height)}" fill="none" stroke="#000" stroke-width="0.25"/>`,
    `<text x="${finite(box.x + 1.5)}" y="${finite(box.y + 4)}" font-size="3" font-weight="700" font-family="Arial,sans-serif">${escapeXml(title)}</text>`,
  ];
  const headerY = box.y + 7;
  const tableBottom = headerY + rowHeight * (rows.length + 1);
  for (const x of columns.slice(1, -1)) {
    out.push(`<line x1="${finite(x)}" y1="${finite(headerY)}" x2="${finite(x)}" y2="${finite(tableBottom)}" stroke="#777" stroke-width="0.12"/>`);
  }
  for (let index = 0; index <= rows.length + 1; index += 1) {
    const y = headerY + index * rowHeight;
    out.push(`<line x1="${finite(box.x)}" y1="${finite(y)}" x2="${finite(box.x + box.width)}" y2="${finite(y)}" stroke="#777" stroke-width="0.12"/>`);
  }
  const headers = ['ID', 'VIEW', 'TYPE', 'MEASURED', 'TOLERANCE'];
  headers.forEach((header, index) => {
    out.push(`<text x="${finite(columns[index]! + 1)}" y="${finite(headerY + rowHeight * 0.72)}" font-size="2.35" font-weight="700" font-family="Arial,sans-serif">${header}</text>`);
  });
  if (rows.length === 0) {
    out.push(`<text x="${finite(box.x + 2)}" y="${finite(headerY + rowHeight * 1.72)}" font-size="2.5" fill="#a00" font-family="Arial,sans-serif">NO PLANNED DIMENSIONS · RELEASE BLOCKED</text>`);
  }
  rows.forEach((row, index) => {
    const y = headerY + rowHeight * (index + 1.72);
    const values = [row.id, row.view.toUpperCase(), row.kind.toUpperCase(), row.display, row.tolerance || '—'];
    values.forEach((value, column) => {
      out.push(`<text x="${finite(columns[column]! + 1)}" y="${finite(y)}" font-size="2.25" font-family="Arial,sans-serif">${escapeXml(value)}</text>`);
    });
  });
  return out;
}

function renderTitleBlock(args: {
  x: number;
  y: number;
  width: number;
  height: number;
  plan: DesignPlan;
  part: PlanPart;
  bodyId: string;
  sourceStepSha256: string;
  sheetNumber: number;
  sheetCount: number;
}): string[] {
  const { x, y, width, height, plan, part, bodyId, sourceStepSha256, sheetNumber, sheetCount } = args;
  const lines = [
    `PART: ${part.name}`,
    `BODY: ${bodyId}`,
    `MATERIAL: ${part.material ?? 'NOT SPECIFIED'}`,
    'UNITS: mm · SCALE: NTS · DO NOT SCALE',
    `DRAWING: ${plan.planId}/${part.partId}`,
    `SHEET: ${sheetNumber}/${sheetCount} · REV: DRAFT`,
    `STEP SHA-256: ${sourceStepSha256.slice(0, 24)}…`,
    'DRAWN: NEXYFAB AI · CHECKED: __________',
    'APPROVED: __________ · DATE: __________',
  ];
  const out = [
    `<rect x="${finite(x)}" y="${finite(y)}" width="${finite(width)}" height="${finite(height)}" fill="none" stroke="#000" stroke-width="0.35"/>`,
    `<rect x="${finite(x)}" y="${finite(y)}" width="${finite(width)}" height="8" fill="#fff2cc" stroke="#000" stroke-width="0.2"/>`,
    `<text x="${finite(x + width / 2)}" y="${finite(y + 5.2)}" text-anchor="middle" font-size="3.2" font-weight="700" fill="#8a2600" font-family="Arial,sans-serif">ENGINEERING REVIEW REQUIRED · NOT RELEASED</text>`,
  ];
  const available = Math.max(height - 10, 1);
  const step = available / lines.length;
  lines.forEach((line, index) => {
    out.push(`<text x="${finite(x + 2)}" y="${finite(y + 10 + step * (index + 0.72))}" font-size="2.4" font-family="Arial,sans-serif">${escapeXml(line)}</text>`);
  });
  return out;
}

function svgDocument(args: {
  plan: DesignPlan;
  part: PlanPart;
  bodyId: string;
  views: ExactDrawingViewArtifact[];
  rows: ManufacturingDrawingDimensionRow[];
  role: ManufacturingDrawingSheetArtifact['role'];
  sourceStepSha256: string;
  sheetNumber: number;
  sheetCount: number;
}): { svg: string; widthMm: number; heightMm: number } {
  const paperSize = args.plan.drawing.paperSize ?? 'A3';
  const paper = paperDimensions(paperSize);
  const out = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${finite(paper.width)} ${finite(paper.height)}" width="${finite(paper.width)}mm" height="${finite(paper.height)}mm" data-schema="nexyfab.manufacturing-drawing-sheet.v1">`,
    `<metadata>${escapeXml(JSON.stringify({
      planId: args.plan.planId,
      partId: args.part.partId,
      bodyId: args.bodyId,
      sourceStepSha256: args.sourceStepSha256,
      geometrySource: 'round-trip-verified STEP / OCCT HLR',
      dimensionSource: 'NamedTopology measured',
      releaseStatus: 'engineering-review-required',
    }))}</metadata>`,
    `<rect x="10" y="10" width="${finite(paper.width - 20)}" height="${finite(paper.height - 20)}" fill="#fff" stroke="#000" stroke-width="0.5"/>`,
    `<text x="15" y="17" font-size="3.4" font-weight="700" font-family="Arial,sans-serif">${escapeXml(args.part.name)} · ${escapeXml(args.bodyId)} · VERIFIED STEP/OCCT HLR</text>`,
  ];

  if (args.role === 'geometry-and-dimensions') {
    const gap = 5;
    const x = 15;
    const width = paper.width - 30;
    const viewWidth = (width - gap * 2) / 3;
    const viewY = 21;
    const viewHeight = Math.min(148, paper.height * 0.51);
    REQUIRED_VIEWS.forEach((name, index) => {
      const view = args.views.find(candidate => candidate.view === name);
      if (!view) throw new Error(`body '${args.bodyId}' missing exact ${name} view`);
      out.push(...renderExactView(view, { x: x + index * (viewWidth + gap), y: viewY, width: viewWidth, height: viewHeight }));
    });
    const lowerY = viewY + viewHeight + 7;
    const lowerHeight = paper.height - lowerY - 15;
    const tableWidth = Math.min(250, paper.width * 0.61);
    out.push(...renderDimensionTable(args.rows, { x: 15, y: lowerY, width: tableWidth, height: lowerHeight }, 'MEASURED DIMENSION SCHEDULE'));
    out.push(...renderTitleBlock({
      x: 20 + tableWidth,
      y: lowerY,
      width: paper.width - tableWidth - 35,
      height: lowerHeight,
      plan: args.plan,
      part: args.part,
      bodyId: args.bodyId,
      sourceStepSha256: args.sourceStepSha256,
      sheetNumber: args.sheetNumber,
      sheetCount: args.sheetCount,
    }));
  } else {
    out.push(...renderDimensionTable(args.rows, { x: 15, y: 23, width: paper.width - 30, height: paper.height - 64 }, 'MEASURED DIMENSION SCHEDULE · CONTINUATION'));
    out.push(...renderTitleBlock({
      x: 15,
      y: paper.height - 36,
      width: paper.width - 30,
      height: 21,
      plan: args.plan,
      part: args.part,
      bodyId: args.bodyId,
      sourceStepSha256: args.sourceStepSha256,
      sheetNumber: args.sheetNumber,
      sheetCount: args.sheetCount,
    }));
  }

  out.push('</svg>');
  return { svg: out.join('\n'), widthMm: paper.width, heightMm: paper.height };
}

function failure(partId: string, reason: string): ManufacturingDrawingArtifact {
  return {
    ok: false,
    partId,
    sheets: [],
    plannedDimensionCount: 0,
    includedDimensionCount: 0,
    exactGeometrySheetCount: 0,
    releaseEligible: false,
    releaseBlockers: ['manufacturing drawing work packet is incomplete'],
    reason,
  };
}

export function buildManufacturingDrawingArtifact(
  plan: DesignPlan,
  part: PlanPart,
  exactDrawing: ExactDrawingArtifact | null,
  drawing: DrawingArtifact,
): ManufacturingDrawingArtifact {
  if (!exactDrawing?.ok) return failure(part.partId, 'exact HLR drawing artifact unavailable');
  try {
    const measurements = drawing.measurements.filter(item => item.spec.partId === part.partId);
    const rows = measurements.map(displayDimension);
    const sheets: ManufacturingDrawingSheetArtifact[] = [];

    for (const body of part.bodies) {
      const views = exactDrawing.views.filter(view => view.bodyId === body.bodyId);
      if (views.length !== REQUIRED_VIEWS.length || REQUIRED_VIEWS.some(name => !views.some(view => view.view === name))) {
        throw new Error(`body '${body.bodyId}' does not have one exact front/top/right HLR view set`);
      }
      const hashes = new Set(views.map(view => view.sourceStepSha256));
      if (hashes.size !== 1) throw new Error(`body '${body.bodyId}' exact views reference different STEP hashes`);
      const sourceStepSha256 = views[0]!.sourceStepSha256;
      const bodyRows = rows.filter(row => row.bodyId === body.bodyId);
      const remaining = Math.max(0, bodyRows.length - MAIN_DIMENSION_ROWS);
      const sheetCount = 1 + Math.ceil(remaining / CONTINUATION_DIMENSION_ROWS);
      const pageRows: ManufacturingDrawingDimensionRow[][] = [bodyRows.slice(0, MAIN_DIMENSION_ROWS)];
      for (let offset = MAIN_DIMENSION_ROWS; offset < bodyRows.length; offset += CONTINUATION_DIMENSION_ROWS) {
        pageRows.push(bodyRows.slice(offset, offset + CONTINUATION_DIMENSION_ROWS));
      }
      pageRows.forEach((dimensionRows, index) => {
        const role = index === 0 ? 'geometry-and-dimensions' : 'dimension-continuation';
        const document = svgDocument({
          plan,
          part,
          bodyId: body.bodyId,
          views,
          rows: dimensionRows,
          role,
          sourceStepSha256,
          sheetNumber: index + 1,
          sheetCount,
        });
        sheets.push({
          schema: 'nexyfab.manufacturing-drawing-sheet.v1',
          partId: part.partId,
          bodyId: body.bodyId,
          role,
          sheetNumber: index + 1,
          sheetCount,
          paperSize: plan.drawing.paperSize ?? 'A3',
          widthMm: document.widthMm,
          heightMm: document.heightMm,
          sourceStepSha256,
          exactViewCount: role === 'geometry-and-dimensions' ? REQUIRED_VIEWS.length : 0,
          dimensionCount: dimensionRows.length,
          releaseStatus: 'engineering-review-required',
          svgSha256: sha256(document.svg),
          svg: document.svg,
        });
      });
    }

    const includedDimensionCount = sheets.reduce((sum, sheet) => sum + sheet.dimensionCount, 0);
    const releaseBlockers = [
      'engineering checker approval signature is missing',
      'released drawing revision is not frozen',
      ...(rows.length === 0 ? ['no planned manufacturing dimensions were supplied'] : []),
    ];
    return {
      ok: sheets.length > 0 && includedDimensionCount === rows.length,
      partId: part.partId,
      sheets,
      plannedDimensionCount: rows.length,
      includedDimensionCount,
      exactGeometrySheetCount: sheets.filter(sheet => sheet.role === 'geometry-and-dimensions').length,
      releaseEligible: false,
      releaseBlockers,
      ...(includedDimensionCount !== rows.length
        ? { reason: `dimension coverage ${includedDimensionCount}/${rows.length}` }
        : {}),
    };
  } catch (error) {
    return failure(part.partId, error instanceof Error ? error.message : String(error));
  }
}

export function manufacturingDrawingGate(
  part: PlanPart,
  artifact: ManufacturingDrawingArtifact | null,
): GateResult {
  const notes = [
    'Every geometry sheet embeds front/top/right OCCT HLR paths from the round-trip-verified STEP body; no mesh projection is accepted.',
    'Every planned dimension row is populated only from a successful NamedTopology measurement; overflow uses deterministic continuation sheets.',
    'Gate pass means the engineering review work packet is complete. The drawing remains NOT RELEASED until a checker approves and freezes a revision.',
  ];
  if (!artifact) {
    return { id: `manufacturing-drawing:${part.partId}`, kind: 'manufacturing-drawing', pass: false, metrics: {}, reason: 'manufacturing drawing artifact missing', notes };
  }
  const validHashes = artifact.sheets.every(sheet => sha256(sheet.svg) === sheet.svgSha256);
  const geometrySheets = artifact.sheets.filter(sheet => sheet.role === 'geometry-and-dimensions');
  const exactViewCount = artifact.sheets.reduce((sum, sheet) => sum + sheet.exactViewCount, 0);
  const pass = artifact.ok
    && geometrySheets.length === part.bodies.length
    && exactViewCount === part.bodies.length * REQUIRED_VIEWS.length
    && artifact.includedDimensionCount === artifact.plannedDimensionCount
    && validHashes
    && artifact.releaseEligible === false;
  return {
    id: `manufacturing-drawing:${part.partId}`,
    kind: 'manufacturing-drawing',
    pass,
    metrics: {
      bodyCount: part.bodies.length,
      geometrySheetCount: geometrySheets.length,
      totalSheetCount: artifact.sheets.length,
      exactViewCount,
      plannedDimensionCount: artifact.plannedDimensionCount,
      includedDimensionCount: artifact.includedDimensionCount,
      verifiedSvgHashCount: artifact.sheets.filter(sheet => sha256(sheet.svg) === sheet.svgSha256).length,
      releaseEligible: artifact.releaseEligible ? 1 : 0,
    },
    ...(!pass ? { reason: artifact.reason ?? 'manufacturing drawing work packet is incomplete or inconsistent' } : {}),
    notes,
  };
}
