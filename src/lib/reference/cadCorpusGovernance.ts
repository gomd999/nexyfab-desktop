export type CadCorpusTrack = 'mechanical' | 'pmi' | 'sheet_metal' | 'weldment' | 'motion' | 'open_bim';
export type CadCorpusSupport = 'executable' | 'reference_only' | 'unsupported';

export interface CadCorpusCandidate {
  relativePath: string;
  sizeBytes: number;
}

export interface CadCorpusClassification extends CadCorpusCandidate {
  extension: string;
  support: CadCorpusSupport;
  track: CadCorpusTrack;
  reason: string;
}

const EXECUTABLE = new Set(['step', 'stp', 'stl', 'dxf', 'ifc', 'scad']);
const REFERENCE_ONLY = new Set([
  'sldprt', 'sldasm', 'slddrw', 'ipt', 'iam', 'catpart', 'catproduct', 'dwg', 'rvt', 'pdf',
]);

export function normalizedExtension(relativePath: string): string {
  const name = relativePath.replaceAll('\\', '/').split('/').pop() ?? '';
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function isExcludedCorpusPath(relativePath: string): boolean {
  const path = `/${relativePath.replaceAll('\\', '/').toLowerCase()}/`;
  return path.includes('/result/') || path.includes('/.gate_work/') || path.includes('/.git/') ||
    path.endsWith('/.env/') || path.includes('/node_modules/');
}

export function classifyCadCorpusCandidate(candidate: CadCorpusCandidate): CadCorpusClassification {
  const extension = normalizedExtension(candidate.relativePath);
  const path = candidate.relativePath.toLowerCase();
  const support: CadCorpusSupport = EXECUTABLE.has(extension)
    ? 'executable'
    : REFERENCE_ONLY.has(extension) ? 'reference_only' : 'unsupported';

  let track: CadCorpusTrack = 'mechanical';
  if (extension === 'ifc' || extension === 'rvt' || path.includes('ifc4')) track = 'open_bim';
  else if (path.includes('nist-pmi') || path.includes('ap242') || path.includes('pmi')) track = 'pmi';
  else if (path.includes('sheet') || path.includes('cabinet') || path.includes('enclosure')) track = 'sheet_metal';
  else if (path.includes('weld') || path.includes('frame') || path.includes('stair') || path.includes('conveyor')) track = 'weldment';
  else if (path.includes('robot') || path.includes('loader') || path.includes('excavator') || path.includes('arm')) track = 'motion';

  const reason = support === 'executable'
    ? 'Neutral/open format can enter an automated importer test.'
    : support === 'reference_only'
      ? 'Native/proprietary or document format requires a dedicated loader or manual comparison.'
      : 'No governed importer is registered for this format.';
  return { ...candidate, extension, support, track, reason };
}

export function corpusVerdict(item: CadCorpusClassification): 'ready' | 'not_run' {
  return item.support === 'executable' ? 'ready' : 'not_run';
}

