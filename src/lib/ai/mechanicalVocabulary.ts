/** Canonical NexyFab mechanical vocabulary shared by prompt routing and checks. */
export type MechanicalVocabularyHit = {
  canonical: string;
  category: 'part' | 'feature' | 'assembly' | 'engineering';
  sourceTerms: string[];
  confidence: number;
};

type VocabularyEntry = Omit<MechanicalVocabularyHit, 'sourceTerms'> & { aliases: string[] };

export const MECHANICAL_VOCABULARY: readonly VocabularyEntry[] = [
  { canonical: 'plate', category: 'part', aliases: ['plate', '플레이트', '판재', '판', 'プレート', '板', 'placa'], confidence: 0.98 },
  { canonical: 'bracket', category: 'part', aliases: ['bracket', '브래킷', '브라켓', '지지대', 'soporte', 'escuadra', 'ブラケット', '支架'], confidence: 0.98 },
  { canonical: 'flange', category: 'part', aliases: ['flange', '플랜지', '플랜쥐', 'brida', 'フランジ', '法兰', 'شفة'], confidence: 0.98 },
  { canonical: 'tube', category: 'part', aliases: ['tube', 'pipe', '튜브', '파이프', '관', 'tubo', '管', 'أنبوب'], confidence: 0.96 },
  { canonical: 'casing', category: 'part', aliases: ['casing', 'housing', '케이싱', '하우징', '케이스', 'carcasa', '外壳', 'غلاف'], confidence: 0.94 },
  { canonical: 'shaft', category: 'part', aliases: ['shaft', '축', '샤프트', 'eje', '軸', '轴', 'عمود'], confidence: 0.98 },
  { canonical: 'blade', category: 'part', aliases: ['blade', '블레이드', '날개', 'pala', 'ブレード', '叶片', 'شفرة'], confidence: 0.96 },
  { canonical: 'hole', category: 'feature', aliases: ['hole', 'bore', '구멍', '홀', '보어', 'agujero', 'orificio', '穴', '孔', 'ثقب'], confidence: 0.96 },
  { canonical: 'annular_combustor', category: 'assembly', aliases: ['annular combustor', 'combustion chamber', '환형 연소기', '연소기', '연소실', 'cámara de combustión', '燃焼器', '燃烧室', 'غرفة الاحتراق'], confidence: 0.93 },
  { canonical: 'nozzle', category: 'part', aliases: ['nozzle', '노즐', 'boquilla', 'ノズル', '喷嘴', 'فوهة'], confidence: 0.98 },
  { canonical: 'mate', category: 'feature', aliases: ['mate', '구속', '메이트', '조립 구속'], confidence: 0.95 },
  { canonical: 'interference_check', category: 'engineering', aliases: ['interference', '간섭', '간섭 검사', '충돌 검사'], confidence: 0.95 },
];

const escaped = (value: string) => value.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&');
const entries = MECHANICAL_VOCABULARY
  .flatMap(entry => entry.aliases.map(alias => ({ entry, alias })))
  .sort((a, b) => b.alias.length - a.alias.length);

/** Normalize multilingual mechanical terms without changing dimensions or user prose. */
export function normalizeMechanicalVocabulary(text: string): { text: string; hits: MechanicalVocabularyHit[]; ambiguities: string[] } {
  if (!text.trim()) return { text, hits: [], ambiguities: [] };
  const hits = new Map<string, MechanicalVocabularyHit>();
  const ambiguities: string[] = [];
  for (const { entry, alias } of entries) {
    const boundary = /^[A-Za-z0-9 ]+$/.test(alias) ? '\\b' : '';
    const re = new RegExp(`${boundary}${escaped(alias)}${boundary}`, 'giu');
    if (!re.test(text)) continue;
    const previous = hits.get(entry.canonical);
    hits.set(entry.canonical, {
      canonical: entry.canonical,
      category: entry.category,
      sourceTerms: [...(previous?.sourceTerms ?? []), alias],
      confidence: entry.confidence,
    });
  }
  if (hits.has('casing') && hits.has('tube')) ambiguities.push('housing/casing and tube/pipe may need a face or diameter confirmation');
  const canonicalLine = [...hits.values()].map(hit => hit.canonical).join(', ');
  return { text, hits: [...hits.values()], ambiguities: canonicalLine ? ambiguities : [] };
}

export function mechanicalVocabularyPrompt(text: string): string {
  const normalized = normalizeMechanicalVocabulary(text);
  if (!normalized.hits.length) return '';
  const hitLine = normalized.hits.map(hit => `${hit.canonical} (${Math.round(hit.confidence * 100)}%)`).join(', ');
  const ambiguityLine = normalized.ambiguities.length ? ` Ambiguities: ${normalized.ambiguities.join('; ')}.` : '';
  return `[canonical vocabulary] ${hitLine}.${ambiguityLine} Preserve the user's dimensions and ask only for unresolved geometry. Never silently substitute a different canonical type.`;
}
