#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const arg = name => process.argv.find(item => item.startsWith(`--${name}=`))?.slice(name.length + 3);
const input = path.resolve(arg('input') || 'docs/evidence/complex-holdout-review-260806');
const output = path.resolve(arg('output') || path.join(input, 'native-extraction-requests.json'));
const families = ['robot', 'gearbox', 'pressure_vessel', 'turbomachinery', 'factory_equipment', 'interior'], requests = [];
for (const family of families) { const queue = JSON.parse(await readFile(path.join(input, `${family}.review.json`), 'utf8')); for (const item of queue.items) requests.push({ schema: 'nexyfab.complex-native-extraction-request.v1', caseId: item.caseId, sourceHash: item.sourceHash, format: item.extension, localLocator: item.localLocator, requiredAxes: ['part_definitions', 'body_membership', 'occurrences', 'hierarchy', 'transforms', 'joints', 'units'] }); }
await writeFile(output, `${JSON.stringify({ schema: 'nexyfab.complex-native-extraction-request-batch.v1', localOnly: true, sourceBytesEmbedded: false, requests }, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ output, requests: requests.length })}\n`);
