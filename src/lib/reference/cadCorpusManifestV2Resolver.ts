import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import {
  CAD_CORPUS_MANIFEST_V2_SCHEMA,
  validateCadCorpusManifestV2,
  type CadCorpusFixtureV2,
  type CadCorpusManifestV2,
} from './cadCorpusManifestV2';

export type CadCorpusResolveErrorCode =
  | 'INVALID_MANIFEST'
  | 'INVALID_ROOT'
  | 'LOCATOR_NOT_FOUND'
  | 'LOCATOR_AMBIGUOUS'
  | 'BYTE_BUDGET_EXCEEDED'
  | 'SOURCE_CHANGED';

export class CadCorpusResolveError extends Error {
  constructor(
    readonly code: CadCorpusResolveErrorCode,
    message: string,
    readonly fixtureId?: string,
  ) {
    super(message);
    this.name = 'CadCorpusResolveError';
  }
}

export interface ResolvedCadCorpusFixtureV2 {
  fixtureId: string;
  /** Slash-separated path relative to the supplied corpus root; never absolute. */
  relativePath: string;
  sha256: string;
  bytes: number;
}

interface LocatedFile {
  absolutePath: string;
  relativePath: string;
}

function isWithinRoot(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return fromRoot === '' || (!fromRoot.startsWith(`..${sep}`) && fromRoot !== '..' && !isAbsolute(fromRoot));
}

function locatorMatches(relativePath: string, fragments: readonly string[]): boolean {
  const normalizedPath = relativePath.toLocaleLowerCase('en-US');
  let cursor = 0;
  for (const fragment of fragments) {
    const index = normalizedPath.indexOf(fragment.toLocaleLowerCase('en-US'), cursor);
    if (index < 0) return false;
    cursor = index + fragment.length;
  }
  return true;
}

async function listFiles(root: string): Promise<LocatedFile[]> {
  const files: LocatedFile[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of entries) {
      // A corpus symlink may escape the approved root or create a traversal cycle.
      if (entry.isSymbolicLink()) continue;
      const absolutePath = resolve(directory, entry.name);
      if (!isWithinRoot(root, absolutePath)) continue;
      if (entry.isDirectory()) await visit(absolutePath);
      else if (entry.isFile()) {
        files.push({
          absolutePath,
          relativePath: relative(root, absolutePath).split(sep).join('/'),
        });
      }
    }
  };
  await visit(root);
  return files;
}

async function locateFixture(
  canonicalRoot: string,
  fixture: CadCorpusFixtureV2,
  files?: readonly LocatedFile[],
): Promise<LocatedFile> {
  const candidates = (files ?? await listFiles(canonicalRoot))
    .filter(file => locatorMatches(file.relativePath, fixture.locator.fragments));
  if (candidates.length === 0) {
    throw new CadCorpusResolveError(
      'LOCATOR_NOT_FOUND',
      `Fixture ${fixture.fixtureId} locator matched no file.`,
      fixture.fixtureId,
    );
  }
  if (candidates.length > 1) {
    throw new CadCorpusResolveError(
      'LOCATOR_AMBIGUOUS',
      `Fixture ${fixture.fixtureId} locator matched ${candidates.length} files.`,
      fixture.fixtureId,
    );
  }
  return candidates[0]!;
}

async function hashWithinBudget(file: LocatedFile, fixture: CadCorpusFixtureV2, maxFixtureBytes: number) {
  const before = await stat(file.absolutePath);
  const limit = Math.min(fixture.byteBudget, maxFixtureBytes);
  if (!before.isFile() || before.size > limit) {
    throw new CadCorpusResolveError(
      'BYTE_BUDGET_EXCEEDED',
      `Fixture ${fixture.fixtureId} has ${before.size} bytes; limit is ${limit}.`,
      fixture.fixtureId,
    );
  }

  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(file.absolutePath)) {
    const data = chunk as Buffer;
    bytes += data.byteLength;
    if (bytes > limit) {
      throw new CadCorpusResolveError(
        'BYTE_BUDGET_EXCEEDED',
        `Fixture ${fixture.fixtureId} exceeded its byte budget while reading.`,
        fixture.fixtureId,
      );
    }
    hash.update(data);
  }
  const after = await stat(file.absolutePath);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || bytes !== after.size) {
    throw new CadCorpusResolveError(
      'SOURCE_CHANGED',
      `Fixture ${fixture.fixtureId} changed while hashing.`,
      fixture.fixtureId,
    );
  }
  return { sha256: hash.digest('hex'), bytes };
}

async function canonicalCorpusRoot(corpusRoot: string): Promise<string> {
  if (!corpusRoot.trim()) throw new CadCorpusResolveError('INVALID_ROOT', 'Corpus root is required.');
  try {
    const canonical = await realpath(corpusRoot);
    if (!(await stat(canonical)).isDirectory()) throw new Error('not a directory');
    return canonical;
  } catch (error) {
    if (error instanceof CadCorpusResolveError) throw error;
    throw new CadCorpusResolveError('INVALID_ROOT', 'Corpus root must be an existing directory.');
  }
}

/** Resolve and fingerprint one fixture. The returned path is relative and contains no CAD bytes. */
export async function resolveCadCorpusFixtureV2(
  corpusRoot: string,
  fixture: CadCorpusFixtureV2,
  maxFixtureBytes = fixture.byteBudget,
): Promise<ResolvedCadCorpusFixtureV2> {
  const root = await canonicalCorpusRoot(corpusRoot);
  const file = await locateFixture(root, fixture);
  const fingerprint = await hashWithinBudget(file, fixture, maxFixtureBytes);
  return { fixtureId: fixture.fixtureId, relativePath: file.relativePath, ...fingerprint };
}

/**
 * Resolve all draft fixtures and return an immutable-style frozen snapshot.
 * Resolved paths are intentionally not persisted: the locator remains portable metadata.
 */
export async function freezeCadCorpusManifestV2(
  draft: CadCorpusManifestV2,
  corpusRoot: string,
): Promise<CadCorpusManifestV2> {
  if (draft.schema !== CAD_CORPUS_MANIFEST_V2_SCHEMA || draft.lifecycle !== 'draft') {
    throw new CadCorpusResolveError('INVALID_MANIFEST', 'Only a Manifest v2 draft can be frozen.');
  }
  const validation = validateCadCorpusManifestV2(draft);
  if (validation.length > 0) {
    throw new CadCorpusResolveError('INVALID_MANIFEST', validation[0]!.message);
  }

  const root = await canonicalCorpusRoot(corpusRoot);
  const files = await listFiles(root);
  const frozenFixtures: CadCorpusFixtureV2[] = [];
  let runBytes = 0;
  for (const fixture of draft.fixtures) {
    const file = await locateFixture(root, fixture, files);
    const fingerprint = await hashWithinBudget(file, fixture, draft.byteBudget.maxFixtureBytes);
    runBytes += fingerprint.bytes;
    if (runBytes > draft.byteBudget.maxRunBytes) {
      throw new CadCorpusResolveError(
        'BYTE_BUDGET_EXCEEDED',
        `Manifest run bytes exceed ${draft.byteBudget.maxRunBytes}.`,
        fixture.fixtureId,
      );
    }
    frozenFixtures.push({ ...fixture, locator: { ...fixture.locator, fragments: [...fixture.locator.fragments] }, assertions: [...fixture.assertions], usage: { ...fixture.usage }, ...fingerprint });
  }

  const frozen: CadCorpusManifestV2 = {
    ...draft,
    lifecycle: 'frozen',
    byteBudget: { ...draft.byteBudget },
    fixtures: frozenFixtures,
  };
  const frozenIssues = validateCadCorpusManifestV2(frozen);
  if (frozenIssues.length > 0) {
    throw new CadCorpusResolveError('INVALID_MANIFEST', frozenIssues[0]!.message);
  }
  return frozen;
}
