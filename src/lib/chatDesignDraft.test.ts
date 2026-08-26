import { describe, expect, it } from 'vitest';
import { parsePendingChatDesignDraft } from './chatDesignDraft';

describe('pending chat design draft', () => {
  it('round-trips bounded metadata without storing raw attachment bytes', () => {
    const parsed = parsePendingChatDesignDraft(JSON.stringify({
      version: 1,
      prompt: 'Turn the attached drawing into 3D',
      lane: 'ai-design',
      domain: 'mechanical',
      attachment: { name: 'drawing.png', mime: 'image/png', reattachRequired: true },
    }));
    expect(parsed?.attachment).toEqual({ name: 'drawing.png', mime: 'image/png', reattachRequired: true });
    expect(JSON.stringify(parsed)).not.toContain('data:image');
  });

  it('rejects unsafe or oversized draft shapes', () => {
    expect(parsePendingChatDesignDraft('{')).toBeNull();
    expect(parsePendingChatDesignDraft(JSON.stringify({ version: 1, prompt: 'x'.repeat(4_001), lane: 'ai-design', domain: 'mechanical' }))).toBeNull();
    expect(parsePendingChatDesignDraft(JSON.stringify({ version: 1, prompt: 'ok', lane: 'unknown', domain: 'mechanical' }))).toBeNull();
  });
});
