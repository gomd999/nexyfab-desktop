#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';

const [, , inputPath, outputPath, resultPath] = process.argv;
const finish = (payload) => {
  try { writeFileSync(resultPath, JSON.stringify(payload)); } catch { /* parent detects missing result */ }
};
if (!inputPath || !outputPath || !resultPath) {
  process.stderr.write('usage: kernel-step-roundtrip.mjs <input.step> <output.step> <result.json>\n');
  process.exit(2);
}
try {
  const { ensureReplicad } = await import('./to-step.mjs');
  const rc = await ensureReplicad();
  const shape = await rc.importSTEP(new Blob([readFileSync(inputPath)]));
  const exported = await shape.blobSTEP().text();
  writeFileSync(outputPath, exported, 'latin1');
  finish({ ok: true, bytes: Buffer.byteLength(exported, 'latin1'), entityCount: (exported.match(/^#\d+/gm) ?? []).length });
} catch (error) {
  finish({ ok: false, reason: String(error?.message ?? error).slice(0, 240) });
}

