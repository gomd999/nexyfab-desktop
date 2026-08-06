/**
 * Validation harness self-test (V4).
 *
 * Verifies the orchestrator + scorer wiring without burning AI budget.
 * Plays the role of "what would happen if we ran the real validation
 * but the AI was perfect / always wedged / always returns no tools".
 */

import { describe, it, expect } from 'vitest';
import { runValidation, formatReportMarkdown } from '../validation/runValidation';
import { VALIDATION_SCENARIOS } from '../validation/scenarios';
import type { AiClient, RenderState } from '../types';
import type { ToolHostAdapters } from '../tools';

// Build a "perfect AI" that emits write_scad with the right keyword and
// then renders cleanly. State is derived from the conversation history
// (assistant messages already produced) so each scenario gets fresh
// behavior — no shared turn counter across scenarios.
function perfectAi(): AiClient {
  return {
    async complete(messages) {
      const assistantsSoFar = messages.filter(m => m.role === 'assistant').length;
      if (assistantsSoFar === 0) {
        // First model turn this scenario — emit the SCAD + render.
        const last = [...messages].reverse().find(m => m.role === 'user')?.content ?? '';
        let scad = 'cube([30, 30, 30], center=true);';
        // Stage 1 — assembly scenarios get a module-style fallthrough so
        // the keyword scorer (which looks for "module", "translate",
        // shape-specific tokens) sees what it expects.
        if (/마운트|모터|nema|motor mount/i.test(last)) {
          scad = 'include <BOSL2/std.scad>\nmodule bracket() { cube([60,60,5]); }\nmodule screw() { cylinder(h=10, r=1.5); }\nbracket();\ntranslate([10,10,5]) screw();\ntranslate([50,10,5]) screw();\ntranslate([10,50,5]) screw();\ntranslate([50,50,5]) screw();';
        } else if (/맞물리는|gear train|평기어 2/i.test(last)) {
          scad = 'include <BOSL2/std.scad>\nmodule g1() { spur_gear(teeth=20, mod=2, thickness=8); }\nmodule g2() { spur_gear(teeth=30, mod=2, thickness=8); }\ng1();\ntranslate([50,0,0]) g2();';
        } else if (/T자형|t-joint|tee|t자|파이프 조인트/i.test(last)) {
          scad = 'module main_pipe_left() { difference() { cylinder(h=50, d=30); cylinder(h=50, d=20); } }\nmodule main_pipe_right() { difference() { cylinder(h=50, d=30); cylinder(h=50, d=20); } }\nmodule branch_pipe() { difference() { cylinder(h=60, d=30); cylinder(h=60, d=20); } }\nmain_pipe_left();\nmain_pipe_right();\nbranch_pipe();';
        } else if (/토이카|토이 카|toy car|작은 창문|차체.*휠/i.test(last)) {
          scad = 'module body() { cube([60,30,20]); }\nmodule wheel() { rotate([90,0,0]) cylinder(h=6, d=14); }\nbody();\ntranslate([-20,-18,7]) wheel();\ntranslate([-20,18,7]) wheel();\ntranslate([20,-18,7]) wheel();\ntranslate([20,18,7]) wheel();';
        } else if (/그리드|grid|16개|4×4|4x4/i.test(last)) {
          scad = 'module bracket() { difference() { cube([20,20,3]); translate([3,3,0]) cube([14,14,3]); } }\n' + Array.from({ length: 4 }, (_, x) => Array.from({ length: 4 }, (_, y) => `translate([${x * 50},${y * 50},0]) bracket();`).join('\n')).join('\n');
        } else if (/볼트|bolt|M8|나사/i.test(last)) scad = 'include <BOSL2/std.scad>\nthreaded_rod(d=8, l=50, pitch=1.25);';
        else if (/케이스|case|enclosure|벽/i.test(last)) scad = 'difference() {\n  cube([120,80,40]);\n  translate([2,2,2]) cube([116,76,40]);\n}';
        else if (/브래킷|bracket|구멍|hole/i.test(last)) scad = 'difference() {\n  cube([50,30,5]);\n  translate([5,5,0]) cylinder(h=5, r=2, $fn=32);\n}';
        else if (/기어|gear/i.test(last)) scad = 'include <BOSL2/std.scad>\nspur_gear(teeth=20, mod=2, thickness=8);';
        return {
          text: `Designing.\n\`\`\`tool_call\n{"id":"c1","name":"write_scad","args":${JSON.stringify({ code: scad })}}\n\`\`\`\n\`\`\`tool_call\n{"id":"c2","name":"render","args":{}}\n\`\`\``,
          promptTokens: 100,
          completionTokens: 80,
        };
      }
      return { text: 'Done.', promptTokens: 50, completionTokens: 10 };
    },
  };
}

function failingAi(reason: 'wedge' | 'narrate' = 'wedge'): AiClient {
  if (reason === 'narrate') {
    return {
      async complete() {
        return { text: 'I cannot help with that.', promptTokens: 50, completionTokens: 10 };
      },
    };
  }
  // For wedge: keep emitting render forever; combined with always-fail render
  // host, this trips the wedge guard at 3 consecutive failures.
  return {
    async complete() {
      return {
        text: '\n```tool_call\n{"id":"r","name":"render","args":{}}\n```',
        promptTokens: 80, completionTokens: 30,
      };
    },
  };
}

function mockHost(opts: { renderOk?: boolean } = {}): ToolHostAdapters {
  const ok = opts.renderOk ?? true;
  const render: RenderState = ok
    ? { ok: true, errors: [], stlBytes: 1024, triangles: 12 }
    : { ok: false, errors: [{ message: 'mock render fail' }] };
  return {
    render: async () => ({ ...render, ts: Date.now() }),
    geometry: async () => ({ triangleCount: 12, manifold: true, bbox: { min: [0,0,0], max: [10,10,10] } }),
    dfm: async () => ({ summary: 'no issues', issuesCount: 0 }),
  };
}

describe('Validation harness (V4)', () => {
  it('perfect AI + ok render → all scenarios pass', async () => {
    const report = await runValidation({
      ai: perfectAi(),
      host: mockHost({ renderOk: true }),
      aiProviderLabel: 'mock-perfect',
    });
    expect(
      report.summary.passed,
      JSON.stringify(report.results.filter(result => !result.passed).map(result => ({ id: result.scenarioId, reasons: result.reasons }))),
    ).toBe(VALIDATION_SCENARIOS.length);
    expect(report.summary.failed).toBe(0);
    expect(report.summary.passRate).toBe(1);
  });

  it('perfect AI + always-fail render → render gate trips, all fail', async () => {
    const report = await runValidation({
      ai: perfectAi(),
      host: mockHost({ renderOk: false }),
      aiProviderLabel: 'mock-renderfail',
      // Tighten budget so the wedge trips fast — without this the agent
      // would spin retrying through tokens.
      tokensCap: 1_000,
      turnsCap: 4,
      toolCallsCap: 8,
    });
    expect(report.summary.passed).toBe(0);
    for (const r of report.results) {
      expect(r.reasons.length).toBeGreaterThan(0);
    }
  });

  it('AI that just narrates → passes only when keyword appears in source', async () => {
    // narrate-only model never writes SCAD — source stays empty → keyword
    // miss → all scenarios fail.
    const report = await runValidation({
      ai: failingAi('narrate'),
      host: mockHost({ renderOk: true }),
      aiProviderLabel: 'mock-narrate',
    });
    expect(report.summary.passed).toBe(0);
    for (const r of report.results) {
      expect(r.reasons.some(x => /keywords/i.test(x))).toBe(true);
    }
  });

  it('id filter narrows the run', async () => {
    const report = await runValidation({
      ai: perfectAi(),
      host: mockHost(),
      ids: ['sc1_cube', 'sc5_gear'],
      aiProviderLabel: 'mock',
    });
    expect(report.summary.total).toBe(2);
    expect(report.results.map(r => r.scenarioId).sort()).toEqual(['sc1_cube', 'sc5_gear']);
  });

  it('progress callbacks fire once per scenario', async () => {
    const starts: string[] = [];
    const dones: string[] = [];
    await runValidation({
      ai: perfectAi(),
      host: mockHost(),
      aiProviderLabel: 'mock',
      onScenarioStart: s => starts.push(s.id),
      onScenarioDone: r => dones.push(r.scenarioId),
    });
    expect(starts.length).toBe(VALIDATION_SCENARIOS.length);
    expect(dones.length).toBe(VALIDATION_SCENARIOS.length);
  });

  it('formatReportMarkdown produces a valid table + per-scenario blocks', async () => {
    const report = await runValidation({
      ai: perfectAi(),
      host: mockHost(),
      aiProviderLabel: 'mock-md',
    });
    const md = formatReportMarkdown(report);
    expect(md).toContain('# SCAD Agent Validation Report');
    expect(md).toContain('| ID | Pass |');
    for (const s of VALIDATION_SCENARIOS) {
      expect(md).toContain(`### ${s.id}`);
    }
  });

  it('VALIDATION_SCENARIOS coverage is complete (≥5 cases)', () => {
    expect(VALIDATION_SCENARIOS.length).toBeGreaterThanOrEqual(5);
    // Each scenario has unique id + nonzero expectedKeywords.
    const ids = new Set(VALIDATION_SCENARIOS.map(s => s.id));
    expect(ids.size).toBe(VALIDATION_SCENARIOS.length);
    for (const s of VALIDATION_SCENARIOS) {
      expect(s.expectedKeywords.length).toBeGreaterThan(0);
      expect(s.expectedTurnsMax).toBeGreaterThan(0);
    }
  });
});
