// Semantic colors for use in WebGL (three.js / react-three-fiber) materials,
// lights, and THREE.Color constructors.
//
// WHY: THREE.Color CANNOT parse CSS custom properties. Passing
// `color="var(--nx-accent)"` (or `new THREE.Color('var(--nx-ok)')`) makes the
// color silently fall back to WHITE, so geometry / handles / guides render
// invisible on a light viewport. Anything that lives in the 3D scene must use
// a concrete color — these hex constants, or `resolveCssColor()` for a
// theme-aware read. DOM / drei <Html> labels keep CSS vars (those are real CSS
// and resolve fine).
//
// The hex values are vivid mid-tones chosen to stay legible on BOTH the light
// and dark themes. (2026-06-12 — extracted after a viewport audit found this
// bug class across ~15 files.)

export const GL_COLOR = {
  ok:      '#16a34a', // success / closed profile / valid (green)
  warn:    '#f59e0b', // warning / open profile / selected (amber)
  error:   '#ef4444', // error / start point / section (red)
  accent:  '#3b82f6', // primary accent / guides / handles (blue)
  accent2: '#58a6ff', // secondary accent (lighter blue)
  neutral: '#94a3b8', // theme-neutral gray for default markers / text-ish
  border:  '#727b8a', // grid major lines / dividers
  cell:    '#aab1bd', // grid minor lines
  guide:   '#94a3b8', // dashed helper lines
} as const;

/**
 * Resolve a `--nx-*` CSS variable to a hex/color string at call time so a
 * WebGL color can follow the theme. Call inside an effect / event handler /
 * render (NOT at module top-level — the DOM may not be ready yet). Returns
 * `fallback` during SSR or when the variable is unset.
 */
export function resolveCssColor(varName: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return v || fallback;
}
