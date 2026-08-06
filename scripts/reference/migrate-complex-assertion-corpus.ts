import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { applyAssertionReviews, migrateAssertionGraphCase, validateAssertionGraph, type AssertionGraphNode, type AssertionMigrationSeed, type ComplexAssertionReviewRecord } from '../../src/lib/ai/complexAssertionReview';
import { validateComplexBenchmarkV2, type ComplexBenchmarkCaseV2 } from '../../src/lib/ai/complexProductBenchmarkV2';

interface MigrationCaseSeed { caseId: string; family: ComplexBenchmarkCaseV2['family']; tier: 'T1' | 'T2' | 'T3'; holdoutGroup: string; sourceHash: string; assertions: AssertionMigrationSeed[]; }
interface MigrationInput { schema: 'nexyfab.complex-assertion-migration-seed.v1'; cases: MigrationCaseSeed[]; }
const value = (name: string) => process.argv.find(item => item.startsWith(`--${name}=`))?.slice(name.length + 3);
async function load<T>(file: string): Promise<T> { return JSON.parse(await readFile(file, 'utf8')) as T; }

async function main() {
  const inputPath = value('input'), outputDirectory = path.resolve(value('output') ?? 'docs/evidence/complex-corpus-v2'), reviewsPath = value('reviews');
  if (!inputPath) throw new Error('Usage: --input=migration-seed.json [--reviews=reviews.json] [--output=directory]');
  const input = await load<MigrationInput>(path.resolve(inputPath)); if (input.schema !== 'nexyfab.complex-assertion-migration-seed.v1') throw new Error('assertion_migration_seed_schema_invalid');
  const reviews = reviewsPath ? await load<ComplexAssertionReviewRecord[]>(path.resolve(reviewsPath)) : [];
  const cases: ComplexBenchmarkCaseV2[] = [], graph: Array<{ caseId: string; nodes: AssertionGraphNode[] }> = [], issues: string[] = [], approved: string[] = [];
  for (const seed of input.cases) {
    const migrated = migrateAssertionGraphCase(seed), caseReviews = reviews.filter(item => item.caseId === seed.caseId), reviewed = applyAssertionReviews(migrated.caseValue, caseReviews);
    cases.push(reviewed.caseValue); graph.push({ caseId: seed.caseId, nodes: migrated.graph }); issues.push(...reviewed.issues.map(issue => `${seed.caseId}:${issue}`), ...validateAssertionGraph(reviewed.caseValue, migrated.graph).map(issue => `${seed.caseId}:${issue}`)); approved.push(...reviewed.approvedAssertionIds.map(id => `${seed.caseId}:${id}`));
  }
  issues.push(...validateComplexBenchmarkV2(cases, []));
  if (issues.length) throw new Error(issues.join(' '));
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(path.join(outputDirectory, 'cases.json'), `${JSON.stringify(cases, null, 2)}\n`);
  await writeFile(path.join(outputDirectory, 'assertion-graph.json'), `${JSON.stringify({ schema: 'nexyfab.complex-assertion-graph.v1', cases: graph }, null, 2)}\n`);
  await writeFile(path.join(outputDirectory, 'review-summary.json'), `${JSON.stringify({ schema: 'nexyfab.complex-review-summary.v1', cases: cases.length, assertions: cases.reduce((sum, item) => sum + item.assertions.length, 0), approved }, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ cases: cases.length, approvedAssertions: approved.length, outputDirectory })}\n`);
}
main().catch(error => { process.stderr.write(`complex assertion corpus migration failed: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
