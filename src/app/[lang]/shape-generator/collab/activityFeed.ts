/**
 * activityFeed.ts — Wave 2 Phase 3 W7 Track Z7.
 *
 * Pure helpers for the chronological "who did what" feed. The feed lives
 * alongside Z1's Y.Doc and is replicated via a top-level Y.Array root
 * (see ActivityFeedYjs.ts). Every CRDT mutation a peer makes locally
 * generates one entry; remote peers replicate by consuming the Y.Array
 * via their own subscription rather than each peer logging the remote
 * peer's ops twice. See useActivityFeed.ts for the subscription model.
 *
 * ADR-012 §7 lock:
 *   "Activity feed shows last 50 ops per doc, chronological newest-first,
 *    with peer name + relative time + op kind label. No auto-purge beyond
 *    the 50-window — older history relies on git-style branch + restore."
 *
 * Cap policy: enforced at append time. Both `appendActivityEntry` and
 * `mergeActivityLogs` slice the head 50 entries; the Y.Array layer
 * (ActivityFeedYjs.ts) does the same on commit. No separate sweep
 * required (the 50-cap is small enough that we never let the array grow).
 *
 * Spec ambiguity resolved — clock skew across peers:
 *   Each entry's `timestamp` is the originating peer's `Date.now()` at
 *   append time. When peers' wall clocks differ (typical: a few seconds,
 *   pathological: tens of minutes), the merged log may reorder entries
 *   by a small delta. We accept this — the UI groups by "minutes ago"
 *   which absorbs <60s skew, and the entry ids stay stable so dedup
 *   still works. A server-stamped clock would solve it but introduces a
 *   round-trip dependency we explicitly avoid (Z7 is client-side only).
 */

// ─── Op kind taxonomy ──────────────────────────────────────────────────────

/**
 * Stable string IDs for every op the feed surfaces. Names are
 * `<store>:<verb>` so the UI can color-code per store and the i18n dict
 * can look them up directly.
 *
 * Adding a new op kind:
 *   1. Add the literal here.
 *   2. Add an entry to every locale dict in `ActivityDictionary`
 *      (defaultActivityDictionary keys for fallback).
 *   3. Wire the source store's subscription in `useActivityFeed.ts`.
 */
export type ActivityKind =
  | 'sketch:addSegment'
  | 'sketch:updateSegment'
  | 'sketch:removeSegment'
  | 'sketch:addConstraint'
  | 'sketch:addDimension'
  | 'tree:addNode'
  | 'tree:removeNode'
  | 'tree:reorder'
  | 'tree:updateParams'
  | 'tree:setEnabled'
  | 'tree:setActive'
  | 'refgeom:addNode'
  | 'refgeom:removeNode'
  | 'refgeom:updateNode'
  | 'config:addConfig'
  | 'config:removeConfig'
  | 'config:renameConfig'
  | 'branch:create'
  | 'branch:remove'
  | 'branch:rename'
  | 'branch:switch';

// ─── Entry shape ───────────────────────────────────────────────────────────

/**
 * One entry in the activity log. All entries are serialisable; the
 * Y.Map encoder in `ActivityFeedYjs.ts` maps these fields 1:1.
 */
export interface ActivityEntry {
  /** UUID; primary dedup key when merging local + remote logs. */
  id: string;
  /** Op taxonomy ID; see `ActivityKind`. */
  kind: ActivityKind;
  /** Originator's peer id (stable per session). */
  peerId: string;
  /** Originator's display name. `null` when the awareness layer has not
   *  resolved the peer (transient — UI shows "anonymous"). */
  peerName: string | null;
  /** Originator's color (HSL string). */
  peerColor: string;
  /** Originator-clock ms epoch at append time. See file header for skew. */
  timestamp: number;
  /** Short human-readable description, already localised by the
   *  originator (e.g. "added 'Fillet1' to feature tree"). */
  summary: string;
  /** Optional id of the affected entity — surfaces a `nfab:activity-focus`
   *  CustomEvent on click. */
  entityId?: string;
}

// ─── Constants ─────────────────────────────────────────────────────────────

/** ADR-012 §7 lock — 50 entries per log. */
export const ACTIVITY_LOG_CAP = 50;

// ─── i18n dictionary ──────────────────────────────────────────────────────

/**
 * Per-locale strings for op summaries. `summarizeOpForActivity` looks up
 * the kind and substitutes the entity name / id. Six languages required
 * per project convention; English serves as fallback.
 *
 * Key shape: each value is a template with `{name}` placeholder that
 * the formatter swaps for the entity's name (or id when name is absent).
 */
export type ActivityDictionary = Record<ActivityKind, string>;

export const defaultActivityDictionary: Record<
  'ko' | 'en' | 'ja' | 'cn' | 'es' | 'ar',
  ActivityDictionary
> = {
  en: {
    'sketch:addSegment': "added segment '{name}'",
    'sketch:updateSegment': "updated segment '{name}'",
    'sketch:removeSegment': "removed segment '{name}'",
    'sketch:addConstraint': "added constraint '{name}'",
    'sketch:addDimension': "added dimension '{name}'",
    'tree:addNode': "added '{name}' to feature tree",
    'tree:removeNode': "removed '{name}' from feature tree",
    'tree:reorder': "reordered '{name}'",
    'tree:updateParams': "edited '{name}' parameters",
    'tree:setEnabled': "toggled '{name}'",
    'tree:setActive': "activated '{name}'",
    'refgeom:addNode': "added reference '{name}'",
    'refgeom:removeNode': "removed reference '{name}'",
    'refgeom:updateNode': "updated reference '{name}'",
    'config:addConfig': "added configuration '{name}'",
    'config:removeConfig': "removed configuration '{name}'",
    'config:renameConfig': "renamed configuration to '{name}'",
    'branch:create': "created branch '{name}'",
    'branch:remove': "removed branch '{name}'",
    'branch:rename': "renamed branch to '{name}'",
    'branch:switch': "switched to branch '{name}'",
  },
  ko: {
    'sketch:addSegment': "세그먼트 '{name}' 추가",
    'sketch:updateSegment': "세그먼트 '{name}' 수정",
    'sketch:removeSegment': "세그먼트 '{name}' 삭제",
    'sketch:addConstraint': "구속조건 '{name}' 추가",
    'sketch:addDimension': "치수 '{name}' 추가",
    'tree:addNode': "피처 트리에 '{name}' 추가",
    'tree:removeNode': "피처 트리에서 '{name}' 삭제",
    'tree:reorder': "'{name}' 순서 변경",
    'tree:updateParams': "'{name}' 매개변수 편집",
    'tree:setEnabled': "'{name}' 활성/비활성 전환",
    'tree:setActive': "'{name}' 활성화",
    'refgeom:addNode': "기준 '{name}' 추가",
    'refgeom:removeNode': "기준 '{name}' 삭제",
    'refgeom:updateNode': "기준 '{name}' 수정",
    'config:addConfig': "구성 '{name}' 추가",
    'config:removeConfig': "구성 '{name}' 삭제",
    'config:renameConfig': "구성 이름을 '{name}' (으)로 변경",
    'branch:create': "브랜치 '{name}' 생성",
    'branch:remove': "브랜치 '{name}' 삭제",
    'branch:rename': "브랜치 이름을 '{name}' (으)로 변경",
    'branch:switch': "브랜치 '{name}' (으)로 전환",
  },
  ja: {
    'sketch:addSegment': "セグメント '{name}' を追加",
    'sketch:updateSegment': "セグメント '{name}' を更新",
    'sketch:removeSegment': "セグメント '{name}' を削除",
    'sketch:addConstraint': "拘束 '{name}' を追加",
    'sketch:addDimension': "寸法 '{name}' を追加",
    'tree:addNode': "フィーチャーツリーに '{name}' を追加",
    'tree:removeNode': "フィーチャーツリーから '{name}' を削除",
    'tree:reorder': "'{name}' を並べ替え",
    'tree:updateParams': "'{name}' のパラメータを編集",
    'tree:setEnabled': "'{name}' の有効/無効を切替",
    'tree:setActive': "'{name}' をアクティブに",
    'refgeom:addNode': "参照 '{name}' を追加",
    'refgeom:removeNode': "参照 '{name}' を削除",
    'refgeom:updateNode': "参照 '{name}' を更新",
    'config:addConfig': "コンフィグ '{name}' を追加",
    'config:removeConfig': "コンフィグ '{name}' を削除",
    'config:renameConfig': "コンフィグを '{name}' に名前変更",
    'branch:create': "ブランチ '{name}' を作成",
    'branch:remove': "ブランチ '{name}' を削除",
    'branch:rename': "ブランチを '{name}' に名前変更",
    'branch:switch': "ブランチ '{name}' に切替",
  },
  cn: {
    'sketch:addSegment': "添加线段 '{name}'",
    'sketch:updateSegment': "更新线段 '{name}'",
    'sketch:removeSegment': "删除线段 '{name}'",
    'sketch:addConstraint': "添加约束 '{name}'",
    'sketch:addDimension': "添加尺寸 '{name}'",
    'tree:addNode': "向特征树添加 '{name}'",
    'tree:removeNode': "从特征树删除 '{name}'",
    'tree:reorder': "重新排序 '{name}'",
    'tree:updateParams': "编辑 '{name}' 参数",
    'tree:setEnabled': "切换 '{name}'",
    'tree:setActive': "激活 '{name}'",
    'refgeom:addNode': "添加参考 '{name}'",
    'refgeom:removeNode': "删除参考 '{name}'",
    'refgeom:updateNode': "更新参考 '{name}'",
    'config:addConfig': "添加配置 '{name}'",
    'config:removeConfig': "删除配置 '{name}'",
    'config:renameConfig': "重命名配置为 '{name}'",
    'branch:create': "创建分支 '{name}'",
    'branch:remove': "删除分支 '{name}'",
    'branch:rename': "重命名分支为 '{name}'",
    'branch:switch': "切换到分支 '{name}'",
  },
  es: {
    'sketch:addSegment': "se agregó el segmento '{name}'",
    'sketch:updateSegment': "se actualizó el segmento '{name}'",
    'sketch:removeSegment': "se eliminó el segmento '{name}'",
    'sketch:addConstraint': "se agregó la restricción '{name}'",
    'sketch:addDimension': "se agregó la dimensión '{name}'",
    'tree:addNode': "se agregó '{name}' al árbol",
    'tree:removeNode': "se eliminó '{name}' del árbol",
    'tree:reorder': "se reordenó '{name}'",
    'tree:updateParams': "se editaron parámetros de '{name}'",
    'tree:setEnabled': "se cambió '{name}'",
    'tree:setActive': "se activó '{name}'",
    'refgeom:addNode': "se agregó la referencia '{name}'",
    'refgeom:removeNode': "se eliminó la referencia '{name}'",
    'refgeom:updateNode': "se actualizó la referencia '{name}'",
    'config:addConfig': "se agregó la configuración '{name}'",
    'config:removeConfig': "se eliminó la configuración '{name}'",
    'config:renameConfig': "se renombró la configuración a '{name}'",
    'branch:create': "se creó la rama '{name}'",
    'branch:remove': "se eliminó la rama '{name}'",
    'branch:rename': "se renombró la rama a '{name}'",
    'branch:switch': "se cambió a la rama '{name}'",
  },
  ar: {
    'sketch:addSegment': "تمت إضافة المقطع '{name}'",
    'sketch:updateSegment': "تم تحديث المقطع '{name}'",
    'sketch:removeSegment': "تمت إزالة المقطع '{name}'",
    'sketch:addConstraint': "تمت إضافة القيد '{name}'",
    'sketch:addDimension': "تمت إضافة البعد '{name}'",
    'tree:addNode': "تمت إضافة '{name}' إلى الشجرة",
    'tree:removeNode': "تمت إزالة '{name}' من الشجرة",
    'tree:reorder': "تم إعادة ترتيب '{name}'",
    'tree:updateParams': "تم تعديل معلمات '{name}'",
    'tree:setEnabled': "تم تبديل '{name}'",
    'tree:setActive': "تم تنشيط '{name}'",
    'refgeom:addNode': "تمت إضافة المرجع '{name}'",
    'refgeom:removeNode': "تمت إزالة المرجع '{name}'",
    'refgeom:updateNode': "تم تحديث المرجع '{name}'",
    'config:addConfig': "تمت إضافة التكوين '{name}'",
    'config:removeConfig': "تمت إزالة التكوين '{name}'",
    'config:renameConfig': "تمت إعادة تسمية التكوين إلى '{name}'",
    'branch:create': "تم إنشاء الفرع '{name}'",
    'branch:remove': "تمت إزالة الفرع '{name}'",
    'branch:rename': "تمت إعادة تسمية الفرع إلى '{name}'",
    'branch:switch': "تم التبديل إلى الفرع '{name}'",
  },
};

// ─── Summarizer ────────────────────────────────────────────────────────────

/**
 * Build the human-readable summary for an op. Pure — same kind + payload
 * + dict always yields the same string. The payload is loosely typed
 * because each op kind has its own shape; the formatter is defensive and
 * falls back to the entity id (or `'…'`) when the expected `name` is absent.
 *
 * Tests assert i18n round-trip and unknown-kind fallback.
 */
export function summarizeOpForActivity(
  kind: ActivityKind,
  payload: unknown,
  dict: ActivityDictionary,
): string {
  const template = dict[kind];
  if (!template) {
    // Unknown kind — emit a minimally informative string so the feed is
    // never empty. (Could happen if the host bumps activityFeed.ts ahead
    // of the dict updates.)
    return `op: ${kind}`;
  }
  const name = extractEntityName(payload);
  return template.replace('{name}', name);
}

/** Best-effort extraction of an entity's display name from a payload.
 *  Looks for `name`, then `label`, then `id`. Falls back to `…`. */
function extractEntityName(payload: unknown): string {
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    if (typeof obj.name === 'string' && obj.name) return obj.name;
    if (typeof obj.label === 'string' && obj.label) return obj.label;
    if (typeof obj.id === 'string' && obj.id) return obj.id;
    if (typeof obj.entityId === 'string' && obj.entityId) return obj.entityId;
  }
  return '…';
}

// ─── Append / merge helpers (pure) ─────────────────────────────────────────

/**
 * Generate a UUID-ish id for a new entry. Uses crypto.randomUUID when
 * available, else falls back to a deterministic-enough timestamp+random.
 * Exported for tests that inject deterministic ids.
 */
export function newEntryId(): string {
  if (
    typeof globalThis !== 'undefined' &&
    typeof (globalThis as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID ===
      'function'
  ) {
    return (globalThis as { crypto: { randomUUID: () => string } }).crypto.randomUUID();
  }
  // Fallback — best effort uniqueness without crypto.
  const rand = Math.random().toString(36).slice(2, 10);
  return `act-${Date.now().toString(36)}-${rand}`;
}

/**
 * Append one entry to a local log and trim to the 50-cap.
 *
 * The input log is treated as **newest-first** — new entries land at
 * position 0. This matches the wire format on the Y.Array root.
 *
 * Returns a new array (input is not mutated).
 */
export function appendActivityEntry(
  log: readonly ActivityEntry[],
  entry: Omit<ActivityEntry, 'id'> & { id?: string },
): ActivityEntry[] {
  const id = entry.id ?? newEntryId();
  const full: ActivityEntry = {
    id,
    kind: entry.kind,
    peerId: entry.peerId,
    peerName: entry.peerName,
    peerColor: entry.peerColor,
    timestamp: entry.timestamp,
    summary: entry.summary,
    ...(entry.entityId !== undefined ? { entityId: entry.entityId } : {}),
  };
  const next = [full, ...log];
  if (next.length > ACTIVITY_LOG_CAP) next.length = ACTIVITY_LOG_CAP;
  return next;
}

/**
 * Merge two activity logs into a single newest-first log:
 *   - Deduplicate by `id` (local wins on collision — local is the source
 *     of truth for entries the same peer authored).
 *   - Sort by `timestamp` descending.
 *   - Cap at 50.
 *
 * Used at sync-on-reconnect time when the local log and the remote Y.Array
 * have diverged.
 */
export function mergeActivityLogs(
  localLog: readonly ActivityEntry[],
  remoteEntries: readonly ActivityEntry[],
): ActivityEntry[] {
  const byId = new Map<string, ActivityEntry>();
  // Insert remote first so local entries with the same id overwrite.
  for (const r of remoteEntries) byId.set(r.id, r);
  for (const l of localLog) byId.set(l.id, l);
  const merged = Array.from(byId.values());
  merged.sort((a, b) => b.timestamp - a.timestamp);
  if (merged.length > ACTIVITY_LOG_CAP) merged.length = ACTIVITY_LOG_CAP;
  return merged;
}

// ─── Relative-time formatter (UI helper) ───────────────────────────────────

/**
 * Format `ms` as "Xs ago" / "Xm ago" / "Xh ago" / "Xd ago".
 * Pure — `nowMs` injected so tests don't rely on a real clock.
 * Six locales share the same grammar bones; the suffix differs.
 */
export type RelativeTimeLang = 'ko' | 'en' | 'ja' | 'cn' | 'es' | 'ar';

const RELATIVE_LABELS: Record<
  RelativeTimeLang,
  { now: string; sec: string; min: string; hr: string; day: string }
> = {
  en: { now: 'just now', sec: 's ago', min: 'm ago', hr: 'h ago', day: 'd ago' },
  ko: { now: '방금', sec: '초 전', min: '분 전', hr: '시간 전', day: '일 전' },
  ja: { now: 'たった今', sec: '秒前', min: '分前', hr: '時間前', day: '日前' },
  cn: { now: '刚刚', sec: '秒前', min: '分钟前', hr: '小时前', day: '天前' },
  es: { now: 'ahora', sec: 's atrás', min: 'min atrás', hr: 'h atrás', day: 'd atrás' },
  ar: { now: 'الآن', sec: ' ث', min: ' د', hr: ' س', day: ' ي' },
};

export function formatRelativeTime(
  ms: number,
  nowMs: number,
  lang: RelativeTimeLang = 'en',
): string {
  const labels = RELATIVE_LABELS[lang] ?? RELATIVE_LABELS.en;
  const diff = Math.max(0, nowMs - ms);
  if (diff < 5_000) return labels.now;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}${labels.sec}`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}${labels.min}`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}${labels.hr}`;
  return `${Math.floor(diff / 86_400_000)}${labels.day}`;
}
