import fs from 'node:fs';
import path from 'node:path';
import { bridgeEffectiveScadSource, parseEffectiveScadAssemblySource } from '../src/lib/ai/scadAssemblyBridge';
import { buildScadDefinitionGeometryEvidence } from '../src/lib/ai/scadDefinitionGeometryEvidence';
import { runOpenScadCli } from '../src/lib/openscad-render/runOpenScadCli';

async function main() {
  const [inputArg, outputArg] = process.argv.slice(2);
  if (!inputArg || !outputArg) throw new Error('usage: tsx scripts/build-scad-definition-geometry-evidence.ts <validation-report.json> <output.json>');
  const input = path.resolve(inputArg), output = path.resolve(outputArg);
  const report = JSON.parse(fs.readFileSync(input, 'utf8')) as { generatedAt?: string; results?: Array<{ scenarioId?: string; passed?: boolean; finalScadSource?: string }> };
  if (!Array.isArray(report.results)) throw new Error('validation_report_results_missing');

  const assemblies = [];
  for (const result of report.results) {
  const scenarioId = result.scenarioId ?? 'unknown';
  if (!result.passed || typeof result.finalScadSource !== 'string') {
    assemblies.push({ scenarioId, status: 'fail', codes: ['SCAD_VALIDATION_SOURCE_NOT_ELIGIBLE'], evidence: null });
    continue;
  }
  const parsed = parseEffectiveScadAssemblySource(result.finalScadSource);
  const bridge = bridgeEffectiveScadSource(result.finalScadSource, scenarioId);
  const includePrefix = (parsed.composition ?? '').split(/\r?\n/).filter(line => /^\s*(?:include|use)\s*</i.test(line)).join('\n');
  const evidence = await buildScadDefinitionGeometryEvidence({
    modules: parsed.modules,
    bridge,
    render: async (source) => {
      const rendered = await runOpenScadCli({ scadSource: `${includePrefix}\n${source}`, format: 'stl' });
      return rendered.ok
        ? { ok: true, bytes: new Uint8Array(rendered.buffer.buffer, rendered.buffer.byteOffset, rendered.buffer.byteLength) }
        : { ok: false, error: `${rendered.code}:${rendered.message}:${rendered.stderr ?? ''}` };
    },
  });
  assemblies.push({ scenarioId, status: evidence.status, codes: evidence.codes, evidence });
  }
  const artifact = {
  schema: 'nexyfab.scad-definition-geometry-campaign.v1',
  generatedAt: new Date().toISOString(),
  sourceReport: path.relative(process.cwd(), input).replaceAll('\\', '/'),
  sourceGeneratedAt: report.generatedAt ?? null,
  summary: { total: assemblies.length, pass: assemblies.filter(item => item.status === 'pass').length, fail: assemblies.filter(item => item.status !== 'pass').length },
  assemblies,
  };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(artifact.summary));
  if (artifact.summary.fail) process.exitCode = 1;
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
