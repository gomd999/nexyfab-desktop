#!/usr/bin/env node
import { open, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const rootInput = option('root') ?? process.env.NEXYFAB_REFERENCE_CORPUS_ROOT?.trim(), queuesInput = option('queues'), outputInput = option('output');
const text = bytes => new TextDecoder('latin1').decode(bytes);

async function prefix(file, length = 65536) {
  const handle = await open(file, 'r');
  try { const buffer = Buffer.alloc(length); const { bytesRead } = await handle.read(buffer, 0, length, 0); return buffer.subarray(0, bytesRead); }
  finally { await handle.close(); }
}

export function probeReferenceSignature(extension, bytes, sizeBytes) {
  const source = text(bytes), upper = source.toUpperCase();
  if (extension === 'step' || extension === 'stp') return /ISO-10303-21/.test(upper) && /(?:HEADER|DATA)\s*;/.test(upper);
  if (extension === 'stl') return /^\s*solid\b/i.test(source) || (sizeBytes >= 84 && (sizeBytes - 84) % 50 === 0);
  if (extension === 'dxf') return /(?:^|\r?\n)\s*0\s*\r?\n\s*SECTION/i.test(source) || /\$ACADVER/i.test(source);
  if (extension === 'ifc') return /ISO-10303-21/.test(upper) && /IFC[A-Z0-9_]+\s*\(/.test(upper);
  if (extension === 'x_t' || extension === 'xt' || extension === 'xmt_txt') return sizeBytes > 32 && /(?:PARASOLID|SCH_|BODY|700|800|900)/i.test(source);
  if (extension === 'iges' || extension === 'igs') return sizeBytes >= 80 && /(?:^|\r?\n).{0,72}[SGDPT]\s*\d+\s*$/m.test(source);
  // Text SAT commonly starts with a numeric ACIS save-file header (for example
  // `700 0 15 0`) and names ASM/ACIS on the following line.
  if (extension === 'sat') return /ACIS|ASM BINARYFILE/i.test(source) || /^\s*\d{3,4}\s+\d+\s+\d+\s+\d+/i.test(source);
  if (extension === 'obj') return /(?:^|\r?\n)\s*v\s+[-+\d.]/m.test(source);
  if (extension === '3mf') return bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (extension === 'dae') return /<COLLADA\b/i.test(source);
  if (extension === 'wrl' || extension === 'vrml') return /#VRML/i.test(source);
  if (extension === 'scad') return /\b(?:cube|cylinder|sphere|polyhedron|linear_extrude|rotate_extrude|module|import)\s*\(/i.test(source);
  if (extension === 'fbx') return /Kaydara FBX Binary|FBXHeaderExtension/i.test(source);
  if (extension === '3ds') return bytes[0] === 0x4d && bytes[1] === 0x4d;
  return sizeBytes > 0;
}

export function referenceProbeFailureReason(extension, bytes) {
  const source = text(bytes);
  if ((extension === 'step' || extension === 'stp') && /^STL file generated/i.test(source)) return 'extension_mismatch_detected_stl';
  if ((extension === 'step' || extension === 'stp') && /^#UGC:/i.test(source)) return 'extension_mismatch_detected_creo_native';
  return 'format_signature_not_recognized';
}

async function main() {
  if (!rootInput || !queuesInput || !outputInput) throw new Error('usage: --root=PATH --queues=JSON --output=JSON');
  const root = path.resolve(rootInput), queues = JSON.parse(await readFile(path.resolve(queuesInput), 'utf8'));
  const results = [], byCheck = {};
  for (let index = 0; index < queues.automated.length; index++) {
    const item = queues.automated[index], absolute = path.resolve(root, item.relativePath);
    if (path.relative(root, absolute).startsWith('..')) throw new Error('source_path_escape');
    let status = 'pass', reason = 'recognized_format_signature';
    try { const bytes = await prefix(absolute); if (!probeReferenceSignature(item.extension, bytes, item.sizeBytes)) { status = 'fail'; reason = referenceProbeFailureReason(item.extension, bytes); } }
    catch { status = 'fail'; reason = 'source_read_failed'; }
    results.push({ artifactId: item.artifactId, relativePath: item.relativePath, lineageId: item.lineageId, extension: item.extension, check: item.check, status, reason, accuracyGranted: false, sourceModified: false });
    const key = `${item.check}:${status}`; byCheck[key] = (byCheck[key] ?? 0) + 1;
    if ((index + 1) % 250 === 0) process.stderr.write(`[reference-probe] ${index + 1}/${queues.automated.length}\n`);
  }
  const summary = { total: results.length, pass: results.filter(item => item.status === 'pass').length, fail: results.filter(item => item.status === 'fail').length, byCheck };
  const report = { schema: 'nexyfab.reference-format-probe.v1', generatedAt: new Date().toISOString(), policy: { admissionProbeOnly: true, accuracyGranted: false, sourceReadOnly: true, sourceBytesCopied: false }, summary, results };
  await writeFile(path.resolve(outputInput), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output: path.resolve(outputInput), ...summary })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
}
