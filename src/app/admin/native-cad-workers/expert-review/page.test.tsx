// @vitest-environment jsdom
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NativeCadExpertReviewPage from './page';

const targetHash = 'e'.repeat(64);
const packet = { schema: 'nexyfab.native-cad-expert-review-packet.v1', targetHash, target: { sourceHash: 'a'.repeat(64), artifactHashes: ['b'.repeat(64)], jointDefinitionHash: 'c'.repeat(64), verificationInputHash: 'd'.repeat(64), revision: 1 } };
const response = (role: 'domain-reviewer' | 'independent-reviewer', reviewerId: string, hash = targetHash) => ({ schema: 'nexyfab.native-cad-expert-signature-response.v1', signoff: { decision: 'approved', reviewedAt: '2026-08-01T00:00:00.000Z', reviewerId, role, targetHash: hash, signature: `${'A'.repeat(86)}==` } });
const file = (name: string, value: unknown) => { const result = new File([JSON.stringify(value)], name, { type: 'application/json' }); Object.defineProperty(result, 'text', { value: async () => JSON.stringify(value) }); return result; };
beforeEach(() => vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ registry: { reviewerKeyCount: 2, domainEligibleCount: 1, independentEligibleCount: 1, distinctPairAvailable: true } }) })));
afterEach(() => vi.unstubAllGlobals());

describe('native CAD expert review administrator UI', () => {
  it('imports two role-bound response files and enables assembled review validation', async () => {
    const { container } = render(<NativeCadExpertReviewPage />);
    await waitFor(() => expect(screen.getByText(/역할 분리 검토자 등록부 준비 완료/)).toBeTruthy());
    await act(async () => { fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file('packet.json', packet)] } }); });
    await waitFor(() => expect(screen.getByText(/target e{64}/)).toBeTruthy());
    const inputs = container.querySelectorAll('input[type="file"]');
    await act(async () => { fireEvent.change(inputs[1]!, { target: { files: [file('domain.json', response('domain-reviewer', 'domain'))] } }); });
    await act(async () => { fireEvent.change(inputs[2]!, { target: { files: [file('independent.json', response('independent-reviewer', 'independent'))] } }); });
    await waitFor(() => expect(screen.getByRole('button', { name: '서버 공개키로 검증' })).toBeTruthy());
    expect(screen.getAllByText(/서명 응답 준비됨/)).toHaveLength(2);
  });
  it('rejects a response issued for another target', async () => {
    const { container } = render(<NativeCadExpertReviewPage />);
    await act(async () => { fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file('packet.json', packet)] } }); });
    await waitFor(() => expect(container.querySelectorAll('input[type="file"]')).toHaveLength(3));
    await act(async () => { fireEvent.change(container.querySelectorAll('input[type="file"]')[1]!, { target: { files: [file('wrong.json', response('domain-reviewer', 'domain', 'f'.repeat(64)))] } }); });
    await waitFor(() => expect(screen.getByText(/signature_response_target_mismatch/)).toBeTruthy());
    expect(screen.queryByRole('button', { name: '서버 공개키로 검증' })).toBeNull();
  });
});
