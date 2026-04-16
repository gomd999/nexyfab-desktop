// ─── Parametric Expression Engine ────────────────────────────────────────────
// Safe recursive-descent parser for math expressions with variable references.
// NO eval() — purely hand-written tokenizer + parser.

export interface ExprVariable {
  name: string;
  value: number;
}

// ─── Token types ─────────────────────────────────────────────────────────────

type TokenType = 'NUMBER' | 'IDENT' | 'OP' | 'LPAREN' | 'RPAREN' | 'COMMA' | 'EOF';

interface Token {
  type: TokenType;
  value: string;
  pos: number;
}

// ─── Tokenizer ───────────────────────────────────────────────────────────────

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    // Skip whitespace
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }
    // Number: integer or decimal
    if ((ch >= '0' && ch <= '9') || (ch === '.' && i + 1 < expr.length && expr[i + 1] >= '0' && expr[i + 1] <= '9')) {
      const start = i;
      while (i < expr.length && ((expr[i] >= '0' && expr[i] <= '9') || expr[i] === '.')) i++;
      tokens.push({ type: 'NUMBER', value: expr.slice(start, i), pos: start });
      continue;
    }
    // Identifier (variable or function name): letter or underscore followed by alphanumerics
    if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_') {
      const start = i;
      while (i < expr.length && ((expr[i] >= 'a' && expr[i] <= 'z') || (expr[i] >= 'A' && expr[i] <= 'Z') || (expr[i] >= '0' && expr[i] <= '9') || expr[i] === '_')) i++;
      tokens.push({ type: 'IDENT', value: expr.slice(start, i), pos: start });
      continue;
    }
    // Operators
    if (ch === '+' || ch === '-' || ch === '*' || ch === '/') {
      tokens.push({ type: 'OP', value: ch, pos: i });
      i++;
      continue;
    }
    if (ch === '(') { tokens.push({ type: 'LPAREN', value: '(', pos: i }); i++; continue; }
    if (ch === ')') { tokens.push({ type: 'RPAREN', value: ')', pos: i }); i++; continue; }
    if (ch === ',') { tokens.push({ type: 'COMMA', value: ',', pos: i }); i++; continue; }
    throw new Error(`Unexpected character '${ch}' at position ${i}`);
  }
  tokens.push({ type: 'EOF', value: '', pos: i });
  return tokens;
}

// ─── Built-in functions ──────────────────────────────────────────────────────

const BUILT_IN_FUNCTIONS: Record<string, { arity: number; fn: (...args: number[]) => number }> = {
  min:  { arity: 2, fn: (a, b) => Math.min(a, b) },
  max:  { arity: 2, fn: (a, b) => Math.max(a, b) },
  abs:  { arity: 1, fn: (a) => Math.abs(a) },
  sqrt: { arity: 1, fn: (a) => Math.sqrt(a) },
  sin:  { arity: 1, fn: (a) => Math.sin(a) },
  cos:  { arity: 1, fn: (a) => Math.cos(a) },
};

// ─── Parser ──────────────────────────────────────────────────────────────────
// Grammar:
//   expr   → term (('+' | '-') term)*
//   term   → factor (('*' | '/') factor)*
//   factor → NUMBER | IDENT | IDENT '(' args ')' | '(' expr ')' | '-' factor | '+' factor

class Parser {
  private tokens: Token[];
  private pos: number;
  private varMap: Map<string, number>;

  constructor(tokens: Token[], variables: ExprVariable[]) {
    this.tokens = tokens;
    this.pos = 0;
    this.varMap = new Map();
    for (const v of variables) {
      this.varMap.set(v.name, v.value);
    }
  }

  private peek(): Token {
    return this.tokens[this.pos];
  }

  private advance(): Token {
    const tok = this.tokens[this.pos];
    this.pos++;
    return tok;
  }

  private expect(type: TokenType, value?: string): Token {
    const tok = this.peek();
    if (tok.type !== type || (value !== undefined && tok.value !== value)) {
      throw new Error(`Expected ${value ?? type} at position ${tok.pos}, got '${tok.value}'`);
    }
    return this.advance();
  }

  parse(): number {
    const result = this.expr();
    if (this.peek().type !== 'EOF') {
      throw new Error(`Unexpected token '${this.peek().value}' at position ${this.peek().pos}`);
    }
    return result;
  }

  private expr(): number {
    let left = this.term();
    while (this.peek().type === 'OP' && (this.peek().value === '+' || this.peek().value === '-')) {
      const op = this.advance().value;
      const right = this.term();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }

  private term(): number {
    let left = this.factor();
    while (this.peek().type === 'OP' && (this.peek().value === '*' || this.peek().value === '/')) {
      const op = this.advance().value;
      const right = this.factor();
      if (op === '/') {
        if (right === 0) throw new Error('Division by zero');
        left = left / right;
      } else {
        left = left * right;
      }
    }
    return left;
  }

  private factor(): number {
    const tok = this.peek();

    // Unary minus
    if (tok.type === 'OP' && tok.value === '-') {
      this.advance();
      return -this.factor();
    }

    // Unary plus
    if (tok.type === 'OP' && tok.value === '+') {
      this.advance();
      return this.factor();
    }

    // Number literal
    if (tok.type === 'NUMBER') {
      this.advance();
      const num = parseFloat(tok.value);
      if (isNaN(num)) throw new Error(`Invalid number '${tok.value}' at position ${tok.pos}`);
      return num;
    }

    // Identifier: variable or function call
    if (tok.type === 'IDENT') {
      this.advance();
      const name = tok.value;

      // Function call
      if (this.peek().type === 'LPAREN' && name in BUILT_IN_FUNCTIONS) {
        this.advance(); // consume '('
        const builtIn = BUILT_IN_FUNCTIONS[name];
        const args: number[] = [];
        if (this.peek().type !== 'RPAREN') {
          args.push(this.expr());
          while (this.peek().type === 'COMMA') {
            this.advance();
            args.push(this.expr());
          }
        }
        this.expect('RPAREN');
        if (args.length !== builtIn.arity) {
          throw new Error(`Function '${name}' expects ${builtIn.arity} argument(s), got ${args.length}`);
        }
        return builtIn.fn(...args);
      }

      // Variable lookup
      if (this.varMap.has(name)) {
        return this.varMap.get(name)!;
      }
      throw new Error(`Unknown variable '${name}' at position ${tok.pos}`);
    }

    // Parenthesized expression
    if (tok.type === 'LPAREN') {
      this.advance();
      const val = this.expr();
      this.expect('RPAREN');
      return val;
    }

    throw new Error(`Unexpected token '${tok.value}' at position ${tok.pos}`);
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Evaluate a math expression string with variable substitution.
 * Supports: +, -, *, /, (), variable references, unary minus,
 * and built-in functions: min, max, abs, sqrt, sin, cos.
 *
 * @example
 * evaluateExpression("width*2+10", [{name:'width', value:50}]) // → 110
 */
export function evaluateExpression(expr: string, variables: ExprVariable[]): number {
  if (!expr || expr.trim() === '') throw new Error('Empty expression');
  const tokens = tokenize(expr);
  const parser = new Parser(tokens, variables);
  const result = parser.parse();
  if (!isFinite(result)) throw new Error('Result is not finite');
  return result;
}

/**
 * Resolves a set of named expression strings into numeric values, detecting
 * circular references.  Each entry in `expressionMap` maps a variable name to
 * either a plain number (already resolved) or a string expression that may
 * reference other variables in the same map.
 *
 * Throws if a circular dependency is detected (e.g. a = b + 1, b = a * 2).
 *
 * @example
 * resolveAll({ width: '50', depth: 'width * 2', area: 'width * depth' })
 * // → { width: 50, depth: 100, area: 5000 }
 */
export function resolveAll(
  expressionMap: Record<string, number | string>,
): Record<string, number> {
  const resolved: Record<string, number> = {};
  // Track variables currently being evaluated to detect cycles.
  const evaluating = new Set<string>();

  function resolve(name: string): number {
    if (name in resolved) return resolved[name];

    if (evaluating.has(name)) {
      throw new Error(
        `Circular reference detected: "${name}" depends on itself (cycle: ${[...evaluating, name].join(' → ')})`,
      );
    }

    const raw = expressionMap[name];
    if (raw === undefined) {
      throw new Error(`Unknown variable "${name}"`);
    }

    // Already a plain number — no expression parsing needed.
    if (typeof raw === 'number') {
      resolved[name] = raw;
      return raw;
    }

    // String expression — resolve all referenced variables first.
    evaluating.add(name);
    try {
      // Collect referenced identifiers (excluding built-ins).
      const deps = extractIdentifiers(raw);

      // Recursively resolve dependencies so they are available as numbers.
      const variables: ExprVariable[] = deps
        .filter((dep) => dep in expressionMap)
        .map((dep) => ({ name: dep, value: resolve(dep) }));

      const result = evaluateExpression(raw, variables);
      resolved[name] = result;
      return result;
    } finally {
      evaluating.delete(name);
    }
  }

  for (const name of Object.keys(expressionMap)) {
    resolve(name);
  }

  return resolved;
}

/**
 * Returns true if the string contains operators, function calls, or variable
 * names — i.e. it is more than just a plain number.
 */
export function isExpression(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === '') return false;
  // If it parses as a plain number, it's not an expression
  if (/^[+-]?\d+(\.\d+)?$/.test(trimmed)) return false;
  return true;
}

/**
 * Extract all variable/function names referenced in an expression string.
 * Useful for autocomplete and dependency tracking.
 */
export function extractIdentifiers(expr: string): string[] {
  try {
    const tokens = tokenize(expr);
    return tokens
      .filter(t => t.type === 'IDENT')
      .map(t => t.value)
      .filter(name => !(name in BUILT_IN_FUNCTIONS));
  } catch {
    return [];
  }
}

/** Names of all built-in functions for autocomplete */
export const BUILT_IN_FUNCTION_NAMES = Object.keys(BUILT_IN_FUNCTIONS);
