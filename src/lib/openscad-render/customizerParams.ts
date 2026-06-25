/**
 * customizerParams — parse OpenSCAD Customizer annotations out of a free-form
 * .scad program (CADAM-style), and substitute a new value back in.
 *
 * This is the bridge that lets a user adjust an LLM-written free-form OpenSCAD
 * program with sliders WITHOUT re-calling the AI: parse the top-level
 * parameters + their `// [min:max]` ranges, render sliders, and on change
 * rewrite the assignment line and re-render via the OpenSCAD CLI.
 *
 * Supported Customizer syntax (https://openscad.org/cheatsheet, Customizer):
 *   /* [Group] *\/                     → groups the params that follow
 *   // description                     → label/tooltip for the next param
 *   x = 10;        // [0:100]          → slider min:max
 *   x = 10;        // [0:5:100]        → slider min:step:max
 *   x = 10;        // [50]             → slider 0..50
 *   sel = "a";     // [a, b, c]        → dropdown
 *   flag = true;                       → checkbox (boolean literal)
 *   col = "Tomato";                    → string / colour field
 *
 * Pure + headless-testable.
 */

export type CustomizerKind = 'slider' | 'bool' | 'string' | 'dropdown';

export interface CustomizerParam {
  name: string;
  group: string | null;
  description: string | null;
  kind: CustomizerKind;
  value: number | boolean | string;
  /** slider */
  min?: number;
  max?: number;
  step?: number;
  /** dropdown */
  options?: Array<number | string>;
}

const GROUP_RE = /^\s*\/\*\s*\[(.+?)\]\s*\*\/\s*$/;
const DESC_RE = /^\s*\/\/\s?(.*)$/;
// name = value;  with an optional trailing `// [...]` annotation
const PARAM_RE = /^\s*([A-Za-z_]\w*)\s*=\s*([^;]+?)\s*;\s*(?:\/\/\s*(.*))?$/;

function parseLiteral(raw: string): { kind: 'number' | 'bool' | 'string' | 'other'; value: number | boolean | string } {
  const t = raw.trim();
  if (t === 'true' || t === 'false') return { kind: 'bool', value: t === 'true' };
  if (/^-?\d+(\.\d+)?$/.test(t)) return { kind: 'number', value: parseFloat(t) };
  const str = t.match(/^"(.*)"$/);
  if (str) return { kind: 'string', value: str[1]! };
  return { kind: 'other', value: t };
}

function decimals(n: number): number {
  const s = String(n);
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
}

/** Parse a `// [...]` annotation body into slider/dropdown metadata. */
function parseAnnotation(body: string): Partial<CustomizerParam> | null {
  const m = body.match(/^\[(.*)\]\s*$/);
  if (!m) return null;
  const inner = m[1]!.trim();
  if (inner === '') return null;
  // dropdown if it contains commas
  if (inner.includes(',')) {
    const opts = inner.split(',').map(s => {
      const v = s.trim();
      return /^-?\d+(\.\d+)?$/.test(v) ? parseFloat(v) : v.replace(/^"|"$/g, '');
    });
    return { kind: 'dropdown', options: opts };
  }
  // range: a:b or a:b:c
  const parts = inner.split(':').map(s => s.trim());
  if (parts.length === 1 && /^-?\d+(\.\d+)?$/.test(parts[0]!)) {
    const max = parseFloat(parts[0]!);
    return { kind: 'slider', min: 0, max, step: decimals(max) ? 0.1 : 1 };
  }
  if (parts.length === 2 && parts.every(p => /^-?\d+(\.\d+)?$/.test(p))) {
    const min = parseFloat(parts[0]!), max = parseFloat(parts[1]!);
    const step = (decimals(min) || decimals(max)) ? 0.1 : 1;
    return { kind: 'slider', min, max, step };
  }
  if (parts.length === 3 && parts.every(p => /^-?\d+(\.\d+)?$/.test(p))) {
    // OpenSCAD order is [min:step:max]
    const min = parseFloat(parts[0]!), step = parseFloat(parts[1]!), max = parseFloat(parts[2]!);
    return { kind: 'slider', min, max, step };
  }
  return null;
}

/**
 * Extract every adjustable top-level parameter. Stops collecting once real
 * geometry code starts (a `module`/`function` definition or a module call),
 * so only the customizer header block is considered.
 */
export function parseCustomizerParams(scad: string): CustomizerParam[] {
  const out: CustomizerParam[] = [];
  const lines = scad.split('\n');
  let group: string | null = null;
  let pendingDesc: string | null = null;

  for (const line of lines) {
    const g = line.match(GROUP_RE);
    if (g) { group = g[1]!.trim(); pendingDesc = null; continue; }

    const p = line.match(PARAM_RE);
    if (p) {
      const name = p[1]!;
      const lit = parseLiteral(p[2]!);
      const annotation = p[3] ? parseAnnotation(p[3]!.trim()) : null;
      // Skip $-specials and non-literal expressions (computed values).
      if (name.startsWith('$') || lit.kind === 'other') { pendingDesc = null; continue; }

      let param: CustomizerParam;
      if (lit.kind === 'bool') {
        param = { name, group, description: pendingDesc, kind: 'bool', value: lit.value };
      } else if (lit.kind === 'string') {
        if (annotation?.kind === 'dropdown') {
          param = { name, group, description: pendingDesc, kind: 'dropdown', value: lit.value, options: annotation.options };
        } else {
          param = { name, group, description: pendingDesc, kind: 'string', value: lit.value };
        }
      } else {
        // number
        if (annotation?.kind === 'slider') {
          param = { name, group, description: pendingDesc, kind: 'slider', value: lit.value, min: annotation.min, max: annotation.max, step: annotation.step };
        } else if (annotation?.kind === 'dropdown') {
          param = { name, group, description: pendingDesc, kind: 'dropdown', value: lit.value, options: annotation.options };
        } else {
          // Unannotated number → heuristic slider so it's still adjustable.
          const v = lit.value as number;
          const min = v > 0 ? Math.max(0, Math.round(v * 0.2)) : v - 10;
          const max = v > 0 ? Math.max(Math.round(v * 2.5), min + 1) : v + 10;
          param = { name, group, description: pendingDesc, kind: 'slider', value: v, min, max, step: decimals(v) ? 0.1 : 1 };
        }
      }
      out.push(param);
      pendingDesc = null;
      continue;
    }

    const d = line.match(DESC_RE);
    if (d) { pendingDesc = d[1]!.trim() || null; continue; }

    // A blank line keeps the pending description; any other code line ends it.
    if (line.trim() === '') continue;
    pendingDesc = null;
  }
  return out;
}

function formatValue(value: number | boolean | string): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  return `"${value}"`;
}

/**
 * Rewrite `name`'s assignment with a new value, preserving the trailing
 * `// [...]` annotation comment. Returns the SCAD unchanged if not found.
 */
export function applyCustomizerValue(scad: string, name: string, value: number | boolean | string): string {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^(\\s*${esc}\\s*=\\s*)[^;]+(;.*)$`, 'm');
  return scad.replace(re, `$1${formatValue(value)}$2`);
}
