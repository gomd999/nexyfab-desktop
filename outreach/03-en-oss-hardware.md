# English-language OSS Hardware Community — Content Pack

Target channels:
- **Hacker News** (Show HN)
- **r/electronics**, **r/3Dprinting**, **r/AskEngineers**, **r/CNC**, **r/openSCAD**
- **GitHub**: blog post + repo "examples" featured
- **DevTo / Indie Hackers**: founder-narrative format
- **Twitter/X**: short threads with screenshots

Positioning rule (memory `nexyfab-gtm`): **never claim "SolidWorks-tier"** — honest copy only.

---

## Show HN draft

**Title**: Show HN: NexyFab — Browser-based parametric CAD with OpenSCAD round-trip + Korean factory fulfillment

> Hi HN,
>
> I've been building NexyFab — a browser-based parametric CAD designed for the niche of (a) OpenSCAD code authors who want a GUI when convenient and (b) anyone designing physical parts who wants to skip the "find a factory" step and have a Korean fab quote the design directly.
>
> What's actually shipped today:
>
> - **Parametric CAD** with sketch + extrude + assembly + 12 base primitives. Standard features: fillet, chamfer, shell, hole, draft, linear/circular pattern, mirror, sheet metal (bend / flange / hem / jog / flat pattern).
> - **OpenSCAD round-trip**: GUI design → emits OpenSCAD; paste OpenSCAD → parsed back into the feature tree (cube / cylinder / sphere + `translate()` are supported; `union/difference` recurse).
> - **AI-assisted design**: natural-language → JSON intent → deterministic OpenSCAD → STL. Stage 2 layer validates intent schema, runs parameter-feasibility checks, DFM gate per process (FDM / SLA / CNC / injection / sheet metal). Every AI-generated design carries a "🤖 draft — verify before ordering" watermark by default.
> - **Real-time multi-user editing**: Yjs CRDT over SSE, with origin-isolated undo, presence cursors, conflict log.
> - **One-click RFQ to Korean partners**: design → pick a fab → place order. Multi-dimensional partner rating (lead time / quality / responsiveness / communication) instead of single credit score.
>
> What's deliberately NOT shipped:
>
> - Class-A surface modelling (you'll want Alias or Rhino for automotive bodies).
> - FEA solver — we ship preview-grade stress viz + Ansys/Onshape export; the real solve happens elsewhere.
> - CAM post-processor — we emit basic ISO 6983 G-code for preview only; production posting happens at the partner shop.
> - Mold tools, CAM toolpath optimisation, fluid simulation.
>
> The positioning is mid-tier web CAD with two genuine differentiators: OpenSCAD interop and integrated Korean factory fulfilment. Not trying to replace SolidWorks. Free tier: 1 project full workflow. Pro tier: unlimited projects + photoreal rendering + partner search.
>
> Open to feedback. Demo mode (no signup) at nexyfab.com.
>
> — gomd9 / NexySys

---

## r/openSCAD targeted post

**Title**: A web CAD that round-trips OpenSCAD (cube / cylinder / sphere + translate)

> Wanted to share the OpenSCAD bits since this is the round-trip community.
>
> NexyFab's SCAD code panel lets you:
>
> 1. **Forward** — design in the GUI, get OpenSCAD output. Useful when you want to commit the design to git, version-control parameters, or share with someone who only has OpenSCAD installed.
>
> 2. **Reverse** — paste OpenSCAD into the panel, hit Apply, and the parser maps it to a feature in the GUI tree. Currently supports `cube([w,h,d])`, `cylinder(h=, r=)`, `sphere(r=)`, single-level `translate([x,y,z])` prefix, and top-level `union/difference/intersection` containers (recurse into the first inner primitive).
>
> 3. **Auto-apply** — toggle in the panel: as you type SCAD, parses every 600ms and pushes recognised primitives to the scene. Silent on parse failure during typing.
>
> Limitations:
> - No `module` / `function` resolution yet.
> - No expression evaluation (numbers only).
> - Single primitive per file for reverse direction.
>
> Roadmap (`translate → moveCopy feature` is in; rotate prefix capture is next).
>
> Demo: nexyfab.com → 3D modeller → OpenSCAD panel (right side).

---

## r/3Dprinting / r/electronics short-form

> If you ever wanted "design in the browser → click → CNC'd part in the mail" without leaving one tab, NexyFab does that. OpenSCAD code round-trip too. Demo mode no signup: nexyfab.com.

---

## DevTo / IndieHackers founder narrative

**Title**: Lessons from building a Korean-fulfilment web CAD as a solo founder (with honest about what I'm not building)

Outline:
1. **Why niche down** — SW급 web CAD attempt fails at solo scale; OpenSCAD + Korea fulfillment niche is defensible.
2. **What I chose not to build** — CAM post / Class-A surfaces / FEA solver. Why honesty in marketing copy compounds vs. "fake it til you make it".
3. **Tech stack** — Next.js 14, Three.js / React Three Fiber, replicad (OCCT WASM), Yjs CRDT, GPT-4 / Claude for NL→intent, Cloudflare R2 for assets, Railway for backend.
4. **Cold-start strategy** — short-side (factory) subsidy: first 20 factories free for life. Why two-sided marketplaces almost always die on the supply side without it.
5. **Numbers** — N tests, M lines, K design partners after 30 days.

Goal: 1-2 paragraph CTA at the end pointing to nexyfab.com.

---

## Twitter/X thread (10 tweets)

1. Most "web CAD" tools either (a) Onshape-clone and stop or (b) ship sketch+extrude and call it done. NexyFab tries something different — picks the niche of OpenSCAD users + Korean factory fulfilment and goes deep on those.

2. OpenSCAD round-trip is the killer feature for hardware-OSS people. Write code, see it in the GUI, edit GUI, get code back. ([screenshot])

3. The other piece — every design has a "send to fab" button. Multi-dimensional partner rating (lead / quality / response / communication) instead of single score.

4. Things I deliberately don't ship: CAM post-processor. FEA solver. Class-A surfaces. Mold tools. These would each take a team-year. I emit preview output + export to the real tool.

5. AI integration: natural-language → intent JSON → deterministic OpenSCAD → STL. AI-generated parts carry a permanent "draft, verify before ordering" watermark. DFM gate before order accepts.

6. CRDT multi-user editing via Yjs. Presence cursors, origin-isolated undo (you can undo your own edits without reverting your collaborator's). Offline queue + reconnect replay.

7. Sheet metal: bend / flange / hem / jog. K-factor library for 7 materials. Flat pattern export DXF. Bend table inline in the drawing.

8. Drawing module: 7 standard projections, GD&T (ASME Y14.5 + ISO 1101 — 14 symbols), centermark/centerline, section view, ISO 7200 title block.

9. Assembly: 11 mate types including gear + belt with rotation ratio kinematics. Position drivers for animation. Sub-assembly hierarchy. Component patterns (linear / circular).

10. Demo mode (no signup) at nexyfab.com. Honest feedback welcome — I'd rather hear what's broken than what looks good.

---

## GitHub blog post

**Title**: Building a CAD platform as one person — what to ship and what to refuse

(Long-form essay version of the DevTo post — more technical, with code snippets / arch diagrams. Cross-post to company blog under "engineering" tag.)
