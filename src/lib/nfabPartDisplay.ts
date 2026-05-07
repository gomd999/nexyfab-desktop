/**
 * M6 — 도면 타이틀·라벨용 표시 이름 ([M6_PART_ID_POLICY.md](../docs/strategy/M6_PART_ID_POLICY.md)).
 * 우선순위: PDM 부품번호 → 셰이프/디스플레이 라벨 → 클라우드 projectId 앞부분.
 */
export function getDrawingTitlePartName(input: {
  partNumber: string;
  shapeLabel: string;
  cloudProjectId?: string | null;
}): string {
  const pn = input.partNumber?.trim();
  if (pn) return pn;
  const sl = input.shapeLabel?.trim();
  if (sl) return sl;
  const id = input.cloudProjectId?.trim();
  if (id && id.length > 8) return `${id.slice(0, 8)}…`;
  if (id) return id;
  return '';
}
