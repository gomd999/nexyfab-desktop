import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { importStepWithKernel } from '@/lib/brep-bridge/stepKernelImport';
import { analyzeAp242Pmi } from './ap242PmiEvidence';
import { attachCanonicalAp242PmiWithFaceLinks } from './ap242PmiSemanticRoundtrip';
import { transplantAp242GraphicalPmi } from './ap242GraphicalPmi';

export interface OcctStepRoundtripResult {
  ok: boolean;
  reason: string | null;
  exportedStep: string | null;
  geometry: {
    pass: boolean;
    sourceParts: number;
    exportedParts: number;
    sourceVolumeMm3: number;
    exportedVolumeMm3: number;
    volumeDeltaPct: number | null;
  };
  pmi: { status: 'pass' | 'fail' | 'not_run'; reason: string; sourceSemantic: number; exportedSemantic: number; sourceGraphical: number; exportedGraphical: number; sourceTopologyCoverage: number; exportedTopologyCoverage: number };
}

const emptyGeometry = { pass: false, sourceParts: 0, exportedParts: 0, sourceVolumeMm3: 0, exportedVolumeMm3: 0, volumeDeltaPct: null };
const emptyPmi = { status: 'not_run' as const, reason: 'PMI comparison was not run.', sourceSemantic: 0, exportedSemantic: 0, sourceGraphical: 0, exportedGraphical: 0, sourceTopologyCoverage: 0, exportedTopologyCoverage: 0 };
export async function roundtripStepWithOcct(source: Uint8Array, timeoutMs = 90_000): Promise<OcctStepRoundtripResult> {
  const dir = await mkdtemp(join(tmpdir(), 'nf-step-rt-'));
  try {
    const input = join(dir, 'input.step');
    const output = join(dir, 'output.step');
    const resultFile = join(dir, 'result.json');
    await writeFile(input, source);
    const run = promisify(execFile);
    await run(process.execPath, [join(process.cwd(), 'scripts', 'drawing-to-3d', 'kernel-step-roundtrip.mjs'), input, output, resultFile], { timeout: timeoutMs, windowsHide: true, maxBuffer: 1 << 20 });
    const child = JSON.parse(await readFile(resultFile, 'utf8')) as { ok: boolean; reason?: string };
    if (!child.ok) return { ok: false, reason: child.reason ?? 'OCCT roundtrip failed', exportedStep: null, geometry: emptyGeometry, pmi: emptyPmi };
    const exportedBytes = await readFile(output);
    const sourceText = Buffer.from(source).toString('latin1');
    const kernelExportedStep = exportedBytes.toString('latin1');
    const reattached = await attachCanonicalAp242PmiWithFaceLinks(kernelExportedStep, sourceText);
    const graphical = transplantAp242GraphicalPmi(reattached.source, sourceText);
    if (graphical.unresolvedReferences.length > 0) throw new Error(`Graphical PMI has ${graphical.unresolvedReferences.length} unresolved reference(s).`);
    const exportedStep = graphical.source;
    const finalExportedBytes = new TextEncoder().encode(exportedStep);
    const [sourceGeometry, exportedGeometry] = await Promise.all([
      importStepWithKernel(source, { idPrefix: 'source', timeoutMs }),
      importStepWithKernel(finalExportedBytes, { idPrefix: 'exported', timeoutMs }),
    ]);
    if (!sourceGeometry.ok || !exportedGeometry.ok) return { ok: false, reason: `Geometry measurement failed: ${sourceGeometry.reason ?? exportedGeometry.reason}`, exportedStep, geometry: emptyGeometry, pmi: emptyPmi };
    const volume = (parts: typeof sourceGeometry.parts) => parts.reduce((sum, part) => sum + part.params.volumeMm3, 0);
    const sourceVolumeMm3 = volume(sourceGeometry.parts);
    const exportedVolumeMm3 = volume(exportedGeometry.parts);
    const volumeDeltaPct = sourceVolumeMm3 > 0 ? Math.abs(exportedVolumeMm3 - sourceVolumeMm3) / sourceVolumeMm3 * 100 : null;
    const geometry = {
      pass: sourceGeometry.parts.length === exportedGeometry.parts.length && volumeDeltaPct !== null && volumeDeltaPct <= 0.1,
      sourceParts: sourceGeometry.parts.length, exportedParts: exportedGeometry.parts.length,
      sourceVolumeMm3, exportedVolumeMm3, volumeDeltaPct,
    };
    const [sourcePmi, exportedPmi] = await Promise.all([analyzeAp242Pmi(sourceText), analyzeAp242Pmi(exportedStep)]);
    const sourcePmiTotal = sourcePmi.semantic.total + sourcePmi.graphical.total;
    const exportedPmiTotal = exportedPmi.semantic.total + exportedPmi.graphical.total;
    const pmiPreserved = sourcePmi.semantic.total === exportedPmi.semantic.total && sourcePmi.graphical.total === exportedPmi.graphical.total && sourcePmi.topology.coverage === exportedPmi.topology.coverage;
    const pmiStatus = sourcePmiTotal === 0 && exportedPmiTotal === 0 ? 'not_run' : pmiPreserved ? 'pass' : 'fail';
    return {
      ok: geometry.pass, reason: geometry.pass ? null : 'Part count or exact volume changed beyond tolerance.', exportedStep, geometry,
      pmi: {
        status: pmiStatus,
        reason: pmiStatus === 'not_run' ? 'Neither source nor export contains supported PMI; 0→0 is not preservation evidence.' : pmiStatus === 'pass' ? 'Source-present PMI evidence counts were preserved.' : 'PMI evidence counts changed during roundtrip.',
        sourceSemantic: sourcePmi.semantic.total, exportedSemantic: exportedPmi.semantic.total, sourceGraphical: sourcePmi.graphical.total, exportedGraphical: exportedPmi.graphical.total, sourceTopologyCoverage: sourcePmi.topology.coverage, exportedTopologyCoverage: exportedPmi.topology.coverage,
      },
    };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error), exportedStep: null, geometry: emptyGeometry, pmi: emptyPmi };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
