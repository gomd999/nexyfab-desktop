// @vitest-environment jsdom
/**
 * CodeCheckPanel.i18n.test.tsx — regression for the unbranched-Korean bug class
 * (same class as commit 7fa0516e, simulator RISK_SCENARIOS).
 *
 * CodeCheckPanel already gates most of its text on `isKorean(lang)` (a binary
 * ko/en fallback — the convention every sibling file in this directory uses;
 * see AssemblyPresetPanel's 6-locale table for the *other* accepted pattern).
 * The module-level GROUPS array (form section titles + field/option labels +
 * the "개" unit on emergencyExitCount), SOURCE_LABEL, and one inline "법령"
 * badge on results previously had ONLY a Korean string with no fallback at
 * all — so en/ja/cn/es/ar users (anyone for whom isKorean(lang) is false) saw
 * raw Korean regardless of the page's own localization. Fixed by adding
 * labelEn/titleEn/unitEn (+ SOURCE_LABEL_EN) and wiring every render site
 * through `ko ? ... : ...`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CodeCheckPanel from './CodeCheckPanel';

const HANGUL = /[가-힣]/;

function mockFetch(reportOk: boolean) {
  vi.stubGlobal('fetch', vi.fn((_url: string, opts?: RequestInit) => {
    if (!opts) {
      // GET /api/nexyfab/codecheck — catalog warm-up, flips `open` to true.
      return Promise.resolve({ json: () => Promise.resolve({ ok: true }) } as Response);
    }
    // POST /api/nexyfab/codecheck — "Run code-check" click.
    return Promise.resolve({
      json: () => Promise.resolve(reportOk
        ? {
            ok: true,
            results: [{ id: 'r1', category: 'parking', clause: 'Art. 1', source: 'Enforcement Decree', status: 'fail', required: '>= 1.0m', message: 'too narrow' }],
            passCount: 0, failCount: 1, naCount: 0,
            disclaimer: 'not a legal opinion',
          }
        : { ok: false, error: 'boom' }),
    } as Response);
  }));
}

beforeEach(() => {
  mockFetch(true);
});

describe('CodeCheckPanel — non-ko renders carry no leftover Korean', () => {
  it.each(['en', 'ja', 'cn', 'es', 'ar'])('lang=%s: group titles/field labels/units are English, not Korean', async (lang) => {
    const { container } = render(<CodeCheckPanel lang={lang} />);
    // GROUPS renders once `open` flips true after the catalog warm-up fetch resolves.
    await screen.findByText('Accessible parking space');
    expect(screen.getByText('Emergency exit count (ea)')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(HANGUL);
  });

  it('lang=kr: group titles/field labels/units stay Korean (unchanged originals)', async () => {
    render(<CodeCheckPanel lang="kr" />);
    await screen.findByText('장애인전용 주차구역');
    expect(screen.getByText('주차면 폭 (m)')).toBeInTheDocument();
    expect(screen.getByText('비상구 개수 (개)')).toBeInTheDocument();
  });

  it('lang=en: select option labels are English (e.g. stair usage dropdown)', async () => {
    render(<CodeCheckPanel lang="en" />);
    await screen.findByText('Stairs');
    expect(screen.getByText('Other stairs')).toBeInTheDocument();
    expect(screen.getByText('Middle/high school')).toBeInTheDocument();
  });

  it('lang=en: a rendered report shows the "statute" badge, not 법령', async () => {
    const { container } = render(<CodeCheckPanel lang="en" />);
    await screen.findByText('Accessible parking space');
    fireEvent.click(screen.getByRole('button', { name: 'Run code-check' }));
    await screen.findByText('statute');
    expect(container.textContent).not.toContain('법령');
  });

  it('lang=kr: a rendered report shows the 법령 badge (unchanged)', async () => {
    render(<CodeCheckPanel lang="kr" />);
    await screen.findByText('장애인전용 주차구역');
    fireEvent.click(screen.getByRole('button', { name: '코드체크 실행' }));
    await screen.findByText('법령');
  });
});
