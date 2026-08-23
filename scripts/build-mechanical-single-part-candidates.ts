#!/usr/bin/env tsx
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MECHANICAL_SINGLE_PART_CANDIDATE_RECEIPT_SCHEMA,
  MECHANICAL_SINGLE_PART_CANDIDATE_SCHEMA,
  evaluateMechanicalSinglePartSourceRuns,
  mechanicalSinglePartDimensionsMm,
} from '../src/lib/cad/mechanicalSinglePartCandidate';
import { detectStepUnits } from '../src/lib/brep-bridge/stepRead';
import {
  ensureOcctReady,
  getShape,
  occtImportStepText,
  occtProjectViews,
  occtRegisteredShapeEvidence,
  resetShapeRegistry,
} from '../src/app/[lang]/shape-generator/features/occtEngine';

const SOURCE_SCHEMA = 'nexyfab.mechanical-core-feature-local-axis-evidence.v1';
const RUNTIME_SCHEMA = 'nexyfab.mechanical-core-feature-local-runtime.v1';
const SHA256 = /^[a-f0-9]{64}$/;
const FEATURE_ID = /^[A-Za-z][A-Za-z0-9]{0,63}$/;
const TESS = Object.freeze({ tolerance: 0.05, angularTolerance: 0.1 });

export interface MechanicalSinglePartCandidatePaths {
  sourceReceipt: string;
  outputRoot: string;
  outputReceipt: string;
  outputReceiptSha256: string;
  verifierSources: readonly string[];
  verifierTests: readonly string[];
}

export const MECHANICAL_SINGLE_PART_CANDIDATE_PATHS: Readonly<MechanicalSinglePartCandidatePaths> =
  Object.freeze({
    sourceReceipt: 'docs/evidence/cad-independent/local/mechanical-core-feature-axis-evidence.json',
    outputRoot: 'docs/evidence/cad-independent/local/mechanical-single-part-candidates-260813',
    outputReceipt: 'docs/evidence/cad-independent/local/mechanical-single-part-candidates-260813/receipt.json',
    outputReceiptSha256: 'docs/evidence/cad-independent/local/mechanical-single-part-candidates-260813/receipt.sha256',
    verifierSources: [
      'src/lib/cad/mechanicalSinglePartCandidate.ts',
      'scripts/build-mechanical-single-part-candidates.ts',
    ],
    verifierTests: [
      'src/lib/cad/mechanicalSinglePartCandidate.test.ts',
      'scripts/build-mechanical-single-part-candidates.test.ts',
    ],
  });

interface EvidenceBinding {
  path: string;
  sha256: string;
  bytes?: number;
  assertionId?: string;
}

interface AxisRun {
  feature: string;
  axis: string;
  status: string;
  executedAt?: string;
  evidence?: EvidenceBinding[];
}

interface AxisReceipt {
  schema: string;
  generatedAt: string;
  designRevisionSha256: string;
  runs: AxisRun[];
}

type Bounds = [[number, number, number], [number, number, number]];
type ProjectedViews = NonNullable<ReturnType<typeof occtProjectViews>>;

export interface ExactCandidateInspection {
  unit: string;
  unitConfidence: string;
  solidCount: number;
  singleSolid: boolean;
  volumeMm3: number;
  boundsMm: Bounds;
  views: ProjectedViews;
  svg: string;
}

export interface MechanicalSinglePartExactInspector {
  inspect(feature: string, stepText: string): Promise<ExactCandidateInspection>;
}

export interface BuildMechanicalSinglePartCandidateOptions {
  write?: boolean;
  checkExisting?: boolean;
  expectedSourceReceiptSha256?: string;
  expectedDesignRevisionSha256?: string;
}

interface GeneratedFile {
  path: string;
  bytes: Buffer;
  sha256: string;
}

interface CandidateRecord {
  feature: string;
  candidateStatus: 'PASS' | 'NOT_RUN';
  reasons: string[];
  candidateManifest?: EvidenceBinding;
}

const slash = (value: string): string => value.replaceAll('\\', '/');
const render = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const hash = (bytes: Uint8Array | string): string =>
  crypto.createHash('sha256').update(bytes).digest('hex');

function resolveInside(root: string, relative: string): string {
  const normalized = slash(relative);
  if (!normalized || path.isAbsolute(relative) || normalized.split('/').includes('..')) {
    throw new Error(`SINGLE_PART_PATH_INVALID:${relative}`);
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...normalized.split('/'));
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`SINGLE_PART_PATH_ESCAPE:${relative}`);
  }
  return resolved;
}

function readRegularFile(root: string, relative: string): Buffer {
  const absolute = resolveInside(root, relative);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile() || fs.lstatSync(absolute).isSymbolicLink()) {
    throw new Error(`SINGLE_PART_FILE_MISSING:${relative}`);
  }
  const realRoot = fs.realpathSync(root);
  const real = fs.realpathSync(absolute);
  if (real !== realRoot && !real.startsWith(`${realRoot}${path.sep}`)) {
    throw new Error(`SINGLE_PART_FILE_OUTSIDE_ROOT:${relative}`);
  }
  return fs.readFileSync(real);
}

function parseJson(bytes: Buffer, code: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(bytes.toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not_object');
    return value as Record<string, unknown>;
  } catch {
    throw new Error(code);
  }
}

function parseSourceReceipt(bytes: Buffer): AxisReceipt {
  const value = parseJson(bytes, 'SINGLE_PART_SOURCE_JSON_INVALID');
  if (value.schema !== SOURCE_SCHEMA
    || typeof value.generatedAt !== 'string'
    || !Number.isFinite(Date.parse(value.generatedAt))
    || typeof value.designRevisionSha256 !== 'string'
    || !SHA256.test(value.designRevisionSha256)
    || !Array.isArray(value.runs)) {
    throw new Error('SINGLE_PART_SOURCE_CONTRACT_INVALID');
  }
  return value as unknown as AxisReceipt;
}

function readBoundArtifact(root: string, binding: EvidenceBinding): Buffer {
  if (!binding || typeof binding.path !== 'string' || typeof binding.sha256 !== 'string'
    || !SHA256.test(binding.sha256)) {
    throw new Error('source_binding_invalid');
  }
  const bytes = readRegularFile(root, binding.path);
  if (hash(bytes) !== binding.sha256) throw new Error(`source_binding_hash_mismatch:${binding.path}`);
  if (binding.bytes !== undefined && binding.bytes !== bytes.byteLength) {
    throw new Error(`source_binding_size_mismatch:${binding.path}`);
  }
  return bytes;
}

function findAssertion(runs: readonly AxisRun[], assertionId: string): EvidenceBinding {
  const matches = runs.flatMap(run => run.evidence ?? [])
    .filter(binding => binding.assertionId === assertionId);
  if (matches.length !== 1) throw new Error(`source_assertion_count:${assertionId}:${matches.length}`);
  return matches[0]!;
}

function requireRuntimeReport(
  bytes: Buffer,
  feature: string,
  axis: 'export' | 'drawing',
): Record<string, unknown> {
  const report = parseJson(bytes, `source_${axis}_report_invalid`);
  if (report.schema !== RUNTIME_SCHEMA || report.feature !== feature
    || report.axis !== axis || report.status !== 'PASS') {
    throw new Error(`source_${axis}_report_contract_invalid`);
  }
  return report;
}

function requireNfab(bytes: Buffer, feature: string): {
  version: number;
  createdAt: number;
  updatedAt: number;
  name: string;
} {
  const nfab = parseJson(bytes, 'source_nfab_invalid_json');
  const tree = nfab.tree as Record<string, unknown> | undefined;
  const nodes = tree?.nodes;
  if (nfab.magic !== 'nfab' || !Number.isInteger(nfab.version)
    || (nfab.version as number) < 1 || (nfab.version as number) > 3
    || typeof nfab.createdAt !== 'number' || !Number.isFinite(nfab.createdAt)
    || typeof nfab.updatedAt !== 'number' || !Number.isFinite(nfab.updatedAt)
    || typeof nfab.name !== 'string' || !Array.isArray(nodes) || nodes.length === 0
    || typeof tree?.rootId !== 'string' || typeof tree.activeNodeId !== 'string') {
    throw new Error('source_nfab_contract_invalid');
  }
  const active = nodes.find(node => node && typeof node === 'object'
    && (node as Record<string, unknown>).id === tree.activeNodeId) as Record<string, unknown> | undefined;
  if (!active || active.type !== 'feature' || active.featureType !== feature) {
    throw new Error('source_nfab_feature_revision_mismatch');
  }
  return {
    version: nfab.version as number,
    createdAt: nfab.createdAt,
    updatedAt: nfab.updatedAt,
    name: nfab.name,
  };
}

function requireBounds(value: unknown, code: string): Bounds {
  if (!Array.isArray(value) || value.length !== 2
    || value.some(row => !Array.isArray(row) || row.length !== 3
      || row.some(item => typeof item !== 'number' || !Number.isFinite(item)))) {
    throw new Error(code);
  }
  return value as Bounds;
}

function closeEnough(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(1e-7, Math.max(Math.abs(a), Math.abs(b)) * 1e-9);
}

function sameBounds(a: Bounds, b: Bounds): boolean {
  return a.flat().every((value, index) => closeEnough(value, b.flat()[index]!));
}

function drawingSvg(feature: string, views: ProjectedViews): string {
  const names = Object.keys(views).slice(0, 3);
  if (names.length !== 3) throw new Error('drawing_three_views_required');
  const panels = names.map((name, index) => {
    const view = views[name];
    if (!view || view.visible.length === 0 || !view.viewBox) throw new Error(`drawing_view_empty:${name}`);
    const visible = view.visible.map(d => `<path d="${d}" fill="none" stroke="#111827" stroke-width="0.55"/>`).join('');
    const hidden = view.hidden.map(d => `<path d="${d}" fill="none" stroke="#64748b" stroke-width="0.3" stroke-dasharray="2 1"/>`).join('');
    return `<g transform="translate(${index * 400} 0)"><text x="12" y="24" font-family="sans-serif" font-size="14">${name}</text><svg x="12" y="36" width="376" height="300" viewBox="${view.viewBox}">${hidden}${visible}</svg></g>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="350" viewBox="0 0 1200 350"><title>NexyFab exact OCCT HLR — ${feature}</title><rect width="1200" height="350" fill="white"/>${panels.join('')}</svg>\n`;
}

function projectThreeViews(handle: string, feature: string): ProjectedViews {
  const groups = [['front', 'back'], ['top', 'bottom'], ['right', 'left']] as const;
  const accepted: ProjectedViews = {};
  for (const group of groups) {
    let found = false;
    for (const name of group) {
      try {
        const view = occtProjectViews(handle, [name])?.[name];
        if (view?.visible.length && view.viewBox) {
          accepted[name] = view;
          found = true;
          break;
        }
      } catch {
        // Try the opposite orthographic direction before failing closed.
      }
    }
    if (!found) throw new Error(`drawing_orthographic_axis_unavailable:${feature}:${group.join('/')}`);
  }
  return accepted;
}

export const actualMechanicalSinglePartInspector: MechanicalSinglePartExactInspector = {
  async inspect(feature, stepText) {
    await ensureOcctReady();
    resetShapeRegistry();
    const imported = await occtImportStepText(stepText, TESS);
    if (!imported.handle) throw new Error('step_occt_import_failed');
    const kernel = occtRegisteredShapeEvidence(imported.handle);
    const shape = getShape(imported.handle) as {
      boundingBox?: { bounds?: Bounds };
    } | null;
    const boundsMm = requireBounds(shape?.boundingBox?.bounds, 'step_bbox_missing');
    const units = detectStepUnits(stepText);
    const views = projectThreeViews(imported.handle, feature);
    const svg = drawingSvg(feature, views);
    return {
      unit: units.unit,
      unitConfidence: units.confidence,
      solidCount: kernel?.solidCount ?? 0,
      singleSolid: kernel?.singleSolid === true,
      volumeMm3: kernel?.volumeMm3 ?? Number.NaN,
      boundsMm,
      views,
      svg,
    };
  },
};

function generatedFile(relative: string, content: string | Buffer): GeneratedFile {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
  return { path: slash(relative), bytes, sha256: hash(bytes) };
}

function binding(file: GeneratedFile, assertionId: string): EvidenceBinding {
  return { path: file.path, sha256: file.sha256, bytes: file.bytes.byteLength, assertionId };
}

function viewsSummary(views: ProjectedViews) {
  return Object.fromEntries(Object.entries(views).map(([name, view]) => [name, {
    visible: view.visible.length,
    hidden: view.hidden.length,
    viewBox: view.viewBox,
  }]));
}

function assertDrawingReport(report: Record<string, unknown>, inspection: ExactCandidateInspection, svg: Buffer) {
  if (report.svgBytes !== svg.byteLength || report.svgSha256 !== hash(svg)
    || JSON.stringify(report.views) !== JSON.stringify(viewsSummary(inspection.views))) {
    throw new Error('source_drawing_report_mismatch');
  }
}

function assertExportReport(
  report: Record<string, unknown>,
  step: Buffer,
  inspection: ExactCandidateInspection,
) {
  const after = report.after as Record<string, unknown> | undefined;
  const reportBounds = requireBounds(after?.boundsMm, 'source_export_bbox_missing');
  if (report.stepBytes !== step.byteLength || report.stepSha256 !== hash(step)
    || after?.solidCount !== inspection.solidCount || after.singleSolid !== inspection.singleSolid
    || typeof after.volumeMm3 !== 'number' || !closeEnough(after.volumeMm3, inspection.volumeMm3)
    || !sameBounds(reportBounds, inspection.boundsMm)) {
    throw new Error('source_export_reinspection_mismatch');
  }
}

export async function buildMechanicalSinglePartCandidates(
  root = process.cwd(),
  paths: MechanicalSinglePartCandidatePaths = MECHANICAL_SINGLE_PART_CANDIDATE_PATHS,
  options: BuildMechanicalSinglePartCandidateOptions = {},
  inspector: MechanicalSinglePartExactInspector = actualMechanicalSinglePartInspector,
) {
  const sourceBytes = readRegularFile(root, paths.sourceReceipt);
  const sourceReceiptSha256 = hash(sourceBytes);
  if (options.expectedSourceReceiptSha256
    && options.expectedSourceReceiptSha256 !== sourceReceiptSha256) {
    throw new Error('SINGLE_PART_SOURCE_RECEIPT_STALE');
  }
  const source = parseSourceReceipt(sourceBytes);
  if (options.expectedDesignRevisionSha256
    && options.expectedDesignRevisionSha256 !== source.designRevisionSha256) {
    throw new Error('SINGLE_PART_DESIGN_REVISION_STALE');
  }

  const featureRuns = new Map<string, AxisRun[]>();
  for (const run of source.runs) {
    if (!run || typeof run.feature !== 'string' || !FEATURE_ID.test(run.feature)
      || typeof run.axis !== 'string' || typeof run.status !== 'string') {
      throw new Error('SINGLE_PART_SOURCE_RUN_INVALID');
    }
    featureRuns.set(run.feature, [...(featureRuns.get(run.feature) ?? []), run]);
  }
  if (featureRuns.size === 0) throw new Error('SINGLE_PART_SOURCE_RUNS_EMPTY');

  const generated: GeneratedFile[] = [];
  const records: CandidateRecord[] = [];
  for (const [feature, runs] of featureRuns) {
    const sourceVerdict = evaluateMechanicalSinglePartSourceRuns(feature, runs);
    if (!sourceVerdict.eligible) {
      records.push({ feature, candidateStatus: 'NOT_RUN', reasons: sourceVerdict.reasons });
      continue;
    }

    try {
      for (const run of runs) {
        if (!Array.isArray(run.evidence) || run.evidence.length === 0) {
          throw new Error(`source_axis_evidence_missing:${run.axis}`);
        }
        for (const evidence of run.evidence) readBoundArtifact(root, evidence);
      }

      const nfabBinding = findAssertion(runs, `${feature}.save_reopen.saved-bytes`);
      const stepBinding = findAssertion(runs, `${feature}.export.native-step`);
      const exportReportBinding = findAssertion(runs, `${feature}.export.step-reimport`);
      const sourceSvgBinding = findAssertion(runs, `${feature}.drawing.exact-hlr-svg`);
      const drawingReportBinding = findAssertion(runs, `${feature}.drawing.three-view-hlr`);
      const nfabBytes = readBoundArtifact(root, nfabBinding);
      const stepBytes = readBoundArtifact(root, stepBinding);
      const exportReport = requireRuntimeReport(readBoundArtifact(root, exportReportBinding), feature, 'export');
      const sourceSvg = readBoundArtifact(root, sourceSvgBinding);
      const drawingReport = requireRuntimeReport(readBoundArtifact(root, drawingReportBinding), feature, 'drawing');
      const nfab = requireNfab(nfabBytes, feature);
      const stepText = stepBytes.toString('utf8');
      if (!stepText.startsWith('ISO-10303-21;') || !stepText.includes('END-ISO-10303-21;')) {
        throw new Error('source_step_envelope_invalid');
      }

      const inspection = await inspector.inspect(feature, stepText);
      if (inspection.unit !== 'mm' || inspection.unitConfidence !== 'high') {
        throw new Error(`step_units_not_explicit_mm:${inspection.unit}:${inspection.unitConfidence}`);
      }
      if (!inspection.singleSolid || inspection.solidCount !== 1
        || !Number.isFinite(inspection.volumeMm3) || inspection.volumeMm3 <= 0) {
        throw new Error('step_not_one_measurable_solid');
      }
      const dimensionsMm = mechanicalSinglePartDimensionsMm(inspection.boundsMm);
      const regeneratedSvg = Buffer.from(inspection.svg, 'utf8');
      if (hash(regeneratedSvg) !== sourceSvgBinding.sha256
        || !regeneratedSvg.equals(sourceSvg)) {
        throw new Error('drawing_hlr_regeneration_hash_mismatch');
      }
      assertExportReport(exportReport, stepBytes, inspection);
      assertDrawingReport(drawingReport, inspection, regeneratedSvg);

      const nfabRevisionSha256 = hash(nfabBytes);
      const partRevisionSha256 = hash([
        source.designRevisionSha256,
        feature,
        nfabRevisionSha256,
        stepBinding.sha256,
      ].join('\0'));
      const featureRoot = slash(path.posix.join(paths.outputRoot, feature));
      const stepInspectionFile = generatedFile(
        path.posix.join(featureRoot, 'step-import.json'),
        render({
          schema: 'nexyfab.mechanical-single-part-step-import.v1',
          feature,
          partRevisionSha256,
          sourceDesignRevisionSha256: source.designRevisionSha256,
          sourceStep: stepBinding,
          exactKernel: 'OCCT',
          units: { value: inspection.unit, confidence: inspection.unitConfidence },
          solidCount: inspection.solidCount,
          singleSolid: inspection.singleSolid,
          volumeMm3: inspection.volumeMm3,
          boundsMm: inspection.boundsMm,
          dimensionsMm,
        }),
      );
      const drawingFile = generatedFile(
        path.posix.join(featureRoot, `${feature}-three-axis-hlr.svg`),
        regeneratedSvg,
      );
      const bomFile = generatedFile(
        path.posix.join(featureRoot, 'bom.json'),
        render({
          schema: 'nexyfab.mechanical-single-part-bom-candidate.v1',
          partRevisionSha256,
          sourceDesignRevisionSha256: source.designRevisionSha256,
          sourceNfabSha256: nfabRevisionSha256,
          sourceStepSha256: stepBinding.sha256,
          units: 'mm',
          items: [{
            partNumber: feature,
            description: nfab.name,
            quantity: 1,
            dimensionsMm,
          }],
          claimBoundary: {
            singlePartCandidateOnly: true,
            materialSpecified: false,
            massCalculated: false,
            manufacturingApproved: false,
          },
        }),
      );
      const manifest = {
        schema: MECHANICAL_SINGLE_PART_CANDIDATE_SCHEMA,
        feature,
        candidateStatus: 'PASS',
        partRevisionSha256,
        source: {
          receiptPath: paths.sourceReceipt,
          receiptSha256: sourceReceiptSha256,
          designRevisionSha256: source.designRevisionSha256,
          nfab: {
            ...nfabBinding,
            revisionSha256: nfabRevisionSha256,
            formatVersion: nfab.version,
            createdAt: nfab.createdAt,
            updatedAt: nfab.updatedAt,
          },
          step: stepBinding,
          drawingSvg: sourceSvgBinding,
        },
        artifacts: {
          stepImport: binding(stepInspectionFile, `${feature}.candidate.step-import`),
          drawing: binding(drawingFile, `${feature}.candidate.three-axis-hlr`),
          bom: binding(bomFile, `${feature}.candidate.one-part-bom`),
        },
        capabilityStatus: {
          stepImportSolidUnitsBounds: 'PASS',
          threeAxisHlrDrawingCandidate: 'PASS',
          onePartBomQuantityDimensions: 'PASS',
          drawingDimensions: 'NOT_RUN',
          gdt: 'NOT_RUN',
          pmi: 'NOT_RUN',
          humanApproval: 'NOT_RUN',
          manufacturingRelease: 'BLOCKED',
        },
        commercialReleaseEligible: false,
      };
      const manifestFile = generatedFile(
        path.posix.join(featureRoot, 'candidate.json'),
        render(manifest),
      );
      generated.push(stepInspectionFile, drawingFile, bomFile, manifestFile);
      records.push({
        feature,
        candidateStatus: 'PASS',
        reasons: [],
        candidateManifest: binding(manifestFile, `${feature}.candidate.manifest`),
      });
    } catch (error) {
      records.push({
        feature,
        candidateStatus: 'NOT_RUN',
        reasons: [error instanceof Error ? error.message : String(error)],
      });
    } finally {
      resetShapeRegistry();
    }
  }

  const sourceAfter = readRegularFile(root, paths.sourceReceipt);
  if (hash(sourceAfter) !== sourceReceiptSha256 || !sourceAfter.equals(sourceBytes)) {
    throw new Error('SINGLE_PART_SOURCE_CHANGED_DURING_RUN');
  }

  const candidatePass = records.filter(record => record.candidateStatus === 'PASS').length;
  const bindVerifierFiles = (items: readonly string[], prefix: string) => items.map((relative, index) => {
    const bytes = readRegularFile(root, relative);
    return {
      path: slash(relative),
      sha256: hash(bytes),
      bytes: bytes.byteLength,
      assertionId: `${prefix}.${index + 1}`,
    };
  });
  const receipt = {
    schema: MECHANICAL_SINGLE_PART_CANDIDATE_RECEIPT_SCHEMA,
    generatedAt: source.generatedAt,
    status: 'HOLD',
    source: {
      path: paths.sourceReceipt,
      sha256: sourceReceiptSha256,
      designRevisionSha256: source.designRevisionSha256,
    },
    summary: {
      featuresAssessed: records.length,
      candidatePass,
      notRun: records.length - candidatePass,
      manufacturingReleaseEligible: 0,
    },
    claimBoundary: {
      localExactCandidateOnly: true,
      commercialReceiptModified: false,
      runtimeLiveEvidenceCreated: false,
      drawingDimensionsRun: false,
      gdtRun: false,
      pmiRun: false,
      humanApprovalRun: false,
      manufacturingReleaseApproved: false,
    },
    verifierBinding: {
      sources: bindVerifierFiles(paths.verifierSources, 'single-part-candidate.verifier-source'),
      tests: bindVerifierFiles(paths.verifierTests, 'single-part-candidate.verifier-test'),
    },
    records,
  };
  const receiptFile = generatedFile(paths.outputReceipt, render(receipt));
  const receiptShaFile = generatedFile(paths.outputReceiptSha256, `${receiptFile.sha256}  receipt.json\n`);
  generated.push(receiptFile, receiptShaFile);

  if (options.write) {
    for (const file of generated) {
      const absolute = resolveInside(root, file.path);
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.writeFileSync(absolute, file.bytes);
      const persisted = fs.readFileSync(absolute);
      if (hash(persisted) !== file.sha256 || !persisted.equals(file.bytes)) {
        throw new Error(`SINGLE_PART_OUTPUT_WRITE_MISMATCH:${file.path}`);
      }
    }
    const sourceAfterWrite = readRegularFile(root, paths.sourceReceipt);
    if (hash(sourceAfterWrite) !== sourceReceiptSha256 || !sourceAfterWrite.equals(sourceBytes)) {
      throw new Error('SINGLE_PART_SOURCE_CHANGED_DURING_WRITE');
    }
  }
  if (options.checkExisting) {
    for (const file of generated) {
      const persisted = readRegularFile(root, file.path);
      if (hash(persisted) !== file.sha256 || !persisted.equals(file.bytes)) {
        throw new Error(`SINGLE_PART_OUTPUT_STALE:${file.path}`);
      }
    }
  }
  return { receipt, receiptSha256: receiptFile.sha256, generatedFiles: generated };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const write = process.argv.includes('--write');
  const sourceArg = process.argv.find(value => value.startsWith('--expected-source-sha256='));
  const revisionArg = process.argv.find(value => value.startsWith('--expected-design-revision='));
  buildMechanicalSinglePartCandidates(process.cwd(), MECHANICAL_SINGLE_PART_CANDIDATE_PATHS, {
    write,
    checkExisting: !write,
    expectedSourceReceiptSha256: sourceArg?.slice('--expected-source-sha256='.length),
    expectedDesignRevisionSha256: revisionArg?.slice('--expected-design-revision='.length),
  }).then(result => {
    process.stdout.write(`${JSON.stringify({
      written: write,
      receiptSha256: result.receiptSha256,
      summary: result.receipt.summary,
    })}\n`);
  }).catch(error => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
