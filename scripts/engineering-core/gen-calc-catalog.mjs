// calcCatalog.ts 재생성기 — core.mjs 등록 계산기 전체를 eng-chat 카탈로그로 변환.
import { writeFileSync } from 'node:fs';
import { calculators } from './core.mjs';
const specs = calculators.map((c) => {
  const props = c.inputSchema?.properties ?? {};
  const params = {};
  for (const [k, v] of Object.entries(props)) {
    const p = { desc: v.description ?? '' };
    if (v.type) p.type = v.type;
    if (v.minimum !== undefined) p.min = v.minimum;
    if (v.exclusiveMinimum !== undefined) p.min = v.exclusiveMinimum;
    if (v.maximum !== undefined) p.max = v.maximum;
    if (v.enum) p.enum = v.enum;
    params[k] = p;
  }
  return { id: c.id, domain: c.domain, title: c.title, description: c.description, required: c.inputSchema?.required ?? [], params };
});
const out = `// AUTO-GENERATED from scripts/engineering-core/core.mjs — eng-api 계산 카탈로그(${specs.length}종).
// 재생성: node scripts/engineering-core/gen-calc-catalog.mjs. AI 의도추출 프롬프트에 주입.
export interface CalcParam { desc: string; type?: string; min?: number; max?: number; enum?: (string|number)[] }
export interface CalcSpec { id: string; domain: string; title: string; description: string; required: string[]; params: Record<string, CalcParam> }
export const CALC_CATALOG: CalcSpec[] = ${JSON.stringify(specs, null, 2)};
`;
writeFileSync(new URL('../../src/app/api/eng-chat/calcCatalog.ts', import.meta.url), out);
console.log('regenerated', specs.length);
