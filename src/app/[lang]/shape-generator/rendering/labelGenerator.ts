/**
 * labelGenerator.ts — Parametric label layout for engraved / printed labels.
 *
 * Customers want a "part number + lot code + manufacture date" label
 * on every unit. The generator:
 *
 *   - Lays out **text fields** (constant or variable like part number,
 *     date, sequential code).
 *   - Optionally embeds a **barcode** (Code 128 / 39) or **QR code**.
 *   - Wraps the label onto a **cylindrical / planar** surface with
 *     UV mapping.
 *   - Honors a clearance margin so the label doesn't overflow.
 *
 * For engraving we output the label as a 2D path; for printing we
 * output a baked texture. This module handles the *layout* — actual
 * glyph rasterization is left to `parametricTypography.ts` and
 * external barcode libraries.
 */

export type Point2D = { x: number; y: number };

export type FieldKind = 'text' | 'date' | 'sequence' | 'barcode' | 'qr';

export interface LabelField {
  id: string;
  kind: FieldKind;
  /** Raw value or template "PN-{date}-{seq}". */
  value: string;
  /** Bounding box in label-local coords. */
  bbox: { x: number; y: number; width: number; height: number };
  /** Font size for text fields (mm). */
  fontSizeMm?: number;
  /** Optional rotation (deg). */
  rotationDeg?: number;
}

export interface LabelSpec {
  /** Label dimensions. */
  widthMm: number;
  heightMm: number;
  /** Margin from each edge. */
  marginMm: number;
  /** Fields to render. */
  fields: LabelField[];
  /** Background color (for printed labels). */
  backgroundColor?: [number, number, number];
}

export interface LabelContext {
  /** Variable substitutions. */
  vars: Record<string, string>;
  /** Current date (defaults to now). */
  date?: Date;
  /** Sequence counter. */
  sequence?: number;
}

export interface RenderedLabel {
  /** Concrete field values after template resolution. */
  fields: Array<{
    id: string;
    kind: FieldKind;
    value: string;
    position: Point2D;
    sizeMm: { width: number; height: number };
    rotationDeg: number;
  }>;
  /** Warnings (overflow, missing var). */
  warnings: string[];
}

// ── Top-level entry ─────────────────────────────────────────────

export function renderLabel(spec: LabelSpec, ctx: LabelContext): RenderedLabel {
  const fields: RenderedLabel['fields'] = [];
  const warnings: string[] = [];
  const date = ctx.date ?? new Date();

  for (const field of spec.fields) {
    let value = field.value;
    if (field.kind === 'date') {
      value = formatDate(value || 'YYYY-MM-DD', date);
    } else if (field.kind === 'sequence') {
      value = padSequence(ctx.sequence ?? 0, value);
    } else if (field.kind === 'text') {
      value = substituteVars(value, ctx.vars, date, ctx.sequence ?? 0, warnings);
    }

    // Validate bbox is within the usable area.
    if (field.bbox.x < spec.marginMm || field.bbox.y < spec.marginMm ||
        field.bbox.x + field.bbox.width > spec.widthMm - spec.marginMm ||
        field.bbox.y + field.bbox.height > spec.heightMm - spec.marginMm) {
      warnings.push(`Field ${field.id} overflows margin`);
    }

    fields.push({
      id: field.id,
      kind: field.kind,
      value,
      position: { x: field.bbox.x, y: field.bbox.y },
      sizeMm: { width: field.bbox.width, height: field.bbox.height },
      rotationDeg: field.rotationDeg ?? 0,
    });
  }
  return { fields, warnings };
}

// ── Template substitution ────────────────────────────────────

const TEMPLATE_TOKEN_RE = /\{([^}]+)\}/g;

function substituteVars(template: string, vars: Record<string, string>, date: Date, sequence: number, warnings: string[]): string {
  return template.replace(TEMPLATE_TOKEN_RE, (_match, name) => {
    const key = String(name).trim();
    if (key === 'date') return formatDate('YYYY-MM-DD', date);
    if (key === 'seq') return String(sequence);
    if (key.startsWith('date:')) return formatDate(key.slice(5), date);
    if (key in vars) return vars[key]!;
    warnings.push(`Missing variable: ${key}`);
    return `{${key}}`;
  });
}

// ── Date format (subset of strftime) ──────────────────────────

function formatDate(format: string, date: Date): string {
  const pad = (n: number, w: number = 2) => String(n).padStart(w, '0');
  return format
    .replace(/YYYY/g, String(date.getFullYear()))
    .replace(/YY/g, String(date.getFullYear() % 100).padStart(2, '0'))
    .replace(/MM/g, pad(date.getMonth() + 1))
    .replace(/DD/g, pad(date.getDate()))
    .replace(/HH/g, pad(date.getHours()))
    .replace(/mm/g, pad(date.getMinutes()))
    .replace(/ss/g, pad(date.getSeconds()));
}

// ── Sequence padding ──────────────────────────────────────────

function padSequence(value: number, format: string): string {
  const widthMatch = format.match(/^0{1,8}$/);
  if (widthMatch) {
    return String(value).padStart(widthMatch[0].length, '0');
  }
  return String(value);
}

// ── Cylindrical wrap ──────────────────────────────────────────

export interface CylindricalWrapOptions {
  /** Cylinder radius (mm). */
  radiusMm: number;
  /** Cylinder axis ('x' | 'y' | 'z'). */
  axis: 'x' | 'y' | 'z';
  /** Wrap origin angle (rad). */
  baseAngleRad: number;
}

export interface WrappedPoint3D {
  x: number;
  y: number;
  z: number;
}

/** Wrap a label-local 2D point onto a cylinder surface. */
export function wrapToCylinder(p: Point2D, label: LabelSpec, opts: CylindricalWrapOptions): WrappedPoint3D {
  // Map p.x in [0, label.widthMm] to angle.
  const angleStep = label.widthMm / opts.radiusMm; // arc length / radius
  const angle = opts.baseAngleRad + (p.x / label.widthMm) * angleStep;
  const r = opts.radiusMm;
  const a = Math.cos(angle) * r;
  const b = Math.sin(angle) * r;
  switch (opts.axis) {
    case 'x': return { x: p.y, y: a, z: b };
    case 'y': return { x: a, y: p.y, z: b };
    case 'z': return { x: a, y: b, z: p.y };
  }
}

// ── Diagnostics ────────────────────────────────────────────────

export interface LabelStats {
  fieldCount: number;
  fieldsByKind: Record<FieldKind, number>;
  warningCount: number;
  totalAreaUsedMm2: number;
}

export function summarize(label: LabelSpec, rendered: RenderedLabel): LabelStats {
  const byKind: Record<string, number> = {};
  let area = 0;
  for (const f of rendered.fields) {
    byKind[f.kind] = (byKind[f.kind] ?? 0) + 1;
    area += f.sizeMm.width * f.sizeMm.height;
  }
  void label;
  return {
    fieldCount: rendered.fields.length,
    fieldsByKind: byKind as Record<FieldKind, number>,
    warningCount: rendered.warnings.length,
    totalAreaUsedMm2: area,
  };
}

// ── Built-in presets ──────────────────────────────────────────

export const LABEL_PRESETS: Record<string, LabelSpec> = {
  serial_plate: {
    widthMm: 60,
    heightMm: 20,
    marginMm: 2,
    fields: [
      { id: 'pn', kind: 'text', value: 'PN: {partNumber}', bbox: { x: 2, y: 14, width: 56, height: 4 } },
      { id: 'sn', kind: 'sequence', value: '00000', bbox: { x: 2, y: 8, width: 30, height: 4 } },
      { id: 'date', kind: 'date', value: 'YYYY-MM-DD', bbox: { x: 35, y: 8, width: 23, height: 4 } },
      { id: 'qr', kind: 'qr', value: '{partNumber}', bbox: { x: 2, y: 2, width: 4, height: 4 } },
    ],
  },
  qr_only: {
    widthMm: 12,
    heightMm: 12,
    marginMm: 1,
    fields: [
      { id: 'qr', kind: 'qr', value: '{partNumber}', bbox: { x: 1, y: 1, width: 10, height: 10 } },
    ],
  },
};
