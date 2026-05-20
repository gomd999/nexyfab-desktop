/**
 * designAutomation.ts — DriveWorks-style parametric design generator.
 *
 * DriveWorks lets engineers expose a CAD model as a *web form*: a
 * customer picks a few parameters (width, mounting style, color),
 * and the system emits a one-of-one drawing + STEP + cost.
 *
 * Capabilities:
 *
 *   - **Form schema** — typed parameters (number / enum / boolean /
 *     string) with min/max validation, default values, dependency
 *     gates (show "leg height" only when "stand" enum = "tall").
 *   - **Rule engine** — derive secondary parameters from primary
 *     (cost = base + sqft × $X, BOM lines that appear when the
 *     "include cover" boolean is checked).
 *   - **Validation** — flag invalid configurations before render.
 *   - **Snapshot & URL state** — serialize a configuration as a
 *     shareable JSON / URL.
 */

export type FieldKind = 'number' | 'enum' | 'boolean' | 'string';

export interface BaseField {
  id: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  /** When this expression is false, the field is hidden. */
  showIf?: string;
  helpText?: string;
}

export interface NumberField extends BaseField {
  kind: 'number';
  min: number;
  max: number;
  step?: number;
  defaultValue: number;
  /** Units shown in UI (mm, kg, etc). */
  unit?: string;
}

export interface EnumField extends BaseField {
  kind: 'enum';
  options: Array<{ value: string; label: string }>;
  defaultValue: string;
}

export interface BooleanField extends BaseField {
  kind: 'boolean';
  defaultValue: boolean;
}

export interface StringField extends BaseField {
  kind: 'string';
  maxLength?: number;
  pattern?: string;
  defaultValue: string;
}

export type Field = NumberField | EnumField | BooleanField | StringField;

export interface DerivedField {
  id: string;
  label: string;
  /** Expression referencing other field ids: e.g. "width * height" */
  expression: string;
  unit?: string;
}

export interface BomLine {
  /** Item code in the catalog. */
  partNumber: string;
  description: string;
  /** Expression for quantity. */
  quantityExpression: string;
  /** When this expression evaluates false, line is excluded. */
  conditionExpression?: string;
}

export interface DesignForm {
  id: string;
  name: string;
  fields: Field[];
  derived: DerivedField[];
  bom: BomLine[];
  /** Expression for total cost. */
  costExpression?: string;
}

export type FieldValue = number | string | boolean;
export type ConfigState = Record<string, FieldValue>;

// ── Expression evaluator ─────────────────────────────────────────

/** Very small expression evaluator. Supports +, -, multiplication,
 *  division, parens, field references, and comparisons. */
export function evalExpression(expr: string, ctx: ConfigState): number | boolean | string {
  const tokens = tokenize(expr);
  const parser = new Parser(tokens, ctx);
  return parser.parseExpression();
}

type Token =
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'identifier'; value: string }
  | { kind: 'op'; value: string }
  | { kind: 'lparen' }
  | { kind: 'rparen' };

function tokenize(s: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (/\s/.test(c)) { i++; continue; }
    if (c === '(') { out.push({ kind: 'lparen' }); i++; continue; }
    if (c === ')') { out.push({ kind: 'rparen' }); i++; continue; }
    if (c === '"' || c === "'") {
      const end = s.indexOf(c, i + 1);
      if (end < 0) throw new Error(`Unterminated string in "${s}"`);
      out.push({ kind: 'string', value: s.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j]!)) j++;
      out.push({ kind: 'number', value: parseFloat(s.slice(i, j)) });
      i = j; continue;
    }
    if (/[a-zA-Z_]/.test(c)) {
      let j = i;
      while (j < s.length && /[a-zA-Z0-9_]/.test(s[j]!)) j++;
      out.push({ kind: 'identifier', value: s.slice(i, j) });
      i = j; continue;
    }
    if (/[+\-*/<>=!&|]/.test(c)) {
      let j = i + 1;
      while (j < s.length && /[<>=&|]/.test(s[j]!)) j++;
      out.push({ kind: 'op', value: s.slice(i, j) });
      i = j; continue;
    }
    throw new Error(`Unexpected character '${c}' in "${s}"`);
  }
  return out;
}

class Parser {
  private pos = 0;
  constructor(private tokens: Token[], private ctx: ConfigState) {}

  parseExpression(): number | boolean | string {
    return this.parseLogical();
  }

  private peekOp(): string | null {
    const t = this.peek();
    return t && t.kind === 'op' ? t.value : null;
  }

  private parseLogical(): number | boolean | string {
    let left = this.parseComparison();
    while (this.peekOp() === '&&' || this.peekOp() === '||') {
      const op = this.peekOp()!;
      this.next();
      const right = this.parseComparison();
      const lb = !!left;
      const rb = !!right;
      left = op === '&&' ? (lb && rb) : (lb || rb);
    }
    return left;
  }

  private parseComparison(): number | boolean | string {
    const left = this.parseAddition();
    const op = this.peekOp();
    if (op && ['<', '>', '<=', '>=', '==', '!='].includes(op)) {
      this.next();
      const right = this.parseAddition();
      const ln = typeof left === 'number' ? left : Number(left);
      const rn = typeof right === 'number' ? right : Number(right);
      switch (op) {
        case '<':  return ln < rn;
        case '>':  return ln > rn;
        case '<=': return ln <= rn;
        case '>=': return ln >= rn;
        case '==': return left == right; // loose equal so 1 == true works
        case '!=': return left != right;
      }
    }
    return left;
  }

  private parseAddition(): number | boolean | string {
    let left = this.parseMultiplication();
    while (this.peekOp() === '+' || this.peekOp() === '-') {
      const op = this.peekOp()!;
      this.next();
      const right = this.parseMultiplication();
      const ln = typeof left === 'number' ? left : Number(left);
      const rn = typeof right === 'number' ? right : Number(right);
      left = op === '+' ? ln + rn : ln - rn;
    }
    return left;
  }

  private parseMultiplication(): number | boolean | string {
    let left = this.parseUnary();
    while (this.peekOp() === '*' || this.peekOp() === '/') {
      const op = this.peekOp()!;
      this.next();
      const right = this.parseUnary();
      const ln = typeof left === 'number' ? left : Number(left);
      const rn = typeof right === 'number' ? right : Number(right);
      left = op === '*' ? ln * rn : ln / rn;
    }
    return left;
  }

  private parseUnary(): number | boolean | string {
    if (this.peekOp() === '-') {
      this.next();
      const v = this.parsePrimary();
      return -Number(v);
    }
    if (this.peekOp() === '!') {
      this.next();
      const v = this.parsePrimary();
      return !v;
    }
    return this.parsePrimary();
  }

  private parsePrimary(): number | boolean | string {
    const t = this.next();
    if (!t) throw new Error('Unexpected end of expression');
    if (t.kind === 'number') return t.value;
    if (t.kind === 'string') return t.value;
    if (t.kind === 'lparen') {
      const e = this.parseExpression();
      const close = this.next();
      if (!close || close.kind !== 'rparen') throw new Error('Missing closing paren');
      return e;
    }
    if (t.kind === 'identifier') {
      if (t.value === 'true') return true;
      if (t.value === 'false') return false;
      const v = this.ctx[t.value];
      return v ?? 0;
    }
    throw new Error(`Unexpected token: ${JSON.stringify(t)}`);
  }

  private peek(): Token | null { return this.tokens[this.pos] ?? null; }
  private next(): Token | null { return this.tokens[this.pos++] ?? null; }
}

// ── Form lifecycle ───────────────────────────────────────────────

/** Initialize the form state from field defaults. */
export function initState(form: DesignForm): ConfigState {
  const state: ConfigState = {};
  for (const f of form.fields) state[f.id] = f.defaultValue;
  return state;
}

/** Validate a state against the form definition. */
export interface ValidationReport {
  valid: boolean;
  errors: Array<{ fieldId: string; message: string }>;
}

export function validateState(form: DesignForm, state: ConfigState): ValidationReport {
  const errors: ValidationReport['errors'] = [];
  for (const f of form.fields) {
    // Skip hidden fields.
    if (f.showIf) {
      const visible = !!evalExpression(f.showIf, state);
      if (!visible) continue;
    }
    const v = state[f.id];
    if (f.required && (v == null || v === '')) {
      errors.push({ fieldId: f.id, message: 'Required field is empty' });
      continue;
    }
    if (f.kind === 'number') {
      const n = Number(v);
      if (!Number.isFinite(n)) {
        errors.push({ fieldId: f.id, message: 'Not a number' });
      } else if (n < f.min) {
        errors.push({ fieldId: f.id, message: `Below minimum ${f.min}` });
      } else if (n > f.max) {
        errors.push({ fieldId: f.id, message: `Above maximum ${f.max}` });
      }
    } else if (f.kind === 'enum') {
      if (!f.options.some(o => o.value === v)) {
        errors.push({ fieldId: f.id, message: 'Not a valid option' });
      }
    } else if (f.kind === 'string') {
      const s = String(v);
      if (f.maxLength && s.length > f.maxLength) {
        errors.push({ fieldId: f.id, message: `Too long (max ${f.maxLength})` });
      }
      if (f.pattern && !new RegExp(f.pattern).test(s)) {
        errors.push({ fieldId: f.id, message: 'Does not match pattern' });
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

/** Resolve derived fields against the form state. */
export function evaluateDerived(form: DesignForm, state: ConfigState): Record<string, number | boolean | string> {
  const out: Record<string, number | boolean | string> = {};
  const ctx = { ...state, ...out };
  for (const d of form.derived) {
    try {
      const v = evalExpression(d.expression, ctx);
      out[d.id] = v;
      (ctx as Record<string, unknown>)[d.id] = v;
    } catch {
      out[d.id] = NaN;
    }
  }
  return out;
}

/** Resolve the BOM lines that apply to the current state. */
export interface ResolvedBomLine {
  partNumber: string;
  description: string;
  quantity: number;
}

export function resolveBom(form: DesignForm, state: ConfigState): ResolvedBomLine[] {
  const derived = evaluateDerived(form, state);
  const ctx = { ...state, ...derived };
  const out: ResolvedBomLine[] = [];
  for (const b of form.bom) {
    if (b.conditionExpression) {
      const cond = evalExpression(b.conditionExpression, ctx);
      if (!cond) continue;
    }
    const qty = Number(evalExpression(b.quantityExpression, ctx));
    if (qty > 0) {
      out.push({ partNumber: b.partNumber, description: b.description, quantity: qty });
    }
  }
  return out;
}

/** Compute total cost. */
export function computeCost(form: DesignForm, state: ConfigState): number {
  if (!form.costExpression) return 0;
  const derived = evaluateDerived(form, state);
  const v = evalExpression(form.costExpression, { ...state, ...derived });
  return Number(v) || 0;
}

// ── URL serialization ───────────────────────────────────────────

/** Serialize state to a compact URL-safe string. */
export function stateToUrlParam(state: ConfigState): string {
  const json = JSON.stringify(state);
  return typeof globalThis.btoa === 'function'
    ? globalThis.btoa(unescape(encodeURIComponent(json)))
    : Buffer.from(json, 'utf8').toString('base64');
}

/** Deserialize state from URL param. */
export function stateFromUrlParam(param: string): ConfigState {
  const json = typeof globalThis.atob === 'function'
    ? decodeURIComponent(escape(globalThis.atob(param)))
    : Buffer.from(param, 'base64').toString('utf8');
  return JSON.parse(json);
}
