import { describe, expect, it } from 'vitest';
import { buildRadianceExecutionPlan, calculateAnnualDaylightMetrics, parseAnnualIlluminanceMatrix, parseRtraceRgbIlluminance, runRadianceExecutionPlan, type RadianceCommandExecutor } from '../radianceExecution';

describe('radiance execution evidence', () => {
  it('uses only an executable allowlist and reports missing tools as not_run', async () => {
    const plan = buildRadianceExecutionPlan('point_in_time');
    const executor: RadianceCommandExecutor = { available: async name => name === 'oconv', run: async () => { throw new Error('must not run'); } };
    expect(plan.commands.every(command => !command.args.some(arg => /[;&|]/.test(arg)))).toBe(true);
    await expect(runRadianceExecutionPlan(plan, executor)).resolves.toEqual({ status: 'not_run', outputs: {}, errors: ['missing_executable:rtrace'] });
  });

  it('parses RGB rows into photopic illuminance and fails closed on row mismatch', () => {
    expect(parseRtraceRgbIlluminance('1 1 1\n0 0 0\n', 2)).toEqual([179, 0]);
    expect(() => parseRtraceRgbIlluminance('1 1 1\n', 2)).toThrow('sensor_row_count');
  });

  it('requires exact annual dimensions and calculates sDA/ASE', () => {
    const bright = Array(251).fill(1100).concat(Array(249).fill(0));
    const useful = Array(250).fill(300).concat(Array(250).fill(0));
    const source = `${bright.join(' ')}\n${useful.join(' ')}`;
    const matrix = parseAnnualIlluminanceMatrix(source, 2, 500);
    expect(calculateAnnualDaylightMetrics(matrix)).toMatchObject({ sda300_50Percent: 100, ase1000_250Percent: 50 });
    expect(() => parseAnnualIlluminanceMatrix('1 2\n3', 2, 2)).toThrow('timestep_column_count');
  });

  it('stops on a non-zero tool exit', async () => {
    const executor: RadianceCommandExecutor = { available: async () => true, run: async command => command.executable === 'oconv' ? { exitCode: 2, stdout: '', stderr: 'bad scene' } : { exitCode: 0, stdout: '', stderr: '' } };
    await expect(runRadianceExecutionPlan(buildRadianceExecutionPlan('point_in_time'), executor)).resolves.toMatchObject({ status: 'fail', errors: ['oconv:exit_2', 'bad scene'] });
  });
});
