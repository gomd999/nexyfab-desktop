// @vitest-environment jsdom
/**
 * page.i18n.test.tsx — regression for a route-lang/ISO-lang mismatch.
 *
 * DashboardPage picked its dict with `lang === 'ko'`, but this app's actual
 * route segment for Korean is `kr` (see src/lib/i18n/normalize.ts —
 * SUPPORTED_LANGS = ['kr','en','ja','cn','es','ar']; `ko` is only the legacy
 * ISO form). A Korean visitor hitting `/kr/dashboard` therefore always fell
 * through to the English branch — the dict was never wired to the real param.
 * Fixed by switching the gate to `isKorean(lang)`, which accepts both `kr`
 * and `ko`. Also verifies the list-view table headers (previously hardcoded
 * English with no dict entry at all) now follow the same gate.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

let mockLang = 'kr';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useParams: () => ({ lang: mockLang }),
}));

import DashboardPage from './page';

describe('DashboardPage — lang gate matches the real route segment', () => {
  it('lang=kr (the real Korean route segment): renders the Korean dict', () => {
    mockLang = 'kr';
    render(<DashboardPage />);
    expect(screen.getByText('프로젝트 대시보드')).toBeTruthy();
    expect(screen.getByText('내 프로젝트')).toBeTruthy();
  });

  it('lang=ko (legacy ISO form): also renders the Korean dict', () => {
    mockLang = 'ko';
    render(<DashboardPage />);
    expect(screen.getByText('프로젝트 대시보드')).toBeTruthy();
  });

  it('lang=en: renders the English dict, no leftover Korean', () => {
    mockLang = 'en';
    const { container } = render(<DashboardPage />);
    expect(screen.getByText('Project Dashboard')).toBeTruthy();
    expect(screen.getByText('My Projects')).toBeTruthy();
    expect(/[가-힣]/.test(container.textContent || '')).toBe(false);
  });
});
