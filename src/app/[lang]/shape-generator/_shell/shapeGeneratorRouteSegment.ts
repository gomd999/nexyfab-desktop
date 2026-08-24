export type ShapeGeneratorRouteSegment = 'sketch' | 'analysis' | '3d-edit';

/** Returns the first bookmarkable segment after `shape-generator`. */
export function shapeGeneratorRouteSegment(pathname: string | null): ShapeGeneratorRouteSegment | null {
  if (!pathname) return null;
  const parts = pathname.split('/').filter(Boolean);
  const shapeGeneratorIndex = parts.indexOf('shape-generator');
  if (shapeGeneratorIndex === -1) return null;
  const segment = parts[shapeGeneratorIndex + 1];
  return segment === 'sketch' || segment === 'analysis' || segment === '3d-edit' ? segment : null;
}
