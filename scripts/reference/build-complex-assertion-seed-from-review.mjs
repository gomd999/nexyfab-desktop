#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const arg = name => process.argv.find(item => item.startsWith(`--${name}=`))?.slice(name.length + 3);
const input = path.resolve(arg('input') || 'docs/evidence/complex-holdout-review-260806');
const output = path.resolve(arg('output') || path.join(input, 'migration-seed.draft.json'));
const families = ['robot', 'gearbox', 'pressure_vessel', 'turbomachinery', 'factory_equipment', 'interior'];
const assertion = (id, axis, hash, dependsOn = []) => ({ id, axis, tolerancePolicy: id.includes('count') ? 'exact-count' : axis === 'dimensions' ? 'reviewed-linear-tolerance-required' : axis === 'transforms' ? 'rigid-transform-1e-7' : 'review-required', artifactHashes: [hash], dependsOn });
const cases = [];
for (const family of families) {
  const queue = JSON.parse(await readFile(path.join(input, `${family}.review.json`), 'utf8'));
  for (const item of queue.items) {
    const base = [assertion('requirements:source-intent', 'requirements', item.sourceHash), assertion('part-definitions:count', 'part_definitions', item.sourceHash, ['requirements:source-intent']), assertion('occurrences:count', 'occurrences', item.sourceHash, ['part-definitions:count']), assertion('hierarchy:structure', 'hierarchy', item.sourceHash, ['occurrences:count']), assertion('dimensions:governed', 'dimensions', item.sourceHash, ['requirements:source-intent']), assertion('features:required', 'features', item.sourceHash, ['dimensions:governed']), assertion('step-roundtrip:preservation', 'step_roundtrip', item.sourceHash, ['part-definitions:count', 'occurrences:count'])];
    const assembly = item.tierCandidate === 'T1' ? [] : [assertion('transforms:occurrences', 'transforms', item.sourceHash, ['hierarchy:structure']), assertion('joints:interfaces', 'joints', item.sourceHash, ['transforms:occurrences']), assertion('body-membership:definitions', 'body_membership', item.sourceHash, ['part-definitions:count'])];
    const complex = item.tierCandidate === 'T3' ? [assertion('motion:operating-range', 'motion', item.sourceHash, ['joints:interfaces']), assertion('collision-clearance:operating-range', 'collision_clearance', item.sourceHash, ['motion:operating-range']), assertion('manufacturing:release', 'manufacturing', item.sourceHash, ['dimensions:governed'])] : [];
    cases.push({ caseId: item.caseId, family, tier: item.tierCandidate, holdoutGroup: item.holdoutGroup, sourceHash: item.sourceHash, assertions: [...base, ...assembly, ...complex] });
  }
}
await writeFile(output, `${JSON.stringify({ schema: 'nexyfab.complex-assertion-migration-seed.v1', status: 'draft_unreviewed', scoreEligible: false, cases }, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ output, cases: cases.length, counts: Object.fromEntries(families.map(family => [family, cases.filter(item => item.family === family).length])) })}\n`);
