/**
 * A-5 — chatCompletion의 **실 프로바이더 체인 경로**가 vitest 안에서 실행 가능한가.
 *
 * 왜 필요한가: 종전에는 `chatCompletion()`이 프로바이더에 닿기도 전에 죽었다.
 *   chatCompletion → getActiveBreaker → getSetting → getDbAdapter()
 *   → createSqliteAdapter() → `require('./db')`
 * vite-node(ESM 로더)에서는 **상대 TS 경로**의 require가 "Cannot find module './db'"로
 * 실패한다(`require('pg')` 같은 node_modules 경유는 CJS 인터롭으로 통과하므로 증상이
 * 선택적이었다). 결과적으로 CI는 실 LLM 경로를 한 번도 검증하지 못했고, design-driver
 * 평가에서 "플래너가 거부했다"는 결과가 진짜 의미론적 거부인지 하네스 붕괴인지
 * vitest 안에서 구분되지 않았다(260723 종합평가 발견 §3-A-05).
 *
 * 이 테스트는 실 네트워크·실 과금 없이(로컬 OpenAI 호환 프로바이더 + fetch 스텁)
 * 브레이커→체인→미터 배선 전체를 한 번 통과시킨다. 실패하면 "CI가 다시 눈을 감았다"는
 * 신호다. DB는 임시 파일로 격리한다(레포 루트에 nexyfab.db를 만들지 않기 위해).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('@/lib/ai/providerFailureAlert', () => ({
  notifyAiProviderFailure: vi.fn().mockResolvedValue({ status: 'suppressed' }),
}));

const ENV_KEYS = [
  'NEXYFAB_DB_PATH', 'LOCAL_AI_BASE_URL', 'LOCAL_AI_MODEL', 'DATABASE_URL',
  'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'AI_PROVIDER_PRIMARY', 'AI_PROVIDER_FALLBACKS',
] as const;
let saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
let tmp = '';

function okResponse(content: string): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 11, completion_tokens: 7 } }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

describe('chatCompletion — 실 프로바이더 체인이 vitest에서 실행된다 (A-5 CI 사각지대)', () => {
  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    tmp = mkdtempSync(join(tmpdir(), 'nf-ai-path-'));
    process.env.NEXYFAB_DB_PATH = join(tmp, 'test.db');
    delete process.env.DATABASE_URL; // SQLite 어댑터(문제의 경로)를 강제로 태운다
    process.env.LOCAL_AI_BASE_URL = 'http://127.0.0.1:59999/v1';
    process.env.LOCAL_AI_MODEL = 'stub-model';
    process.env.AI_PROVIDER_PRIMARY = 'openai';
    process.env.AI_PROVIDER_FALLBACKS = 'local';
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    vi.restoreAllMocks();
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* 임시 디렉터리 정리 실패는 무시 */ }
  });

  it('브레이커 조회를 통과해 프로바이더까지 도달하고 응답을 돌려준다', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse('PLAN_OK'));
    const { chatCompletion } = await import('@/lib/ai');

    const res = await chatCompletion({
      messages: [{ role: 'user', content: 'ping' }],
      provider: 'local',
      task: 'a5-harness-check',
      timeoutMs: 5_000,
    });

    expect(res.text).toBe('PLAN_OK');
    expect(res.provider).toBe('local');
    // 프로바이더에 실제로 도달했는가 — 브레이커 단계에서 죽었다면 fetch는 0회다.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('DB 계층 붕괴가 프로바이더 오류로 위장되지 않는다 — 실패해도 사유가 프로바이더 것', async () => {
    // 프로바이더가 5xx를 내면 AiProviderError로 끝나야 한다. 여기에 "Cannot find module"
    // 같은 로더 오류가 섞여 나오면 하네스가 다시 깨진 것.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('upstream down', { status: 502 }));
    const { chatCompletion } = await import('@/lib/ai');

    await expect(
      chatCompletion({ messages: [{ role: 'user', content: 'ping' }], provider: 'local', task: 'a5-harness-check', timeoutMs: 5_000 }),
    ).rejects.toThrow(/502|All providers failed/);

    await expect(
      chatCompletion({ messages: [{ role: 'user', content: 'ping' }], provider: 'local', task: 'a5-harness-check', timeoutMs: 5_000 }),
    ).rejects.not.toThrow(/Cannot find module/);
  });
  it('selected provider failure falls back without leaking its model id to the next vendor', async () => {
    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.OPENAI_BASE_URL = 'https://openai.invalid/v1';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('127.0.0.1:59999')) {
        return new Response('local down', { status: 503 });
      }
      const body = JSON.parse(String(init?.body ?? '{}')) as { model?: string };
      expect(body.model).not.toBe('selected-local-model');
      return okResponse('FALLBACK_OK');
    });
    const { resetProviderHealth } = await import('@/lib/provider-health');
    resetProviderHealth();
    const { chatCompletion } = await import('@/lib/ai');

    const result = await chatCompletion({
      messages: [{ role: 'user', content: 'continue the CAD plan' }],
      provider: 'local',
      model: 'selected-local-model',
      allowProviderFallback: true,
      task: 'selected-model-fallback-test',
    });

    expect(result.provider).toBe('openai');
    expect(result.text).toBe('FALLBACK_OK');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('selected model 4xx falls back while exact provider probes remain strict', async () => {
    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.OPENAI_BASE_URL = 'https://openai.invalid/v1';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input).includes('127.0.0.1:59999')) {
        return new Response('model deployment not found', { status: 404 });
      }
      return okResponse('MODEL_FALLBACK_OK');
    });
    const { resetProviderHealth } = await import('@/lib/provider-health');
    resetProviderHealth();
    const { chatCompletion } = await import('@/lib/ai');

    await expect(chatCompletion({
      messages: [{ role: 'user', content: 'continue' }],
      provider: 'local', model: 'retired-model', task: 'strict-probe',
    })).rejects.toThrow(/404/);

    const recovered = await chatCompletion({
      messages: [{ role: 'user', content: 'continue' }],
      provider: 'local', model: 'retired-model', allowProviderFallback: true,
      task: 'selected-model-404-fallback',
    });
    expect(recovered).toMatchObject({ provider: 'openai', text: 'MODEL_FALLBACK_OK' });
  });
});
