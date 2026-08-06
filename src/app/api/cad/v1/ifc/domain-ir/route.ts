import { NextRequest, NextResponse } from "next/server";
import { getTrustedClientIp } from "@/lib/client-ip";
import { rateLimit } from "@/lib/rate-limit";
import {
  buildIfcAlignmentIr,
  buildIfcStructuralIr,
} from "@/lib/reference/ifcDomainIr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_IFC_BYTES = 20 * 1024 * 1024;
export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`cad-v1-ifc-domain-ir:${ip}`, 20, 60_000).allowed)
    return NextResponse.json(
      { ok: false, code: "RATE_LIMIT" },
      { status: 429 },
    );
  const body = (await req.json().catch(() => null)) as unknown;
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some(
      (key) => !["ifc", "domain", "vienneseBendInputs"].includes(key),
    )
  )
    return NextResponse.json(
      { ok: false, code: "BAD_REQUEST" },
      { status: 400 },
    );
  const input = body as {
    ifc?: unknown;
    domain?: unknown;
    vienneseBendInputs?: unknown;
  };
  if (
    typeof input.ifc !== "string" ||
    !input.ifc.trim() ||
    !["alignment", "structural-analysis"].includes(String(input.domain))
  )
    return NextResponse.json(
      {
        ok: false,
        code: "BAD_REQUEST",
        message: "Inline IFC and explicit domain are required.",
      },
      { status: 400 },
    );
  if (Buffer.byteLength(input.ifc, "utf8") > MAX_IFC_BYTES)
    return NextResponse.json(
      { ok: false, code: "PAYLOAD_TOO_LARGE", maxIfcBytes: MAX_IFC_BYTES },
      { status: 413 },
    );
  try {
    let vienneseBendInputs:
      | Record<number, { gravityCenterHeight: number; provenance: string }>
      | undefined;
    if (input.vienneseBendInputs !== undefined) {
      if (
        input.domain !== "alignment" ||
        !input.vienneseBendInputs ||
        typeof input.vienneseBendInputs !== "object" ||
        Array.isArray(input.vienneseBendInputs)
      )
        return NextResponse.json(
          {
            ok: false,
            code: "BAD_REQUEST",
            message: "Viennese inputs require an alignment domain object.",
          },
          { status: 400 },
        );
      vienneseBendInputs = {};
      for (const [key, value] of Object.entries(input.vienneseBendInputs)) {
        const id = Number(key),
          entry = value as {
            gravityCenterHeight?: unknown;
            provenance?: unknown;
          };
        if (
          !Number.isSafeInteger(id) ||
          id <= 0 ||
          !entry ||
          typeof entry !== "object" ||
          Array.isArray(entry) ||
          Object.keys(entry).some(
            (field) => !["gravityCenterHeight", "provenance"].includes(field),
          ) ||
          typeof entry.gravityCenterHeight !== "number" ||
          !Number.isFinite(entry.gravityCenterHeight) ||
          entry.gravityCenterHeight < 0 ||
          typeof entry.provenance !== "string" ||
          !entry.provenance.trim()
        )
          return NextResponse.json(
            {
              ok: false,
              code: "BAD_REQUEST",
              message: `Invalid Viennese input for entity ${key}.`,
            },
            { status: 400 },
          );
        vienneseBendInputs[id] = {
          gravityCenterHeight: entry.gravityCenterHeight,
          provenance: entry.provenance,
        };
      }
    }
    const ir =
      input.domain === "alignment"
        ? buildIfcAlignmentIr(input.ifc, { vienneseBendInputs })
        : buildIfcStructuralIr(input.ifc);
    return NextResponse.json({
      ok: true,
      releaseReady: ir.valid,
      ir,
      sourceReturned: false,
      quoteOrRfqSideEffects: false,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        code: "IFC_DOMAIN_PARSE_FAILED",
        message: error instanceof Error ? error.message : String(error),
        quoteOrRfqSideEffects: false,
      },
      { status: 422 },
    );
  }
}
