/**
 * truncation.test.ts — **절단을 「모른다」와 구별한다** (260731).
 *
 * 여기서 잡는 것은 「동작하나」가 아니라, 이 모듈이 없어서 실제로 물렸던 형태다:
 *   · 잘린 응답이 **형식 오류로 둔갑**하는 것 (대응이 정반대가 된다)
 *   · 제공자가 아무 말 안 한 것을 **「안 잘렸다」로 단정**하는 것
 */
import { describe, expect, it } from 'vitest';
import { truncationOf, truncationNote } from './truncation';

describe('제공자별 절단 표지를 읽는다', () => {
  it('OpenAI 호환 `length`', () => {
    expect(truncationOf('length').truncated).toBe(true);
  });

  it('Anthropic `max_tokens`', () => {
    expect(truncationOf('max_tokens').truncated).toBe(true);
  });

  it('Gemini `MAX_TOKENS` — 대소문자·구분자 규약이 달라도 같은 뜻이다', () => {
    expect(truncationOf('MAX_TOKENS').truncated).toBe(true);
    expect(truncationOf('max-tokens').truncated).toBe(true);
  });

  it('정상 종료는 false — 「잘리지 않았다」고 **말할 수 있는** 경우다', () => {
    for (const v of ['stop', 'STOP', 'end_turn']) {
      expect(truncationOf(v).truncated, `${v} 를 절단으로 봤다`).toBe(false);
    }
  });
});

describe('★모르는 것을 안다고 하지 않는다', () => {
  it('사유가 없으면 truncated 를 **생략**한다 — false 로 채우지 않는다', () => {
    for (const v of [undefined, null, '', '  ', 42]) {
      const r = truncationOf(v);
      expect(r.truncated, `${String(v)} 를 단정했다`).toBeUndefined();
    }
  });

  it('★모르는 사유는 판정하지 않고 원문만 남긴다 — 새 절단 표지를 조용히 놓치지 않도록', () => {
    const r = truncationOf('content_filter');
    // 안전필터는 절단도 정상종료도 아니다. false 로 두면 「정상」으로 읽힌다.
    expect(r.truncated).toBeUndefined();
    expect(r.finishReason).toBe('content_filter');
  });

  it('제공자가 준 원문을 보존한다 — 표준화만 하면 잃는 정보가 있다', () => {
    expect(truncationOf('MAX_TOKENS').finishReason).toBe('MAX_TOKENS');
  });
});

describe('설명 문구', () => {
  it('★절단일 때만 나온다 — 아닐 때 붙이면 매번 경고가 된다', () => {
    expect(truncationNote({ truncated: true }, 500)).toContain('잘렸');
    expect(truncationNote({ truncated: false })).toBeNull();
    expect(truncationNote({})).toBeNull();
  });

  it('★「형식을 어긴 게 아니다」를 명시한다 — 대응이 정반대이기 때문', () => {
    const n = truncationNote({ truncated: true }, 500)!;
    expect(n).toContain('형식을 어긴 것이 아니라');
    expect(n).toContain('500');
  });

  it('상한을 모르면 숫자 없이 설명한다 — 없는 숫자를 지어내지 않는다', () => {
    const n = truncationNote({ truncated: true })!;
    expect(n).not.toMatch(/\(\d+ 토큰\)/);
  });
});
