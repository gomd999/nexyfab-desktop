/**
 * SCAD agent validation orchestrator.
 *
 * Drives `runScadAgent` against the canned scenarios with pluggable AI
 * client + tool host (so tests run with mocks; the CLI runner injects
 * the real `chatCompletion` + `runOpenScadCli`).
 *
 * Outputs a structured report with per-scenario pass/fail, aggregate
 * stats, and a Markdown summary suitable for committing to docs/.
 */
import { runScadAgent } from '../runScadAgent';
import { effectiveScadSource } from '../composeSource';
import { makeTools, type ToolHostAdapters } from '../tools';
import type { AiClient, AgentEvent } from '../types';
import {
  VALIDATION_SCENARIOS,
  scoreScenario,
  type ValidationScenario,
  type ScenarioResult,
} from './scenarios';

export interface ValidationReport {
  generatedAt: string;
  /** Provider name reported by the AI client (best-effort, free-form). */
  aiProvider: string;
  results: ScenarioResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    passRate: number;
    /** Sum of wall-clock seconds spent across all scenarios. */
    totalElapsedSec: number;
    /** Sum of approximate tokens charged. */
    totalTokens: number;
  };
}

export interface RunValidationOptions {
  ai: AiClient;
  host: ToolHostAdapters;
  /** Filter to a subset of scenarios by id (smoke testing). */
  ids?: string[];
  /** Fired before each scenario starts — useful for CLI progress. */
  onScenarioStart?: (scenario: ValidationScenario, idx: number, total: number) => void;
  /** Fired after a scenario finishes (pass or fail). */
  onScenarioDone?: (result: ScenarioResult) => void;
  /** Free-form provider label to embed in the report header. */
  aiProviderLabel?: string;
  /** Override per-scenario tokens/turns/tool-calls budget for a tighter run. */
  tokensCap?: number;
  turnsCap?: number;
  toolCallsCap?: number;
}

export async function runValidation(opts: RunValidationOptions): Promise<ValidationReport> {
  const scenarios = opts.ids
    ? VALIDATION_SCENARIOS.filter(s => opts.ids!.includes(s.id))
    : VALIDATION_SCENARIOS;

  const tools = makeTools(opts.host);
  const results: ScenarioResult[] = [];

  for (let i = 0; i < scenarios.length; i++) {
    const scenario = scenarios[i];
    opts.onScenarioStart?.(scenario, i, scenarios.length);

    const errorEvents: string[] = [];
    const t0 = Date.now();

    let session: Awaited<ReturnType<typeof runScadAgent>>['session'] | undefined;
    try {
      const result = await runScadAgent({
        userPrompt: scenario.prompt,
        ai: opts.ai,
        tools,
        tokensCap: opts.tokensCap,
        turnsCap: opts.turnsCap,
        toolCallsCap: opts.toolCallsCap,
        requireSuccessfulRenderBeforeDone: true,
        stopAfterSuccessfulRender: true,
        resetHistoryOnIncompleteArtifact: true,
        onEvent: (ev: AgentEvent) => {
          if (ev.type === 'error') errorEvents.push(ev.message);
          if (ev.type === 'wedge_detected') errorEvents.push('wedge_detected');
          if (ev.type === 'tool_result' && !ev.result.ok) {
            errorEvents.push(`tool ${ev.callId}: ${ev.result.code ?? 'ERROR'}: ${ev.result.error}`);
          }
          if (ev.type === 'tool_result' && ev.result.ok && ev.result.meta?.renderOk === false) {
            errorEvents.push(`tool ${ev.callId}: RENDER_FAILED: ${ev.result.output}`);
          }
        },
      });
      session = result.session;
    } catch (e) {
      errorEvents.push(`uncaught: ${(e as Error).message}`);
    }

    const elapsedMs = Date.now() - t0;
    const scoreInput = {
      status: session?.status ?? 'error',
      // Stage 1 — when the agent built modules + composition, score the
      // composed SCAD (so keyword checks see the full picture).
      scadSource: session ? effectiveScadSource(session) : '',
      renderOk: session?.render.ok === true,
      turnsUsed: session?.budget.turnsUsed ?? 0,
      toolCallsUsed: session?.budget.toolCallsUsed ?? 0,
      tokensUsed: session?.budget.tokensUsed ?? 0,
      elapsedMs,
      errorEvents,
    };

    const result = scoreScenario(scenario, scoreInput);
    results.push(result);
    opts.onScenarioDone?.(result);
  }

  const passed = results.filter(r => r.passed).length;
  const totalElapsedMs = results.reduce((s, r) => s + r.elapsedMs, 0);
  const totalTokens = results.reduce((s, r) => s + r.tokensUsed, 0);

  return {
    generatedAt: new Date().toISOString(),
    aiProvider: opts.aiProviderLabel ?? 'unknown',
    results,
    summary: {
      total: results.length,
      passed,
      failed: results.length - passed,
      passRate: results.length === 0 ? 0 : passed / results.length,
      totalElapsedSec: Math.round(totalElapsedMs / 100) / 10,
      totalTokens,
    },
  };
}

// ─── Markdown formatter ────────────────────────────────────────────────────

export function formatReportMarkdown(report: ValidationReport): string {
  const lines: string[] = [];
  lines.push(`# SCAD Agent Validation Report`);
  lines.push('');
  lines.push(`- **Generated**: ${report.generatedAt}`);
  lines.push(`- **AI Provider**: ${report.aiProvider}`);
  lines.push(`- **Pass rate**: ${(report.summary.passRate * 100).toFixed(0)}% (${report.summary.passed}/${report.summary.total})`);
  lines.push(`- **Total time**: ${report.summary.totalElapsedSec}s`);
  lines.push(`- **Total tokens**: ${report.summary.totalTokens.toLocaleString()}`);
  lines.push('');
  lines.push(`## Per-scenario`);
  lines.push('');
  lines.push(`| ID | Pass | Status | Render | Turns | Tools | Tokens | Time | Notes |`);
  lines.push(`|---|---|---|---|---|---|---|---|---|`);
  for (const r of report.results) {
    const pass = r.passed ? '✅' : '❌';
    const render = r.renderOk ? 'ok' : '—';
    const notes = r.reasons.length > 0
      ? r.reasons.map(s => s.replace(/\|/g, '\\|')).join('; ')
      : '';
    lines.push(
      `| ${r.scenarioId} | ${pass} | ${r.status} | ${render} | ${r.turnsUsed} | ${r.toolCallsUsed} | ${r.tokensUsed.toLocaleString()} | ${(r.elapsedMs / 1000).toFixed(1)}s | ${notes} |`,
    );
  }
  lines.push('');
  lines.push(`## SCAD source previews`);
  for (const r of report.results) {
    lines.push('');
    lines.push(`### ${r.scenarioId}`);
    lines.push('');
    lines.push('```scad');
    lines.push(r.finalScadPreview || '(no source)');
    lines.push('```');
    if (r.finalScadBytes > r.finalScadPreview.length) {
      lines.push('');
      lines.push(`_(${r.finalScadBytes - r.finalScadPreview.length} more bytes truncated)_`);
    }
  }

  return lines.join('\n') + '\n';
}
