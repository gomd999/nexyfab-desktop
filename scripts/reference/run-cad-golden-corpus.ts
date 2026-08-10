import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { CAD_GOLDEN_SCENARIOS } from "../../src/lib/reference/cadCorpusManifest";
import { evaluateCadCorpusFile } from "../../src/lib/reference/cadCorpusEvidence";
import { scoreCadCorpusCandidateEvidence } from "../../src/lib/reference/cadCorpusCandidateScore";
import {
  isExcludedCorpusPath,
  normalizedExtension,
} from "../../src/lib/reference/cadCorpusGovernance";

const args = process.argv.slice(2);
const rootInput = args.find((arg) => !arg.startsWith("--")) ?? process.env.NEXYFAB_REFERENCE_CORPUS_ROOT?.trim();
if (!rootInput) throw new Error("reference_corpus_root_required");
const root = path.resolve(rootInput);
const output = args.find((arg) => arg.startsWith("--output="))?.slice(9);
const scenarioFilter = args
  .find((arg) => arg.startsWith("--scenario="))
  ?.slice(11);
const maxBytes = Number(
  args.find((arg) => arg.startsWith("--max-bytes="))?.slice(12) ??
    50 * 1024 * 1024,
);

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const relative = path.relative(root, full);
    if (isExcludedCorpusPath(relative)) continue;
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

async function main(): Promise<void> {
  const files = await walk(root);
  const scenarios = scenarioFilter
    ? CAD_GOLDEN_SCENARIOS.filter((item) => item.id === scenarioFilter)
    : CAD_GOLDEN_SCENARIOS;
  const records = [];
  for (const scenario of scenarios) {
    const ranked = files
      .map((file) => {
        const relative = path
          .relative(root, file)
          .replaceAll("\\", "/")
          .toLowerCase();
        const filename = path.basename(file).toLowerCase();
        const ext = normalizedExtension(relative);
        const termScore = scenario.discoveryTerms.reduce(
          (score, term) =>
            score + (relative.includes(term.toLowerCase()) ? 10 : 0),
          0,
        );
        const filenameTermScore = scenario.discoveryTerms.reduce(
          (score, term) =>
            score + (filename.includes(term.toLowerCase()) ? 10 : 0),
          0,
        );
        const formatIndex = scenario.preferredFormats.indexOf(ext),
          formatScore =
            formatIndex < 0
              ? 0
              : (scenario.preferredFormats.length - formatIndex) * 10;
        return {
          file,
          relative,
          ext,
          termScore,
          formatScore,
          score: termScore + filenameTermScore * 2 + formatScore,
        };
      })
      .filter((item) => item.termScore > 0 && item.formatScore > 0)
      .sort(
        (a, b) => b.score - a.score || a.relative.localeCompare(b.relative),
      );
    if (!ranked.length) {
      records.push({
        scenarioId: scenario.id,
        status: "not_run",
        reason: "No matching preferred-format source discovered.",
      });
      continue;
    }
    let selected: ((typeof ranked)[number] & { info: Awaited<ReturnType<typeof stat>>; evidenceScore: number; selectionEvidence: string[] }) | undefined,
      selectedInfo: Awaited<ReturnType<typeof stat>> | undefined;
    const skippedOversize: Array<{ sourceLabel: string; sizeBytes: number }> =
      [];
    const eligible = [];
    for (const candidate of ranked) {
      const info = await stat(candidate.file);
      if (info.size <= maxBytes) {
        const source = candidate.ext === 'step' || candidate.ext === 'stp' ? new TextDecoder('latin1').decode(await readFile(candidate.file)) : '';
        const evidence = scoreCadCorpusCandidateEvidence(candidate.ext, source, scenario.assertions);
        eligible.push({ ...candidate, info, evidenceScore: evidence.score, selectionEvidence: evidence.reasons });
        continue;
      }
      skippedOversize.push({
        sourceLabel: path.basename(candidate.file),
        sizeBytes: info.size,
      });
    }
    eligible.sort((a, b) => b.evidenceScore - a.evidenceScore || b.score - a.score || a.relative.localeCompare(b.relative));
    if (eligible.length) { selected = eligible[0]; selectedInfo = selected.info; }
    if (!selected || !selectedInfo) {
      records.push({
        scenarioId: scenario.id,
        status: "not_run",
        reason: `Every matching source exceeds max byte budget (${maxBytes}).`,
        skippedOversize,
      });
      continue;
    }
    const bytes = await readFile(selected.file);
    const result = await evaluateCadCorpusFile({
      scenarioId: scenario.id,
      extension: selected.ext,
      bytes,
      assertions: scenario.assertions,
    });
    records.push({
      ...result,
      sourceLabel: path.basename(selected.file),
      selectionEvidence: selected.selectionEvidence,
      ...(skippedOversize.length
        ? { selectionWarnings: { skippedOversize } }
        : {}),
    });
  }
  const summary = {
    pass: records.filter((item) => item.status === "pass").length,
    fail: records.filter((item) => item.status === "fail").length,
    not_run: records.filter((item) => item.status === "not_run").length,
  };
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    rootLabel: path.basename(root),
    summary,
    records,
  };
  const json = JSON.stringify(report, null, 2);
  if (output) await writeFile(path.resolve(output), json);
  else process.stdout.write(`${json}\n`);
  if (summary.fail > 0) process.exitCode = 5;
  else if (summary.not_run > 0) process.exitCode = 4;
}

main().catch((error) => {
  process.stderr.write(
    `corpus verifier failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
