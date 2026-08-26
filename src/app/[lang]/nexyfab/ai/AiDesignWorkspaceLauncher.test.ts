import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { adaptAiDesignInput } from '@/lib/ai/aiDesignInputAdapter';
import { createAiDesignWorkspaceRuntime } from '@/lib/ai/aiDesignWorkspaceRuntime';
import { createAiDesignTextWorkspaceRequestV10 } from './AiDesignWorkspaceLauncher';

describe('AI Design V10 workspace launcher', () => {
  it('renders launcher metadata and failures through the six-locale copy contract', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'app', '[lang]', 'nexyfab', 'ai', 'AiDesignWorkspaceLauncher.tsx'), 'utf8');
    expect(source).toContain('{text.project}: {projectId}');
    expect(source).toContain('{text.rights}: {text.userOwned}');
    expect(source).toContain('{text.exactCad}: {text.notRun}');
    expect(source).toContain('setError(text.createFailed)');
    expect(source).not.toContain('Rights: user_owned');
  });

  it('creates a rights-cleared, hash- and revision-bound text session request', async () => {
    const created = await createAiDesignTextWorkspaceRequestV10('project-1', 'Design a 120 mm sensor bracket.');
    const input = created.body.inputs[0];
    expect(input).toMatchObject({ projectId: 'project-1', revision: 0, kind: 'text', authority: 'user_confirmed', provenance: { rights: 'user_owned' } });
    expect(input.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(input.projectContentHash).toBe(input.sourceHash);
    expect(adaptAiDesignInput(input).blockers).toEqual([]);
    expect(createAiDesignWorkspaceRuntime({ projectId: 'project-1', sessionId: created.sessionId, revisionToken: created.body.revisionToken, inputs: created.body.inputs })).toMatchObject({ ok: true, state: { runtimeRevision: 0 } });
  });

  it('rejects empty and oversized prompts before network use', async () => {
    await expect(createAiDesignTextWorkspaceRequestV10('project-1', '   ')).rejects.toThrow('AI_DESIGN_PROMPT_LENGTH_INVALID');
    await expect(createAiDesignTextWorkspaceRequestV10('project-1', 'x'.repeat(4_001))).rejects.toThrow('AI_DESIGN_PROMPT_LENGTH_INVALID');
  });
});
