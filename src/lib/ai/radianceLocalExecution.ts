import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join } from 'node:path';
import { spawn } from 'node:child_process';
import { RADIANCE_EXECUTABLES, type RadianceExecutable, type RadianceExecutionPlan, type RadianceRunStatus } from './radianceExecution';

export type RadianceExecutablePaths = Partial<Record<RadianceExecutable, string>>;
export interface RadianceLocalExecutionInput { plan: RadianceExecutionPlan; artifacts: Readonly<Record<string, string | Uint8Array>>; executablePaths: RadianceExecutablePaths; timeoutMs?: number; maxOutputBytes?: number }
export interface RadianceLocalExecutionResult { status: RadianceRunStatus; outputs: Record<string, Uint8Array>; errors: string[] }
export interface RadianceReadinessResult { status: RadianceRunStatus; ready: boolean; executables: Record<RadianceExecutable, boolean>; version?: string; features?: string; errors: string[] }

const artifactPattern = /^(?:scene\.rad|sky\.rad|sensors\.pts|weather\.wea|scene\.oct|sky\.mtx|daylight-coefficients\.mtx|annual-rgb\.mtx|annual-illuminance\.mtx|illuminance\.rgb)$/;
const executableSet = new Set<string>(RADIANCE_EXECUTABLES);

export function radianceExecutablePathsFromEnvironment(env: Readonly<Record<string, string | undefined>> = process.env): RadianceExecutablePaths {
  return { oconv: env.RADIANCE_OCONV_PATH, rtrace: env.RADIANCE_RTRACE_PATH, rfluxmtx: env.RADIANCE_RFLUXMTX_PATH, gendaymtx: env.RADIANCE_GENDAYMTX_PATH, dctimestep: env.RADIANCE_DCTIMESTEP_PATH, rmtxop: env.RADIANCE_RMTXOP_PATH };
}

export function validateRadianceExecutablePath(executable: RadianceExecutable, path: string): string {
  if (!executableSet.has(executable) || !isAbsolute(path)) throw new Error(`invalid_executable_path:${executable}`);
  const file = basename(path).toLowerCase();
  if (file !== executable && file !== `${executable}.exe`) throw new Error(`executable_name_mismatch:${executable}`);
  return path;
}

function safeArtifact(name: string): string {
  if (!artifactPattern.test(name)) throw new Error(`invalid_radiance_artifact:${name}`);
  return name;
}

function validateTextArtifact(name: string, value: string): void {
  if (value.includes('\0')) throw new Error(`invalid_radiance_text:${name}`);
  if ((name.endsWith('.rad') || name.endsWith('.wea') || name.endsWith('.pts')) && /(^|\r?\n)\s*!/.test(value)) throw new Error(`radiance_shell_escape_forbidden:${name}`);
}

async function runProcess(path: string, args: readonly string[], cwd: string, stdin: Uint8Array | undefined, timeoutMs: number, maxOutputBytes: number): Promise<{ exitCode: number; stdout: Uint8Array; stderr: string; error?: string }> {
  return new Promise(resolve => {
    const child = spawn(path, [...args], { cwd, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    let bytes = 0, settled = false;
    const finish = (result: { exitCode: number; stdout: Uint8Array; stderr: string; error?: string }) => { if (!settled) { settled = true; clearTimeout(timer); resolve(result); } };
    const timer = setTimeout(() => { child.kill(); finish({ exitCode: -1, stdout: new Uint8Array(), stderr: '', error: 'execution_timeout' }); }, timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > maxOutputBytes) { child.kill(); finish({ exitCode: -1, stdout: new Uint8Array(), stderr: '', error: 'output_limit_exceeded' }); } else stdout.push(chunk); });
    child.stderr.on('data', (chunk: Buffer) => { if (stderr.reduce((sum, item) => sum + item.length, 0) < 64 * 1024) stderr.push(chunk); });
    child.on('error', error => finish({ exitCode: -1, stdout: new Uint8Array(), stderr: '', error: `spawn_error:${error.message}` }));
    child.on('close', code => finish({ exitCode: code ?? -1, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString('utf8') }));
    if (stdin) child.stdin.end(stdin); else child.stdin.end();
  });
}

export async function inspectRadianceReadiness(executablePaths: RadianceExecutablePaths): Promise<RadianceReadinessResult> {
  if (process.env.CAD_RUNTIME_EXTERNAL_WORKER === '1') {
    const { runCadRuntimeJob } = await import('@/lib/cad-runtime/redisCadRuntimeJobs');
    const result = await runCadRuntimeJob({ kind: 'tool-readiness', tool: 'radiance' }, 20_000);
    if (result.kind !== 'tool-readiness' || result.tool !== 'radiance') throw new Error('CAD_RUNTIME_RESULT_MISMATCH');
    const executables = Object.fromEntries(RADIANCE_EXECUTABLES.map(name => [name, result.ready])) as Record<RadianceExecutable, boolean>;
    return {
      status: result.ready ? 'pass' : 'fail',
      ready: result.ready,
      executables,
      version: result.detail?.slice(0, 2048),
      features: result.detail?.slice(0, 16 * 1024),
      errors: result.ready ? [] : [result.error ?? 'radiance_worker_not_ready'],
    };
  }
  const executables = Object.fromEntries(RADIANCE_EXECUTABLES.map(name => [name, false])) as Record<RadianceExecutable, boolean>;
  const resolved = new Map<RadianceExecutable, string>(), errors: string[] = [];
  for (const executable of RADIANCE_EXECUTABLES) {
    const configured = executablePaths[executable];
    if (!configured) { errors.push(`missing_executable:${executable}`); continue; }
    try { const path = validateRadianceExecutablePath(executable, configured); await access(path, constants.X_OK); resolved.set(executable, path); executables[executable] = true; } catch (error) { errors.push(error instanceof Error && error.message.startsWith('executable_') ? error.message : `missing_executable:${executable}`); }
  }
  if (errors.length) return { status: 'not_run', ready: false, executables, errors };
  const rtrace = resolved.get('rtrace')!;
  const versionResult = await runProcess(rtrace, ['-version'], tmpdir(), undefined, 10_000, 1024 * 1024);
  const featuresResult = await runProcess(rtrace, ['-features'], tmpdir(), undefined, 10_000, 1024 * 1024);
  const version = `${Buffer.from(versionResult.stdout).toString('utf8')}\n${versionResult.stderr}`.trim();
  const features = `${Buffer.from(featuresResult.stdout).toString('utf8')}\n${featuresResult.stderr}`.trim();
  if (versionResult.error || versionResult.exitCode !== 0) errors.push(versionResult.error ?? `rtrace_version:exit_${versionResult.exitCode}`);
  if (featuresResult.error || featuresResult.exitCode !== 0) errors.push(featuresResult.error ?? `rtrace_features:exit_${featuresResult.exitCode}`);
  if (!/RADIANCE|rtrace/i.test(version)) errors.push('radiance_version_unrecognized');
  if (!features) errors.push('radiance_features_empty');
  const ready = errors.length === 0;
  return { status: ready ? 'pass' : 'fail', ready, executables, version: version.slice(0, 2048), features: features.slice(0, 16 * 1024), errors };
}

export async function executeRadianceLocally(input: RadianceLocalExecutionInput): Promise<RadianceLocalExecutionResult> {
  const timeoutMs = input.timeoutMs ?? 120_000, maxOutputBytes = input.maxOutputBytes ?? 64 * 1024 * 1024;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 100 || timeoutMs > 600_000 || !Number.isFinite(maxOutputBytes) || maxOutputBytes < 1024 || maxOutputBytes > 512 * 1024 * 1024) throw new Error('invalid_radiance_resource_limit');
  if (process.env.CAD_RUNTIME_EXTERNAL_WORKER === '1') {
    for (const name of Object.keys(input.artifacts)) safeArtifact(name);
    const artifacts = Object.fromEntries(Object.entries(input.artifacts).map(([name, value]) => {
      if (typeof value === 'string') {
        validateTextArtifact(name, value);
        return [name, { encoding: 'utf8' as const, data: value }];
      }
      return [name, { encoding: 'base64' as const, data: Buffer.from(value).toString('base64') }];
    }));
    const { runCadRuntimeJob } = await import('@/lib/cad-runtime/redisCadRuntimeJobs');
    const result = await runCadRuntimeJob({ kind: 'radiance', plan: input.plan, artifacts, timeoutMs, maxOutputBytes }, timeoutMs + 30_000);
    if (result.kind !== 'radiance') throw new Error('CAD_RUNTIME_RESULT_MISMATCH');
    return {
      status: result.status,
      outputs: Object.fromEntries(Object.entries(result.outputs).map(([name, value]) => [name, Uint8Array.from(Buffer.from(value, 'base64'))])),
      errors: result.errors,
    };
  }
  const paths = new Map<RadianceExecutable, string>(), missing: string[] = [];
  for (const executable of input.plan.requiredExecutables) {
    const configured = input.executablePaths[executable];
    if (!configured) { missing.push(executable); continue; }
    const path = validateRadianceExecutablePath(executable, configured);
    try { await access(path, constants.X_OK); paths.set(executable, path); } catch { missing.push(executable); }
  }
  if (missing.length) return { status: 'not_run', outputs: {}, errors: missing.map(name => `missing_executable:${name}`) };
  for (const name of Object.keys(input.artifacts)) safeArtifact(name);
  const workdir = await mkdtemp(join(tmpdir(), 'nexyfab-radiance-'));
  const outputs: Record<string, Uint8Array> = {};
  try {
    for (const [name, value] of Object.entries(input.artifacts)) { if (typeof value === 'string') validateTextArtifact(name, value); await writeFile(join(workdir, safeArtifact(name)), value); }
    for (const command of input.plan.commands) {
      if (!input.plan.requiredExecutables.includes(command.executable)) return { status: 'fail', outputs, errors: [`undeclared_executable:${command.executable}`] };
      const stdin = command.stdinArtifact ? await readFile(join(workdir, safeArtifact(command.stdinArtifact))) : undefined;
      const result = await runProcess(paths.get(command.executable)!, command.args, workdir, stdin, timeoutMs, maxOutputBytes);
      if (result.error || result.exitCode !== 0) return { status: 'fail', outputs, errors: [result.error ?? `${command.executable}:exit_${result.exitCode}`, ...(result.stderr.trim() ? [result.stderr.trim()] : [])] };
      const outputName = safeArtifact(command.stdoutArtifact);
      outputs[outputName] = result.stdout;
      await writeFile(join(workdir, outputName), result.stdout);
    }
    return { status: 'pass', outputs, errors: [] };
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}
