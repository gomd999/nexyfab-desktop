/**
 * positionDrivers.ts — Mate values driven by formulas / time / other mates.
 *
 * SolidWorks "mate driver" = a mate value computed from an
 * expression or another mate. Examples:
 *
 *   - Gear ratio: lower mate = upper mate × 2.5
 *   - Linkage: piston position = crank angle.sin × radius
 *   - Time function: mate = sin(2π · t / period) × amplitude
 *
 * This module evaluates the expression at every motion tick and
 * emits the resulting mate value updates. Expressions are a
 * minimal AST — no full eval(), no DOM access. Variables are
 * looked up in a `varTable` the caller fills with current mate
 * values + time `t`.
 */

export type Expr =
  | { kind: 'num'; value: number }
  | { kind: 'var'; name: string }
  | { kind: 'bin'; op: '+' | '-' | '*' | '/' | '^'; left: Expr; right: Expr }
  | { kind: 'fn'; name: 'sin' | 'cos' | 'tan' | 'abs' | 'sqrt' | 'min' | 'max' | 'pow'; args: Expr[] };

export interface DriverDefinition {
  id: string;
  /** Mate id that this driver controls. */
  mateId: string;
  paramKey: string;
  expr: Expr;
  /** Optional clamp range. */
  minValue?: number;
  maxValue?: number;
}

export class ExpressionError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = 'ExpressionError';
  }
}

/** Variable lookup table — `t` for time, mate ids as numeric vars. */
export type VarTable = Record<string, number>;

export function evalExpr(expr: Expr, vars: VarTable): number {
  switch (expr.kind) {
    case 'num':
      return expr.value;
    case 'var': {
      const v = vars[expr.name];
      if (v === undefined || !Number.isFinite(v)) {
        throw new ExpressionError(`Undefined variable: ${expr.name}`);
      }
      return v;
    }
    case 'bin': {
      const l = evalExpr(expr.left, vars);
      const r = evalExpr(expr.right, vars);
      switch (expr.op) {
        case '+': return l + r;
        case '-': return l - r;
        case '*': return l * r;
        case '/':
          if (r === 0) throw new ExpressionError('Division by zero');
          return l / r;
        case '^': return Math.pow(l, r);
      }
      break;
    }
    case 'fn': {
      const args = expr.args.map(a => evalExpr(a, vars));
      switch (expr.name) {
        case 'sin':  return Math.sin(args[0]!);
        case 'cos':  return Math.cos(args[0]!);
        case 'tan':  return Math.tan(args[0]!);
        case 'abs':  return Math.abs(args[0]!);
        case 'sqrt': return Math.sqrt(args[0]!);
        case 'min':  return Math.min(...args);
        case 'max':  return Math.max(...args);
        case 'pow':  return Math.pow(args[0]!, args[1]!);
      }
    }
  }
  throw new ExpressionError(`Unknown expression`);
}

/** Compile a simple infix expression into an AST. Supports binary
 *  ops, parens, function calls. Minimal grammar — not a full lang. */
export function parseExpr(input: string): Expr {
  let pos = 0;
  const text = input.replace(/\s+/g, '');

  function peek(): string { return text[pos] ?? ''; }
  function eat(c: string): boolean { if (peek() === c) { pos++; return true; } return false; }

  function parseNumber(): Expr {
    const start = pos;
    while (/[\d.]/.test(text[pos] ?? '')) pos++;
    const numStr = text.slice(start, pos);
    if (!numStr) throw new ExpressionError(`Expected number at ${pos}`);
    const v = parseFloat(numStr);
    if (!Number.isFinite(v)) throw new ExpressionError(`Bad number: ${numStr}`);
    return { kind: 'num', value: v };
  }

  function parseIdent(): string {
    const start = pos;
    while (/[a-zA-Z_]/.test(text[pos] ?? '')) pos++;
    return text.slice(start, pos);
  }

  function parsePrimary(): Expr {
    if (eat('(')) {
      const e = parseAddSub();
      if (!eat(')')) throw new ExpressionError(`Expected )`);
      return e;
    }
    if (eat('-')) {
      return { kind: 'bin', op: '*', left: { kind: 'num', value: -1 }, right: parsePrimary() };
    }
    if (/[a-zA-Z]/.test(peek())) {
      const name = parseIdent();
      if (eat('(')) {
        const args: Expr[] = [parseAddSub()];
        while (eat(',')) args.push(parseAddSub());
        if (!eat(')')) throw new ExpressionError(`Expected ) in fn call`);
        if (!['sin', 'cos', 'tan', 'abs', 'sqrt', 'min', 'max', 'pow'].includes(name)) {
          throw new ExpressionError(`Unknown function: ${name}`);
        }
        return { kind: 'fn', name: name as 'sin', args };
      }
      return { kind: 'var', name };
    }
    return parseNumber();
  }

  function parsePower(): Expr {
    let left = parsePrimary();
    while (eat('^')) {
      const right = parsePrimary();
      left = { kind: 'bin', op: '^', left, right };
    }
    return left;
  }

  function parseMulDiv(): Expr {
    let left = parsePower();
    while (peek() === '*' || peek() === '/') {
      const op = peek() as '*' | '/';
      pos++;
      const right = parsePower();
      left = { kind: 'bin', op, left, right };
    }
    return left;
  }

  function parseAddSub(): Expr {
    let left = parseMulDiv();
    while (peek() === '+' || peek() === '-') {
      const op = peek() as '+' | '-';
      pos++;
      const right = parseMulDiv();
      left = { kind: 'bin', op, left, right };
    }
    return left;
  }

  const result = parseAddSub();
  if (pos !== text.length) {
    throw new ExpressionError(`Unexpected character: ${text.slice(pos)}`);
  }
  return result;
}

export interface DriverEvaluation {
  mateId: string;
  paramKey: string;
  value: number;
}

/** Evaluate every driver against the current variable table. */
export function evaluateDrivers(
  drivers: DriverDefinition[],
  vars: VarTable,
): DriverEvaluation[] {
  const out: DriverEvaluation[] = [];
  for (const d of drivers) {
    try {
      let v = evalExpr(d.expr, vars);
      if (d.minValue !== undefined && v < d.minValue) v = d.minValue;
      if (d.maxValue !== undefined && v > d.maxValue) v = d.maxValue;
      out.push({ mateId: d.mateId, paramKey: d.paramKey, value: v });
    } catch {
      // Skip drivers whose expressions can't be evaluated this tick
      // (e.g. waiting for a var that the next mate update will set).
    }
  }
  return out;
}
