import type { FeatureType } from './types';

/** User-facing pipeline / feature failure classification (M2). */
export interface FeatureDiagnostic {
  code:
    | 'empty'
    | 'emptyOutput'
    | 'nonManifold'
    | 'indexedMesh'
    | 'nan'
    | 'paramRange'
    | 'emptySketch'
    | 'timeout'
    | 'selfIntersect'
    | 'booleanOp'
    | 'mergeFail'
    | 'bounds'
    | 'minimalGeometry'
    | 'occtInit'
    | 'workerFail'
    | 'cancelled'
    | 'unknown';
  message: string;
  hintKo: string;
  hintEn: string;
  /** 히스토리 트리 노드 id — 토스트·패널에서 실패 위치 표시용 */
  nodeId?: string;
}

function classifyFeatureErrorBase(
  featureType: FeatureType,
  rawMessage: string,
): FeatureDiagnostic {
  const msg = rawMessage.toLowerCase();

  if (msg.includes('feature produced empty geometry')) {
    return {
      code: 'emptyOutput',
      message: rawMessage,
      hintKo: '이 피처가 유효한 고체를 만들지 못했습니다. 이전 단계 기하·파라미터를 조정하세요.',
      hintEn: 'This feature did not produce a valid solid. Adjust upstream geometry or parameters.',
    };
  }
  if (msg.includes('no meshes produced')) {
    return {
      code: 'emptyOutput',
      message: rawMessage,
      hintKo: '가져온 파일에서 유효한 메시를 만들지 못했습니다. 포맷·손상 여부를 확인하세요.',
      hintEn: 'Import produced no usable mesh. Check file format and integrity.',
    };
  }
  if (
    msg.includes('dxf file contains no supported entities') ||
    msg.includes('dxf file contains no geometry that could be converted')
  ) {
    return {
      code: 'emptyOutput',
      message: rawMessage,
      hintKo: 'DXF에서 가져올 수 있는 엔티티가 없습니다. 레이어·폴리라인/닫힌 도형을 확인하세요.',
      hintEn: 'DXF has no importable entities. Check layers and closed polylines/regions.',
    };
  }
  if (msg.includes('unsupported format')) {
    return {
      code: 'unknown',
      message: rawMessage,
      hintKo: '지원하지 않는 파일 형식이거나 확장자가 맞지 않습니다.',
      hintEn: 'Unsupported file format or extension.',
    };
  }
  if (msg.includes('sketch merge produced empty geometry')) {
    return {
      code: 'empty',
      message: rawMessage,
      hintKo: '스케치와 본체를 합친 결과가 비어 있습니다. 스케치 위치·프로파일을 확인하세요.',
      hintEn: 'Sketch merge produced no geometry. Check sketch position and profile.',
    };
  }
  if (msg.includes('sketch produced empty geometry')) {
    return {
      code: 'emptySketch',
      message: rawMessage,
      hintKo: '스케치 프로파일 면적이 없거나 돌출 길이가 0일 수 있습니다. 프로파일·깊이를 확인하세요.',
      hintEn: 'Sketch profile may be empty or extrusion depth is zero. Check profile and depth.',
    };
  }
  if (msg.includes('profile produced no geometry')) {
    return {
      code: 'emptySketch',
      message: rawMessage,
      hintKo: '프로파일에서 생성된 세그먼트가 없습니다. 점·경로 구성을 확인하세요.',
      hintEn: 'No segments produced from the profile. Check points and path.',
    };
  }
  if (msg.includes('profile must have at least 2 points')) {
    return {
      code: 'paramRange',
      message: rawMessage,
      hintKo: '프로파일에 점이 부족합니다. 최소 두 점 이상이 필요합니다.',
      hintEn: 'Profile needs at least two points.',
    };
  }
  if (
    msg.includes('pipeline superseded') ||
    msg.includes('pipeline cancelled') ||
    msg.includes('csg cancelled') ||
    msg.includes('fea cancelled') ||
    msg.includes('dfm cancelled') ||
    msg.includes('interference check cancelled')
  ) {
    return {
      code: 'cancelled',
      message: rawMessage,
      hintKo: '이전 실행이 취소되었거나 더 새로운 재생성으로 대체되었습니다. 잠시 후 자동으로 다시 시도됩니다.',
      hintEn: 'This run was cancelled or superseded by a newer rebuild. It will retry when the model settles.',
    };
  }
  if (
    msg.includes('boolean') &&
    (msg.includes('empty result') ||
      msg.includes('produced no geometry') ||
      msg.includes('meshes may not intersect'))
  ) {
    return {
      code: 'booleanOp',
      message: rawMessage,
      hintKo: '불리언 결과가 비어 있습니다. 도구와 본체가 겹치는지, 메시가 닫힌 고체인지 확인하세요.',
      hintEn: 'Boolean produced no solid. Ensure tool and body overlap and meshes are watertight.',
    };
  }
  if (msg.includes('merge failed') || msg.includes('failed to merge')) {
    return {
      code: 'mergeFail',
      message: rawMessage,
      hintKo: '패턴/대칭/플랜지 등 병합에 실패했습니다. 간격·개수를 줄이거나 이전 기하를 확인하세요.',
      hintEn: 'Merge failed (pattern/mirror/flange). Reduce instance count or spacing; check upstream geometry.',
    };
  }
  if (msg.includes('occt engine not initialized') || msg.includes('failed to load occt wasm')) {
    return {
      code: 'occtInit',
      message: rawMessage,
      hintKo: 'OCCT 엔진이 아직 준비되지 않았습니다. 잠시 후 다시 시도하거나 페이지를 새로고침하세요.',
      hintEn: 'OCCT engine is not ready yet. Wait and retry, or refresh the page.',
    };
  }
  if (
    msg.includes('csg worker terminated') ||
    msg.includes('pipeline worker error') ||
    msg.includes('pipeline worker returned unknown error') ||
    msg.includes('pipeline worker terminated') ||
    msg.includes('csg worker error') ||
    msg.includes('interference worker error') ||
    msg.includes('fea worker error') ||
    msg.includes('fea worker returned unknown error') ||
    msg.includes('dfm worker error') ||
    msg.includes('dfm worker returned unknown error') ||
    msg.includes('failed to start csg') ||
    msg.includes('failed to start pipeline worker') ||
    msg.includes('failed to start fea') ||
    msg.includes('failed to start dfm') ||
    msg.includes('failed to start interference') ||
    msg.includes('indexeddb not available')
  ) {
    return {
      code: 'workerFail',
      message: rawMessage,
      hintKo: '백그라운드 워커에서 오류가 났습니다. 새로고침 후 재시도하거나 복잡도를 줄이세요.',
      hintEn: 'A background worker failed. Refresh and retry, or reduce model complexity.',
    };
  }
  if (msg.includes('geometry has no bounding box') || msg.includes('missing bounding box')) {
    return {
      code: 'bounds',
      message: rawMessage,
      hintKo: '바운딩 박스를 계산할 수 없습니다. 메시가 비어 있거나 깨졌을 수 있습니다.',
      hintEn: 'Cannot compute bounding box — geometry may be empty or invalid.',
    };
  }
  if (msg.includes('requires indexed') && msg.includes('manifold')) {
    return {
      code: 'indexedMesh',
      message: rawMessage,
      hintKo: '닫힌(watertight) 메시가 필요합니다. 가져온 STL 등은 필렛/쉘에 부적합할 수 있습니다.',
      hintEn: 'Indexed manifold/watertight mesh required. Imported STL may be open or non-solid.',
    };
  }
  if (msg.includes('at least 4 vertices')) {
    return {
      code: 'minimalGeometry',
      message: rawMessage,
      hintKo: '메시 정점이 너무 적습니다. 이전 피처가 비어 있거나 깨진 고체인지 확인하세요.',
      hintEn: 'Too few mesh vertices — upstream feature may be empty or degenerate.',
    };
  }
  if (
    msg.includes('no position attribute') ||
    msg.includes('no position buffer') ||
    msg.includes('cannot serialise mesh') ||
    msg.includes('cannot serialize mesh')
  ) {
    return {
      code: 'minimalGeometry',
      message: rawMessage,
      hintKo: '메시 버퍼가 비어 있거나 직렬화할 수 없습니다. 이전 피처 출력이 유효한지 확인하세요.',
      hintEn: 'Mesh has no serialisable vertex buffer — upstream output may be empty or corrupt.',
    };
  }
  if (msg.includes('invalid edgeindex') || msg.includes('invalid edge index')) {
    return {
      code: 'paramRange',
      message: rawMessage,
      hintKo: '엣지 인덱스가 유효하지 않습니다. 시트메탈 등에서 엣지 선택을 다시 하세요.',
      hintEn: 'Invalid edge index. Re-select the edge (e.g. sheet metal bend/flange).',
    };
  }
  if (msg.includes('requires exactly 4 boundary curves')) {
    return {
      code: 'paramRange',
      message: rawMessage,
      hintKo: '경계 곡선이 정확히 4개 필요합니다. 바운더리 스케치 참조를 확인하세요.',
      hintEn: 'Exactly four boundary curves required. Check boundary-surface sketch references.',
    };
  }
  /** Field Top N / OCCT-style strings (B4 rolling) — extend from production telemetry. */
  if (
    msg.includes('out of memory') ||
    msg.includes('memory allocation failed') ||
    msg.includes('allocation failed') ||
    (msg.includes('wasm') && msg.includes('memory'))
  ) {
    return {
      code: 'workerFail',
      message: rawMessage,
      hintKo: '메모리가 부족합니다. 창을 줄이거나 피처·해상도를 낮춘 뒤 새로고침하세요.',
      hintEn: 'Out of memory. Close other tabs, simplify the model, or refresh the page.',
    };
  }
  if (msg.includes('degenerate') || msg.includes('degeneracy')) {
    return {
      code: 'paramRange',
      message: rawMessage,
      hintKo: '퇴화한 기하(너무 작은 면·엣지)입니다. 크기·각도를 조정하거나 이전 피처를 단순화하세요.',
      hintEn: 'Degenerate geometry — adjust sizes/angles or simplify upstream features.',
    };
  }
  if (
    msg.includes('topolog') &&
    (msg.includes('invalid') || msg.includes('failed') || msg.includes('error'))
  ) {
    return {
      code: 'nonManifold',
      message: rawMessage,
      hintKo: '위상이 유효하지 않습니다. 열린 면·자가교차·중복 면이 없는지 확인하세요.',
      hintEn: 'Invalid topology — check for open faces, self-intersections, or duplicate faces.',
    };
  }
  if (
    msg.includes('failed to offset') ||
    msg.includes('offset failed') ||
    msg.includes('failed to thicken') ||
    msg.includes('thicken failed')
  ) {
    return {
      code: 'paramRange',
      message: rawMessage,
      hintKo: '오프셋/두께 보강이 실패했습니다. 거리를 줄이거나 기준이 되는 면을 다시 선택하세요.',
      hintEn: 'Offset/thicken failed — reduce distance or re-pick the reference face.',
    };
  }
  if (msg.includes('healing failed') || msg.includes('failed to heal') || msg.includes('heal failed')) {
    return {
      code: 'mergeFail',
      message: rawMessage,
      hintKo: '기하 병합(힐)이 실패했습니다. 간격을 넓히거나 피처 순서를 바꿔 보세요.',
      hintEn: 'Heal/merge failed — increase clearance or reorder features.',
    };
  }
  if (
    (msg.includes('loft') && (msg.includes('failed') || msg.includes('error'))) ||
    (msg.includes('sweep') &&
      (msg.includes('failed') || msg.includes('error')) &&
      !msg.includes('self-intersect'))
  ) {
    return {
      code: 'mergeFail',
      message: rawMessage,
      hintKo: '로프트/스윕 결과를 합치지 못했습니다. 단면 정렬·폐곡선·경로 곡률을 확인하세요.',
      hintEn: 'Loft/sweep merge failed — check profile alignment, closed sections, and path curvature.',
    };
  }
  if (
    msg.includes('empty expression') ||
    msg.includes('division by zero') ||
    msg.includes('unexpected token') ||
    (msg.includes('unexpected character') && msg.includes('position')) ||
    msg.includes('unknown variable') ||
    (msg.includes('invalid number') && msg.includes('position')) ||
    msg.includes('result is not finite')
  ) {
    return {
      code: 'paramRange',
      message: rawMessage,
      hintKo: '파라미터 수식에 오류가 있습니다. 변수명·괄호·연산자·단위를 확인하세요.',
      hintEn: 'Parameter expression is invalid. Check variables, parentheses, and operators.',
    };
  }
  if (
    msg.includes('empty') &&
    (msg.includes('sketch') || featureType === 'sketchExtrude' || featureType === 'sketch')
  ) {
    return {
      code: 'emptySketch',
      message: rawMessage,
      hintKo: '스케치가 닫혀있는지 확인하세요. K 키로 프로파일을 닫을 수 있습니다.',
      hintEn: 'Check that the sketch profile is closed. Press K to close.',
    };
  }
  if (msg.includes('empty') || msg.includes('교차하지 않')) {
    return {
      code: 'empty',
      message: rawMessage,
      hintKo: '도구가 본체와 교차하도록 위치/크기를 조정하세요. 필렛/챔퍼는 반경이 너무 크면 실패합니다.',
      hintEn: 'Adjust tool position/size so it intersects the body. Fillets fail if radius is too large.',
    };
  }
  if (msg.includes('nan') || msg.includes('infinity')) {
    return {
      code: 'nan',
      message: rawMessage,
      hintKo: '메시에 유효하지 않은 정점이 있습니다. 이전 피처를 확인하세요.',
      hintEn: 'Mesh contains invalid vertices. Check upstream features.',
    };
  }
  if (
    msg.includes('non-manifold') ||
    msg.includes('non manifold') ||
    msg.includes('nonmanifold')
  ) {
    return {
      code: 'nonManifold',
      message: rawMessage,
      hintKo: 'Non-manifold 입력입니다. 이전 피처가 깨진 기하를 만들고 있는지 확인하세요.',
      hintEn: 'Non-manifold input. An upstream feature may be producing broken geometry.',
    };
  }
  if (msg.includes('self-intersect') || msg.includes('self intersect')) {
    return {
      code: 'selfIntersect',
      message: rawMessage,
      hintKo: '자가 교차(스케치·스윕 경로 등)가 있습니다. 프로파일을 단순화하거나 분할하세요.',
      hintEn: 'Self-intersection detected (sketch, sweep path, etc.). Simplify or split the profile.',
    };
  }
  if (
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('deadline') ||
    msg.includes('aborted')
  ) {
    return {
      code: 'timeout',
      message: rawMessage,
      hintKo: '연산이 중단되었습니다. 피처를 줄이거나 복잡도를 낮춘 뒤 다시 시도하세요.',
      hintEn: 'Operation timed out or was aborted. Reduce feature count or complexity and retry.',
    };
  }
  if (
    (msg.includes('boolean') || msg.includes('csg') || msg.includes('subtract') || msg.includes('union')) &&
    (msg.includes('fail') || msg.includes('error') || msg.includes('invalid'))
  ) {
    return {
      code: 'booleanOp',
      message: rawMessage,
      hintKo: '불리언 연산이 실패했습니다. 대상이 겹치는지, 메시가 유효한지 확인하세요.',
      hintEn: 'Boolean operation failed. Check overlap and mesh validity.',
    };
  }
  if (msg.includes('radius') || msg.includes('thickness') || msg.includes('diameter')) {
    return {
      code: 'paramRange',
      message: rawMessage,
      hintKo: '파라미터 값을 줄여보세요 (예: 필렛 반경을 인접 엣지 길이의 절반 이하로).',
      hintEn: 'Reduce parameter value (e.g. fillet radius < half of adjacent edge).',
    };
  }
  const sketchUnknown =
    featureType === 'sketch'
      ? {
          hintKo:
            '스케치 프로파일·평면·참조를 확인하세요. 로프트/스윕은 스케치 ID 참조가 올바른지 검토합니다.',
          hintEn:
            'Check sketch profile, plane, and references. Loft/sweep rely on valid sketch IDs in the stack.',
        }
      : {
          hintKo: '피처를 일시 중지(Suppress)하거나 파라미터를 조정해 보세요.',
          hintEn: 'Try suppressing the feature or adjusting its parameters.',
        };

  return {
    code: 'unknown',
    message: rawMessage,
    hintKo: sketchUnknown.hintKo,
    hintEn: sketchUnknown.hintEn,
  };
}

export function classifyFeatureError(
  featureType: FeatureType,
  rawMessage: string,
  context?: { nodeId?: string },
): FeatureDiagnostic {
  const d = classifyFeatureErrorBase(featureType, rawMessage);
  if (!context?.nodeId) return d;
  return {
    ...d,
    nodeId: context.nodeId,
    hintEn: `${d.hintEn} — Tree node: ${context.nodeId}`,
    hintKo: `${d.hintKo} — 트리 노드: ${context.nodeId}`,
  };
}
