/**
 * transitionStateMachine.ts — Hierarchical state machine with eased
 * transitions for UI / animation.
 *
 * Used by the configurator and viewer UI: "if camera is in 'overview'
 * and user clicks a part, transition to 'inspect' over 0.6s with an
 * ease-in-out cubic curve". State machines remove ad-hoc setTimeout
 * spaghetti.
 *
 * Features:
 *
 *   - **States** with onEnter / onExit / onTick hooks.
 *   - **Transitions** with guard conditions + named event triggers.
 *   - **Eased transition timing** — caller can sample progress and
 *     interpolate state values.
 *   - **Nested states** — group "overview" + "orbit" as children of
 *     "exploring".
 *   - **Event queue** — synchronous events processed in order.
 */

export type EasingKind = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';

export interface StateSpec<TData = unknown> {
  id: string;
  /** Optional parent state for hierarchical machines. */
  parentId?: string;
  /** Called when transitioning INTO this state. */
  onEnter?: (data: TData) => void;
  /** Called when transitioning OUT of this state. */
  onExit?: (data: TData) => void;
  /** Called once per tick while active. */
  onTick?: (data: TData, dtSec: number) => void;
}

export interface TransitionSpec<TData = unknown> {
  from: string;
  to: string;
  /** Event name that triggers this transition. */
  event: string;
  /** Optional guard — return false to skip. */
  guard?: (data: TData) => boolean;
  /** Duration of the transition (sec). */
  durationSec: number;
  /** Easing curve. */
  easing: EasingKind;
}

export interface MachineSpec<TData = unknown> {
  initialState: string;
  states: StateSpec<TData>[];
  transitions: TransitionSpec<TData>[];
}

export interface MachineEvent {
  name: string;
  /** Optional payload, opaque to the machine. */
  payload?: unknown;
}

export interface TransitionState {
  fromState: string;
  toState: string;
  /** Total time (s). */
  duration: number;
  /** Elapsed time (s). */
  elapsed: number;
  /** Eased progress 0..1. */
  progress: number;
  /** Raw progress (no easing). */
  rawProgress: number;
  easing: EasingKind;
}

export class StateMachine<TData = unknown> {
  spec: MachineSpec<TData>;
  data: TData;
  currentState: string;
  private activeTransition: TransitionState | null = null;
  private eventQueue: MachineEvent[] = [];

  constructor(spec: MachineSpec<TData>, data: TData) {
    this.spec = spec;
    this.data = data;
    this.currentState = spec.initialState;
    const start = this.getState(spec.initialState);
    start?.onEnter?.(data);
  }

  getState(id: string): StateSpec<TData> | null {
    return this.spec.states.find(s => s.id === id) ?? null;
  }

  // ── Event handling ──────────────────────────────────────────

  send(event: MachineEvent): void {
    this.eventQueue.push(event);
  }

  /** Process queued events synchronously, applying transitions. */
  private flushEvents(): void {
    while (this.eventQueue.length > 0 && !this.activeTransition) {
      const event = this.eventQueue.shift()!;
      const transition = this.spec.transitions.find(t =>
        t.from === this.currentState &&
        t.event === event.name &&
        (!t.guard || t.guard(this.data)),
      );
      if (!transition) continue;
      this.beginTransition(transition);
    }
  }

  private beginTransition(spec: TransitionSpec<TData>): void {
    this.activeTransition = {
      fromState: spec.from,
      toState: spec.to,
      duration: spec.durationSec,
      elapsed: 0,
      progress: 0,
      rawProgress: 0,
      easing: spec.easing,
    };
    if (spec.durationSec <= 0) {
      this.completeTransition();
    }
  }

  private completeTransition(): void {
    if (!this.activeTransition) return;
    const t = this.activeTransition;
    const oldState = this.getState(this.currentState);
    oldState?.onExit?.(this.data);
    this.currentState = t.toState;
    const newState = this.getState(t.toState);
    newState?.onEnter?.(this.data);
    this.activeTransition = null;
  }

  // ── Tick ────────────────────────────────────────────────────

  tick(dtSec: number): void {
    this.flushEvents();
    if (this.activeTransition) {
      this.activeTransition.elapsed += dtSec;
      const raw = Math.min(1, this.activeTransition.elapsed / Math.max(1e-9, this.activeTransition.duration));
      this.activeTransition.rawProgress = raw;
      this.activeTransition.progress = applyEasing(raw, this.activeTransition.easing);
      if (raw >= 1) {
        this.completeTransition();
      }
    } else {
      const state = this.getState(this.currentState);
      state?.onTick?.(this.data, dtSec);
    }
    this.flushEvents();
  }

  // ── Inspection ──────────────────────────────────────────────

  getActiveTransition(): TransitionState | null {
    return this.activeTransition;
  }

  /** Walks up the parent chain; returns true if `ancestorId` is the
   *  current state or any ancestor. */
  isInState(stateId: string): boolean {
    let s = this.getState(this.currentState);
    while (s) {
      if (s.id === stateId) return true;
      s = s.parentId ? this.getState(s.parentId) : null;
    }
    return false;
  }

  /** State path: ["root", "exploring", "overview"]. */
  statePath(): string[] {
    const path: string[] = [];
    let s = this.getState(this.currentState);
    while (s) {
      path.unshift(s.id);
      s = s.parentId ? this.getState(s.parentId) : null;
    }
    return path;
  }
}

// ── Easing ──────────────────────────────────────────────────────

export function applyEasing(t: number, kind: EasingKind): number {
  const c = Math.max(0, Math.min(1, t));
  switch (kind) {
    case 'linear': return c;
    case 'ease-in': return c * c;
    case 'ease-out': return 1 - (1 - c) * (1 - c);
    case 'ease-in-out': return c < 0.5 ? 2 * c * c : 1 - Math.pow(-2 * c + 2, 2) / 2;
  }
}

// ── Builder helpers ─────────────────────────────────────────────

export class StateMachineBuilder<TData = unknown> {
  private states: StateSpec<TData>[] = [];
  private transitions: TransitionSpec<TData>[] = [];
  private initial: string | null = null;

  state(id: string, options: Partial<Omit<StateSpec<TData>, 'id'>> = {}): this {
    this.states.push({ id, ...options });
    if (this.initial === null) this.initial = id;
    return this;
  }

  initialState(id: string): this {
    this.initial = id;
    return this;
  }

  transition(from: string, event: string, to: string, opts: Partial<Omit<TransitionSpec<TData>, 'from' | 'to' | 'event'>> = {}): this {
    this.transitions.push({
      from, to, event,
      durationSec: opts.durationSec ?? 0,
      easing: opts.easing ?? 'linear',
      ...(opts.guard ? { guard: opts.guard } : {}),
    });
    return this;
  }

  build(): MachineSpec<TData> {
    if (!this.initial) throw new Error('No initial state set');
    return {
      initialState: this.initial,
      states: this.states,
      transitions: this.transitions,
    };
  }
}

// ── Diagnostics ────────────────────────────────────────────────

export interface MachineStats {
  stateCount: number;
  transitionCount: number;
  reachableStates: number;
  unreachableStates: string[];
}

export function analyzeMachine(spec: MachineSpec): MachineStats {
  const reachable = new Set<string>([spec.initialState]);
  const queue = [spec.initialState];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const outgoing = spec.transitions.filter(t => t.from === id);
    for (const t of outgoing) {
      if (!reachable.has(t.to)) {
        reachable.add(t.to);
        queue.push(t.to);
      }
    }
  }
  const unreachable = spec.states.filter(s => !reachable.has(s.id)).map(s => s.id);
  return {
    stateCount: spec.states.length,
    transitionCount: spec.transitions.length,
    reachableStates: reachable.size,
    unreachableStates: unreachable,
  };
}
