import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createCanonicalCadDocumentV2, hashCanonicalCadLockSet, sealCanonicalCadCommandV2, sealCanonicalCadObjectV2, type CanonicalCadCommandV2ConsumerDraft } from './canonicalCadV2ConsumerDraft';
import { CAD_RECOVERY_DB_NAME, CanonicalCadRecoveryJournal, type JournalResult, type RecoveryScope } from './canonicalCadRecoveryJournal';

const h = (c: string) => c.repeat(64);
const scope: RecoveryScope = { userId: 'user-1', projectId: 'project-1', documentId: 'document-1' };
function command(id = 'command-1'): CanonicalCadCommandV2ConsumerDraft {
  const object = sealCanonicalCadObjectV2({ objectId: 'building:wall-1', namespace: 'building', objectKind: 'building.wall', objectRevision: 0, payload: { width: 1000 }, transform: null });
  const doc = createCanonicalCadDocumentV2({ projectId: scope.projectId, documentId: scope.documentId, domains: ['building'], revision: { revisionId: 'revision-0', sequence: 0, contentSha256: h('0') }, units: { length: 'mm', angle: 'deg' }, coordinateFrame: { frameId: 'project-frame', parentFrameId: null, origin: [0, 0, 0], rotationDeg: [0, 0, 0] }, tolerancePolicy: { linear: 0.01, angularDeg: 0.1 }, objects: [object], relationships: [], sourceBindings: [{ schema: 'source.v1', revision: 'source-1', contentSha256: h('a') }] });
  return sealCanonicalCadCommandV2({ commandId: id, idempotencyKey: `idempotency-${id}`, projectId: doc.projectId, documentId: doc.documentId, baseRevision: doc.revision, nextRevisionId: `revision-${id}`, actor: { kind: 'human', actorId: 'user-1', agentIdentity: null }, units: doc.units, coordinateFrame: doc.coordinateFrame, tolerancePolicy: doc.tolerancePolicy, preconditions: { lockSetSha256: hashCanonicalCadLockSet([]), locks: [], selectedObjectIds: [], parameterPaths: [] }, dependencies: [], compensationForCommandId: null, expectedChangedObjectIds: [], artifacts: { inputs: [], expectedOutputs: [] }, authorization: { permission: 'EDIT_DOCUMENT', riskClass: 'R2', approvalScope: doc.documentId, approvalReceiptSha256: null }, resourceBudget: { timeoutMs: 1000, memoryMb: 512, maxIterations: 10, maxRetries: 0 }, sideEffects: { canonicalDocument: true, externalTransmission: false, quoteOrRfq: false }, verification: { verifierIds: ['canonical-structure'], blockers: [] }, timing: { issuedAt: '2026-08-24T00:00:00.000Z', expiresAt: '2026-08-24T01:00:00.000Z' }, staleIf: { baseRevisionChanges: true, baseContentHashChanges: true }, operations: [{ kind: 'update', objectId: object.objectId, expectedObjectContentSha256: object.contentSha256, payload: { width: 1100 } }] });
}
function makeJournal(factory = new IDBFactory()) { return { journal: new CanonicalCadRecoveryJournal({ indexedDB: factory, now: () => '2026-08-24T00:00:00.000Z' }), factory }; }
async function valueOf<T>(promise: Promise<JournalResult<T>>): Promise<T> { const result = await promise; if (!result.ok) throw new Error(result.kind); return result.value; }
async function rawDb(factory: IDBFactory) { return new Promise<IDBDatabase>((resolve, reject) => { const req = factory.open(CAD_RECOVERY_DB_NAME, 1); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); }); }

describe('canonical CAD recovery journal', () => {
  it('appends before send and enforces the state machine', async () => {
    const { journal } = makeJournal(); const cmd = command();
    const added = await journal.append(scope, cmd); expect(added).toMatchObject({ ok: true, value: { state: 'PENDING', enqueueOrder: 1 } });
    expect(await valueOf(journal.markSent(scope, cmd.commandId))).toMatchObject({ state: 'SENT' });
    expect(await valueOf(journal.markAcknowledged(scope, cmd.commandId))).toMatchObject({ state: 'ACKNOWLEDGED' });
    await expect(journal.markSent(scope, cmd.commandId)).rejects.toThrow('TRANSITION_INVALID');
  });
  it('can permanently block an unsent or rejected sent command', async () => {
    const { journal } = makeJournal(); const pending = command('command-pending'); const sent = command('command-sent');
    await journal.append(scope, pending); await journal.append(scope, sent); await journal.markSent(scope, sent.commandId);
    expect(await valueOf(journal.markBlocked(scope, pending.commandId))).toMatchObject({ state: 'BLOCKED' });
    expect(await valueOf(journal.markBlocked(scope, sent.commandId))).toMatchObject({ state: 'BLOCKED' });
    expect(await valueOf(journal.decideReplay(scope, sent.commandId, sent.baseRevision))).toBe('BLOCKED');
  });
  it('decides base match, stale/replay, gap and blocks without automatic rebase', async () => {
    const { journal } = makeJournal(); const cmd = command(); await journal.append(scope, cmd);
    const base = cmd.baseRevision;
    expect(await valueOf(journal.decideReplay(scope, cmd.commandId, base))).toBe('BASE_MATCH');
    expect(await valueOf(journal.decideReplay(scope, cmd.commandId, { revisionId: 'revision-1', sequence: 1, contentSha256: h('1') }))).toBe('STALE_OR_REPLAY');
    expect(await valueOf(journal.decideReplay(scope, cmd.commandId, { revisionId: 'revision-old', sequence: 0, contentSha256: h('9') }))).toBe('GAP');
    expect(await valueOf(journal.decideReplay(scope, cmd.commandId, null))).toBe('BLOCKED');
  });
  it('requires the server head triplet for confirmation and prunes only confirmed entries', async () => {
    const { journal } = makeJournal(); const cmd = command(); await journal.append(scope, cmd); await journal.markSent(scope, cmd.commandId); await journal.markAcknowledged(scope, cmd.commandId);
    await expect(journal.markConfirmed(scope, cmd.commandId, { revisionId: 'wrong', sequence: 1, contentSha256: h('1') })).rejects.toThrow('TRANSITION_INVALID');
    const confirmed = await valueOf(journal.markConfirmed(scope, cmd.commandId, { revisionId: cmd.nextRevisionId, sequence: 1, contentSha256: h('1') })); expect(confirmed).toMatchObject({ state: 'CONFIRMED', serverHead: { sequence: 1 } });
    expect(await valueOf(journal.pruneConfirmed(scope))).toBe(1); expect(await valueOf(journal.get(scope, cmd.commandId))).toBeNull();
  });
  it('quarantines tampered entries and never executes or deletes them', async () => {
    const { journal, factory } = makeJournal(); const cmd = command(); await journal.append(scope, cmd); const db = await rawDb(factory);
    const tx = db.transaction('pending-commands', 'readwrite'); const store = tx.objectStore('pending-commands'); const key = `${scope.userId}|${scope.projectId}|${scope.documentId}|${cmd.commandId}`; const raw = await new Promise<any>((resolve, reject) => { const req = store.get(key); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); }); raw.commandJson = raw.commandJson.replace('1100', '9999'); store.put(raw); await new Promise<void>(resolve => { tx.oncomplete = () => resolve(); }); db.close();
    expect(await journal.get(scope, cmd.commandId)).toMatchObject({ ok: false, kind: 'CORRUPT' });
    const listed = await journal.list(scope); expect(listed).toMatchObject({ ok: true, value: [] });
    const db2 = await rawDb(factory); const tx2 = db2.transaction('pending-commands', 'readonly'); const raw2 = await new Promise<any>(resolve => { const req = tx2.objectStore('pending-commands').get(key); req.onsuccess = () => resolve(req.result); }); expect(raw2.state).toBe('CORRUPT'); db2.close();
  });
  it('quarantines envelope tampering that could alter replay decisions', async () => {
    const { journal, factory } = makeJournal(); const cmd = command(); await journal.append(scope, cmd); const db = await rawDb(factory);
    const key = `${scope.userId}|${scope.projectId}|${scope.documentId}|${cmd.commandId}`; const tx = db.transaction('pending-commands', 'readwrite'); const store = tx.objectStore('pending-commands');
    const raw = await new Promise<any>((resolve, reject) => { const req = store.get(key); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); }); raw.baseRevision = { ...raw.baseRevision, sequence: 99 }; store.put(raw); await new Promise<void>(resolve => { tx.oncomplete = () => resolve(); }); db.close();
    expect(await journal.decideReplay(scope, cmd.commandId, cmd.baseRevision)).toMatchObject({ ok: false, kind: 'CORRUPT', reason: 'base_revision_mismatch' });
  });
  it('returns unavailable for SSR and a newer database without wiping it', async () => {
    const noDb = new CanonicalCadRecoveryJournal({ indexedDB: undefined }); expect(await noDb.list(scope)).toMatchObject({ ok: false, kind: 'UNAVAILABLE', reason: 'NO_INDEXEDDB' });
    const factory = new IDBFactory(); await new Promise<void>((resolve, reject) => { const req = factory.open(CAD_RECOVERY_DB_NAME, 2); req.onupgradeneeded = () => req.result.createObjectStore('pending-commands', { keyPath: 'entryKey' }); req.onsuccess = () => { req.result.close(); resolve(); }; req.onerror = () => reject(req.error); });
    expect(await new CanonicalCadRecoveryJournal({ indexedDB: factory }).list(scope)).toMatchObject({ ok: false, kind: 'UNAVAILABLE', reason: 'NEWER_DATABASE_VERSION' });
  });
  it('rejects credentials and raw artifact bytes before writing', async () => {
    const { journal } = makeJournal(); const unsafe = command(); (unsafe as any).authorization = { ...unsafe.authorization, approvalToken: 'secret' };
    await expect(journal.append(scope, unsafe)).rejects.toThrow('COMMAND_INVALID');
    const base = command('command-bytes');
    const { schema: _schema, contractVersion: _contract, modelVersion: _model, commandSha256: _hash, ...draft } = base;
    void _schema; void _contract; void _model; void _hash;
    const withBytes = sealCanonicalCadCommandV2({
      ...draft,
      operations: [{ ...base.operations[0]!, payload: { width: 1100, stepBase64: 'QUJD' } } as CanonicalCadCommandV2ConsumerDraft['operations'][number]],
    });
    await expect(journal.append(scope, withBytes)).rejects.toThrow('credentials_or_artifact_bytes_forbidden');
  });
});
