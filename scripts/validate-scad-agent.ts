#!/usr/bin/env tsx
/**
 * SCAD agent live-validation runner.
 *
 * Drives the 5-scenario validation suite against the real AI provider
 * chain + the real OpenSCAD CLI. Skips automatically with a clear
 * message when prerequisites aren't met (no AI key, OpenSCAD missing).
 *
 * Usage:
 *   npm run validate:scad-agent              # full sweep
 *   npm run validate:scad-agent -- --ids sc1_cube,sc5_gear  # subset
 *
 * Outputs:
 *   - validation-reports/scad-agent-<timestamp>.json
 *   - validation-reports/scad-agent-<timestamp>.md
 *
 * Cost: typically $0.05–$0.15 per full run depending on provider.
 * Time: 30–180s per scenario depending on render complexity.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runValidation, formatReportMarkdown } from '../src/lib/ai/scad-agent/validation/runValidation';
import { makeServerAiClient } from '../src/lib/ai/scad-agent/runScadAgent';
import { SERVER_HOST_ADAPTERS } from '../src/lib/ai/scad-agent/serverAdapters';
import { VALIDATION_SCENARIOS } from '../src/lib/ai/scad-agent/validation/scenarios';

const args = process.argv.slice(2);
const idsArg = args.find(a => a.startsWith('--ids='));
const ids = idsArg ? idsArg.slice('--ids='.length).split(',').map(s => s.trim()).filter(Boolean) : undefined;

function hasAnyAiKey(): boolean {
  return !!(
    process.env.DEEPSEEK_API_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.LOCAL_AI_BASE_URL
  );
}

async function checkOpenScadInstalled(): Promise<boolean> {
  if (process.env.OPENSCAD_USE_DOCKER === '1') return true;
  const { execFile } = await import('node:child_process');
  return new Promise<boolean>((resolve) => {
    const bin = process.env.OPENSCAD_BIN || (process.platform === 'win32' ? 'openscad.com' : 'openscad');
    execFile(bin, ['--version'], { timeout: 5_000 }, (err) => resolve(!err));
  });
}

async function main() {
  console.log('🔧 SCAD Agent Validation\n');

  if (!process.env.OPENSCADPATH) {
    const userLibraryRoot = path.join(os.homedir(), 'Documents', 'OpenSCAD', 'libraries');
    if (fs.existsSync(path.join(userLibraryRoot, 'BOSL2'))) {
      process.env.OPENSCADPATH = userLibraryRoot;
    }
  }

  if (!hasAnyAiKey()) {
    console.error('❌ No AI API key configured.');
    console.error('   Set one of: DEEPSEEK_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY / LOCAL_AI_BASE_URL');
    process.exit(2);
  }
  console.log('✅ AI provider key detected.');

  const openscadOk = await checkOpenScadInstalled();
  if (!openscadOk) {
    console.error('❌ OpenSCAD CLI not found.');
    console.error('   Install OpenSCAD or set OPENSCAD_BIN, or run with OPENSCAD_USE_DOCKER=1.');
    process.exit(2);
  }
  console.log('✅ OpenSCAD CLI reachable.\n');

  const scenarios = ids
    ? VALIDATION_SCENARIOS.filter(s => ids.includes(s.id))
    : VALIDATION_SCENARIOS;
  if (scenarios.length === 0) {
    console.error(`❌ No scenarios match --ids=${ids?.join(',')}`);
    process.exit(2);
  }

  const provider =
    process.env.ANTHROPIC_API_KEY ? 'anthropic' :
    process.env.DEEPSEEK_API_KEY ? 'deepseek' :
    process.env.OPENAI_API_KEY ? 'openai' :
    'local';

  console.log(`▶ Running ${scenarios.length} scenario(s) against ${provider}...\n`);

  const t0 = Date.now();
  const report = await runValidation({
    ai: makeServerAiClient({ task: 'scad-agent-validation', temperature: 0.2 }),
    host: SERVER_HOST_ADAPTERS,
    ids,
    aiProviderLabel: provider,
    onScenarioStart: (s, i, n) => {
      console.log(`[${i + 1}/${n}] ${s.id} — "${s.prompt}"`);
    },
    onScenarioDone: (r) => {
      const icon = r.passed ? '✅' : '❌';
      const detail = r.reasons.length > 0 ? ` — ${r.reasons[0]}` : '';
      console.log(`        ${icon} ${r.status} (${r.turnsUsed}t, ${r.toolCallsUsed}tc, ${(r.elapsedMs / 1000).toFixed(1)}s)${detail}\n`);
    },
  });

  const totalSec = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n📊 Summary:  ${report.summary.passed}/${report.summary.total} passed  (${(report.summary.passRate * 100).toFixed(0)}%)  in ${totalSec}s`);

  // Write artifacts.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = path.join(process.cwd(), 'validation-reports');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, `scad-agent-${stamp}.json`);
  const mdPath = path.join(outDir, `scad-agent-${stamp}.md`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(mdPath, formatReportMarkdown(report), 'utf8');
  console.log(`\n📝 ${path.relative(process.cwd(), mdPath)}`);
  console.log(`📦 ${path.relative(process.cwd(), jsonPath)}`);

  process.exit(report.summary.passed === report.summary.total ? 0 : 1);
}

main().catch((e) => {
  console.error('\n💥 Validation runner crashed:');
  console.error(e);
  process.exit(2);
});
