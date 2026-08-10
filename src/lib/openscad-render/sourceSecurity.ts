export type ScadSourceSecurityResult =
  | { ok: true }
  | { ok: false; reason: 'UNTRUSTED_INCLUDE' | 'UNTRUSTED_IMPORT' | 'EXTERNAL_SURFACE'; detail: string };

const TRUSTED_BOSL2_INCLUDE = /^BOSL2\/[A-Za-z0-9_-]+\.scad$/;

function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/[^\r\n]*/g, '$1');
}

/**
 * OpenSCAD has file-reading primitives. AI/customer source is untrusted, so
 * it may only include a named BOSL2 module and may only import the server-
 * supplied `model.stl` attachment. Paths, URLs and `surface(file=...)` are
 * rejected before a child process or container is started.
 */
export function validateScadExecutionSource(
  source: string,
  options: { hasImportStl: boolean },
): ScadSourceSecurityResult {
  const code = withoutComments(source);

  const includeToken = /\b(include|use)\b\s*<([^>\r\n]+)>/gi;
  for (const match of code.matchAll(includeToken)) {
    const target = match[2].trim().replace(/\\/g, '/');
    if (!TRUSTED_BOSL2_INCLUDE.test(target)) {
      return { ok: false, reason: 'UNTRUSTED_INCLUDE', detail: target.slice(0, 160) };
    }
  }
  // A dangling/obfuscated token that did not match the complete grammar is
  // rejected instead of being left for OpenSCAD to interpret.
  const removedIncludes = code.replace(includeToken, '');
  if (/\b(?:include|use)\b/i.test(removedIncludes)) {
    return { ok: false, reason: 'UNTRUSTED_INCLUDE', detail: 'malformed include/use statement' };
  }

  const importToken = /\bimport\s*\(\s*(?:file\s*=\s*)?["']([^"']+)["']/gi;
  for (const match of code.matchAll(importToken)) {
    const target = match[1].trim().replace(/\\/g, '/');
    if (!options.hasImportStl || target !== 'model.stl') {
      return { ok: false, reason: 'UNTRUSTED_IMPORT', detail: target.slice(0, 160) };
    }
  }
  const removedImports = code.replace(importToken, '');
  if (/\bimport\s*\(/i.test(removedImports)) {
    return { ok: false, reason: 'UNTRUSTED_IMPORT', detail: 'dynamic or malformed import statement' };
  }

  if (/\bsurface\s*\(/i.test(code)) {
    return { ok: false, reason: 'EXTERNAL_SURFACE', detail: 'surface() file access is disabled' };
  }

  return { ok: true };
}
