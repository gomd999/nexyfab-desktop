/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PresenceState } from './yjsDoc';
import AwarenessPresencePanel from './AwarenessPresencePanel';

let pathname = '/en/shape-generator';

vi.mock('next/navigation', () => ({ usePathname: () => pathname }));

describe('AwarenessPresencePanel i18n', () => {
  it.each([
    ['kr', '이 룸의 사용자', '대기'],
    ['en', 'In this room', 'idle'],
    ['ja', 'このルーム', '待機'],
    ['cn', '此房间', '空闲'],
    ['es', 'En esta sala', 'inactivo'],
    ['ar', 'في هذه الغرفة', 'خامل'],
  ])('renders localized presence state for %s', (segment, roomLabel, idleLabel) => {
    pathname = `/${segment}/shape-generator`;
    const presences = new Map<number, PresenceState>([
      [1, { name: 'Local', activity: 'active' }],
      [2, { name: 'Remote', activity: 'idle' }],
    ]);

    render(<AwarenessPresencePanel presences={presences} localClientId={1} />);

    expect(screen.getByText(new RegExp(roomLabel))).toBeInTheDocument();
    expect(screen.getByText(idleLabel)).toBeInTheDocument();
  });
});
