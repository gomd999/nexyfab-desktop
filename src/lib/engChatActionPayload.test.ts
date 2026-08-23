import { describe, expect, it } from 'vitest';
import { actionReplyRequiresConfirmation, normalizeEngChatActionPayload } from './engChatActionPayload';

const action = {
  type: 'assembly',
  prompt: 'turbojet assembly with compressor and turbine',
  reply: '기본 사양으로 조립체 생성을 시작합니다.',
};

describe('engineering chat action payload normalization', () => {
  it('accepts a normal action object', () => {
    expect(normalizeEngChatActionPayload(action)).toEqual(action);
  });

  it('recovers double-encoded provider JSON', () => {
    expect(normalizeEngChatActionPayload(JSON.stringify(JSON.stringify(action)))).toEqual(action);
  });

  it('recovers escaped JSON returned without outer string quotes', () => {
    const escaped = JSON.stringify(action).replace(/"/g, '\\"');
    expect(normalizeEngChatActionPayload(escaped)).toEqual(action);
  });

  it('unwraps the historic reply fallback instead of displaying JSON', () => {
    expect(normalizeEngChatActionPayload({ type: 'reply', reply: JSON.stringify(action) })).toEqual(action);
  });

  it('keeps an ordinary conversational reply', () => {
    expect(normalizeEngChatActionPayload({ type: 'reply', reply: '치수를 알려주세요.' }))
      .toEqual({ type: 'reply', reply: '치수를 알려주세요.' });
  });

  it('blocks CAD execution when an action reply still asks for confirmation', () => {
    expect(actionReplyRequiresConfirmation('이 치수로 진행할까요? 기본값으로 진행이라고 답하시면 바로 생성합니다.')).toBe(true);
    expect(actionReplyRequiresConfirmation('가정: 스쿠프 보우 직경 55mm로 생성을 시작합니다.')).toBe(false);
  });
});
