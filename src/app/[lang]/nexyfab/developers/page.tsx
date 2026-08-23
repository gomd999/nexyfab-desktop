/**
 * /nexyfab/developers — 외부 사용 가이드(API·CLI·MCP) + API 키 자가발급 패널.
 * 정직 원칙: 실제 작동하는 사용법만 기재(목업·과장 금지). 산출물=비법정 명시.
 * 키 발급 UI 는 클라이언트 섬(ApiKeysPanel) — 기존 /api/user/api-keys 라우트 사용.
 */
import ApiKeysPanel from './ApiKeysPanel';
import { createCommercialLocalizer } from '@/lib/i18n/commercialLocalizer';

export const dynamic = 'force-static';

const CODE_STYLE: React.CSSProperties = {
  display: 'block', whiteSpace: 'pre', overflowX: 'auto', padding: '12px 14px', borderRadius: 10,
  background: '#0b1020', color: '#c8d3e8', fontSize: 12.5, lineHeight: 1.65, fontFamily: 'ui-monospace, monospace',
  border: '1px solid rgba(148,163,184,0.25)',
};

function H({ children }: { children: React.ReactNode }) {
  return <h2 style={{ fontSize: 19, fontWeight: 800, marginTop: 34, marginBottom: 8 }}>{children}</h2>;
}

function P({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <p style={{ fontSize: 13.5, lineHeight: 1.75, color: 'var(--nx-text-2, #46505e)', margin: '6px 0', ...style }}>{children}</p>;
}

function Code({ children }: { children: string }) {
  return <code style={CODE_STYLE}>{children}</code>;
}

export default async function DevelopersPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  const L = createCommercialLocalizer(lang);
  return (
    <main style={{ maxWidth: 860, margin: '0 auto', padding: '48px 20px 80px' }}>
      <h1 style={{ fontSize: 27, fontWeight: 900 }}>{L('개발자 가이드 — API · CLI · MCP', 'Developers — API · CLI · MCP')}</h1>
      <P>
        {L('NexyFab 설계 파이프라인(텍스트→2D도안→3D 1차→2차→부품 단위 수정)을 HTTP API, MCP(Claude 등 AI 클라이언트), CLI로 사용할 수 있습니다. AI는 이해만 담당하고 형상 생성·검증(어휘·간섭·지지·구조 게이트)은 결정론 엔진이 수행합니다. 모든 산출물은 비법정(제작용 실시도서+검토 계산서)이며, 인허가 제출 도서는 유자격 기술사 날인 영역입니다.', 'Use the NexyFab design pipeline (text→2D→3D LOD→per-part edits) via HTTP API, MCP (Claude and other AI clients), and CLI. AI only interprets; geometry and verification (vocabulary, interference, support, structural gates) run on a deterministic engine. All outputs are non-statutory.')}
      </P>
      <div style={{ marginTop: 10, padding: '10px 14px', borderRadius: 10, border: '1px solid var(--nx-accent, #2563eb)', background: 'rgba(37,99,235,0.07)', fontSize: 13, fontWeight: 600 }}>
        🔑 {L('API 키는 Pro 플랜 이상에서 아래 패널로 직접 발급합니다(수동 문의 불필요). 키는 nf_live_ 로 시작하며 Authorization: Bearer 헤더로 전달합니다. 미인증 호출은 게스트 레이트리밋(분당 합산 10회)이 적용됩니다.', 'Issue API keys yourself in the panel below (Pro plan or higher — no manual request). Keys start with nf_live_ and are sent as Authorization: Bearer. Unauthenticated calls fall under guest rate limits (10/min combined).')}
      </div>

      <H>{L('0. API 키 발급 (자가발급)', '0. Issue an API key (self-serve)')}</H>
      <P>
        {L('아래에서 바로 키를 만들고, 목록을 확인하고, 즉시 취소할 수 있습니다. 서버는 키의 해시(sha256)와 표시용 접두만 저장하며, 평문 키는 발급 순간 한 번만 표시됩니다 — 반드시 안전한 곳(비밀번호 관리자·CI 시크릿)에 저장하세요. 분실 시 새 키를 발급하고 기존 키를 취소하면 됩니다.', 'Create a key, view your keys, and revoke instantly below. The server stores only a sha256 hash + a short display prefix; the plaintext key is shown exactly once at creation — save it in a password manager or CI secret. If lost, issue a new key and revoke the old one.')}
      </P>
      <ApiKeysPanel lang={lang} />

      <H>1. HTTP API</H>
      <P>{L('핵심 엔드포인트(모두 POST · JSON). 응답의 assembly 객체를 다음 호출에 그대로 전달하면 수정 체인이 이어지고, 편집마다 REV 이력이 자동 축적됩니다.', 'Core endpoints (POST · JSON). Pass the returned assembly into the next call to chain edits; a REV history accumulates automatically.')}</P>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12.5, margin: '8px 0' }}>
        <thead><tr style={{ background: 'var(--nx-bg, #f1f5f9)' }}>
          <th style={{ border: '1px solid var(--nx-border, #dfe3e8)', padding: '6px 10px', textAlign: 'left' }}>Endpoint</th>
          <th style={{ border: '1px solid var(--nx-border, #dfe3e8)', padding: '6px 10px', textAlign: 'left' }}>{L('기능', 'What it does')}</th>
        </tr></thead>
        <tbody>
          {[
            ['/api/nexyfab/drawing/assemble', L('자연어 → 다부품 어셈블리(게이트·1차 골격 draft 동봉)', 'Text → multi-part assembly (+LOD draft)')],
            ['/api/nexyfab/drawing/compose', L('자연어 → 단일 부품 intent+SCAD', 'Text → single part')],
            ['/api/nexyfab/drawing/edit-part', L('🎯 선택 부품만 AI 수정(대상 외 불변 보장)', 'AI-edit one part only')],
            ['/api/nexyfab/drawing/face-drag', L('면 푸시풀/치수 지정(AI 없음·결정론)', 'Face push-pull / set dimension (deterministic)')],
            ['/api/nexyfab/drawing/part-op', L('복제·삭제·이동·필렛(결정론)', 'duplicate · delete · translate · fillet')],
            ['/api/nexyfab/drawing/export-step', L('B-rep STEP 내보내기', 'B-rep STEP export')],
            ['/api/nexyfab/drawing/package', L('실시 도서 세트(GA·부품도·BOQ·사양서·DXF)', 'Deliverable package')],
          ].map(([e, d]) => (
            <tr key={e}>
              <td style={{ border: '1px solid var(--nx-border, #dfe3e8)', padding: '6px 10px', fontFamily: 'ui-monospace, monospace' }}>{e}</td>
              <td style={{ border: '1px solid var(--nx-border, #dfe3e8)', padding: '6px 10px' }}>{d}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Code>{`# Common: send the nf_live_ key as a Bearer token. Responses use {"ok":true, "assembly":{…}, …}.
KEY=nf_live_XXXX ; BASE=https://nexyfab.com/api/nexyfab/drawing

# 1) Create  { description } -> { ok, assembly, openscad?, parts?, interferences?, gateErrors? }
curl -s "$BASE/assemble/" \\
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \\
  -d '{"description":"two cylindrical columns, diameter 200 and height 400, on a 1000x800x20 base plate"}' > r1.json

# 2) AI-edit one part  { assembly, partId, instruction } -> { ok, assembly, patch, note, interferences, massKg }
curl -s "$BASE/edit-part/" \\
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \\
  -d "{\\"assembly\\": $(jq .assembly r1.json), \\"partId\\":\\"column_1\\", \\"instruction\\":\\"set height to 600\\"}"

# 3) Set face dimensions directly (deterministic · no AI)  face: x±/y±/z± (box) · axis±/radial (revolved)
curl -s "$BASE/face-drag/" \\
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \\
  -d '{"assembly": {…}, "partId":"column_1", "face":"axis+", "targetMm":600}'

# 4) Batch part operations (deterministic)  op: delete|duplicate|translate|fillet · partIds[] · opts
curl -s "$BASE/part-op/" \\
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \\
  -d '{"assembly": {…}, "op":"duplicate", "partIds":["column_1"], "opts":{"offset":[300,0,0]}}'

# 5) Deliverable document set  { assembly, options? } -> { ok, files, structural, interferences, welds }
curl -s "$BASE/package/" \\
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \\
-d '{"assembly": {…}, "options":{"title":"column assembly","withStep":true}}'`}</Code>
      <P style={{ fontSize: 12.5 }}>
        {L('엔지니어링 계산 API(빔·용접·볼트 등)는 별도 게이트로 검증되어 있으며 응답에 근거식·중간값을 함께 반환합니다. 형상 API 와 동일한 Bearer 키를 사용합니다.', 'The engineering-calc API (beams, welds, bolts, …) is separately gated and returns formulas/intermediate values; it uses the same Bearer key as the geometry API.')}
      </P>

      <H>2. MCP (Claude Code · Claude Desktop {L('등', 'etc.')})</H>
      <P>
        {L('단일 파일 원격 MCP 서버는 Node 18+에서 의존성 없이 실행되며, 실제 tools/list에 정확히 15개를 노출합니다: design_assembly · compose_part · edit_part · face_drag · part_op · domain_design · analyze_fea · reconstruct_verify · reconstruct_fleet · code_check · verify_domain · interior_check · landscape_check · bridge_check · load_path. 일부 검증 도구는 키 없이 동작하고, 생성·수정·FEA·역설계 계열은 Pro API 키가 필요합니다. 저장소의 로컬 MCP(scripts/drawing-to-3d/mcp-server.mjs)는 별도 제품 표면으로 90개 도구를 노출하며 로컬 전용과 원격 전용 도구가 섞여 있으므로 각 tools/list의 이름·스키마를 기준으로 사용하세요.', 'The zero-dependency single-file remote MCP server runs on Node 18+ and exposes exactly 15 tools in tools/list: design_assembly · compose_part · edit_part · face_drag · part_op · domain_design · analyze_fea · reconstruct_verify · reconstruct_fleet · code_check · verify_domain · interior_check · landscape_check · bridge_check · load_path. Some verification tools are keyless; generation/editing, FEA, and reverse-engineering tools require a Pro API key. The repository local MCP (scripts/drawing-to-3d/mcp-server.mjs) is a separate product surface exposing 90 tools, with a mix of local-only and remote-only operations; use each server\'s tools/list as the authority for names and schemas.')}
      </P>
      <P><a href="/downloads/nexyfab-mcp.mjs" download style={{ color: 'var(--nx-accent, #2563eb)', fontWeight: 700 }}>⬇ nexyfab-mcp.mjs {L('다운로드', 'download')}</a></P>
      <Code>{`# 1) Download the MCP server
curl -sL https://nexyfab.com/downloads/nexyfab-mcp.mjs -o ~/nexyfab-mcp.mjs

# 2) Register with Claude Code (issue the API key in panel 0 above; absolute path required)
claude mcp add nexyfab -e NEXYFAB_API_KEY=nf_live_XXXX -- node /absolute/path/nexyfab-mcp.mjs

# 3) Verify registration
claude mcp list

# 4) Then ask Claude in natural language:
#   "Build an assembly with two columns on a 1000x800 base using nexyfab, then set column_1 height to 600"`}</Code>
      {/**
        * ★260801 — **키가 셸 기록에 남는다는 경고가 없었다.**
        *   `-e NEXYFAB_API_KEY=...` 는 명령줄에 키를 그대로 노출한다. CLI 절(3번)은
        *   이 위험을 경고하는데 MCP 절만 빠져 있었다 — 같은 위험은 같이 알려야 한다.
        */}
      <P style={{ fontSize: 12.5, borderLeft: '3px solid #c9a227', paddingLeft: 10 }}>
        {L('⚠ 위 -e 방식은 간단하지만 키가 셸 기록에 남습니다. 공용 장비에서는 등록 후 기록을 지우거나, 키를 새로 발급해 두세요(위 0번 패널에서 즉시 폐기·재발급됩니다). 등록이 안 되면 먼저 절대경로를 의심하세요 — ~ 가 확장되지 않는 환경이 있습니다.', '⚠ The -e form is convenient but leaves the key in your shell history. On shared machines, clear the history after registering or rotate the key (revoke and re-issue instantly in panel 0 above). If registration fails, suspect the path first — ~ is not expanded in some environments.')}
      </P>
      <P style={{ fontSize: 12.5 }}>
        {L('Claude Desktop 은 claude_desktop_config.json 의 mcpServers 에 동일하게 {"command":"node","args":["/absolute/path/nexyfab-mcp.mjs"],"env":{"NEXYFAB_API_KEY":"nf_live_XXXX"}} 를 추가하면 됩니다.', 'For Claude Desktop, add the same under mcpServers in claude_desktop_config.json: {"command":"node","args":["/absolute/path/nexyfab-mcp.mjs"],"env":{"NEXYFAB_API_KEY":"nf_live_XXXX"}}.')}
      </P>
      <P style={{ fontSize: 12.5 }}>
        {L('신규 하드 능력 4종(웹과 동일): analyze_fea(간이 FEA — 구조 선형정적만, scad+재료+하중. 열/모달/열탄성은 이 도구로 불가) · reconstruct_verify(검증된 역설계 — STL/STEP/DWG/SAT를 재구성 게이트로 bbox·genus·watertight 대조) · reconstruct_fleet(AI 재구성 함대 — 다모델 파라메트릭 SCAD, Pro·비용) · code_check(코드체크/감리 — 공개 법령 조항 인용 PASS/FAIL/NA). 앞 3종은 원격 전용(NEXYFAB_API_KEY 필요 — 서버 OpenSCAD/gmsh/OCCT·LLM 사용, 키 없으면 명시적 거부), code_check 는 로컬·오프라인(순수 결정론 룰셋). 모두 비법정(엔지니어링급 스크리닝·결정론 감리 보조 — 상세 해석·법정 감리는 유자격 전문가 몫).', 'Four new hard capabilities (parity with the web): analyze_fea (quick FEA — structural/linear-static only from scad+material+load; thermal/modal/thermo-elastic are NOT available through this tool) · reconstruct_verify (verified reverse-engineering — STL/STEP/DWG/SAT vs a reconstruction gate on bbox/genus/watertight) · reconstruct_fleet (AI reconstruction fleet — multi-model parametric SCAD, Pro + budget) · code_check (code-check/audit citing PASS/FAIL/NA against public statutes). The first three are REMOTE-only (need NEXYFAB_API_KEY — hosted OpenSCAD/gmsh/OCCT/LLM; explicit refusal without a key); code_check runs LOCALLY offline (pure deterministic ruleset). All non-statutory (engineering-grade screening / deterministic review aid — detailed analysis and statutory review remain a licensed professional duty).')}
      </P>
      <P style={{ fontSize: 12.5 }}>
        {L('분야 검증 체인 5종(웹과 동일·공개 라우트 — API 키 없이도 동작): verify_domain(5분야 공학 계산기 — 형상 파생 단면·경간 + 하중/재료로 실제 계산, 인용 조항 동봉) · interior_check(피난 보행거리 BFS+수용인원+마감 물량) · landscape_check(목재 부재+풍하중 전도) · bridge_check(거더/아치/트러스/사장/현수/계단 자동 디스패치) · load_path(슬래브→보→기둥→기초 하중경로). 전부 결정론 — 하중·값을 지어내지 않고 누락 시 needInputs. 비법정(유자격 기술사·건축사 최종 책임).', 'Five discipline-verification chains (parity with the web · public routes — work without an API key): verify_domain (engineering calculators across 5 disciplines — section/span derived from geometry + user loads/materials, with cited clauses) · interior_check (egress travel BFS + occupancy + finishes) · landscape_check (timber members + wind overturning) · bridge_check (girder/arch/truss/cable-stayed/suspension/stair auto-dispatch) · load_path (slab->beam->column->footing). All deterministic — never fabricate loads (needInputs when missing). Non-statutory (a licensed engineer/architect remains responsible).')}
      </P>

      <H>3. CLI</H>
      <P>
        {L('저장소의 scripts/drawing-to-3d/cli.mjs 는 MCP와 동일한 도구면을 명령행으로 제공합니다(로컬 엔진 실행 — 저장소 보유 시). NEXYFAB_API_KEY 를 설정하면 생성·수정 5종은 호스팅 API 로 호출됩니다(원격 모드). 파이프에 물리면 순수 JSON, 터미널에선 요약 라인이 함께 출력됩니다.', 'scripts/drawing-to-3d/cli.mjs offers the same tool surface on the command line (local engine when you have the repo). With NEXYFAB_API_KEY set, the 5 generation/edit tools call the hosted API (remote mode). Piped = pure JSON; TTY adds a summary line.')}
      </P>
      <Code>{`cd scripts/drawing-to-3d                 # local engine when the repository is available
export NEXYFAB_API_KEY=nf_live_XXXX      # with a key, five create/edit commands use hosted API; unset = local

node cli.mjs assemble "two columns on a 1000x800x20 base plate" --out asm.json   # text → assembly
node cli.mjs build asm.json                                    # deterministic rebuild and gate summary
node cli.mjs edit-part asm.json column_1 "set height to 600" --out asm.json          # AI part edit
node cli.mjs face-drag asm.json column_1 --face axis+ --target 600 --out asm.json  # face dimension (deterministic)
node cli.mjs part-op asm.json --op duplicate --ids column_1 --offset 300,0,0 --out asm.json
node cli.mjs step asm.json --out model.step                    # B-rep STEP export
node cli.mjs preview asm.json --out ./png --views iso,side,top # headless render → PNG
node cli.mjs package asm.json --out ./docs --step              # GA · parts · BOQ · spec · DXF · STEP
node cli.mjs domain civil "retaining wall H=3m length 200m" --out pkg.json # multi-domain (remote only — key required)
node cli.mjs templates bridge                                  # list domain templates
node cli.mjs fea asm.json --load 500 --material steel          # quick FEA (remote — hosted OpenSCAD/gmsh)
node cli.mjs reconstruct part.stl                             # verified reverse engineering (remote — reconstruction gate)
node cli.mjs fleet part.stl                                   # AI reconstruction fleet (remote + Pro/budget)
node cli.mjs codecheck features.json                          # code-check/audit 41 rules (local/offline/keyless)
node cli.mjs interior asm.json                                 # interior egress/finishes chain (local)
node cli.mjs landscape asm.json                               # landscape timber/wind-load (local)
node cli.mjs bridge asm.json                                  # bridge review (meta auto-dispatch/local)
node cli.mjs loadpath asm.json                                # building load-path chain (local) | --list use table
node cli.mjs list                                              # list all tools and commands`}</Code>
      <P style={{ fontSize: 12.5 }}>
        {L('파이프에 물리면 순수 JSON(기계 파싱), 터미널에선 통과/거부 요약 라인이 함께 나옵니다(--raw 로 순수 강제). loft·constraints·dossier·domain 등 추가 명령은 cli.mjs 헤더 주석과 list 출력에 정리되어 있습니다.', 'Piped output is pure JSON (machine-parseable); a TTY adds a pass/reject summary line (force pure with --raw). Extra commands (loft, constraints, dossier, domain) are documented in the cli.mjs header and list output.')}
      </P>

      <H>{L('한도·정직 고지', 'Limits & honesty')}</H>
      <P>
        {L('AI 생성 계열은 플랜 슬롯·일일 비용 한도를 따릅니다(결정론 연산인 face-drag·part-op 는 슬롯 미소모, 레이트리밋만). 게이트가 거부하면 형상을 조용히 바꾸지 않고 이유와 함께 422로 거부합니다. 자유곡면(mesh)은 생성기 파라미터 재생성으로만 수정됩니다(정점 직접 수정 비지원 — 제작 추적성).', 'AI-generation calls follow plan slots and daily cost budgets (deterministic face-drag/part-op consume no slots). When a gate rejects, we return 422 with the reason instead of silently altering geometry.')}
      </P>
    </main>
  );
}
