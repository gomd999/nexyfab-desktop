import { canonicalDrawingKey } from '../../../scripts/reference/audit-239-drawing-corpus.mjs';
import type { ArchitectureDrawingAnnotation, ArchitectureDrawingTrack } from './architectureDrawingReconstruction';

interface Coco239Category { id?: unknown; name?: unknown }
interface Coco239Image { id?: unknown; width?: unknown; height?: unknown; file_name?: unknown }
interface Coco239Annotation { id?: unknown; image_id?: unknown; category_id?: unknown; segmentation?: unknown; bbox?: unknown; attributes?: unknown }
export interface Coco239Document { categories?: unknown; images?: unknown; annotations?: unknown }

export interface Aihub239AdaptedTrack {
  track: ArchitectureDrawingTrack;
  drawingKey: string | null;
  widthPx: number | null;
  heightPx: number | null;
  annotations: ArchitectureDrawingAnnotation[];
  issues: string[];
}

const finiteTuple = (value: unknown, length: number): value is number[] => Array.isArray(value) && value.length === length && value.every(Number.isFinite);

/** Convert a single audited COCO label document without copying its source image. */
export function adaptAihub239Track(
  document: Coco239Document,
  track: ArchitectureDrawingTrack,
  sourceRef: string,
  quarantinedSourceRefs: ReadonlySet<string> = new Set(),
): Aihub239AdaptedTrack {
  const issues: string[] = [], categories = Array.isArray(document.categories) ? document.categories as Coco239Category[] : [];
  const images = Array.isArray(document.images) ? document.images as Coco239Image[] : [];
  const annotations = Array.isArray(document.annotations) ? document.annotations as Coco239Annotation[] : [];
  const categoryById = new Map<number, string>();
  for (const category of categories) if (Number.isSafeInteger(category.id) && typeof category.name === 'string') categoryById.set(category.id as number, category.name);
  if (images.length !== 1) issues.push(`Expected exactly one image, found ${images.length}.`);
  const image = images[0], imageId = image?.id;
  const widthPx = typeof image?.width === 'number' && Number.isFinite(image.width) && image.width > 0 ? image.width : null;
  const heightPx = typeof image?.height === 'number' && Number.isFinite(image.height) && image.height > 0 ? image.height : null;
  const filename = typeof image?.file_name === 'string' ? image.file_name : '';
  if (widthPx === null || heightPx === null || !filename) issues.push('Image metadata is invalid.');
  const adapted: ArchitectureDrawingAnnotation[] = [];
  for (const [index, annotation] of annotations.entries()) {
    if (annotation.image_id !== imageId) { issues.push(`annotations[${index}]: image_id mismatch.`); continue; }
    const category = categoryById.get(annotation.category_id as number);
    if (!category) { issues.push(`annotations[${index}]: category is missing.`); continue; }
    const segmentation = Array.isArray(annotation.segmentation) ? annotation.segmentation as unknown[] : [];
    const firstSegment = Array.isArray(segmentation[0]) ? segmentation[0] : [];
    const polygon = finiteTuple(firstSegment, firstSegment.length) && firstSegment.length >= 6 && firstSegment.length % 2 === 0
      ? Array.from({ length: firstSegment.length / 2 }, (_, pointIndex) => [firstSegment[pointIndex * 2]!, firstSegment[pointIndex * 2 + 1]!] as [number, number])
      : undefined;
    const bbox = finiteTuple(annotation.bbox, 4) ? annotation.bbox as [number, number, number, number] : undefined;
    if (!polygon && !bbox) { issues.push(`annotations[${index}]: polygon and bbox are missing.`); continue; }
    const attributes = annotation.attributes && typeof annotation.attributes === 'object' ? annotation.attributes as Record<string, unknown> : {};
    adapted.push({
      id: `${track.toLowerCase()}-${String(annotation.id ?? index)}`, track, category, confidence: 1, sourceRef,
      ...(polygon ? { polygonPx: polygon } : {}), ...(bbox ? { bboxPx: bbox } : {}),
      ...(track === 'OCR' && typeof attributes.OCR === 'string' ? { text: attributes.OCR } : {}),
      ...(quarantinedSourceRefs.has(sourceRef) ? { quarantined: true } : {}),
    });
  }
  return { track, drawingKey: filename ? canonicalDrawingKey(filename) : null, widthPx, heightPx, annotations: adapted, issues };
}

/** Four tracks may be merged only when they describe the exact same source drawing. */
export function mergeAihub239Tracks(tracks: readonly Aihub239AdaptedTrack[]) {
  const issues = tracks.flatMap(track => track.issues.map(issue => `${track.track}: ${issue}`));
  const byTrack = new Map(tracks.map(track => [track.track, track]));
  for (const required of ['STR', 'SPA', 'OBJ', 'OCR'] as const) if (!byTrack.has(required)) issues.push(`${required}: track is missing.`);
  const keys = new Set(tracks.map(track => track.drawingKey).filter((key): key is string => Boolean(key)));
  if (keys.size !== 1) issues.push(`Tracks do not share one drawing key: ${[...keys].join(', ') || '(none)'}.`);
  const dimensions = new Set(tracks.map(track => `${track.widthPx}x${track.heightPx}`));
  if (dimensions.size !== 1 || tracks.some(track => track.widthPx === null || track.heightPx === null)) issues.push('Track image dimensions do not match.');
  return {
    drawingId: keys.size === 1 ? [...keys][0]! : null,
    widthPx: issues.length ? null : tracks[0]!.widthPx,
    heightPx: issues.length ? null : tracks[0]!.heightPx,
    annotations: issues.length ? [] : tracks.flatMap(track => track.annotations),
    issues,
  };
}
