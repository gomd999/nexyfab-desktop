/**
 * activityFeed.test.ts — Wave 2 Phase 3 W7 Track Z7.
 *
 * Coverage for pure helpers:
 *   - newEntryId returns distinct ids
 *   - appendActivityEntry inserts at head + caps at 50
 *   - appendActivityEntry preserves entityId when provided
 *   - mergeActivityLogs dedups by id (local wins) + sorts by timestamp + caps
 *   - summarizeOpForActivity uses the dict template
 *   - summarizeOpForActivity falls back to id then '…' when name absent
 *   - summarizeOpForActivity falls back for unknown kind
 *   - i18n: 6 locale dicts cover every ActivityKind
 *   - formatRelativeTime buckets at <5s / <60s / <60m / <24h / >=24h
 *   - formatRelativeTime is i18n-aware
 *   - ACTIVITY_LOG_CAP constant equals 50
 */

import { describe, it, expect } from 'vitest';
import {
  ACTIVITY_LOG_CAP,
  appendActivityEntry,
  defaultActivityDictionary,
  formatRelativeTime,
  mergeActivityLogs,
  newEntryId,
  summarizeOpForActivity,
  type ActivityEntry,
  type ActivityKind,
} from '../activityFeed';

const sampleEntry = (
  overrides: Partial<Omit<ActivityEntry, 'id'>> & { id?: string } = {},
): ActivityEntry => ({
  id: overrides.id ?? newEntryId(),
  kind: overrides.kind ?? 'tree:addNode',
  peerId: overrides.peerId ?? 'peer-a',
  peerName: overrides.peerName ?? 'Alice',
  peerColor: overrides.peerColor ?? 'hsl(0,65%,58%)',
  timestamp: overrides.timestamp ?? Date.now(),
  summary: overrides.summary ?? 'did something',
  ...(overrides.entityId !== undefined ? { entityId: overrides.entityId } : {}),
});

describe('newEntryId', () => {
  it('returns distinct strings across calls', () => {
    const a = newEntryId();
    const b = newEntryId();
    expect(typeof a).toBe('string');
    expect(a.length).toBeGreaterThan(0);
    expect(a).not.toBe(b);
  });

  it('returns crypto-style uuid when available', () => {
    const id = newEntryId();
    // crypto.randomUUID format or fallback "act-…" format
    expect(
      /^[0-9a-f-]{36}$/i.test(id) || id.startsWith('act-'),
    ).toBe(true);
  });
});

describe('appendActivityEntry', () => {
  it('inserts new entry at head (newest first)', () => {
    const e1 = sampleEntry({ summary: 'first', timestamp: 1000 });
    const log = appendActivityEntry([], e1);
    expect(log).toHaveLength(1);
    const e2Body = { ...sampleEntry({ summary: 'second', timestamp: 2000 }) };
    const log2 = appendActivityEntry(log, e2Body);
    expect(log2[0]?.summary).toBe('second');
    expect(log2[1]?.summary).toBe('first');
  });

  it('caps at 50 entries', () => {
    let log: ActivityEntry[] = [];
    for (let i = 0; i < 60; i++) {
      log = appendActivityEntry(log, sampleEntry({ summary: `op-${i}`, timestamp: i }));
    }
    expect(log.length).toBe(ACTIVITY_LOG_CAP);
    expect(ACTIVITY_LOG_CAP).toBe(50);
  });

  it('preserves entityId when present', () => {
    const log = appendActivityEntry([], sampleEntry({ entityId: 'seg-7' }));
    expect(log[0]?.entityId).toBe('seg-7');
  });

  it('does not mutate input log', () => {
    const original: ActivityEntry[] = [];
    Object.freeze(original);
    expect(() => appendActivityEntry(original, sampleEntry())).not.toThrow();
  });

  it('uses provided id when supplied', () => {
    const log = appendActivityEntry([], sampleEntry({ id: 'fixed-id-1' }));
    expect(log[0]?.id).toBe('fixed-id-1');
  });

  it('auto-generates id when omitted from input', () => {
    const log = appendActivityEntry([], {
      kind: 'tree:addNode',
      peerId: 'p',
      peerName: 'N',
      peerColor: 'hsl(0,0%,0%)',
      timestamp: 0,
      summary: 's',
    });
    expect(log[0]?.id).toBeTruthy();
  });
});

describe('mergeActivityLogs', () => {
  it('dedups by id; local entry wins on conflict', () => {
    const local: ActivityEntry[] = [sampleEntry({ id: 'A', summary: 'local-A', timestamp: 100 })];
    const remote: ActivityEntry[] = [sampleEntry({ id: 'A', summary: 'remote-A', timestamp: 100 })];
    const merged = mergeActivityLogs(local, remote);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.summary).toBe('local-A');
  });

  it('sorts by timestamp descending', () => {
    const merged = mergeActivityLogs(
      [sampleEntry({ id: 'A', timestamp: 100 })],
      [sampleEntry({ id: 'B', timestamp: 200 }), sampleEntry({ id: 'C', timestamp: 50 })],
    );
    expect(merged.map((e) => e.id)).toEqual(['B', 'A', 'C']);
  });

  it('caps merged at 50', () => {
    const local = Array.from({ length: 30 }, (_, i) =>
      sampleEntry({ id: `L${i}`, timestamp: i }),
    );
    const remote = Array.from({ length: 40 }, (_, i) =>
      sampleEntry({ id: `R${i}`, timestamp: 1000 + i }),
    );
    const merged = mergeActivityLogs(local, remote);
    expect(merged.length).toBe(50);
    // Top entry should be the latest remote (R39, ts 1039).
    expect(merged[0]?.id).toBe('R39');
  });

  it('returns empty when both inputs empty', () => {
    expect(mergeActivityLogs([], [])).toEqual([]);
  });

  it('handles purely local inputs', () => {
    const local = [sampleEntry({ id: 'L1' })];
    const merged = mergeActivityLogs(local, []);
    expect(merged).toEqual(local);
  });

  it('handles purely remote inputs', () => {
    const remote = [sampleEntry({ id: 'R1' })];
    const merged = mergeActivityLogs([], remote);
    expect(merged).toEqual(remote);
  });
});

describe('summarizeOpForActivity', () => {
  const dict = defaultActivityDictionary.en;

  it('substitutes the name in the template', () => {
    expect(summarizeOpForActivity('tree:addNode', { name: 'Fillet1' }, dict)).toContain('Fillet1');
  });

  it('falls back to label when no name', () => {
    expect(summarizeOpForActivity('tree:addNode', { label: 'Plane1' }, dict)).toContain('Plane1');
  });

  it('falls back to id when no name/label', () => {
    expect(summarizeOpForActivity('tree:addNode', { id: 'node-7' }, dict)).toContain('node-7');
  });

  it("falls back to '…' when no identifying field", () => {
    expect(summarizeOpForActivity('tree:addNode', {}, dict)).toContain('…');
  });

  it('returns "op: <kind>" for unknown kind', () => {
    // @ts-expect-error testing fallback path
    const s = summarizeOpForActivity('unknown:op', null, dict);
    expect(s).toMatch(/op: unknown:op/);
  });

  it('renders Korean templates when ko dict is supplied', () => {
    const ko = defaultActivityDictionary.ko;
    expect(summarizeOpForActivity('branch:create', { name: 'main' }, ko)).toContain('브랜치');
  });
});

describe('defaultActivityDictionary', () => {
  it('covers every ActivityKind in every locale', () => {
    const allKinds: ActivityKind[] = [
      'sketch:addSegment',
      'sketch:updateSegment',
      'sketch:removeSegment',
      'sketch:addConstraint',
      'sketch:addDimension',
      'tree:addNode',
      'tree:removeNode',
      'tree:reorder',
      'tree:updateParams',
      'tree:setEnabled',
      'tree:setActive',
      'refgeom:addNode',
      'refgeom:removeNode',
      'refgeom:updateNode',
      'config:addConfig',
      'config:removeConfig',
      'config:renameConfig',
      'branch:create',
      'branch:remove',
      'branch:rename',
      'branch:switch',
    ];
    for (const locale of ['ko', 'en', 'ja', 'cn', 'es', 'ar'] as const) {
      const dict = defaultActivityDictionary[locale];
      for (const k of allKinds) {
        expect(dict[k], `${locale} missing ${k}`).toBeTruthy();
      }
    }
  });
});

describe('formatRelativeTime', () => {
  it('returns "just now" within 5 seconds', () => {
    expect(formatRelativeTime(1000, 4000, 'en')).toBe('just now');
  });

  it('returns Xs ago for 5-60 seconds', () => {
    expect(formatRelativeTime(1000, 31000, 'en')).toBe('30s ago');
  });

  it('returns Xm ago for minutes', () => {
    expect(formatRelativeTime(0, 2 * 60_000, 'en')).toBe('2m ago');
  });

  it('returns Xh ago for hours', () => {
    expect(formatRelativeTime(0, 3 * 3_600_000, 'en')).toBe('3h ago');
  });

  it('returns Xd ago for days', () => {
    expect(formatRelativeTime(0, 5 * 86_400_000, 'en')).toBe('5d ago');
  });

  it('uses Korean suffix for ko', () => {
    expect(formatRelativeTime(0, 30_000, 'ko')).toMatch(/초 전/);
  });

  it('uses Japanese suffix for ja', () => {
    expect(formatRelativeTime(0, 2 * 60_000, 'ja')).toMatch(/分前/);
  });

  it('clamps negative diffs (future timestamp) to "just now"', () => {
    expect(formatRelativeTime(10000, 5000, 'en')).toBe('just now');
  });
});
