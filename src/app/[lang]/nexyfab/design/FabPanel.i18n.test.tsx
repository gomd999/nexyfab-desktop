// @vitest-environment jsdom
/**
 * FabPanel.i18n.test.tsx — regression for the unbranched-Korean bug class
 * (same class as commit 7fa0516e, simulator RISK_SCENARIOS).
 *
 * FabPanel already gates most of its text on `isKorean(lang)` (binary ko/en,
 * matching KIND_TITLE's `[ko, en]` tuple convention used elsewhere in this
 * file). Two spots had no fallback at all and always rendered Korean
 * regardless of `lang`:
 *   - RATE_FIELDS_METAL/CONCRETE/TIMBER/FFE: `f.ko` rendered directly with no
 *     `ko ?` gate, so the editable rate-card labels ("소재", "절단", …) showed
 *     for every locale.
 *   - the FF&E schedule row's seat-count suffix (` · N석`) was a raw template
 *     literal with no language branch.
 * Fixed by adding `en` to RateField and gating both render sites on `ko`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import FabPanel from './FabPanel';
import { createCommercialLocalizer } from '@/lib/i18n/commercialLocalizer';

const HANGUL = /[가-힣]/;

function mockFetchSequence() {
  vi.stubGlobal('fetch', vi.fn((_url: string, opts?: RequestInit) => {
    if (!opts) {
      // GET /api/nexyfab/drawing/fab/ — default rate card
      return Promise.resolve({
        json: () => Promise.resolve({
          ok: true,
          rates: { materialPerKg: 1, cutPerM: 1, piercePerHole: 1, bendPerOp: 1, setup: 1, marginPct: 1 },
        }),
      } as Response);
    }
    // POST compute — a plain sheet-laser spec (falls through to RATE_FIELDS_METAL)
    return Promise.resolve({
      json: () => Promise.resolve({
        ok: true,
        spec: {
          applicable: true, kind: 'sheet', thicknessMm: 2, cutLengthM: 1.2, pierces: 3,
          weightKg: 0.5, bends: 0, netAreaMm2: 12000,
        },
        estimate: {
          applicable: true, currency: 'KRW', estimate: true,
          breakdown: { material: 500, cut: 1200 }, subtotal: 1700, margin: 170, total: 1870,
          disclaimer: 'est.',
        },
        dxf: null,
      }),
    } as Response);
  }));
}

beforeEach(() => {
  mockFetchSequence();
});

describe('FabPanel — rate card labels are language-branched, not fixed Korean', () => {
  it.each(['en', 'ja', 'cn', 'es', 'ar'])('lang=%s: rate card uses the six-language catalog, no leftover Korean', async (lang) => {
    const { container } = render(<FabPanel intent={{ kind: 'sheet' }} lang={lang} />);
    const L = createCommercialLocalizer(lang);
    await screen.findByText(`${L('', 'Material')} (₩/kg)`);
    expect(screen.getByText(`${L('', 'Cut')} (₩/m)`)).toBeInTheDocument();
    expect(screen.getByText(`${L('', 'Margin')} (%)`)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(HANGUL);
  });

  it('lang=kr: rate card keeps original Korean labels', async () => {
    render(<FabPanel intent={{ kind: 'sheet' }} lang="kr" />);
    await screen.findByText('소재 (₩/kg)');
    expect(screen.getByText('절단 (₩/m)')).toBeInTheDocument();
    expect(screen.getByText('마진 (%)')).toBeInTheDocument();
  });
});

describe('FabPanel — FF&E seat-count suffix is language-branched', () => {
  function mockFfeFetch() {
    vi.stubGlobal('fetch', vi.fn((_url: string, opts?: RequestInit) => {
      if (!opts) {
        return Promise.resolve({
          json: () => Promise.resolve({ ok: true, rates: { setup: 1, marginPct: 1 } }),
        } as Response);
      }
      return Promise.resolve({
        json: () => Promise.resolve({
          ok: true,
          spec: {
            applicable: true, kind: 'ffe', floorAreaM2: 50, seatTotal: 20, itemTypes: 2, itemCount: 5,
            items: [{ id: 'i1', name: 'Chair', count: 4, seats: 4, priceEach: 10, subtotal: 40 }],
          },
          estimate: { applicable: true, currency: 'KRW', estimate: true, breakdown: {}, subtotal: 40, margin: 4, total: 44, disclaimer: 'est.' },
          dxf: null,
        }),
      } as Response);
    }));
  }

  it('lang=en: seat suffix reads "seats", not 석', async () => {
    mockFfeFetch();
    const { container } = render(<FabPanel intent={{ kind: 'ffe' }} lang="en" />);
    await screen.findByText(/Chair × 4/);
    expect(screen.getByText(/4 seats/)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(HANGUL);
  });

  it('lang=kr: seat suffix reads 석', async () => {
    mockFfeFetch();
    render(<FabPanel intent={{ kind: 'ffe' }} lang="kr" />);
    await screen.findByText(/Chair × 4/);
    expect(screen.getByText(/4석/)).toBeInTheDocument();
  });
});
