/**
 * nexyfab.test.ts — CLI 계약 (260802).
 *
 * ## 무엇을 지키나
 * CLI 는 **CI·스크립트가 쓰는 인터페이스**다. 사람만 읽는 출력이 아니라
 * **종료 코드로 성패를 구별**해야 하고, 실패 원인이 섞이면 자동화가 잘못 분기한다.
 *
 * 그래서 여기서는 「예쁘게 나오나」가 아니라 **틀리면 자동화가 깨지는 것**만 잡는다:
 *  · 종료 코드가 원인별로 다른가
 *  · 키를 로그에 흘리지 않는가 (CI 로그는 오래 남는다)
 *  · 인자 파싱이 예상대로인가
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { parseArgv, EXIT, mask, main } from './nexyfab.mjs';

const argv = parseArgv as unknown as (a: string[]) => Record<string, unknown> & { _: string[] };
const codes = EXIT as unknown as Record<string, number>;
const maskFn = mask as unknown as (k: string | null) => string;
const run = main as unknown as (a: string[]) => Promise<number>;

describe('인자 파싱', () => {
  it('위치 인자와 플래그를 가른다', () => {
    const a = argv(['package', '--file', 'x.json', '--out', 'dir']);
    expect(a._).toEqual(['package']);
    expect(a.file).toBe('x.json');
    expect(a.out).toBe('dir');
  });

  it('`--k=v` 형태도 받는다', () => {
    expect(argv(['keys', '--days=30']).days).toBe('30');
  });

  it('값 없는 플래그는 true — 뒤 플래그를 값으로 먹지 않는다', () => {
    const a = argv(['whoami', '--verbose', '--help']);
    expect(a.verbose).toBe(true);
    expect(a.help).toBe(true);
  });

  it('`--` 뒤는 전부 위치 인자다 — 자연어에 `--` 가 들어가도 깨지지 않는다', () => {
    const a = argv(['assemble', '--', '--이상한', '설명']);
    expect(a._).toEqual(['assemble', '--이상한', '설명']);
  });
});

describe('★종료 코드가 원인별로 다르다 — 자동화가 분기할 수 있어야 한다', () => {
  const saved = process.env.NEXYFAB_API_KEY;
  beforeEach(() => { delete process.env.NEXYFAB_API_KEY; });
  afterEach(() => { if (saved === undefined) delete process.env.NEXYFAB_API_KEY; else process.env.NEXYFAB_API_KEY = saved; });

  it('코드가 서로 겹치지 않는다', () => {
    const vals = Object.values(codes);
    expect(new Set(vals).size, `중복된 종료 코드: ${JSON.stringify(codes)}`).toBe(vals.length);
    expect(codes.ok).toBe(0);
  });

  it('도움말은 0', async () => {
    const w = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    expect(await run(['--help'])).toBe(codes.ok);
    w.mockRestore();
  });

  it('알 수 없는 명령은 **0이 아니다** — 오타가 성공으로 읽히면 안 된다', async () => {
    const e = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const o = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    expect(await run(['bogus'])).toBe(codes.usage);
    e.mockRestore(); o.mockRestore();
  });

  it('키가 없으면 인증 코드(3)로 끝난다 — 네트워크를 타지 않는다', async () => {
    const e = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    expect(await run(['whoami'])).toBe(codes.auth);
    expect(fetchSpy, '키가 없는데 네트워크를 탔다').not.toHaveBeenCalled();
    fetchSpy.mockRestore(); e.mockRestore();
  });

  it('인자가 모자라면 사용법 코드(2)', async () => {
    process.env.NEXYFAB_API_KEY = 'nf_live_test';
    const e = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    expect(await run(['keys', 'create'])).toBe(codes.usage);
    expect(await run(['assemble'])).toBe(codes.usage);
    e.mockRestore();
  });
});

describe('★키를 흘리지 않는다 — CI 로그는 오래 남는다', () => {
  it('마스킹은 앞뒤만 남긴다', () => {
    const key = 'nf_live_abcdef0123456789abcdef0123456789';
    const m = maskFn(key);
    expect(m).not.toBe(key);
    expect(m).toContain('…');
    // 중간 본문이 그대로 노출되면 안 된다.
    expect(m).not.toContain('0123456789abcdef0123456789');
  });

  it('키가 없으면 「(없음)」 — undefined 를 찍지 않는다', () => {
    expect(maskFn(null)).toBe('(없음)');
  });

  it('★`--verbose` 로그에 평문 키가 없다', async () => {
    process.env.NEXYFAB_API_KEY = 'nf_live_SECRETSECRETSECRETSECRET';
    const lines: string[] = [];
    const e = vi.spyOn(process.stderr, 'write').mockImplementation((s: unknown) => { lines.push(String(s)); return true; });
    const o = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ keys: [] }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    await run(['whoami', '--verbose']);
    const joined = lines.join('');
    expect(joined, 'verbose 로그에 평문 키가 찍혔다').not.toContain('SECRETSECRETSECRETSECRET');
    vi.restoreAllMocks(); e.mockRestore(); o.mockRestore();
    delete process.env.NEXYFAB_API_KEY;
  });
});
