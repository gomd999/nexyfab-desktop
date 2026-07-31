import type { PromptDefinition } from './index';

// Whitelists are duplicated in /api/nexyfab/intent-from-image/route.ts and in
// scad-intent-from-nl.ts. Keep them in lock-step with intentToScad.ts coverage.
const SUPPORTED_SHAPES = [
  'box', 'cylinder', 'sphere', 'cone', 'torus', 'wedge', 'pipe', 'disk',
  'hexNut', 'washer', 'iBeam', 'lBracket', 'flange', 'bolt',
  'gear', 'threadedRod', 'roundedBox', 'screw', 'springCoil',
  'sweep', 'loft', 'fanBlade',
  'heatsink', 'manifold', 'turbine',
  'enclosure', 'tBeam', 'uChannel', 'zPurlin',
  'rackUnit', 'shelfBracket', 'hingedBracket', 'motorMount',
  'nameplate', 'phoneStand', 'coaster', 'wallHook', 'drawerKnob', 'planterPot',
];
const SUPPORTED_FEATURES = [
  'hole', 'fillet', 'chamfer', 'mirror', 'linearPattern', 'circularPattern',
  'scale', 'shell', 'thread', 'draft', 'twist', 'rotate',
];

const TEMPLATE = `You are a CAD intent extractor for NexyFab. Given an image of
a mechanical part (photo, sketch, screenshot, CAD render, hand drawing),
return ONLY a strict JSON object — no markdown, no commentary, no code fences.

ALLOWED shapeId values (pick exactly one): ${SUPPORTED_SHAPES.join(', ')}.

ALLOWED feature.type values: ${SUPPORTED_FEATURES.join(', ')}.

Common parameter keys (all in millimeters; pick those relevant to the chosen shape):
  box / roundedBox: width, height, depth
  cylinder:        diameter, height
  sphere:          diameter
  cone:            bottomDiameter, topDiameter, height
  torus:           majorDiameter, tubeDiameter
  wedge:           width, height, depth
  pipe:            outerDiameter, innerDiameter, length
  disk:            diameter, thickness
  hexNut:          acrossFlats, thickness, nominalDiameter
  washer:          outerDiameter, innerDiameter, thickness
  iBeam:           beamHeight, flangeWidth, webThickness, flangeThickness, length
  lBracket:        width, height, depth, thickness
  flange:          outerDiameter, innerDiameter, thickness, pcd, boltCount, boltDiameter
  bolt:            shaftDiameter, shaftLength, headHeight, headFlats
  gear:            teeth, module, thickness, pressureAngle, helical
  threadedRod:     diameter, length, pitch
  screw:           spec (e.g. "M8"), length, headType (hex/socket/flat/button), diameter
  springCoil:      coilDiameter, wireDiameter, turns, freeLength
  enclosure:       width, height, depth, wallThickness, lipHeight, lipInset
  tBeam:           flangeWidth, beamHeight, webThickness, flangeThickness, length
  uChannel:        width, height, webThickness, flangeThickness, length
  motorMount:      plateSize, thickness, boltCirclePitch, boltDiameter, centerBoreDiameter
  nameplate:       width, depth, thickness, border, borderHeight
  phoneStand:      width, thickness, baseDepth, backHeight, frontHeight, slotGap
  coaster:         diameter, thickness, rimHeight, rimWidth
  wallHook:        plateWidth, plateHeight, plateThickness, screwHoleDiameter, hookLength, hookDiameter, hookTipHeight
  drawerKnob:      knobDiameter, stemDiameter, stemHeight, boreDiameter
  planterPot:      topDiameter, bottomDiameter, height, wallThickness, drainDiameter

Common feature.params keys:
  hole:            diameter, x, y, z, depth
  fillet:          radius
  chamfer:         distance
  thread:          diameter, length, pitch, x, y, z
  linearPattern:   count, spacingX, spacingY, spacingZ
  circularPattern: count, totalAngle

RESPONSE FORMAT (single JSON object):
{
  "shapeId": "<one of the allowed values>",
  "params":  { <numeric values in mm> },
  "features": [ { "type": "<from list>", "params": { ... } }, ... ],
  "facets":  64,
  "dimensionSource": "callouts" | "inferred" | "mixed",
  "summary": "<one-sentence description of what you saw, including how you inferred scale>"
}

"dimensionSource" tells the caller whether the numbers are READ or GUESSED:
  "callouts" - every reported dimension came from a number printed on the image
  "inferred" - no dimension numbers were visible; all sizes come from apparent scale
  "mixed"    - some printed, some inferred
This is not optional and it is not a formality. Downstream code manufactures
parts from these numbers; "inferred" means "do not cut metal from this yet".

Hard rules:
- All dimensions in millimeters. If the image shows a ruler / dimension
  callouts, use them verbatim. Otherwise infer from apparent scale
  (a hand-sized bracket = 60-120mm long, a desk knob = 20-40mm, etc.)
  and NOTE the assumption inside "summary".
- PICTORIAL VIEWS ARE FORESHORTENED. If the part is drawn in 3D (isometric /
  axonometric / perspective / a photo taken at an angle), lengths along the two
  receding horizontal axes appear SHORTER than they are — typically ~0.5-0.6x.
  A circle in a horizontal plane appears as an ELLIPSE: its true diameter is the
  MAJOR (longest) axis, NOT the minor axis (~0.58x). Correct for this before
  reporting. Do not report the on-screen extent as the true length.
- If the image shows MORE THAN ONE distinct primitive part, return ONLY the
  LARGEST / most-prominent one. Do not try to compose an assembly.
- NEVER invent shapeId values or param keys not in the lists above.
- NEVER write OpenSCAD code — a deterministic generator handles that.

If you cannot identify a supported shape with reasonable confidence, return:
{ "error": "unsupported", "reason": "<one sentence>" }`;

const def: PromptDefinition = {
  id: 'imageIntentFromSketch.v1',
  // ⚠ 프롬프트 본문이 바뀌면 버전을 올린다 — 캐시 키에 들어가므로, 안 올리면
  //   옛 응답이 새 프롬프트의 결과인 척 돌아온다.
  version: '1.1.0',
  description: 'Extract a NexyFab CAD intent JSON from a photo / sketch / screenshot. Vision-only; whitelist-bounded.',
  template: TEMPLATE,
  defaults: {
    /**
     * ★260731 — **추출 과제에 온도를 주고 있었다.** 형제 경로(도면 추출 `extract.mjs`)는
     *   전부 `temperature: 0` 이다. 도면·스케치에서 치수를 읽는 일은 창작이 아니라 판독이고,
     *   온도는 같은 그림에 다른 답을 만든다 — 실측에서도 회차마다 값이 흔들렸다.
     * ⚠ 재현되지 않는 출력은 **회귀를 잴 수 없게** 만든다. 좋아졌는지 나빠졌는지 모른다.
     */
    temperature: 0,
    /**
     * ★260731 — **500 은 출력이 아니라 「생각 + 출력」의 상한이었다.**
     *
     * 합성 픽토리얼 24장 첫 실측: **16장이 `NON_JSON`.** 원문 꼬리를 찍어 보니
     * ```
     *   ```json { "shapeId": "lBracket", "params":        ← 여기서 끊김
     * ```
     * 산문이 온 게 아니라 **중간에 잘렸다.** 실제 출력은 45자 남짓인데 상한 500 을
     * 넘겼다는 것은, `gemini-2.5-flash` 의 thinking 이 그 예산을 먼저 썼다는 뜻이다
     * (vision 계층은 `thinkingConfig` 를 보내지 않아 thinking 이 켜져 있다).
     *
     * ⚠ thinking 을 끄는 쪽은 이 저장소에 부작용 이력이 있다(`extract.mjs`: 끄니
     *   degenerate float 발생). 그래서 **위험 없는 쪽인 상한부터** 올린다.
     * ⚠ 정당한 응답 자체는 작다(성공 케이스는 500 안에 들어왔다) — 상한을 올려도
     *   토큰이 그만큼 더 쓰이는 게 아니라, **생각할 자리를 준다.**
     *
     * 단계별 실측(lBracket 4장 — 원래 0/4 측정):
     * ```
     *    500 →  0/4   끊긴 자리: "params":      ← 파라미터도 못 냄
     *   2048 →  2/4   끊긴 자리: "summary":     ← 본체는 완성, 마지막 필드만 손실
     *   4096 →  4/4   완결
     * ```
     * 2048 에서 **끊긴 자리가 마지막 필드로 밀린 것**이 「생각이 예산을 쓴다」의 직접 증거다.
     */
    maxTokens: 4096,
    // 생각 시간이 늘어난 만큼 여유를 준다 — 상한만 올리고 시간을 안 주면 timeout 으로 옮겨간다.
    timeoutMs: 60_000,
  },
};

export default def;
