/**
 * pipeline-trace — **건너뛴 것을 통과로 세지 않는가** (260801).
 *
 * 여기서 잡는 것은 「기록이 되나」가 아니라, 이 저장소가 반복해서 만난 착각이다:
 *   · skip 을 ok 로 적어 「검사했고 문제없음」으로 읽히는 것
 *   · 요약이 실패를 뒤에 숨겨 아무도 안 읽는 것
 *   · 재지 않은 시간을 0 으로 채우는 것
 */
import { describe, expect, it } from 'vitest';
import { TraceRecorder, traceSummary } from '../pipeline-trace';

/** 시간을 통제해 결과를 재현 가능하게 한다 — 실측이 아니라 계약을 검사한다. */
function fakeClock(steps: number[]) {
  let i = 0;
  const marks = [0, ...steps.map((s, k) => steps.slice(0, k + 1).reduce((a, b) => a + b, 0))];
  return () => marks[Math.min(i++, marks.length - 1)]!;
}

describe('기록', () => {
  it('단계와 소요를 순서대로 담는다', () => {
    const r = new TraceRecorder(fakeClock([100, 250]));
    r.mark('parse').mark('build');
    const t = r.done();
    expect(t.stages.map((s) => s.name)).toEqual(['parse', 'build']);
    expect(t.stages[0]!.ms).toBe(100);
    expect(t.stages[1]!.ms).toBe(250);
  });

  it('시도 횟수를 담는다 — 1 이면 한 번에 됐다는 뜻', () => {
    const r = new TraceRecorder(fakeClock([10]));
    expect(r.done().attempts).toBe(1);
    const r2 = new TraceRecorder(fakeClock([10]));
    expect(r2.attempt(3).done().attempts).toBe(3);
  });

  it('이상한 시도 횟수를 그대로 믿지 않는다', () => {
    const r = new TraceRecorder(fakeClock([1]));
    expect(r.attempt(0).done().attempts).toBe(1);
    expect(new TraceRecorder(fakeClock([1])).attempt(NaN).done().attempts).toBe(1);
  });
});

describe('★건너뛴 것을 통과로 세지 않는다', () => {
  it('★skip 은 status=skipped 이고 ok 가 아니다', () => {
    const r = new TraceRecorder(fakeClock([10]));
    r.mark('parse').skip('precise', 'gmsh 바이너리 없음');
    const t = r.done();
    const s = t.stages.find((x) => x.name === 'precise')!;
    expect(s.status).toBe('skipped');
    expect(s.status).not.toBe('ok');
  });

  it('★skip 은 이유를 반드시 남긴다 — 이유 없는 skip 은 나중에 「왜 안 했지」가 된다', () => {
    const r = new TraceRecorder(fakeClock([1]));
    r.skip('verify', '입력에 하중이 없어 수행 불가');
    expect(r.done().stages[0]!.note).toContain('하중');
  });

  it('★건너뛴 단계에는 소요 시간을 지어내지 않는다', () => {
    const r = new TraceRecorder(fakeClock([1]));
    r.skip('precise', '이유');
    expect(r.done().stages[0]!.ms).toBeUndefined();
  });
});

describe('★요약이 실패를 앞에 놓는다', () => {
  it('★실패가 있으면 시간보다 먼저 말한다 — 뒤에 두면 아무도 안 읽는다', () => {
    const r = new TraceRecorder(fakeClock([10, 20]));
    r.mark('parse').mark('gate', 'failed', '치수 모순');
    const s = traceSummary(r.done());
    expect(s.indexOf('실패')).toBeLessThan(s.indexOf('초'));
    expect(s).toContain('1개 단계 실패');
  });

  it('★건너뜀도 「수행 안 함」이라고 못박는다', () => {
    const r = new TraceRecorder(fakeClock([10]));
    r.mark('parse').skip('precise', '바이너리 없음');
    expect(traceSummary(r.done())).toContain('수행 안 함');
  });

  it('전부 통과하면 그렇게 말한다 — 과탐 없음', () => {
    const r = new TraceRecorder(fakeClock([10, 10]));
    r.mark('a').mark('b');
    const s = traceSummary(r.done());
    expect(s).toContain('전 단계 통과');
    expect(s).toContain('한 번에 성공');
  });

  it('★재시도했으면 「몇 번째에 성공」이라고 적는다 — 1번에 안 됐다는 고지다', () => {
    const r = new TraceRecorder(fakeClock([10]));
    r.mark('a').attempt(2);
    expect(traceSummary(r.done())).toContain('2번째 시도에 성공');
  });

  it('영문도 같은 순서 — 실패가 먼저', () => {
    const r = new TraceRecorder(fakeClock([10, 10]));
    r.mark('a').mark('b', 'failed', 'x');
    const s = traceSummary(r.done(), 'en');
    /**
     * ⚠ 정규식으로 「초」를 찾다가 두 번 틀렸다: `'s'` 는 `stage(s)` 에 걸리고,
     *   단어경계 이스케이프를 넣으려다 편집 과정에서 **백스페이스 문자(0x08)** 가 박혔다.
     *   구획(·)으로 나눠 **순서만** 보면 이스케이프가 필요 없다.
     */
    const parts = s.split(' · ');
    const failIdx = parts.findIndex((p) => p.includes('failed'));
    const secIdx = parts.findIndex((p) => p.trim().endsWith('s') && /[0-9]/.test(p));
    expect(failIdx).toBeGreaterThan(-1);
    expect(secIdx).toBeGreaterThan(-1);
    expect(failIdx).toBeLessThan(secIdx);
  });
});
