/**
 * CAD 가져오기 오류 분류 + 사용자 메시지.
 * `classifyCadImportError`는 토스트/UI 외에 로깅·텔레메트리 코드 키로 사용.
 * stepImporter, importers.parseOCCT, DXF 파서와 메시지 문자열을 맞출 것.
 */

import { StepImportApiError } from './stepImportApiError';

export type CadImportErrorCode =
  | 'unsupported_format'
  | 'step_parse'
  | 'step_no_geometry'
  | 'step_no_mesh'
  | 'wasm_load'
  | 'occt_import'
  | 'dxf_no_entities'
  | 'dxf_profile'
  | 'server_step_api'
  | 'unknown';

export function classifyCadImportError(
  err: unknown,
  ctx?: { filename?: string },
): { code: CadImportErrorCode; message: string } {
  const label = ctx?.filename ? `"${ctx.filename}"` : 'File';
  const raw = err instanceof Error ? err.message : String(err);

  const msg = (code: CadImportErrorCode, text: string) => ({ code, message: text });

  if (err instanceof StepImportApiError) {
    return msg('server_step_api', err.message);
  }

  if (/Unsupported format/i.test(raw)) {
    return msg('unsupported_format', raw);
  }
  if (/STEP parsing failed/i.test(raw)) {
    const detail = raw.replace(/^STEP parsing failed:\s*/i, '').trim();
    return msg(
      'step_parse',
      `${label}: STEP could not be parsed. ${detail || 'The file may be corrupt or use unsupported STEP entities.'}`,
    );
  }
  if (/No geometry found in STEP/i.test(raw)) {
    return msg(
      'step_no_geometry',
      `${label}: No tessellated geometry in this STEP file (empty file or B-rep-only without triangulation).`,
    );
  }
  if (/STEP produced no renderable meshes/i.test(raw)) {
    return msg(
      'step_no_mesh',
      `${label}: STEP was read but no triangle mesh was produced. Try re-exporting from your CAD tool with tessellation/AP242 options.`,
    );
  }
  if (/Failed to load OCCT WASM/i.test(raw)) {
    return msg(
      'wasm_load',
      'CAD import engine (WASM) failed to load. Refresh the page, check network, or try a smaller file.',
    );
  }
  if (/OCCT import failed/i.test(raw)) {
    return msg(
      'occt_import',
      `${label}: IGES/BREP import produced no mesh. The file may be empty or use unsupported entities.`,
    );
  }
  if (/DXF file contains no supported entities/i.test(raw)) {
    return msg(
      'dxf_no_entities',
      `${label}: DXF has no supported 2D entities (lines/arcs/circles) to extrude.`,
    );
  }
  if (/no geometry that could be converted/i.test(raw)) {
    return msg(
      'dxf_profile',
      `${label}: DXF could not be turned into a closed profile for extrusion.`,
    );
  }

  return msg('unknown', `${label}: ${raw}`);
}

export function formatCadImportError(err: unknown, ctx?: { filename?: string }): string {
  return classifyCadImportError(err, ctx).message;
}
