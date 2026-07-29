/**
 * pump_head — 헤드 배열이 Q_Lmin 을 덮어쓰는 경로의 구멍 (260729).
 *
 * `heads[]` 가 오면 계산기가 `Q_Lmin` 을 ΣQ 로 **덮어쓴다**. 그런데 스키마의
 * `exclusiveMinimum: 0` 은 원본 입력만 본다 — q_Lmin 없는 헤드만 들어오면 ΣQ=0 인 채
 * 통과했고, 마찰손실 0·유속 0 인 전양정이 **정상 숫자처럼** 나갔다(실측 23.39m).
 *
 * 유량 0 은 "펌프가 물을 안 보낸다"는 뜻이라 전양정 판정 자체가 성립하지 않는다.
 * §6-G ④(부재가 정상으로 읽힘) — 지어내지 말고 거부한다.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runCalculator } from '../registry.mjs';

const base = { Q_Lmin: 1, staticHead_m: 3, pipeDia_mm: 32, pipeLen_m: 50 };

describe('pump_head ΣQ=0 거부', () => {
  it('q_Lmin 없는 헤드만 오면 거부한다 — 종전엔 23.39m 가 나왔다', () => {
    assert.throws(
      () => runCalculator('pump_head', { ...base, heads: [{ minP_kPa: 200 }, { minP_kPa: 200 }] }),
      /q_Lmin/,
    );
  });

  it('q_Lmin 이 있으면 정상 산출 — 과탐 금지', () => {
    const r = runCalculator('pump_head', { ...base, heads: [{ q_Lmin: 8, minP_kPa: 200 }, { q_Lmin: 8, minP_kPa: 200 }] });
    assert.ok(r.checks.head.total_m > 0);
    assert.ok(r.intermediate.velocity_ms > 0, '유량이 있으면 유속도 있어야 한다');
    assert.match(r.notes.join(' '), /ΣQ=16/);
  });

  it('heads 없이 Q_Lmin 만 오는 경로는 그대로', () => {
    const r = runCalculator('pump_head', { ...base, Q_Lmin: 60 });
    assert.ok(r.intermediate.velocity_ms > 0);
  });
});
