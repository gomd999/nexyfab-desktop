/**
 * flow/route.test.ts — 오케스트레이터 규약 (260802).
 *
 * ## 무엇을 지키는가
 * 이 라우트는 **새 엔진이 아니라 기존 라우트를 순서대로 부르는 것**이다.
 * 그래서 검사도 「형상이 맞는가」가 아니라 **「규약을 지키는가」**를 본다:
 *  · 단계마다 성공/실패와 **사유**가 남는가
 *  · **부분 성공을 성공이라 하지 않는가**(`partial`)
 *  · 단계별 **소요**가 실리는가 — 사용자가 어디서 기다리는지 알아야 한다
 *  · 중간 산출물(어셈블리)이 돌아오는가 — 되돌아갈 수 있어야 한다
 *
 * ⚠ 자연어 경로는 LLM 을 부르므로 여기서 돌리지 않는다(요금·불안정성).
 *   **입력 검증과 실패 경로**만 본다 — 그게 이 라우트 고유의 책임이다.
 */
import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

const post = async (body: unknown): Promise<{ status: number; json: Record<string, unknown> }> => {
  const req = new NextRequest('http://localhost/api/nexyfab/drawing/flow', {
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json' }),
    body: JSON.stringify(body),
  });
  const res = await POST(req);
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
};

describe('입력 규약', () => {
  it('★text 도 stepText 도 없으면 **무엇이 필요한지** 말한다', async () => {
    const { status, json } = await post({});
    expect(status).toBe(400);
    expect(String(json.error)).toMatch(/text|stepText/);
  });

  it('잘못된 JSON 은 400 — 조용히 통과시키지 않는다', async () => {
    const req = new NextRequest('http://localhost/api/nexyfab/drawing/flow', {
      method: 'POST', headers: new Headers({ 'content-type': 'application/json' }), body: '{oops',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

describe('실패해도 **사유를 남긴다**', () => {
  /**
   * ⚠ 이 라우트는 **분당 3회** 제한이다(흐름 하나가 하위 라우트를 여러 번 부르므로).
   *   검사마다 호출하면 4번째부터 429 가 되어 `steps` 가 없고, 그러면 **검사가 제품 결함이
   *   아니라 자기 제한에 걸려** 실패한다. 한 번만 부르고 **결과를 나눠 본다.**
   */
  let shared: Record<string, unknown> | null = null;
  const once = async (): Promise<Record<string, unknown>> => {
    if (!shared) shared = (await post({ stepText: 'NOT A STEP FILE' })).json;
    return shared;
  };

  it('★읽을 수 없는 STEP → ok:false 이고 단계에 사유가 있다', async () => {
    const json = await once();
    expect(json.ok).toBe(false);
    const steps = json.steps as Array<{ name: string; ok: boolean; reason: string | null; ms: number; required: boolean }>;
    expect(Array.isArray(steps)).toBe(true);
    expect(steps.length).toBeGreaterThan(0);
    const failed = steps.find((s) => !s.ok);
    expect(failed, '실패 단계가 없다').toBeTruthy();
    // 「무엇이 실패했나」만 알고 「왜」를 버리면 고칠 수 없다.
    expect(failed!.reason, '사유가 비었다').toBeTruthy();
    expect(failed!.required).toBe(true);
  }, 300_000);

  it('★단계별 소요와 총 소요가 실린다 — 어디서 기다리는지 알아야 한다', async () => {
    const json = await once();
    const steps = json.steps as Array<{ ms: number }>;
    for (const s of steps) expect(typeof s.ms).toBe('number');
    expect(typeof json.totalMs).toBe('number');
  }, 300_000);

  it('성공한 단계의 사유는 **null** 이다 — 「사유 없음」이 「성공」으로 읽히지 않게', async () => {
    const json = await once();
    const steps = json.steps as Array<{ ok: boolean; reason: string | null }>;
    for (const s of steps) if (s.ok) expect(s.reason).toBeNull();
  }, 300_000);
});
