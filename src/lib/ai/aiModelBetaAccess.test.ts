import { describe, expect, it } from 'vitest';
import { aiModelBetaAccessEnabled } from './aiModelBetaAccess';

describe('AI model beta access', () => {
  it('enables only the explicit public beta value', () => {
    expect(aiModelBetaAccessEnabled('1')).toBe(true);
    expect(aiModelBetaAccessEnabled('0')).toBe(false);
    expect(aiModelBetaAccessEnabled('true')).toBe(false);
    expect(aiModelBetaAccessEnabled(undefined)).toBe(false);
  });
});
