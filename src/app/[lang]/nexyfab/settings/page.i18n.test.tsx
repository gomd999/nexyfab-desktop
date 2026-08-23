/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const route = vi.hoisted(() => ({ lang: 'en' }));

vi.mock('next/navigation', () => ({
  useParams: () => ({ lang: route.lang }),
}));

import SettingsPage, { SETTINGS_CARDS } from './SettingsPageClient';

const LANGS = ['ko', 'en', 'ja', 'zh', 'es', 'ar'] as const;

afterEach(() => cleanup());

describe('Settings page six-language card contract', () => {
  it('has a complete title/description pair for every supported locale', () => {
    for (const card of SETTINGS_CARDS) {
      expect(Object.keys(card.titleLocalized ?? {}).sort()).toEqual([...LANGS].sort());
      expect(Object.keys(card.descLocalized ?? {}).sort()).toEqual([...LANGS].sort());
      for (const lang of LANGS) {
        expect(card.titleLocalized?.[lang]).toBeTruthy();
        expect(card.descLocalized?.[lang]).toBeTruthy();
      }
    }
  });

  it.each(LANGS)('renders all card pairs for %s without falling back to English', (lang) => {
    route.lang = lang;
    render(<SettingsPage />);
    for (const card of SETTINGS_CARDS) {
      expect(screen.getByText(card.titleLocalized?.[lang] ?? '')).toBeInTheDocument();
      expect(screen.getByText(card.descLocalized?.[lang] ?? '')).toBeInTheDocument();
    }
  });
});
