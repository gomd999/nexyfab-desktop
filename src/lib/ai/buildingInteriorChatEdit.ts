import type { BuildingInteriorEdit, BuildingInteriorModel } from './buildingInteriorDesign';

const propertyAliases: Record<string, string> = {
  '폭': 'widthMm', '너비': 'widthMm', width: 'widthMm',
  '높이': 'heightMm', height: 'heightMm',
  '깊이': 'depthMm', depth: 'depthMm',
  '창턱': 'sillMm', sill: 'sillMm',
  '반경': 'radiusMm', radius: 'radiusMm',
  '각도': 'angleDeg', angle: 'angleDeg',
  '두께': 'thicknessMm', thickness: 'thicknessMm',
  '난간높이': 'railingHeightMm', '난간 높이': 'railingHeightMm',
  '복도폭': 'widthMm', '복도 폭': 'widthMm',
  '유효높이': 'clearHeightMm', '유효 높이': 'clearHeightMm',
  '디딤판': 'treadMm', tread: 'treadMm',
  '챌판': 'riserMm', riser: 'riserMm',
  '총높이': 'totalRiseMm', '총 높이': 'totalRiseMm',
  '계단수': 'steps', '계단 수': 'steps', steps: 'steps',
  '루멘': 'lumens', lumens: 'lumens',
  '색온도': 'cctK', cct: 'cctK',
  '설치높이': 'mountingHeightMm', '설치 높이': 'mountingHeightMm',
};

/** Convert one explicit, selection-scoped Korean/English command into a typed edit. */
export function planBuildingInteriorChatEdit(model: BuildingInteriorModel, selectedObjectId: string, command: string): BuildingInteriorEdit {
  const selected = model.objects.find(object => object.id === selectedObjectId);
  if (!selected) throw new Error(`Unknown selected object ${selectedObjectId}.`);
  const text = command.trim().toLowerCase();
  const move = text.match(/(?:이동|move)\s*(?:x\s*)?(-?\d+(?:\.\d+)?)\s*[, ]+\s*(?:y\s*)?(-?\d+(?:\.\d+)?)\s*[, ]+\s*(?:z\s*)?(-?\d+(?:\.\d+)?)\s*(?:mm)?/i);
  if (move) return { kind: 'move', objectId: selectedObjectId, positionMm: [Number(move[1]), Number(move[2]), Number(move[3])] };
  for (const [alias, property] of Object.entries(propertyAliases).sort((a, b) => b[0].length - a[0].length)) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = text.match(new RegExp(`${escaped}\\s*(?:을|를|은|는|=|:)?\\s*(-?\\d+(?:\\.\\d+)?)`, 'i'));
    if (match) {
      const sized = selected.kind === 'room' || selected.kind === 'balcony';
      const resolved = sized && property === 'widthMm' ? 'sizeMm.0'
        : sized && property === 'depthMm' ? 'sizeMm.1'
          : sized && property === 'heightMm' ? 'sizeMm.2'
            : property;
      return { kind: 'set_property', objectId: selectedObjectId, property: resolved, value: Number(match[1]) };
    }
  }
  throw new Error('명확한 대상 속성과 수치가 필요합니다. 예: “복도 폭 1800”, “조명 루멘 3200”, “이동 100, 200, 0”.');
}
