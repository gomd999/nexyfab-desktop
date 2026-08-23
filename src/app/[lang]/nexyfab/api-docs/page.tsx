import { CALC_CATALOG } from '@/app/api/eng-chat/calcCatalog';
import { createCommercialLocalizer } from '@/lib/i18n/commercialLocalizer';

export const dynamic = 'force-static';

const ENG_API = 'https://nexyfab-eng-api.gomd999.workers.dev';

export default async function ApiDocsPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  const L = createCommercialLocalizer(lang);
  const domains = new Map<string, number>();
  for (const c of CALC_CATALOG) domains.set(c.domain.split('/')[0], (domains.get(c.domain.split('/')[0]) ?? 0) + 1);
  return (
    <main className="max-w-3xl mx-auto px-4 py-10 space-y-6">
      <h1 className="text-2xl font-bold">{L('NexyFab 엔지니어링 API', 'NexyFab Engineering API')}</h1>
      <p className="text-sm text-slate-600 dark:text-slate-300">
        {L(`결정론 계산 엔진 ${CALC_CATALOG.length}종(KDS 원문 계수·공표예제 재현 게이트)을 REST로 호출합니다. AI 에이전트의 function-calling 도구로 바로 연결할 수 있도록 JSON Schema를 제공합니다.`, `${CALC_CATALOG.length} deterministic calculators (KDS-verified coefficients, published-example gates) over REST, with JSON Schemas ready for AI function-calling.`)}
      </p>
      <section className="space-y-2">
        <h2 className="font-bold">{L('엔드포인트', 'Endpoints')}</h2>
        <table className="text-sm w-full border-collapse">
          <tbody>
            {[
              ['GET /v1/calculators', L('계산기 목록+JSON Schema (도구 스펙 자동생성)', 'Catalog + JSON Schema')],
              ['POST /v1/calc/{id}', L('{ input, standard? } → verdict·checks·근거 조항', '{ input, standard? } → verdict, checks, code refs')],
              ['POST /v1/demo/calc/{id}', L('공개 데모 (IP당 30회/일 — 키 불필요)', 'Public demo (30/day per IP, no key)')],
              ['POST /v1/rag/search', L('KDS·공표문헌 조항 검색 (bge-m3)', 'Code clause search')],
              ['POST /v1/quantity/takeoff', L('수량산출(BOQ — 산식 공개)', 'Quantity takeoff (open basis)')],
            ].map(([ep, desc]) => (
              <tr key={ep}><td className="border border-slate-200 dark:border-slate-700 px-2 py-1 font-mono text-xs whitespace-nowrap">{ep}</td><td className="border border-slate-200 dark:border-slate-700 px-2 py-1">{desc}</td></tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-slate-500">{L(`인증: Authorization: Bearer nxk_… (키 발급 문의: nexyfab@nexysys.com). 베이스: ${ENG_API}`, `Auth: Bearer nxk_… (contact nexyfab@nexysys.com). Base: ${ENG_API}`)}</p>
      </section>
      <section className="space-y-2">
        <h2 className="font-bold">{L('예시 — 말뚝 지지력', 'Example — pile capacity')}</h2>
        <pre className="text-[11px] bg-slate-100 dark:bg-slate-800 rounded-lg p-3 overflow-x-auto">{`curl -X POST ${ENG_API}/v1/demo/calc/pile_capacity \\
  -H "Content-Type: application/json" \\
  -d '{"input":{"dia_m":0.5,"length_m":15,
       "layers":[{"thick_m":15,"type":"clay","Su_kPa":50,"alpha":0.9}],
       "tip":{"type":"clay","Su_kPa":50},"demandP_kN":350}}'`}</pre>
      </section>
      <section className="space-y-1">
        <h2 className="font-bold">{L('계산기 분야', 'Domains')}</h2>
        <p className="text-sm">{Array.from(domains.entries()).map(([d, n]) => `${d} ${n}`).join(' · ')}</p>
        <details className="text-xs">
          <summary className="cursor-pointer text-slate-500">{L('전체 목록', 'Full list')}</summary>
          <ul className="columns-2 mt-1">{CALC_CATALOG.map((c) => <li key={c.id} className="font-mono">{c.id}</li>)}</ul>
        </details>
      </section>
      <p className="text-xs text-amber-700 dark:text-amber-400">
        {L('모든 결과는 구조 검토 참고자료(비법정)이며 근거 조항·검증 상태·가정을 응답에 포함합니다. 법정 계산서는 기술사 날인 영역입니다. KDS 인용은 공공누리 제1유형(출처표시)을 따릅니다.', 'All outputs are non-statutory reference material with code refs, verification status and assumptions embedded. Statutory documents require a licensed engineer.')}
      </p>
    </main>
  );
}
