/** @vitest-environment jsdom */
/**
 * CollabStatusBadge — rendering tests.
 *
 * Covers:
 *   - status colour matrix (green / blue / red)
 *   - headline text in all 6 langs
 *   - "N peers" pluralisation reflects peerCount
 *   - hover reveals the peer-list tooltip
 *   - focus reveals the peer-list tooltip (a11y)
 *   - userColors override beats the deterministic hash
 *   - peerIds default to hash-derived colour
 *   - empty peer list renders the "no peers" tooltip variant
 *   - peer ordering is preserved (caller-controlled)
 *   - data-status attribute exposes the resolved status
 *   - resolveStatus helper truth-table
 *   - status-colour palette stays within the documented constants
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import {
  CollabStatusBadge,
  STATUS_COLORS,
  resolveStatus,
} from '@/app/[lang]/shape-generator/_shared/CollabStatusBadge';
import { colorForUserId } from '@/app/[lang]/shape-generator/_shared/CursorOverlay';

afterEach(() => cleanup());

// ─── Status colour matrix ────────────────────────────────────────────────

describe('CollabStatusBadge — status colour', () => {
  it('connected + 3 peers → green active dot + "(3 peers)" headline', () => {
    render(
      <CollabStatusBadge
        lang="en"
        isConnected={true}
        peerCount={3}
        peerIds={['alice', 'bob', 'carol']}
      />,
    );
    const badge = screen.getByTestId('collab-status-badge');
    expect(badge.getAttribute('data-status')).toBe('active');
    expect(badge.getAttribute('data-color')).toBe(STATUS_COLORS.active);
    expect(STATUS_COLORS.active).toBe('#10b981');
    expect(screen.getByTestId('collab-status-text').textContent).toBe(
      'Collab: Connected (3 peers)',
    );
  });

  it('connected + 0 peers → blue idle dot + "(0 peers)" headline', () => {
    render(<CollabStatusBadge lang="en" isConnected={true} peerCount={0} />);
    const badge = screen.getByTestId('collab-status-badge');
    expect(badge.getAttribute('data-status')).toBe('idle');
    expect(badge.getAttribute('data-color')).toBe(STATUS_COLORS.idle);
    expect(STATUS_COLORS.idle).toBe('#3b82f6');
    expect(screen.getByTestId('collab-status-text').textContent).toBe(
      'Collab: Connected (0 peers)',
    );
  });

  it('disconnected → red offline dot + "Disconnected" headline (peer count suppressed)', () => {
    // Even with a non-zero peerCount (stale snapshot), disconnect wins.
    render(<CollabStatusBadge lang="en" isConnected={false} peerCount={2} />);
    const badge = screen.getByTestId('collab-status-badge');
    expect(badge.getAttribute('data-status')).toBe('offline');
    expect(badge.getAttribute('data-color')).toBe(STATUS_COLORS.offline);
    expect(STATUS_COLORS.offline).toBe('#ef4444');
    expect(screen.getByTestId('collab-status-text').textContent).toBe(
      'Collab: Disconnected',
    );
  });
});

// ─── resolveStatus helper truth-table ────────────────────────────────────

describe('CollabStatusBadge — resolveStatus helper', () => {
  it('encodes the documented truth table', () => {
    expect(resolveStatus(true, 3)).toBe('active');
    expect(resolveStatus(true, 1)).toBe('active');
    expect(resolveStatus(true, 0)).toBe('idle');
    expect(resolveStatus(false, 0)).toBe('offline');
    expect(resolveStatus(false, 5)).toBe('offline'); // disconnect overrides peer count
  });

  it('STATUS_COLORS exposes exactly the documented three keys + hexes', () => {
    expect(Object.keys(STATUS_COLORS).sort()).toEqual(['active', 'idle', 'offline']);
    expect(STATUS_COLORS.active).toBe('#10b981');
    expect(STATUS_COLORS.idle).toBe('#3b82f6');
    expect(STATUS_COLORS.offline).toBe('#ef4444');
  });
});

// ─── Tooltip behaviour ───────────────────────────────────────────────────

describe('CollabStatusBadge — tooltip', () => {
  it('tooltip is hidden by default and appears on hover', () => {
    render(
      <CollabStatusBadge
        lang="en"
        isConnected={true}
        peerCount={2}
        peerIds={['alice', 'bob']}
      />,
    );
    expect(screen.queryByTestId('collab-status-tooltip')).toBeNull();

    const badge = screen.getByTestId('collab-status-badge');
    fireEvent.mouseEnter(badge);
    expect(screen.getByTestId('collab-status-tooltip')).toBeInTheDocument();

    fireEvent.mouseLeave(badge);
    expect(screen.queryByTestId('collab-status-tooltip')).toBeNull();
  });

  it('tooltip also appears on keyboard focus (a11y)', () => {
    render(
      <CollabStatusBadge
        lang="en"
        isConnected={true}
        peerCount={1}
        peerIds={['alice']}
      />,
    );
    const badge = screen.getByTestId('collab-status-badge');
    fireEvent.focus(badge);
    expect(screen.getByTestId('collab-status-tooltip')).toBeInTheDocument();
    fireEvent.blur(badge);
    expect(screen.queryByTestId('collab-status-tooltip')).toBeNull();
  });

  it('hover with peerIds → lists each peer with the awareness-derived colour', () => {
    render(
      <CollabStatusBadge
        lang="en"
        isConnected={true}
        peerCount={2}
        peerIds={['alice', 'bob']}
      />,
    );
    fireEvent.mouseEnter(screen.getByTestId('collab-status-badge'));
    expect(screen.getByTestId('collab-status-peer-alice')).toBeInTheDocument();
    expect(screen.getByTestId('collab-status-peer-bob')).toBeInTheDocument();
    expect(
      screen.getByTestId('collab-status-peer-swatch-alice').getAttribute('data-color'),
    ).toBe(colorForUserId('alice'));
    expect(
      screen.getByTestId('collab-status-peer-swatch-bob').getAttribute('data-color'),
    ).toBe(colorForUserId('bob'));
  });

  it('userColors override beats the deterministic hash in swatches', () => {
    render(
      <CollabStatusBadge
        lang="en"
        isConnected={true}
        peerCount={1}
        peerIds={['alice']}
        userColors={{ alice: '#abcdef' }}
      />,
    );
    fireEvent.mouseEnter(screen.getByTestId('collab-status-badge'));
    expect(
      screen.getByTestId('collab-status-peer-swatch-alice').getAttribute('data-color'),
    ).toBe('#abcdef');
  });

  it('hover with no peerIds renders the "no peers" tooltip variant', () => {
    render(<CollabStatusBadge lang="en" isConnected={true} peerCount={0} />);
    fireEvent.mouseEnter(screen.getByTestId('collab-status-badge'));
    const tip = screen.getByTestId('collab-status-tooltip');
    expect(tip).toHaveTextContent('No other peers connected');
    expect(screen.queryByTestId('collab-status-peer-list')).toBeNull();
  });

  it('peer order is preserved (caller-controlled, no internal re-sort)', () => {
    render(
      <CollabStatusBadge
        lang="en"
        isConnected={true}
        peerCount={3}
        peerIds={['zoe', 'alice', 'marvin']}
      />,
    );
    fireEvent.mouseEnter(screen.getByTestId('collab-status-badge'));
    // Read order from the peer-list <li>s specifically. The shared
    // `collab-status-peer-*` prefix would otherwise also catch the <ul>
    // (`collab-status-peer-list`) and the swatch spans
    // (`collab-status-peer-swatch-*`).
    const ids = Array.from(
      screen.getByTestId('collab-status-peer-list').querySelectorAll('li'),
    ).map((el) => el.getAttribute('data-user-id'));
    expect(ids).toEqual(['zoe', 'alice', 'marvin']);
  });
});

// ─── i18n: all 6 langs ───────────────────────────────────────────────────

describe('CollabStatusBadge — i18n', () => {
  const cases: Array<{
    lang: 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';
    connectedSubstr: string;
    disconnectedSubstr: string;
  }> = [
    { lang: 'ko', connectedSubstr: '연결됨', disconnectedSubstr: '연결 끊김' },
    { lang: 'en', connectedSubstr: 'Connected', disconnectedSubstr: 'Disconnected' },
    { lang: 'ja', connectedSubstr: '接続中', disconnectedSubstr: '切断' },
    { lang: 'zh', connectedSubstr: '已连接', disconnectedSubstr: '已断开' },
    { lang: 'es', connectedSubstr: 'Conectado', disconnectedSubstr: 'Desconectado' },
    { lang: 'ar', connectedSubstr: 'متصل', disconnectedSubstr: 'غير متصل' },
  ];

  for (const c of cases) {
    it(`${c.lang} — connected headline contains "${c.connectedSubstr}"`, () => {
      render(
        <CollabStatusBadge lang={c.lang} isConnected={true} peerCount={2} />,
      );
      expect(screen.getByTestId('collab-status-text').textContent).toContain(
        c.connectedSubstr,
      );
    });

    it(`${c.lang} — disconnected headline contains "${c.disconnectedSubstr}"`, () => {
      render(
        <CollabStatusBadge lang={c.lang} isConnected={false} peerCount={0} />,
      );
      expect(screen.getByTestId('collab-status-text').textContent).toContain(
        c.disconnectedSubstr,
      );
    });
  }

  it('unknown lang falls back to English', () => {
    render(
      <CollabStatusBadge
        // @ts-expect-error — deliberately probing the fallback path
        lang="xx"
        isConnected={true}
        peerCount={1}
      />,
    );
    expect(screen.getByTestId('collab-status-text').textContent).toContain('Connected');
  });
});

// ─── Misc structure ──────────────────────────────────────────────────────

describe('CollabStatusBadge — structure', () => {
  it('renders a status dot child element', () => {
    render(<CollabStatusBadge lang="en" isConnected={true} peerCount={1} />);
    expect(screen.getByTestId('collab-status-dot')).toBeInTheDocument();
  });

  it('aria-label mirrors the visible headline', () => {
    render(
      <CollabStatusBadge lang="en" isConnected={true} peerCount={4} />,
    );
    const badge = screen.getByTestId('collab-status-badge');
    expect(badge.getAttribute('aria-label')).toBe('Collab: Connected (4 peers)');
    expect(badge.getAttribute('role')).toBe('status');
  });

  it('exposes peer-count + connected as data-attributes for outer queries', () => {
    render(
      <CollabStatusBadge lang="en" isConnected={false} peerCount={0} />,
    );
    const badge = screen.getByTestId('collab-status-badge');
    expect(badge.getAttribute('data-peer-count')).toBe('0');
    expect(badge.getAttribute('data-connected')).toBe('false');
  });
});
