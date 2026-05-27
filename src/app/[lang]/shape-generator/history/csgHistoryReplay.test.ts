import { describe, it, expect } from 'vitest';
import {
  createLog,
  appendOperation,
  replay,
  replayWithSnapshots,
  diffLogs,
  compress,
  summarize,
  type OperationLog,
  type ReplayHandler,
} from './csgHistoryReplay';

function sumHandler(): ReplayHandler<number> {
  return {
    initial: () => 0,
    apply: (model, op) => model + (op.params.value as number ?? 0),
  };
}

function makeLog(values: number[]): OperationLog {
  const log = createLog();
  for (let i = 0; i < values.length; i++) {
    appendOperation(log, { id: `op${i}`, kind: 'union', params: { value: values[i] } });
  }
  return log;
}

describe('createLog + appendOperation', () => {
  it('createLog is empty', () => {
    expect(createLog().operations).toHaveLength(0);
  });

  it('appendOperation adds with timestamp', () => {
    const log = createLog();
    const op = appendOperation(log, { id: 'a', kind: 'union', params: {} });
    expect(op.timestamp).toBeGreaterThan(0);
    expect(log.operations).toHaveLength(1);
  });
});

describe('replay', () => {
  it('applies all ops to compute final model', () => {
    const log = makeLog([1, 2, 3, 4]);
    const r = replay(log, sumHandler());
    expect(r.model).toBe(10);
    expect(r.appliedCount).toBe(4);
  });

  it('stopAtIndex limits replay', () => {
    const log = makeLog([1, 2, 3, 4]);
    const r = replay(log, sumHandler(), { stopAtIndex: 1 });
    expect(r.model).toBe(3); // 1 + 2
  });

  it('skipIds excludes ops', () => {
    const log = makeLog([1, 2, 3, 4]);
    const r = replay(log, sumHandler(), { skipIds: new Set(['op1', 'op2']) });
    expect(r.model).toBe(5); // 1 + 4
  });

  it('errored ops accumulate in failedOps', () => {
    const log = makeLog([1, 2, 3]);
    const r = replay(log, {
      initial: () => 0,
      apply: (m, op) => {
        if (op.id === 'op1') throw new Error('boom');
        return m + (op.params.value as number);
      },
    });
    expect(r.failedOps).toHaveLength(1);
    expect(r.model).toBe(4);
  });

  it('elapsedMs reported', () => {
    const log = makeLog([1, 2, 3]);
    const r = replay(log, sumHandler());
    expect(r.elapsedMs).toBeGreaterThanOrEqual(0);
  });
});

describe('replayWithSnapshots', () => {
  it('captures snapshots at target indices', () => {
    const log = makeLog([1, 2, 3, 4]);
    const { snapshots } = replayWithSnapshots(log, sumHandler(), [0, 2]);
    expect(snapshots).toHaveLength(2);
    expect(snapshots[0]!.state).toBe(1);
    expect(snapshots[1]!.state).toBe(6); // 1 + 2 + 3
  });

  it('snapshots empty when no target indices', () => {
    const log = makeLog([1, 2]);
    const { snapshots } = replayWithSnapshots(log, sumHandler(), []);
    expect(snapshots).toHaveLength(0);
  });
});

describe('diffLogs', () => {
  it('added ops detected', () => {
    const a = makeLog([1, 2]);
    const b = makeLog([1, 2, 3]);
    const d = diffLogs(a, b);
    expect(d.added).toHaveLength(1);
    expect(d.added[0]!.id).toBe('op2');
  });

  it('removed ops detected', () => {
    const a = makeLog([1, 2, 3]);
    const b = makeLog([1, 2]);
    const d = diffLogs(a, b);
    expect(d.removed).toHaveLength(1);
  });

  it('modified ops detected', () => {
    const a = makeLog([1, 2]);
    const b = createLog();
    appendOperation(b, { id: 'op0', kind: 'union', params: { value: 1 } });
    appendOperation(b, { id: 'op1', kind: 'union', params: { value: 999 } });
    const d = diffLogs(a, b);
    expect(d.modified).toHaveLength(1);
    expect(d.modified[0]!.after.params.value).toBe(999);
  });
});

describe('compress', () => {
  it('drops empty boolean ops', () => {
    const log = createLog();
    appendOperation(log, { id: 'a', kind: 'union', params: {} });
    appendOperation(log, { id: 'b', kind: 'union', params: { value: 1 } });
    const c = compress(log);
    expect(c.operations).toHaveLength(1);
    expect(c.operations[0]!.id).toBe('b');
  });
});

describe('summarize', () => {
  it('counts by kind', () => {
    const log = createLog();
    appendOperation(log, { id: 'a', kind: 'union', params: {} });
    appendOperation(log, { id: 'b', kind: 'union', params: {} });
    appendOperation(log, { id: 'c', kind: 'fillet', params: {} });
    const s = summarize(log);
    expect(s.byKind.union).toBe(2);
    expect(s.byKind.fillet).toBe(1);
  });

  it('reports span', () => {
    const log = createLog();
    appendOperation(log, { id: 'a', kind: 'union', params: {} });
    appendOperation(log, { id: 'b', kind: 'union', params: {} });
    const s = summarize(log);
    expect(s.spanMs).toBeGreaterThanOrEqual(0);
  });
});
