/**
 * Few-shot exemplar library for the freeform OpenSCAD generator.
 *
 * Each entry is a compact, KNOWN-GOOD parametric program in the exact style we
 * want (BOSL2 available, $fn budget, Customizer groups + `name = v; // [min:step:max]`
 * annotations, clean CSG). The most relevant one is injected into the prompt so
 * the model pattern-matches a working structure instead of hand-rolling — which
 * sharply improves dimensional/geometric accuracy for common mechanical parts.
 *
 * Keep exemplars SHORT and unquestionably valid; a broken exemplar teaches bad
 * patterns.
 */
export interface ScadExemplar {
  id: string;
  keywords: string[];
  scad: string;
}

export const SCAD_EXEMPLARS: ScadExemplar[] = [
  {
    id: 'l-bracket',
    keywords: ['bracket', 'angle', 'l-bracket', 'mount', 'mounting', 'gusset', 'corner brace', '브래킷', '브라켓', '앵글', '마운트'],
    scad: `include <BOSL2/std.scad>
$fn = 48;
/* [Bracket] */
leg_a = 60;        // [30:1:120]
leg_b = 40;        // [30:1:120]
width = 30;        // [15:1:60]
thick = 5;         // [2:0.5:10]
/* [Holes] */
hole_d = 6;        // [3:0.5:12]
edge_gap = 10;     // [5:1:25]
module l_bracket() {
  difference() {
    union() {
      cube([leg_a, width, thick]);
      cube([thick, width, leg_b]);
    }
    for (y = [edge_gap, width - edge_gap]) {
      translate([leg_a - edge_gap, y, -1]) cylinder(d = hole_d, h = thick + 2);
      translate([-1, y, leg_b - edge_gap]) rotate([0, 90, 0]) cylinder(d = hole_d, h = thick + 2);
    }
  }
}
l_bracket();`,
  },
  {
    id: 'enclosure',
    keywords: ['enclosure', 'box', 'case', 'housing', 'lid', 'project box', 'shell', 'container', '케이스', '박스', '하우징', '인클로저', '뚜껑'],
    scad: `include <BOSL2/std.scad>
$fn = 48;
/* [Enclosure] */
len = 80;          // [40:1:160]
wid = 60;          // [30:1:120]
hgt = 30;          // [15:1:80]
wall = 2;          // [1:0.5:5]
corner_r = 3;      // [0:0.5:8]
module enclosure() {
  difference() {
    cuboid([len, wid, hgt], rounding = corner_r, edges = "Z", anchor = BOTTOM);
    // hollow interior (open top)
    translate([0, 0, wall])
      cuboid([len - 2 * wall, wid - 2 * wall, hgt], rounding = max(0, corner_r - wall), edges = "Z", anchor = BOTTOM);
  }
}
enclosure();`,
  },
  {
    id: 'flange',
    keywords: ['flange', 'bolt circle', 'pcd', 'pipe flange', 'mounting plate', 'round plate', '플랜지', '플랜지', '볼트원'],
    scad: `include <BOSL2/std.scad>
$fn = 64;
/* [Flange] */
outer_d = 80;      // [40:1:160]
bore_d = 30;       // [10:1:100]
thick = 8;         // [3:0.5:20]
/* [Bolts] */
bolt_count = 6;    // [3:1:12]
bolt_d = 8;        // [4:0.5:16]
bolt_pcd = 60;     // [30:1:140]
module flange() {
  difference() {
    cylinder(d = outer_d, h = thick);
    translate([0, 0, -1]) cylinder(d = bore_d, h = thick + 2);
    for (i = [0 : bolt_count - 1])
      rotate(i * 360 / bolt_count)
        translate([bolt_pcd / 2, 0, -1]) cylinder(d = bolt_d, h = thick + 2);
  }
}
flange();`,
  },
  {
    id: 'standoff',
    keywords: ['standoff', 'spacer', 'pillar', 'boss', 'pcb', 'riser', '스탠드오프', '스페이서', '기둥', '받침'],
    scad: `include <BOSL2/std.scad>
$fn = 48;
/* [Standoff] */
height = 15;       // [5:1:60]
outer_d = 8;       // [4:0.5:20]
bore_d = 3.2;      // [2:0.1:10]
module standoff() {
  difference() {
    cylinder(d = outer_d, h = height);
    translate([0, 0, -1]) cylinder(d = bore_d, h = height + 2);
  }
}
standoff();`,
  },
  {
    id: 'spur-gear',
    keywords: ['gear', 'spur', 'cog', 'sprocket', 'pinion', 'teeth', '기어', '톱니', '스퍼'],
    scad: `include <BOSL2/std.scad>
include <BOSL2/gears.scad>
$fn = 48;
/* [Gear] */
teeth = 24;        // [8:1:80]
circ_pitch = 8;    // [3:0.5:20]
thick = 10;        // [3:0.5:30]
bore_d = 8;        // [3:0.5:30]
module gear() {
  difference() {
    spur_gear(circ_pitch = circ_pitch, teeth = teeth, thickness = thick, gear_spin = 0);
    translate([0, 0, -1]) cylinder(d = bore_d, h = thick + 2);
  }
}
gear();`,
  },
  {
    id: 'knob',
    keywords: ['knob', 'dial', 'handle', 'grip', 'wheel', 'cap', '노브', '손잡이', '다이얼', '핸들'],
    scad: `include <BOSL2/std.scad>
$fn = 64;
/* [Knob] */
diameter = 30;     // [15:1:80]
height = 18;       // [8:1:50]
grips = 24;        // [0:1:48]
grip_d = 2.5;      // [1:0.5:6]
shaft_d = 6;       // [3:0.5:12]
module knob() {
  difference() {
    union() {
      cylinder(d = diameter, h = height);
      if (grips > 0)
        for (i = [0 : grips - 1])
          rotate(i * 360 / grips)
            translate([diameter / 2, 0, 0]) cylinder(d = grip_d, h = height);
    }
    translate([0, 0, -1]) cylinder(d = shaft_d, h = height + 2);
  }
}
knob();`,
  },
  {
    id: 'pulley',
    keywords: ['pulley', 'belt', 'sheave', 'v-groove', 'idler', '풀리', '벨트', '도르래'],
    scad: `include <BOSL2/std.scad>
$fn = 72;
/* [Pulley] */
outer_d = 40;      // [20:1:120]
thick = 12;        // [5:1:40]
bore_d = 8;        // [3:0.5:20]
groove_d = 5;      // [1:0.5:12]
module pulley() {
  difference() {
    cylinder(d = outer_d, h = thick);
    translate([0, 0, thick / 2]) rotate_extrude() translate([outer_d / 2, 0, 0]) circle(d = groove_d);
    translate([0, 0, -1]) cylinder(d = bore_d, h = thick + 2);
  }
}
pulley();`,
  },
  {
    id: 'vase',
    keywords: ['vase', 'cup', 'pot', 'bottle', 'bowl', 'planter', 'goblet', '꽃병', '컵', '화분', '병', '그릇'],
    scad: `include <BOSL2/std.scad>
$fn = 96;
/* [Vase] */
height = 120;      // [40:1:250]
base_d = 50;       // [20:1:120]
neck_d = 32;       // [15:1:100]
wall = 2;          // [1:0.5:6]
function prof(b, n, h) = [[0, 0], [b / 2, 0], [b / 2 * 0.92, h * 0.45], [n / 2, h], [0, h]];
module vase() {
  difference() {
    rotate_extrude() polygon(prof(base_d, neck_d, height));
    translate([0, 0, wall]) rotate_extrude() polygon(prof(base_d - 2 * wall, neck_d - 2 * wall, height));
  }
}
vase();`,
  },
];

/** Pick the single most relevant exemplar for a prompt, or null if no decent
 *  match (avoids steering an unrelated request toward the wrong pattern). */
export function pickExemplar(prompt: string): ScadExemplar | null {
  const p = prompt.toLowerCase();
  let best: ScadExemplar | null = null;
  let bestScore = 0;
  for (const ex of SCAD_EXEMPLARS) {
    let score = 0;
    for (const k of ex.keywords) if (p.includes(k.toLowerCase())) score += 1;
    if (score > bestScore) { bestScore = score; best = ex; }
  }
  return bestScore > 0 ? best : null;
}
