import { describe, it, expect } from 'vitest';
import {
  StateMachine,
  StateMachineBuilder,
  applyEasing,
  analyzeMachine,
} from './transitionStateMachine';

describe('StateMachineBuilder', () => {
  it('builds a basic machine', () => {
    const spec = new StateMachineBuilder()
      .state('idle')
      .state('running')
      .transition('idle', 'go', 'running', { durationSec: 1 })
      .build();
    expect(spec.states).toHaveLength(2);
    expect(spec.transitions).toHaveLength(1);
    expect(spec.initialState).toBe('idle');
  });

  it('initialState defaults to first added state', () => {
    const spec = new StateMachineBuilder().state('first').state('second').build();
    expect(spec.initialState).toBe('first');
  });

  it('initialState override honored', () => {
    const spec = new StateMachineBuilder()
      .state('a')
      .state('b')
      .initialState('b')
      .build();
    expect(spec.initialState).toBe('b');
  });

  it('throws when no states added', () => {
    expect(() => new StateMachineBuilder().build()).toThrow();
  });
});

describe('StateMachine — current state', () => {
  it('starts in initialState', () => {
    const spec = new StateMachineBuilder().state('a').state('b').build();
    const m = new StateMachine(spec, {});
    expect(m.currentState).toBe('a');
  });

  it('onEnter called for initial state', () => {
    let entered = false;
    const spec = new StateMachineBuilder()
      .state('a', { onEnter: () => { entered = true; } })
      .build();
    new StateMachine(spec, {});
    expect(entered).toBe(true);
  });
});

describe('StateMachine — transitions', () => {
  it('instant transition (duration 0) flips state on tick', () => {
    const spec = new StateMachineBuilder()
      .state('a')
      .state('b')
      .transition('a', 'go', 'b', { durationSec: 0 })
      .build();
    const m = new StateMachine(spec, {});
    m.send({ name: 'go' });
    m.tick(0);
    expect(m.currentState).toBe('b');
  });

  it('eased transition progresses over time', () => {
    const spec = new StateMachineBuilder()
      .state('a')
      .state('b')
      .transition('a', 'go', 'b', { durationSec: 1, easing: 'linear' })
      .build();
    const m = new StateMachine(spec, {});
    m.send({ name: 'go' });
    m.tick(0.5);
    expect(m.getActiveTransition()?.progress).toBeCloseTo(0.5, 5);
  });

  it('transition completes after duration', () => {
    const spec = new StateMachineBuilder()
      .state('a')
      .state('b')
      .transition('a', 'go', 'b', { durationSec: 1 })
      .build();
    const m = new StateMachine(spec, {});
    m.send({ name: 'go' });
    m.tick(0.5);
    m.tick(0.6);
    expect(m.currentState).toBe('b');
  });

  it('guard blocks transition', () => {
    const data = { canGo: false };
    const spec = new StateMachineBuilder<{ canGo: boolean }>()
      .state('a')
      .state('b')
      .transition('a', 'go', 'b', { durationSec: 0, guard: (d) => d.canGo })
      .build();
    const m = new StateMachine(spec, data);
    m.send({ name: 'go' });
    m.tick(0);
    expect(m.currentState).toBe('a');
    data.canGo = true;
    m.send({ name: 'go' });
    m.tick(0);
    expect(m.currentState).toBe('b');
  });

  it('unmatched event is dropped', () => {
    const spec = new StateMachineBuilder()
      .state('a')
      .state('b')
      .transition('a', 'go', 'b', { durationSec: 0 })
      .build();
    const m = new StateMachine(spec, {});
    m.send({ name: 'unknown' });
    m.tick(0);
    expect(m.currentState).toBe('a');
  });
});

describe('StateMachine — hooks', () => {
  it('onTick called only when not transitioning', () => {
    let ticks = 0;
    const spec = new StateMachineBuilder()
      .state('a', { onTick: () => { ticks++; } })
      .build();
    const m = new StateMachine(spec, {});
    m.tick(0.1);
    expect(ticks).toBe(1);
  });

  it('onExit + onEnter called on state change', () => {
    const seq: string[] = [];
    const spec = new StateMachineBuilder()
      .state('a', { onExit: () => seq.push('exit-a') })
      .state('b', { onEnter: () => seq.push('enter-b') })
      .transition('a', 'go', 'b', { durationSec: 0 })
      .build();
    const m = new StateMachine(spec, {});
    seq.length = 0; // clear initial enter
    m.send({ name: 'go' });
    m.tick(0);
    expect(seq).toEqual(['exit-a', 'enter-b']);
  });
});

describe('StateMachine — hierarchy', () => {
  it('isInState walks parents', () => {
    const spec = new StateMachineBuilder()
      .state('app')
      .state('overview', { parentId: 'app' })
      .build();
    spec.initialState = 'overview';
    const m = new StateMachine(spec, {});
    expect(m.isInState('overview')).toBe(true);
    expect(m.isInState('app')).toBe(true);
    expect(m.isInState('other')).toBe(false);
  });

  it('statePath returns parent chain', () => {
    const spec = new StateMachineBuilder()
      .state('app')
      .state('exploring', { parentId: 'app' })
      .state('orbit', { parentId: 'exploring' })
      .build();
    spec.initialState = 'orbit';
    const m = new StateMachine(spec, {});
    expect(m.statePath()).toEqual(['app', 'exploring', 'orbit']);
  });
});

describe('applyEasing', () => {
  it('linear identity', () => {
    expect(applyEasing(0.3, 'linear')).toBe(0.3);
  });

  it('ease-in below linear', () => {
    expect(applyEasing(0.5, 'ease-in')).toBeLessThan(0.5);
  });

  it('ease-out above linear', () => {
    expect(applyEasing(0.5, 'ease-out')).toBeGreaterThan(0.5);
  });

  it('clamps to [0, 1]', () => {
    expect(applyEasing(2, 'linear')).toBe(1);
    expect(applyEasing(-1, 'linear')).toBe(0);
  });
});

describe('analyzeMachine', () => {
  it('reports reachable + unreachable states', () => {
    const spec = new StateMachineBuilder()
      .state('a')
      .state('b')
      .state('c')
      .transition('a', 'go', 'b', { durationSec: 0 })
      .build();
    const r = analyzeMachine(spec);
    expect(r.reachableStates).toBe(2);
    expect(r.unreachableStates).toContain('c');
  });

  it('all states reachable for connected machine', () => {
    const spec = new StateMachineBuilder()
      .state('a')
      .state('b')
      .transition('a', 'go', 'b', { durationSec: 0 })
      .build();
    expect(analyzeMachine(spec).unreachableStates).toEqual([]);
  });
});
