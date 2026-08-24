import {
  canonicalCadConsumerDraftJson,
  hashCanonicalCadCommandV2,
  validateCanonicalCadCommandV2,
  type CanonicalCadCommandV2ConsumerDraft,
  type CanonicalCadRevisionRef,
} from './canonicalCadV2ConsumerDraft';

export const CAD_RECOVERY_DB_NAME = 'nexyfab-cad-recovery-journal';
export const CAD_RECOVERY_DB_VERSION = 1;
const STORE = 'pending-commands';
const MAX_COMMAND_JSON_BYTES = 256 * 1024;
const MAX_ENTRIES_PER_SCOPE = 256;
const MAX_ENTRIES_TOTAL = 4096;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const SENSITIVE_KEY = /(?:token|secret|password|credential|privatekey|accesskey|^bytes$|^base64$|^binary$|^blob$|(?:artifact|file|step|brep|mesh)(?:bytes|base64|data|blob))/i;
const ENTRY_KEYS = new Set(['entryKey', 'scopeKey', 'scope', 'commandId', 'commandSha256', 'idempotencyKey', 'baseRevision', 'commandJson', 'enqueueOrder', 'state', 'createdAt', 'updatedAt', 'serverHead', 'quarantineReason']);

export type RecoveryState = 'PENDING' | 'SENT' | 'ACKNOWLEDGED' | 'CONFIRMED' | 'BLOCKED' | 'CORRUPT';
export type ReplayDecision = 'BASE_MATCH' | 'STALE_OR_REPLAY' | 'GAP' | 'BLOCKED';
export interface RecoveryScope { userId: string; projectId: string; documentId: string; }
export interface ServerHeadTriplet { revisionId: string; sequence: number; contentSha256: string; }
export interface RecoveryEntry {
  entryKey: string;
  scopeKey: string;
  scope: RecoveryScope;
  commandId: string;
  commandSha256: string;
  idempotencyKey: string;
  baseRevision: CanonicalCadRevisionRef;
  commandJson: string;
  enqueueOrder: number;
  state: RecoveryState;
  createdAt: string;
  updatedAt: string;
  serverHead: ServerHeadTriplet | null;
  quarantineReason?: string;
}

export interface JournalUnavailable {
  ok: false;
  kind: 'UNAVAILABLE';
  reason: 'NO_INDEXEDDB' | 'NEWER_DATABASE_VERSION' | 'OPEN_FAILED';
}
export interface JournalCorrupt {
  ok: false;
  kind: 'CORRUPT';
  entryKey: string;
  reason: string;
}
export type JournalResult<T> = { ok: true; value: T } | JournalUnavailable | JournalCorrupt;

export class RecoveryJournalError extends Error {
  constructor(readonly code: 'COMMAND_INVALID' | 'SCOPE_MISMATCH' | 'TRANSITION_INVALID' | 'ENTRY_NOT_FOUND' | 'QUOTA' | 'HEAD_INVALID', detail: string) {
    super(`${code}:${detail}`);
    this.name = 'RecoveryJournalError';
  }
}

interface JournalOptions { indexedDB?: IDBFactory; now?: () => string; }

function scopeKey(scope: RecoveryScope): string {
  for (const [name, value] of Object.entries(scope)) if (!SAFE_ID.test(value)) throw new RecoveryJournalError('SCOPE_MISMATCH', `${name}_invalid`);
  return `${scope.userId}|${scope.projectId}|${scope.documentId}`;
}
function entryKey(scope: RecoveryScope, commandId: string): string {
  if (!SAFE_ID.test(commandId)) throw new RecoveryJournalError('COMMAND_INVALID', 'command_id_invalid');
  return `${scopeKey(scope)}|${commandId}`;
}
function containsSensitiveKey(value: unknown, seen = new Set<object>()): boolean {
  if (!value || typeof value !== 'object') return false;
  if (seen.has(value)) return true;
  seen.add(value);
  if (Array.isArray(value)) return value.some(item => containsSensitiveKey(item, seen));
  return Object.entries(value).some(([key, item]) => SENSITIVE_KEY.test(key) || containsSensitiveKey(item, seen));
}
function validateHead(head: ServerHeadTriplet): void {
  if (!head || typeof head !== 'object' || !SAFE_ID.test(head.revisionId) || !Number.isSafeInteger(head.sequence) || head.sequence < 0 || !SHA256.test(head.contentSha256)) {
    throw new RecoveryJournalError('HEAD_INVALID', 'server_head_triplet_invalid');
  }
}
function sameRevision(left: CanonicalCadRevisionRef, right: CanonicalCadRevisionRef): boolean {
  return left.revisionId === right.revisionId && left.sequence === right.sequence && left.contentSha256 === right.contentSha256;
}
function validateStored(entry: unknown): { ok: true; entry: RecoveryEntry } | { ok: false; reason: string } {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return { ok: false, reason: 'entry_not_object' };
  const value = entry as Partial<RecoveryEntry>;
  if (Object.keys(value).some(key => !ENTRY_KEYS.has(key))) return { ok: false, reason: 'entry_keys_invalid' };
  if (typeof value.entryKey !== 'string' || typeof value.scopeKey !== 'string' || !value.scope
    || typeof value.commandJson !== 'string' || typeof value.commandSha256 !== 'string'
    || typeof value.commandId !== 'string' || typeof value.idempotencyKey !== 'string'
    || new TextEncoder().encode(value.commandJson).byteLength > MAX_COMMAND_JSON_BYTES
    || !Number.isSafeInteger(value.enqueueOrder) || Number(value.enqueueOrder) < 1
    || typeof value.createdAt !== 'string' || !RFC3339.test(value.createdAt)
    || typeof value.updatedAt !== 'string' || !RFC3339.test(value.updatedAt)
    || value.serverHead === undefined
    || !['PENDING', 'SENT', 'ACKNOWLEDGED', 'CONFIRMED', 'BLOCKED', 'CORRUPT'].includes(String(value.state))) return { ok: false, reason: 'entry_shape_invalid' };
  let command: unknown;
  try { command = JSON.parse(value.commandJson); } catch { return { ok: false, reason: 'command_json_invalid' }; }
  const issues = validateCanonicalCadCommandV2(command);
  if (issues.length) return { ok: false, reason: issues.join(',') };
  const typed = command as CanonicalCadCommandV2ConsumerDraft;
  if (typed.commandId !== value.commandId || typed.commandSha256 !== value.commandSha256 || typed.idempotencyKey !== value.idempotencyKey) return { ok: false, reason: 'command_identity_mismatch' };
  if (!value.scope || typeof value.scope.userId !== 'string' || typeof value.scope.projectId !== 'string' || typeof value.scope.documentId !== 'string'
    || !SAFE_ID.test(value.scope.userId) || !SAFE_ID.test(value.scope.projectId) || !SAFE_ID.test(value.scope.documentId)
    || value.scopeKey !== `${value.scope.userId}|${value.scope.projectId}|${value.scope.documentId}`
    || value.entryKey !== `${value.scopeKey}|${value.commandId}`
    || typed.projectId !== value.scope.projectId || typed.documentId !== value.scope.documentId
    || (typed.actor.kind === 'human' && typed.actor.actorId !== value.scope.userId)) return { ok: false, reason: 'scope_mismatch' };
  if (hashCanonicalCadCommandV2(typed) !== value.commandSha256) return { ok: false, reason: 'command_hash_mismatch' };
  if (!value.baseRevision || !sameRevision(value.baseRevision, typed.baseRevision)) return { ok: false, reason: 'base_revision_mismatch' };
  if (value.serverHead !== null) {
    try { validateHead(value.serverHead); } catch { return { ok: false, reason: 'server_head_invalid' }; }
  }
  if (value.state === 'CONFIRMED') {
    if (!value.serverHead || value.serverHead.revisionId !== typed.nextRevisionId || value.serverHead.sequence !== typed.baseRevision.sequence + 1) return { ok: false, reason: 'confirmation_invalid' };
  } else if (value.serverHead !== null) return { ok: false, reason: 'unexpected_server_head' };
  if (containsSensitiveKey(typed)) return { ok: false, reason: 'sensitive_command_field' };
  return { ok: true, entry: value as RecoveryEntry };
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error ?? new Error('idb_request_failed')); });
}
function transaction<T>(db: IDBDatabase, mode: IDBTransactionMode, run: (store: IDBObjectStore) => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    let result: T;
    Promise.resolve().then(() => run(tx.objectStore(STORE))).then(value => { result = value; }).catch(error => {
      try { tx.abort(); } catch { /* transaction already completed or aborted */ }
      reject(error);
    });
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error ?? new Error('idb_transaction_failed'));
    tx.onabort = () => reject(tx.error ?? new Error('idb_transaction_aborted'));
  });
}

export class CanonicalCadRecoveryJournal {
  private readonly factory?: IDBFactory;
  private readonly now: () => string;
  constructor(options: JournalOptions = {}) {
    this.factory = Object.prototype.hasOwnProperty.call(options, 'indexedDB')
      ? options.indexedDB
      : (typeof indexedDB === 'undefined' ? undefined : indexedDB);
    this.now = options.now ?? (() => new Date().toISOString());
  }

  private async open(): Promise<{ db: IDBDatabase } | JournalUnavailable> {
    if (!this.factory) return { ok: false, kind: 'UNAVAILABLE', reason: 'NO_INDEXEDDB' };
    try {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = this.factory!.open(CAD_RECOVERY_DB_NAME, CAD_RECOVERY_DB_VERSION);
        req.onupgradeneeded = event => { if (event.oldVersion === 0) req.result.createObjectStore(STORE, { keyPath: 'entryKey' }); };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('idb_open_failed'));
        req.onblocked = () => reject(new Error('idb_open_blocked'));
      });
      db.onversionchange = () => db.close();
      return { db };
    } catch (error) {
      const name = (error as { name?: unknown } | null)?.name;
      return { ok: false, kind: 'UNAVAILABLE', reason: name === 'VersionError' ? 'NEWER_DATABASE_VERSION' : 'OPEN_FAILED' };
    }
  }

  async append(scope: RecoveryScope, command: CanonicalCadCommandV2ConsumerDraft): Promise<JournalResult<RecoveryEntry>> {
    const issues = validateCanonicalCadCommandV2(command);
    if (issues.length) throw new RecoveryJournalError('COMMAND_INVALID', issues.join(','));
    if (command.projectId !== scope.projectId || command.documentId !== scope.documentId) throw new RecoveryJournalError('SCOPE_MISMATCH', 'command_scope_mismatch');
    if (command.actor.kind === 'human' && command.actor.actorId !== scope.userId) throw new RecoveryJournalError('SCOPE_MISMATCH', 'human_actor_scope_mismatch');
    if (containsSensitiveKey(command)) throw new RecoveryJournalError('COMMAND_INVALID', 'credentials_or_artifact_bytes_forbidden');
    const commandJson = canonicalCadConsumerDraftJson(command);
    if (new TextEncoder().encode(commandJson).byteLength > MAX_COMMAND_JSON_BYTES) throw new RecoveryJournalError('COMMAND_INVALID', 'command_json_too_large');
    const opened = await this.open(); if (!('db' in opened)) return opened;
    const db = opened.db;
    const createdAt = this.now();
    try {
      const value = await transaction(db, 'readwrite', async store => {
        const entries = await request<RecoveryEntry[]>(store.getAll());
        const scoped = entries.filter(item => item.scopeKey === scopeKey(scope));
        if (entries.length >= MAX_ENTRIES_TOTAL || scoped.length >= MAX_ENTRIES_PER_SCOPE) throw new RecoveryJournalError('QUOTA', 'journal_entry_limit');
        if (scoped.some(item => item.commandId === command.commandId)) throw new RecoveryJournalError('COMMAND_INVALID', 'duplicate_command_id');
        if (scoped.some(item => item.idempotencyKey === command.idempotencyKey)) throw new RecoveryJournalError('COMMAND_INVALID', 'duplicate_idempotency_key');
        const entry: RecoveryEntry = { entryKey: entryKey(scope, command.commandId), scopeKey: scopeKey(scope), scope: structuredClone(scope), commandId: command.commandId, commandSha256: command.commandSha256, idempotencyKey: command.idempotencyKey, baseRevision: structuredClone(command.baseRevision), commandJson, enqueueOrder: scoped.reduce((max, item) => Math.max(max, item.enqueueOrder), 0) + 1, state: 'PENDING', createdAt, updatedAt: createdAt, serverHead: null };
        await request(store.put(entry));
        return entry;
      });
      return { ok: true, value };
  } catch (error) {
    if (error instanceof RecoveryJournalError) throw error;
      if ((error as { name?: unknown } | null)?.name === 'QuotaExceededError') throw new RecoveryJournalError('QUOTA', 'existing_entries_preserved');
      throw error;
    } finally { db.close(); }
  }

  async get(scope: RecoveryScope, commandId: string): Promise<JournalResult<RecoveryEntry | null>> {
    const opened = await this.open(); if (!('db' in opened)) return opened;
    const db = opened.db; const key = entryKey(scope, commandId);
    try {
      const raw = await transaction(db, 'readonly', store => request<RecoveryEntry | undefined>(store.get(key)));
      if (!raw) return { ok: true, value: null };
      const checked = validateStored(raw);
      if (checked.ok) return { ok: true, value: checked.entry };
      await this.quarantine(db, raw, checked.reason);
      return { ok: false, kind: 'CORRUPT', entryKey: key, reason: checked.reason };
    } finally { db.close(); }
  }

  async list(scope: RecoveryScope): Promise<JournalResult<RecoveryEntry[]>> {
    const opened = await this.open(); if (!('db' in opened)) return opened;
    const db = opened.db; const wanted = scopeKey(scope);
    try {
      const raw = await transaction(db, 'readonly', store => request<RecoveryEntry[]>(store.getAll()));
      const entries: RecoveryEntry[] = [];
      for (const item of raw.filter(value => value.scopeKey === wanted)) {
        const checked = validateStored(item);
        if (!checked.ok) { await this.quarantine(db, item, checked.reason); continue; }
        entries.push(checked.entry);
      }
      return { ok: true, value: entries.sort((a, b) => a.enqueueOrder - b.enqueueOrder) };
    } finally { db.close(); }
  }

  private async quarantine(db: IDBDatabase, raw: RecoveryEntry, reason: string): Promise<void> {
    const quarantined = { ...raw, state: 'CORRUPT' as const, quarantineReason: reason, updatedAt: this.now() };
    await transaction(db, 'readwrite', store => request(store.put(quarantined)));
  }

  private async transition(scope: RecoveryScope, commandId: string, from: RecoveryState | readonly RecoveryState[], to: RecoveryState, serverHead: ServerHeadTriplet | null = null): Promise<JournalResult<RecoveryEntry>> {
    const opened = await this.open(); if (!('db' in opened)) return opened;
    const db = opened.db;
    try {
      return await transaction(db, 'readwrite', async store => {
        const key = entryKey(scope, commandId);
        const raw = await request<RecoveryEntry | undefined>(store.get(key));
        if (!raw) throw new RecoveryJournalError('ENTRY_NOT_FOUND', commandId);
        const checked = validateStored(raw);
        if (!checked.ok) {
          await request(store.put({ ...raw, state: 'CORRUPT', quarantineReason: checked.reason, updatedAt: this.now() }));
          return { ok: false, kind: 'CORRUPT', entryKey: key, reason: checked.reason };
        }
        const allowed = Array.isArray(from) ? from : [from];
        if (!allowed.includes(checked.entry.state)) throw new RecoveryJournalError('TRANSITION_INVALID', `${allowed.join('_or_')}_to_${to}`);
        const next = { ...checked.entry, state: to, serverHead, updatedAt: this.now() };
        await request(store.put(next));
        return { ok: true, value: next };
      });
    } finally { db.close(); }
  }

  markSent(scope: RecoveryScope, commandId: string): Promise<JournalResult<RecoveryEntry>> { return this.transition(scope, commandId, 'PENDING', 'SENT'); }
  markAcknowledged(scope: RecoveryScope, commandId: string): Promise<JournalResult<RecoveryEntry>> { return this.transition(scope, commandId, 'SENT', 'ACKNOWLEDGED'); }
  async markConfirmed(scope: RecoveryScope, commandId: string, head: ServerHeadTriplet): Promise<JournalResult<RecoveryEntry>> {
    validateHead(head);
    const current = await this.get(scope, commandId); if (!current.ok) return current;
    if (!current.value) throw new RecoveryJournalError('ENTRY_NOT_FOUND', commandId);
    const command = JSON.parse(current.value.commandJson) as CanonicalCadCommandV2ConsumerDraft;
    if (current.value.state !== 'ACKNOWLEDGED' || head.revisionId !== command.nextRevisionId || head.sequence !== command.baseRevision.sequence + 1) throw new RecoveryJournalError('TRANSITION_INVALID', 'confirmation_head_mismatch');
    return this.transition(scope, commandId, 'ACKNOWLEDGED', 'CONFIRMED', head);
  }
  markBlocked(scope: RecoveryScope, commandId: string): Promise<JournalResult<RecoveryEntry>> { return this.transition(scope, commandId, ['PENDING', 'SENT'], 'BLOCKED'); }

  async decideReplay(scope: RecoveryScope, commandId: string, head: ServerHeadTriplet | null): Promise<JournalResult<ReplayDecision>> {
    const current = await this.get(scope, commandId); if (!current.ok) return current;
    if (!current.value || ['BLOCKED', 'CORRUPT', 'CONFIRMED'].includes(current.value.state) || !head) return { ok: true, value: 'BLOCKED' };
    validateHead(head);
    const base = current.value.baseRevision;
    if (head.revisionId === base.revisionId && head.sequence === base.sequence && head.contentSha256 === base.contentSha256) return { ok: true, value: 'BASE_MATCH' };
    if (head.sequence > base.sequence) return { ok: true, value: 'STALE_OR_REPLAY' };
    return { ok: true, value: 'GAP' };
  }

  async pruneConfirmed(scope: RecoveryScope, keepLatest = 0): Promise<JournalResult<number>> {
    const listed = await this.list(scope); if (!listed.ok) return listed;
    const removable = listed.value.filter(item => item.state === 'CONFIRMED').sort((a, b) => b.enqueueOrder - a.enqueueOrder).slice(Math.max(0, keepLatest));
    const opened = await this.open(); if (!('db' in opened)) return opened;
    const db = opened.db;
    try { await transaction(db, 'readwrite', async store => { for (const item of removable) await request(store.delete(item.entryKey)); return removable.length; }); return { ok: true, value: removable.length }; }
    finally { db.close(); }
  }
}
