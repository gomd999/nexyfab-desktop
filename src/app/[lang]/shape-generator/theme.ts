export type ThemeMode = 'dark' | 'light';

export interface Theme {
  bg: string;
  panelBg: string;
  cardBg: string;
  border: string;
  text: string;
  textMuted: string;
  accent: string;
  accentBright: string;
  canvasBg: string;
  inputBg: string;
  hoverBg: string;
}

// Both objects point to shell-v2 CSS variables defined in globals.css.
// The actual color resolution comes from `html[data-theme="dark" | "light"]`
// which ThemeContext maintains. This way every `style={{ bg: theme.bg }}`
// inline style across ShapeGeneratorInner reacts to the theme toggle.
const TOKENS: Theme = {
  bg: 'var(--nx-bg)',
  panelBg: 'var(--nx-panel)',
  cardBg: 'var(--nx-panel-2)',
  border: 'var(--nx-border)',
  text: 'var(--nx-text)',
  textMuted: 'var(--nx-text-2)',
  accent: 'var(--nx-accent)',
  accentBright: 'var(--nx-accent-2)',
  canvasBg: 'var(--nx-viewport-bg-bot)',
  inputBg: 'var(--nx-panel-2)',
  hoverBg: 'var(--nx-hover)',
};

export const DARK_THEME: Theme = TOKENS;
export const LIGHT_THEME: Theme = TOKENS;
