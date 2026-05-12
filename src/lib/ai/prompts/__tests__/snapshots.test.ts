import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { getPrompt, listPromptIds } from '../index';

/**
 * Golden-snapshot tests for prompt content.
 *
 * Each prompt's full template is hashed (sha256) and compared against a
 * frozen value. Any unintended edit — a typo, a stray word, an accidental
 * deletion — causes the test to fail with a clear "this prompt changed"
 * signal in PR review.
 *
 * When a prompt change IS intentional:
 *   1. Bump `version` in the prompt definition (e.g. 1.0.0 → 1.1.0).
 *   2. Compute the new hash:
 *        node -e "const c=require('node:crypto');console.log(c.createHash('sha256').update(\`<paste template here>\`).digest('hex'))"
 *      …or run `vitest -u` to update the snapshot interactively.
 *   3. Update the table below + commit. PR reviewer sees both the diff
 *      AND the version bump, never one without the other.
 */

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

// To regenerate after an intentional prompt change, run with UPDATE_SNAPSHOTS=1
// and copy the printed hash into the table below.
const UPDATE = process.env.UPDATE_SNAPSHOTS === '1';

interface Snapshot {
  version: string;
  templateHash: string;
}

const GOLDEN: Record<string, Snapshot> = {
  'shape-chat':                  { version: '1.0.0', templateHash: '5ae3a7a77dd63ba53099733999b03f958b8bcbf6be072069132a48e9a72c81a6' },
  'scad-intent-from-nl':         { version: '1.1.0', templateHash: '78c258901bbc0d4bfc7737101a746e7dad7ebf47c05839740646cc6298cf3777' },
  'scad-intent-from-nl:tighter': { version: '1.1.0', templateHash: '78c258901bbc0d4bfc7737101a746e7dad7ebf47c05839740646cc6298cf3777' },
  'openscad-gen':                { version: '1.0.0', templateHash: '32b9897ff298e6ce7200c932b8b779eaf4f7bae6f2d6d08091ef2d945cdf56aa' },
  'openscad-gen-generate':       { version: '1.0.0', templateHash: '32b9897ff298e6ce7200c932b8b779eaf4f7bae6f2d6d08091ef2d945cdf56aa' },
  'openscad-gen-refine':         { version: '1.0.0', templateHash: 'ee5a3a70366e947988a43b26f878664ce2080d36f73d0505c6a7aeb5355131fa' },
  'openscad-gen-fix':            { version: '1.0.0', templateHash: 'a2209c5faf82520657c67e2f3c836647e5e9d399f0e472b0dd2350518d6a42c3' },
  'openscad-gen-face-op':        { version: '1.0.0', templateHash: '59df450b47bde31ee70a8c5e5b32c43cb2ea91b74f760f8c1ca130b79b12c89e' },
  'compose':                     { version: '1.0.0', templateHash: 'fb1aee0a582ddf6d0c5b196b003be76ae8744cda41eb653f08be407c18a0a628' },
  'intake-from-text':            { version: '1.0.0', templateHash: 'ba5e4374bb700373c2a23cf7887478d1c2105a0202eeb2f074ba4ec50322def7' },
  'shape-to-jscad':              { version: '1.0.0', templateHash: 'e7caa19c70d6d8305fcd7a4d11d8fb258d007ba9111813b259d17632a968b8ce' },
};

describe('prompt golden snapshots', () => {
  // Self-discovery: every registered prompt must have a snapshot entry.
  it('every registered prompt has a golden snapshot entry', () => {
    const registered = listPromptIds().sort();
    const recorded = Object.keys(GOLDEN).sort();
    expect(registered).toEqual(recorded);
  });

  for (const [id, snap] of Object.entries(GOLDEN)) {
    it(`${id} matches its golden snapshot`, () => {
      const prompt = getPrompt(id);
      const actualHash = sha256(prompt.template);

      if (UPDATE) {
        // Print fresh values so a developer can copy them into GOLDEN above.
         
        console.log(`UPDATE: '${id}': { version: '${prompt.version}', templateHash: '${actualHash}' },`);
        return;
      }

      // First-run helper: empty hash means "I haven't been computed yet".
      // We allow this once so the developer can run UPDATE_SNAPSHOTS=1 to bootstrap.
      if (snap.templateHash === '') {
         
        console.log(`SEED: '${id}': { version: '${prompt.version}', templateHash: '${actualHash}' },`);
        return;
      }

      expect(prompt.version).toBe(snap.version);
      expect(actualHash).toBe(snap.templateHash);
    });
  }
});
