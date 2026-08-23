// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useVoiceInput } from './useVoiceInput';

class MockSpeechRecognition {
  static last: MockSpeechRecognition | null = null;
  lang = '';
  continuous = false;
  interimResults = false;
  onresult = null;
  onerror = null;
  onend = null;
  constructor() { MockSpeechRecognition.last = this; }
  start() {}
  stop() {}
  abort() {}
}

describe('useVoiceInput locale routing', () => {
  afterEach(() => {
    MockSpeechRecognition.last = null;
    Reflect.deleteProperty(window, 'SpeechRecognition');
  });

  it('selects a speech locale for every supported UI language, including Arabic', () => {
    Object.defineProperty(window, 'SpeechRecognition', {
      configurable: true,
      value: MockSpeechRecognition,
    });

    const expected: Array<[string, string]> = [
      ['kr', 'ko-KR'],
      ['en', 'en-US'],
      ['ja', 'ja-JP'],
      ['cn', 'zh-CN'],
      ['es', 'es-ES'],
      ['ar', 'ar-SA'],
    ];

    for (const [lang, locale] of expected) {
      const hook = renderHook(() => useVoiceInput({ lang }));
      act(() => hook.result.current.start());
      expect(MockSpeechRecognition.last?.lang, lang).toBe(locale);
      hook.unmount();
    }
  });

  it('keeps an explicit recognition locale override intact', () => {
    Object.defineProperty(window, 'SpeechRecognition', {
      configurable: true,
      value: MockSpeechRecognition,
    });
    const hook = renderHook(() => useVoiceInput({ lang: 'ar', recognitionLang: 'ar-EG' }));
    act(() => hook.result.current.start());
    expect(MockSpeechRecognition.last?.lang).toBe('ar-EG');
    hook.unmount();
  });
});
