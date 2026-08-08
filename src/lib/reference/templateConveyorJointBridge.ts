/**
 * templateConveyorJointBridge — B-1/A-L3(260808d): 기계 라인 템플릿
 * (modular_conveyor_line)을 K6 조인트 스윕 인증 스택(CadNativeAssemblyEvidence
 * → bind → plan → clearance certificate)에 접속하는 브리지.
 *
 * 규약 결정(구현 근거):
 *  - **월드-베이크 + 항등 변환**: 부품 지오메트리를 월드 좌표로 구운 피처트리로
 *    만들고 점유 변환은 항등 — 행렬 규약 표류 여지를 없앤다(스윕은 조인트
 *    축/원점만으로 자식을 회전시키므로 정확).
 *  - **롤러 = AABB 외피 보수 근사**: rx=−90 원통(축=+y)은 z-압출 어휘로 원단면
 *    표현 불가 → 외접 박스. 보수(⊇실형상)라 통과 판정은 실형상에서도 안전,
 *    회전축이 +y 라 y-범위가 회전 불변 → 레일과의 축방향 간극 판정은 정확.
 *  - 조인트 = 롤러 revolute(자기 축, 0..360°) — 회전 대칭이지만 인증은
 *    "전 회전에서 이웃과의 최소 간극"을 실측한다(편심·과경 결함 검출 그물).
 */
import type { FeatureNode, FeatureTree } from '@/lib/cad/featureTree';
import { buildCadProductBundleManifest, type CadProductBundleManifest } from './cadCorpusProductBundle';
import type { CadNativeAssemblyEvidence } from './cadNativeAssemblyEvidence';

export interface TemplatePartLike {
  id: string;
  type: string;
  params: Record<string, unknown>;
  at?: { tx?: number; ty?: number; tz?: number; rx?: number; ry?: number; rz?: number };
  role?: string;
}
export interface TemplateAssemblyLike { parts: TemplatePartLike[]; name?: string }

const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** 부품 → 월드 AABB [x0,x1,y0,y1,z0,z1]. box(무회전)와 rx=−90 cylinder 만 —
 *  그 밖은 null(브리지 어휘 밖 — 정직 거부, 호출측이 사유 목록에 실음). */
export function partWorldAabb(part: TemplatePartLike): [number, number, number, number, number, number] | null {
  const at = part.at ?? {};
  const tx = num(at.tx), ty = num(at.ty), tz = num(at.tz);
  const rx = num(at.rx), ry = num(at.ry), rz = num(at.rz);
  if (part.type === 'box' && !rx && !ry && !rz) {
    const w = num(part.params.width), d = num(part.params.depth), h = num(part.params.height);
    if (w <= 0 || d <= 0 || h <= 0) return null;
    return [tx, tx + w, ty, ty + d, tz, tz + h];
  }
  if (part.type === 'cylinder' && rx === -90 && !ry && !rz) {
    // A-L2 실측 규약: 로컬 z→월드 +y(ty=시작점), 로컬 x/y는 중심 기준.
    const r = num(part.params.diameter) / 2;
    const len = num(part.params.length);
    if (r <= 0 || len <= 0) return null;
    return [tx - r, tx + r, ty, ty + len, tz - r, tz + r];
  }
  return null;
}

function worldBoxNode(id: string, aabb: [number, number, number, number, number, number]): FeatureNode {
  const [x0, x1, y0, y1, z0, z1] = aabb;
  return {
    id, name: id, dependencies: [],
    payload: {
      kind: 'extrude',
      loop: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }],
      depth: z1 - z0,
      profileOffsetZ: z0,
      direction: 'one_sided',
      mode: 'add',
    },
  };
}

export interface ConveyorJointBridgeResult {
  bundle: CadProductBundleManifest;
  evidence: CadNativeAssemblyEvidence;
  /** occurrenceId('native:<partId>') → 월드-베이크 피처트리 */
  trees: Map<string, FeatureTree>;
  /** 브리지 어휘 밖이라 제외된 부품(정직 목록 — 침묵 누락 금지) */
  excluded: Array<{ id: string; reason: string }>;
  rollerJointIds: string[];
}

export function bridgeConveyorToJointEvidence(asm: TemplateAssemblyLike): ConveyorJointBridgeResult {
  const bundle = buildCadProductBundleManifest([
    { relativePath: 'set/conveyor.snapshot.1/root.SLDASM', bytes: new TextEncoder().encode(asm.name ?? 'conveyor') },
    { relativePath: 'set/conveyor.snapshot.1/part.SLDPRT', bytes: new TextEncoder().encode('template-part') },
  ]);
  const asmMember = bundle.members.find(m => m.role === 'native_assembly')!;
  const partMember = bundle.members.find(m => m.role === 'native_part')!;

  const excluded: Array<{ id: string; reason: string }> = [];
  const trees = new Map<string, FeatureTree>();
  const occurrences: CadNativeAssemblyEvidence['occurrences'] = [];
  const definitions: CadNativeAssemblyEvidence['definitions'] = [];
  const joints: CadNativeAssemblyEvidence['joints'] = [];
  const rollerJointIds: string[] = [];

  // 레일 하나를 조인트 부모(고정측)로 쓴다 — 스윕은 자식(롤러)만 움직인다.
  const parentPart = asm.parts.find(part => part.role === 'rail') ?? asm.parts[0]!;
  // 어댑터는 루트 점유 정확히 1개를 요구(native_assembly_root_count_invalid 실측)
  // → 부모(레일)를 루트로, 나머지는 그 자식으로 체이닝. 부모가 항등이라
  // local-to-parent 변환도 항등=월드 그대로.
  const rootId = parentPart.id;

  for (const part of asm.parts) {
    const aabb = partWorldAabb(part);
    if (!aabb) { excluded.push({ id: part.id, reason: `vocab:${part.type}@rot` }); continue; }
    const defId = `def:${part.id}`;
    definitions.push({ id: defId, name: part.id, sourceMember: partMember.relativePath, kind: 'part' });
    occurrences.push({
      id: part.id, definitionId: defId,
      parentOccurrenceId: part.id === rootId ? null : rootId,
      transform: I,
      suppressed: false,
      state: { resolved: true, suppressed: false, lightweight: false, flexible: false, hidden: false },
    });
    trees.set(`native:${part.id}`, { nodes: [worldBoxNode(part.id, aabb)] });

    if (part.role === 'roller' && part.type === 'cylinder') {
      const at = part.at ?? {};
      const jointId = `rev:${part.id}`;
      joints.push({
        id: jointId, type: 'revolute',
        parentOccurrenceId: parentPart.id, childOccurrenceId: part.id,
        axis: [0, 1, 0], // rx=−90 원통의 회전축 = 월드 +y
        originMm: [num(at.tx), num(at.ty), num(at.tz)],
        // 0..180°: AABB 프록시는 축 회전에 180° 대칭이라 0..180 스윕의 점유
        // 포락 = 전 회전 포락(수학적 등가 — 커버리지 손실 없음). 360 폐구간은
        // 힌지 솔버가 ~180° 반전 모호점에서 비수렴(frame_not_converged 실측).
        lowerLimit: 0, upperLimit: 180, frame: 'world',
      });
      rollerJointIds.push(jointId);
    }
  }

  const evidence: CadNativeAssemblyEvidence = {
    schema: 'nexyfab.native-assembly-evidence.v1.1',
    lineageId: bundle.lineageId,
    extractor: { name: 'template-conveyor-bridge', version: '1', cadSystem: 'nexyfab-template', cadVersion: null },
    coordinateSystem: { handedness: 'right', upAxis: 'z', forwardAxis: '+x', matrixLayout: 'row-major', vectorConvention: 'column-vector', transformScope: 'local-to-parent' },
    units: { length: 'mm', angle: 'deg' },
    sources: [{ relativePath: asmMember.relativePath, sha256: asmMember.sha256 }],
    definitions,
    occurrences,
    joints,
  };
  return { bundle, evidence, trees, excluded, rollerJointIds };
}
