/**
 * Minimal unified-diff applier for the agent's apply_diff tool.
 *
 * Why hand-roll instead of pulling `diff` / `diff-match-patch`:
 *   - Bundle weight: those libs are 30–50KB; we need maybe 80 lines of code.
 *   - Format we accept is well-defined: standard `--- / +++ / @@` headers
 *     with `-`/`+`/` ` line prefixes. No fuzzy matching, no rename heuristics.
 *
 * The agent emits diffs against the current SCAD source. If a hunk fails
 * to apply (context mismatch) we throw `DiffApplyError` and the loop will
 * relay the error to the model so it can re-emit a corrected diff.
 */

export class DiffApplyError extends Error {
  constructor(message: string, public readonly hunk?: number) {
    super(message);
    this.name = 'DiffApplyError';
  }
}

interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  body: string[]; // each line keeps its leading ' ' / '+' / '-'
}

function parseHunks(diff: string): Hunk[] {
  const lines = diff.split('\n');
  const hunks: Hunk[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('@@')) {
      // Match `@@ -oldStart,oldLines +newStart,newLines @@`
      const m = line.match(/@@\s*-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s*@@/);
      if (!m) throw new DiffApplyError(`Malformed hunk header: ${line}`, hunks.length);
      const oldStart = Number(m[1]);
      const oldLines = m[2] === undefined ? 1 : Number(m[2]);
      const newStart = Number(m[3]);
      const newLines = m[4] === undefined ? 1 : Number(m[4]);
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('@@')) {
        const l = lines[i];
        // Strip --- / +++ / index headers if they got embedded inside hunks.
        if (l.startsWith('---') || l.startsWith('+++')) { i++; continue; }
        body.push(l);
        i++;
      }
      hunks.push({ oldStart, oldLines, newStart, newLines, body });
    } else {
      i++;
    }
  }
  return hunks;
}

export function applyUnifiedDiff(source: string, diff: string): string {
  const hunks = parseHunks(diff);
  if (hunks.length === 0) {
    // No-op or unsupported — returning source unchanged would silently
    // mask malformed input, so be explicit.
    throw new DiffApplyError('No hunks found in diff (need lines starting with @@)');
  }

  const srcLines = source.split('\n');
  const out: string[] = [];
  let cursor = 0; // 0-indexed position in srcLines

  for (let hi = 0; hi < hunks.length; hi++) {
    const h = hunks[hi];
    const targetIdx = h.oldStart - 1;

    // Copy unchanged lines up to the hunk start.
    if (targetIdx < cursor) {
      throw new DiffApplyError(`Hunk ${hi} starts before previous hunk ended`, hi);
    }
    while (cursor < targetIdx) {
      out.push(srcLines[cursor]);
      cursor++;
    }

    // Process body
    for (const line of h.body) {
      if (line.length === 0) continue; // trailing blank often appears
      const prefix = line[0];
      const rest = line.slice(1);
      if (prefix === ' ') {
        if (srcLines[cursor] !== rest) {
          throw new DiffApplyError(
            `Hunk ${hi} context mismatch at line ${cursor + 1}: expected "${rest}", got "${srcLines[cursor] ?? '<EOF>'}"`,
            hi,
          );
        }
        out.push(srcLines[cursor]);
        cursor++;
      } else if (prefix === '-') {
        if (srcLines[cursor] !== rest) {
          throw new DiffApplyError(
            `Hunk ${hi} delete mismatch at line ${cursor + 1}: expected "${rest}", got "${srcLines[cursor] ?? '<EOF>'}"`,
            hi,
          );
        }
        cursor++; // skip — line removed
      } else if (prefix === '+') {
        out.push(rest);
      } else if (prefix === '\\') {
        // "\ No newline at end of file" — informational, ignore
      } else {
        throw new DiffApplyError(`Unrecognized diff line prefix '${prefix}'`, hi);
      }
    }
  }

  // Tail
  while (cursor < srcLines.length) {
    out.push(srcLines[cursor]);
    cursor++;
  }

  return out.join('\n');
}
