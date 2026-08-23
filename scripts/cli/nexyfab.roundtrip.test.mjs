import { test } from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXIT, main } from "./nexyfab.mjs";

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function capture(fn) {
  const stdoutWrite = process.stdout.write;
  const stderrWrite = process.stderr.write;
  let stdout = "";
  let stderr = "";
  process.stdout.write = (chunk) => {
    stdout += String(chunk);
    return true;
  };
  process.stderr.write = (chunk) => {
    stderr += String(chunk);
    return true;
  };
  try {
    return { code: await fn(), get stdout() { return stdout; }, get stderr() { return stderr; } };
  } finally {
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
  }
}

test("offline CLI help -> capabilities -> geometry/verify roundtrip is deterministic", async () => {
  const root = await mkdtemp(join(tmpdir(), "nexyfab-cli-roundtrip-"));
  const step = join(root, "fixture.step");
  const evidence = join(root, "evidence.json");
  const assembly = join(root, "assembly.json");
  const outputDir = join(root, "package-output");
  const escaped = join(root, "escaped.txt");
  await writeFile(step, "ISO-10303-21;\nEND-ISO-10303-21;\n", "utf8");
  await writeFile(assembly, JSON.stringify({ parts: [{ id: "part-1" }] }), "utf8");

  const calls = [];
  let packagePayload = { ok: true, files: [{ name: "../escaped.txt", content: "must not write" }], zipBase64: null };
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.NEXYFAB_API_KEY;
  process.env.NEXYFAB_API_KEY = "nf_test_roundtrip";
  globalThis.fetch = async (url, init = {}) => {
    const parsed = new URL(String(url));
    calls.push({ path: parsed.pathname, init });
    if (parsed.pathname === "/api/cad/v1/capabilities") {
      return new Response(JSON.stringify({ ok: true, version: "v1", quoteOrRfqSideEffects: false }), { status: 200 });
    }
    if (parsed.pathname === "/api/cad/v1/reference/analyze") {
      return new Response(JSON.stringify({ ok: true, schema: "nexyfab.reference-evidence.v1", releaseReady: true }), { status: 200 });
    }
    if (parsed.pathname === "/api/cad/v1/release/decision") {
      return new Response(JSON.stringify({ ok: true, decision: { status: "blocked" } }), { status: 200 });
    }
    if (parsed.pathname === "/api/cad/v1/assembly/verify") {
      return new Response(JSON.stringify({ ok: true, releaseReady: true }), { status: 200 });
    }
    if (parsed.pathname === "/api/nexyfab/drawing/package") {
      return new Response(JSON.stringify(packagePayload), { status: 200 });
    }
    throw new Error(`unexpected offline route: ${parsed.pathname}`);
  };

  try {
    const help = await capture(() => main(["--help"]));
    assert.equal(help.code, EXIT.ok);
    assert.match(help.stdout, /nexyfab 0\.1\.0/);

    const capabilities = await capture(() => main(["capabilities"]));
    assert.equal(capabilities.code, EXIT.ok);
    assert.match(capabilities.stdout, /quoteOrRfqSideEffects/);
    assert.equal(calls.at(-1).path, "/api/cad/v1/capabilities");

    const analyze = await capture(() => main([
      "reference", "analyze", "--file", step, "--scenario", "fixture-box", "--unit", "mm", "--out", evidence,
    ]));
    assert.equal(analyze.code, EXIT.ok);
    assert.deepEqual(JSON.parse(await readFile(evidence, "utf8")), {
      ok: true,
      schema: "nexyfab.reference-evidence.v1",
      releaseReady: true,
    });
    const analyzeRequest = calls.find((call) => call.path === "/api/cad/v1/reference/analyze");
    assert.ok(analyzeRequest);
    assert.doesNotMatch(JSON.stringify(analyzeRequest.init.body), new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(String(analyzeRequest.init.body), /fixture-box/);

    const release = await capture(() => main(["release", "decision", "--file", evidence]));
    assert.equal(release.code, EXIT.ok);
    assert.match(release.stdout, /blocked/);

    const verify = await capture(() => main(["assembly", "verify", "--file", assembly, "--strict"]));
    assert.equal(verify.code, EXIT.ok);
    assert.equal(calls.at(-1).path, "/api/cad/v1/assembly/verify");

    const malformed = await capture(() => main([
      "reference", "analyze", "--file", join(root, "not-step.txt"), "--scenario", "fixture-box", "--unit", "mm",
    ]));
    assert.equal(malformed.code, EXIT.usage);

    const missing = await capture(() => main(["assembly", "verify", "--file", join(root, "missing.json")]));
    assert.equal(missing.code, EXIT.usage);

    const unknown = await capture(() => main(["does-not-exist"]));
    assert.equal(unknown.code, EXIT.usage);

    const unsafePackage = await capture(() => main(["package", "--file", assembly, "--out", outputDir]));
    assert.equal(unsafePackage.code, EXIT.server);
    assert.match(unsafePackage.stderr, /unsafe package filename/);
    assert.equal(await exists(escaped), false);
    assert.equal(await exists(outputDir), false);

    for (const [label, payload, message] of [
      ["malformed-entry", { ok: true, files: [{ name: "bad.txt", content: 42 }] }, /malformed package file entry/],
      ["duplicate", { ok: true, files: [{ name: "same.txt", content: "a" }, { name: "same.txt", content: "b" }] }, /duplicate package filename/],
      ["bad-zip", { ok: true, files: [], zipBase64: "%%%" }, /malformed package zip data/],
      ["zip-conflict", { ok: true, files: [{ name: "package.zip", content: "not a zip" }], zipBase64: Buffer.from("zip").toString("base64") }, /conflicts with a package file/],
    ]) {
      packagePayload = payload;
      const rejectedDir = join(root, `package-${label}`);
      const rejected = await capture(() => main(["package", "--file", assembly, "--out", rejectedDir]));
      assert.equal(rejected.code, EXIT.server, label);
      assert.match(rejected.stderr, message, label);
      assert.equal(await exists(rejectedDir), false, label);
    }

    packagePayload = { ok: true, files: [{ name: "nested/result.txt", content: "verified output" }], zipBase64: null };
    const validDir = join(root, "package-valid");
    const validPackage = await capture(() => main(["package", "--file", assembly, "--out", validDir]));
    assert.equal(validPackage.code, EXIT.ok);
    assert.equal(await readFile(join(validDir, "nested", "result.txt"), "utf8"), "verified output");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.NEXYFAB_API_KEY;
    else process.env.NEXYFAB_API_KEY = previousKey;
    await rm(root, { recursive: true, force: true });
  }
});
