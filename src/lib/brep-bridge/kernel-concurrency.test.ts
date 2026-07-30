/**
 * kernel-concurrency.test.ts — 커널 동시 실행 상한 (260802).
 *
 * ## 왜 상한이 필요한가 — 실측
 * 프로세스를 나눠 힙 누적은 막았지만 **동시 요청을 막는 장치가 없었다.**
 * 자식 프로세스 하나의 **최대 작업집합 445MB**(코퍼스 최대 7.54MB 파일, `WorkingSet64` 폴링).
 * 동시 요청 N개 = N × 445MB. 상한이 없으면 요청 몇 건에 서버가 죽는다.
 *
 * ## 무엇을 고정하는가
 * ⚠ **슬롯 누수**가 가장 위험하다. 한 번이라도 새면 상한이 영구히 줄고, 끝내 모든 요청이
 *   폴백(AABB 근사)으로 떨어진다 — **조용한 품질 저하**라 아무도 모른다.
 *   그래서 실패·예외·시간초과 등 **어떤 경로로 빠져나가도** 반납되는지 본다.
 */

import { describe, expect, it } from 'vitest';
import {
  importStepWithKernel,
  kernelConcurrencyState,
  KERNEL_MAX_CONCURRENT,
} from './stepKernelImport';

describe('동시 실행 상한', () => {
  it('상한이 1 이상으로 설정돼 있다 — 0 이면 커널이 영영 안 돈다', () => {
    expect(KERNEL_MAX_CONCURRENT).toBeGreaterThanOrEqual(1);
  });

  it('★실패한 호출도 슬롯을 반납한다 — 누수는 조용한 품질 저하를 만든다', async () => {
    const before = kernelConcurrencyState();
    // 커널이 읽을 수 없는 입력 → 실패 경로로 빠진다.
    for (let i = 0; i < 3; i++) {
      const r = await importStepWithKernel('NOT A STEP', { idPrefix: 't' });
      expect(r.ok).toBe(false);
    }
    const after = kernelConcurrencyState();
    expect(after.active, `active ${before.active} → ${after.active} (누수)`).toBe(before.active);
    expect(after.waiting).toBe(0);
  }, 300_000);

  it('★동시 호출이 상한을 넘지 않는다', async () => {
    /**
     * 상한보다 많이 동시에 부르고, 진행 중 `active` 가 상한을 넘는지 본다.
     * ⚠ 실패 입력을 써서 커널을 실제로 돌리지 않는다 — 이 검사는 **슬롯 회계**를 보는 것이지
     *   커널 성능을 보는 것이 아니다(그건 코퍼스 회귀의 몫).
     */
    let peak = 0;
    const tick = setInterval(() => {
      const s = kernelConcurrencyState();
      if (s.active > peak) peak = s.active;
    }, 5);
    await Promise.all(Array.from({ length: KERNEL_MAX_CONCURRENT + 3 }, () =>
      importStepWithKernel('NOT A STEP', { idPrefix: 't' })));
    clearInterval(tick);
    expect(peak, `최대 동시 ${peak} > 상한 ${KERNEL_MAX_CONCURRENT}`).toBeLessThanOrEqual(KERNEL_MAX_CONCURRENT);
    expect(kernelConcurrencyState().active).toBe(0);
  }, 300_000);

  it('★슬롯을 못 받으면 **혼잡이라고 적는다** — 커널 실패와 구별돼야 한다', async () => {
    /**
     * 폴백 사유가 「커널 실패」인지 「혼잡」인지 구별되지 않으면, 운영에서 **원인을 못 찾는다**
     * (커널이 못 읽는 파일이 는 것인지 부하가 는 것인지).
     */
    const r = await importStepWithKernel('NOT A STEP', { idPrefix: 't' });
    expect(r.reason ?? '').not.toMatch(/동시 처리 한도/);   // 한가할 때는 혼잡 사유가 아니어야 한다
    expect(r.reason ?? '').toMatch(/읽지 못했다|커널/);
  }, 120_000);
});
