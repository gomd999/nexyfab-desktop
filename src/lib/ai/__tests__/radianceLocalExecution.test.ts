import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildRadianceExecutionPlan } from '../radianceExecution';
import { executeRadianceLocally, inspectRadianceReadiness, radianceExecutablePathsFromEnvironment, validateRadianceExecutablePath } from '../radianceLocalExecution';

describe('local Radiance process boundary', () => {
  it('accepts only absolute, correctly named executable paths', () => {
    const absolute = join(process.cwd(), process.platform === 'win32' ? 'rtrace.exe' : 'rtrace');
    expect(validateRadianceExecutablePath('rtrace', absolute)).toBe(absolute);
    expect(() => validateRadianceExecutablePath('rtrace', 'rtrace')).toThrow('invalid_executable_path');
    expect(() => validateRadianceExecutablePath('rtrace', join(process.cwd(), 'cmd.exe'))).toThrow('executable_name_mismatch');
  });

  it('maps only fixed server environment variables', () => {
    expect(radianceExecutablePathsFromEnvironment({ RADIANCE_RTRACE_PATH: 'C:\\Radiance\\rtrace.exe', EVIL: 'ignored' })).toEqual({ oconv: undefined, rtrace: 'C:\\Radiance\\rtrace.exe', rfluxmtx: undefined, gendaymtx: undefined, dctimestep: undefined, rmtxop: undefined });
  });

  it('returns not_run before creating a workspace when tools are unconfigured', async () => {
    await expect(executeRadianceLocally({ plan: buildRadianceExecutionPlan('point_in_time'), artifacts: { 'scene.rad': '', 'sky.rad': '', 'sensors.pts': '' }, executablePaths: {} })).resolves.toEqual({ status: 'not_run', outputs: {}, errors: ['missing_executable:oconv', 'missing_executable:rtrace'] });
  });

  it('reports per-tool readiness without exposing a false pass', async () => {
    const result = await inspectRadianceReadiness({});
    expect(result).toMatchObject({ status: 'not_run', ready: false, executables: { oconv: false, rtrace: false, rfluxmtx: false, gendaymtx: false, dctimestep: false, rmtxop: false } });
    expect(result.errors).toHaveLength(6);
  });

  it('rejects unsafe artifact names', async () => {
    const plan = { kind: 'point_in_time' as const, commands: [], requiredExecutables: [] };
    await expect(executeRadianceLocally({ plan, artifacts: { '../scene.rad': '' }, executablePaths: {} })).rejects.toThrow('invalid_radiance_artifact');
  });

  it('rejects Radiance shell escapes before process execution', async () => {
    const plan = { kind: 'point_in_time' as const, commands: [], requiredExecutables: [] };
    await expect(executeRadianceLocally({ plan, artifacts: { 'scene.rad': '!del important-file' }, executablePaths: {} })).rejects.toThrow('radiance_shell_escape_forbidden');
  });
});
