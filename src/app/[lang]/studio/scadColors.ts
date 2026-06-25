/**
 * Colour-aware rendering for free-form OpenSCAD. STL/3MF export from OpenSCAD
 * is monochrome, so to show the model in its real colours (like CADAM) we
 * render each `color(...)` group separately by SHADOWING the built-in color()
 * module so only the matching group survives, then assign that colour to the
 * mesh in the viewer. Uncoloured geometry renders via an empty shadow.
 */

export interface ColorGroup {
  /** OpenSCAD colour token exactly as written, e.g. `"RoyalBlue"` or `[1,0,0]`. Null = uncoloured default. */
  token: string | null;
  /** A CSS/hex string or rgb() THREE can parse. */
  css: string;
  /** 0–1; <1 means translucent (glass/windows). */
  alpha: number;
}

const X11_FALLBACK = '#9aa0a6'; // neutral grey for any uncoloured geometry

/** Turn a colour LITERAL (`"name"`, `"#hex"`, or `[r,g,b(,a)]`) into a group.
 *  `token` is the literal exactly as OpenSCAD's `c` will equal it at runtime. */
function literalToGroup(lit: string): ColorGroup | null {
  const s = lit.trim();
  const str = s.match(/^"([^"]+)"$/);
  if (str) return { token: `"${str[1]}"`, css: str[1]!, alpha: 1 };
  const vec = s.match(/^\[\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\]$/);
  if (vec) {
    const r = +vec[1]!, g = +vec[2]!, b = +vec[3]!, a = vec[4] != null ? +vec[4]! : 1;
    const token = `[${vec[1]},${vec[2]},${vec[3]}${vec[4] != null ? ',' + vec[4] : ''}]`;
    return { token, css: `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`, alpha: a };
  }
  return null;
}

/** Distinct colours used in the program. Handles `color("X")`, `color([..])`,
 *  AND `color(var)` where `var = "X"` / `[..]` is a top-level variable (the AI
 *  almost always uses variables so the colour is a Customizer parameter). */
export function parseScadColors(scad: string): ColorGroup[] {
  // 1. top-level colour variables → their literal value
  const vars: Record<string, string> = {};
  const declRe = /^[ \t]*(\w+)[ \t]*=[ \t]*("[^"]*"|\[[^\]]*\])[ \t]*;/gm;
  let dm: RegExpExecArray | null;
  while ((dm = declRe.exec(scad))) vars[dm[1]!] = dm[2]!.trim();

  // 2. every color(arg) — resolve identifiers through the variable table
  const out: ColorGroup[] = [];
  const seen = new Set<string>();
  const colRe = /\bcolor\s*\(\s*("[^"]*"|\[[^\]]*\]|\w+)\s*[,)]/g;
  let m: RegExpExecArray | null;
  while ((m = colRe.exec(scad))) {
    let arg = m[1]!.trim();
    if (/^\w+$/.test(arg) && vars[arg]) arg = vars[arg]!; // identifier → literal
    const g = literalToGroup(arg);
    if (g && g.token != null && !seen.has(g.token)) { seen.add(g.token); out.push(g); }
  }
  return out;
}

/** Wrap the program so only the given colour token renders (null → only uncoloured parts). */
export function isolateColorScad(scad: string, token: string | null): string {
  const guard = token == null
    ? 'module color(c) { }'                       // render nothing wrapped in color() → only bare geometry
    : `module color(c) { if (c == ${token}) children(); }`;
  return `${guard}\n${scad}`;
}

/** Does the program have any geometry NOT wrapped in color()? Heuristic: it has
 *  top-level statements that aren't all colour-wrapped. We just always try the
 *  uncoloured pass and drop it if the render is empty. */
export function defaultColorCss(): string {
  return X11_FALLBACK;
}
