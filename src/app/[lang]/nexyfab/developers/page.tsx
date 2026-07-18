/**
 * /nexyfab/developers — 외부 사용 가이드(API·CLI·MCP). Pro 이상 API 키 기준.
 * 정직 원칙: 실제 작동하는 사용법만 기재(목업·과장 금지). 산출물=비법정 명시.
 */
export const dynamic = 'force-static';

const CODE_STYLE: React.CSSProperties = {
  display: 'block', whiteSpace: 'pre', overflowX: 'auto', padding: '12px 14px', borderRadius: 10,
  background: '#0b1020', color: '#c8d3e8', fontSize: 12.5, lineHeight: 1.65, fontFamily: 'ui-monospace, monospace',
  border: '1px solid rgba(148,163,184,0.25)',
};

function Code({ children }: { children: string }) {
  return <code style={CODE_STYLE}>{children}</code>;
}

export default async function DevelopersPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  const ko = lang === 'kr';
  const H = ({ children }: { children: React.ReactNode }) => (
    <h2 style={{ fontSize: 19, fontWeight: 800, marginTop: 34, marginBottom: 8 }}>{children}</h2>
  );
  const P = ({ children }: { children: React.ReactNode }) => (
    <p style={{ fontSize: 13.5, lineHeight: 1.75, color: 'var(--nx-text-2, #46505e)', margin: '6px 0' }}>{children}</p>
  );
  return (
    <main style={{ maxWidth: 860, margin: '0 auto', padding: '48px 20px 80px' }}>
      <h1 style={{ fontSize: 27, fontWeight: 900 }}>{ko ? '개발자 가이드 — API · CLI · MCP' : 'Developers — API · CLI · MCP'}</h1>
      <P>
        {ko
          ? 'NexyFab 설계 파이프라인(텍스트→2D도안→3D 1차→2차→부품 단위 수정)을 HTTP API, MCP(Claude 등 AI 클라이언트), CLI로 사용할 수 있습니다. AI는 이해만 담당하고 형상 생성·검증(어휘·간섭·지지·구조 게이트)은 결정론 엔진이 수행합니다. 모든 산출물은 비법정(제작용 실시도서+검토 계산서)이며, 인허가 제출 도서는 유자격 기술사 날인 영역입니다.'
          : 'Use the NexyFab design pipeline (text→2D→3D LOD→per-part edits) via HTTP API, MCP (Claude and other AI clients), and CLI. AI only interprets; geometry and verification (vocabulary, interference, support, structural gates) run on a deterministic engine. All outputs are non-statutory.'}
      </P>
      <div style={{ marginTop: 10, padding: '10px 14px', borderRadius: 10, border: '1px solid var(--nx-accent, #2563eb)', background: 'rgba(37,99,235,0.07)', fontSize: 13, fontWeight: 600 }}>
        🔑 {ko
          ? 'API 키는 Pro 플랜 이상에서 발급됩니다: 로그인 → 계정 → API Keys. 키는 nf_live_ 로 시작하며 Authorization: Bearer 헤더로 전달합니다. 미인증 호출은 게스트 레이트리밋(분당 합산 10회)이 적용됩니다.'
          : 'API keys require a Pro plan or higher: Sign in → Account → API Keys. Keys start with nf_live_ and are sent as Authorization: Bearer. Unauthenticated calls fall under guest rate limits (10/min combined).'}
      </div>

      <H>1. HTTP API</H>
      <P>{ko ? '핵심 엔드포인트(모두 POST · JSON). 응답의 assembly 객체를 다음 호출에 그대로 전달하면 수정 체인이 이어지고, 편집마다 REV 이력이 자동 축적됩니다.' : 'Core endpoints (POST · JSON). Pass the returned assembly into the next call to chain edits; a REV history accumulates automatically.'}</P>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12.5, margin: '8px 0' }}>
        <thead><tr style={{ background: 'var(--nx-bg, #f1f5f9)' }}>
          <th style={{ border: '1px solid var(--nx-border, #dfe3e8)', padding: '6px 10px', textAlign: 'left' }}>Endpoint</th>
          <th style={{ border: '1px solid var(--nx-border, #dfe3e8)', padding: '6px 10px', textAlign: 'left' }}>{ko ? '기능' : 'What it does'}</th>
        </tr></thead>
        <tbody>
          {[
            ['/api/nexyfab/drawing/assemble', ko ? '자연어 → 다부품 어셈블리(게이트·1차 골격 draft 동봉)' : 'Text → multi-part assembly (+LOD draft)'],
            ['/api/nexyfab/drawing/compose', ko ? '자연어 → 단일 부품 intent+SCAD' : 'Text → single part'],
            ['/api/nexyfab/drawing/edit-part', ko ? '🎯 선택 부품만 AI 수정(대상 외 불변 보장)' : 'AI-edit one part only'],
            ['/api/nexyfab/drawing/face-drag', ko ? '면 푸시풀/치수 지정(AI 없음·결정론)' : 'Face push-pull / set dimension (deterministic)'],
            ['/api/nexyfab/drawing/part-op', ko ? '복제·삭제·이동·필렛(결정론)' : 'duplicate · delete · translate · fillet'],
            ['/api/nexyfab/drawing/export-step', ko ? 'B-rep STEP 내보내기' : 'B-rep STEP export'],
            ['/api/nexyfab/drawing/package', ko ? '실시 도서 세트(GA·부품도·BOQ·사양서·DXF)' : 'Deliverable package'],
          ].map(([e, d]) => (
            <tr key={e}>
              <td style={{ border: '1px solid var(--nx-border, #dfe3e8)', padding: '6px 10px', fontFamily: 'ui-monospace, monospace' }}>{e}</td>
              <td style={{ border: '1px solid var(--nx-border, #dfe3e8)', padding: '6px 10px' }}>{d}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Code>{`# 1) 생성
curl -s https://nexyfab.com/api/nexyfab/drawing/assemble/ \\
  -H "Authorization: Bearer nf_live_XXXX" -H "Content-Type: application/json" \\
  -d '{"description":"베이스 플레이트 1000x800x20 위에 지름 200 높이 400 원통 기둥 2개"}' > r1.json

# 2) 부품만 수정 (r1.json 의 .assembly 를 그대로)
curl -s https://nexyfab.com/api/nexyfab/drawing/edit-part/ \\
  -H "Authorization: Bearer nf_live_XXXX" -H "Content-Type: application/json" \\
  -d "{\\"assembly\\": $(jq .assembly r1.json), \\"partId\\":\\"column_1\\", \\"instruction\\":\\"높이를 600으로\\"}"

# 3) 면 치수 직접 지정 (결정론 — AI 미사용)
#    face: x±/y±/z± (box) · axis±/radial (회전체)
curl -s https://nexyfab.com/api/nexyfab/drawing/face-drag/ \\
  -H "Authorization: Bearer nf_live_XXXX" -H "Content-Type: application/json" \\
  -d '{"assembly": {…}, "partId":"column_1", "face":"axis+", "targetMm":600}'`}</Code>

      <H>2. MCP (Claude Code · Claude Desktop {ko ? '등' : 'etc.'})</H>
      <P>
        {ko
          ? '단일 파일 MCP 서버를 내려받아 등록하면 Claude가 도구 호출로 설계·수정합니다(Node 18+, 의존성 없음). 도구 5종: design_assembly · compose_part · edit_part · face_drag · part_op.'
          : 'Download the single-file MCP server and register it; Claude then designs/edits via tool calls (Node 18+, zero deps). Tools: design_assembly · compose_part · edit_part · face_drag · part_op.'}
      </P>
      <P><a href="/downloads/nexyfab-mcp.mjs" download style={{ color: 'var(--nx-accent, #2563eb)', fontWeight: 700 }}>⬇ nexyfab-mcp.mjs {ko ? '다운로드' : 'download'}</a></P>
      <Code>{`# Claude Code 등록 (API 키는 Pro 이상 발급)
claude mcp add nexyfab -e NEXYFAB_API_KEY=nf_live_XXXX -- node /절대경로/nexyfab-mcp.mjs

# 이후 Claude 에게:
#   "nexyfab 으로 1000x800 베이스에 기둥 2개 조립체 만들고, column_1 높이를 600으로 수정해줘"`}</Code>

      <H>3. CLI</H>
      <P>
        {ko
          ? '저장소의 scripts/drawing-to-3d/cli.mjs 는 MCP와 동일한 도구면을 명령행으로 제공합니다(로컬 엔진 실행 — 저장소 보유 시). NEXYFAB_API_KEY 를 설정하면 생성·수정 5종은 호스팅 API 로 호출됩니다(원격 모드). 파이프에 물리면 순수 JSON, 터미널에선 요약 라인이 함께 출력됩니다.'
          : 'scripts/drawing-to-3d/cli.mjs offers the same tool surface on the command line (local engine when you have the repo). With NEXYFAB_API_KEY set, the 5 generation/edit tools call the hosted API (remote mode). Piped = pure JSON; TTY adds a summary line.'}
      </P>
      <Code>{`export NEXYFAB_API_KEY=nf_live_XXXX     # 원격 모드(Pro) — 미설정 시 로컬 엔진
node cli.mjs assemble "베이스 플레이트 위 기둥 2개" --out asm.json
node cli.mjs face-drag asm.json column_1 --face axis+ --target 600 --out asm.json
node cli.mjs part-op asm.json --op duplicate --ids column_1 --offset 300,0,0 --out asm.json
node cli.mjs package asm.json --out ./도서 --step      # GA·부품도·BOQ·사양서·DXF·STEP
node cli.mjs list                                       # 도구 21종 목록`}</Code>

      <H>{ko ? '한도·정직 고지' : 'Limits & honesty'}</H>
      <P>
        {ko
          ? 'AI 생성 계열은 플랜 슬롯·일일 비용 한도를 따릅니다(결정론 연산인 face-drag·part-op 는 슬롯 미소모, 레이트리밋만). 게이트가 거부하면 형상을 조용히 바꾸지 않고 이유와 함께 422로 거부합니다. 자유곡면(mesh)은 생성기 파라미터 재생성으로만 수정됩니다(정점 직접 수정 비지원 — 제작 추적성).'
          : 'AI-generation calls follow plan slots and daily cost budgets (deterministic face-drag/part-op consume no slots). When a gate rejects, we return 422 with the reason instead of silently altering geometry.'}
      </P>
    </main>
  );
}
