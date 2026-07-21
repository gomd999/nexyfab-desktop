/**
 * documentPersistence.ts — client fetch layer bridging the in-memory PDM
 * session (versionBranch / sessionRepoStore) to the SERVER-SIDE documents
 * version stack (`/api/documents/[id]/versions`, built by Wave 6 A/B/C).
 *
 * Why this exists (G4 limit carry-over, 260722):
 *   sessionRepoStore holds the commit/branch/merge graph purely in memory, so
 *   a browser refresh loses the whole history. The documents API already
 *   persists an explicit-snapshot version stack (BIGINT-ms, auth + lock aware)
 *   — the piece that was missing is the CLIENT wiring that pushes a PDM commit
 *   as a version snapshot and rebuilds the commit graph from the version list
 *   on load.
 *
 * SERVER IS NOT MODIFIED. This module only consumes the existing routes:
 *   POST /api/documents/[id]/versions   — record an explicit snapshot
 *   GET  /api/documents/[id]/versions   — list snapshots (newest-first)
 *
 * How the graph round-trips WITHOUT a server change
 * -------------------------------------------------
 * The POST body the server accepts is `{ label?, branchName?, parentVersionId? }`
 * — it does NOT take an arbitrary feature payload (the blob is copied from the
 * live `current.ydoc` on the server). So the PDM commit's STRUCTURE (commit id,
 * parent ids, branch, message) is encoded into the `label` field as a compact
 * marker-prefixed JSON "envelope". `GET` returns `label`, so the envelope
 * round-trips and the graph is rebuilt from it. Author + timestamp come from
 * the server row (`createdBy` / `createdAt`), so they are not duplicated.
 *
 * Branch / merge metadata: the envelope's `p` array carries 0 parents (root),
 * 1 (linear), or 2 (merge) commit ids — so a 2-parent merge commit round-trips
 * as a 2-parent reconstructed commit. The branch name is in `b`.
 *
 * APPROXIMATION / follow-up (honest):
 *   - The per-commit FEATURE snapshot itself is the server's R2 blob
 *     (`current.ydoc`), which real save/collab writes. Full feature-payload
 *     round-trip through real R2 is a documented follow-up; this layer restores
 *     the commit GRAPH (structure + metadata), not the geometry blob.
 *   - The server caps `label` at 100 chars. Very long commit messages are
 *     truncated in the envelope (`m`) to keep the envelope under that cap; the
 *     graph structure (ids/parents/branch) is never truncated.
 */

import type { Commit } from './versionBranch';

// ── Server response shapes (mirror publicVersionShape / publicDocShape) ──────

/** One row from `publicVersionShape` (GET/POST `.../versions`). */
export interface PublicVersion {
  id: string;
  documentId: string;
  parentVersionId: string | null;
  blobKey: string;
  oplogKey: string | null;
  label: string | null;
  branchName: string | null;
  isExplicit: boolean;
  sizeBytes: number;
  restoredFrom: string | null;
  createdBy: string;
  createdAt: number;
}

// ── Commit envelope (encoded into the version `label`) ───────────────────────

/** Marker so we can tell OUR labels apart from plain user labels / restore
 *  labels / collab auto-snapshots when rebuilding the graph. */
export const ENVELOPE_PREFIX = 'nfpdm:';

/** Total label budget the server enforces (versions/route.ts MAX_LABEL_LEN). */
const MAX_LABEL_LEN = 100;

/**
 * Compact commit descriptor carried in the version label. Kept terse so the
 * JSON + prefix fit the server's 100-char label cap for typical commits.
 *   v   schema version
 *   cid PDM commit id
 *   p   parent commit ids (0 root | 1 linear | 2 merge)
 *   b   branch name at commit time
 *   a   author user id (round-trips exactly; not just the pusher)
 *   m   commit message (may be truncated to fit MAX_LABEL_LEN)
 */
export interface CommitEnvelope {
  v: 1;
  cid: string;
  p: string[];
  b: string;
  a: string;
  m: string;
}

/** Serialize a commit + its branch into a label-safe envelope string. */
export function encodeCommitEnvelope(commit: Commit, branchName: string): string {
  const build = (message: string): string =>
    ENVELOPE_PREFIX +
    JSON.stringify({
      v: 1,
      cid: commit.id,
      p: commit.parents.slice(),
      b: branchName,
      a: commit.authorUserId,
      m: message,
    } satisfies CommitEnvelope);

  let label = build(commit.message);
  if (label.length <= MAX_LABEL_LEN) return label;

  // Structure (ids/parents/branch) is load-bearing and never dropped; only the
  // message is trimmed until the whole envelope fits the server cap.
  const overflow = label.length - MAX_LABEL_LEN;
  const trimmedMsg = commit.message.slice(0, Math.max(0, commit.message.length - overflow - 1));
  label = build(trimmedMsg);
  // JSON escaping can still push it over for pathological messages — hard clamp.
  return label.length <= MAX_LABEL_LEN ? label : label.slice(0, MAX_LABEL_LEN);
}

/** Parse a label back into an envelope, or null if it is not one of ours. */
export function decodeCommitEnvelope(label: string | null): CommitEnvelope | null {
  if (!label || !label.startsWith(ENVELOPE_PREFIX)) return null;
  try {
    const raw = JSON.parse(label.slice(ENVELOPE_PREFIX.length)) as Partial<CommitEnvelope>;
    if (raw.v !== 1 || typeof raw.cid !== 'string' || !Array.isArray(raw.p)) return null;
    return {
      v: 1,
      cid: raw.cid,
      p: raw.p.filter((x): x is string => typeof x === 'string'),
      b: typeof raw.b === 'string' ? raw.b : 'main',
      a: typeof raw.a === 'string' ? raw.a : '',
      m: typeof raw.m === 'string' ? raw.m : '',
    };
  } catch {
    return null;
  }
}

// ── Failure IR (never silent) ────────────────────────────────────────────────

export type PersistFailureReason =
  | 'not_bound'      // session has no documentId — persistence is opt-in, not an error
  | 'offline'        // fetch threw (network / no connectivity)
  | 'unauthorized'   // 401
  | 'forbidden'      // 403 (viewer role, etc.)
  | 'locked'         // 423 (another user holds the check-out)
  | 'not_found'      // 404 (doc/version missing or no access)
  | 'server_error';  // 4xx/5xx other

export class PersistenceError extends Error {
  constructor(public readonly reason: PersistFailureReason, message: string) {
    super(message);
    this.name = 'PersistenceError';
  }
}

function reasonForStatus(status: number): PersistFailureReason {
  switch (status) {
    case 401: return 'unauthorized';
    case 403: return 'forbidden';
    case 404: return 'not_found';
    case 423: return 'locked';
    default:  return 'server_error';
  }
}

// ── Fetch options ─────────────────────────────────────────────────────────────

export interface PersistOptions {
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Server version id of the first-parent commit's snapshot, if already
   *  pushed. Required by the server whenever `branchName` is sent. */
  parentVersionId?: string | null;
}

/** Server branch-name charset (versions/route.ts). Labels always carry the
 *  branch regardless; this only gates the OPTIONAL server-side `branchName`
 *  denormalization so we never trip a 400. */
export function isServerBranchName(name: string): boolean {
  return name.length >= 1 && name.length <= 80 && /^[a-zA-Z0-9_./-]+$/.test(name);
}

function resolveFetch(opts: PersistOptions): typeof fetch {
  const f = opts.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : undefined);
  if (!f) throw new PersistenceError('offline', 'no fetch implementation available');
  return f;
}

// ── POST: push a commit as an explicit version snapshot ──────────────────────

/**
 * Record `commit` on `documentId` as an explicit snapshot. Returns the created
 * server version. Throws `PersistenceError` (with a typed reason) on any
 * failure — the caller must surface it; a dropped snapshot is never silent.
 */
export async function pushCommitVersion(
  documentId: string,
  commit: Commit,
  branchName: string,
  opts: PersistOptions = {},
): Promise<PublicVersion> {
  const f = resolveFetch(opts);
  const label = encodeCommitEnvelope(commit, branchName);

  const body: { label: string; branchName?: string; parentVersionId?: string } = { label };
  // Server rule: `branchName` REQUIRES a valid `parentVersionId`. Only send the
  // pair when we have a mapped parent version AND the name is server-legal.
  // Otherwise the branch still round-trips through the envelope label.
  if (opts.parentVersionId && isServerBranchName(branchName)) {
    body.branchName = branchName;
    body.parentVersionId = opts.parentVersionId;
  }

  let res: Response;
  try {
    res = await f(`/api/documents/${encodeURIComponent(documentId)}/versions`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new PersistenceError('offline', `version POST failed (network): ${(err as Error).message}`);
  }

  if (!res.ok) {
    let detail = '';
    try {
      const j = (await res.json()) as { error?: string; code?: string };
      detail = j.code ? `${j.code}${j.error ? `: ${j.error}` : ''}` : (j.error ?? '');
    } catch { /* non-JSON body */ }
    throw new PersistenceError(
      reasonForStatus(res.status),
      `version POST ${res.status}${detail ? ` (${detail})` : ''}`,
    );
  }

  const json = (await res.json()) as { version: PublicVersion };
  return json.version;
}

// ── GET: fetch the version history ───────────────────────────────────────────

export async function fetchVersionHistory(
  documentId: string,
  opts: PersistOptions = {},
): Promise<PublicVersion[]> {
  const f = resolveFetch(opts);
  let res: Response;
  try {
    res = await f(`/api/documents/${encodeURIComponent(documentId)}/versions`, {
      method: 'GET',
      credentials: 'include',
    });
  } catch (err) {
    throw new PersistenceError('offline', `version GET failed (network): ${(err as Error).message}`);
  }
  if (!res.ok) {
    throw new PersistenceError(reasonForStatus(res.status), `version GET ${res.status}`);
  }
  const json = (await res.json()) as { versions?: PublicVersion[] };
  return json.versions ?? [];
}

// ── Reconstruction: version list → commit graph read-model ───────────────────

/** A commit rebuilt from a persisted version's envelope + server row. */
export interface ReconstructedCommit {
  id: string;
  parents: string[];
  branch: string;
  message: string;
  author: string;
  timestamp: number;
  /** Server version id this commit was restored from (for lineage / restore). */
  versionId: string;
}

export interface ReconstructedGraph {
  /** Oldest-first (root → tip), ready for a history view. */
  commits: ReconstructedCommit[];
  branches: { name: string; headCommitId: string }[];
  headBranch: string;
  /** Versions whose label was NOT a PDM envelope (restore snapshots, collab
   *  auto-ticks, plain user labels) — counted, never silently reinterpreted. */
  skipped: number;
}

/**
 * Rebuild the PDM commit graph from a version list (as returned newest-first by
 * `GET .../versions`). Only OUR envelope-labelled versions become commits;
 * everything else is counted in `skipped`.
 */
export function reconstructGraph(versions: PublicVersion[]): ReconstructedGraph {
  const commitsNewestFirst: ReconstructedCommit[] = [];
  let skipped = 0;

  for (const v of versions) {
    const env = decodeCommitEnvelope(v.label);
    if (!env) { skipped++; continue; }
    commitsNewestFirst.push({
      id: env.cid,
      parents: env.p,
      branch: env.b,
      message: env.m,
      // Author round-trips via the envelope; fall back to the server row's
      // pusher only for legacy envelopes that predate the `a` field.
      author: env.a || v.createdBy,
      timestamp: v.createdAt,
      versionId: v.id,
    });
  }

  // Branch heads: first occurrence in newest-first order is the tip.
  const branchHead = new Map<string, string>();
  for (const c of commitsNewestFirst) {
    if (!branchHead.has(c.branch)) branchHead.set(c.branch, c.id);
  }
  const branches = Array.from(branchHead.entries()).map(([name, headCommitId]) => ({
    name, headCommitId,
  }));

  const headBranch = branchHead.has('main')
    ? 'main'
    : (commitsNewestFirst[0]?.branch ?? 'main');

  return {
    commits: commitsNewestFirst.slice().reverse(), // oldest-first for display
    branches,
    headBranch,
    skipped,
  };
}
