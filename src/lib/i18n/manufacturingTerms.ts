import { toIsoLang, type IsoLang } from './normalize';

export type ManufacturingCopy = Record<IsoLang, string>;

/**
 * Display-only manufacturing vocabulary. API values remain stable identifiers;
 * callers should pass the raw value here only when rendering a label.
 */
const TERMS: Record<string, ManufacturingCopy> = {
  bracket: { ko: '브래킷', en: 'Bracket', ja: 'ブラケット', zh: '支架', es: 'Soporte', ar: 'حامل' },
  'gear housing': { ko: '기어 하우징', en: 'Gear Housing', ja: 'ギアハウジング', zh: '齿轮箱体', es: 'Carcasa de engranaje', ar: 'هيكل التروس' },
  shaft: { ko: '샤프트', en: 'Shaft', ja: 'シャフト', zh: '轴', es: 'Eje', ar: 'عمود' },
  'cover plate': { ko: '커버 플레이트', en: 'Cover Plate', ja: 'カバープレート', zh: '盖板', es: 'Placa de cubierta', ar: 'لوحة الغطاء' },
  flange: { ko: '플랜지', en: 'Flange', ja: 'フランジ', zh: '法兰', es: 'Brida', ar: 'شفة' },
  steel: { ko: '강철', en: 'Steel', ja: '鋼', zh: '钢', es: 'Acero', ar: 'فولاذ' },
  'aluminum 6061': { ko: '알루미늄 6061', en: 'Aluminum 6061', ja: 'アルミニウム6061', zh: '6061铝', es: 'Aluminio 6061', ar: 'ألمنيوم 6061' },
  aluminum_7075: { ko: '알루미늄 7075', en: 'Aluminum 7075', ja: 'アルミニウム7075', zh: '7075铝', es: 'Aluminio 7075', ar: 'ألمنيوم 7075' },
  aluminum: { ko: '알루미늄', en: 'Aluminum', ja: 'アルミニウム', zh: '铝', es: 'Aluminio', ar: 'ألمنيوم' },
  'stainless steel': { ko: '스테인리스강', en: 'Stainless Steel', ja: 'ステンレス鋼', zh: '不锈钢', es: 'Acero inoxidable', ar: 'فولاذ مقاوم للصدأ' },
  hdpe: { ko: 'HDPE', en: 'HDPE', ja: 'HDPE', zh: 'HDPE', es: 'HDPE', ar: 'HDPE' },
  titanium: { ko: '티타늄', en: 'Titanium', ja: 'チタン', zh: '钛', es: 'Titanio', ar: 'تيتانيوم' },
  steel_s45c: { ko: 'S45C 강', en: 'S45C Steel', ja: 'S45C鋼', zh: 'S45C钢', es: 'Acero S45C', ar: 'فولاذ S45C' },
  stainless_304: { ko: '스테인리스 304', en: 'Stainless Steel 304', ja: 'ステンレス304', zh: '304不锈钢', es: 'Acero inoxidable 304', ar: 'فولاذ مقاوم للصدأ 304' },
  abs_plastic: { ko: 'ABS 플라스틱', en: 'ABS Plastic', ja: 'ABS樹脂', zh: 'ABS塑料', es: 'Plástico ABS', ar: 'بلاستيك ABS' },
  steel_mild: { ko: '일반 강재', en: 'Mild Steel', ja: '軟鋼', zh: '低碳钢', es: 'Acero dulce', ar: 'فولاذ منخفض الكربون' },
  pla: { ko: 'PLA 플라스틱', en: 'PLA Plastic', ja: 'PLA樹脂', zh: 'PLA塑料', es: 'Plástico PLA', ar: 'بلاستيك PLA' },
  nylon: { ko: '나일론', en: 'Nylon', ja: 'ナイロン', zh: '尼龙', es: 'Nailon', ar: 'نايلون' },
  other: { ko: '기타', en: 'Other', ja: 'その他', zh: '其他', es: 'Otro', ar: 'أخرى' },
  cnc_milling: { ko: 'CNC 밀링', en: 'CNC Milling', ja: 'CNCフライス加工', zh: 'CNC铣削', es: 'Fresado CNC', ar: 'تفريز CNC' },
  cnc_turning: { ko: 'CNC 선삭', en: 'CNC Turning', ja: 'CNC旋盤加工', zh: 'CNC车削', es: 'Torneado CNC', ar: 'خراطة CNC' },
  injection_molding: { ko: '사출 성형', en: 'Injection Molding', ja: '射出成形', zh: '注塑成型', es: 'Moldeo por inyección', ar: 'القولبة بالحقن' },
  sheet_metal: { ko: '판금', en: 'Sheet Metal', ja: '板金', zh: '钣金', es: 'Chapa metálica', ar: 'صفائح معدنية' },
  casting: { ko: '주조', en: 'Casting', ja: '鋳造', zh: '铸造', es: 'Fundición', ar: 'سباكة' },
  '3d_printing': { ko: '3D 프린팅', en: '3D Printing', ja: '3Dプリント', zh: '3D打印', es: 'Impresión 3D', ar: 'طباعة ثلاثية الأبعاد' },
  fdm_3d_printing: { ko: 'FDM 3D 프린팅', en: 'FDM 3D Printing', ja: 'FDM 3Dプリント', zh: 'FDM 3D打印', es: 'Impresión 3D FDM', ar: 'طباعة ثلاثية الأبعاد FDM' },
  sls_3d_printing: { ko: 'SLS 3D 프린팅', en: 'SLS 3D Printing', ja: 'SLS 3Dプリント', zh: 'SLS 3D打印', es: 'Impresión 3D SLS', ar: 'طباعة ثلاثية الأبعاد SLS' },
  sand_casting: { ko: '사형 주조', en: 'Sand Casting', ja: '砂型鋳造', zh: '砂型铸造', es: 'Fundición en arena', ar: 'السباكة الرملية' },
  ISO9001: { ko: 'ISO 9001', en: 'ISO 9001', ja: 'ISO 9001', zh: 'ISO 9001', es: 'ISO 9001', ar: 'ISO 9001' },
  AS9100: { ko: 'AS9100 (항공우주)', en: 'AS9100 (Aerospace)', ja: 'AS9100（航空宇宙）', zh: 'AS9100（航空航天）', es: 'AS9100 (Aeroespacial)', ar: 'AS9100 (الطيران والفضاء)' },
  IATF16949: { ko: 'IATF 16949 (자동차)', en: 'IATF 16949 (Automotive)', ja: 'IATF 16949（自動車）', zh: 'IATF 16949（汽车）', es: 'IATF 16949 (Automoción)', ar: 'IATF 16949 (السيارات)' },
  ISO13485: { ko: 'ISO 13485 (의료)', en: 'ISO 13485 (Medical)', ja: 'ISO 13485（医療）', zh: 'ISO 13485（医疗）', es: 'ISO 13485 (Médico)', ar: 'ISO 13485 (الأجهزة الطبية)' },
  ISO14001: { ko: 'ISO 14001 (환경)', en: 'ISO 14001 (Environmental)', ja: 'ISO 14001（環境）', zh: 'ISO 14001（环境）', es: 'ISO 14001 (Ambiental)', ar: 'ISO 14001 (بيئي)' },
  OHSAS18001: { ko: 'OHSAS 18001 (안전)', en: 'OHSAS 18001 (Safety)', ja: 'OHSAS 18001（安全）', zh: 'OHSAS 18001（安全）', es: 'OHSAS 18001 (Seguridad)', ar: 'OHSAS 18001 (السلامة)' },
  RoHS: { ko: 'RoHS 준수', en: 'RoHS Compliant', ja: 'RoHS準拠', zh: '符合 RoHS', es: 'Conforme con RoHS', ar: 'متوافق مع RoHS' },
  REACH: { ko: 'REACH 준수', en: 'REACH Compliant', ja: 'REACH準拠', zh: '符合 REACH', es: 'Conforme con REACH', ar: 'متوافق مع REACH' },
  die_casting: { ko: '다이캐스팅', en: 'Die Casting', ja: 'ダイカスト', zh: '压铸', es: 'Fundición a presión', ar: 'الصب بالضغط' },
  forging: { ko: '단조', en: 'Forging', ja: '鍛造', zh: '锻造', es: 'Forja', ar: 'طرق' },
  welding: { ko: '용접', en: 'Welding', ja: '溶接', zh: '焊接', es: 'Soldadura', ar: 'لحام' },
  laser_cutting: { ko: '레이저 절단', en: 'Laser Cutting', ja: 'レーザー切断', zh: '激光切割', es: 'Corte láser', ar: 'القطع بالليزر' },
  painting: { ko: '도장', en: 'Painting', ja: '塗装', zh: '涂装', es: 'Pintura', ar: 'طلاء' },
  plating: { ko: '도금', en: 'Plating', ja: 'めっき', zh: '电镀', es: 'Galvanizado', ar: 'طلاء كهربائي' },
  'CNC가공': { ko: 'CNC가공', en: 'CNC Machining', ja: 'CNC加工', zh: 'CNC加工', es: 'Mecanizado CNC', ar: 'تشغيل CNC' },
  판금: { ko: '판금', en: 'Sheet Metal', ja: '板金', zh: '钣金', es: 'Chapa metálica', ar: 'صفائح معدنية' },
  사출성형: { ko: '사출성형', en: 'Injection Molding', ja: '射出成形', zh: '注塑成型', es: 'Moldeo por inyección', ar: 'القولبة بالحقن' },
  도장: { ko: '도장', en: 'Painting', ja: '塗装', zh: '涂装', es: 'Pintura', ar: 'طلاء' },
  '3D프린팅': { ko: '3D프린팅', en: '3D Printing', ja: '3Dプリント', zh: '3D打印', es: 'Impresión 3D', ar: 'طباعة ثلاثية الأبعاد' },
  레이저가공: { ko: '레이저가공', en: 'Laser Cutting', ja: 'レーザー加工', zh: '激光加工', es: 'Corte láser', ar: 'قطع بالليزر' },
  자동차: { ko: '자동차', en: 'Automotive', ja: '自動車', zh: '汽车', es: 'Automoción', ar: 'السيارات' },
  '전자/반도체': { ko: '전자/반도체', en: 'Electronics / Semiconductor', ja: '電子・半導体', zh: '电子/半导体', es: 'Electrónica / Semiconductores', ar: 'الإلكترونيات / أشباه الموصلات' },
  의료기기: { ko: '의료기기', en: 'Medical Devices', ja: '医療機器', zh: '医疗器械', es: 'Dispositivos médicos', ar: 'الأجهزة الطبية' },
  항공우주: { ko: '항공우주', en: 'Aerospace', ja: '航空宇宙', zh: '航空航天', es: 'Aeroespacial', ar: 'الطيران والفضاء' },
  '일반 제조': { ko: '일반 제조', en: 'General Manufacturing', ja: '一般製造', zh: '通用制造', es: 'Manufactura general', ar: 'التصنيع العام' },
  'cnc 가공': { ko: 'CNC 가공', en: 'CNC Machining', ja: 'CNC加工', zh: 'CNC加工', es: 'Mecanizado CNC', ar: 'تشغيل CNC' },
  '사출금형': { ko: '사출금형', en: 'Injection Mold', ja: '射出金型', zh: '注塑模具', es: 'Molde de inyección', ar: 'قالب حقن' },
  '배전반': { ko: '배전반', en: 'Distribution Board', ja: '配電盤', zh: '配电盘', es: 'Cuadro eléctrico', ar: 'لوحة توزيع' },
  '자동차부품': { ko: '자동차부품', en: 'Auto Parts', ja: '自動車部品', zh: '汽车零部件', es: 'Autopartes', ar: 'قطع غيار السيارات' },
  '도금': { ko: '도금', en: 'Plating', ja: 'めっき', zh: '电镀', es: 'Galvanizado', ar: 'طلاء' },
  '볼 밸브': { ko: '볼 밸브', en: 'Ball Valve', ja: 'ボールバルブ', zh: '球阀', es: 'Válvula de bola', ar: 'صمام كروي' },
  '태양광 브래킷': { ko: '태양광 브래킷', en: 'Solar Bracket', ja: '太陽光ブラケット', zh: '光伏支架', es: 'Soporte solar', ar: 'حامل شمسي' },
  '펌프': { ko: '펌프', en: 'Pump', ja: 'ポンプ', zh: '泵', es: 'Bomba', ar: 'مضخة' },
  '알루미늄': { ko: '알루미늄', en: 'Aluminum', ja: 'アルミニウム', zh: '铝', es: 'Aluminio', ar: 'ألمنيوم' },
  '기어': { ko: '기어', en: 'Gear', ja: 'ギア', zh: '齿轮', es: 'Engranaje', ar: 'ترس' },
  assigned: { ko: '배정됨', en: 'Assigned', ja: '割り当て済み', zh: '已分配', es: 'Asignado', ar: 'مُسند' },
  quoted: { ko: '견적 제출', en: 'Quoted', ja: '見積済み', zh: '已报价', es: 'Cotizado', ar: 'تم التسعير' },
  contracted: { ko: '계약됨', en: 'Contracted', ja: '契約済み', zh: '已签约', es: 'Contratado', ar: 'متعاقد عليه' },
  completed: { ko: '완료', en: 'Completed', ja: '完了', zh: '已完成', es: 'Completado', ar: 'مكتمل' },
  in_progress: { ko: '진행 중', en: 'In Progress', ja: '進行中', zh: '进行中', es: 'En curso', ar: 'قيد التنفيذ' },
  quality_check: { ko: '품질 검사', en: 'Quality Check', ja: '品質検査', zh: '质量检查', es: 'Control de calidad', ar: 'فحص الجودة' },
  rejected: { ko: '거절됨', en: 'Rejected', ja: '却下', zh: '已拒绝', es: 'Rechazado', ar: 'مرفوض' },
  cancelled: { ko: '취소됨', en: 'Cancelled', ja: 'キャンセル', zh: '已取消', es: 'Cancelado', ar: 'ملغى' },
};

const TERM_ALIASES: Record<string, string> = {
  cnc: 'cnc 가공',
  'cnc machining': 'cnc 가공',
  injection: 'injection_molding',
  'injection molding': 'injection_molding',
  'sheet metal': 'sheet_metal',
  sheetmetal: 'sheet_metal',
  '3d print': '3d_printing',
  '3d printing': '3d_printing',
  'fdm 3d printing': 'fdm_3d_printing',
  'sls 3d printing': 'sls_3d_printing',
  'sand casting': 'sand_casting',
  'aluminum 7075': 'aluminum_7075',
  aluminum_6061: 'aluminum 6061',
  'mild steel': 'steel_mild',
  steel_stainless: 'stainless steel',
  abs: 'abs_plastic',
  'laser cutting': 'laser_cutting',
  automotive: '자동차',
  'electronics / semiconductor': '전자/반도체',
  'electronics/semiconductor': '전자/반도체',
  'medical devices': '의료기기',
  aerospace: '항공우주',
  'general manufacturing': '일반 제조',
  'cnc가공': 'CNC가공',
  '3d프린팅': '3D프린팅',
};

const NORMALIZED_KEYS: Record<string, string> = Object.keys(TERMS).reduce((result, key) => {
  const normalized = key.trim().toLowerCase().replace(/\s+/g, ' ');
  result[normalized] = key;
  result[normalized.replace(/[\s-]+/g, '_')] = key;
  return result;
}, {} as Record<string, string>);

function keyFor(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, ' ');
  const alias = TERM_ALIASES[normalized] ?? TERM_ALIASES[normalized.replace(/[\s-]+/g, '_')];
  return NORMALIZED_KEYS[alias ?? normalized]
    ?? NORMALIZED_KEYS[(alias ?? normalized).replace(/[\s-]+/g, '_')]
    ?? (alias ?? normalized).replace(/[\s-]+/g, '_');
}

export function manufacturingTerm(value: string | null | undefined, lang: string | undefined | null): string {
  if (!value) return '';
  const copy = TERMS[keyFor(value)];
  return copy?.[toIsoLang(lang)] ?? value;
}

export const MANUFACTURING_REGION_LABELS: Record<string, ManufacturingCopy> = {
  KR: { ko: '🇰🇷 한국', en: '🇰🇷 South Korea', ja: '🇰🇷 韓国', zh: '🇰🇷 韩国', es: '🇰🇷 Corea del Sur', ar: '🇰🇷 كوريا الجنوبية' },
  CN: { ko: '🇨🇳 중국', en: '🇨🇳 China', ja: '🇨🇳 中国', zh: '🇨🇳 中国', es: '🇨🇳 China', ar: '🇨🇳 الصين' },
  US: { ko: '🇺🇸 미국', en: '🇺🇸 United States', ja: '🇺🇸 米国', zh: '🇺🇸 美国', es: '🇺🇸 Estados Unidos', ar: '🇺🇸 الولايات المتحدة' },
  JP: { ko: '🇯🇵 일본', en: '🇯🇵 Japan', ja: '🇯🇵 日本', zh: '🇯🇵 日本', es: '🇯🇵 Japón', ar: '🇯🇵 اليابان' },
  DE: { ko: '🇩🇪 독일', en: '🇩🇪 Germany', ja: '🇩🇪 ドイツ', zh: '🇩🇪 德国', es: '🇩🇪 Alemania', ar: '🇩🇪 ألمانيا' },
  VN: { ko: '🇻🇳 베트남', en: '🇻🇳 Vietnam', ja: '🇻🇳 ベトナム', zh: '🇻🇳 越南', es: '🇻🇳 Vietnam', ar: '🇻🇳 فيتنام' },
  TW: { ko: '🇹🇼 대만', en: '🇹🇼 Taiwan', ja: '🇹🇼 台湾', zh: '🇹🇼 台湾', es: '🇹🇼 Taiwán', ar: '🇹🇼 تايوان' },
  TH: { ko: '🇹🇭 태국', en: '🇹🇭 Thailand', ja: '🇹🇭 タイ', zh: '🇹🇭 泰国', es: '🇹🇭 Tailandia', ar: '🇹🇭 تايلاند' },
  IN: { ko: '🇮🇳 인도', en: '🇮🇳 India', ja: '🇮🇳 インド', zh: '🇮🇳 印度', es: '🇮🇳 India', ar: '🇮🇳 الهند' },
  MALAYSIA: { ko: '말레이시아', en: 'Malaysia', ja: 'マレーシア', zh: '马来西亚', es: 'Malasia', ar: 'ماليزيا' },
  INDONESIA: { ko: '인도네시아', en: 'Indonesia', ja: 'インドネシア', zh: '印度尼西亚', es: 'Indonesia', ar: 'إندونيسيا' },
  PHILIPPINES: { ko: '필리핀', en: 'Philippines', ja: 'フィリピン', zh: '菲律宾', es: 'Filipinas', ar: 'الفلبين' },
  SINGAPORE: { ko: '싱가포르', en: 'Singapore', ja: 'シンガポール', zh: '新加坡', es: 'Singapur', ar: 'سنغافورة' },
  THAILAND: { ko: '태국', en: 'Thailand', ja: 'タイ', zh: '泰国', es: 'Tailandia', ar: 'تايلاند' },
  VIETNAM: { ko: '베트남', en: 'Vietnam', ja: 'ベトナム', zh: '越南', es: 'Vietnam', ar: 'فيتنام' },
  CHINA: { ko: '중국', en: 'China', ja: '中国', zh: '中国', es: 'China', ar: 'الصين' },
  'SOUTH KOREA': { ko: '대한민국', en: 'South Korea', ja: '韓国', zh: '韩国', es: 'Corea del Sur', ar: 'كوريا الجنوبية' },
  JAPAN: { ko: '일본', en: 'Japan', ja: '日本', zh: '日本', es: 'Japón', ar: 'اليابان' },
  INDIA: { ko: '인도', en: 'India', ja: 'インド', zh: '印度', es: 'India', ar: 'الهند' },
  OTHER: { ko: '기타', en: 'Other', ja: 'その他', zh: '其他', es: 'Otro', ar: 'أخرى' },
};

export function manufacturingRegion(code: string | null | undefined, lang: string | undefined | null): string {
  if (!code) return '';
  return MANUFACTURING_REGION_LABELS[code.toUpperCase()]?.[toIsoLang(lang)] ?? code;
}
