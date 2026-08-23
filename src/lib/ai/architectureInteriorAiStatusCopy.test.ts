import { describe, expect, it } from 'vitest';
import { architectureInteriorAiStatusCopy, architectureInteriorAiStatusDirection } from './architectureInteriorAiStatusCopy';

describe('architecture/interior AI status copy', () => {
  it('has localized status copy and direction for all supported languages', () => {
    const statuses = ['proposal_ready', 'proposal_rejected', 'concept_compiled', 'awaiting_authority', 'invalid_request', 'model_truncated', 'model_output_invalid', 'model_unavailable'] as const;
    for (const lang of ['ko', 'en', 'ja', 'zh', 'es', 'ar']) {
      for (const status of statuses) expect(architectureInteriorAiStatusCopy(status, lang)).not.toBe('');
      expect(architectureInteriorAiStatusDirection(lang)).toBe(lang === 'ar' ? 'rtl' : 'ltr');
    }
    expect(architectureInteriorAiStatusDirection('ar-SA')).toBe('rtl');
    expect(architectureInteriorAiStatusCopy('proposal_ready', 'unknown')).toBe(architectureInteriorAiStatusCopy('proposal_ready', 'en'));
  });
});
