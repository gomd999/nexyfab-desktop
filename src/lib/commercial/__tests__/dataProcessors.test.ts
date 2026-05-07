import { describe, it, expect } from 'vitest';
import { privacyProcessorsLine } from '../dataProcessors';

describe('privacyProcessorsLine', () => {
  it('uses Korean for ko/kr', () => {
    expect(privacyProcessorsLine('ko')).toContain('Sentry');
    expect(privacyProcessorsLine('kr')).toContain('Sentry');
  });

  it('uses English for other langs', () => {
    expect(privacyProcessorsLine('en')).toContain('Sentry');
    expect(privacyProcessorsLine('ja')).toContain('Sentry');
  });
});
