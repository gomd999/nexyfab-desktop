/**
 * DesignInner.tsx의 채팅 프롬프트 예시 문구 — 6언어 지역화 레코드.
 *
 * ⚠ 260802: 예전에는 DesignInner.tsx 안에 EXAMPLES_KO/EXAMPLES_EN 두 배열을 두고
 * `ko ? A : B` 로 골랐다 — ja·zh·es·ar 사용자에게도 영어(en) 배열이 그대로 나갔다
 * (simulator RISK_SCENARIOS·EasyWizard CATEGORIES 와 동일한 결함 패턴, loc() 미사용).
 * 6언어 레코드 배열로 합치고 loc()으로 배선한다. 별도 파일로 뺀 이유: DesignInner.tsx는
 * three.js/wasm 렌더러까지 끌고 들어오는 무거운 모듈이라, 문자열 회귀 테스트가 그 전체를
 * import하지 않도록 분리했다.
 */
export interface ExampleI18n { ko: string; en: string; ja: string; zh: string; es: string; ar: string }

export const EXAMPLES: ExampleI18n[] = [
  {
    ko: '내경 500mm 원통형 물탱크, 높이 800mm, 벽두께 5mm, 바닥에 원뿔형 배출구(45도), 중앙에 지름 25mm 교반축',
    en: 'Cylindrical water tank, 500mm inner dia, 800mm tall, 5mm wall, conical drain (45deg) at bottom, 25mm central agitator shaft',
    ja: '内径500mmの円筒形水タンク、高さ800mm、壁厚5mm、底に円錐形排出口(45度)、中央に直径25mmの撹拌軸',
    zh: '内径500mm的圆柱形水箱，高800mm，壁厚5mm，底部有锥形排放口(45度)，中心有直径25mm的搅拌轴',
    es: 'Tanque de agua cilíndrico de 500 mm de diámetro interior, 800 mm de altura, pared de 5 mm, salida cónica (45°) en la base, eje agitador central de 25 mm',
    ar: 'خزان مياه أسطواني بقطر داخلي 500 مم، ارتفاع 800 مم، سماكة جدار 5 مم، مخرج مخروطي (45 درجة) في القاع، عمود تحريك مركزي بقطر 25 مم',
  },
  {
    ko: '가로 300 세로 200 두께 12 알루미늄 플레이트, 네 모서리에 지름 8 볼트홀, 중앙에 지름 40 관통',
    en: 'Aluminium plate 300 x 200 x 12, 8mm bolt holes at four corners, 40mm through-hole in the middle',
    ja: '幅300×奥行200×厚さ12のアルミプレート、四隅に直径8のボルト穴、中央に直径40の貫通穴',
    zh: '300×200×12的铝板，四角有直径8的螺栓孔，中心有直径40的通孔',
    es: 'Placa de aluminio de 300 x 200 x 12, orificios para pernos de 8 mm en las cuatro esquinas, orificio pasante de 40 mm en el centro',
    ar: 'لوح ألمنيوم 300×200×12، ثقوب براغي بقطر 8 مم في الزوايا الأربع، ثقب نافذ بقطر 40 مم في المنتصف',
  },
  {
    ko: 'L자 브래킷, 다리 각 80mm, 두께 6, 각 면에 지름 6 홀 2개',
    en: 'L-bracket, 80mm legs, 6mm thick, two 6mm holes per face',
    ja: 'L字ブラケット、脚それぞれ80mm、厚さ6、各面に直径6の穴2個',
    zh: 'L形支架，每边80mm，厚度6，每面有2个直径6的孔',
    es: 'Escuadra en L, brazos de 80 mm, espesor de 6 mm, dos orificios de 6 mm por cara',
    ar: 'قوس على شكل L، أذرع 80 مم، سماكة 6 مم، ثقبان بقطر 6 مم في كل وجه',
  },
];
