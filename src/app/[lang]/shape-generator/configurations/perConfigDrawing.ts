/**
 * perConfigDrawing.ts — bridges per-config geometry resolution with the
 * auto-drawing pipeline so that `BundleConfigInput.drawingSvg` (consumed
 * by `configurationsExportBundle.ts`) can be filled in one pass.
 *
 * Why this lives here (not in `analysis/`):
 *   - The drawing pipeline (`generateDrawing` + `buildDrawingSvgString`)
 *     is pure per-geometry — it doesn't know anything about
 *     configurations / overrides.
 *   - The configurations layer knows how to resolve a config id to a
 *     `THREE.BufferGeometry` via the caller's host (ConfigStore +
 *     parametric pipeline), but it shouldn't pull the drawing code
 *     into its own analysis module.
 *   - This helper sits between the two: caller hands us a list of
 *     configs + a `resolveGeometry` callback; we return a config-id →
 *     SVG map ready to plug into `BundleConfigInput.drawingSvg`.
 *
 * Failure handling mirrors `buildConfigurationsBundle`: per-config
 * errors land in `diagnostics`; the rest of the configs still get
 * their SVGs. Failed configs map to `null` in `drawingsByConfigId`
 * so the caller can distinguish "not generated" from "missing key".
 */

import type * as THREE from 'three';
import {
  generateDrawing,
  type DrawingConfig,
} from '../analysis/autoDrawing';
import { buildDrawingSvgString } from '../analysis/drawingExport';

export interface PerConfigDrawingOptions {
  /** Configs to generate drawings for. Order is preserved in
   *  `drawingsByConfigId` insertion order. */
  readonly configs: readonly { id: string; name: string }[];
  /** Per-config geometry resolver. Caller's host applies overrides
   *  and produces the resolved BufferGeometry. Returns null when
   *  the geometry can't be resolved (e.g. config validation failed). */
  readonly resolveGeometry: (configId: string) => THREE.BufferGeometry | null;
  /** Drawing config template — the bridge clones it per config and
   *  overrides titleBlock.partName with the config name. */
  readonly drawingConfigTemplate: DrawingConfig;
}

export interface PerConfigDrawingDiagnostic {
  readonly configId: string;
  readonly reason: string;
}

export interface PerConfigDrawingResult {
  /** configId → SVG string (success) or null (failure). */
  readonly drawingsByConfigId: Readonly<Record<string, string | null>>;
  /** Failures: configId + reason. */
  readonly diagnostics: ReadonlyArray<PerConfigDrawingDiagnostic>;
}

/**
 * Generate a per-config drawing SVG for each config in `opts.configs`.
 *
 * Pure (no React, no IO). Synchronous loop — if any future caller
 * needs async geometry resolution, add a sibling Promise.all variant
 * rather than changing this signature.
 *
 * Result usage:
 *   const { drawingsByConfigId } = generateDrawingsForConfigs(...);
 *   const inputs = bundleInputsFromConfigEntries(configs, drawingsByConfigId);
 *   await buildConfigurationsBundle({ ..., configs: inputs });
 */
export function generateDrawingsForConfigs(
  opts: PerConfigDrawingOptions,
): PerConfigDrawingResult {
  const drawingsByConfigId: Record<string, string | null> = {};
  const diagnostics: PerConfigDrawingDiagnostic[] = [];

  for (const cfg of opts.configs) {
    let geometry: THREE.BufferGeometry | null;
    try {
      geometry = opts.resolveGeometry(cfg.id);
    } catch (err) {
      drawingsByConfigId[cfg.id] = null;
      diagnostics.push({
        configId: cfg.id,
        reason: `resolveGeometry threw: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }

    if (!geometry) {
      drawingsByConfigId[cfg.id] = null;
      diagnostics.push({
        configId: cfg.id,
        reason: 'resolveGeometry returned null',
      });
      continue;
    }

    // Clone the template and override the title block's partName with
    // the config name so each drawing identifies itself in the bundle.
    // Spread is enough — DrawingConfig members are primitives or arrays
    // we don't mutate here, and `titleBlock` is rewritten wholesale.
    const clonedConfig: DrawingConfig = {
      ...opts.drawingConfigTemplate,
      titleBlock: {
        ...opts.drawingConfigTemplate.titleBlock,
        partName: cfg.name,
      },
    };

    try {
      const drawing = generateDrawing(geometry, clonedConfig);
      const svg = buildDrawingSvgString(drawing);
      drawingsByConfigId[cfg.id] = svg;
    } catch (err) {
      drawingsByConfigId[cfg.id] = null;
      diagnostics.push({
        configId: cfg.id,
        reason: `drawing pipeline threw: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  return { drawingsByConfigId, diagnostics };
}
