#!/usr/bin/env tsx
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MECHANICAL_CORE_30_FEATURES,
  evaluateMechanicalCoreFeatureLocalClosedLoop,
  mechanicalCoreSelectionIdentityPayload,
  type MechanicalCoreFeatureId,
  type MechanicalCoreLocalAxisEvidenceV1,
  type MechanicalCoreLocalEvidenceBindingV1,
} from '../src/lib/ai/mechanicalCoreFeatureContract';

export const MECHANICAL_CORE_LOCAL_INVENTORY_SCHEMA =
  'nexyfab.mechanical-core-feature-implementation-inventory.v1' as const;
export const MECHANICAL_CORE_LOCAL_READINESS_SCHEMA =
  'nexyfab.mechanical-core-feature-local-readiness.v1' as const;

export interface MechanicalCoreLocalReadinessPaths {
  evidenceInput: string;
  assessmentOutput: string;
}

export const MECHANICAL_CORE_LOCAL_READINESS_PATHS: Readonly<MechanicalCoreLocalReadinessPaths> =
  Object.freeze({
    evidenceInput: 'docs/evidence/cad-independent/local/mechanical-core-feature-axis-evidence.json',
    assessmentOutput: 'docs/evidence/cad-independent/mechanical-core-feature-local-readiness-260813.json',
  });

/**
 * Source ownership for the commercial 30. Several sheet-metal operations are
 * deliberately implemented by one shared module; each feature is still listed
 * independently so removal of that module fails all affected inventory rows.
 */
export const MECHANICAL_CORE_IMPLEMENTATION_SOURCES: Readonly<
  Record<MechanicalCoreFeatureId, readonly string[]>
> = Object.freeze({
  hole: ['src/app/[lang]/shape-generator/features/hole.ts'],
  fillet: ['src/app/[lang]/shape-generator/features/fillet.ts'],
  chamfer: ['src/app/[lang]/shape-generator/features/chamfer.ts'],
  shell: ['src/app/[lang]/shape-generator/features/shell.ts'],
  rib: ['src/app/[lang]/shape-generator/features/rib.ts'],
  linearPattern: ['src/app/[lang]/shape-generator/features/linearPattern.ts'],
  circularPattern: ['src/app/[lang]/shape-generator/features/circularPattern.ts'],
  draft: ['src/app/[lang]/shape-generator/features/draft.ts'],
  scale: ['src/app/[lang]/shape-generator/features/scale.ts'],
  moveCopy: ['src/app/[lang]/shape-generator/features/moveCopy.ts'],
  variableFillet: ['src/app/[lang]/shape-generator/features/variableFillet.ts'],
  offsetFace: ['src/app/[lang]/shape-generator/features/offsetFace.ts'],
  thread: ['src/app/[lang]/shape-generator/features/thread.ts'],
  helix: ['src/app/[lang]/shape-generator/features/helix.ts'],
  bend: ['src/app/[lang]/shape-generator/features/sheetMetal.ts'],
  flange: ['src/app/[lang]/shape-generator/features/sheetMetal.ts'],
  hem: ['src/app/[lang]/shape-generator/features/sheetMetal.ts'],
  jog: ['src/app/[lang]/shape-generator/features/sheetMetal.ts'],
  tab: ['src/app/[lang]/shape-generator/features/tab.ts'],
  cut: ['src/app/[lang]/shape-generator/features/cut.ts'],
  bendRelief: ['src/app/[lang]/shape-generator/features/reliefCuts.ts'],
  cornerRelief: ['src/app/[lang]/shape-generator/features/reliefCuts.ts'],
  variableShell: ['src/app/[lang]/shape-generator/features/variableShell.ts'],
  sketchExtrude: [
    'src/app/[lang]/shape-generator/features/sketch.ts',
    'src/app/[lang]/shape-generator/features/pipelineManager.ts',
  ],
  revolve: ['src/app/[lang]/shape-generator/features/revolve.ts'],
  sweep: ['src/app/[lang]/shape-generator/features/sweep.ts'],
  loft: ['src/app/[lang]/shape-generator/features/loft.ts'],
  mirror: ['src/app/[lang]/shape-generator/features/mirror.ts'],
  boolean: ['src/app/[lang]/shape-generator/features/boolean.ts'],
  splitBody: ['src/app/[lang]/shape-generator/features/splitBody.ts'],
});

const FEATURE_INDEX = 'src/app/[lang]/shape-generator/features/index.ts';
const LOCAL_RUNTIME_SCRIPT = 'scripts/mechanical-core-feature-local-runtime.ts';
const SHA256 = /^[a-f0-9]{64}$/;
const render = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = (bytes: Uint8Array): string => crypto.createHash('sha256').update(bytes).digest('hex');
const slash = (value: string): string => value.replaceAll('\\', '/');

function resolveInside(root: string, relative: string): string {
  if (!relative || path.isAbsolute(relative) || slash(relative).split('/').includes('..')) {
    throw new Error(`MECHANICAL_LOCAL_PATH_INVALID:${relative}`);
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...slash(relative).split('/'));
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`MECHANICAL_LOCAL_PATH_ESCAPE:${relative}`);
  }
  return resolved;
}

function regularFile(root: string, relative: string): string | null {
  let absolute: string;
  try {
    absolute = resolveInside(root, relative);
  } catch {
    return null;
  }
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile() || fs.lstatSync(absolute).isSymbolicLink()) {
    return null;
  }
  const realRoot = fs.realpathSync(root);
  const real = fs.realpathSync(absolute);
  return real === realRoot || real.startsWith(`${realRoot}${path.sep}`) ? real : null;
}

function walkTests(root: string): string[] {
  const absolute = regularFile(root, FEATURE_INDEX);
  if (!absolute) return [];
  const testRoot = path.dirname(absolute);
  const paths: string[] = [];
  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const child = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (/\.test\.[cm]?[jt]sx?$/.test(entry.name)) {
        paths.push(slash(path.relative(root, child)));
      }
    }
  };
  walk(testRoot);
  return paths.sort();
}

export function buildMechanicalCoreImplementationInventory(root: string) {
  const indexPath = regularFile(root, FEATURE_INDEX);
  const indexText = indexPath ? fs.readFileSync(indexPath, 'utf8') : '';
  const runtimePath = regularFile(root, LOCAL_RUNTIME_SCRIPT);
  const runtimeText = runtimePath ? fs.readFileSync(runtimePath, 'utf8') : '';
  const tests = walkTests(root).map(relative => ({
    path: relative,
    text: fs.readFileSync(resolveInside(root, relative), 'utf8'),
  }));
  const records = MECHANICAL_CORE_30_FEATURES.map(feature => {
    const sourceFiles = MECHANICAL_CORE_IMPLEMENTATION_SOURCES[feature].map(relative => {
      const absolute = regularFile(root, relative);
      return {
        path: relative,
        exists: Boolean(absolute),
        sha256: absolute ? sha256(fs.readFileSync(absolute)) : null,
      };
    });
    const registryBinding = feature === 'sketchExtrude'
      ? indexText.includes("type === 'sketchExtrude'")
      : indexText.includes(`${feature}Feature`);
    const runtimeBinding = runtimeText.includes('MECHANICAL_CORE_RUNTIME_BUNDLE') && runtimeText.includes(feature);
    const token = new RegExp(`\\b${feature.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\b`);
    const candidateTests = tests
      .filter(item => token.test(item.text) || item.path.toLowerCase().includes(feature.toLowerCase()))
      .map(item => item.path);
    const wired = registryBinding && runtimeBinding && sourceFiles.every(item => item.exists && SHA256.test(item.sha256 ?? ''));
    return {
      feature,
      status: wired ? 'WIRED' : 'MISSING',
      runtimeBinding: feature === 'sketchExtrude' ? 'INLINE_PIPELINE' : 'FEATURE_MAP',
      registryBinding,
      localRuntimeBinding: runtimeBinding,
      sourceFiles,
      candidateTests,
      note: 'Candidate tests are discovery metadata only; they do not set any closed-loop axis to PASS.',
    };
  });
  return {
    schema: MECHANICAL_CORE_LOCAL_INVENTORY_SCHEMA,
    required: MECHANICAL_CORE_30_FEATURES.length,
    wired: records.filter(item => item.status === 'WIRED').length,
    missing: records.filter(item => item.status === 'MISSING').map(item => item.feature),
    records,
  };
}

function readEvidenceInput(root: string, relative: string): {
  value: MechanicalCoreLocalAxisEvidenceV1 | null;
  source: { path: string; sha256: string } | null;
  errors: string[];
} {
  const absolute = regularFile(root, relative);
  if (!absolute) return { value: null, source: null, errors: ['local_axis_evidence_missing'] };
  const bytes = fs.readFileSync(absolute);
  try {
    return {
      value: JSON.parse(bytes.toString('utf8')) as MechanicalCoreLocalAxisEvidenceV1,
      source: { path: relative, sha256: sha256(bytes) },
      errors: [],
    };
  } catch {
    return {
      value: null,
      source: { path: relative, sha256: sha256(bytes) },
      errors: ['local_axis_evidence_json_invalid'],
    };
  }
}

export function verifyMechanicalCoreLocalBinding(
  root: string,
  binding: MechanicalCoreLocalEvidenceBindingV1,
): boolean {
  if (!SHA256.test(binding.sha256)) return false;
  const absolute = regularFile(root, binding.path);
  if (!absolute) return false;
  const bytes = fs.readFileSync(absolute);
  return sha256(bytes) === binding.sha256
    && (binding.bytes === undefined || binding.bytes === bytes.byteLength);
}

export function buildMechanicalCoreFeatureLocalReadiness(
  root: string,
  paths: MechanicalCoreLocalReadinessPaths = MECHANICAL_CORE_LOCAL_READINESS_PATHS,
) {
  const evidence = readEvidenceInput(root, paths.evidenceInput);
  const implementation = buildMechanicalCoreImplementationInventory(root);
  const closedLoop = evaluateMechanicalCoreFeatureLocalClosedLoop(evidence.value, {
    verifyEvidenceBinding: binding => verifyMechanicalCoreLocalBinding(root, binding),
    verifySelectionIdentity: identity => sha256(Buffer.from(mechanicalCoreSelectionIdentityPayload(identity), 'utf8')) === identity.identitySha256,
  });
  const eligible = implementation.missing.length === 0 && evidence.errors.length === 0 && closedLoop.eligible;
  return {
    schema: MECHANICAL_CORE_LOCAL_READINESS_SCHEMA,
    assessedAt: evidence.value?.generatedAt ?? null,
    releaseChannel: 'mechanical-core-local',
    status: eligible ? 'LOCAL_CANDIDATE' : 'HOLD',
    eligible,
    claimBoundary: {
      localExecutionOnly: true,
      commercialReleaseApproved: false,
      externalCadValidated: false,
      candidateTestsCountAsAxisPass: false,
    },
    sourceEvidence: evidence.source,
    inputErrors: evidence.errors,
    implementation,
    closedLoop,
  };
}

export function writeMechanicalCoreFeatureLocalReadiness(
  root = process.cwd(),
  paths: MechanicalCoreLocalReadinessPaths = MECHANICAL_CORE_LOCAL_READINESS_PATHS,
) {
  const assessment = buildMechanicalCoreFeatureLocalReadiness(root, paths);
  const output = resolveInside(root, paths.assessmentOutput);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, render(assessment));
  return assessment;
}

export function checkMechanicalCoreFeatureLocalReadiness(
  root = process.cwd(),
  paths: MechanicalCoreLocalReadinessPaths = MECHANICAL_CORE_LOCAL_READINESS_PATHS,
) {
  const assessment = buildMechanicalCoreFeatureLocalReadiness(root, paths);
  const output = resolveInside(root, paths.assessmentOutput);
  const current = fs.existsSync(output) && fs.readFileSync(output, 'utf8') === render(assessment);
  return { current, eligible: assessment.eligible, assessment };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const write = process.argv.includes('--write');
  const requireComplete = process.argv.includes('--require-complete');
  const result = write
    ? writeMechanicalCoreFeatureLocalReadiness()
    : checkMechanicalCoreFeatureLocalReadiness();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  const current = write || ('current' in result && result.current);
  const eligible = result.eligible;
  process.exitCode = current && (!requireComplete || eligible) ? 0 : 1;
}
