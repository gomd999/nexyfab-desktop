// @vitest-environment jsdom
/**
 * DesignBriefPanel — WA-D3 web entry tests.
 *
 * Verifies: the form submits to the design-brief API (mocked fetch), renders a
 * verified-package summary on 200, renders an explicit refusal on 422, and
 * always mounts the WA-C AiReviewQueuePanel (empty state when no AI runs).
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { DesignBriefPanel } from './DesignBriefPanel';

vi.mock('next/navigation', () => ({ usePathname: () => '/en/shape-generator' }));

function jsonResponse(status: number, body: unknown): Response {
  return { status, ok: status >= 200 && status < 300, json: async () => body } as unknown as Response;
}

const OK_PAYLOAD = {
  ok: true,
  planId: 'fixture-l-bracket',
  package: {
    planId: 'fixture-l-bracket',
    parts: [{ partId: 'bracket', volumeMm3: 14720, dxf: '0\nSECTION\n', dimensions: [{ id: 'd_width', kind: 'linear', value: 60, unit: 'mm', expected: 60, deviation: 0 }] }],
    report: { allPassed: true, gates: [{ id: 'geometry:bracket', kind: 'geometry', pass: true, metrics: {}, notes: [] }], approximations: ['tessellation note'], limitations: ['PDF 미포함'] },
  },
};

const REFUSAL_PAYLOAD = {
  ok: false,
  refusal: { stage: 'plan', reason: "fixturePlanner: unknown brief 'nope'", failedGateIds: [] },
  gates: [],
};

describe('DesignBriefPanel (WA-D3 web entry)', () => {
  it('mounts the AI review queue (empty state) even before any submit', () => {
    const { getByTestId } = render(<DesignBriefPanel fetchImpl={vi.fn()} />);
    expect(getByTestId('db-review-queue')).toBeTruthy();
    // AiReviewQueuePanel empty state (no AI runs recorded).
    expect(getByTestId('arq-empty')).toBeTruthy();
  });

  it('submit → calls the design-brief API and renders the verified package summary', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, OK_PAYLOAD));
    const { getByTestId, queryByTestId } = render(<DesignBriefPanel fetchImpl={fetchImpl} />);

    fireEvent.change(getByTestId('db-text'), { target: { value: 'L-Bracket 60×40×8' } });
    fireEvent.submit(getByTestId('db-form'));

    await waitFor(() => expect(getByTestId('db-package')).toBeTruthy());

    // Fetch hit the right endpoint with the brief body.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('/api/nexyfab/design-brief');
    expect(JSON.parse((init as RequestInit).body as string).brief.text).toBe('L-Bracket 60×40×8');

    // Package summary shows the measured part + gate rows; no refusal.
    expect(getByTestId('db-part').textContent).toContain('bracket');
    expect(getByTestId('db-gates').textContent).toContain('geometry:bracket');
    expect(queryByTestId('db-refusal')).toBeNull();
  });

  it('422 refusal → renders explicit refusal (stage + reason), no package', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(422, REFUSAL_PAYLOAD));
    const { getByTestId, queryByTestId } = render(<DesignBriefPanel fetchImpl={fetchImpl} />);

    fireEvent.change(getByTestId('db-text'), { target: { value: 'a spaceship' } });
    fireEvent.submit(getByTestId('db-form'));

    await waitFor(() => expect(getByTestId('db-refusal')).toBeTruthy());
    expect(getByTestId('db-refusal').textContent).toContain('plan');
    expect(getByTestId('db-refusal').textContent).toContain('unknown brief');
    expect(queryByTestId('db-package')).toBeNull();
  });

  it('401 → surfaces a sign-in message, no package/refusal', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(401, { error: 'Unauthorized' }));
    const { getByTestId, queryByTestId } = render(<DesignBriefPanel fetchImpl={fetchImpl} />);

    fireEvent.change(getByTestId('db-text'), { target: { value: 'L-Bracket' } });
    fireEvent.submit(getByTestId('db-form'));

    await waitFor(() => expect(getByTestId('db-error')).toBeTruthy());
    expect(queryByTestId('db-package')).toBeNull();
    expect(queryByTestId('db-refusal')).toBeNull();
  });
});
