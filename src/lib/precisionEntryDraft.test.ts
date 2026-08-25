import { describe, expect, it } from 'vitest';
import { parsePrecisionEntryDraft } from './precisionEntryDraft';

describe('precision CAD entry draft', () => {
  it('keeps direct and agentic entry modes distinct', () => {
    const direct = JSON.stringify({ version: 1, prompt: 'Edit the bracket', lane: 'precision-cad', projectId: 'project-1' });
    expect(parsePrecisionEntryDraft(direct, 'precision-cad')?.prompt).toBe('Edit the bracket');
    expect(parsePrecisionEntryDraft(direct, 'agentic-cad')).toBeNull();
  });

  it('rejects unsafe project identities and unbounded prompts', () => {
    expect(parsePrecisionEntryDraft(JSON.stringify({ version: 1, prompt: 'ok', lane: 'precision-cad', projectId: '../bad' }))).toBeNull();
    expect(parsePrecisionEntryDraft(JSON.stringify({ version: 1, prompt: 'x'.repeat(4_001), lane: 'precision-cad', projectId: 'p' }))).toBeNull();
  });
});
