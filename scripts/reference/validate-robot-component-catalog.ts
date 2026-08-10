import path from 'node:path';
import { validateRobotComponentCatalogManifest } from './robot-component-catalog-manifest';
import { writeImmutableArtifactAtomic } from '../../src/lib/reference/immutableArtifactStore';

const args = process.argv.slice(2);
const valueAfter = (flag: string) => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined; };
const manifest = valueAfter('--manifest');
const output = valueAfter('--output');
if (!manifest || !output) {
  console.error('usage: tsx scripts/reference/validate-robot-component-catalog.ts --manifest <manifest.json> --output <report.json>');
  process.exitCode = 2;
} else {
  const report = validateRobotComponentCatalogManifest(path.resolve(manifest));
  const absoluteOutput = path.resolve(output);
  writeImmutableArtifactAtomic(path.dirname(absoluteOutput), path.basename(absoluteOutput), Buffer.from(`${JSON.stringify(report, null, 2)}\n`), 'robot_catalog_validation_collision');
  console.log(JSON.stringify({ output: path.relative(process.cwd(), absoluteOutput), valid: report.valid, components: report.componentCount, artifacts: report.artifactCount, errors: report.errors.length }));
  if (!report.valid) process.exitCode = 1;
}
