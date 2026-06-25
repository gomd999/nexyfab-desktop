/**
 * shapeAliases — multilingual synonym glossary for the NL→SCAD intent prompt.
 *
 * The `scad-intent-from-nl` prompt is English-only, so non-English shape words
 * ("원통", "円筒", "圆柱", "cilindro", "أسطوانة") were mis-mapped (e.g. 원통→box).
 * NexyFab's modeler ships in 6 languages (en/ko/ja/zh/es/ar); this glossary
 * teaches the LLM to map a shape/feature word in ANY of them to the English
 * `shapeId` / `feature.type` the deterministic compiler expects.
 *
 * Single-sourced + drift-guarded: every key here must be a real
 * SUPPORTED_SHAPES / SUPPORTED_FEATURES entry (shapeAliases.test.ts). We do NOT
 * require every shape to have aliases — rare compound parts (zPurlin, rackUnit,
 * motorMount) are typically requested in English/loanwords, and the prompt's
 * "translate foreign terms to the closest allowed id" instruction covers the
 * long tail. We alias the common, translation-sensitive primitives, fasteners,
 * structural members, and ALL features (those are the frequent misses).
 *
 * Synonyms are flattened across languages (the model only needs to see the
 * foreign word near the id; it doesn't need per-language labels). English
 * synonyms are included too so colloquial English ("rod", "donut") also maps.
 */

/** shapeId → synonyms across en/ko/ja/zh/es/ar (+ common colloquialisms). */
export const SHAPE_ALIASES: Record<string, string[]> = {
  box: ['box', 'cube', 'block', 'rectangular', 'plate', '상자', '박스', '정육면체', '큐브', '직육면체', '판', '箱', 'ボックス', '立方体', 'キューブ', '直方体', '盒子', '箱体', '长方体', '平板', 'caja', 'cubo', 'bloque', 'placa', 'صندوق', 'مكعب', 'لوح'],
  cylinder: ['cylinder', 'rod', 'round bar', '원통', '실린더', '원기둥', '봉', '환봉', '円筒', 'シリンダー', '円柱', '丸棒', '圆柱', '圆柱体', '圆筒', '圆棒', 'cilindro', 'barra', 'varilla redonda', 'أسطوانة', 'اسطوانة', 'قضيب'],
  sphere: ['sphere', 'ball', 'globe', '구', '구체', '볼', '球', '球体', 'ボール', 'esfera', 'bola', 'كرة'],
  cone: ['cone', 'tapered', 'taper', '원뿔', '콘', '테이퍼', '円錐', 'コーン', 'テーパー', '圆锥', '锥体', 'cono', 'cónico', 'مخروط'],
  torus: ['torus', 'donut', 'doughnut', 'ring', '도넛', '토러스', '원환', '링', 'トーラス', 'ドーナツ', '円環', 'リング', '圆环', '环面', '甜甜圈', 'toro', 'dona', 'anillo', 'طارة', 'حلقة', 'دونات'],
  wedge: ['wedge', 'ramp', '쐐기', '웻지', '경사', 'くさび', 'ウェッジ', '楔', '楔形', '楔块', '斜块', 'cuña', 'rampa', 'إسفين'],
  pipe: ['pipe', 'tube', 'hollow cylinder', '관', '파이프', '튜브', '중공 원통', 'パイプ', '管', 'チューブ', '中空円筒', '管道', '管子', '空心圆柱', 'tubo', 'tubería', 'caño', 'أنبوب', 'ماسورة'],
  disk: ['disk', 'disc', 'round plate', '원판', '디스크', '원반', '円板', 'ディスク', '円盤', '圆盘', '圆板', '盘', 'disco', 'قرص'],
  hexNut: ['hex nut', 'nut', '육각너트', '너트', '六角ナット', 'ナット', '六角螺母', '螺母', '螺帽', 'tuerca', 'tuerca hexagonal', 'صامولة', 'صمولة'],
  washer: ['washer', '와셔', '워셔', 'ワッシャー', '座金', '垫圈', '垫片', 'arandela', 'حلقة معدنية', 'وردة'],
  bolt: ['bolt', 'hex bolt', '볼트', '육각볼트', 'ボルト', '六角ボルト', '螺栓', '六角螺栓', 'perno', 'tornillo hexagonal', 'مسمار ملولب', 'برغي مسدس'],
  screw: ['screw', '나사', '스크류', '나사못', 'ねじ', 'ビス', 'スクリュー', '螺丝', '螺钉', 'tornillo', 'برغي', 'لولب'],
  gear: ['gear', 'cog', 'spur gear', '기어', '톱니바퀴', '평기어', '歯車', 'ギア', '平歯車', '齿轮', '直齿轮', 'engranaje', 'rueda dentada', 'piñón', 'ترس', 'مسنن'],
  flange: ['flange', '플랜지', '후렌지', 'フランジ', '法兰', '法兰盘', 'brida', 'شفة', 'فلنجة'],
  threadedRod: ['threaded rod', 'all-thread', 'stud', '전산볼트', '나사봉', '스터드', '환봉나사', '全ねじ', 'ねじ棒', 'スタッド', '寸切り', '螺纹杆', '全螺纹杆', '螺柱', 'varilla roscada', 'espárrago', 'قضيب ملولب'],
  springCoil: ['spring', 'coil spring', 'helical spring', '스프링', '코일', '코일 스프링', '용수철', 'ばね', 'バネ', 'スプリング', 'コイルばね', '弹簧', '螺旋弹簧', '线圈', 'resorte', 'muelle', 'زنبرك', 'نابض'],
  roundedBox: ['rounded box', 'rounded cube', '라운드 박스', '둥근 상자', '모깎기 상자', '角丸ボックス', '丸み箱', '圆角盒', '圆角立方体', 'caja redondeada', 'صندوق مدور'],
  iBeam: ['i-beam', 'h-beam', 'i beam', 'I형강', 'H형강', '아이빔', 'I形鋼', 'H形鋼', 'Iビーム', '工字钢', '工字梁', 'H型钢', 'viga en i', 'viga ipn', 'عارضة I'],
  tBeam: ['t-beam', 't beam', 'T형강', '티빔', 'T形鋼', 'Tビーム', 'T型梁', '丁字梁', 'viga en t', 'عارضة T'],
  uChannel: ['u-channel', 'channel', 'c-channel', 'ㄷ형강', '채널', 'U채널', '溝形鋼', 'Uチャンネル', 'チャンネル', '槽钢', 'U型槽', '槽形', 'perfil en u', 'canal', 'قناة U'],
  lBracket: ['l-bracket', 'angle bracket', 'angle iron', 'L브라켓', '앵글', 'ㄱ형강', 'Lブラケット', 'アングル', 'L字金具', 'L型支架', '角铁', '角码', 'escuadra', 'soporte en l', 'زاوية', 'حامل L'],
  enclosure: ['enclosure', 'housing', 'case', 'project box', '인클로저', '하우징', '케이스', '박스 케이스', '筐体', 'エンクロージャー', 'ケース', 'ハウジング', '外壳', '机箱', '壳体', '盒体', 'carcasa', 'alojamiento', 'حاوية', 'علبة'],
};

/** feature.type → synonyms across en/ko/ja/zh/es/ar. */
export const FEATURE_ALIASES: Record<string, string[]> = {
  hole: ['hole', 'bore', 'drill', '구멍', '홀', '穴', 'ホール', '孔', '洞', 'agujero', 'orificio', 'ثقب', 'فتحة'],
  fillet: ['fillet', 'round edge', 'rounding', '필렛', '모깎기', '라운드', 'フィレット', '角丸', '圆角', 'redondeo', 'filete', 'تدوير حواف'],
  chamfer: ['chamfer', 'bevel', '모따기', '챔퍼', '면취', '面取り', 'チャンファー', '倒角', 'chaflán', 'bisel', 'شطب', 'شطف'],
  mirror: ['mirror', 'symmetry', '대칭', '미러', '반전', 'ミラー', '鏡像', '反転', '镜像', 'espejo', 'simetría', 'انعكاس', 'مرآة'],
  linearPattern: ['linear pattern', 'linear array', 'row', '선형 배열', '직선 패턴', '일렬 복사', '直線パターン', '直線配列', '线性阵列', '直线阵列', 'patrón lineal', 'matriz lineal', 'نمط خطي'],
  circularPattern: ['circular pattern', 'circular array', 'radial pattern', '원형 배열', '원형 패턴', '회전 복사', '円形パターン', '円形配列', '圆形阵列', '环形阵列', 'patrón circular', 'matriz circular', 'نمط دائري'],
  scale: ['scale', 'resize', '크기 조절', '스케일', '배율', '拡大縮小', 'スケール', '缩放', '比例', 'escala', 'escalar', 'تحجيم', 'مقياس'],
  shell: ['shell', 'hollow', '쉘', '속 비우기', '중공', 'シェル', '中空', '殻', '抽壳', '壳', 'vaciado', 'cáscara', 'تجويف', 'قشرة'],
  thread: ['thread', 'threading', '나사산', '나사', 'ねじ山', 'ネジ', '螺纹', 'rosca', 'لولب', 'أسنان لولبية'],
  draft: ['draft', 'draft angle', '구배', '빼기구배', '드래프트', '抜き勾配', 'ドラフト', '拔模', '拔模斜度', 'ángulo de salida', 'desmoldeo', 'زاوية سحب'],
  twist: ['twist', '비틀기', '트위스트', '꼬임', 'ねじり', 'ツイスト', '扭曲', '扭转', 'torsión', 'retorcer', 'لي', 'التواء'],
  rotate: ['rotate', 'rotation', '회전', '돌리기', '回転', 'ローテーション', '旋转', 'rotar', 'girar', 'تدوير', 'دوران'],
};

/** Render the glossary as compact prompt lines: `id — syn, syn, …`. */
export function renderAliasGlossary(aliases: Record<string, string[]>): string {
  return Object.entries(aliases)
    .map(([id, syns]) => `  ${id} — ${syns.join(', ')}`)
    .join('\n');
}

// ─── Deterministic detection ────────────────────────────────────────────────
// The LLM is unreliable for non-English shape words (DeepSeek returns different
// answers by request region even at temperature 0). So we detect the shape from
// the glossary DETERMINISTICALLY server-side and override the LLM's shapeId,
// keeping the LLM only for params/features. Origin-independent + testable.

const ASCII_RE = /^[\x00-\x7F]*$/;
const CJK_LETTER = /[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

function isCjkLetter(ch: string | undefined): boolean {
  return !!ch && CJK_LETTER.test(ch);
}
function isAsciiWord(ch: string | undefined): boolean {
  return !!ch && /[a-z0-9]/i.test(ch);
}

/**
 * True when `syn` occurs in `text` as a standalone token (not glued to a longer
 * same-script word). ASCII matches need word boundaries ("rod" ∉ "rodent").
 * CJK: a 2+-char shape word is specific enough to match as a plain substring
 * (so a particle like の/的 in "の円筒"/"的圆柱" doesn't block it); only 1-char
 * CJK synonyms ("구", "球", "管") require non-CJK flanks so "구" ∉ "구멍".
 */
function tokenPresent(text: string, syn: string): boolean {
  const ascii = ASCII_RE.test(syn);
  let from = 0;
  for (;;) {
    const i = text.indexOf(syn, from);
    if (i < 0) return false;
    const before = i > 0 ? text[i - 1] : undefined;
    const after = i + syn.length < text.length ? text[i + syn.length] : undefined;
    const ok = ascii
      ? !isAsciiWord(before) && !isAsciiWord(after)
      : syn.length >= 2
        ? true
        : !isCjkLetter(before) && !isCjkLetter(after);
    if (ok) return true;
    from = i + 1;
  }
}

/**
 * Detect the part's shapeId from the raw prompt using the glossary. Returns the
 * matched shapeId, or null when nothing matches or the match is ambiguous
 * (multiple unrelated shapes — then the caller trusts the LLM).
 *
 * Disambiguation: among matched synonyms, the LONGEST wins (so "rounded box"
 * beats "box"). When two DIFFERENT shapes match with comparable-length synonyms
 * (neither clearly more specific), it's a genuine compound → return null.
 */
export function detectShapeFromText(prompt: string): string | null {
  // NFC-normalise both sides: Korean (and other) text can arrive decomposed
  // (NFD, e.g. from macOS) while the glossary literals are composed (NFC), and
  // `indexOf` is code-point exact — a mismatch silently yields no match.
  const text = prompt.normalize('NFC').toLowerCase();
  const matches: Array<{ shapeId: string; len: number }> = [];
  for (const [shapeId, syns] of Object.entries(SHAPE_ALIASES)) {
    let best = 0;
    for (const syn of syns) {
      const s = syn.normalize('NFC').toLowerCase();
      if (s.length > best && tokenPresent(text, s)) best = s.length;
    }
    if (best > 0) matches.push({ shapeId, len: best });
  }
  if (matches.length === 0) return null;
  matches.sort((a, b) => b.len - a.len);
  if (matches.length === 1) return matches[0]!.shapeId;
  // >1 shape matched: accept the longest only if it's clearly more specific
  // (≥2× the next different shape's synonym length), else treat as ambiguous.
  return matches[0]!.len >= matches[1]!.len * 2 ? matches[0]!.shapeId : null;
}
