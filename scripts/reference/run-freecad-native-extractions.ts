import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import type { ComplexNativeExtractionRequest, ComplexNativeExtractionResult } from '../../src/lib/reference/complexNativeExtraction';
interface RequestBatch { schema: 'nexyfab.complex-native-extraction-request-batch.v1'; requests: ComplexNativeExtractionRequest[]; }
const FREECAD_DIRECT_FORMATS = ['step', 'stp', 'iges', 'igs'] as const;
const FREECAD_ARCHIVE_EXTENSIONS = ['.step', '.stp', '.iges', '.igs'] as const;
const value = (name: string) => process.argv.find(item => item.startsWith(`--${name}=`))?.slice(name.length + 3);
const repairLegacyUtf8Locator = (locator: string) => {
  if (!/[Ãìë]/.test(locator)) return locator;
  const repaired = Buffer.from(locator, 'latin1').toString('utf8');
  return repaired.includes('\uFFFD') ? locator : repaired;
};
const safePath = (root: string, locator: string) => { const absolute = path.resolve(root, locator), relative = path.relative(root, absolute); if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`unsafe_locator:${locator}`); return absolute; };
async function main() {
  const rootInput = value('root') ?? process.env.NEXYFAB_REFERENCE_CORPUS_ROOT?.trim();
  if (!rootInput) throw new Error('reference_corpus_root_required');
  const requestsPath = value('requests'), selectedCase = value('case'), selectedFormat = value('format')?.toLowerCase(), timeoutMs = Number(value('timeout-ms') ?? 120_000), root = path.resolve(rootInput), output = path.resolve(value('output') ?? 'docs/evidence/complex-holdout-review-260806/freecad-native-results.json'), artifacts = path.resolve(value('artifacts') ?? 'C:/tmp/nexyfab-freecad-extraction'), freecad = path.resolve(value('freecad') ?? 'C:/Program Files/FreeCAD 1.1/bin/FreeCADCmd.exe'), script = path.resolve('scripts/reference/freecad-extract-step.py');
  if (!requestsPath) throw new Error('Usage: --requests=requests.json [--root=corpus] [--output=results.json]');
  const batch = JSON.parse(await readFile(path.resolve(requestsPath), 'utf8')) as RequestBatch; if (batch.schema !== 'nexyfab.complex-native-extraction-request-batch.v1') throw new Error('freecad_request_batch_schema_invalid');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 600_000) throw new Error('freecad_timeout_invalid');
  await mkdir(artifacts, { recursive: true }); const results: ComplexNativeExtractionResult[] = [], skipped: Array<{ caseId: string; reason: string }> = [], failures: Array<{ caseId: string; reason: string }> = [];
  const selectedRequests = batch.requests.filter(request => (!selectedCase || request.caseId === selectedCase) && (!selectedFormat || request.format.toLowerCase() === selectedFormat));
  if (selectedCase && !selectedRequests.length) throw new Error(`freecad_requested_case_missing:${selectedCase}`);
  for (const request of selectedRequests) {
    const source = safePath(root, repairLegacyUtf8Locator(request.localLocator)); let importSource = source, sourceMember: ComplexNativeExtractionResult['sourceMember'];
    if (request.format.toLowerCase() === 'zip') {
      const archive = await JSZip.loadAsync(await readFile(source)), candidates = Object.keys(archive.files).filter(name => !archive.files[name]!.dir && FREECAD_ARCHIVE_EXTENSIONS.includes(path.extname(name).toLowerCase() as typeof FREECAD_ARCHIVE_EXTENSIONS[number])).sort((a, b) => ((archive.files[b] as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0) - ((archive.files[a] as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0));
      const member = candidates[0]; if (!member) { skipped.push({ caseId: request.caseId, reason: 'freecad_zip_supported_member_missing' }); continue; }
      const declaredSize = (archive.files[member] as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0; if (declaredSize > 512 * 1024 * 1024) { skipped.push({ caseId: request.caseId, reason: `freecad_zip_member_budget_exceeded:${declaredSize}` }); continue; }
      const memberBytes = await archive.files[member]!.async('nodebuffer'); importSource = path.join(artifacts, `${request.caseId}.member${path.extname(member).toLowerCase()}`); await writeFile(importSource, memberBytes); sourceMember = { path: member.replaceAll('\\', '/'), sha256: createHash('sha256').update(memberBytes).digest('hex') };
    } else if (!FREECAD_DIRECT_FORMATS.includes(request.format.toLowerCase() as typeof FREECAD_DIRECT_FORMATS[number])) { skipped.push({ caseId: request.caseId, reason: `freecad_direct_format_unsupported:${request.format}` }); continue; }
    const rawPath = path.join(artifacts, `${request.caseId}.raw.json`), execution = spawnSync(freecad, [script], { encoding: 'utf8', timeout: timeoutMs, windowsHide: true, env: { ...process.env, NEXYFAB_FREECAD_SOURCE: importSource, NEXYFAB_FREECAD_OUTPUT: rawPath, NEXYFAB_FREECAD_CASE_ID: request.caseId, NEXYFAB_FREECAD_SOURCE_HASH: request.sourceHash } });
    if (execution.error || execution.status !== 0) { failures.push({ caseId: request.caseId, reason: execution.error?.message ?? `freecad_exit:${execution.status}:${execution.stderr.slice(-500)}` }); continue; }
    try { await access(rawPath); } catch { failures.push({ caseId: request.caseId, reason: `freecad_result_missing:${execution.stderr.slice(-500)}:${execution.stdout.slice(-500)}` }); continue; }
    const rawBytes = await readFile(rawPath), raw = JSON.parse(rawBytes.toString('utf8')) as Omit<ComplexNativeExtractionResult, 'schema' | 'artifactHash' | 'extractor'> & { freecadVersion: string };
    results.push({ schema: 'nexyfab.complex-native-extraction-result.v1', caseId: raw.caseId, sourceHash: raw.sourceHash, artifactHash: createHash('sha256').update(rawBytes).digest('hex'), ...(sourceMember ? { sourceMember } : {}), extractor: { name: 'nexyfab-freecad-native-document', version: '3', cadSystem: `FreeCAD ${raw.freecadVersion}` }, units: raw.units, definitions: raw.definitions, occurrences: raw.occurrences, joints: raw.joints, jointSemanticsComplete: false });
  }
  const report = { schema: 'nexyfab.complex-native-extraction-result-batch.v1', extractorCapability: { formats: [...FREECAD_DIRECT_FORMATS, 'zip-contained-step', 'zip-contained-stp', 'zip-contained-iges', 'zip-contained-igs'], jointSemanticsComplete: false, nativeSolidWorksOrInventor: false }, results, skipped, failures };
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`); process.stdout.write(`${JSON.stringify({ output, requested: selectedRequests.length, completed: results.length, skipped: skipped.length, failures: failures.length })}\n`); if (failures.length) process.exitCode = 4;
}
main().catch(error => { process.stderr.write(`FreeCAD extraction failed: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
