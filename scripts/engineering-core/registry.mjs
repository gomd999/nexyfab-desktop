/**
 * Calculator registry — node 어댑터. 코어 로직은 core.mjs(플랫폼 중립: node/Worker 공용),
 * 여기는 fs 기반 standards 로더만 추가. CLI·MCP·테스트가 사용. Worker는 worker/src → core.mjs.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { calculators, validateInput, runCalculatorCore } from './core.mjs';

export { calculators, validateInput };

const __dirname = dirname(fileURLToPath(import.meta.url));

export function loadStandards() {
  const dir = join(__dirname, 'standards');
  const out = {};
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const s = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    out[s.id] = s;
  }
  return out;
}

/** Run a calculator by id with the intent-gate flow (standards from disk). */
export function runCalculator(id, input, standardId = 'KDS') {
  return runCalculatorCore(loadStandards(), id, input, standardId);
}
