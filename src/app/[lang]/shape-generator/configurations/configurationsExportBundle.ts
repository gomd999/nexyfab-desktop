/**
 * configurationsExportBundle.ts — C7 from NEXT_STEPS_PLAN_2026-05-29.md.
 *
 * "Export all configurations" — bundles per-config STEP files (and
 * optional per-config drawings) into a single zip the user can hand
 * to a vendor as a configuration release. Mirrors the same
 * `fflate.zipSync` pattern as `io/manufacturingPackage.ts` so the
 * download size + Windows zip compat behavior is consistent across
 * the app.
 *
 * Design choices:
 *   - The bundler doesn't resolve configurations itself — that needs
 *     the parametric pipeline + ConfigStore which the host owns.
 *     The host passes a `resolveConfigGeometry(configId)` callback
 *     that returns the geometry (already resolved with that config's
 *     overrides applied).
 *   - Per-config drawings are optional. When provided, each drawing's
 *     SVG bytes are dropped alongside the STEP file under the same
 *     config name.
 *   - A `manifest.json` is included at the zip root with config →
 *     filename mapping + timestamps + author tag so vendors can audit
 *     which configurations are in the bundle.
 *
 * Failure handling:
 *   - Per-config export errors don't abort the bundle. Instead they
 *     land in a `diagnostics` array on the result; the bundle still
 *     ships every config that succeeded. The manifest tags failed
 *     configs with `status: 'failed'`.
 */

import { strToU8, zipSync } from 'fflate';
import type * as THREE from 'three';
import type { ConfigEntry } from './types';

export interface BundleConfigInput {
  /** Stable config id matching ConfigEntry.id. */
  readonly id: string;
  /** Display name used as the zip folder slug + STEP filename. */
  readonly name: string;
  /** Optional pre-rendered drawing SVG bytes for this config. */
  readonly drawingSvg?: string;
}

export interface BundleManifestEntry {
  readonly configId: string;
  readonly configName: string;
  readonly status: 'ok' | 'failed';
  /** Zip-relative path to the STEP file (when status='ok'). */
  readonly stepPath?: string;
  /** Zip-relative path to the drawing SVG (when supplied + ok). */
  readonly drawingPath?: string;
  /** Failure reason when status='failed'. */
  readonly failureReason?: string;
}

export interface BundleManifest {
  readonly partName: string;
  readonly generatedAt: string;
  readonly generator: string;
  readonly configCount: number;
  readonly entries: readonly BundleManifestEntry[];
}

export interface BuildConfigurationsBundleOptions {
  /** Display name for the whole part — used in manifest + filename. */
  readonly partName: string;
  /** Configs to export. Order is preserved in the zip + manifest. */
  readonly configs: readonly BundleConfigInput[];
  /** Caller-provided STEP exporter — usually wraps exportToStepAsync
   *  with the config's resolved geometry. Return null to signal a
   *  per-config failure (the bundle keeps going). */
  readonly exportConfigStep: (configId: string) => Promise<string | null>;
  /** Optional tag added to the manifest's `generator` field. */
  readonly generatorTag?: string;
  /** Optional ISO timestamp injection for tests (defaults to now). */
  readonly nowIsoOverride?: string;
}

export interface ConfigurationsBundleResult {
  /** Zip bytes ready to feed to `downloadBlob`. */
  readonly zipBytes: Uint8Array;
  /** Same manifest that's inside the zip — useful for the UI to
   *  surface per-config status without re-parsing the zip. */
  readonly manifest: BundleManifest;
  /** Per-config diagnostics for failures (subset of manifest.entries
   *  where status='failed'). */
  readonly diagnostics: readonly BundleManifestEntry[];
}

/** Sanitize a config name into a filesystem-friendly slug. Same rule
 *  the existing exporters use (replace anything not [A-Za-z0-9._-] with _). */
function slug(name: string): string {
  const trimmed = (name || 'config').trim();
  return trimmed.replace(/[^\w.-]+/g, '_');
}

/**
 * Build a zip bundle with one STEP (+ optional drawing) per config.
 *
 * Throws ONLY when `configs` is empty — every other failure mode lands
 * in the manifest as `status: 'failed'` so the caller can ship the
 * partial bundle with diagnostics visible.
 */
export async function buildConfigurationsBundle(
  opts: BuildConfigurationsBundleOptions,
): Promise<ConfigurationsBundleResult> {
  if (opts.configs.length === 0) {
    throw new Error('buildConfigurationsBundle: configs is empty');
  }

  const partSlug = slug(opts.partName);
  const generatedAt = opts.nowIsoOverride ?? new Date().toISOString();
  const generator = opts.generatorTag ?? 'NexyFab configurations bundle v1';

  const entries: BundleManifestEntry[] = [];
  const fileMap: Record<string, Uint8Array> = {};

  for (const cfg of opts.configs) {
    const cfgSlug = slug(cfg.name);
    const folder = `${partSlug}/${cfgSlug}`;
    const stepRelPath = `${folder}/${cfgSlug}.step`;

    let stepText: string | null = null;
    try {
      stepText = await opts.exportConfigStep(cfg.id);
    } catch (err) {
      entries.push({
        configId: cfg.id,
        configName: cfg.name,
        status: 'failed',
        failureReason: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    if (!stepText) {
      entries.push({
        configId: cfg.id,
        configName: cfg.name,
        status: 'failed',
        failureReason: 'exportConfigStep returned null',
      });
      continue;
    }

    fileMap[stepRelPath] = strToU8(stepText);

    let drawingRelPath: string | undefined;
    if (cfg.drawingSvg && cfg.drawingSvg.length > 0) {
      drawingRelPath = `${folder}/${cfgSlug}.svg`;
      fileMap[drawingRelPath] = strToU8(cfg.drawingSvg);
    }

    entries.push({
      configId: cfg.id,
      configName: cfg.name,
      status: 'ok',
      stepPath: stepRelPath,
      drawingPath: drawingRelPath,
    });
  }

  const manifest: BundleManifest = {
    partName: opts.partName,
    generatedAt,
    generator,
    configCount: opts.configs.length,
    entries,
  };

  // Manifest at the zip root so vendors find it without descending.
  fileMap[`${partSlug}/manifest.json`] = strToU8(JSON.stringify(manifest, null, 2));

  const zipBytes = zipSync(fileMap);
  const diagnostics = entries.filter((e) => e.status === 'failed');

  return { zipBytes, manifest, diagnostics };
}

/** Convenience: turn a ConfigurationTable's ConfigEntry list into
 *  BundleConfigInput shape (id + name only). Caller supplies drawings
 *  separately when available. */
export function bundleInputsFromConfigEntries(
  configs: readonly ConfigEntry[],
  drawingByConfigId?: Readonly<Record<string, string | undefined>>,
): BundleConfigInput[] {
  return configs.map((c) => ({
    id: c.id,
    name: c.name,
    drawingSvg: drawingByConfigId?.[c.id],
  }));
}

/** Same shape as `_ unused THREE marker` so the import isn't tree-shaken
 *  from the typings layer (caller's exportConfigStep typically closes
 *  over a THREE.BufferGeometry resolver). */
export type _CallerOwnsGeometry = THREE.BufferGeometry;
