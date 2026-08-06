/**
 * nexyfab.test.ts — CLI 계약 (260802).
 *
 * ## 무엇을 지키나
 * CLI 는 **CI·스크립트가 쓰는 인터페이스**다. 사람만 읽는 출력이 아니라
 * **종료 코드로 성패를 구별**해야 하고, 실패 원인이 섞이면 자동화가 잘못 분기한다.
 *
 * 그래서 여기서는 「예쁘게 나오나」가 아니라 **틀리면 자동화가 깨지는 것**만 잡는다:
 *  · 종료 코드가 원인별로 다른가
 *  · 키를 로그에 흘리지 않는가 (CI 로그는 오래 남는다)
 *  · 인자 파싱이 예상대로인가
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { resolve } from "node:path";
import { parseArgv, EXIT, mask, main } from "./nexyfab.mjs";

const argv = parseArgv as unknown as (
  a: string[],
) => Record<string, unknown> & { _: string[] };
const codes = EXIT as unknown as Record<string, number>;
const maskFn = mask as unknown as (k: string | null) => string;
const run = main as unknown as (a: string[]) => Promise<number>;

describe("인자 파싱", () => {
  it("위치 인자와 플래그를 가른다", () => {
    const a = argv(["package", "--file", "x.json", "--out", "dir"]);
    expect(a._).toEqual(["package"]);
    expect(a.file).toBe("x.json");
    expect(a.out).toBe("dir");
  });

  it("`--k=v` 형태도 받는다", () => {
    expect(argv(["keys", "--days=30"]).days).toBe("30");
  });

  it("값 없는 플래그는 true — 뒤 플래그를 값으로 먹지 않는다", () => {
    const a = argv(["whoami", "--verbose", "--help"]);
    expect(a.verbose).toBe(true);
    expect(a.help).toBe(true);
  });

  it("`--` 뒤는 전부 위치 인자다 — 자연어에 `--` 가 들어가도 깨지지 않는다", () => {
    const a = argv(["assemble", "--", "--이상한", "설명"]);
    expect(a._).toEqual(["assemble", "--이상한", "설명"]);
  });
});

describe("★종료 코드가 원인별로 다르다 — 자동화가 분기할 수 있어야 한다", () => {
  const saved = process.env.NEXYFAB_API_KEY;
  beforeEach(() => {
    delete process.env.NEXYFAB_API_KEY;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.NEXYFAB_API_KEY;
    else process.env.NEXYFAB_API_KEY = saved;
  });

  it("코드가 서로 겹치지 않는다", () => {
    const vals = Object.values(codes);
    expect(
      new Set(vals).size,
      `중복된 종료 코드: ${JSON.stringify(codes)}`,
    ).toBe(vals.length);
    expect(codes.ok).toBe(0);
  });

  it("도움말은 0", async () => {
    const w = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    expect(await run(["--help"])).toBe(codes.ok);
    w.mockRestore();
  });

  it("알 수 없는 명령은 **0이 아니다** — 오타가 성공으로 읽히면 안 된다", async () => {
    const e = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const o = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    expect(await run(["bogus"])).toBe(codes.usage);
    e.mockRestore();
    o.mockRestore();
  });

  it("키가 없으면 인증 코드(3)로 끝난다 — 네트워크를 타지 않는다", async () => {
    const e = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(await run(["whoami"])).toBe(codes.auth);
    expect(fetchSpy, "키가 없는데 네트워크를 탔다").not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    e.mockRestore();
  });

  it("인자가 모자라면 사용법 코드(2)", async () => {
    process.env.NEXYFAB_API_KEY = "nf_live_test";
    const e = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    expect(await run(["keys", "create"])).toBe(codes.usage);
    expect(await run(["assemble"])).toBe(codes.usage);
    e.mockRestore();
  });
});

describe("★키를 흘리지 않는다 — CI 로그는 오래 남는다", () => {
  it("마스킹은 앞뒤만 남긴다", () => {
    const key = "nf_live_abcdef0123456789abcdef0123456789";
    const m = maskFn(key);
    expect(m).not.toBe(key);
    expect(m).toContain("…");
    // 중간 본문이 그대로 노출되면 안 된다.
    expect(m).not.toContain("0123456789abcdef0123456789");
  });

  it("키가 없으면 「(없음)」 — undefined 를 찍지 않는다", () => {
    expect(maskFn(null)).toBe("(없음)");
  });

  it("★`--verbose` 로그에 평문 키가 없다", async () => {
    process.env.NEXYFAB_API_KEY = "nf_live_SECRETSECRETSECRETSECRET";
    const lines: string[] = [];
    const e = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((s: unknown) => {
        lines.push(String(s));
        return true;
      });
    const o = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ keys: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await run(["whoami", "--verbose"]);
    const joined = lines.join("");
    expect(joined, "verbose 로그에 평문 키가 찍혔다").not.toContain(
      "SECRETSECRETSECRETSECRET",
    );
    vi.restoreAllMocks();
    e.mockRestore();
    o.mockRestore();
    delete process.env.NEXYFAB_API_KEY;
  });
});

describe("CAD v1 commands", () => {
  it("assembly --strict uses releaseReady, not a legacy preview/design flag", async () => {
    const fs = await import("node:fs");
    const file = resolve(
      process.cwd(),
      "src/lib/reference/fixture-cli-assembly.json",
    );
    fs.writeFileSync(file, JSON.stringify({ state: { parts: [], mates: [] } }));
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          previewOk: true,
          designOk: true,
          releaseReady: false,
        }),
        { status: 200 },
      ),
    );
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    try {
      expect(
        await run(["assembly", "verify", "--file", file, "--strict"]),
      ).toBe(codes.server);
    } finally {
      fs.unlinkSync(file);
      fetchSpy.mockRestore();
      stdout.mockRestore();
    }
  });

  it("reference analyze sends explicit units and emits evidence without local path or source bytes", async () => {
    const fs = await import("node:fs");
    const stepFile = resolve(
      process.cwd(),
      "src/lib/reference/fixture-cli-private.step",
    );
    const source = "ISO-10303-21;PRIVATE-SOURCE-CONTENT;END-ISO-10303-21;";
    fs.writeFileSync(stepFile, source);
    const evidence = {
      schemaVersion: 2,
      scenarioId: "A07",
      input: { sha256: "a".repeat(64) },
      assertions: [],
    };
    const response = {
      ok: true,
      evidence,
      tolerancePolicy: { version: "cad-tolerance/v1" },
      quoteOrRfqSideEffects: false,
    };
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify(response), { status: 200 }),
      );
    const output: string[] = [];
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((value: unknown) => {
        output.push(String(value));
        return true;
      });
    try {
      expect(
        await run([
          "reference",
          "analyze",
          "--file",
          stepFile,
          "--scenario",
          "A07",
          "--unit",
          "in",
          "--tolerance",
          "0.001",
        ]),
      ).toBe(codes.ok);
      expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(
        "/api/cad/v1/reference/analyze",
      );
      const request = JSON.parse(
        String((fetchSpy.mock.calls[0]?.[1] as RequestInit).body),
      );
      expect(request).toMatchObject({
        scenarioId: "A07",
        format: "step",
        encoding: "utf8",
        step: source,
        lengthUnit: { kind: "scale-to-mm", scaleToMm: 25.4, label: "in" },
        declaredSourceTolerance: { value: 0.001 },
      });
      const printed = output.join("");
      expect(JSON.parse(printed)).toEqual(response);
      expect(printed).not.toContain(stepFile);
      expect(printed).not.toContain("PRIVATE-SOURCE-CONTENT");
    } finally {
      fs.unlinkSync(stepFile);
      fetchSpy.mockRestore();
      stdout.mockRestore();
    }
  });

  it("reference analyze rejects missing units and non-STEP files before network access", async () => {
    const fs = await import("node:fs");
    const file = resolve(
      process.cwd(),
      "src/lib/reference/fixture-cli-private.txt",
    );
    fs.writeFileSync(file, "private");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      expect(
        await run([
          "reference",
          "analyze",
          "--file",
          file,
          "--scenario",
          "A07",
          "--unit",
          "mm",
        ]),
      ).toBe(codes.usage);
      expect(
        await run([
          "reference",
          "analyze",
          "--file",
          file,
          "--scenario",
          "A07",
        ]),
      ).toBe(codes.usage);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fs.unlinkSync(file);
      fetchSpy.mockRestore();
      stderr.mockRestore();
    }
  });

  it("STEP mechanical relations forwards inline source and honors strict release verdict", async () => {
    const fs = await import("node:fs"),
      file = resolve(
        process.cwd(),
        "src/lib/reference/fixture-mechanical.step",
      );
    fs.writeFileSync(file, "ISO-10303-21;DATA;ENDSEC;END-ISO-10303-21;");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: true,
            releaseReady: false,
            evidence: { coaxialPairs: [] },
          }),
          { status: 200 },
        ),
      ),
      stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    try {
      expect(
        await run([
          "reference",
          "mechanical-relations",
          "--file",
          file,
          "--strict",
        ]),
      ).toBe(codes.server);
      expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(
        "/api/cad/v1/step/mechanical-relations",
      );
      const body = JSON.parse(
        String((fetchSpy.mock.calls[0]?.[1] as RequestInit).body),
      );
      expect(body.step).toContain("ISO-10303-21");
    } finally {
      fs.unlinkSync(file);
      fetchSpy.mockRestore();
      stdout.mockRestore();
    }
  });
  it("IFC semantic roundtrip sends two inline documents and honors strict release failure", async () => {
    const fs = await import("node:fs");
    const before = resolve(
        process.cwd(),
        "src/lib/reference/fixture-before.ifc",
      ),
      after = resolve(process.cwd(), "src/lib/reference/fixture-after.ifc");
    fs.writeFileSync(
      before,
      "ISO-10303-21;#1=IFCSITE('a',$,$,$,$,$,$,$,$,$,$,$,$,$);",
    );
    fs.writeFileSync(
      after,
      "ISO-10303-21;#1=IFCSITE('b',$,$,$,$,$,$,$,$,$,$,$,$,$);",
    );
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          releaseReady: false,
          evidence: { passed: false },
        }),
        { status: 200 },
      ),
    );
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    try {
      expect(
        await run([
          "ifc",
          "semantic-roundtrip",
          "--before",
          before,
          "--after",
          after,
          "--strict",
        ]),
      ).toBe(codes.server);
      expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(
        "/api/cad/v1/ifc/semantic-roundtrip",
      );
      const body = JSON.parse(
        String((fetchSpy.mock.calls[0]?.[1] as RequestInit).body),
      );
      expect(body).toHaveProperty("beforeIfc");
      expect(body).toHaveProperty("afterIfc");
      expect(body).not.toHaveProperty("before");
    } finally {
      fs.unlinkSync(before);
      fs.unlinkSync(after);
      fetchSpy.mockRestore();
      stdout.mockRestore();
    }
  });
  it("IFC domain IR forwards one inline file and explicit domain", async () => {
    const fs = await import("node:fs");
    const file = resolve(process.cwd(), "src/lib/reference/fixture-domain.ifc");
    fs.writeFileSync(file, "#1=IFCALIGNMENT('a',$);");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          releaseReady: true,
          ir: { kind: "alignment" },
        }),
        { status: 200 },
      ),
    );
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    try {
      expect(
        await run([
          "ifc",
          "domain-ir",
          "--file",
          file,
          "--domain",
          "alignment",
        ]),
      ).toBe(codes.ok);
      expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(
        "/api/cad/v1/ifc/domain-ir",
      );
      expect(
        JSON.parse(String((fetchSpy.mock.calls[0]?.[1] as RequestInit).body)),
      ).toEqual({ ifc: "#1=IFCALIGNMENT('a',$);", domain: "alignment" });
    } finally {
      fs.unlinkSync(file);
      fetchSpy.mockRestore();
      stdout.mockRestore();
    }
  });
  it("IFC recovery plan returns strict nonzero for unresolved required input", async () => {
    const fs = await import("node:fs");
    const file = resolve(
      process.cwd(),
      "src/lib/reference/fixture-recovery.ifc",
    );
    fs.writeFileSync(file, "#1=IFCRAILING('a',$);");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          releaseReady: false,
          requests: [
            { requiredInputs: ["profile_definition_or_physical_width_mm"] },
          ],
        }),
        { status: 200 },
      ),
    );
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    try {
      expect(
        await run(["ifc", "recovery-plan", "--file", file, "--strict"]),
      ).toBe(codes.server);
      expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(
        "/api/cad/v1/ifc/recovery-plan",
      );
    } finally {
      fs.unlinkSync(file);
      fetchSpy.mockRestore();
      stdout.mockRestore();
    }
  });
  it("IFC authoritative recovery forwards file and input JSON and honors strict verdict", async () => {
    const fs = await import("node:fs");
    const file = resolve(
      process.cwd(),
      "src/lib/reference/fixture-recover.ifc",
    );
    const inputsFile = resolve(
      process.cwd(),
      "src/lib/reference/fixture-recover-inputs.json",
    );
    fs.writeFileSync(file, "#1=IFCRAILING('0DAlDmbNb6ZhcaPbmdsMGX',$);");
    const inputs = [
      {
        globalId: "0DAlDmbNb6ZhcaPbmdsMGX",
        physicalWidthMm: 50,
        provenance: "operator drawing A-12",
      },
    ];
    fs.writeFileSync(inputsFile, JSON.stringify(inputs));
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          releaseReady: false,
          rejected: [{ code: "OCCURRENCE_NOT_REQUESTED" }],
        }),
        { status: 200 },
      ),
    );
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    try {
      expect(
        await run([
          "ifc",
          "recover-geometry",
          "--file",
          file,
          "--inputs",
          inputsFile,
          "--strict",
        ]),
      ).toBe(codes.server);
      expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(
        "/api/cad/v1/ifc/recover-geometry",
      );
      expect(
        JSON.parse(String((fetchSpy.mock.calls[0]?.[1] as RequestInit).body)),
      ).toEqual({
        ifc: "#1=IFCRAILING('0DAlDmbNb6ZhcaPbmdsMGX',$);",
        authoritativeInputs: inputs,
      });
    } finally {
      fs.unlinkSync(file);
      fs.unlinkSync(inputsFile);
      fetchSpy.mockRestore();
      stdout.mockRestore();
    }
  });

  it("design uses the canonical multi-part API and preserves JSON output", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ ok: true, program: { parts: [{ id: "p1" }] } }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    const output: string[] = [];
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((value: unknown) => {
        output.push(String(value));
        return true;
      });
    expect(await run(["design", "two part clamp"])).toBe(codes.ok);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(
      "/api/cad/v1/product-decomposition",
    );
    expect(JSON.parse(output.join("")).program.parts).toHaveLength(1);
    fetchSpy.mockRestore();
    stdout.mockRestore();
  });

  it("part uses the selection-capable CAD v1 feature endpoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          part: "shaft",
          features: [{ type: "sketchExtrude" }],
        }),
        { status: 200 },
      ),
    );
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    expect(await run(["part", "make a 20mm shaft"])).toBe(codes.ok);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(
      "/api/cad/v1/feature-program",
    );
    fetchSpy.mockRestore();
    stdout.mockRestore();
  });

  it("capabilities exposes common and legacy mappings", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          quoteOrRfqSideEffects: false,
          compatibility: { legacyUrlsRemainSupported: true },
        }),
        { status: 200 },
      ),
    );
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    expect(await run(["capabilities"])).toBe(codes.ok);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(
      "/api/cad/v1/capabilities",
    );
    fetchSpy.mockRestore();
    stdout.mockRestore();
  });

  it("project verify routes the shared mechanical/interior evidence and strict verdict", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({ ok: true, releaseReady: false, gates: [] }),
          { status: 200 },
        ),
      );
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const fs = await import("node:fs");
    const payload = resolve(
      process.cwd(),
      "src/lib/ai/fixtures-project-verify-cli.json",
    );
    fs.writeFileSync(
      payload,
      JSON.stringify({
        structure: { valid: true },
        placement: { required: 1, resolved: 0, invalid: 0 },
      }),
    );
    try {
      expect(
        await run(["project", "verify", "--file", payload, "--strict"]),
      ).toBe(codes.server);
      expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(
        "/api/cad/v1/project/verify",
      );
    } finally {
      fs.unlinkSync(payload);
      fetchSpy.mockRestore();
      stdout.mockRestore();
    }
  });

  it("generation state forwards checkpoint transitions unchanged", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          state: { schema: "nexyfab.generation-run.v1", revision: 0 },
        }),
        { status: 200 },
      ),
    );
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const fs = await import("node:fs");
    const payload = resolve(
      process.cwd(),
      "src/lib/ai/fixtures-generation-state-cli.json",
    );
    const action = { action: "initialize", runId: "cli-run" };
    fs.writeFileSync(payload, JSON.stringify(action));
    try {
      expect(await run(["generation", "state", "--file", payload])).toBe(
        codes.ok,
      );
      expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(
        "/api/cad/v1/generation/state",
      );
      expect(
        JSON.parse(String((fetchSpy.mock.calls[0]?.[1] as RequestInit).body)),
      ).toEqual(action);
    } finally {
      fs.unlinkSync(payload);
      fetchSpy.mockRestore();
      stdout.mockRestore();
    }
  });

  it("generation finalize forwards per-part evidence and strict incomplete verdict", async () => {
    const canonical = {
      schema: "nexyfab.generation-canonical-response.v1",
      status: "fail",
      stoppedAt: "roundtrip",
      releaseReady: false,
      contractHash: "a".repeat(64),
      quoteOrRfqSideEffects: false,
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ ok: true, stoppedAt: "roundtrip", canonical }),
        {
          status: 200,
        },
      ),
    );
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const fs = await import("node:fs");
    const payload = resolve(
      process.cwd(),
      "src/lib/ai/fixtures-generation-finalize-cli.json",
    );
    const evidence = {
      state: {},
      program: {},
      motion: { required: false },
      parts: [
        {
          partId: "p1",
          referenceStep: {
            source: "ISO-10303-21;DATA;ENDSEC;END-ISO-10303-21;",
            requirements: ["flat_pattern", "bend_table"],
          },
        },
      ],
    };
    fs.writeFileSync(payload, JSON.stringify(evidence));
    try {
      expect(
        await run(["generation", "finalize", "--file", payload, "--strict"]),
      ).toBe(codes.server);
      expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(
        "/api/cad/v1/generation/finalize",
      );
      expect(
        JSON.parse(String((fetchSpy.mock.calls[0]?.[1] as RequestInit).body)),
      ).toEqual(evidence);
      expect(
        stdout.mock.calls.map((call) => String(call[0])).join(""),
      ).toContain(canonical.contractHash);
    } finally {
      fs.unlinkSync(payload);
      fetchSpy.mockRestore();
      stdout.mockRestore();
    }
  });

  it("generation advance preserves the topology canonical contract and fails closed in strict mode", async () => {
    const canonical = {
      schema: "nexyfab.generation-canonical-response.v1",
      status: "fail",
      stoppedAt: "assembly_solve",
      releaseReady: false,
      codes: ["ASSEMBLY_TOPOLOGY_REVIEW_REQUIRED"],
      unresolvedCount: 1,
      unresolvedByStage: [{ stage: "assembly_solve", count: 1 }],
      affectedPartIds: ["p1"],
      contractHash: "d".repeat(64),
      quoteOrRfqSideEffects: false,
    };
    const response = {
      ok: true,
      stoppedAt: "assembly_solve",
      state: { stages: { assembly_solve: { status: "failed" } } },
      canonical,
    };
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify(response), { status: 200 }),
      );
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const fs = await import("node:fs");
    const payload = resolve(
      process.cwd(),
      "src/lib/ai/fixtures-generation-advance-cli.json",
    );
    const evidence = {
      state: {},
      program: {},
      topologyRebind: { assemblySolveReady: false },
    };
    fs.writeFileSync(payload, JSON.stringify(evidence));
    try {
      expect(
        await run(["generation", "advance", "--file", payload, "--strict"]),
      ).toBe(codes.server);
      expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(
        "/api/cad/v1/generation/advance",
      );
      expect(
        JSON.parse(String((fetchSpy.mock.calls[0]?.[1] as RequestInit).body)),
      ).toEqual(evidence);
      const output = stdout.mock.calls.map((call) => String(call[0])).join("");
      expect(output).toContain(canonical.contractHash);
      expect(output).toContain("ASSEMBLY_TOPOLOGY_REVIEW_REQUIRED");
    } finally {
      fs.unlinkSync(payload);
      fetchSpy.mockRestore();
      stdout.mockRestore();
    }
  });

  it("interior door-swing routes continuous evidence and strict clearance verdict", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          result: { clear: false, conservative: true },
        }),
        { status: 200 },
      ),
    );
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const fs = await import("node:fs");
    const payload = resolve(
      process.cwd(),
      "src/lib/assembly/fixtures-door-swing-cli.json",
    );
    const evidence = {
      pivot: { x: 0, y: 0 },
      closedAngleDeg: 0,
      openAngleDeg: 90,
      widthMm: 900,
      thicknessMm: 40,
      obstacles: [],
    };
    fs.writeFileSync(payload, JSON.stringify(evidence));
    try {
      expect(
        await run(["interior", "door-swing", "--file", payload, "--strict"]),
      ).toBe(codes.server);
      expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(
        "/api/cad/v1/interior/door-swing/verify",
      );
      expect(
        JSON.parse(String((fetchSpy.mock.calls[0]?.[1] as RequestInit).body)),
      ).toEqual(evidence);
    } finally {
      fs.unlinkSync(payload);
      fetchSpy.mockRestore();
      stdout.mockRestore();
    }
  });

  it("interior space-boundary routes topology evidence and strict closure verdict", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          result: { closed: true, conservative: true },
        }),
        { status: 200 },
      ),
    );
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const fs = await import("node:fs");
    const payload = resolve(
      process.cwd(),
      "src/lib/assembly/fixtures-space-boundary-cli.json",
    );
    const evidence = {
      segments: [
        { id: "a", start: { x: 0, y: 0 }, end: { x: 1, y: 0 } },
        { id: "b", start: { x: 1, y: 0 }, end: { x: 0, y: 1 } },
        { id: "c", start: { x: 0, y: 1 }, end: { x: 0, y: 0 } },
      ],
    };
    fs.writeFileSync(payload, JSON.stringify(evidence));
    try {
      expect(
        await run([
          "interior",
          "space-boundary",
          "--file",
          payload,
          "--strict",
        ]),
      ).toBe(codes.ok);
      expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(
        "/api/cad/v1/interior/space-boundary/verify",
      );
      expect(
        JSON.parse(String((fetchSpy.mock.calls[0]?.[1] as RequestInit).body)),
      ).toEqual(evidence);
    } finally {
      fs.unlinkSync(payload);
      fetchSpy.mockRestore();
      stdout.mockRestore();
    }
  });

  it("interior egress routes governed evidence and strict verdict", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          result: { passed: false, conservative: true },
        }),
        { status: 200 },
      ),
    );
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const fs = await import("node:fs");
    const payload = resolve(
      process.cwd(),
      "src/lib/assembly/fixtures-egress-cli.json",
    );
    const evidence = {
      nodes: [
        { id: "o", point: { x: 0, y: 0 } },
        { id: "e", point: { x: 1, y: 0 } },
      ],
      edges: [{ id: "p", from: "o", to: "e", clearWidthMm: 900 }],
      originNodeIds: ["o"],
      exitNodeIds: ["e"],
      maximumTravelDistanceMm: 10,
      minimumClearWidthMm: 800,
    };
    fs.writeFileSync(payload, JSON.stringify(evidence));
    try {
      expect(
        await run(["interior", "egress", "--file", payload, "--strict"]),
      ).toBe(codes.server);
      expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(
        "/api/cad/v1/interior/egress/verify",
      );
      expect(
        JSON.parse(String((fetchSpy.mock.calls[0]?.[1] as RequestInit).body)),
      ).toEqual(evidence);
    } finally {
      fs.unlinkSync(payload);
      fetchSpy.mockRestore();
      stdout.mockRestore();
    }
  });

  it("interior MEP interference routes continuous geometry and strict verdict", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          result: { clear: false, conservative: true },
        }),
        { status: 200 },
      ),
    );
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const fs = await import("node:fs");
    const payload = resolve(
      process.cwd(),
      "src/lib/assembly/fixtures-mep-cli.json",
    );
    const evidence = {
      runs: [
        {
          id: "p",
          system: "pipe",
          centerline: [
            { x: 0, y: 0, z: 0 },
            { x: 1, y: 0, z: 0 },
          ],
          outerDiameterMm: 1,
        },
      ],
      obstacles: [],
    };
    fs.writeFileSync(payload, JSON.stringify(evidence));
    try {
      expect(
        await run([
          "interior",
          "mep-interference",
          "--file",
          payload,
          "--strict",
        ]),
      ).toBe(codes.server);
      expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(
        "/api/cad/v1/interior/mep-interference/verify",
      );
      expect(
        JSON.parse(String((fetchSpy.mock.calls[0]?.[1] as RequestInit).body)),
      ).toEqual(evidence);
    } finally {
      fs.unlinkSync(payload);
      fetchSpy.mockRestore();
      stdout.mockRestore();
    }
  });

  it("animation command forwards the shared payload and command text", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          deterministic: true,
          animation: { tracks: [] },
        }),
        { status: 200 },
      ),
    );
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const payload = resolve(
      process.cwd(),
      "src/lib/assembly/fixtures-animation-command-cli.json",
    );
    const fs = await import("node:fs");
    fs.writeFileSync(
      payload,
      JSON.stringify({
        state: { parts: [], mates: [] },
        animation: { version: 1, tracks: [] },
      }),
    );
    try {
      expect(
        await run([
          "animation",
          "command",
          "--file",
          payload,
          "--command",
          "0~10 frames arm X 5mm",
        ]),
      ).toBe(codes.ok);
      expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(
        "/api/cad/v1/assembly/animation/command",
      );
      const request = fetchSpy.mock.calls[0]?.[1] as RequestInit;
      expect(JSON.parse(String(request.body)).command).toBe(
        "0~10 frames arm X 5mm",
      );
    } finally {
      fs.unlinkSync(payload);
      fetchSpy.mockRestore();
      stdout.mockRestore();
    }
  });
  it("animation verify preserves precise TOI controls and strict release failure", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: true,
            releaseReady: false,
            precise: {
              continuous: { timeOfImpact: [{ status: "collision_bracket" }] },
            },
          }),
          { status: 200 },
        ),
      ),
      stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true),
      payload = resolve(
        process.cwd(),
        "src/lib/assembly/fixtures-animation-toi-cli.json",
      ),
      fs = await import("node:fs"),
      body = {
        state: { parts: [], mates: [] },
        animation: { version: 1, tracks: [] },
        localBoxes: {},
        featureTrees: {},
        toiMaxDepth: 20,
        toiFrameTolerance: 0.001,
        toiMaxEvaluations: 4096,
      };
    fs.writeFileSync(payload, JSON.stringify(body));
    try {
      expect(
        await run(["animation", "verify", "--file", payload, "--strict"]),
      ).toBe(codes.server);
      expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(
        "/api/cad/v1/assembly/animation/verify",
      );
      expect(
        JSON.parse(String((fetchSpy.mock.calls[0]?.[1] as RequestInit).body)),
      ).toEqual(body);
    } finally {
      fs.unlinkSync(payload);
      fetchSpy.mockRestore();
      stdout.mockRestore();
    }
  });

  it("assembly edit forwards --verify-brep to the shared API", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, preview: {} }), {
        status: 200,
      }),
    );
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const payload = resolve(
      process.cwd(),
      "src/lib/assembly/fixtures-selection-edit-brep-cli.json",
    );
    const fs = await import("node:fs");
    fs.writeFileSync(
      payload,
      JSON.stringify({
        state: { parts: [], mates: [] },
        featureTrees: {},
        selection: [],
        command: "depth 8mm",
      }),
    );
    try {
      expect(
        await run(["assembly", "edit", "--file", payload, "--verify-brep"]),
      ).toBe(codes.ok);
      const request = fetchSpy.mock.calls[0]?.[1] as RequestInit;
      expect(JSON.parse(String(request.body)).verifyBrep).toBe(true);
    } finally {
      fs.unlinkSync(payload);
      fetchSpy.mockRestore();
      stdout.mockRestore();
    }
  });

  it("B-rep push-pull writes the returned STEP artifact", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          step: Buffer.from("STEP").toString("base64"),
        }),
        { status: 200 },
      ),
    );
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const fs = await import("node:fs");
    const payload = resolve(
        process.cwd(),
        "src/lib/assembly/fixtures-brep-push-cli.json",
      ),
      out = resolve(process.cwd(), "src/lib/assembly/fixtures-brep-push.step");
    fs.writeFileSync(
      payload,
      JSON.stringify({
        step: "abc",
        encoding: "base64",
        faceRef: "f.import.0",
        distanceMm: 2,
      }),
    );
    try {
      expect(
        await run(["brep", "push-pull", "--file", payload, "--out", out]),
      ).toBe(codes.ok);
      expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(
        "/api/cad/v1/brep/push-pull",
      );
      expect(fs.readFileSync(out, "utf8")).toBe("STEP");
    } finally {
      fs.unlinkSync(payload);
      if (fs.existsSync(out)) fs.unlinkSync(out);
      fetchSpy.mockRestore();
      stdout.mockRestore();
    }
  });

  it("assembly edit forwards selection context and command", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, preview: {} }), {
        status: 200,
      }),
    );
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const payload = resolve(
      process.cwd(),
      "src/lib/assembly/fixtures-selection-edit-cli.json",
    );
    const fs = await import("node:fs");
    fs.writeFileSync(
      payload,
      JSON.stringify({
        state: { parts: [], mates: [] },
        featureTrees: {},
        selection: [],
      }),
    );
    try {
      expect(
        await run([
          "assembly",
          "edit",
          "--file",
          payload,
          "--command",
          "메이트 거리 10mm",
        ]),
      ).toBe(codes.ok);
      expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(
        "/api/cad/v1/assembly/selection-edit",
      );
      const request = fetchSpy.mock.calls[0]?.[1] as RequestInit;
      expect(JSON.parse(String(request.body)).command).toBe("메이트 거리 10mm");
    } finally {
      fs.unlinkSync(payload);
      fetchSpy.mockRestore();
      stdout.mockRestore();
    }
  });
});
