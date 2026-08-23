import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const cli = resolve('scripts/drawing-to-3d/cli.mjs');

function run(args: string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 15_000,
  });
}

describe('drawing CLI bounded commercial contract', () => {
  it('requires explicit write approval before a convenience command can create output', () => {
    const root = mkdtempSync(join(tmpdir(), 'nexyfab-cli-contract-'));
    const assemblyPath = join(root, 'assembly.json');
    const outputPath = join(root, 'resolved.json');
    writeFileSync(assemblyPath, JSON.stringify({ parts: [] }));
    const result = run(['constraints', assemblyPath, '--out', outputPath, '--raw'], { NEXYFAB_PROJECT_ROOT: root });
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, code: 'CLI_WRITE_APPROVAL_REQUIRED' });
    expect(existsSync(outputPath)).toBe(false);
  });

  it('reuses project binding and writes only after approval', () => {
    const root = mkdtempSync(join(tmpdir(), 'nexyfab-cli-contract-'));
    const assemblyPath = join(root, 'assembly.json');
    const outputPath = join(root, 'resolved.json');
    writeFileSync(assemblyPath, JSON.stringify({ parts: [] }));
    const result = run(['constraints', assemblyPath, '--out', outputPath, '--confirm-write', '--raw'], { NEXYFAB_PROJECT_ROOT: root });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, savedAssembly: outputPath });
    expect(JSON.parse(readFileSync(outputPath, 'utf8'))).toEqual({ parts: [] });
  });

  it('rejects output outside the trusted project root and keeps output JSONL', () => {
    const root = mkdtempSync(join(tmpdir(), 'nexyfab-cli-contract-'));
    const assemblyPath = join(root, 'assembly.json');
    const outsidePath = join(root, '..', 'outside-resolved.json');
    writeFileSync(assemblyPath, JSON.stringify({ parts: [] }));
    const result = run(['constraints', assemblyPath, '--out', outsidePath, '--confirm-write', '--raw'], { NEXYFAB_PROJECT_ROOT: root });
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, code: 'PATH_OUTSIDE_PROJECT_ROOT' });
    expect(result.stdout.trim().split('\n')).toHaveLength(1);
  });

  it('requires explicit approval before a remote route, without making a live request', () => {
    const result = run(['domain', 'civil', '--fixture', 'steel-beam', '--raw'], { NEXYFAB_API_KEY: 'test-only-key' });
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, code: 'CLI_REMOTE_APPROVAL_REQUIRED' });
    expect(result.stdout).not.toContain('test-only-key');
  });

  it('does not demand remote-call approval for a locally executed tool', () => {
    const root = mkdtempSync(join(tmpdir(), 'nexyfab-cli-contract-'));
    // text_to_assembly has an optional hosted route when an API key is set,
    // but remains a deterministic local tool without one.
    const result = run(['assemble', '100 mm cube', '--raw'], {
      NEXYFAB_PROJECT_ROOT: root,
      NEXYFAB_API_KEY: '',
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true });
    expect(result.stdout).not.toContain('CLI_REMOTE_APPROVAL_REQUIRED');
  });
});
