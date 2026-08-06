export const RADIANCE_EXECUTABLES = ['oconv', 'rtrace', 'rfluxmtx', 'gendaymtx', 'dctimestep', 'rmtxop'] as const;
export type RadianceExecutable = (typeof RADIANCE_EXECUTABLES)[number];
export type RadianceRunStatus = 'pass' | 'fail' | 'not_run';

export interface RadianceCommand {
  executable: RadianceExecutable;
  args: string[];
  stdinArtifact?: string;
  stdoutArtifact: string;
}

export interface RadianceExecutionPlan {
  kind: 'point_in_time' | 'annual';
  commands: RadianceCommand[];
  requiredExecutables: RadianceExecutable[];
}

export interface RadianceCommandExecutor {
  available(executable: RadianceExecutable): Promise<boolean>;
  run(command: RadianceCommand): Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

const pointInTimeCommands: RadianceCommand[] = [
  { executable: 'oconv', args: ['scene.rad', 'sky.rad'], stdoutArtifact: 'scene.oct' },
  { executable: 'rtrace', args: ['-I+', '-h', '-ab', '5', '-ad', '2048', '-as', '512', '-aa', '0.1', 'scene.oct'], stdinArtifact: 'sensors.pts', stdoutArtifact: 'illuminance.rgb' },
];

const annualCommands: RadianceCommand[] = [
  { executable: 'oconv', args: ['scene.rad'], stdoutArtifact: 'scene.oct' },
  { executable: 'gendaymtx', args: ['-m', '1', 'weather.wea'], stdoutArtifact: 'sky.mtx' },
  { executable: 'rfluxmtx', args: ['-I+', '-ab', '5', '-ad', '4096', '-lw', '1e-5', 'scene.oct'], stdinArtifact: 'sensors.pts', stdoutArtifact: 'daylight-coefficients.mtx' },
  { executable: 'dctimestep', args: ['daylight-coefficients.mtx', 'sky.mtx'], stdoutArtifact: 'annual-rgb.mtx' },
  { executable: 'rmtxop', args: ['-h', '-fa', '-c', '47.435', '119.93', '11.635', 'annual-rgb.mtx'], stdoutArtifact: 'annual-illuminance.mtx' },
];

export function buildRadianceExecutionPlan(kind: RadianceExecutionPlan['kind']): RadianceExecutionPlan {
  const commands = (kind === 'annual' ? annualCommands : pointInTimeCommands).map(command => ({ ...command, args: [...command.args] }));
  return { kind, commands, requiredExecutables: [...new Set(commands.map(command => command.executable))] };
}

export async function runRadianceExecutionPlan(plan: RadianceExecutionPlan, executor: RadianceCommandExecutor): Promise<{ status: RadianceRunStatus; outputs: Record<string, string>; errors: string[] }> {
  const missing: string[] = [];
  for (const executable of plan.requiredExecutables) if (!(await executor.available(executable))) missing.push(executable);
  if (missing.length) return { status: 'not_run', outputs: {}, errors: missing.map(name => `missing_executable:${name}`) };
  const outputs: Record<string, string> = {};
  for (const command of plan.commands) {
    const result = await executor.run(command);
    if (result.exitCode !== 0) return { status: 'fail', outputs, errors: [`${command.executable}:exit_${result.exitCode}`, ...(result.stderr.trim() ? [result.stderr.trim()] : [])] };
    outputs[command.stdoutArtifact] = result.stdout;
  }
  return { status: 'pass', outputs, errors: [] };
}

function numericRows(source: string): number[][] {
  return source.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#')).map((line, row) => {
    const values = line.split(/\s+/).map(Number);
    if (!values.length || values.some(value => !Number.isFinite(value) || value < 0)) throw new Error(`invalid_numeric_row:${row + 1}`);
    return values;
  });
}

export function parseRtraceRgbIlluminance(source: string, sensorCount: number): number[] {
  if (!Number.isInteger(sensorCount) || sensorCount <= 0) throw new Error('invalid_sensor_count');
  const rows = numericRows(source);
  if (rows.length !== sensorCount) throw new Error(`sensor_row_count:${rows.length}/${sensorCount}`);
  return rows.map((values, row) => {
    if (values.length !== 3) throw new Error(`rgb_column_count:${row + 1}`);
    return 179 * (0.265 * values[0] + 0.67 * values[1] + 0.065 * values[2]);
  });
}

export function parseAnnualIlluminanceMatrix(source: string, sensorCount: number, timestepCount: number): number[][] {
  if (!Number.isInteger(sensorCount) || sensorCount <= 0 || !Number.isInteger(timestepCount) || timestepCount <= 0) throw new Error('invalid_matrix_dimensions');
  const rows = numericRows(source);
  if (rows.length !== sensorCount) throw new Error(`sensor_row_count:${rows.length}/${sensorCount}`);
  rows.forEach((row, index) => { if (row.length !== timestepCount) throw new Error(`timestep_column_count:${index + 1}:${row.length}/${timestepCount}`); });
  return rows;
}

export function calculateAnnualDaylightMetrics(matrixLux: readonly (readonly number[])[], timestepHours = 1): { sda300_50Percent: number; ase1000_250Percent: number; sensorCount: number; timestepCount: number } {
  if (!matrixLux.length || !Number.isFinite(timestepHours) || timestepHours <= 0) throw new Error('invalid_annual_matrix');
  const timestepCount = matrixLux[0].length;
  if (!timestepCount || matrixLux.some(row => row.length !== timestepCount || row.some(value => !Number.isFinite(value) || value < 0))) throw new Error('invalid_annual_matrix');
  const sda = matrixLux.filter(row => row.filter(value => value >= 300).length / timestepCount >= 0.5).length;
  const ase = matrixLux.filter(row => row.filter(value => value > 1000).length * timestepHours > 250).length;
  return { sda300_50Percent: sda / matrixLux.length * 100, ase1000_250Percent: ase / matrixLux.length * 100, sensorCount: matrixLux.length, timestepCount };
}
