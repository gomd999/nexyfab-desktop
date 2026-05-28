/**
 * validateModel.ts — sanity-check a ConfigurationTable against the
 * master feature tree.
 *
 * Wave 2 Phase 2 Track A Week 2 (A2). Pure function. Ported from
 * `assembly/multiConfigPartVariant.validateModel`, extended to cover:
 *
 *   - **`unknown_feature`** — override targets a featureId not in the
 *     master tree (spec §13.4 "Orphan override").
 *   - **`unknown_parent`** — `parentId` references a missing config.
 *   - **`parent_cycle`** — parent chain forms a loop. Reuses the
 *     `findAllCycles` helper from `referenceGeometry/depSolver` so the
 *     algorithm has one implementation and cycle-path is available.
 *   - **`undefined_var`** — an override or expressionVar value is a
 *     string expression that references a variable name not in scope.
 *     "In scope" = active config's `expressionVars` ∪ table's
 *     `globalVars` ∪ feature param keys of the *same* feature (for
 *     per-feature overrides). The EquationManager global table is
 *     *not* checked here — A3 will inject that table when wiring the
 *     real resolver. For A2 we use a permissive scope so the
 *     validator is useful even before A3.
 *
 * Returns either `{ ok: true }` or `{ ok: false, errors: [...] }`.
 * Errors are collected (not short-circuited) so the UI can render the
 * full list in one pass.
 */

import { findAllCycles } from '../referenceGeometry/depSolver';
import type { ConfigurationTable } from './ConfigurationTable';
import type {
  ConfigEntry,
  ConfigValidationError,
  MasterFeatures,
  ValidationResult,
} from './types';

/**
 * Crude identifier extractor used to flag obviously-undefined vars in
 * a string expression. Real evaluation happens in A3 via
 * `positionDrivers`; for A2 we just need to catch the common case of
 * "user typed `bolt_d * 0.5` but `bolt_d` isn't defined anywhere".
 *
 * Strategy: scan for word-boundary identifiers (`[A-Za-z_][\w]*`),
 * filter out known function names (sin/cos/…/pow) and pure-numeric
 * tokens (already excluded by the regex). Anything left is a var
 * reference candidate.
 */
const KNOWN_FUNCS = new Set(['sin', 'cos', 'tan', 'sqrt', 'abs', 'min', 'max', 'pow', 'pi', 'e']);
const IDENT_RE = /[A-Za-z_][A-Za-z0-9_]*/g;

function extractIdentifiers(expr: string): string[] {
  const out: string[] = [];
  const matches = expr.match(IDENT_RE);
  if (!matches) return out;
  for (const m of matches) {
    if (KNOWN_FUNCS.has(m.toLowerCase())) continue;
    out.push(m);
  }
  return out;
}

interface ScopeBuilders {
  /** Vars defined at the config level (and its parent chain). */
  configVars: Set<string>;
  /** Vars defined globally on the table. */
  globalVars: Set<string>;
}

function buildScope(table: ConfigurationTable, entry: ConfigEntry): ScopeBuilders {
  const configVars = new Set<string>();
  // Walk parent chain so child overrides see parent vars (matches the
  // resolution priority in spec §4.2).
  for (const cfg of table.parentChain(entry.id)) {
    for (const k of Object.keys(cfg.expressionVars)) configVars.add(k);
  }
  const globalVars = new Set(Object.keys(table.getGlobalVars()));
  return { configVars, globalVars };
}

function isInScope(name: string, scope: ScopeBuilders): boolean {
  return scope.configVars.has(name) || scope.globalVars.has(name);
}

export function validateModel(
  table: ConfigurationTable,
  features: MasterFeatures,
): ValidationResult {
  const errors: ConfigValidationError[] = [];
  const masterIds = new Set(features.map(f => f.id));
  const entries = table.list();
  const entryIds = new Set(entries.map(e => e.id));

  // 1. Cycle detection — run once on the parent graph; surface every
  //    config that participates in any cycle.
  const graph = new Map<string, readonly string[]>();
  for (const e of entries) {
    graph.set(e.id, e.parentId !== undefined ? [e.parentId] : []);
  }
  const { cycles } = findAllCycles(graph);
  const cycleMembers = new Set<string>();
  for (const cyc of cycles) {
    for (const id of cyc) cycleMembers.add(id);
  }
  for (const id of cycleMembers) {
    errors.push({
      configId: id,
      kind: 'parent_cycle',
      detail: `parent chain participates in cycle: ${describeCycle(cycles, id)}`,
    });
  }

  // 2. Per-config checks: unknown parent, unknown feature, undefined var.
  for (const e of entries) {
    if (e.parentId !== undefined && !entryIds.has(e.parentId)) {
      errors.push({
        configId: e.id,
        kind: 'unknown_parent',
        detail: `parentId="${e.parentId}" not in table`,
      });
    }

    for (const featureId of Object.keys(e.overrides)) {
      if (!masterIds.has(featureId)) {
        errors.push({
          configId: e.id,
          kind: 'unknown_feature',
          detail: `override targets featureId="${featureId}" not in master tree`,
        });
      }
    }

    // Skip undefined-var checks if this config sits in a cycle —
    // its scope is uncertain and the cycle error already flagged it.
    if (cycleMembers.has(e.id)) continue;
    const scope = buildScope(table, e);

    // a) expressionVars themselves (each value, if string, references in scope)
    for (const [varName, value] of Object.entries(e.expressionVars)) {
      if (typeof value !== 'string') continue;
      for (const ref of extractIdentifiers(value)) {
        if (ref === varName) continue;  // self-ref handled by expr-cycle (A3)
        if (!isInScope(ref, scope)) {
          errors.push({
            configId: e.id,
            kind: 'undefined_var',
            detail: `expressionVars["${varName}"] references undefined "${ref}"`,
          });
        }
      }
    }

    // b) per-feature param overrides — string values check against scope
    for (const [featureId, slot] of Object.entries(e.overrides)) {
      if (!slot.params) continue;
      for (const [paramKey, value] of Object.entries(slot.params)) {
        if (typeof value !== 'string') continue;
        for (const ref of extractIdentifiers(value)) {
          if (!isInScope(ref, scope)) {
            errors.push({
              configId: e.id,
              kind: 'undefined_var',
              detail: `overrides["${featureId}"].params["${paramKey}"] references undefined "${ref}"`,
            });
          }
        }
      }
    }
  }

  if (errors.length === 0) return { ok: true };
  return { ok: false, errors };
}

/** Find the cycle that contains `id` and render it for the detail
 *  message. Falls back to `id` alone when no match (defensive). */
function describeCycle(cycles: readonly (readonly string[])[], id: string): string {
  for (const cyc of cycles) {
    if (cyc.includes(id)) return cyc.join(' → ');
  }
  /* c8 ignore next */
  return id;
}
