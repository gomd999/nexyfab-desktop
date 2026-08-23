import 'server-only';

import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';

import { ARCHITECTURE_INTERIOR_GOLDEN_SCENARIOS } from './architectureInteriorGoldenScenarios';

export const ARCHITECTURE_INTERIOR_GOLDEN_SOURCE_DEFAULT_MAX_FILE_BYTES = 64 * 1024 * 1024;
export const ARCHITECTURE_INTERIOR_GOLDEN_SOURCE_DEFAULT_MAX_TOTAL_BYTES = 256 * 1024 * 1024;

const SHA256 = /^[a-f0-9]{64}$/;

/** A source binding is deliberately explicit: no locator or scenario metadata is inferred. */
export interface ArchitectureInteriorGoldenSourcePathBinding {
  sourcePath: string;
  bytes?: number;
  sha256?: string;
  /** Supported aliases for callers that use the word "declared" in their receipt schema. */
  declaredBytes?: number;
  declaredSha256?: string;
}

export type ArchitectureInteriorGoldenSourceBinding = string | ArchitectureInteriorGoldenSourcePathBinding;

export type ArchitectureInteriorGoldenSourceBindings = Readonly<
  Record<string, Readonly<Record<string, ArchitectureInteriorGoldenSourceBinding>>>
>;

export interface ResolveArchitectureInteriorGoldenSourcesInput {
  approvedRoots: readonly string[];
  sources: ArchitectureInteriorGoldenSourceBindings;
  maxFileBytes?: number;
  maxTotalBytes?: number;
}

export interface ArchitectureInteriorGoldenSourceArtifact {
  scenarioId: string;
  inputId: string;
  sourcePath: string;
  realPath: string;
  bytes: number;
  sha256: string;
}

export interface ResolveArchitectureInteriorGoldenSourcesSuccess {
  ok: true;
  inputSourceHashes: Record<string, Record<string, string>>;
  artifacts: ArchitectureInteriorGoldenSourceArtifact[];
}

export interface ResolveArchitectureInteriorGoldenSourcesFailure {
  ok: false;
  issues: string[];
}

export type ResolveArchitectureInteriorGoldenSourcesResult =
  | ResolveArchitectureInteriorGoldenSourcesSuccess
  | ResolveArchitectureInteriorGoldenSourcesFailure;

interface ResolvedRoot {
  requestedPath: string;
  realPath: string;
}

function issue(issues: string[], value: string): void {
  if (!issues.includes(value)) issues.push(value);
}

function isSafeCap(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function ownKeys(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.keys(value as Record<string, unknown>);
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function comparablePath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function hasTraversalSegment(sourcePath: string): boolean {
  return sourcePath.split(/[\\/]+/u).some(segment => segment === '..');
}

function bindingParts(binding: ArchitectureInteriorGoldenSourceBinding): {
  sourcePath: unknown;
  declaredBytes: unknown;
  declaredSha256: unknown;
} {
  if (typeof binding === 'string') return { sourcePath: binding, declaredBytes: undefined, declaredSha256: undefined };
  if (!binding || typeof binding !== 'object' || Array.isArray(binding)) return { sourcePath: undefined, declaredBytes: undefined, declaredSha256: undefined };
  return {
    sourcePath: binding.sourcePath,
    declaredBytes: binding.bytes ?? binding.declaredBytes,
    declaredSha256: binding.sha256 ?? binding.declaredSha256,
  };
}

function resolveRoots(approvedRoots: unknown, issues: string[]): ResolvedRoot[] {
  if (!Array.isArray(approvedRoots) || approvedRoots.length === 0) {
    issue(issues, 'approved_roots_required');
    return [];
  }
  if (approvedRoots.length > 32) {
    issue(issues, 'approved_roots_limit_exceeded');
    return [];
  }

  const roots: ResolvedRoot[] = [];
  for (const requested of approvedRoots) {
    if (typeof requested !== 'string' || !requested.trim()) {
      issue(issues, 'approved_root_invalid');
      continue;
    }
    const absolute = path.resolve(requested);
    try {
      const listed = lstatSync(absolute);
      if (listed.isSymbolicLink()) {
        issue(issues, `approved_root_symlink:${requested}`);
        continue;
      }
      if (!listed.isDirectory()) {
        issue(issues, `approved_root_not_directory:${requested}`);
        continue;
      }
      const realPath = realpathSync.native(absolute);
      // This also catches a junction or an ancestor link when lstat on the
      // requested root itself reports a directory rather than a symlink.
      if (comparablePath(realPath) !== comparablePath(absolute)) {
        issue(issues, `approved_root_symlink:${requested}`);
        continue;
      }
      roots.push({ requestedPath: requested, realPath });
    } catch {
      issue(issues, `approved_root_unreadable:${requested}`);
    }
  }

  roots.sort((left, right) => left.realPath.localeCompare(right.realPath));
  const seen = new Set<string>();
  for (const root of roots) {
    if (seen.has(root.realPath)) issue(issues, `approved_root_duplicate_realpath:${root.realPath}`);
    seen.add(root.realPath);
  }
  return roots;
}

function inspectPath(root: ResolvedRoot, sourcePath: string, issues: string[], scenarioId: string, inputId: string): string | null {
  if (!sourcePath.trim() || sourcePath.includes('\0')) {
    issue(issues, `source_path_invalid:${scenarioId}:${inputId}`);
    return null;
  }
  if (hasTraversalSegment(sourcePath)) {
    issue(issues, `source_path_traversal:${scenarioId}:${inputId}`);
    return null;
  }

  const candidate = path.isAbsolute(sourcePath) ? path.resolve(sourcePath) : path.resolve(root.realPath, sourcePath);
  if (!isWithin(root.realPath, candidate)) {
    return null;
  }

  try {
    // Check every path component. A realpath containment check alone is not enough:
    // a symlink that currently points inside the root must still be rejected.
    const relative = path.relative(root.realPath, candidate);
    let current = root.realPath;
    for (const segment of relative ? relative.split(path.sep) : []) {
      current = path.join(current, segment);
      const listed = lstatSync(current);
      if (listed.isSymbolicLink()) {
        issue(issues, `source_path_symlink:${scenarioId}:${inputId}`);
        return null;
      }
      if (comparablePath(realpathSync.native(current)) !== comparablePath(current)) {
        issue(issues, `source_path_symlink:${scenarioId}:${inputId}`);
        return null;
      }
    }

    const listed = lstatSync(candidate);
    if (!listed.isFile()) {
      issue(issues, `source_not_regular_file:${scenarioId}:${inputId}`);
      return null;
    }
    const realPath = realpathSync.native(candidate);
    if (!isWithin(root.realPath, realPath)) {
      issue(issues, `source_path_outside_root:${scenarioId}:${inputId}`);
      return null;
    }
    // statSync is intentionally after the lstat/realpath checks so a link cannot
    // bypass the regular-file and size checks.
    if (!statSync(candidate).isFile()) {
      issue(issues, `source_not_regular_file:${scenarioId}:${inputId}`);
      return null;
    }
    return realPath;
  } catch {
    return null;
  }
}

/**
 * Resolve and hash the complete golden input set from actual bytes.
 * This function intentionally returns no eligibility, licensing, or reviewer fields.
 */
export function resolveArchitectureInteriorGoldenCampaignSources(
  input: ResolveArchitectureInteriorGoldenSourcesInput,
): ResolveArchitectureInteriorGoldenSourcesResult {
  const issues: string[] = [];
  const maxFileBytes = input?.maxFileBytes ?? ARCHITECTURE_INTERIOR_GOLDEN_SOURCE_DEFAULT_MAX_FILE_BYTES;
  const maxTotalBytes = input?.maxTotalBytes ?? ARCHITECTURE_INTERIOR_GOLDEN_SOURCE_DEFAULT_MAX_TOTAL_BYTES;
  if (!isSafeCap(maxFileBytes)) issue(issues, 'max_file_bytes_invalid');
  if (!isSafeCap(maxTotalBytes)) issue(issues, 'max_total_bytes_invalid');
  const roots = resolveRoots(input?.approvedRoots, issues);
  const sources = input?.sources;
  if (!sources || typeof sources !== 'object' || Array.isArray(sources)) issue(issues, 'source_bindings_required');

  const expectedScenarios = ARCHITECTURE_INTERIOR_GOLDEN_SCENARIOS;
  const actualScenarioIds = ownKeys(sources);
  const expectedScenarioIds = expectedScenarios.map(scenario => scenario.id);
  for (const scenarioId of expectedScenarioIds) if (!actualScenarioIds.includes(scenarioId)) issue(issues, `scenario_missing:${scenarioId}`);
  for (const scenarioId of actualScenarioIds) if (!expectedScenarioIds.includes(scenarioId)) issue(issues, `scenario_extra:${scenarioId}`);

  const inputSourceHashes: Record<string, Record<string, string>> = {};
  const artifacts: ArchitectureInteriorGoldenSourceArtifact[] = [];
  const seenRealPaths = new Map<string, string>();
  let totalBytes = 0;

  for (const scenario of expectedScenarios) {
    const scenarioSources = (sources && typeof sources === 'object' && !Array.isArray(sources))
      ? (sources as Record<string, unknown>)[scenario.id]
      : undefined;
    const actualInputIds = ownKeys(scenarioSources);
    const expectedInputIds = scenario.authoritativeInputs.map(item => item.id);
    for (const inputId of expectedInputIds) if (!actualInputIds.includes(inputId)) issue(issues, `input_missing:${scenario.id}:${inputId}`);
    for (const inputId of actualInputIds) if (!expectedInputIds.includes(inputId)) issue(issues, `input_extra:${scenario.id}:${inputId}`);
    inputSourceHashes[scenario.id] = {};

    for (const expectedInput of scenario.authoritativeInputs) {
      const inputId = expectedInput.id;
      const rawBinding = scenarioSources && typeof scenarioSources === 'object' && !Array.isArray(scenarioSources)
        ? (scenarioSources as Record<string, ArchitectureInteriorGoldenSourceBinding>)[inputId]
        : undefined;
      const parts = bindingParts(rawBinding as ArchitectureInteriorGoldenSourceBinding);
      if (typeof parts.sourcePath !== 'string') {
        issue(issues, `source_path_required:${scenario.id}:${inputId}`);
        continue;
      }
      if (rawBinding && typeof rawBinding === 'object' && !Array.isArray(rawBinding)) {
        if (rawBinding.bytes !== undefined && rawBinding.declaredBytes !== undefined && rawBinding.bytes !== rawBinding.declaredBytes) issue(issues, `declared_bytes_ambiguous:${scenario.id}:${inputId}`);
        if (rawBinding.sha256 !== undefined && rawBinding.declaredSha256 !== undefined && rawBinding.sha256 !== rawBinding.declaredSha256) issue(issues, `declared_hash_ambiguous:${scenario.id}:${inputId}`);
      }
      if (parts.declaredBytes !== undefined && (typeof parts.declaredBytes !== 'number' || !Number.isSafeInteger(parts.declaredBytes) || parts.declaredBytes <= 0)) issue(issues, `declared_bytes_invalid:${scenario.id}:${inputId}`);
      if (parts.declaredSha256 !== undefined && (typeof parts.declaredSha256 !== 'string' || !SHA256.test(parts.declaredSha256))) issue(issues, `declared_hash_invalid:${scenario.id}:${inputId}`);

      let realPath: string | null = null;
      for (const root of roots) {
        const candidate = inspectPath(root, parts.sourcePath, issues, scenario.id, inputId);
        if (candidate) { realPath = candidate; break; }
      }
      if (!realPath) {
        const absoluteSource = path.isAbsolute(parts.sourcePath) ? path.resolve(parts.sourcePath) : null;
        if (absoluteSource && roots.length > 0 && !roots.some(root => isWithin(root.realPath, absoluteSource))) issue(issues, `source_path_outside_root:${scenario.id}:${inputId}`);
        else if (!issues.some(value => value.endsWith(`:${scenario.id}:${inputId}`))) issue(issues, `source_not_found:${scenario.id}:${inputId}`);
        continue;
      }
      const realPathKey = comparablePath(realPath);
      const prior = seenRealPaths.get(realPathKey);
      if (prior) issue(issues, `source_path_duplicate_realpath:${prior}:${scenario.id}:${inputId}`);
      else seenRealPaths.set(realPathKey, `${scenario.id}:${inputId}`);

      let size: number;
      try { size = statSync(realPath).size; } catch { issue(issues, `source_unreadable:${scenario.id}:${inputId}`); continue; }
      if (size > maxFileBytes) { issue(issues, `source_file_bytes_cap:${scenario.id}:${inputId}`); continue; }
      if (totalBytes + size > maxTotalBytes) { issue(issues, `source_total_bytes_cap:${scenario.id}:${inputId}`); continue; }
      let bytes: Buffer;
      try { bytes = readFileSync(realPath); } catch { issue(issues, `source_unreadable:${scenario.id}:${inputId}`); continue; }
      try {
        const postRead = lstatSync(realPath);
        const postReadRealPath = realpathSync.native(realPath);
        if (postRead.isSymbolicLink() || !postRead.isFile() || postRead.size !== bytes.byteLength || comparablePath(postReadRealPath) !== comparablePath(realPath) || !roots.some(root => isWithin(root.realPath, postReadRealPath))) {
          issue(issues, `source_changed_during_read:${scenario.id}:${inputId}`);
          continue;
        }
      } catch { issue(issues, `source_changed_during_read:${scenario.id}:${inputId}`); continue; }
      // Re-check after reading as a file may have changed between stat and read.
      if (bytes.byteLength > maxFileBytes) { issue(issues, `source_file_bytes_cap:${scenario.id}:${inputId}`); continue; }
      if (totalBytes + bytes.byteLength > maxTotalBytes) { issue(issues, `source_total_bytes_cap:${scenario.id}:${inputId}`); continue; }
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      totalBytes += bytes.byteLength;
      if (parts.declaredBytes !== undefined && parts.declaredBytes !== bytes.byteLength) issue(issues, `declared_bytes_mismatch:${scenario.id}:${inputId}`);
      if (typeof parts.declaredSha256 === 'string' && SHA256.test(parts.declaredSha256) && parts.declaredSha256 !== sha256) issue(issues, `declared_hash_mismatch:${scenario.id}:${inputId}`);
      inputSourceHashes[scenario.id][inputId] = sha256;
      artifacts.push({ scenarioId: scenario.id, inputId, sourcePath: parts.sourcePath, realPath, bytes: bytes.byteLength, sha256 });
    }
  }

  if (issues.length) return { ok: false, issues };
  return { ok: true, inputSourceHashes, artifacts };
}

export const resolveArchitectureInteriorGoldenSourceBindings = resolveArchitectureInteriorGoldenCampaignSources;
