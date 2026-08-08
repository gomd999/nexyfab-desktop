import { spawn } from 'node:child_process';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  runDomainCampaign,
  type DomainCampaignExecutor,
  type DomainCampaignState,
} from '../src/lib/ai/domainCampaignRunner';
import type { DomainAccuracyCase, DomainAccuracyRun } from '../src/lib/ai/domainAccuracyEvidence';
import { DOMAIN_ACCURACY_DOMAINS, type DomainAccuracyDomain } from '../src/lib/ai/domainAccuracyProgram';

export interface DomainCampaignCliArgs {
  domain: DomainAccuracyDomain;
  casesFile: string;
  stateFile: string;
  runsFile: string;
  executor: string;
  executorArgs: string[];
  timeoutMs: number;
}

export function parseDomainCampaignArgs(args: readonly string[]): DomainCampaignCliArgs {
  const one = (name: string) => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : undefined; };
  const domain = one('domain') as DomainAccuracyDomain | undefined;
  const casesFile = one('cases');
  const stateFile = one('state');
  const runsFile = one('runs');
  const executor = one('executor');
  const timeoutMs = Number(one('timeout-ms') ?? 600_000);
  if (!domain || !DOMAIN_ACCURACY_DOMAINS.includes(domain)) throw new TypeError(`--domain must be one of ${DOMAIN_ACCURACY_DOMAINS.join(', ')}`);
  if (!casesFile) throw new TypeError('--cases <approved-cases.json> is required');
  if (!stateFile) throw new TypeError('--state <campaign-state.json> is required');
  if (!runsFile) throw new TypeError('--runs <campaign-runs.json> is required');
  if (!executor) throw new TypeError('--executor <validator-executable> is required');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000) throw new TypeError('--timeout-ms must be an integer >= 1000');
  const executorArgs: string[] = [];
  for (let index = 0; index < args.length; index++) if (args[index] === '--executor-arg' && args[index + 1]) executorArgs.push(args[++index]!);
  return { domain, casesFile, stateFile, runsFile, executor, executorArgs, timeoutMs };
}

async function readArray<T>(file: string): Promise<T[]> {
  const value: unknown = JSON.parse(await readFile(resolve(file), 'utf8'));
  if (!Array.isArray(value)) throw new TypeError(`${file} must contain a JSON array`);
  return value as T[];
}

async function readState(file: string): Promise<DomainCampaignState | undefined> {
  try { return JSON.parse(await readFile(resolve(file), 'utf8')) as DomainCampaignState; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

async function atomicJson(file: string, value: unknown) {
  const target = resolve(file);
  const temporary = `${target}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, target);
}

export function processExecutor(command: string, commandArgs: readonly string[], timeoutMs: number): DomainCampaignExecutor {
  return input => new Promise<DomainAccuracyRun>((resolveResult, reject) => {
    const child = spawn(command, commandArgs, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false });
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    let bytes = 0, settled = false;
    const finish = (callback: () => void) => { if (!settled) { settled = true; clearTimeout(timer); callback(); } };
    const timer = setTimeout(() => {
      child.kill();
      finish(() => reject(new Error(`validator_timeout:${timeoutMs}`)));
    }, timeoutMs);
    child.stdout.on('data', chunk => {
      const value = Buffer.from(chunk); bytes += value.length;
      if (bytes > 10 * 1024 * 1024) { child.kill(); finish(() => reject(new Error('validator_stdout_limit_exceeded'))); }
      else stdout.push(value);
    });
    child.stderr.on('data', chunk => stderr.push(Buffer.from(chunk)));
    child.on('error', error => finish(() => reject(error)));
    child.on('close', code => finish(() => {
      if (code !== 0) return reject(new Error(`validator_exit_${code}:${Buffer.concat(stderr).toString('utf8').trim()}`));
      // 프로토콜(260808b 견고화): stdout 의 **마지막 비어있지 않은 줄**이 run
      // JSON 이다. 네이티브/wasm 라이브러리(OCC STEP 라이터 등)가 fd 레벨로
      // stdout 에 배너를 찍는 것은 JS 에서 막을 수 없음을 실측했다(0/300 사고)
      // — 전량 파싱 대신 마지막 줄 계약으로 배너 내성을 갖는다.
      const lines = Buffer.concat(stdout).toString('utf8').trim().split(/\r?\n/);
      const last = lines[lines.length - 1] ?? '';
      try { resolveResult(JSON.parse(last) as DomainAccuracyRun); }
      catch (error) { reject(new Error(`validator_output_invalid_json:${error instanceof Error ? error.message : String(error)}:${last.slice(0, 80)}`)); }
    }));
    child.stdin.end(JSON.stringify(input));
  });
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  try {
    const input = parseDomainCampaignArgs(args);
    const cases = await readArray<DomainAccuracyCase>(input.casesFile);
    const initial = await readState(input.stateFile);
    const state = await runDomainCampaign(
      input.domain,
      cases,
      processExecutor(input.executor, input.executorArgs, input.timeoutMs),
      initial,
      { onCheckpoint: value => atomicJson(input.stateFile, value) },
    );
    await atomicJson(input.runsFile, state.results);
    const failed = state.slots.filter(slot => slot.status !== 'completed');
    process.stdout.write(`${JSON.stringify({ domain: input.domain, suiteHash: state.suiteHash, slots: state.slots.length, completed: state.results.length, failed: failed.length }, null, 2)}\n`);
    return failed.length === 0 ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
// No top-level await: tsx resolves .ts CLI entries as CJS here (no "type":
// "module") where it is a transform error — found 260808 via the review-
// packets CLI; the vitest ESM import path had hidden it.
if (isMain) void main().then(code => { process.exitCode = code; });
