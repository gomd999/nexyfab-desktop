/**
 * configurations — Phase 2.6.4 of NexyFab Pro own-CAD (ADR-013).
 *
 * Design configurations (a.k.a. variants / part families) layered on top of
 * featureTree.ts. A single FeatureTree describes one parametric body; a
 * `Configuration` is a named overlay that, when applied, produces a derived
 * tree with some nodes suppressed and some numeric payload fields overridden.
 *
 * This is the "linked instances / configurations" item that featureTree.ts
 * explicitly deferred (see its "Out of scope" note). The overlay is pure and
 * non-destructive: applying a configuration never mutates the source tree, so
 * the same master tree can drive many variants (e.g. a bracket family with
 * 3 hole counts and 2 thicknesses) without copy-pasting history.
 *
 * Scope (Phase 2.6.4 minimal):
 *   - Suppress a set of node ids.
 *   - Override numeric payload fields per node (shallow merge into payload).
 *   - One "active" configuration per set, resolvable to a concrete tree.
 *
 * Out of scope (later):
 *   - Non-numeric overrides (strings / enums / nested objects).
 *   - Per-configuration node insertion (add features only in a variant).
 *   - Configuration-driven assembly instancing.
 */

import type { FeatureNode, FeatureTree } from './featureTree';

// ─── model ──────────────────────────────────────────────────────────────────

export interface Configuration {
  /** Unique, non-empty name within a ConfigurationSet. */
  name: string;
  /** Node ids to suppress in this variant. */
  suppress?: ReadonlyArray<string>;
  /**
   * Per-node numeric payload overrides: nodeId -> { payloadField: value }.
   * Only numeric fields are supported; merged shallowly into the node's
   * existing payload.
   */
  paramOverrides?: Record<string, Record<string, number>>;
}

export interface ConfigurationSet {
  /** Name of the configuration to resolve by default. Must exist in configs. */
  active: string;
  configs: ReadonlyArray<Configuration>;
}

// ─── validation ───────────────────────────────────────────────────────────

export interface ValidationResult {
  ok: boolean;
  errors: ReadonlyArray<string>;
}

/**
 * Validate a configuration set against a tree:
 *   - every config name is non-empty and unique;
 *   - `active` names an existing config;
 *   - every suppressed node id exists in the tree;
 *   - every override target node id exists in the tree.
 *
 * Returns a typed result (does not throw) so the editor can surface all
 * problems at once. `apply` is permissive (it ignores unknown ids), so this
 * validator is the gate that catches authoring mistakes.
 */
export function validateConfigurationSet(
  tree: FeatureTree,
  set: ConfigurationSet,
): ValidationResult {
  const errors: string[] = [];
  const ids = new Set(tree.nodes.map((n) => n.id));
  const seenNames = new Set<string>();

  for (const config of set.configs) {
    if (!config.name) {
      errors.push('configuration has empty name');
    } else if (seenNames.has(config.name)) {
      errors.push(`duplicate configuration name: ${config.name}`);
    } else {
      seenNames.add(config.name);
    }

    for (const nodeId of config.suppress ?? []) {
      if (!ids.has(nodeId)) {
        errors.push(
          `config ${config.name || '(unnamed)'} suppresses unknown node id: ${nodeId}`,
        );
      }
    }

    for (const nodeId of Object.keys(config.paramOverrides ?? {})) {
      if (!ids.has(nodeId)) {
        errors.push(
          `config ${config.name || '(unnamed)'} overrides unknown node id: ${nodeId}`,
        );
      }
    }
  }

  if (!set.active) {
    errors.push('active configuration name is empty');
  } else if (!seenNames.has(set.active)) {
    errors.push(`active configuration ${set.active} does not exist`);
  }

  return { ok: errors.length === 0, errors };
}

// ─── apply ────────────────────────────────────────────────────────────────

/**
 * Apply a configuration to a tree, returning a NEW tree. The source tree and
 * its nodes/payloads are never mutated.
 *
 * For each node:
 *   - if its id is in `config.suppress`, the returned node has `suppressed: true`;
 *   - if its id has numeric overrides, those fields are shallow-merged into a
 *     COPY of the payload.
 *
 * Unknown node ids in the config (in `suppress` or `paramOverrides`) are
 * ignored here — `validateConfigurationSet` is the gate for authoring errors.
 */
export function applyConfiguration(
  tree: FeatureTree,
  config: Configuration,
): FeatureTree {
  const suppressSet = new Set(config.suppress ?? []);
  const overrides = config.paramOverrides ?? {};

  const nodes: FeatureNode[] = tree.nodes.map((node) => {
    const shouldSuppress = suppressSet.has(node.id);
    const nodeOverrides = overrides[node.id];

    if (!shouldSuppress && !nodeOverrides) {
      return node;
    }

    let next: FeatureNode = node;

    if (nodeOverrides) {
      next = {
        ...next,
        payload: { ...next.payload, ...nodeOverrides },
      };
    }

    if (shouldSuppress) {
      next = { ...next, suppressed: true };
    }

    return next;
  });

  return { nodes };
}

/**
 * Resolve the active configuration of a set into a concrete tree.
 * Throws if the active configuration cannot be found (call
 * `validateConfigurationSet` first to avoid this).
 */
export function resolveActive(
  tree: FeatureTree,
  set: ConfigurationSet,
): FeatureTree {
  const active = set.configs.find((c) => c.name === set.active);
  if (!active) {
    throw new Error(`resolveActive: active configuration ${set.active} not found`);
  }
  return applyConfiguration(tree, active);
}
