/**
 * compose-partial.test.ts — **compose 도 막다른 길을 만들지 않는다** (260803).
 *
 * `composeWithGate` 는 교정 라운드를 다 쓰고도 오류가 남으면 `gatePassed:false` 로 끝났다.
 * 멀쩡한 피처까지 버려졌다. `assemble` 의 `resolveAssembly` 와 같은 규율을 피처 단위로 적용한다.
 *
 * ⚠ 이 경로의 고유 위험은 **질량 방향이 op 에 따라 반대**라는 것이다:
 *   `subtract` 를 드롭하면 구멍이 안 뚫려 **질량이 과대**해진다. 반드시 보고돼야 한다.
 */

import { describe, expect, it } from 'vitest';
import { emitComposite, gateComposite, resolveComposeIntent } from './compose.mjs';

type Feature = Record<string, unknown>;
type Intent = { name: string; features: Feature[] };
const resolve = resolveComposeIntent as unknown as (i: Intent) => {
  intent: Intent;
  dropped: Array<{ id: string; kind: string; op: string; error: string; massDirection: string }>;
  allFailed: boolean;
};
const gate = gateComposite as unknown as (i: Intent) => string[];
const emit = emitComposite as unknown as (i: Intent) => string;

const withBadSubtract = (): Intent => ({
  name: 't',
  features: [
    { id: 'body', kind: 'box', size: [100, 60, 20] },
    { id: 'hole', kind: 'cylinder', diameter: 8, height: 30, op: 'subtract', at: { translate: [20, 20, -5] } },
    { id: 'BAD', kind: 'cylinder', height: 10, op: 'subtract', at: { translate: [50, 30, -5] } }, // diameter 누락
  ],
});

describe('★걸린 피처만 빼고 형상을 낸다', () => {
  it('종전에는 여기서 끝났다 — 게이트가 실제로 실패하는 입력인지 먼저 확인', () => {
    expect(gate(withBadSubtract()).length).toBeGreaterThan(0);
  });

  it('멀쩡한 피처가 살아남고 SCAD 가 방출된다', () => {
    const r = resolve(withBadSubtract());
    expect(r.allFailed).toBe(false);
    expect(r.intent.features.map((f) => f.id)).toEqual(['body', 'hole']);
    expect(gate(r.intent)).toEqual([]);
    expect(emit(r.intent).length).toBeGreaterThan(0);
  });

  it('★subtract 를 뺐으면 **질량 과대**라고 말한다', () => {
    const [d] = resolve(withBadSubtract()).dropped;
    expect(d.id).toBe('BAD');
    expect(d.op).toBe('subtract');
    expect(d.massDirection).toContain('과대');
    expect(d.error).toBeTruthy();
  });

  it('add 를 뺐으면 **질량 과소**라고 말한다 — 방향이 반대다', () => {
    const r = resolve({
      name: 't',
      features: [
        { id: 'body', kind: 'box', size: [100, 60, 20] },
        { id: 'BADADD', kind: 'cylinder', height: 10 }, // add, diameter 누락
      ],
    });
    expect(r.dropped[0].op).toBe('add');
    expect(r.dropped[0].massDirection).toContain('과소');
  });
});

describe('★안 뺀다 — 형상이 성립하지 않는 경우', () => {
  it('add 가 하나도 안 남으면 드롭하지 않고 원본을 돌려준다', () => {
    const r = resolve({
      name: 'x',
      features: [
        { id: 'A', kind: 'box' }, // 유일한 add 인데 망가짐
        { id: 'B', kind: 'cylinder', diameter: 5, height: 5, op: 'subtract' },
      ],
    });
    expect(r.allFailed).toBe(true);
    expect(r.intent.features).toHaveLength(2);
  });

  it('태그로 못 짚는 오류(features 비어있음)는 드롭으로 해결되지 않는다', () => {
    const r = resolve({ name: 'x', features: [] });
    expect(r.allFailed).toBe(true);
    expect(r.dropped).toEqual([]);
  });

  it('멀쩡한 intent 는 손대지 않는다 — 참조까지 동일', () => {
    const ok: Intent = { name: 'ok', features: [{ id: 'b', kind: 'box', size: [10, 10, 10] }] };
    const r = resolve(ok);
    expect(r.dropped).toEqual([]);
    expect(r.intent).toBe(ok);
  });
});
