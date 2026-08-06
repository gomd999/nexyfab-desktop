import { pathToFileURL } from 'node:url';
import { CAD_CORPUS_MANIFEST_V2 } from '../../src/lib/reference/cadCorpusManifestV2';
import { freezeCadCorpusManifestV2 } from '../../src/lib/reference/cadCorpusManifestV2Resolver';
import { runCadCorpusBatchV2 } from '../../src/lib/reference/cadCorpusBatchRunnerV2';
import { loadOcctNode } from '../../src/lib/occt/nodeOcctLoader';
import { createNodeOcctBridge } from '../../src/lib/occt/nodeOcctBridge';
import { parseReferenceBaselineArgs, REFERENCE_BASELINE_LOCAL_CAPABILITY } from './reference-baseline-cli';

export const REFERENCE_BASELINE_EXIT = { ok: 0, runtime: 1, usage: 2, incomplete: 4, failed: 5, analysis: 6 } as const;

export function referenceBaselineErrorExit(error: unknown): number {
  const code = (error as { code?: unknown })?.code;
  return code === 'CHECKPOINT_SIGNATURE_MISMATCH' || code === 'SOURCE_CHANGED'
    ? REFERENCE_BASELINE_EXIT.analysis
    : REFERENCE_BASELINE_EXIT.runtime;
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  if (args.includes('--help')) {
    process.stdout.write(
      'Local-only CAD corpus baseline (no API/MCP, quote, or RFQ)\n'
      + 'usage: npm run corpus:baseline:v2 -- --root <corpus> --output <dir> --unit mm '
      + '[--tier core-a|challenge-b] [--fixture A01,A02] [--shard-index I --shard-count N] [--resume] [--tolerance N]\n',
    );
    return REFERENCE_BASELINE_EXIT.ok;
  }
  const parsed = parseReferenceBaselineArgs(args);
  if (!parsed.ok) {
    process.stderr.write(`reference baseline usage error: ${parsed.error}\n`);
    return REFERENCE_BASELINE_EXIT.usage;
  }
  try {
    const manifest = await freezeCadCorpusManifestV2(CAD_CORPUS_MANIFEST_V2, parsed.value.corpusRoot);
    const loaded = await loadOcctNode();
    if (!loaded.ok || !loaded.oc) {
      process.stderr.write('reference baseline failed: exact OCCT kernel is unavailable.\n');
      return REFERENCE_BASELINE_EXIT.analysis;
    }
    const summary = await runCadCorpusBatchV2({
      ...parsed.value,
      manifest,
      bridge: createNodeOcctBridge(loaded.oc),
    });
    // Deliberately print only governed aggregate metadata; local paths remain local.
    process.stdout.write(`${JSON.stringify({
      capability: REFERENCE_BASELINE_LOCAL_CAPABILITY.id,
      schema: summary.schema,
      signature: summary.signature,
      selected: summary.selected,
      counts: summary.counts,
      localOnly: true,
      quoteOrRfqSideEffects: false,
    })}\n`);
    if (summary.counts.error > 0) return REFERENCE_BASELINE_EXIT.analysis;
    if (summary.counts.fail > 0) return REFERENCE_BASELINE_EXIT.failed;
    if (summary.counts.not_run > 0) return REFERENCE_BASELINE_EXIT.incomplete;
    return REFERENCE_BASELINE_EXIT.ok;
  } catch (error) {
    const code = typeof (error as { code?: unknown })?.code === 'string' ? (error as { code: string }).code : 'BATCH_FAILED';
    // Do not echo arbitrary fs errors: they may contain corpus/output paths.
    process.stderr.write(`reference baseline failed (${code}).\n`);
    return referenceBaselineErrorExit(error);
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  // The headless OCCT/Emscripten runtime may retain internal handles after
  // all evidence and the atomic summary have been flushed. Explicit exit is
  // therefore the CLI lifecycle boundary; imported tests still call `main`
  // normally and are never terminated.
  void main().then(code => { process.exit(code); }).catch(error => { process.exit(referenceBaselineErrorExit(error)); });
}
