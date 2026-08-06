/**
 * B1 — fast-path classifier + agent integration tests.
 */

import { describe, it, expect, vi } from 'vitest';
import { classifyFastPath } from '../fastPath';
import { runScadAgent } from '../runScadAgent';
import { makeTools } from '../tools';
import type { AiClient, RenderState } from '../types';

describe('classifyFastPath', () => {
  it('matches Korean uniform cube', () => {
    const r = classifyFastPath('30mm 정육면체');
    expect(r).not.toBeNull();
    expect(r!.intent.shapeId).toBe('box');
    expect(r!.intent.params.width).toBe(30);
    expect(r!.intent.params.height).toBe(30);
    expect(r!.intent.params.depth).toBe(30);
  });

  it('matches English cube', () => {
    const r = classifyFastPath('25mm cube');
    expect(r?.intent.params.width).toBe(25);
  });

  it('normalizes conversational wrappers and trailing punctuation', () => {
    expect(classifyFastPath('Please create a 30 mm cube.')?.intent).toEqual({
      shapeId: 'box', params: { width: 30, height: 30, depth: 30 },
    });
  });

  it('matches an English box described by axis words', () => {
    expect(classifyFastPath('A rectangular box 80mm wide, 40mm tall, 20mm deep')?.intent).toEqual({
      shapeId: 'box', params: { width: 80, height: 40, depth: 20 },
    });
  });

  it('does not confuse sphere diameter with radius', () => {
    expect(classifyFastPath('A 40mm diameter sphere')?.intent).toEqual({
      shapeId: 'sphere', params: { diameter: 40 },
    });
  });

  it('matches Korean cylinder', () => {
    const r = classifyFastPath('지름 40mm 높이 60mm 원기둥');
    expect(r?.intent.shapeId).toBe('cylinder');
    expect(r?.intent.params.diameter).toBe(40);
    expect(r?.intent.params.height).toBe(60);
  });

  it('matches Korean sphere', () => {
    const r = classifyFastPath('반지름 25mm 구');
    expect(r?.intent.shapeId).toBe('sphere');
    expect(r?.intent.params.radius).toBe(25);
  });

  it('matches hex nut by M-size', () => {
    const r = classifyFastPath('M10 육각너트');
    expect(r?.intent.shapeId).toBe('hexNut');
    expect(r?.intent.params.size).toBe(10);
  });

  it('matches Korean pipe with all 3 dimensions', () => {
    const r = classifyFastPath('외경 30 내경 20 길이 100 파이프');
    expect(r?.intent.shapeId).toBe('pipe');
    expect(r?.intent.params.outerDiameter).toBe(30);
    expect(r?.intent.params.innerDiameter).toBe(20);
    expect(r?.intent.params.length).toBe(100);
  });

  it('rejects compound prompts (with conjunctions)', () => {
    expect(classifyFastPath('30mm 큐브 + 4mm 구멍')).toBeNull();
    expect(classifyFastPath('cube with hole')).toBeNull();
    expect(classifyFastPath('볼트와 너트')).toBeNull();
  });

  it('rejects assemblies / mounts', () => {
    expect(classifyFastPath('모터 마운트 어셈블리')).toBeNull();
    expect(classifyFastPath('브래킷 결합')).toBeNull();
  });

  it('rejects too-long prompts (>200 chars)', () => {
    const long = '큐브 ' + 'x'.repeat(250);
    expect(classifyFastPath(long)).toBeNull();
  });

  it('rejects too-short prompts (<3 chars)', () => {
    expect(classifyFastPath('a')).toBeNull();
    expect(classifyFastPath('')).toBeNull();
  });

  it('rejects free-form descriptions', () => {
    expect(classifyFastPath('자동차 만들어줘')).toBeNull();
    expect(classifyFastPath('이쁜 박스')).toBeNull();
  });

  it('matches ISO bolt "M{d} {len}mm 볼트"', () => {
    const r = classifyFastPath('M8 50mm 볼트');
    expect(r?.intent.shapeId).toBe('screw');
    expect(r?.intent.params.diameter).toBe(8);
    expect(r?.intent.params.length).toBe(50);
  });

  it('matches ISO bolt "M{d}x{len}" canonical', () => {
    const r = classifyFastPath('M5x16');
    expect(r?.intent.shapeId).toBe('screw');
    expect(r?.intent.params.diameter).toBe(5);
    expect(r?.intent.params.length).toBe(16);
  });

  it('matches threaded rod "M{d} {len}mm 나사봉"', () => {
    const r = classifyFastPath('M10 100mm 나사봉');
    expect(r?.intent.shapeId).toBe('threadedRod');
    expect(r?.intent.params.diameter).toBe(10);
    expect(r?.intent.params.length).toBe(100);
    expect(r?.intent.params.pitch).toBe(1.5);  // ISO 261 coarse pitch for M10
  });

  it('M14 picks up correct ISO 261 pitch (2.0 not 1.5)', () => {
    const r = classifyFastPath('M14 50mm 나사봉');
    expect(r?.intent.params.pitch).toBe(2.0);
  });

  // Y2 — extended pattern coverage
  it('cube reverse word order: "정육면체 30mm"', () => {
    const r = classifyFastPath('정육면체 30mm');
    expect(r?.intent.shapeId).toBe('box');
    expect(r?.intent.params.width).toBe(30);
  });

  it('cone Korean: "반지름 10mm 높이 20mm 원뿔"', () => {
    const r = classifyFastPath('반지름 10mm 높이 20mm 원뿔');
    expect(r?.intent.shapeId).toBe('cone');
    expect(r?.intent.params.radius).toBe(10);
    expect(r?.intent.params.height).toBe(20);
  });

  it('cone English: "cone radius 8 height 16"', () => {
    const r = classifyFastPath('cone radius 8 height 16');
    expect(r?.intent.shapeId).toBe('cone');
    expect(r?.intent.params.radius).toBe(8);
  });

  it('torus: "주반지름 30 부반지름 5 토러스"', () => {
    const r = classifyFastPath('주반지름 30 부반지름 5 토러스');
    expect(r?.intent.shapeId).toBe('torus');
    expect(r?.intent.params.majorRadius).toBe(30);
    expect(r?.intent.params.minorRadius).toBe(5);
  });

  it('spur gear: "잇수 20 모듈 2 평기어"', () => {
    const r = classifyFastPath('잇수 20 모듈 2 평기어');
    expect(r?.intent.shapeId).toBe('gear');
    expect(r?.intent.params.teeth).toBe(20);
    expect(r?.intent.params.module).toBe(2);
    expect(r?.intent.params.thickness).toBe(6); // default
  });

  it('L bracket: "30x30x3 L 브래킷"', () => {
    const r = classifyFastPath('30x30x3 L 브래킷');
    expect(r?.intent.shapeId).toBe('lBracket');
    expect(r?.intent.params.thickness).toBe(3);
  });

  it('disk Korean: "지름 50mm 두께 5mm 디스크"', () => {
    const r = classifyFastPath('지름 50mm 두께 5mm 디스크');
    expect(r?.intent.shapeId).toBe('disk');
    expect(r?.intent.params.diameter).toBe(50);
    expect(r?.intent.params.thickness).toBe(5);
  });

  it('sphere by diameter: "지름 20mm 구"', () => {
    const r = classifyFastPath('지름 20mm 구');
    expect(r?.intent.shapeId).toBe('sphere');
    expect(r?.intent.params.radius).toBe(10); // half the diameter
  });
});

// ─── Agent integration ────────────────────────────────────────────────────

function noopAi(): AiClient {
  // If the LLM ever gets called when fast-path should win, fail loud.
  return { async complete() { throw new Error('AI client should not be called for fast-path prompts'); } };
}

function mockHost() {
  const r: RenderState = { ok: true, errors: [], stlBytes: 100, triangles: 12 };
  return {
    render: async () => ({ ...r, ts: Date.now() }),
    geometry: async () => ({ triangleCount: 12, manifold: true }),
    dfm: async () => ({ summary: '', issuesCount: 0 }),
  };
}

describe('Fast-path agent integration', () => {
  it('completes "30mm 큐브" with 0 LLM calls', async () => {
    const ai = noopAi();
    const aiSpy = vi.spyOn(ai, 'complete');
    const { session } = await runScadAgent({
      userPrompt: '30mm 정육면체',
      ai,
      tools: makeTools(mockHost()),
    });
    expect(aiSpy).not.toHaveBeenCalled();
    expect(session.status).toBe('done');
    expect(session.budget.tokensUsed).toBe(0);
    expect(session.scadSource).toContain('cube');
    expect(session.render.ok).toBe(true);
  });

  it('emits expected events for fast-path run', async () => {
    const { events } = await runScadAgent({
      userPrompt: '지름 40mm 높이 60mm 원기둥',
      ai: noopAi(),
      tools: makeTools(mockHost()),
    });
    const types = events.map(e => e.type);
    expect(types).toContain('model_response');
    expect(types).toContain('tool_call');
    expect(types).toContain('tool_result');
    expect(types[types.length - 1]).toBe('done');
  });

  it('falls through to LLM when prompt is complex', async () => {
    let aiCalls = 0;
    const ai: AiClient = {
      async complete() {
        aiCalls++;
        return { text: 'Done.', promptTokens: 10, completionTokens: 5 };
      },
    };
    const { session } = await runScadAgent({
      userPrompt: '모터 마운트 + 4 볼트 어셈블리 만들어줘',
      ai,
      tools: makeTools(mockHost()),
    });
    expect(aiCalls).toBeGreaterThan(0);
    expect(session.status).toBe('done');
  });

  it('fastPath:false flag forces LLM even for simple prompts', async () => {
    let aiCalls = 0;
    const ai: AiClient = {
      async complete() {
        aiCalls++;
        return { text: 'I can help.', promptTokens: 10, completionTokens: 5 };
      },
    };
    await runScadAgent({
      userPrompt: '30mm 정육면체',
      ai,
      tools: makeTools(mockHost()),
      fastPath: false,
    });
    expect(aiCalls).toBeGreaterThan(0);
  });
});
