#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalTextBytes } from './canonical-evidence-bytes.mjs';

export const IDENTITY_SCHEMA = 'nexyfab.kernel-stack-identity.v1';
export const OUTPUT_REL = 'docs/evidence/cad-independent/kernel-stack-identity.json';

const PACKAGES = [
  { name: 'replicad', role: 'authoring-part-brep' },
  { name: 'replicad-opencascadejs', role: 'authoring-occt-wasm-binding' },
  { name: 'opencascade.js', role: 'worker-modeling-and-xcaf-export' },
  { name: 'occt-import-js', role: 'isolated-step-import-verification' },
];

const ARTIFACTS = [
  { path: 'public/replicad_single.wasm', role: 'generated-part-brep-kernel', minimumBytes: 1_000_000 },
  { path: 'public/occt-worker/opencascade.wasm', role: 'generated-worker-brep-xcaf-kernel', minimumBytes: 1_000_000 },
  { path: 'public/occt-import-js.wasm', role: 'verified-step-import-kernel', minimumBytes: 1_000_000 },
  { path: 'public/occt-worker/opencascade.js', role: 'generated-worker-loader', minimumBytes: 1_000 },
  { path: 'public/occt-worker/occt-worker-real.js', role: 'generated-worker-dispatch-policy', minimumBytes: 1_000 },
  { path: 'public/occt-worker/occt-worker-commercial.js', role: 'commercial-no-fallback-launcher', minimumBytes: 100 },
];

const POLICIES = [
  'src/app/[lang]/shape-generator/features/occtEngine.ts',
  'src/lib/occt/nodeOcctBridge.ts',
  'src/lib/occt/serverReplicad.ts',
  'src/lib/occt/planExecutor.ts',
  'src/lib/drawing/replicadExactProjection.ts',
  'src/lib/drawing/occtHlrDxf.ts',
  'src/lib/cad/sampledCircle.ts',
  'src/lib/ai/design-driver/exactCadGate.ts',
  'src/lib/ai/design-driver/exactDrawingGate.ts',
  'src/lib/ai/design-driver/manufacturingDrawingGate.ts',
  'src/lib/ai/design-driver/workspaceCandidate.ts',
  'src/lib/assembly/featureTreePreciseInterference.ts',
  'src/lib/assembly/motionStudy.ts',
  'src/lib/occt/nodeOcctLoader.ts',
  'src/app/api/cad/v1/assembly/verify/route.ts',
  'src/app/api/cad/v1/assembly/release/verify/route.ts',
  'src/app/api/nexyfab/design-brief/route.ts',
  'src/app/api/nexyfab/design-brief/runner.ts',
  'src/lib/reference/xcafAssemblyRoundtripEvidence.ts',
  'src/lib/reference/partStepRoundtripEvidence.ts',
  'src/lib/evidence/nexyFabKernelEvidence.ts',
  'src/app/[lang]/shape-generator/io/nfabRevisionManifest.ts',
  'src/lib/cad-independent-release-audit-v2.ts',
  'src/app/[lang]/shape-generator/io/manufacturingPackage.ts',
  'src/lib/ai/robot/robotPostIntegrationEvidence.ts',
  'src/lib/ai/robot/robotCoordinatedMotion.ts',
  'src/lib/ai/robot/robotEvidenceBundle.ts',
  'src/lib/ai/adaptiveComplexProductExecution.ts',
  'src/lib/ai/productDecompositionAccuracy.ts',
  'src/lib/ai/productDecomposition.ts',
  'src/lib/ai/multiStageRefinement.ts',
  'src/lib/ai/referenceGuidedRefinement.ts',
  'src/app/api/cad/v1/generation/refine/handler.ts',
  'src/lib/ai/robot/robotReleaseEvidenceAuditV2.ts',
  'src/lib/ai/robot/robotReleaseEvidenceAudit.ts',
  'src/lib/ai/robot/robotReleaseWorkPacketV2.ts',
  'src/lib/ai/robot/robotReleaseWorkPacket.ts',
  'src/lib/ai/robot/robotFinalReleaseReview.ts',
  'src/app/api/cad/v1/robot/release/audit/route.ts',
  'src/app/api/cad/v1/robot/release/work-packet/route.ts',
  'src/app/api/cad/v1/robot/release/final-review/route.ts',
  'src/app/api/cad/v1/robot/generate/route.ts',
  'src/app/api/cad/v1/robot/reverify/route.ts',
  'src/app/api/cad/v1/generation/state/route.ts',
  'src/app/api/cad/v1/generation/advance/route.ts',
  'src/app/api/cad/v1/generation/finalize/route.ts',
  'src/app/[lang]/shape-generator/ai/generationSessionClient.ts',
  'src/app/[lang]/shape-generator/_shell/CadWorkflowRail.tsx',
  'src/app/[lang]/shape-generator/_shell/ModelerShell.tsx',
  'src/app/[lang]/shape-generator/ShapeGeneratorClientPage.tsx',
  'src/app/[lang]/studio/StudioInner.tsx',
  'src/app/[lang]/studio/emitScadFromProgram.ts',
  'src/app/[lang]/shape-generator/assembly/RobotPrecisionHandoffPanel.tsx',
  'scripts/build-complex-product-scope-assessment.mjs',
  'scripts/build-ai-robot6axis-demonstrator.ts',
  'scripts/audit-robot-production-completion.mjs',
  'docs/evidence/cad-independent/complex-product-scope-assessment.json',
  'middleware.ts',
  'src/lib/auth-middleware.ts',
  'src/lib/rate-limit.ts',
  'src/lib/commercial-readiness.ts',
  'src/app/api/docs/openapi/route.ts',
  'scripts/generate-third-party-notices.mjs',
  'scripts/canonical-evidence-bytes.mjs',
  'docs/legal/license-overrides.json',
  'src/content/third-party-notices.generated.json',
  'scripts/check-occt-readiness.js',
];

function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function readPackageVersion(lock, name) {
  const entry = lock.packages?.[`node_modules/${name}`];
  if (!entry || typeof entry.version !== 'string') throw new Error(`KERNEL_IDENTITY_PACKAGE_MISSING:${name}`);
  return entry.version;
}

function fileEvidence(root, spec) {
  const absolute = path.join(root, ...spec.path.split('/'));
  if (!fs.existsSync(absolute)) throw new Error(`KERNEL_IDENTITY_FILE_MISSING:${spec.path}`);
  const rawBytes = fs.readFileSync(absolute);
  const bytes = path.extname(spec.path).toLowerCase() === '.wasm'
    ? rawBytes
    : canonicalTextBytes(rawBytes);
  if (bytes.byteLength < spec.minimumBytes) throw new Error(`KERNEL_IDENTITY_FILE_TOO_SMALL:${spec.path}:${bytes.byteLength}`);
  return { path: spec.path, role: spec.role, bytes: bytes.byteLength, sha256: sha256(bytes) };
}

export function buildKernelStackIdentity(root) {
  const lockBytes = canonicalTextBytes(fs.readFileSync(path.join(root, 'package-lock.json')));
  const lock = JSON.parse(lockBytes.toString('utf8'));
  const identity = {
    schema: IDENTITY_SCHEMA,
    platformContract: {
      externalCadRequired: false,
      commercialKernelMode: 'wasm-only-no-stub',
      projectSourceOfTruth: '.nfab-v3',
      lengthUnit: 'mm',
      generalUserExperience: 'ai-guided-precision',
      expertExperience: 'optional-direct-precision-editing',
    },
    dependencyLock: { path: 'package-lock.json', sha256: sha256(lockBytes) },
    components: PACKAGES.map(item => ({ ...item, version: readPackageVersion(lock, item.name) })),
    artifacts: ARTIFACTS.map(item => fileEvidence(root, item)),
    policies: POLICIES.map(file => fileEvidence(root, { path: file, role: 'semantic-and-release-policy', minimumBytes: 1 })),
  };
  return { ...identity, identitySha256: sha256(stable(identity)) };
}

export function renderKernelStackIdentity(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function checkOrWriteKernelStackIdentity({ root, write }) {
  const output = path.join(root, ...OUTPUT_REL.split('/'));
  const rendered = renderKernelStackIdentity(buildKernelStackIdentity(root));
  if (write) {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, rendered);
    return { ok: true, output: OUTPUT_REL };
  }
  const current = fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : '';
  return { ok: current === rendered, output: OUTPUT_REL, error: current === rendered ? null : 'KERNEL_STACK_IDENTITY_STALE' };
}

function main() {
  const write = process.argv.includes('--write');
  const result = checkOrWriteKernelStackIdentity({ root: process.cwd(), write });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
