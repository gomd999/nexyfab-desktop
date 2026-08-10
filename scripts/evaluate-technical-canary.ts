import { readFile } from 'node:fs/promises';
import { evaluateTechnicalCanary, type TechnicalCanaryObservation } from '../src/lib/technicalCanaryPolicy';

async function main(): Promise<void> {
  const source = process.argv.find(item => item.startsWith('--input='))?.slice(8);
  if (!source) throw new Error('Usage: --input=<canary-observations.json>');
  const observations = JSON.parse(await readFile(source, 'utf8')) as TechnicalCanaryObservation[];
  const decision = evaluateTechnicalCanary(observations);
  process.stdout.write(`${JSON.stringify(decision, null, 2)}\n`);
  if (decision.action === 'rollback') process.exitCode = 2;
  else if (decision.action === 'hold') process.exitCode = 4;
}
void main().catch(error => { process.stderr.write(`[technical-canary] ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
