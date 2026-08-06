#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
const arg = name => process.argv.find(item => item.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = path.resolve(arg('root') || 'C:/Users/gomd9/Downloads/참고파일들');
const input = path.resolve(arg('input') || 'docs/evidence/complex-holdout-review-260806');
const output = path.resolve(arg('output') || path.join(input, 'preflight.json'));
const maximumArchiveBytes = Number(arg('max-archive-bytes') || 128 * 1024 * 1024);
const families = ['robot', 'gearbox', 'pressure_vessel', 'turbomachinery', 'factory_equipment', 'interior'];
const nativeAssembly = new Set(['sldasm', 'sldprt', 'iam', 'ipt', 'catproduct', 'catpart', 'asm', 'prt', 'x_t', 'x_b', 'dwg', 'rvt']);
const hashFile = file => new Promise((resolve, reject) => { const hash = createHash('sha256'); createReadStream(file).on('data', chunk => hash.update(chunk)).on('end', () => resolve(hash.digest('hex'))).on('error', reject); });
const safePath = locator => { const absolute = path.resolve(root, locator); const relative = path.relative(root, absolute); if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`unsafe_locator:${locator}`); return absolute; };
const inspection = (id, status, reason, measured = undefined) => ({ id, status, reason, ...(measured === undefined ? {} : { measured }) });
const results = [];
for (const family of families) {
  const queue = JSON.parse(await readFile(path.join(input, `${family}.review.json`), 'utf8'));
  for (const item of queue.items) {
    const checks = [];
    try {
      const file = safePath(item.localLocator), actualHash = await hashFile(file);
      checks.push(inspection('source-hash', actualHash === item.sourceHash ? 'pass' : 'fail', actualHash === item.sourceHash ? 'Source bytes match the frozen candidate hash.' : 'Source bytes changed after candidate selection.'));
      checks.push(inspection('provenance-license', 'not_run', 'Commercial provenance and license require reviewer approval.'));
      if (item.extension === 'zip') {
        if (item.bytes > maximumArchiveBytes) checks.push(inspection('archive-structure', 'not_run', `Archive exceeds governed preflight budget ${maximumArchiveBytes}.`, item.bytes));
        else {
          const archive = await JSZip.loadAsync(await readFile(file)), entries = Object.keys(archive.files).filter(name => !archive.files[name].dir), extensions = entries.reduce((out, name) => { const ext = path.extname(name).toLowerCase().slice(1) || 'none'; out[ext] = (out[ext] ?? 0) + 1; return out; }, {});
          const assemblyEntries = entries.filter(name => ['.sldasm', '.iam', '.catproduct', '.asm', '.step', '.stp', '.iges', '.igs', '.ifc', '.x_t', '.x_b', '.rvt', '.dwg', '.ipt', '.sldprt', '.catpart', '.prt'].includes(path.extname(name).toLowerCase()));
          checks.push(inspection('archive-structure', assemblyEntries.length ? 'pass' : 'fail', assemblyEntries.length ? 'Archive contains product/assembly CAD entries.' : 'Archive contains no supported product/assembly CAD entry.', { entries: entries.length, assemblyEntries: assemblyEntries.length, extensions }));
        }
      } else if (nativeAssembly.has(item.extension)) checks.push(inspection('native-structure', 'not_run', `Native ${item.extension.toUpperCase()} requires the governed CAD extractor for definitions, occurrences, transforms and joints.`));
      else {
        const bytes = await readFile(file), text = bytes.subarray(0, Math.min(bytes.length, 16 * 1024 * 1024)).toString('latin1');
        if (item.extension === 'ifc') { const entities = (text.match(/^#\d+\s*=/gm) ?? []).length, products = (text.match(/IFC(?:BUILDINGELEMENT|WALL|SLAB|DOOR|WINDOW|SPACE|BUILDINGSTOREY|FURNISHINGELEMENT)/g) ?? []).length; checks.push(inspection('exchange-structure', entities > 0 && products > 0 ? 'pass' : 'fail', entities > 0 && products > 0 ? 'IFC contains entity and product structure.' : 'IFC product structure was not measured.', { entities, products, truncated: bytes.length > text.length })); }
        else if (item.extension === 'iges' || item.extension === 'igs') { const directory = text.split(/\r?\n/).filter(line => line.length >= 73 && line[72] === 'D'), entityTypes = directory.filter((_, index) => index % 2 === 0).map(line => Number.parseInt(line.slice(0, 8).trim(), 10)).filter(Number.isFinite), solids = entityTypes.filter(type => type === 186).length, instances = entityTypes.filter(type => type === 408).length; checks.push(inspection('exchange-structure', entityTypes.length > 0 && (solids > 0 || instances > 0) ? 'pass' : 'not_run', solids > 0 || instances > 0 ? 'IGES directory contains solid or subfigure-instance entities.' : 'IGES directory exists but product/solid semantics were not established.', { directoryEntries: entityTypes.length, solids, instances, truncated: bytes.length > text.length })); }
        else { const entities = (text.match(/#\d+\s*=/g) ?? []).length, products = (text.match(/NEXT_ASSEMBLY_USAGE_OCCURRENCE|PRODUCT_DEFINITION|MANIFOLD_SOLID_BREP|ADVANCED_BREP_SHAPE_REPRESENTATION/g) ?? []).length; checks.push(inspection('exchange-structure', entities > 0 && products > 0 ? 'pass' : 'fail', entities > 0 && products > 0 ? 'STEP/X_T text contains product or solid structure.' : 'Supported product/solid structure was not measured.', { entities, products, truncated: bytes.length > text.length })); }
      }
      checks.push(inspection('assertion-ground-truth', 'not_run', 'Counts, transforms, joints, tolerances and expected outcomes require native extraction and reviewer sign-off.'));
    } catch (error) { checks.push(inspection('source-access', 'fail', error instanceof Error ? error.message : String(error))); }
    const status = checks.some(check => check.status === 'fail') ? 'fail' : checks.some(check => check.status === 'not_run') ? 'not_run' : 'pass';
    results.push({ caseId: item.caseId, family, sourceHash: item.sourceHash, status, checks });
  }
}
const counts = results.reduce((out, item) => ({ ...out, [item.status]: (out[item.status] ?? 0) + 1 }), {});
const byFamily = Object.fromEntries(families.map(family => [family, results.filter(item => item.family === family).reduce((out, item) => ({ ...out, [item.status]: (out[item.status] ?? 0) + 1 }), {})]));
await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, `${JSON.stringify({ schema: 'nexyfab.complex-holdout-preflight.v1', policy: { approvalGranted: false, scoreEligible: false, sourceModified: false, maximumArchiveBytes }, counts, byFamily, results }, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ output, cases: results.length, counts, byFamily })}\n`);
