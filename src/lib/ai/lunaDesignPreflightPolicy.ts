/** Pure complexity gate kept separate from server-only provider wiring. */
export function shouldRunLunaDesignPreflight(prompt: string): boolean {
  const text = prompt.trim();
  if (text.length < 12) return false;
  const complex = /assembly|sub-?assembly|nested|configuration|mate|gd&t|tolerance|multi[- ]?stage|gearbox|engine|turbine|manifold|system|조립|어셈블리|다단|메이트|공차|엔진|터빈|시스템|アセンブリ|多段|公差|装配|多级|公差|ensamblaje|multietapa|tolerancia|تجميع|متعدد|تفاوت/i;
  const ambiguous = /more detail|make it better|optimi[sz]e|figure it out|recommend|더 구체|개선해|최적화|알아서|추천|詳細|最適化|具体化|优化|具体|mejor|optimiza|detall|حسّن|تفصيل|اقترح/i;
  const simpleEdit = /^(?:make|set|change|increase|decrease|move|rotate|길이|직경|두께|각도|간격|이동|회전|변경|設定|変更|移動|旋转|更改|cambiar|mover|girar|غيّر|حرّك)/i;
  if (complex.test(text) || ambiguous.test(text)) return true;
  if (text.length >= 160) return true;
  return text.length >= 90 && !simpleEdit.test(text);
}
