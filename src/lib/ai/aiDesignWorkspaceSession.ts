/** Pure, durable envelope for the AI Design workspace.
 *
 * This is deliberately smaller than the workflow/view-model contracts. It
 * owns event ordering, replay, audit and recovery; checkpoint/workflow
 * implementations remain the source of truth for their respective domains.
 */
export const AI_DESIGN_WORKSPACE_SESSION_SCHEMA = 'nexyfab.ai-design-workspace-session.v1' as const;
const MAX_AUDIT = 100;
const MAX_EVENT_IDS = 1000;
const MAX_STRING = 512;
const MAX_DEPTH = 8;
const SECRET_KEY = /(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|authorization|credential|cookie)/i;
const BYTES_KEY = /(?:geometry|mesh|brep|step|stl|cad).*(?:bytes|buffer|binary)|(?:bytes|buffer|binary).*(?:geometry|mesh|brep|step|stl|cad)/i;

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type SessionError =
  | 'stale_revision' | 'duplicate_event' | 'invalid_event' | 'irreversible_event'
  | 'invalid_snapshot' | 'oversize' | 'secret_key' | 'geometry_bytes' | 'nothing_to_undo' | 'nothing_to_redo';

export interface SessionBindings {
  checkpointId: string | null;
  checkpointRevision: number | null;
  workflowId: string | null;
  workflowRevision: number | null;
}

export interface WorkspaceSessionState {
  schema: typeof AI_DESIGN_WORKSPACE_SESSION_SCHEMA;
  projectId: string;
  sessionId: string;
  revision: number;
  bindings: SessionBindings;
  data: Record<string, JsonValue>;
  cancellation: { identity: string; resumeStatus: string | null } | null;
  recovery: { identity: string; sourceRevision: number } | null;
  audit: readonly AuditEntry[];
}

export interface SessionEvent {
  eventId: string;
  type: string;
  payload?: unknown;
  timestamp?: string;
  expectedRevision?: number;
  owner?: 'ai' | 'user' | 'precision';
  reversible?: boolean;
  /** Exact Precision CAD commits and receipts are never session-undoable. */
  target?: 'view' | 'session' | 'precision-exact-commit' | 'precision-receipt';
  cancellationIdentity?: string;
  recoveryIdentity?: string;
  bindingUpdate?: Partial<SessionBindings>;
}

export interface AuditEntry {
  eventId: string;
  type: string;
  beforeRevision: number;
  afterRevision: number;
  timestamp: string;
}

export interface WorkspaceSessionSnapshot extends WorkspaceSessionState {
  undo: readonly UndoRecord[];
  redo: readonly UndoRecord[];
  eventIds: readonly string[];
  digest: string;
}

interface UndoRecord { event: SessionEvent; before: Record<string, JsonValue>; after: Record<string, JsonValue>; }
export type SessionResult = { ok: true; session: AiDesignWorkspaceSessionV1; replayed?: boolean } | { ok: false; error: SessionError; session: AiDesignWorkspaceSessionV1 };

function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }
function safeString(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= MAX_STRING; }
function checkValue(value: unknown, depth = 0, key = ''): SessionError | null {
  if (SECRET_KEY.test(key)) return 'secret_key';
  if (BYTES_KEY.test(key)) return 'geometry_bytes';
  if (depth > MAX_DEPTH) return 'oversize';
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return 'geometry_bytes';
  if (typeof value === 'string') return value.length > MAX_STRING ? 'oversize' : null;
  if (typeof value === 'number') return Number.isFinite(value) ? null : 'invalid_event';
  if (value === null || typeof value === 'boolean' || value === undefined) return value === undefined ? 'invalid_event' : null;
  if (Array.isArray(value)) {
    if (value.length > 100) return 'oversize';
    for (const item of value) { const issue = checkValue(item, depth + 1, key); if (issue) return issue; }
    return null;
  }
  if (record(value)) {
    const keys = Object.keys(value);
    if (keys.length > 64) return 'oversize';
    for (const k of keys) { const issue = checkValue(value[k], depth + 1, k); if (issue) return issue; }
    return null;
  }
  return 'invalid_event';
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (record(value)) return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
function digest(value: unknown): string {
  let h = 2166136261;
  for (const c of canonical(value)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return `fnv1a-${(h >>> 0).toString(16).padStart(8, '0')}`;
}
function now(event?: SessionEvent): string { return event?.timestamp ?? new Date().toISOString(); }
function bounded<T>(items: readonly T[], max: number): T[] { return items.length > max ? items.slice(items.length - max) : [...items]; }

export function validateWorkspaceSessionValue(value: unknown): SessionError | null { return checkValue(value); }

export class AiDesignWorkspaceSessionV1 {
  private readonly state: WorkspaceSessionState;
  private readonly undoStack: UndoRecord[];
  private readonly redoStack: UndoRecord[];
  private readonly seen: string[];
  private constructor(state: WorkspaceSessionState, undo: UndoRecord[] = [], redo: UndoRecord[] = [], seen: string[] = []) {
    this.state = clone(state); this.undoStack = clone(undo); this.redoStack = clone(redo); this.seen = [...seen];
  }
  static create(input: { projectId: string; sessionId: string; checkpointId?: string | null; checkpointRevision?: number | null; workflowId?: string | null; workflowRevision?: number | null; revision?: number; data?: Record<string, unknown> }): AiDesignWorkspaceSessionV1 {
    if (!safeString(input.projectId) || !safeString(input.sessionId)) throw new Error('invalid_event');
    const data = (input.data ?? {}) as unknown;
    const issue = checkValue(data); if (issue) throw new Error(issue);
    const revision = input.revision ?? 0;
    if (!Number.isInteger(revision) || revision < 0) throw new Error('invalid_event');
    const checkpointRevision = input.checkpointId ? input.checkpointRevision ?? revision : null;
    const workflowRevision = input.workflowId ? input.workflowRevision ?? revision : null;
    if ((checkpointRevision !== null && (!Number.isSafeInteger(checkpointRevision) || checkpointRevision < 0))
      || (workflowRevision !== null && (!Number.isSafeInteger(workflowRevision) || workflowRevision < 0))) throw new Error('invalid_event');
    return new AiDesignWorkspaceSessionV1({ schema: AI_DESIGN_WORKSPACE_SESSION_SCHEMA, projectId: input.projectId, sessionId: input.sessionId, revision, bindings: { checkpointId: input.checkpointId ?? null, checkpointRevision, workflowId: input.workflowId ?? null, workflowRevision }, data: clone(data) as Record<string, JsonValue>, cancellation: null, recovery: null, audit: [] });
  }
  get snapshotState(): WorkspaceSessionState { return clone(this.state); }
  get stateValue(): WorkspaceSessionState { return clone(this.state); }
  get revision(): number { return this.state.revision; }
  dispatch(event: SessionEvent, expectedRevision = event.expectedRevision): SessionResult { return this.apply(event, expectedRevision); }
  apply(event: SessionEvent, expectedRevision = event.expectedRevision): SessionResult {
    if (!safeString(event.eventId) || !safeString(event.type) || event.eventId.length > 200) return { ok: false, error: 'invalid_event', session: this };
    if (event.timestamp !== undefined && !Number.isFinite(Date.parse(event.timestamp))) return { ok: false, error: 'invalid_event', session: this };
    if (event.owner !== undefined && !['ai', 'user', 'precision'].includes(event.owner)) return { ok: false, error: 'invalid_event', session: this };
    if (event.target !== undefined && !['view', 'session', 'precision-exact-commit', 'precision-receipt'].includes(event.target)) return { ok: false, error: 'invalid_event', session: this };
    if (this.seen.includes(event.eventId)) return { ok: true, replayed: true, session: this };
    if (expectedRevision !== undefined && expectedRevision !== this.revision) return { ok: false, error: 'stale_revision', session: this };
    const issue = event.payload === undefined ? null : checkValue(event.payload); if (issue) return { ok: false, error: issue, session: this };
    if (event.bindingUpdate !== undefined) {
      const bindingIssue = checkValue(event.bindingUpdate);
      if (bindingIssue) return { ok: false, error: bindingIssue, session: this };
      const allowed = ['checkpointId', 'checkpointRevision', 'workflowId', 'workflowRevision'];
      if (Object.keys(event.bindingUpdate).some(key => !allowed.includes(key))) return { ok: false, error: 'invalid_event', session: this };
      const candidate = { ...this.state.bindings, ...event.bindingUpdate };
      if ((candidate.checkpointId !== null && !safeString(candidate.checkpointId)) || (candidate.workflowId !== null && !safeString(candidate.workflowId))
        || (candidate.checkpointRevision !== null && (!Number.isSafeInteger(candidate.checkpointRevision) || candidate.checkpointRevision < 0))
        || (candidate.workflowRevision !== null && (!Number.isSafeInteger(candidate.workflowRevision) || candidate.workflowRevision < 0))
        || (candidate.checkpointId === null) !== (candidate.checkpointRevision === null)
        || (candidate.workflowId === null) !== (candidate.workflowRevision === null)) return { ok: false, error: 'invalid_event', session: this };
    }
    const precisionOwned = event.target === 'precision-exact-commit' || event.target === 'precision-receipt' || event.owner === 'precision' || /precision.*(?:commit|receipt)/i.test(event.type);
    if (precisionOwned && event.reversible === true) return { ok: false, error: 'irreversible_event', session: this };
    const before = clone(this.state.data);
    const payload = event.payload === undefined ? {} : clone(event.payload as JsonValue);
    const internalReplace = (event.type === 'UNDO' && event.eventId.startsWith('undo:')) || (event.type === 'REDO' && event.eventId.startsWith('redo:'));
    if (record(payload) && '__sessionReplaceData' in payload && !internalReplace) return { ok: false, error: 'invalid_event', session: this };
    const replacement = internalReplace && record(payload) && record((payload as Record<string, JsonValue>).__sessionReplaceData)
      ? (payload as Record<string, JsonValue>).__sessionReplaceData as Record<string, JsonValue> : null;
    const data = replacement ? clone(replacement) : record(payload) ? { ...before, ...(payload as Record<string, JsonValue>) } : { ...before, lastEvent: payload };
    const nextRevision = this.revision + 1;
    const entry: AuditEntry = { eventId: event.eventId, type: event.type, beforeRevision: this.revision, afterRevision: nextRevision, timestamp: now(event) };
    const next: WorkspaceSessionState = { ...this.state, revision: nextRevision, bindings: { ...this.state.bindings, ...event.bindingUpdate }, data, audit: bounded([...this.state.audit, entry], MAX_AUDIT), cancellation: event.cancellationIdentity ? { identity: event.cancellationIdentity, resumeStatus: typeof data.resumeStatus === 'string' ? data.resumeStatus : null } : this.state.cancellation, recovery: event.recoveryIdentity ? { identity: event.recoveryIdentity, sourceRevision: this.revision } : this.state.recovery };
    const undoable = !precisionOwned && event.owner === 'ai' && event.reversible === true;
    return { ok: true, session: new AiDesignWorkspaceSessionV1(next, undoable ? [...this.undoStack, { event: clone(event), before, after: clone(data) }] : this.undoStack, [], bounded([...this.seen, event.eventId], MAX_EVENT_IDS)) };
  }
  undo(expectedRevision = this.revision): SessionResult {
    if (expectedRevision !== this.revision) return { ok: false, error: 'stale_revision', session: this };
    const item = this.undoStack[this.undoStack.length - 1]; if (!item) return { ok: false, error: 'nothing_to_undo', session: this };
    const event: SessionEvent = { eventId: `undo:${item.event.eventId}:${this.revision}`, type: 'UNDO', owner: 'ai', reversible: false, payload: { __sessionReplaceData: item.before } };
    const result = this.apply(event, expectedRevision); if (!result.ok) return result;
    return { ok: true, session: new AiDesignWorkspaceSessionV1(result.session.snapshotState, this.undoStack.slice(0, -1), [...this.redoStack, item], bounded([...this.seen, event.eventId], MAX_EVENT_IDS)) };
  }
  redo(expectedRevision = this.revision): SessionResult {
    if (expectedRevision !== this.revision) return { ok: false, error: 'stale_revision', session: this };
    const item = this.redoStack[this.redoStack.length - 1]; if (!item) return { ok: false, error: 'nothing_to_redo', session: this };
    const redoId = `redo:${item.event.eventId}:${this.revision}`;
    const result = this.apply({ ...item.event, eventId: redoId, type: 'REDO', reversible: false, payload: { __sessionReplaceData: item.after } }, expectedRevision); if (!result.ok) return result;
    return { ok: true, session: new AiDesignWorkspaceSessionV1(result.session.snapshotState, [...this.undoStack, item], this.redoStack.slice(0, -1), bounded([...this.seen, redoId], MAX_EVENT_IDS)) };
  }
  exportSnapshot(): WorkspaceSessionSnapshot { const base = { ...this.state, undo: this.undoStack, redo: this.redoStack, eventIds: this.seen }; return { ...clone(base), digest: digest(base) }; }
  snapshot(): WorkspaceSessionSnapshot { return this.exportSnapshot(); }
  static fromSnapshot(snapshot: unknown): AiDesignWorkspaceSessionV1 {
    if (!record(snapshot) || snapshot.schema !== AI_DESIGN_WORKSPACE_SESSION_SCHEMA || typeof snapshot.digest !== 'string') throw new Error('invalid_snapshot');
    const { digest: supplied, ...base } = snapshot; if (digest(base) !== supplied) throw new Error('invalid_snapshot');
    const issue = checkValue(base); if (issue) throw new Error(issue);
    if (!Array.isArray(base.undo) || !Array.isArray(base.redo) || !Array.isArray(base.eventIds)) throw new Error('invalid_snapshot');
    if (!safeString(base.projectId) || !safeString(base.sessionId) || !Number.isSafeInteger(base.revision) || (base.revision as number) < 0) throw new Error('invalid_snapshot');
    if (!record(base.bindings) || !record(base.data) || !Array.isArray(base.audit) || base.audit.length > MAX_AUDIT || base.eventIds.length > MAX_EVENT_IDS) throw new Error('invalid_snapshot');
    if (base.undo.length > MAX_AUDIT || base.redo.length > MAX_AUDIT || base.eventIds.some(id => !safeString(id))) throw new Error('invalid_snapshot');
    const revision = base.revision as number;
    const bindingRevisions = [base.bindings.checkpointRevision, base.bindings.workflowRevision];
    if (bindingRevisions.some(item => item !== null && (!Number.isSafeInteger(item) || Number(item) < 0))) throw new Error('invalid_snapshot');
    if ((base.bindings.checkpointId === null) !== (base.bindings.checkpointRevision === null)
      || (base.bindings.workflowId === null) !== (base.bindings.workflowRevision === null)
      || (base.bindings.checkpointId !== null && !safeString(base.bindings.checkpointId))
      || (base.bindings.workflowId !== null && !safeString(base.bindings.workflowId))) throw new Error('invalid_snapshot');
    for (let index = 0; index < base.audit.length; index++) {
      const entry = base.audit[index];
      if (!record(entry) || !safeString(entry.eventId) || !safeString(entry.type)
        || !Number.isSafeInteger(entry.beforeRevision) || !Number.isSafeInteger(entry.afterRevision)
        || entry.afterRevision !== Number(entry.beforeRevision) + 1 || !safeString(entry.timestamp) || !Number.isFinite(Date.parse(entry.timestamp))) throw new Error('invalid_snapshot');
      if (index > 0 && (base.audit[index - 1] as unknown as AuditEntry).afterRevision !== entry.beforeRevision) throw new Error('invalid_snapshot');
    }
    if (base.audit.length && (base.audit[base.audit.length - 1] as unknown as AuditEntry).afterRevision !== revision) throw new Error('invalid_snapshot');
    return new AiDesignWorkspaceSessionV1(base as unknown as WorkspaceSessionState, base.undo as UndoRecord[], base.redo as UndoRecord[], base.eventIds as string[]);
  }
}

export const createAiDesignWorkspaceSession = AiDesignWorkspaceSessionV1.create;
export function validateAiDesignWorkspaceSessionSnapshot(snapshot: unknown): { valid: true } | { valid: false; error: SessionError } {
  try { AiDesignWorkspaceSessionV1.fromSnapshot(snapshot); return { valid: true }; } catch (error) { return { valid: false, error: (error instanceof Error ? error.message : 'invalid_snapshot') as SessionError }; }
}
