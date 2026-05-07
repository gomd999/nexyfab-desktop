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

export const DARK_THEME: Theme = {
  bg: '#0d1117',
  panelBg: '#161b22',
  cardBg: '#21262d',
  border: '#30363d',
  text: '#c9d1d9',
  textMuted: '#8b949e',
  accent: '#388bfd',
  accentBright: '#58a6ff',
  canvasBg: '#0d1117',
  inputBg: '#0d1117',
  hoverBg: '#30363d',
};

export const LIGHT_THEME: Theme = {
  ...DARK_THEME
};
