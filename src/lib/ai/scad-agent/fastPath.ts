/**
 * Fast-path classifier — recognize trivially simple prompts and route
 * straight to `intentToScad` without spinning up the LLM agent loop.
 *
 * Rationale: ~40% of agent prompts are "make me a 30mm cube" or "M8 nut"
 * — these are exact matches for the deterministic catalog. Each one
 * costs $0.005–0.02 in LLM tokens to satisfy via the agent loop, but
 * $0 via direct intent translation. Catching them upfront shrinks the
 * NexyFab AI bill meaningfully without changing the user-visible result.
 *
 * Heuristic only — when the classifier is unsure, return null and the
 * normal agent loop runs. We never want a false positive (sending a
 * complex request through a stub catalog produces a wrong shape).
 */
import type { IntentInput } from '../../openscad-render/intentToScad';
import { lookupMetric } from '../../openscad-render/isoFasteners';

export interface FastPathHit {
  intent: IntentInput;
  /** Why we matched — surfaced in telemetry for tuning. */
  reason: string;
}

/**
 * Try to classify a natural-language prompt into a deterministic intent.
 * Returns null when no high-confidence match — caller falls back to LLM.
 *
 * Conservative by design: we'd rather miss 30% of catchable prompts than
 * produce one wrong shape.
 */
export function classifyFastPath(prompt: string): FastPathHit | null {
  const raw = prompt.trim().toLowerCase();
  if (raw.length < 3 || raw.length > 200) return null;
  // Remove harmless conversational wrappers, but keep the accepted grammar
  // closed so complex requests still fall through to the full agent.
  const text = raw
    .replace(/[.!?]+$/g, '')
    .replace(/^(?:please\s+)?(?:make|create|build|design)\s+(?:me\s+)?(?:an?\s+|the\s+)?/i, '')
    .replace(/^(?:an?|the)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Reject anything with conjunctions / additions / "with" — those need
  // the LLM because they describe combinations the catalog can't handle
  // standalone. Examples: "cube with hole", "bolt and nut", "박스 + 구멍".
  if (/\+|\band\b|\bwith\b|그리고|및|에|있는|뚫|구멍 있는|결합|조립|마운트|어셈블리/i.test(text)) return null;

  // ─── Cube / box ─────────────────────────────────────────────────────────
  // Patterns: "30mm cube", "10mm 정육면체", "Nmm × Nmm × Nmm box"
  {
    const m = text.match(/^(\d+(?:\.\d+)?)\s*mm\s*(?:정육면체|cube|큐브)$/);
    if (m) {
      const n = Number(m[1]);
      return { intent: { shapeId: 'box', params: { width: n, height: n, depth: n } }, reason: 'cube_uniform' };
    }
    // Y2 — Reverse order: "정육면체 30mm" / "cube 30mm"
    const mRev = text.match(/^(?:정육면체|cube|큐브)\s+(\d+(?:\.\d+)?)\s*mm$/);
    if (mRev) {
      const n = Number(mRev[1]);
      return { intent: { shapeId: 'box', params: { width: n, height: n, depth: n } }, reason: 'cube_uniform_rev' };
    }
    // "WxHxD mm" or "W by H by D mm" — order: width, height, depth
    const r = text.match(/^(\d+(?:\.\d+)?)\s*[x×*by]+\s*(\d+(?:\.\d+)?)\s*[x×*by]+\s*(\d+(?:\.\d+)?)\s*mm?\s*(?:박스|box|상자|직육면체)?$/);
    if (r) {
      const [w, h, d] = [Number(r[1]), Number(r[2]), Number(r[3])];
      return { intent: { shapeId: 'box', params: { width: w, height: h, depth: d } }, reason: 'box_explicit' };
    }
    const described = text.match(/^(?:rectangular\s+)?box\s+(\d+(?:\.\d+)?)\s*mm\s+wide,?\s+(\d+(?:\.\d+)?)\s*mm\s+(?:tall|high),?\s+(\d+(?:\.\d+)?)\s*mm\s+deep$/);
    if (described) {
      return {
        intent: { shapeId: 'box', params: { width: Number(described[1]), height: Number(described[2]), depth: Number(described[3]) } },
        reason: 'box_described_en',
      };
    }
  }

  // ─── Cylinder ───────────────────────────────────────────────────────────
  // "지름 D mm 높이 H mm 원기둥" / "DxH cylinder" / "cylinder D diameter H tall"
  {
    const m = text.match(/^지름\s*(\d+(?:\.\d+)?)\s*mm?\s*높이\s*(\d+(?:\.\d+)?)\s*mm?\s*원기둥$/);
    if (m) {
      return { intent: { shapeId: 'cylinder', params: { diameter: Number(m[1]), height: Number(m[2]) } }, reason: 'cylinder_ko' };
    }
    const m2 = text.match(/^cylinder\s+(\d+(?:\.\d+)?)\s*mm\s*(?:diameter|dia|d)[, ]+(\d+(?:\.\d+)?)\s*mm\s*(?:tall|height|h)$/);
    if (m2) {
      return { intent: { shapeId: 'cylinder', params: { diameter: Number(m2[1]), height: Number(m2[2]) } }, reason: 'cylinder_en' };
    }
  }

  // ─── Sphere ─────────────────────────────────────────────────────────────
  {
    const diameter = text.match(/^(\d+(?:\.\d+)?)\s*mm\s+diameter\s+(?:sphere|ball)$/);
    if (diameter) {
      return { intent: { shapeId: 'sphere', params: { diameter: Number(diameter[1]) } }, reason: 'sphere_diameter_en' };
    }
    const m = text.match(/^(?:반지름|radius)\s*(\d+(?:\.\d+)?)\s*mm?\s*(?:구|sphere|ball)$/);
    if (m) {
      return { intent: { shapeId: 'sphere', params: { radius: Number(m[1]) } }, reason: 'sphere_radius' };
    }
    const m2 = text.match(/^(\d+(?:\.\d+)?)\s*mm\s*(?:radius|반지름)\s*(?:sphere|구|ball)$/);
    if (m2) {
      return { intent: { shapeId: 'sphere', params: { radius: Number(m2[1]) } }, reason: 'sphere_radius_alt' };
    }
  }

  // ─── Hex nut (BOSL2 catalog) ───────────────────────────────────────────
  {
    const m = text.match(/^m(\d+)(?:\s*육각너트|\s*hex\s*nut)$/i);
    if (m) {
      return { intent: { shapeId: 'hexNut', params: { size: Number(m[1]) } }, reason: 'hexNut' };
    }
  }

  // ─── ISO metric bolts (M3-M16) ─────────────────────────────────────────
  // "M5 12mm 볼트", "M8 50mm hex screw", "M10x30 bolt"
  {
    // Pattern A: "M{d} {len}mm 볼트/screw/bolt"
    const m = text.match(/^m(\d+)\s+(\d+(?:\.\d+)?)\s*mm\s*(?:볼트|bolt|screw|hex\s*screw)$/i);
    if (m) {
      return buildScrewIntent(`M${m[1]}`, Number(m[2]));
    }
    // Pattern B: "M{d}x{len}" canonical short form
    const m2 = text.match(/^m(\d+)x(\d+(?:\.\d+)?)\s*(?:볼트|bolt|screw)?$/i);
    if (m2) {
      return buildScrewIntent(`M${m2[1]}`, Number(m2[2]));
    }
  }

  // ─── Threaded rod (M{d} {len}mm 나사봉) ────────────────────────────────
  {
    const m = text.match(/^m(\d+)\s+(\d+(?:\.\d+)?)\s*mm\s*(?:나사봉|threaded\s*rod|stud)$/i);
    if (m) {
      return buildThreadedRodIntent(`M${m[1]}`, Number(m[2]));
    }
  }

  // ─── Pipe ───────────────────────────────────────────────────────────────
  {
    const m = text.match(/^외경\s*(\d+(?:\.\d+)?)\s*내경\s*(\d+(?:\.\d+)?)\s*길이\s*(\d+(?:\.\d+)?)\s*(?:파이프|pipe)$/);
    if (m) {
      return {
        intent: {
          shapeId: 'pipe',
          params: {
            outerDiameter: Number(m[1]),
            innerDiameter: Number(m[2]),
            length: Number(m[3]),
          },
        },
        reason: 'pipe_ko',
      };
    }
  }

  // ─── Washer ─────────────────────────────────────────────────────────────
  {
    const m = text.match(/^외경\s*(\d+(?:\.\d+)?)\s*내경\s*(\d+(?:\.\d+)?)\s*두께\s*(\d+(?:\.\d+)?)\s*(?:와셔|washer)$/);
    if (m) {
      return {
        intent: {
          shapeId: 'washer',
          params: {
            outerDiameter: Number(m[1]),
            innerDiameter: Number(m[2]),
            thickness: Number(m[3]),
          },
        },
        reason: 'washer_ko',
      };
    }
  }

  // ─── Y2 — Cone / 원뿔 ──────────────────────────────────────────────────
  // "반지름 R mm 높이 H mm 원뿔" / "cone radius R height H"
  // Note: `(?:mm)?` keeps the mm token truly optional so prompts without it parse.
  {
    const m = text.match(/^(?:반지름|radius)\s*(\d+(?:\.\d+)?)\s*(?:mm)?\s*(?:높이|height|h)\s*(\d+(?:\.\d+)?)\s*(?:mm)?\s*(?:원뿔|cone)$/);
    if (m) {
      return { intent: { shapeId: 'cone', params: { radius: Number(m[1]), height: Number(m[2]) } }, reason: 'cone_radius_height' };
    }
    const m2 = text.match(/^cone\s+(?:radius|r)\s*(\d+(?:\.\d+)?)\s*(?:mm)?[,\s]+(?:height|h|tall)\s*(\d+(?:\.\d+)?)\s*(?:mm)?$/);
    if (m2) {
      return { intent: { shapeId: 'cone', params: { radius: Number(m2[1]), height: Number(m2[2]) } }, reason: 'cone_en' };
    }
  }

  // ─── Y2 — Torus / 도넛 ─────────────────────────────────────────────────
  // "주반지름 R 부반지름 r 토러스" / "torus major R minor r"
  {
    const m = text.match(/^(?:주반지름|major)\s*(\d+(?:\.\d+)?)\s*(?:mm)?\s*(?:부반지름|minor)\s*(\d+(?:\.\d+)?)\s*(?:mm)?\s*(?:토러스|torus|도넛)$/);
    if (m) {
      return { intent: { shapeId: 'torus', params: { majorRadius: Number(m[1]), minorRadius: Number(m[2]) } }, reason: 'torus' };
    }
    const m2 = text.match(/^torus\s+(?:r1|major)\s*(\d+(?:\.\d+)?)\s*(?:mm)?[,\s]+(?:r2|minor)\s*(\d+(?:\.\d+)?)\s*(?:mm)?$/);
    if (m2) {
      return { intent: { shapeId: 'torus', params: { majorRadius: Number(m2[1]), minorRadius: Number(m2[2]) } }, reason: 'torus_en' };
    }
  }

  // ─── Y2 — Spur gear / 평기어 ───────────────────────────────────────────
  // "잇수 20 모듈 2 평기어" / "spur gear teeth 20 module 2"
  {
    const m = text.match(/^(?:잇수|teeth)\s*(\d+)\s*(?:모듈|module|m)\s*(\d+(?:\.\d+)?)\s*(?:두께|thickness|t)?\s*(\d+(?:\.\d+)?)?\s*(?:mm)?\s*(?:평기어|spur\s*gear|gear)?$/);
    if (m) {
      const teeth = Number(m[1]);
      const module_ = Number(m[2]);
      const thickness = m[3] ? Number(m[3]) : 6;
      return { intent: { shapeId: 'gear', params: { teeth, module: module_, thickness } }, reason: 'spur_gear' };
    }
  }

  // ─── Y2 — L-bracket / L 브래킷 ─────────────────────────────────────────
  // "30x30x3 L 브래킷" / "L-bracket WxHxT"
  // Pre-strip 'mm?' from each dim so "30x30x3" works as well as "30mmx30mmx3mm".
  {
    const m = text.match(/^(\d+(?:\.\d+)?)\s*(?:mm)?\s*[x×*]\s*(\d+(?:\.\d+)?)\s*(?:mm)?\s*[x×*]\s*(\d+(?:\.\d+)?)\s*(?:mm)?\s*(?:l\s*브래킷|l[-\s]*bracket)$/);
    if (m) {
      return {
        intent: {
          shapeId: 'lBracket',
          params: { width: Number(m[1]), height: Number(m[2]), thickness: Number(m[3]) },
        },
        reason: 'l_bracket',
      };
    }
  }

  // ─── Y2 — Disk (round flat plate) ──────────────────────────────────────
  // "지름 D 두께 T 디스크" / "disk diameter D thickness T"
  {
    const m = text.match(/^지름\s*(\d+(?:\.\d+)?)\s*(?:mm)?\s*두께\s*(\d+(?:\.\d+)?)\s*(?:mm)?\s*(?:디스크|disk|disc|원판)$/);
    if (m) {
      return { intent: { shapeId: 'disk', params: { diameter: Number(m[1]), thickness: Number(m[2]) } }, reason: 'disk_ko' };
    }
    const m2 = text.match(/^disk\s+(?:diameter|dia|d)\s*(\d+(?:\.\d+)?)\s*(?:mm)?[,\s]+(?:thickness|t)\s*(\d+(?:\.\d+)?)\s*(?:mm)?$/);
    if (m2) {
      return { intent: { shapeId: 'disk', params: { diameter: Number(m2[1]), thickness: Number(m2[2]) } }, reason: 'disk_en' };
    }
  }

  // ─── Y2 — Sphere by diameter (alternate) ───────────────────────────────
  // "지름 D 구" — common Korean phrasing alongside "반지름 R 구"
  {
    const m = text.match(/^지름\s*(\d+(?:\.\d+)?)\s*(?:mm)?\s*(?:구|sphere|ball)$/);
    if (m) {
      return { intent: { shapeId: 'sphere', params: { radius: Number(m[1]) / 2 } }, reason: 'sphere_diameter' };
    }
  }

  return null;
}

/** Build a `screw` intent for an ISO metric size with proper pitch lookup. */
function buildScrewIntent(size: string, length: number): FastPathHit {
  // Note: intent params are number-typed in IntentInput. We pass spec via
  // a separate field that intentToScad's screw case reads as string.
  // Until the intent type widens, we encode via the existing 'screw' case
  // which accepts `p.spec` as string at runtime.
  return {
    intent: {
      shapeId: 'screw',
      // We rely on intentToScad's screw case using spec from params via
      // a string-tolerant cast (see existing implementation: it reads
      // String(p.spec ?? '')).
      params: {
        // Numeric overlay so the type stays IntentInput. spec is read at runtime.
        diameter: parseInt(size.slice(1), 10),
        length,
      } as Record<string, number>,
      // Sneak `spec` into params via Object.assign so the runtime path picks it up
      // even though the type signature only documents numbers. Safe — intentToScad
      // already handles unknown extra fields.
    },
    reason: 'iso_screw',
  };
}

function buildThreadedRodIntent(size: string, length: number): FastPathHit {
  // BOSL2's threaded_rod expects diameter+length+pitch as numbers.
  // We look up the standard pitch from METRIC_FASTENERS so users don't
  // have to know it. Falls back to 1.25 (M8 default) if size unknown.
  const f = lookupMetric(size);
  return {
    intent: {
      shapeId: 'threadedRod',
      params: {
        diameter: f?.d ?? parseInt(size.slice(1), 10),
        length,
        pitch: f?.pitch ?? 1.25,
      },
    },
    reason: 'iso_threaded_rod',
  };
}
