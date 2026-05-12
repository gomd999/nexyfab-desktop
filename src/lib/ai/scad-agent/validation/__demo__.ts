#!/usr/bin/env tsx
/**
 * Validation harness demo run — uses MOCK AI + MOCK render so it runs
 * offline / without API keys. Produces a reference report so the team can
 * see what `npm run validate:scad-agent` will look like once a real
 * provider is wired up.
 *
 * Run with: npx tsx src/lib/ai/scad-agent/validation/__demo__.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { runValidation, formatReportMarkdown } from './runValidation';
import type { AiClient, RenderState } from '../types';
import type { ToolHostAdapters } from '../tools';

function mockPerfectAi(): AiClient {
  return {
    async complete(messages) {
      const assistantsSoFar = messages.filter(m => m.role === 'assistant').length;
      if (assistantsSoFar === 0) {
        const last = [...messages].reverse().find(m => m.role === 'user')?.content ?? '';
        let scad = 'cube([30, 30, 30], center=true);';
        if (/볼트|bolt|M8|나사/i.test(last)) scad = 'include <BOSL2/std.scad>\nthreaded_rod(d=8, l=50, pitch=1.25);';
        else if (/케이스|case|enclosure|벽/i.test(last)) scad = 'difference() {\n  cube([120,80,40]);\n  translate([2,2,2]) cube([116,76,40]);\n}';
        else if (/브래킷|bracket|구멍|hole/i.test(last)) scad = 'difference() {\n  cube([50,30,5]);\n  translate([5,5,0]) cylinder(h=5, r=2, $fn=32);\n  translate([45,5,0]) cylinder(h=5, r=2, $fn=32);\n  translate([5,25,0]) cylinder(h=5, r=2, $fn=32);\n  translate([45,25,0]) cylinder(h=5, r=2, $fn=32);\n}';
        else if (/기어|gear/i.test(last)) scad = 'include <BOSL2/std.scad>\nspur_gear(teeth=20, mod=2, thickness=8);';
        return {
          text: `Designing the part.\n\`\`\`tool_call\n{"id":"c1","name":"write_scad","args":${JSON.stringify({ code: scad })}}\n\`\`\`\n\`\`\`tool_call\n{"id":"c2","name":"render","args":{}}\n\`\`\``,
          promptTokens: 280, completionTokens: 180,
        };
      }
      return { text: 'Rendered cleanly. Ready for review.', promptTokens: 80, completionTokens: 18 };
    },
  };
}

function mockHostOk(): ToolHostAdapters {
  const r: RenderState = { ok: true, errors: [], stlBytes: 1024, triangles: 12 };
  return {
    render: async () => ({ ...r, ts: Date.now() }),
    geometry: async () => ({ triangleCount: 12, manifold: true, bbox: { min: [-15,-15,-15], max: [15,15,15] } }),
    dfm: async () => ({ summary: 'no issues', issuesCount: 0 }),
  };
}

async function main() {
  console.log('🧪 Running validation harness with MOCK AI + MOCK render (no cost, no API)...\n');
  const report = await runValidation({
    ai: mockPerfectAi(),
    host: mockHostOk(),
    aiProviderLabel: 'mock-perfect (demo)',
    onScenarioStart: (s, i, n) => console.log(`[${i + 1}/${n}] ${s.id}`),
    onScenarioDone: (r) => console.log(`        ${r.passed ? '✅' : '❌'} ${r.status} (${r.turnsUsed}t, ${r.toolCallsUsed}tc)`),
  });

  console.log(`\n📊 ${report.summary.passed}/${report.summary.total} passed (${(report.summary.passRate * 100).toFixed(0)}%)`);

  const outDir = path.join(process.cwd(), 'validation-reports');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const mdPath = path.join(outDir, 'scad-agent-MOCK-DEMO.md');
  const jsonPath = path.join(outDir, 'scad-agent-MOCK-DEMO.json');
  fs.writeFileSync(mdPath, formatReportMarkdown(report), 'utf8');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`\n📝 ${path.relative(process.cwd(), mdPath)}`);
}

main().catch(e => { console.error(e); process.exit(1); });
