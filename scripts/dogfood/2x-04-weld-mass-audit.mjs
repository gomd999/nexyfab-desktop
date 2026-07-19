// 2x-04: 요약에 찍히는 숫자 역추적 — 용접(접합) 길이·질량·std 스냅 근거
import { readFileSync } from 'node:fs';
import { buildAssembly } from '../drawing-to-3d/assembly.mjs';
import { auditAssemblyStd } from '../drawing-to-3d/std-snap.mjs';
import { computeBOQ } from '../drawing-to-3d/boq.mjs';

const asm = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const b = buildAssembly(asm);
console.log('== welds', (b.welds ?? []).length, 'total', b.weldTotalMm, 'mm');
for (const w of b.welds ?? []) console.log('   ', JSON.stringify(w));
console.log('== contacts', (b.contacts ?? []).length);
for (const c of (b.contacts ?? []).slice(0, 20)) console.log('   ', JSON.stringify(c));
console.log('== structural', JSON.stringify(b.structural).slice(0, 1200));
console.log('== pipes', JSON.stringify(b.pipes ?? null).slice(0, 400));
const std = auditAssemblyStd(asm);
console.log('== std warnings', JSON.stringify(std.warnings));
console.log('== std items');
for (const i of std.items ?? []) console.log('   ', JSON.stringify(i));
let boq = null; try { boq = computeBOQ(asm); } catch (e) { boq = { err: String(e) }; }
console.log('== boq.totalMassKg', boq?.totalMassKg, 'keys', Object.keys(boq ?? {}).join(','));
