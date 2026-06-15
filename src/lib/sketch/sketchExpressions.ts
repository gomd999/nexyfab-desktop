/**
 * sketchExpressions — parametric expressions for sketch constraint values.
 *
 * Phase 2.x of NexyFab Pro own-CAD (ADR-013) parametric layer.
 *
 * Lets sketch constraints reference named variables and compute their
 * values from arithmetic expressions:
 *
 *   width      = 50            // free var
 *   spacing    = 5             // free var
 *   col_count  = 4             // free var
 *   total      = width * col_count + spacing * (col_count - 1)
 *
 * A `SketchSolver` distance constraint can then bind to `total` instead
 * of a hard-coded literal — re-evaluating when any input changes.
 *
 * Design constraints (strict):
 *   - NEW file only. Does NOT modify `solver.ts` or `sketchSnapshot.ts`.
 *   - Pure logic. No external parser/eval library (no `mathjs`, `expr-eval`).
 *   - **NO `eval()` or `Function()` constructor anywhere**. Custom
 *     recursive-descent parser + AST walker — every operator and function
 *     is explicit in `evaluateExpression`. Untrusted user input is safe
 *     because identifiers must resolve to variables in `ExpressionContext`
 *     and function calls must hit the whitelist in `BUILTIN_FUNCTIONS`.
 *
 * Supported grammar (recursive descent, classic precedence climbing):
 *
 *   expr        := addExpr
 *   addExpr     := mulExpr (('+' | '-') mulExpr)*
 *   mulExpr     := powExpr (('*' | '/' | '%') powExpr)*
 *   powExpr     := unaryExpr ('**' powExpr)?            // right-associative
 *   unaryExpr   := ('+' | '-') unaryExpr | primaryExpr
 *   primaryExpr := number | unitLit | identifier | call | '(' expr ')'
 *   call        := identifier '(' (expr (',' expr)*)? ')'
 *
 * Tokens with units (`10mm`, `0.5in`, `90deg`) collapse the literal +
 * unit into a single `NUMBER_UNIT` token, eliminating ambiguity with
 * `mm` as an identifier.
 *
 * Units are normalised at evaluation time:
 *   length → mm   (in → ×25.4)
 *   angle  → rad  (deg → ×π/180)
 */

// ─── Token types ──────────────────────────────────────────────────────────

export type TokenKind =
  | 'NUMBER'        // 12, 3.14, .5, 2e3
  | 'NUMBER_UNIT'   // 10mm, 0.5in, 90deg, 1.5rad
  | 'IDENT'         // L1, width, sin, pi
  | 'PLUS'          // +
  | 'MINUS'         // -
  | 'STAR'          // *
  | 'SLASH'         // /
  | 'PERCENT'       // %
  | 'POW'           // **
  | 'LPAREN'        // (
  | 'RPAREN'        // )
  | 'COMMA'         // ,
  | 'EOF';

export interface Token {
  kind: TokenKind;
  /** Literal text from source (for diagnostics). */
  text: string;
  /** For NUMBER / NUMBER_UNIT, the parsed numeric component. */
  value?: number;
  /** For NUMBER_UNIT, the unit suffix ('mm', 'in', 'deg', 'rad'). */
  unit?: string;
  /** Zero-based char offset into source (for error messages). */
  pos: number;
}

// ─── AST nodes ────────────────────────────────────────────────────────────

export type ExprNode =
  | { kind: 'number'; value: number; unit?: string }
  | { kind: 'ident'; name: string }
  | { kind: 'unary'; op: '+' | '-'; operand: ExprNode }
  | { kind: 'binary'; op: BinaryOp; left: ExprNode; right: ExprNode }
  | { kind: 'call'; name: string; args: ExprNode[] };

export type BinaryOp = '+' | '-' | '*' | '/' | '%' | '**';

// ─── Public interfaces ────────────────────────────────────────────────────

export interface ParametricVariable {
  id: string;
  value: number;
  /** Undefined for a free (input) variable. */
  expression?: string;
  /** Optional declared unit — value is always stored canonical (mm or rad). */
  unit?: string;
}

export interface ExpressionContext {
  variables: Record<string, ParametricVariable>;
}

export interface EvaluationResult {
  variableId: string;
  resolvedValue: number;
  dependsOn: string[];
  ok: boolean;
  error?: string;
}

// ─── Unit handling ────────────────────────────────────────────────────────

/** Length conversion factors to mm (canonical). */
const LENGTH_TO_MM: Record<string, number> = {
  mm: 1,
  cm: 10,
  m: 1000,
  in: 25.4,
  ft: 304.8,
};

/** Angle conversion factors to rad (canonical). */
const ANGLE_TO_RAD: Record<string, number> = {
  rad: 1,
  deg: Math.PI / 180,
};

const ALL_UNITS = new Set<string>([
  ...Object.keys(LENGTH_TO_MM),
  ...Object.keys(ANGLE_TO_RAD),
]);

function isLengthUnit(u: string): boolean {
  return u in LENGTH_TO_MM;
}

function isAngleUnit(u: string): boolean {
  return u in ANGLE_TO_RAD;
}

/**
 * Parse a single unit-suffixed literal — e.g. "10mm", "0.5in", "90deg",
 * or "42" (no unit, returns unit = '').
 *
 * Used both by the tokenizer and standalone by callers that want to
 * read a user-typed dimensioned value without a full expression parse.
 */
export function parseUnit(source: string): { value: number; unit: string } {
  const trimmed = source.trim();
  // Match: optional sign, mantissa (digits and/or dot), optional exponent,
  // optional unit suffix.
  const m = trimmed.match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*([a-zA-Z]*)$/);
  if (!m) throw new Error(`parseUnit: invalid literal "${source}"`);
  const value = Number(m[1]);
  if (!Number.isFinite(value)) throw new Error(`parseUnit: non-finite value in "${source}"`);
  const unit = m[2] ?? '';
  if (unit !== '' && !ALL_UNITS.has(unit)) {
    throw new Error(`parseUnit: unknown unit "${unit}"`);
  }
  return { value, unit };
}

/**
 * Convert `value` from unit `from` to unit `to`. Both units must be of
 * the same dimension (both length or both angle). Empty `from` / `to`
 * is treated as "already canonical for that dimension".
 */
export function convertUnit(value: number, from: string, to: string): number {
  if (from === to) return value;
  // Length ↔ length
  if (isLengthUnit(from) && isLengthUnit(to)) {
    const mm = value * LENGTH_TO_MM[from];
    return mm / LENGTH_TO_MM[to];
  }
  // Angle ↔ angle
  if (isAngleUnit(from) && isAngleUnit(to)) {
    const rad = value * ANGLE_TO_RAD[from];
    return rad / ANGLE_TO_RAD[to];
  }
  throw new Error(`convertUnit: incompatible units "${from}" → "${to}"`);
}

/** Internal — fold any unit suffix on a numeric literal to canonical (mm or rad). */
function normaliseLiteral(value: number, unit?: string): number {
  if (!unit) return value;
  if (isLengthUnit(unit)) return value * LENGTH_TO_MM[unit];
  if (isAngleUnit(unit)) return value * ANGLE_TO_RAD[unit];
  throw new Error(`unknown unit "${unit}"`);
}

// ─── Tokenizer ────────────────────────────────────────────────────────────

const ID_START = /[A-Za-z_]/;
const ID_CONT = /[A-Za-z0-9_]/;
const DIGIT = /[0-9]/;

export function tokenize(source: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const n = source.length;

  while (i < n) {
    const ch = source[i];

    // Whitespace
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }

    // Numbers (and NUMBER_UNIT when followed by identifier-letters)
    if (DIGIT.test(ch) || (ch === '.' && i + 1 < n && DIGIT.test(source[i + 1]))) {
      const start = i;
      while (i < n && DIGIT.test(source[i])) i++;
      if (i < n && source[i] === '.') {
        i++;
        while (i < n && DIGIT.test(source[i])) i++;
      }
      // Exponent
      if (i < n && (source[i] === 'e' || source[i] === 'E')) {
        const expStart = i;
        i++;
        if (i < n && (source[i] === '+' || source[i] === '-')) i++;
        if (i >= n || !DIGIT.test(source[i])) {
          throw new Error(
            `tokenize: malformed exponent at pos ${expStart} in "${source}"`
          );
        }
        while (i < n && DIGIT.test(source[i])) i++;
      }
      const numText = source.slice(start, i);
      const num = Number(numText);
      if (!Number.isFinite(num)) {
        throw new Error(`tokenize: invalid number "${numText}" at pos ${start}`);
      }

      // Unit suffix?
      if (i < n && ID_START.test(source[i])) {
        const uStart = i;
        while (i < n && ID_CONT.test(source[i])) i++;
        const unit = source.slice(uStart, i);
        if (!ALL_UNITS.has(unit)) {
          throw new Error(
            `tokenize: unknown unit "${unit}" at pos ${uStart} in "${source}"`
          );
        }
        out.push({
          kind: 'NUMBER_UNIT',
          text: source.slice(start, i),
          value: num,
          unit,
          pos: start,
        });
      } else {
        out.push({ kind: 'NUMBER', text: numText, value: num, pos: start });
      }
      continue;
    }

    // Identifiers
    if (ID_START.test(ch)) {
      const start = i;
      while (i < n && ID_CONT.test(source[i])) i++;
      out.push({ kind: 'IDENT', text: source.slice(start, i), pos: start });
      continue;
    }

    // Operators / punctuation
    if (ch === '*' && i + 1 < n && source[i + 1] === '*') {
      out.push({ kind: 'POW', text: '**', pos: i });
      i += 2;
      continue;
    }
    switch (ch) {
      case '+': out.push({ kind: 'PLUS',    text: '+', pos: i }); i++; continue;
      case '-': out.push({ kind: 'MINUS',   text: '-', pos: i }); i++; continue;
      case '*': out.push({ kind: 'STAR',    text: '*', pos: i }); i++; continue;
      case '/': out.push({ kind: 'SLASH',   text: '/', pos: i }); i++; continue;
      case '%': out.push({ kind: 'PERCENT', text: '%', pos: i }); i++; continue;
      case '(': out.push({ kind: 'LPAREN',  text: '(', pos: i }); i++; continue;
      case ')': out.push({ kind: 'RPAREN',  text: ')', pos: i }); i++; continue;
      case ',': out.push({ kind: 'COMMA',   text: ',', pos: i }); i++; continue;
    }

    throw new Error(`tokenize: unexpected character "${ch}" at pos ${i}`);
  }

  out.push({ kind: 'EOF', text: '', pos: i });
  return out;
}

// ─── Recursive-descent parser ─────────────────────────────────────────────

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  parse(): ExprNode {
    const node = this.parseAdd();
    if (this.peek().kind !== 'EOF') {
      const t = this.peek();
      throw new Error(`parseExpression: unexpected "${t.text}" at pos ${t.pos}`);
    }
    return node;
  }

  // expr = addExpr
  private parseAdd(): ExprNode {
    let left = this.parseMul();
    while (this.peek().kind === 'PLUS' || this.peek().kind === 'MINUS') {
      const op = this.next().kind === 'PLUS' ? '+' : '-';
      const right = this.parseMul();
      left = { kind: 'binary', op, left, right };
    }
    return left;
  }

  private parseMul(): ExprNode {
    let left = this.parsePow();
    while (
      this.peek().kind === 'STAR' ||
      this.peek().kind === 'SLASH' ||
      this.peek().kind === 'PERCENT'
    ) {
      const k = this.next().kind;
      const op: BinaryOp = k === 'STAR' ? '*' : k === 'SLASH' ? '/' : '%';
      const right = this.parsePow();
      left = { kind: 'binary', op, left, right };
    }
    return left;
  }

  // ** is right-associative: 2**3**2 → 2**(3**2) = 512.
  private parsePow(): ExprNode {
    const left = this.parseUnary();
    if (this.peek().kind === 'POW') {
      this.next();
      const right = this.parsePow();
      return { kind: 'binary', op: '**', left, right };
    }
    return left;
  }

  private parseUnary(): ExprNode {
    if (this.peek().kind === 'PLUS' || this.peek().kind === 'MINUS') {
      const op = this.next().kind === 'PLUS' ? '+' : '-';
      const operand = this.parseUnary();
      return { kind: 'unary', op, operand };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): ExprNode {
    const t = this.peek();
    if (t.kind === 'NUMBER') {
      this.next();
      return { kind: 'number', value: t.value! };
    }
    if (t.kind === 'NUMBER_UNIT') {
      this.next();
      return { kind: 'number', value: t.value!, unit: t.unit };
    }
    if (t.kind === 'IDENT') {
      this.next();
      // Function call?
      if (this.peek().kind === 'LPAREN') {
        this.next(); // consume (
        const args: ExprNode[] = [];
        if (this.peek().kind !== 'RPAREN') {
          args.push(this.parseAdd());
          while (this.peek().kind === 'COMMA') {
            this.next();
            args.push(this.parseAdd());
          }
        }
        if (this.peek().kind !== 'RPAREN') {
          throw new Error(
            `parseExpression: missing ")" after call args at pos ${this.peek().pos}`
          );
        }
        this.next(); // consume )
        return { kind: 'call', name: t.text, args };
      }
      return { kind: 'ident', name: t.text };
    }
    if (t.kind === 'LPAREN') {
      this.next();
      const inner = this.parseAdd();
      if (this.peek().kind !== 'RPAREN') {
        throw new Error(
          `parseExpression: missing ")" at pos ${this.peek().pos}`
        );
      }
      this.next();
      return inner;
    }
    throw new Error(`parseExpression: unexpected "${t.text}" at pos ${t.pos}`);
  }

  private peek(): Token { return this.tokens[this.pos]; }
  private next(): Token { return this.tokens[this.pos++]; }
}

export function parseExpression(source: string): ExprNode {
  const tokens = tokenize(source);
  return new Parser(tokens).parse();
}

// ─── Builtins (whitelist — eval-free) ─────────────────────────────────────

type BuiltinFn = (args: number[]) => number;

const BUILTIN_FUNCTIONS: Record<string, { arity: number | [number, number]; fn: BuiltinFn }> = {
  sin:   { arity: 1, fn: ([x]) => Math.sin(x) },
  cos:   { arity: 1, fn: ([x]) => Math.cos(x) },
  tan:   { arity: 1, fn: ([x]) => Math.tan(x) },
  asin:  { arity: 1, fn: ([x]) => Math.asin(x) },
  acos:  { arity: 1, fn: ([x]) => Math.acos(x) },
  atan:  { arity: 1, fn: ([x]) => Math.atan(x) },
  atan2: { arity: 2, fn: ([y, x]) => Math.atan2(y, x) },
  sqrt:  { arity: 1, fn: ([x]) => Math.sqrt(x) },
  abs:   { arity: 1, fn: ([x]) => Math.abs(x) },
  floor: { arity: 1, fn: ([x]) => Math.floor(x) },
  ceil:  { arity: 1, fn: ([x]) => Math.ceil(x) },
  round: { arity: 1, fn: ([x]) => Math.round(x) },
  min:   { arity: [1, Infinity], fn: (a) => Math.min(...a) },
  max:   { arity: [1, Infinity], fn: (a) => Math.max(...a) },
};

const BUILTIN_CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
};

// ─── Evaluator ────────────────────────────────────────────────────────────

export function evaluateExpression(expr: ExprNode, ctx: ExpressionContext): number {
  switch (expr.kind) {
    case 'number':
      return normaliseLiteral(expr.value, expr.unit);
    case 'ident': {
      if (expr.name in BUILTIN_CONSTANTS) return BUILTIN_CONSTANTS[expr.name];
      const v = ctx.variables[expr.name];
      if (!v) throw new Error(`evaluateExpression: undefined identifier "${expr.name}"`);
      return v.value;
    }
    case 'unary': {
      const x = evaluateExpression(expr.operand, ctx);
      return expr.op === '-' ? -x : +x;
    }
    case 'binary': {
      const l = evaluateExpression(expr.left, ctx);
      const r = evaluateExpression(expr.right, ctx);
      switch (expr.op) {
        case '+':  return l + r;
        case '-':  return l - r;
        case '*':  return l * r;
        case '/':
          if (r === 0) throw new Error('evaluateExpression: division by zero');
          return l / r;
        case '%':
          if (r === 0) throw new Error('evaluateExpression: modulo by zero');
          return l % r;
        case '**': return l ** r;
      }
      // Should be unreachable thanks to exhaustive switch.
      throw new Error(`evaluateExpression: unknown binary op`);
    }
    case 'call': {
      const def = BUILTIN_FUNCTIONS[expr.name];
      if (!def) throw new Error(`evaluateExpression: unknown function "${expr.name}"`);
      const args = expr.args.map((a) => evaluateExpression(a, ctx));
      if (typeof def.arity === 'number') {
        if (args.length !== def.arity) {
          throw new Error(
            `evaluateExpression: ${expr.name}() expects ${def.arity} arg(s), got ${args.length}`
          );
        }
      } else {
        const [lo, hi] = def.arity;
        if (args.length < lo || args.length > hi) {
          throw new Error(
            `evaluateExpression: ${expr.name}() expects ${lo}-${hi === Infinity ? '∞' : hi} args, got ${args.length}`
          );
        }
      }
      return def.fn(args);
    }
  }
}

// ─── Dependency extraction ────────────────────────────────────────────────

export function extractDependencies(expr: ExprNode): string[] {
  const seen = new Set<string>();
  walk(expr, seen);
  return [...seen];
}

function walk(expr: ExprNode, out: Set<string>): void {
  switch (expr.kind) {
    case 'number':
      return;
    case 'ident':
      // Skip builtin constants — they're not "dependencies" on user vars.
      if (!(expr.name in BUILTIN_CONSTANTS)) out.add(expr.name);
      return;
    case 'unary':
      walk(expr.operand, out);
      return;
    case 'binary':
      walk(expr.left, out);
      walk(expr.right, out);
      return;
    case 'call':
      // Function name itself is NOT a variable reference (whitelisted builtin).
      for (const a of expr.args) walk(a, out);
      return;
  }
}

// ─── Topological evaluation ───────────────────────────────────────────────

/**
 * Evaluate every variable in `ctx` in dependency order. Free vars
 * (no `expression`) yield their stored `value` unchanged. Vars whose
 * expression references missing identifiers, builds a cycle, or hits
 * any runtime error are returned with `ok: false`.
 *
 * Returned in topological order (dependencies first). Vars in a cycle
 * are appended at the end (still `ok: false`).
 *
 * Side-effect-free: does NOT mutate `ctx`. Callers wanting persistent
 * resolution should copy `resolvedValue` back into their store.
 */
export function evaluateAllVariables(ctx: ExpressionContext): EvaluationResult[] {
  const ids = Object.keys(ctx.variables);
  // Parse + extract dependencies up front so we can topologically sort.
  const deps = new Map<string, string[]>();
  const parseErrors = new Map<string, string>();
  const asts = new Map<string, ExprNode>();

  for (const id of ids) {
    const v = ctx.variables[id];
    if (v.expression === undefined) {
      deps.set(id, []);
      continue;
    }
    try {
      const ast = parseExpression(v.expression);
      asts.set(id, ast);
      // Only track deps that resolve to known variables (not builtins,
      // not undefined identifiers — undefined will surface at eval time).
      deps.set(id, extractDependencies(ast).filter((d) => d in ctx.variables));
    } catch (err) {
      parseErrors.set(id, err instanceof Error ? err.message : String(err));
      deps.set(id, []);
    }
  }

  // Kahn's algorithm. Edge: dep → dependent.
  const inDegree = new Map<string, number>();
  const reverse = new Map<string, string[]>(); // dep → [dependents]
  for (const id of ids) {
    inDegree.set(id, 0);
    reverse.set(id, []);
  }
  for (const id of ids) {
    for (const d of deps.get(id)!) {
      inDegree.set(id, (inDegree.get(id) ?? 0) + 1);
      reverse.get(d)!.push(id);
    }
  }

  const queue: string[] = [];
  for (const id of ids) {
    if ((inDegree.get(id) ?? 0) === 0) queue.push(id);
  }
  // Stable ordering inside each topological layer — sort by id.
  queue.sort();

  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    const dependents = reverse.get(id) ?? [];
    const newlyFree: string[] = [];
    for (const d of dependents) {
      const next = (inDegree.get(d) ?? 0) - 1;
      inDegree.set(d, next);
      if (next === 0) newlyFree.push(d);
    }
    newlyFree.sort();
    for (const n of newlyFree) queue.push(n);
  }

  // Anything left with inDegree > 0 is in a cycle. Mark them and
  // append at the end.
  const inCycle = new Set<string>();
  for (const id of ids) {
    if (!order.includes(id)) inCycle.add(id);
  }

  // Evaluate in topo order, mutating a *local* shadow context so later
  // expressions see resolved upstream values.
  const shadow: ExpressionContext = {
    variables: Object.fromEntries(
      ids.map((id) => [id, { ...ctx.variables[id] }])
    ),
  };

  const results: EvaluationResult[] = [];
  for (const id of order) {
    const v = shadow.variables[id];
    const result: EvaluationResult = {
      variableId: id,
      resolvedValue: v.value,
      dependsOn: deps.get(id) ?? [],
      ok: true,
    };
    if (parseErrors.has(id)) {
      result.ok = false;
      result.error = parseErrors.get(id);
    } else if (v.expression !== undefined) {
      const ast = asts.get(id)!;
      try {
        const value = evaluateExpression(ast, shadow);
        if (!Number.isFinite(value)) {
          result.ok = false;
          result.error = `evaluation produced non-finite value (${value})`;
        } else {
          result.resolvedValue = value;
          v.value = value;
        }
      } catch (err) {
        result.ok = false;
        result.error = err instanceof Error ? err.message : String(err);
      }
    }
    results.push(result);
  }

  for (const id of [...inCycle].sort()) {
    results.push({
      variableId: id,
      resolvedValue: shadow.variables[id].value,
      dependsOn: deps.get(id) ?? [],
      ok: false,
      error: 'circular dependency',
    });
  }

  return results;
}

// ─── Cycle detection ──────────────────────────────────────────────────────

/**
 * Return every dependency cycle in `ctx` as an ordered list of var ids.
 * Includes self-references (`A → A` → `[['A']]`).
 *
 * Tarjan's strongly-connected-components algorithm. Each SCC with >1
 * node is a cycle; a self-loop is detected by an explicit edge from a
 * node to itself even when the SCC has size 1.
 *
 * Cycles are returned in canonical rotation (smallest id first) and
 * sorted lexically so callers get a stable output regardless of
 * traversal order.
 */
export function detectCircularDependency(ctx: ExpressionContext): string[][] {
  const ids = Object.keys(ctx.variables);
  const adj = new Map<string, string[]>();
  for (const id of ids) {
    const v = ctx.variables[id];
    if (!v.expression) {
      adj.set(id, []);
      continue;
    }
    try {
      const ast = parseExpression(v.expression);
      adj.set(id, extractDependencies(ast).filter((d) => d in ctx.variables));
    } catch {
      adj.set(id, []);
    }
  }

  let index = 0;
  const indices = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];

  const strongConnect = (v: string): void => {
    indices.set(v, index);
    lowlink.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);

    for (const w of adj.get(v) ?? []) {
      if (!indices.has(w)) {
        strongConnect(w);
        lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v)!, indices.get(w)!));
      }
    }

    if (lowlink.get(v) === indices.get(v)) {
      const comp: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      sccs.push(comp);
    }
  };

  for (const id of ids) {
    if (!indices.has(id)) strongConnect(id);
  }

  const cycles: string[][] = [];
  for (const comp of sccs) {
    if (comp.length > 1) {
      // Rotate so smallest id is first; preserve cyclic order.
      const minIdx = comp.indexOf([...comp].sort()[0]);
      const rotated = [...comp.slice(minIdx), ...comp.slice(0, minIdx)];
      cycles.push(rotated);
    } else {
      // Self-loop?
      const v = comp[0];
      if ((adj.get(v) ?? []).includes(v)) cycles.push([v]);
    }
  }

  // Stable order: by first element, then by length.
  cycles.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a.length - b.length));
  return cycles;
}
