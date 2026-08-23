import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  resolveArchitectureInteriorGoldenCampaignSources,
  type ArchitectureInteriorGoldenSourceBindings,
} from './architectureInteriorGoldenCampaignSourceResolver';
import { ARCHITECTURE_INTERIOR_GOLDEN_SCENARIOS } from './architectureInteriorGoldenScenarios';

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function makeFixture(): { root: string; sources: ArchitectureInteriorGoldenSourceBindings; files: Map<string, Buffer> } {
  const root = mkdtempSync(path.join(os.tmpdir(), 'architecture-interior-golden-resolver-'));
  temporaryRoots.push(root);
  const files = new Map<string, Buffer>();
  const sources: Record<string, Record<string, { sourcePath: string; bytes: number; sha256: string }>> = {};
  for (const scenario of ARCHITECTURE_INTERIOR_GOLDEN_SCENARIOS) {
    const scenarioRoot = path.join(root, scenario.id);
    mkdirSync(scenarioRoot, { recursive: true });
    sources[scenario.id] = {};
    for (const input of scenario.authoritativeInputs) {
      const data = Buffer.from(`${scenario.id}:${input.id}:actual-source\n`, 'utf8');
      const filePath = path.join(scenarioRoot, `${input.id}.bin`);
      writeFileSync(filePath, data);
      files.set(`${scenario.id}:${input.id}`, data);
      sources[scenario.id][input.id] = {
        sourcePath: path.relative(root, filePath),
        bytes: data.byteLength,
        sha256: createHash('sha256').update(data).digest('hex'),
      };
    }
  }
  return { root, sources, files };
}

function cloneSources(sources: ArchitectureInteriorGoldenSourceBindings): Record<string, Record<string, any>> {
  return structuredClone(sources) as Record<string, Record<string, any>>;
}

function issuesOf(result: ReturnType<typeof resolveArchitectureInteriorGoldenCampaignSources>): string[] {
  if ('issues' in result) return result.issues;
  throw new Error('expected resolver failure');
}

describe('resolveArchitectureInteriorGoldenCampaignSources', () => {
  it('reads the exact six-scenario input set and returns deterministic hashes/artifacts', () => {
    const fixture = makeFixture();
    const result = resolveArchitectureInteriorGoldenCampaignSources({ approvedRoots: [fixture.root], sources: fixture.sources });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.inputSourceHashes)).toEqual(ARCHITECTURE_INTERIOR_GOLDEN_SCENARIOS.map(item => item.id));
    expect(result.artifacts).toHaveLength(ARCHITECTURE_INTERIOR_GOLDEN_SCENARIOS.reduce((total, scenario) => total + scenario.authoritativeInputs.length, 0));
    expect(result.artifacts.map(item => `${item.scenarioId}:${item.inputId}`)).toEqual(
      ARCHITECTURE_INTERIOR_GOLDEN_SCENARIOS.flatMap(scenario => scenario.authoritativeInputs.map(input => `${scenario.id}:${input.id}`)),
    );
    for (const artifact of result.artifacts) {
      const actual = fixture.files.get(`${artifact.scenarioId}:${artifact.inputId}`)!;
      expect(artifact.bytes).toBe(actual.byteLength);
      expect(artifact.sha256).toBe(createHash('sha256').update(actual).digest('hex'));
      expect(result.inputSourceHashes[artifact.scenarioId][artifact.inputId]).toBe(artifact.sha256);
    }
    expect('licenseApproved' in result).toBe(false);
    expect('scoreEligible' in result).toBe(false);
  });

  it('rejects tampered declared bytes and hash bindings', () => {
    const fixture = makeFixture();
    const sources = cloneSources(fixture.sources);
    const first = ARCHITECTURE_INTERIOR_GOLDEN_SCENARIOS[0].authoritativeInputs[0].id;
    sources[ARCHITECTURE_INTERIOR_GOLDEN_SCENARIOS[0].id][first].bytes += 1;
    sources[ARCHITECTURE_INTERIOR_GOLDEN_SCENARIOS[0].id][first].sha256 = 'a'.repeat(64);
    const result = resolveArchitectureInteriorGoldenCampaignSources({ approvedRoots: [fixture.root], sources });

    expect(result.ok).toBe(false);
    expect(issuesOf(result)).toContain(`declared_bytes_mismatch:${ARCHITECTURE_INTERIOR_GOLDEN_SCENARIOS[0].id}:${first}`);
    expect(issuesOf(result)).toContain(`declared_hash_mismatch:${ARCHITECTURE_INTERIOR_GOLDEN_SCENARIOS[0].id}:${first}`);
  });

  it('rejects ambiguous declaration aliases and an unbounded approved-root list', () => {
    const fixture = makeFixture();
    const sources = cloneSources(fixture.sources);
    const scenario = ARCHITECTURE_INTERIOR_GOLDEN_SCENARIOS[0];
    const inputId = scenario.authoritativeInputs[0].id;
    sources[scenario.id][inputId].declaredBytes = sources[scenario.id][inputId].bytes + 1;
    sources[scenario.id][inputId].declaredSha256 = 'f'.repeat(64);
    const ambiguous = resolveArchitectureInteriorGoldenCampaignSources({ approvedRoots: [fixture.root], sources });
    expect(ambiguous.ok).toBe(false);
    expect(issuesOf(ambiguous)).toContain(`declared_bytes_ambiguous:${scenario.id}:${inputId}`);
    expect(issuesOf(ambiguous)).toContain(`declared_hash_ambiguous:${scenario.id}:${inputId}`);

    const excessiveRoots = resolveArchitectureInteriorGoldenCampaignSources({ approvedRoots: Array(33).fill(fixture.root), sources: fixture.sources });
    expect(excessiveRoots.ok).toBe(false);
    expect(issuesOf(excessiveRoots)).toContain('approved_roots_limit_exceeded');
  });

  it('rejects missing and extra scenarios or input IDs', () => {
    const fixture = makeFixture();
    const sources = cloneSources(fixture.sources);
    const scenario = ARCHITECTURE_INTERIOR_GOLDEN_SCENARIOS[0];
    const missingInput = scenario.authoritativeInputs[0].id;
    delete sources[scenario.id][missingInput];
    sources[scenario.id].unexpected = sources[scenario.id][scenario.authoritativeInputs[1].id];
    sources.unexpected_scenario = {};
    const result = resolveArchitectureInteriorGoldenCampaignSources({ approvedRoots: [fixture.root], sources });

    expect(result.ok).toBe(false);
    expect(issuesOf(result)).toContain(`scenario_extra:unexpected_scenario`);
    expect(issuesOf(result)).toContain(`input_missing:${scenario.id}:${missingInput}`);
    expect(issuesOf(result)).toContain(`input_extra:${scenario.id}:unexpected`);
  });

  it('rejects traversal and absolute paths outside every approved root', () => {
    const fixture = makeFixture();
    const outsideRoot = mkdtempSync(path.join(os.tmpdir(), 'architecture-interior-golden-outside-'));
    temporaryRoots.push(outsideRoot);
    const outside = path.join(outsideRoot, 'outside.bin');
    writeFileSync(outside, 'outside');
    const sources = cloneSources(fixture.sources);
    const scenario = ARCHITECTURE_INTERIOR_GOLDEN_SCENARIOS[0];
    const input = scenario.authoritativeInputs[0].id;
    sources[scenario.id][input].sourcePath = '../outside.bin';
    let result = resolveArchitectureInteriorGoldenCampaignSources({ approvedRoots: [fixture.root], sources });
    expect(result.ok).toBe(false);
    expect(issuesOf(result)).toContain(`source_path_traversal:${scenario.id}:${input}`);

    sources[scenario.id][input].sourcePath = outside;
    result = resolveArchitectureInteriorGoldenCampaignSources({ approvedRoots: [fixture.root], sources });
    expect(result.ok).toBe(false);
    expect(issuesOf(result)).toContain(`source_path_outside_root:${scenario.id}:${input}`);
  });

  it('rejects symlink escape when the platform permits creating a symlink', () => {
    const fixture = makeFixture();
    const outsideRoot = mkdtempSync(path.join(os.tmpdir(), 'architecture-interior-golden-link-outside-'));
    temporaryRoots.push(outsideRoot);
    const outside = path.join(outsideRoot, 'outside.bin');
    writeFileSync(outside, 'outside');
    const link = path.join(fixture.root, 'linked.bin');
    try {
      symlinkSync(outside, link, 'file');
    } catch {
      return;
    }
    const sources = cloneSources(fixture.sources);
    const scenario = ARCHITECTURE_INTERIOR_GOLDEN_SCENARIOS[0];
    const input = scenario.authoritativeInputs[0].id;
    sources[scenario.id][input].sourcePath = 'linked.bin';
    const result = resolveArchitectureInteriorGoldenCampaignSources({ approvedRoots: [fixture.root], sources });
    expect(result.ok).toBe(false);
    expect(issuesOf(result)).toContain(`source_path_symlink:${scenario.id}:${input}`);
  });

  it('rejects directories, duplicate realpaths, and missing approved roots', () => {
    const fixture = makeFixture();
    const sources = cloneSources(fixture.sources);
    const scenario = ARCHITECTURE_INTERIOR_GOLDEN_SCENARIOS[0];
    const first = scenario.authoritativeInputs[0].id;
    const second = scenario.authoritativeInputs[1].id;
    sources[scenario.id][first].sourcePath = scenario.id;
    sources[scenario.id][second].sourcePath = sources[scenario.id][scenario.authoritativeInputs[2].id].sourcePath;
    const result = resolveArchitectureInteriorGoldenCampaignSources({ approvedRoots: [fixture.root], sources });
    expect(result.ok).toBe(false);
    expect(issuesOf(result)).toContain(`source_not_regular_file:${scenario.id}:${first}`);
    expect(issuesOf(result)).toContain(`source_path_duplicate_realpath:${scenario.id}:${second}:${scenario.id}:${scenario.authoritativeInputs[2].id}`);
    const noRoots = resolveArchitectureInteriorGoldenCampaignSources({ approvedRoots: [], sources: fixture.sources });
    expect(noRoots.ok).toBe(false);
    expect(issuesOf(noRoots)).toContain('approved_roots_required');
  });

  it('enforces per-file and aggregate byte caps before accepting a result', () => {
    const fixture = makeFixture();
    const result = resolveArchitectureInteriorGoldenCampaignSources({ approvedRoots: [fixture.root], sources: fixture.sources, maxFileBytes: 1 });
    expect(result.ok).toBe(false);
    expect(issuesOf(result).some(issue => issue.startsWith('source_file_bytes_cap:'))).toBe(true);

    const total = resolveArchitectureInteriorGoldenCampaignSources({ approvedRoots: [fixture.root], sources: fixture.sources, maxTotalBytes: 1 });
    expect(total.ok).toBe(false);
    expect(issuesOf(total).some(issue => issue.startsWith('source_total_bytes_cap:'))).toBe(true);
  });
});
