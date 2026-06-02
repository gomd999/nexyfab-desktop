/** @vitest-environment jsdom */
/**
 * CursorOverlay — rendering tests.
 *
 * Covers:
 *   - empty awareness → no peer markers (overlay container still present)
 *   - 2 peers with cursors → 2 markers with correct testids
 *   - userId → colour mapping is deterministic across renders
 *   - userColors override takes precedence over the hash
 *   - peer without cursor field is silently skipped
 *   - peer with NaN/non-finite cursor coords is skipped
 *   - peer with non-numeric coords is skipped
 *   - SVG transform positions the marker at the awareness x/y
 *   - name field renders a label group (testable via tag presence)
 *   - peers render in deterministic sorted order
 *   - colour palette stays within the 8-stop curated list
 */

import React, { useRef } from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { CursorOverlay, colorForUserId, CURSOR_PALETTE } from '@/app/[lang]/shape-generator/_shared/CursorOverlay';

afterEach(() => cleanup());

interface HostProps {
  remoteStates: Record<string, Record<string, unknown>>;
  userColors?: Record<string, string>;
}

function Host({ remoteStates, userColors }: HostProps): React.ReactElement {
  const ref = useRef<HTMLDivElement | null>(null);
  return (
    <div
      ref={ref}
      data-testid="viewport"
      style={{ position: 'relative', width: 400, height: 300 }}
    >
      <CursorOverlay
        awareness={{ remoteStates }}
        viewportRef={ref}
        userColors={userColors}
      />
    </div>
  );
}

// ─── empty state ──────────────────────────────────────────────────────────

describe('CursorOverlay — empty', () => {
  it('renders the overlay container but no peer markers when remoteStates is empty', () => {
    render(<Host remoteStates={{}} />);
    expect(screen.getByTestId('cursor-overlay')).toBeInTheDocument();
    expect(screen.queryAllByTestId(/^cursor-overlay-/)).toHaveLength(0);
  });

  it('peer without a cursor field is silently skipped', () => {
    render(
      <Host
        remoteStates={{
          alice: { selection: ['nodeA'] /* no cursor */ },
        }}
      />,
    );
    expect(screen.queryByTestId('cursor-overlay-alice')).toBeNull();
  });
});

// ─── happy path: render peers ─────────────────────────────────────────────

describe('CursorOverlay — peer rendering', () => {
  it('renders one marker per peer with a valid cursor', () => {
    render(
      <Host
        remoteStates={{
          alice: { cursor: { x: 10, y: 20 } },
          bob: { cursor: { x: 50, y: 60 } },
        }}
      />,
    );
    expect(screen.getByTestId('cursor-overlay-alice')).toBeInTheDocument();
    expect(screen.getByTestId('cursor-overlay-bob')).toBeInTheDocument();
  });

  it('SVG transform encodes the cursor x/y from awareness', () => {
    render(
      <Host
        remoteStates={{
          alice: { cursor: { x: 123, y: 45 } },
        }}
      />,
    );
    const g = screen.getByTestId('cursor-overlay-alice');
    expect(g.getAttribute('transform')).toBe('translate(123,45)');
  });

  it('renders peers in deterministic sorted order by userId', () => {
    render(
      <Host
        remoteStates={{
          zoe: { cursor: { x: 1, y: 1 } },
          alice: { cursor: { x: 2, y: 2 } },
          marvin: { cursor: { x: 3, y: 3 } },
        }}
      />,
    );
    const ids = screen
      .getAllByTestId(/^cursor-overlay-(?!$)/)
      .map((el) => el.getAttribute('data-user-id'));
    expect(ids).toEqual(['alice', 'marvin', 'zoe']);
  });
});

// ─── coordinate hygiene ──────────────────────────────────────────────────

describe('CursorOverlay — coord hygiene', () => {
  it('drops peers with NaN coordinates', () => {
    render(
      <Host
        remoteStates={{
          alice: { cursor: { x: Number.NaN, y: 10 } },
        }}
      />,
    );
    expect(screen.queryByTestId('cursor-overlay-alice')).toBeNull();
  });

  it('drops peers with non-numeric coordinates', () => {
    render(
      <Host
        remoteStates={{
          alice: { cursor: { x: '10' as unknown as number, y: 10 } },
        }}
      />,
    );
    expect(screen.queryByTestId('cursor-overlay-alice')).toBeNull();
  });

  it('drops peers with infinite coordinates', () => {
    render(
      <Host
        remoteStates={{
          alice: { cursor: { x: Number.POSITIVE_INFINITY, y: 0 } },
        }}
      />,
    );
    expect(screen.queryByTestId('cursor-overlay-alice')).toBeNull();
  });
});

// ─── colour mapping ──────────────────────────────────────────────────────

describe('CursorOverlay — colour', () => {
  it('colorForUserId is deterministic — same input, same colour', () => {
    expect(colorForUserId('alice')).toBe(colorForUserId('alice'));
    expect(colorForUserId('bob')).toBe(colorForUserId('bob'));
  });

  it('colorForUserId always returns a palette member', () => {
    const sample = ['alice', 'bob', 'carol', 'dave', 'eve', 'frank', 'gina', 'hugo'];
    for (const id of sample) {
      expect(CURSOR_PALETTE).toContain(colorForUserId(id));
    }
  });

  it('rendered marker carries the deterministic colour via data-color', () => {
    render(<Host remoteStates={{ alice: { cursor: { x: 0, y: 0 } } }} />);
    const g = screen.getByTestId('cursor-overlay-alice');
    expect(g.getAttribute('data-color')).toBe(colorForUserId('alice'));
  });

  it('userColors override takes precedence over the hash', () => {
    render(
      <Host
        remoteStates={{ alice: { cursor: { x: 0, y: 0 } } }}
        userColors={{ alice: '#000000' }}
      />,
    );
    const g = screen.getByTestId('cursor-overlay-alice');
    expect(g.getAttribute('data-color')).toBe('#000000');
  });

  it('peers with a `name` field render a label inside the marker', () => {
    render(
      <Host
        remoteStates={{
          alice: { cursor: { x: 0, y: 0 }, name: 'Alice' },
        }}
      />,
    );
    const g = screen.getByTestId('cursor-overlay-alice');
    expect(g.querySelector('text')?.textContent).toBe('Alice');
  });
});
