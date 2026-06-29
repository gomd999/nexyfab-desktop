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
  // NexyFab core
  'shape-chat':                  { version: '1.0.0', templateHash: '5ae3a7a77dd63ba53099733999b03f958b8bcbf6be072069132a48e9a72c81a6' },
  'scad-intent-from-nl':         { version: '1.6.0', templateHash: 'b0fe7332f8b7822d7f4e1991da13547403523d4e342ffde6e121d153d6ae2e09' },
  'scad-freeform':               { version: '1.10.0', templateHash: '1a1f0c55404b157fc319c2dfd8f7f59293beab817e27a7e4c5f1d0a9c544f934' },
  'cad-feature-program':         { version: '1.0.0', templateHash: '0c59290b2f7dacd3585ec97da3aa59ee4a2cb93ccb00b04d66442e97333d73c7' },
  'scad-intent-from-nl:tighter': { version: '1.1.0', templateHash: 'b0fe7332f8b7822d7f4e1991da13547403523d4e342ffde6e121d153d6ae2e09' },
  'openscad-gen':                { version: '1.0.0', templateHash: '32b9897ff298e6ce7200c932b8b779eaf4f7bae6f2d6d08091ef2d945cdf56aa' },
  'openscad-gen-generate':       { version: '1.0.0', templateHash: '32b9897ff298e6ce7200c932b8b779eaf4f7bae6f2d6d08091ef2d945cdf56aa' },
  'openscad-gen-refine':         { version: '1.0.0', templateHash: 'ee5a3a70366e947988a43b26f878664ce2080d36f73d0505c6a7aeb5355131fa' },
  'openscad-gen-fix':            { version: '1.0.0', templateHash: 'a2209c5faf82520657c67e2f3c836647e5e9d399f0e472b0dd2350518d6a42c3' },
  'openscad-gen-face-op':        { version: '1.0.0', templateHash: '59df450b47bde31ee70a8c5e5b32c43cb2ea91b74f760f8c1ca130b79b12c89e' },
  'compose':                     { version: '1.0.0', templateHash: 'fb1aee0a582ddf6d0c5b196b003be76ae8744cda41eb653f08be407c18a0a628' },
  'intake-from-text':            { version: '1.0.0', templateHash: 'ba5e4374bb700373c2a23cf7887478d1c2105a0202eeb2f074ba4ec50322def7' },
  'shape-to-jscad':              { version: '1.0.0', templateHash: 'e7caa19c70d6d8305fcd7a4d11d8fb258d007ba9111813b259d17632a968b8ce' },
  'imageIntentFromSketch.v1':    { version: '1.0.0', templateHash: 'efaf093c745ef9463fac77d509a89e54b96148a4373a28661222aa88442f9955' },
  // Marketplace / RFQ / advisor prompts (added in earlier rounds without
  // snapshot updates — this block fixes the prior debt while landing
  // imageIntentFromSketch.v1).
  'ai-advisor':                  { version: '1.1.0', templateHash: '468bb38d4dc68dbcb232c774b72c354a14028adfd56c0d0ac763e75e60512959' },
  'capacity-match':              { version: '1.0.0', templateHash: 'd0e329e57b8a2e1b40eeb036febbf79cad0a32bd66d27aed04164209a86437e9' },
  'cert-filter':                 { version: '1.0.0', templateHash: 'ae6bb41ef60f32a36dea2e2a7fa7ee8303e1cc8f36d5f706b77f37a6a225a84c' },
  'change-detector':             { version: '1.0.0', templateHash: '47afdc38244b64c309696fa720450392e5477ece34064bdbcb67d16376fb797e' },
  'cost-copilot':                { version: '1.0.0', templateHash: '375fb465eb388bc4e351022a13d3810b5ef190de10f8026d7ea6136911da30c5' },
  'cost-copilot:tighter':        { version: '1.1.0', templateHash: '375fb465eb388bc4e351022a13d3810b5ef190de10f8026d7ea6136911da30c5' },
  'dfm-explainer':               { version: '1.0.0', templateHash: '7663140acfddeeeb2141da55c86fc0a7a4457b9d5e8fa7e1bbe5e48a77b12c0d' },
  'order-priority':              { version: '1.0.0', templateHash: 'bcc70c456ef1bc51941a61de5a84e230f7bd08016b63e4b8fbe4bf786e2d460b' },
  'process-router':              { version: '1.0.0', templateHash: '976bc40f50f39ac9100c4269633bcfc83ff65766312d3ae843a9783d34745c03' },
  'quote-accuracy':              { version: '1.0.0', templateHash: 'df8a6610b03d9693f41e34f2d693075a7ffd7eb049e676fc75cdbf3e0f54c6a3' },
  'quote-negotiator':            { version: '1.0.0', templateHash: 'f1a8345e8db426d89e8adff60e95c2076f200dacfa7156cfd00a8cc4d66275c1' },
  'rfq-responder':               { version: '1.0.0', templateHash: '7856eff85f61c33df6ac8b83c8e06de7083a354f4b61bd16d629ba0a1a3dbf28' },
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
