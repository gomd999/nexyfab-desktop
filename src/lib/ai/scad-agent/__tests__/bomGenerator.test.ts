/**
 * BOM generator tests — pure helper + tool wire-up.
 *
 * Validates aggregation (partsList beats string scan, count: N hints in
 * the composition string are honored, repeated entries sum into one
 * line), cost wiring (per-part cost roll-up, totalCostUsd math), CSV
 * shape (4 columns, embedded-comma quoting), and the tool wrapper
 * (empty-session ok + happy-path meta).
 */

import { describe, it, expect } from 'vitest';
import { generateBom, formatBomReport, bomToCSV, type BomReport } from '../bomGenerator';
import { makeTools, type ToolHostAdapters } from '../tools';
import type { AgentSession, ToolResult, ToolExecutor } from '../types';

function blankSession(): AgentSession {
  return {
    id: 's',
    scadSource: '', modules: {}, composition: null, designPlan: null,
    checkpoints: [], brepEntries: [], sketches: {}, mates: [], gdtFrames: [], docRefs: [], history: [],
    render: { ok: null, errors: [] }, geometry: {},
    budget: {
      tokensUsed: 0, tokensCap: 1_000_000,
      turnsUsed: 0, turnsCap: 50,
      toolCallsUsed: 0, toolCallsCap: 200,
      visionCallsUsed: 0, visionCallsCap: 3,
      consecutiveRenderFails: 0,
    },
    status: 'idle',
  };
}

function noopHost(): ToolHostAdapters {
  return {
    render: async () => ({ ok: true, errors: [], stlBytes: 0, triangles: 0, ts: 0 }),
    geometry: async () => ({}),
    dfm: async () => ({ summary: '', issuesCount: 0 }),
  };
}

function tool(tools: ReturnType<typeof makeTools>, name: 'generate_bom'): ToolExecutor {
  return tools[name]!;
}

function asOk(r: ToolResult): { ok: true; output: string; meta?: Record<string, unknown> } {
  if (!r.ok) throw new Error(`expected ok result, got: ${r.error}`);
  return r;
}

describe('generateBom — helper aggregation', () => {
  it('empty session returns a clean empty report with a note', () => {
    const session: Pick<AgentSession, 'modules' | 'composition'> = {
      modules: {},
      composition: null,
    };
    const report = generateBom({ session });
    expect(report.lines).toHaveLength(0);
    expect(report.totalPartCount).toBe(0);
    expect(report.uniquePartCount).toBe(0);
    expect(report.hasCosts).toBe(false);
    expect(report.notes.length).toBeGreaterThan(0);
  });

  it('partsList with 3 distinct modules emits one line per part with correct counts', () => {
    const session: Pick<AgentSession, 'modules' | 'composition'> = {
      modules: { bracket: '', bolt: '', nut: '' },
      composition: null,
    };
    const report = generateBom({
      session,
      partsList: [
        { moduleName: 'bracket', count: 1 },
        { moduleName: 'bolt', count: 4 },
        { moduleName: 'nut', count: 4 },
      ],
    });
    expect(report.uniquePartCount).toBe(3);
    expect(report.totalPartCount).toBe(9);
    const bolts = report.lines.find(l => l.partName === 'bolt');
    expect(bolts!.quantity).toBe(4);
  });

  it('repeated moduleName entries in partsList sum into one line', () => {
    const session: Pick<AgentSession, 'modules' | 'composition'> = {
      modules: { bolt: '' },
      composition: null,
    };
    const report = generateBom({
      session,
      partsList: [
        { moduleName: 'bolt', count: 2 },
        { moduleName: 'bolt', count: 3 },
        { moduleName: 'bolt' }, // default 1
      ],
    });
    expect(report.uniquePartCount).toBe(1);
    expect(report.lines[0]!.quantity).toBe(6);
  });

  it('costLookup populates unitCost + line total + report totalCostUsd', () => {
    const session: Pick<AgentSession, 'modules' | 'composition'> = {
      modules: { bracket: '', bolt: '' },
      composition: null,
    };
    const report = generateBom({
      session,
      partsList: [
        { moduleName: 'bracket', count: 1 },
        { moduleName: 'bolt', count: 4 },
      ],
      costLookup: {
        bracket: { unitCostUsd: 20, material: 'aluminum_6061' },
        bolt: { unitCostUsd: 2 },
      },
    });
    expect(report.hasCosts).toBe(true);
    const bracket = report.lines.find(l => l.partName === 'bracket')!;
    expect(bracket.unitCostUsd).toBe(20);
    expect(bracket.lineTotalUsd).toBe(20);
    expect(bracket.material).toBe('aluminum_6061');
    const bolt = report.lines.find(l => l.partName === 'bolt')!;
    expect(bolt.unitCostUsd).toBe(2);
    expect(bolt.lineTotalUsd).toBe(8);
    expect(report.totalCostUsd).toBe(28);
  });

  it('hasCosts is false when no costLookup is given', () => {
    const session: Pick<AgentSession, 'modules' | 'composition'> = {
      modules: { bracket: '' },
      composition: null,
    };
    const report = generateBom({
      session,
      partsList: [{ moduleName: 'bracket', count: 1 }],
    });
    expect(report.hasCosts).toBe(false);
    expect(report.totalCostUsd).toBeUndefined();
  });

  it('fallback: without partsList, count module-name occurrences in composition string', () => {
    // Mimic an emitted compose_assembly: 4 bolts via repeated callsites.
    const session: Pick<AgentSession, 'modules' | 'composition'> = {
      modules: { bracket: '', bolt: '' },
      composition: [
        'bracket();',
        'translate([10,0,0]) bolt();',
        'translate([20,0,0]) bolt();',
        'translate([30,0,0]) bolt();',
        'translate([40,0,0]) bolt();',
      ].join('\n'),
    };
    const report = generateBom({ session });
    const bolt = report.lines.find(l => l.partName === 'bolt');
    expect(bolt!.quantity).toBe(4);
    expect(report.lines.find(l => l.partName === 'bracket')!.quantity).toBe(1);
  });

  it('fallback: composition with explicit "x 4" hint sums via the hint not the callsite', () => {
    const session: Pick<AgentSession, 'modules' | 'composition'> = {
      modules: { bolt: '' },
      composition: 'bolt(); // x 4\n',
    };
    const report = generateBom({ session });
    const bolt = report.lines.find(l => l.partName === 'bolt')!;
    expect(bolt.quantity).toBe(4);
  });

  it('lines sort descending by quantity (dominant parts first)', () => {
    const session: Pick<AgentSession, 'modules' | 'composition'> = {
      modules: { bracket: '', bolt: '', nut: '' },
      composition: null,
    };
    const report = generateBom({
      session,
      partsList: [
        { moduleName: 'bracket', count: 1 },
        { moduleName: 'bolt', count: 10 },
        { moduleName: 'nut', count: 5 },
      ],
    });
    expect(report.lines[0]!.partName).toBe('bolt');
    expect(report.lines[1]!.partName).toBe('nut');
    expect(report.lines[2]!.partName).toBe('bracket');
  });
});

describe('bomToCSV', () => {
  it('emits 4 columns including header, and quotes parts with commas/quotes', () => {
    const report: BomReport = {
      lines: [
        { partName: 'simple', quantity: 1 },
        { partName: 'has,comma', quantity: 2 },
        { partName: 'has"quote', quantity: 3, material: 'pla', unitCostUsd: 1.5, lineTotalUsd: 4.5 },
      ],
      totalPartCount: 6,
      uniquePartCount: 3,
      hasCosts: true,
      totalCostUsd: 4.5,
      notes: [],
    };
    const csv = bomToCSV(report);
    const rows = csv.split('\n');
    expect(rows[0]).toBe('Part,Quantity,Material,Cost (USD)');
    expect(rows).toHaveLength(4);
    // Comma in part name must trigger quoting.
    expect(rows[2]).toMatch(/^"has,comma",2,,$/);
    // Embedded quote must be doubled per RFC 4180.
    expect(rows[3]).toMatch(/^"has""quote",3,pla,4\.50$/);
  });
});

describe('formatBomReport', () => {
  it('mentions both unique-parts and total-parts counts', () => {
    const report: BomReport = {
      lines: [
        { partName: 'bracket', quantity: 1 },
        { partName: 'bolt', quantity: 4 },
      ],
      totalPartCount: 5,
      uniquePartCount: 2,
      hasCosts: false,
      notes: [],
    };
    const text = formatBomReport(report);
    expect(text).toMatch(/2 unique parts/);
    expect(text).toMatch(/5 total/);
  });

  it('renders cost totals when hasCosts=true', () => {
    const report: BomReport = {
      lines: [{ partName: 'bolt', quantity: 4, unitCostUsd: 2, lineTotalUsd: 8 }],
      totalPartCount: 4,
      uniquePartCount: 1,
      hasCosts: true,
      totalCostUsd: 8,
      notes: [],
    };
    const text = formatBomReport(report);
    expect(text).toMatch(/\$8\.00/);
    expect(text).toMatch(/4×\$2\.00/);
  });
});

describe('generate_bom — tool executor wire', () => {
  it('empty session returns ok with the call-compose-first hint', async () => {
    const tools = makeTools(noopHost());
    const session = blankSession();
    const res = asOk(await tool(tools, 'generate_bom')({}, session));
    expect(res.output).toMatch(/compose_assembly/i);
    const meta = res.meta as { report: BomReport; csv: string };
    expect(meta.csv).toMatch(/^Part,Quantity,Material,Cost \(USD\)/);
    expect(meta.report.lines).toHaveLength(0);
  });

  it('happy path: modules + partsList + costLookup → full report + csv in meta', async () => {
    const tools = makeTools(noopHost());
    const session = blankSession();
    session.modules = { bracket: '', bolt: '' };
    const res = asOk(await tool(tools, 'generate_bom')(
      {
        partsList: [
          { moduleName: 'bracket', count: 1 },
          { moduleName: 'bolt', count: 4 },
        ],
        costLookup: {
          bracket: { unitCostUsd: 20, material: 'aluminum_6061' },
          bolt: { unitCostUsd: 2 },
        },
      },
      session,
    ));
    const meta = res.meta as { report: BomReport; csv: string };
    expect(meta.report.uniquePartCount).toBe(2);
    expect(meta.report.totalPartCount).toBe(5);
    expect(meta.report.totalCostUsd).toBe(28);
    expect(meta.csv.split('\n')).toHaveLength(3); // header + 2 lines
    expect(res.output).toMatch(/\$28\.00/);
  });
});

describe('generateBom — count:0/negative and costLookup mismatch (dogfooding round 3)', () => {
  const emptySession = { modules: {}, composition: null } as unknown as AgentSession;

  it('count:0 or negative omits the line entirely — NOT floored to quantity 1 (no phantom part)', () => {
    const r = generateBom({
      session: emptySession,
      partsList: [
        { moduleName: 'weird_part', count: 0 },
        { moduleName: 'neg_part', count: -5 },
        { moduleName: 'real_part', count: 3 },
      ],
    });
    expect(r.lines.find((l) => l.partName === 'weird_part')).toBeUndefined();
    expect(r.lines.find((l) => l.partName === 'neg_part')).toBeUndefined();
    expect(r.lines.find((l) => l.partName === 'real_part')?.quantity).toBe(3);
    expect(r.notes.some((n) => n.includes('omitted'))).toBe(true);
  });

  it('a genuinely-missing count (undefined) still defaults to 1 (unchanged behavior)', () => {
    const r = generateBom({ session: emptySession, partsList: [{ moduleName: 'p' }] });
    expect(r.lines.find((l) => l.partName === 'p')?.quantity).toBe(1);
  });

  it('a costLookup key that never matches a part name surfaces a diagnostic note, not silent hasCosts:false', () => {
    const r = generateBom({
      session: emptySession,
      partsList: [{ moduleName: 'Bracket_L', count: 3 }],
      costLookup: { bracket_l: { unitCostUsd: 10 } }, // case mismatch
    });
    expect(r.hasCosts).toBe(false);
    expect(r.notes.some((n) => n.includes('bracket_l'))).toBe(true);
  });

  it('a matching costLookup key still applies costs normally (no false positive from the new check)', () => {
    const r = generateBom({
      session: emptySession,
      partsList: [{ moduleName: 'bracket', count: 2 }],
      costLookup: { bracket: { unitCostUsd: 5 } },
    });
    expect(r.hasCosts).toBe(true);
    expect(r.totalCostUsd).toBe(10);
    expect(r.notes.some((n) => n.includes('never matched'))).toBe(false);
  });
});
