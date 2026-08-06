import type { CadCorpusTrack } from "./cadCorpusGovernance";

export interface CadGoldenScenario {
  id: string;
  track: CadCorpusTrack;
  discoveryTerms: string[];
  preferredFormats: string[];
  assertions: string[];
  redistribution: "forbidden_until_proven";
}

/** Discovery metadata only. No third-party CAD bytes or proprietary absolute paths are shipped. */
export const CAD_GOLDEN_SCENARIOS: CadGoldenScenario[] = [
  {
    id: "mearm-motion",
    track: "motion",
    discoveryTerms: ["mearm", "mearm-robotic-arm"],
    preferredFormats: ["x_t", "step", "stp", "stl"],
    assertions: [
      "part_count",
      "assembly_hierarchy",
      "mates_or_joints",
      "motion_collision",
    ],
    redistribution: "forbidden_until_proven",
  },
  {
    id: "fastener-stack",
    track: "mechanical",
    discoveryTerms: ["bolt", "nut", "washer", "m10"],
    preferredFormats: ["step", "stp"],
    assertions: [
      "independent_parts",
      "concentric_mate",
      "bom_quantity",
      "geometry_step_roundtrip",
    ],
    redistribution: "forbidden_until_proven",
  },
  {
    id: "gearbox-assembly",
    track: "mechanical",
    discoveryTerms: ["gearbox", "gear box", "planetary"],
    preferredFormats: ["step", "stp"],
    assertions: [
      // Governed corpus exports are flat NAUO graphs. Preserve their source
      // hierarchy exactly; do not invent a nested assembly that is absent.
      "assembly_hierarchy",
      "shaft_bearing_layout",
      "pattern_fidelity",
      "bom_quantity",
    ],
    redistribution: "forbidden_until_proven",
  },
  {
    id: "electrical-cabinet",
    track: "sheet_metal",
    discoveryTerms: ["electrical cabinet", "cabinet"],
    preferredFormats: ["step", "stp", "dxf"],
    assertions: [
      "independent_panels",
      "flat_pattern",
      "bend_table",
      "bom_quantity",
    ],
    redistribution: "forbidden_until_proven",
  },
  {
    id: "welded-structure",
    track: "weldment",
    discoveryTerms: ["conveyor", "stair", "frame"],
    // The governed real weldment corpus is SPIRAL STAIRCASE.stp. STEP and
    // STP are equivalent Part-21 encodings; putting STP first prevents the
    // unrelated single-solid Staircase.step from winning on extension alone.
    preferredFormats: ["stp", "step"],
    assertions: ["member_identity", "miter_lengths", "cut_list", "mass"],
    redistribution: "forbidden_until_proven",
  },
  {
    id: "heavy-equipment-motion",
    track: "motion",
    discoveryTerms: [
      "wheel loader",
      "wheel-loader",
      "excavator",
      "volvo-excavator",
    ],
    preferredFormats: ["step", "stp"],
    assertions: [
      "pose_preservation",
      "independent_parts",
      "motion_collision",
      "clearance",
    ],
    redistribution: "forbidden_until_proven",
  },
  {
    id: "nist-pmi",
    track: "pmi",
    discoveryTerms: ["nist-pmi", "ap242"],
    preferredFormats: ["step", "stp", "pdf"],
    assertions: [
      "semantic_pmi_count",
      "topology_reference",
      "graphical_semantic_separation",
      "pmi_semantic_roundtrip",
      "geometry_step_roundtrip",
      "step_roundtrip",
    ],
    redistribution: "forbidden_until_proven",
  },
  {
    id: "ifc43-certification",
    track: "open_bim",
    discoveryTerms: [
      "ifc4.3",
      "sample-model",
      "pcert",
      "building-architecture",
    ],
    preferredFormats: ["ifc"],
    assertions: ["guid", "hierarchy", "material", "quantity", "georeference"],
    redistribution: "forbidden_until_proven",
  },
];
