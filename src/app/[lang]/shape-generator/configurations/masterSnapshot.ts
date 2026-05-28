/**
 * masterSnapshot.ts — defensive in-session capture of "master" tree values.
 *
 * Background (see docs/wave-2-phase-2-configurations-spec.md §5):
 * `handleConfigurationSelect` writes config values directly into
 * `sceneStore.params` and toggles `node.enabled` on the master feature
 * tree. With no separate master snapshot, **switching from master to a
 * config and saving the .nfab silently corrupts the master tree** —
 * scene.params and node enabled flags become the active config's values.
 * On reload, activeConfigurationId is restored and the config re-applies,
 * so the file looks fine until the user deactivates the config and finds
 * the original master values are gone.
 *
 * Full Phase 2 fix routes the pipeline through ConfigurationTable so the
 * master tree is never mutated (§5 invariant). This module is a
 * **session-only** defensive layer that buys correctness today without
 * locking in any Phase 2 architectural decision:
 *
 *   1. Capture master at the moment the user first activates ANY config
 *      (the transition activeConfigurationId: null → non-null). At that
 *      instant, sceneStore + history are guaranteed to hold the user's
 *      authored master values.
 *   2. Restore master on deactivate (activeConfigurationId → null).
 *   3. At save time, project the history + scene through the snapshot so
 *      the .nfab on disk always records master, not the active overlay.
 *
 * What this does NOT fix:
 *   - Files saved BEFORE this patch shipped with active config != null:
 *     master tree was already polluted on save, no snapshot exists in the
 *     file, recovery is impossible. This is a write-ahead patch — it
 *     prevents future corruption, not past corruption.
 *   - Reloading a file with activeConfigurationId !== null: the snapshot
 *     ref is null until the user manually deactivates, so corruption is
 *     still possible. Mitigation: serialize the snapshot itself into the
 *     .nfab on save (follow-up; format-stable additive field).
 *
 * All helpers are pure — no React, no Zustand. Callers wire them up.
 */

export interface MasterSceneValues {
  params: Record<string, number>;
  paramExpressions: Record<string, string>;
}

export interface MasterSnapshot {
  scene: MasterSceneValues;
  /** featureId → enabled at master time. Excludes the root + baseShape nodes. */
  featureEnabled: Record<string, boolean>;
}

interface HistoryNodeLike {
  id: string;
  type: string;
  enabled: boolean;
}

interface HistoryLike {
  nodes: HistoryNodeLike[];
  rootId: string;
}

/**
 * Capture the current sceneStore + per-feature enabled state as the master
 * snapshot. Callers invoke this at the activeConfigurationId: null →
 * non-null transition AND only when no snapshot already exists (first
 * activation in the session).
 *
 * Excludes the root baseShape from featureEnabled — the root is always
 * present and its enabled flag is not user-controlled.
 */
export function captureMasterSnapshot(
  scene: MasterSceneValues,
  history: HistoryLike,
): MasterSnapshot {
  const featureEnabled: Record<string, boolean> = {};
  for (const n of history.nodes) {
    if (n.id === history.rootId) continue;
    if (n.type === 'baseShape') continue;
    featureEnabled[n.id] = n.enabled;
  }
  return {
    scene: {
      params: { ...scene.params },
      paramExpressions: { ...scene.paramExpressions },
    },
    featureEnabled,
  };
}

/**
 * Yield the (sceneStore mutation, per-node updateNode) operations the
 * caller must run to restore master. Returned as plain data so React
 * setState / Zustand setState / updateNode wiring stays in the caller.
 *
 * The "nodes" array is the current history; nodes present in the
 * snapshot get their snapshotted enabled; nodes added after master-time
 * default to enabled (a feature added after Master Config existed should
 * be visible when master is active).
 */
export interface RestoreOps {
  scene: MasterSceneValues;
  enabledOverrides: { id: string; enabled: boolean }[];
}

export function restoreMasterSnapshotOps(
  snapshot: MasterSnapshot,
  currentHistory: HistoryLike,
): RestoreOps {
  const enabledOverrides: { id: string; enabled: boolean }[] = [];
  for (const n of currentHistory.nodes) {
    if (n.id === currentHistory.rootId) continue;
    if (n.type === 'baseShape') continue;
    if (Object.prototype.hasOwnProperty.call(snapshot.featureEnabled, n.id)) {
      enabledOverrides.push({ id: n.id, enabled: snapshot.featureEnabled[n.id]! });
    } else {
      // Node added after master snapshot — default to enabled.
      enabledOverrides.push({ id: n.id, enabled: true });
    }
  }
  return {
    scene: {
      params: { ...snapshot.scene.params },
      paramExpressions: { ...snapshot.scene.paramExpressions },
    },
    enabledOverrides,
  };
}

/**
 * Produce a history-shaped clone where each node.enabled is forced to its
 * master value. Used by the save path so the serialized .nfab carries
 * master values regardless of which config is active in the UI.
 *
 * Nodes not present in the snapshot (added post-master) keep their
 * current enabled — the assumption being: post-master nodes belong to
 * the "newest master" by default, and the user will edit accordingly.
 * (Stricter "force enabled=true" was rejected because a feature toggled
 * off in a config but added post-master should remain off when the user
 * deletes the config; flipping to enabled=true on every save would be
 * surprising.)
 *
 * The function takes a generic node type so callers don't have to import
 * the full HistoryNode (and so this module stays React-free).
 */
export function projectNodesToMaster<N extends HistoryNodeLike>(
  nodes: N[],
  rootId: string,
  snapshot: MasterSnapshot,
): N[] {
  return nodes.map(n => {
    if (n.id === rootId) return n;
    if (n.type === 'baseShape') return n;
    if (Object.prototype.hasOwnProperty.call(snapshot.featureEnabled, n.id)) {
      return { ...n, enabled: snapshot.featureEnabled[n.id]! };
    }
    return n;
  });
}
