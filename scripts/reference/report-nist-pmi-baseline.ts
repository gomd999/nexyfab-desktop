import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { analyzeAp242Pmi } from '../../src/lib/reference/ap242PmiEvidence';
import { verifyAp242PmiSemanticRoundtrip } from '../../src/lib/reference/ap242PmiSemanticRoundtrip';

const args = process.argv.slice(2);
const rootInput = args.find(arg => !arg.startsWith('--')) ?? process.env.NEXYFAB_REFERENCE_CORPUS_ROOT?.trim();
if (!rootInput) throw new Error('reference_corpus_root_required');
const root = path.resolve(rootInput);
const output = args.find(arg => arg.startsWith('--output='))?.slice(9);

async function walk(dir: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

async function main(): Promise<void> {
  const files = (await walk(root)).filter(file => /nist_(ctc|ftc|stc)_\d+.*ap242.*\.(stp|step)$/i.test(path.basename(file)));
  const records = [];
  for (const family of ['ctc', 'ftc', 'stc'] as const) {
    const selected = files.filter(file => new RegExp(`nist_${family}_`, 'i').test(path.basename(file))).sort()[0];
    if (!selected) { records.push({ family, status: 'not_run', reason: 'No AP242 representative found.' }); continue; }
    try {
      const text = await readFile(selected, 'latin1');
      const pmi = await analyzeAp242Pmi(text);
      const roundtrip = await verifyAp242PmiSemanticRoundtrip(text);
      const status = pmi.schema === 'AP242' && pmi.semantic.total > 0 && roundtrip.pass ? 'pass' : 'fail';
      records.push({ family, status, sourceLabel: path.basename(selected), semantic: pmi.semantic, graphical: pmi.graphical, topology: pmi.topology, semanticRoundtrip: { pass: roundtrip.pass, mismatches: roundtrip.mismatches, scope: roundtrip.scope } });
    } catch (error) {
      records.push({ family, status: 'fail', reason: error instanceof Error ? error.message : String(error) });
    }
  }
  const summary = {
    pass: records.filter(record => record.status === 'pass').length,
    fail: records.filter(record => record.status === 'fail').length,
    not_run: records.filter(record => record.status === 'not_run').length,
  };
  const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), summary, records };
  const json = JSON.stringify(report, null, 2);
  if (output) await writeFile(path.resolve(output), json);
  else process.stdout.write(`${json}\n`);
  if (summary.fail) process.exitCode = 5;
  else if (summary.not_run) process.exitCode = 4;
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 5;
});
