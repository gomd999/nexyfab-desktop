/**
 * equationManager.ts — Global parameter table + cross-feature formulas.
 *
 * SolidWorks Equation Manager lets you define "D1@Sketch1 = 2 * D2@Sketch2"
 * so multiple features stay in proportion when one driver changes. NexyFab
 * equivalent: a global name → number table + per-feature param expressions
 * that reference those names.
 *
 * Capabilities:
 *   - Define global variables ("thickness = 2", "ratio = 1.5")
 *   - Reference variables from feature param formulas
 *   - Variables can reference other variables (DAG)
 *   - Cycle detection — refuses to add an edge that creates a cycle
 *   - Topological re-evaluation on edit (downstream re-computed in order)
 *
 * Expression parser is shared with positionDrivers (`positionDrivers.ts`)
 * — that module's parser handles +, -, multiplication, division, power,
 * and math functions (sin, cos, etc).
 */

import { parseExpr, evalExpr, type Expr } from '../assembly/positionDrivers';

export interface GlobalVariable {
  name: string;
  /** Raw expression string. Constant numbers also supported. */
  expression: string;
  /** Compiled AST cache (lazily built). */
  ast?: Expr;
  /** Last evaluated value. */
  value: number;
  /** Names this variable references. */
  dependencies: Set<string>;
}

export interface VariableTable {
  variables: Map<string, GlobalVariable>;
}

function gatherDependencies(expr: Expr): Set<string> {
  const out = new Set<string>();
  function walk(e: Expr): void {
    switch (e.kind) {
      case 'var': out.add(e.name); break;
      case 'bin': walk(e.left); walk(e.right); break;
      case 'fn':  for (const a of e.args) walk(a); break;
    }
  }
  walk(expr);
  return out;
}

export class EquationManager {
  private table: VariableTable = { variables: new Map() };

  /** Set or update a variable. Re-evaluates affected dependents. */
  set(name: string, expression: string): void {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
      throw new Error(`Invalid variable name: ${name}`);
    }
    const ast = parseExpr(expression);
    const deps = gatherDependencies(ast);
    // Cycle check — would adding this var introduce a cycle?
    if (this.wouldCycle(name, deps)) {
      throw new Error(`Variable "${name}" would create a cycle`);
    }
    const existing = this.table.variables.get(name);
    const newVar: GlobalVariable = {
      name,
      expression,
      ast,
      value: existing?.value ?? 0,
      dependencies: deps,
    };
    this.table.variables.set(name, newVar);
    this.reevaluate();
  }

  /** Remove a variable. Throws if other variables depend on it. */
  remove(name: string): void {
    const dependents: string[] = [];
    for (const v of this.table.variables.values()) {
      if (v.dependencies.has(name)) dependents.push(v.name);
    }
    if (dependents.length > 0) {
      throw new Error(`Cannot remove "${name}" — referenced by: ${dependents.join(', ')}`);
    }
    this.table.variables.delete(name);
  }

  /** Get a variable's current value. */
  get(name: string): number | null {
    return this.table.variables.get(name)?.value ?? null;
  }

  /** All variables. */
  list(): GlobalVariable[] {
    return Array.from(this.table.variables.values());
  }

  /** Build a flat var table for use in feature param evaluation. */
  toVarTable(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const v of this.table.variables.values()) out[v.name] = v.value;
    return out;
  }

  /** Evaluate a feature param expression against the current table. */
  evaluateExpression(expression: string): number {
    const ast = parseExpr(expression);
    return evalExpr(ast, this.toVarTable());
  }

  /** Topologically re-evaluate every variable. */
  private reevaluate(): void {
    const order = this.topologicalSort();
    const valueMap: Record<string, number> = {};
    for (const name of order) {
      const v = this.table.variables.get(name)!;
      try {
        v.value = evalExpr(v.ast!, valueMap);
      } catch {
        v.value = NaN;
      }
      valueMap[name] = v.value;
    }
  }

  /** Topological sort of variables by dependency. */
  private topologicalSort(): string[] {
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const order: string[] = [];
    const visit = (name: string): void => {
      if (visited.has(name)) return;
      if (visiting.has(name)) return; // cycle — skip
      visiting.add(name);
      const v = this.table.variables.get(name);
      if (v) {
        for (const dep of v.dependencies) {
          if (this.table.variables.has(dep)) visit(dep);
        }
      }
      visiting.delete(name);
      visited.add(name);
      order.push(name);
    };
    for (const name of this.table.variables.keys()) visit(name);
    return order;
  }

  /** Resolve a FeatureInstance-like object's string params into numerics.
   *  Params can be either `number` or `string`. String params are treated
   *  as expressions against the current variable table; numeric strings
   *  fall through untouched. Unresolvable expressions stay as `NaN` so
   *  the downstream feature guard can flag the error. */
  resolveFeatureParams<T extends { params: Record<string, number | string> }>(feature: T): T & { params: Record<string, number> } {
    const vars = this.toVarTable();
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(feature.params)) {
      if (typeof v === 'number') { out[k] = v; continue; }
      if (typeof v === 'string') {
        const trimmed = v.trim();
        if (trimmed === '') { out[k] = NaN; continue; }
        // Numeric literal fast path.
        const asNum = Number(trimmed);
        if (!Number.isNaN(asNum)) { out[k] = asNum; continue; }
        try {
          out[k] = evalExpr(parseExpr(trimmed), vars);
        } catch {
          out[k] = NaN;
        }
      }
    }
    return { ...feature, params: out };
  }

  /** Convenience: resolve a list of features. */
  resolveFeatures<T extends { params: Record<string, number | string> }>(features: T[]): Array<T & { params: Record<string, number> }> {
    return features.map(f => this.resolveFeatureParams(f));
  }

  /** True if adding (name, deps) would create a cycle. */
  private wouldCycle(name: string, deps: Set<string>): boolean {
    // BFS from each dep; if we reach `name`, cycle exists.
    const queue: string[] = Array.from(deps);
    const seen = new Set<string>();
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (cur === name) return true;
      if (seen.has(cur)) continue;
      seen.add(cur);
      const v = this.table.variables.get(cur);
      if (v) queue.push(...v.dependencies);
    }
    return false;
  }
}
