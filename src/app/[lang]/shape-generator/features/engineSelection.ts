/**
 * engineSelection — the single kernel-of-record policy (commercial-parity F1).
 *
 * Background: ~18 features each open-coded the same engine decision —
 *   `(engine === 1 || isOcctGlobalMode()) && isOcctReady()`
 * — so "when do we run OCCT B-rep vs the mesh approximator?" had no single home.
 * This module is that home. The kernel of record is **replicad (in-process
 * OCCT)** routed through `occtEngine`; the mesh path (three-bvh-csg) is the
 * explicit fast-preview / WASM-unavailable fallback.
 *
 * Two questions, deliberately separate:
 *   - wantsOcctEngine(engine): does the user INTENT select B-rep? (per-feature
 *     `engine` enum = 1, or the global OCCT toggle). Features pass this to their
 *     mesh fallback as the "this was supposed to be B-rep" guard flag, so a
 *     silent mesh downgrade can be detected (see roundingGuard).
 *   - shouldUseOcctEngine(engine): should this .apply() ACTUALLY run OCCT right now?
 *     = wanted AND the kernel is loaded AND we are not mid-interaction.
 *
 * Perf guard (the enabler for a future default-ON): during a slider DRAG we keep
 * the fast mesh preview even when B-rep is wanted, and upgrade to the exact
 * kernel on COMMIT. The phase defaults to 'commit', so until the UI opts in by
 * calling setInteractionPhase('drag'), behaviour is identical to the old
 * open-coded checks — this is a behaviour-preserving centralisation.
 */
import { isOcctGlobalMode, isOcctReady } from './occtEngine';

export type InteractionPhase = 'commit' | 'drag';

let interactionPhase: InteractionPhase = 'commit';

/** UI hook: set 'drag' while a slider is being dragged, 'commit' on release. */
export function setInteractionPhase(phase: InteractionPhase): void {
  interactionPhase = phase;
}

export function getInteractionPhase(): InteractionPhase {
  return interactionPhase;
}

/**
 * Does the user intent select the OCCT B-rep engine for this feature?
 * `engine === 1` is the per-feature explicit choice; the global toggle forces it
 * for every OCCT-capable feature. Does NOT consider kernel availability or the
 * perf guard — this is pure intent (used as the mesh-fallback downgrade guard).
 */
export function wantsOcctEngine(engine?: number): boolean {
  return engine === 1 || isOcctGlobalMode();
}

/**
 * Should this feature actually run its OCCT path on THIS apply()? True only when
 * the engine is wanted, the kernel is loaded, and we are not mid-drag (the perf
 * guard keeps drags on the fast mesh preview). When false, the feature runs its
 * mesh path — passing wantsOcctEngine() as its downgrade guard.
 */
export function shouldUseOcctEngine(engine?: number): boolean {
  if (!wantsOcctEngine(engine)) return false;
  if (!isOcctReady()) return false;
  if (interactionPhase === 'drag') return false; // perf guard: mesh preview during drag
  return true;
}
