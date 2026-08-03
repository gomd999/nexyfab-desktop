/**
 * 이미지 → 파라메트릭 프리셋 매칭 (전 분야 도면→3D, 2026-07-16).
 *
 * 기계 전용 extract.mjs(11종 부품 어휘)와 달리, 분야별 프리셋 템플릿 카탈로그를
 * 프롬프트에 넣어 "어느 템플릿인지 + 읽을 수 있는 치수"만 추출한다.
 * 원칙: AI는 이해만 — 값 검증(허용 파라미터·min/max 클램프)과 형상 생성은
 * 결정론 층(라우트 + preset-registry)이 담당. 이미지에 없는 값은 생략(기본값 사용).
 */
import { apiKey, repairJsonNumbers } from './extract.mjs';

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    templateId: { type: 'STRING' },
    confidence: { type: 'NUMBER' },
    unit: { type: 'STRING' },
    notes: { type: 'STRING' },
    /**
     * ★260803 — 템플릿이 안 맞아도(`templateId:'none'`) **막다른 길이 되지 않게** 하는 열쇠.
     * 부품 단위 서술을 받아 두면 호출부가 `textToAssembly` 로 넘겨 조립체를 만들 수 있다.
     * ⚠ 여기 **스키마에 없으면 프롬프트로 아무리 시켜도 조용히 떨어진다** — 260802 에
     *   `h_section`·`cone` 파라미터가 같은 이유로 통째로 사라진 전력이 있다.
     */
    description: { type: 'STRING' },
    params: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { name: { type: 'STRING' }, value: { type: 'NUMBER' } },
        required: ['name', 'value'],
      },
    },
  },
  required: ['templateId', 'confidence'],
};

function buildPrompt(domainLabel, templates) {
  const catalog = templates
    .map((t) => `- ${t.id} (${t.labelKo}): ` + t.params
      .map((p) => `${p.name}=${p.labelKo}[${p.unit || 'mm'}, ${p.min}~${p.max}, 기본 ${p.default}]`)
      .join(', '))
    .join('\n');
  return `아래는 ${domainLabel} 분야의 파라메트릭 템플릿 카탈로그다. 첨부 이미지(도면·스케치·사진)를 판독해
1) 가장 맞는 템플릿 1개를 골라 templateId에 넣고,
2) 이미지에서 읽을 수 있는 치수만 해당 템플릿의 파라미터 이름으로 params에 넣어라.

${catalog}

규칙:
- 치수선·주석에 인쇄된 숫자를 그대로 읽어라. 이미지에 없는 값은 추측하지 말고 생략하라(기본값이 채워진다).
- 값은 mm 기준으로 환산해 적고, 원본 단위는 unit에 기록하라.
- 어떤 템플릿에도 맞지 않으면 templateId='none'으로 하고 notes에 이유를 적어라.
- confidence는 템플릿 분류+치수 판독의 종합 신뢰도(0~1).
- notes에는 판독 근거와 불확실한 값을 한 줄로.

★ **description 은 templateId 와 무관하게 항상 채워라** (260803).
  이미지에 보이는 제품을 **부품 단위로** 한국어로 서술한다 — 부품 이름, 개수, 읽히는 치수,
  부품 간 결합(힌지·볼트·슬라이드) 순으로. 예:
  "노트북 거치대. 하부 베이스판 260×220 t6 1개, 수직 지지대 50×25×160 1개,
   상판 280×240 t4 1개(중앙 통풍구 180×130), 힌지 브래킷 50×35 t6 2개, 힌지축 ⌀8 2개."
  ⚠ 치수는 **이미지에서 읽히는 것만** 적는다. 안 보이면 부품 이름과 개수만 적고 치수는 생략한다
    — 지어낸 치수가 그대로 형상이 된다.
  ⚠ 템플릿이 맞아떨어져도 생략하지 마라. 조립체는 이 서술로만 만들 수 있다.`;
}

async function callGemini(img, mimeType, prompt, model) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey()}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ inline_data: { mime_type: mimeType, data: img } }, { text: prompt }] }],
      generationConfig: {
        temperature: 0,
        response_mime_type: 'application/json',
        response_schema: RESPONSE_SCHEMA,
        maxOutputTokens: 4096,
      },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  const text = j.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('empty response: ' + JSON.stringify(j).slice(0, 200));
  return text;
}

/**
 * @param {string} b64 base64 이미지(데이터URL 접두 없이)
 * @param {string} mime image/png|jpeg|webp
 * @param {string} domainLabel 사람이 읽는 분야명(프롬프트용)
 * @param {Array<{id:string,labelKo:string,params:Array<{name:string,labelKo:string,unit:string,default:number,min:number,max:number}>}>} templates
 * @returns {Promise<{templateId:string, confidence:number, unit?:string, notes?:string,
 *                    description?:string, params:Array<{name:string,value:number}>}>}
 *
 * ★260803 — `description` 추가. 템플릿 매칭이 실패해도(`templateId:'none'`) **막다른 길이 되지 않게**
 *   같은 호출에서 부품 서술을 받아 둔다. 호출부가 그 서술을 `textToAssembly` 로 넘겨 조립체를 만든다.
 *   ⚠ vision 호출을 **한 번만** 쓰기 위해 프롬프트에 합쳤다 — 실패 후 두 번째 호출을 하면
 *     비용과 지연이 두 배가 되고, 그때는 이미 사용자가 에러를 본 뒤다.
 */
export async function extractPresetFromImage(b64, mime, domainLabel, templates, { model = 'gemini-2.5-flash' } = {}) {
  const prompt = buildPrompt(domainLabel, templates);
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const text = await callGemini(b64, mime, prompt, model);
      try {
        return JSON.parse(text);
      } catch {
        return JSON.parse(repairJsonNumbers(text)); // 폭주 숫자 복구 후 재시도
      }
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error('extract-preset failed');
}
