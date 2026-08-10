import { normalizeCadExtension, routeNativeCadExtension } from './nativeWorkerRouting';

const EXPORT_GUIDANCE: Record<string, string> = {
  sldprt: 'SOLIDWORKS에서 STEP AP242 또는 AP214로 내보낸 뒤 업로드하세요.',
  sldasm: 'SOLIDWORKS에서 어셈블리 구조를 포함한 STEP AP242 또는 AP214로 내보낸 뒤 업로드하세요.',
  ipt: 'Inventor에서 STEP으로 내보낸 뒤 업로드하세요.',
  iam: 'Inventor에서 어셈블리 구조를 포함한 STEP으로 내보낸 뒤 업로드하세요.',
  catpart: 'CATIA에서 STEP AP242 또는 AP214로 내보낸 뒤 업로드하세요.',
  catproduct: 'CATIA에서 제품 구조를 포함한 STEP AP242 또는 AP214로 내보낸 뒤 업로드하세요.',
  prt: '원본 CAD에서 STEP AP242 또는 AP214로 내보낸 뒤 업로드하세요.',
  asm: '원본 CAD에서 어셈블리 구조를 포함한 STEP AP242 또는 AP214로 내보낸 뒤 업로드하세요.',
  rvt: 'Revit에서 IFC로 내보낸 뒤 업로드하세요.',
  rfa: 'Revit 프로젝트에 배치한 뒤 IFC로 내보내거나 정밀 워커 연결을 요청하세요.',
};

export function browserNativeCadImportPolicy(filename: string) {
  const extension = normalizeCadExtension(filename.split('.').pop() ?? '');
  // These two formats have explicitly labelled approximate browser/server
  // readers. Exact native semantics still require the external worker.
  if (extension === 'x_t' || extension === 'dwg') {
    return { action: 'continue-approximate' as const, extension };
  }
  const route = routeNativeCadExtension(extension);
  if (!route || route.availability === 'local') return { action: 'continue' as const };

  return {
    action: 'block-before-read' as const,
    extension,
    workerKind: route.workerKind,
    message: `${extension.toUpperCase()} 정밀 네이티브 변환 워커가 현재 연결되지 않았습니다. ${EXPORT_GUIDANCE[extension] ?? '원본 CAD에서 STEP AP242 또는 AP214로 내보낸 뒤 업로드하세요.'}`,
  };
}
