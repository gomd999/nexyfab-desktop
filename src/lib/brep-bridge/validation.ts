/** Allowed STEP upload basename/extension for API surface. */
export function isAllowedStepFilename(filename: string): boolean {
  const t = filename.trim();
  if (!t || t.includes('..') || t.includes('/') || t.includes('\\')) return false;
  return /\.(step|stp)$/i.test(t);
}
