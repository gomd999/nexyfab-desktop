/**
 * workerTopoFacade — K7 승격 S1 (260808).
 *
 * 브라우저 OCCT 워커(클래식 스크립트)가 소비할 **생성-이력 명명(System A)**
 * 공개 표면. 명명 기계 자체는 처음부터 순수 공유 모듈(topoNaming·composedTopo·
 * edgeMatch — node/three 의존 0)이었고, 노드 브리지는 글루만 얹는다. 이 파사드를
 * esbuild IIFE(`NexyTopo` 전역)로 번들해 `occt-worker/topo-naming.bundle.js`
 * 로 내보낸다(`npm run build:worker-topo`).
 *
 * S2+에서 워커 프로토콜(edgeNames 왕복)·피처 파라미터 이중화가 이 표면 위에
 * 올라간다 — 노드 경로(nodeOcctBridge)와 **단일 소스**라 규약이 갈릴 수 없다.
 */
export {
  buildExtrudeTopo,
  buildRevolveTopo,
  namesOf,
  edgeMidpoint,
  revolveEdgeAnchors,
} from './topoNaming';
export { nearestByMidpoint } from './edgeMatch';
export {
  composeBooleanTopo,
  fromAnchors,
  qualifyName,
} from './composedTopo';
