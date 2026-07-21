# AI Design Partner — Onboarding

_Wave A · GA3 material. This document is honest about what the AI design driver can and cannot do today, and about exactly what we measure while you use it. If anything here reads as marketing rather than fact, it is a bug — please tell us._

---

## 1. What this is

You give a **brief** — one line describing a mechanical part — and the system returns a **verified design package**, or an **explicit refusal**. Nothing in between. There is no "here's a shape, trust us": a package exists only when every verification gate has passed on the actual geometry.

The split of labour is deliberate:

- **Planning is done by an LLM.** Turning your words into a structured design plan (parts, features, dimensions to check, assembly mates) is the model's job.
- **Verification is deterministic.** Once a plan exists, everything downstream — meshing, volume measurement, assembly solve, drawing dimension measurement, manufacturability checks — is executed by code. The same plan always produces the same numbers. The LLM never gets to _assert_ a measurement.

So "the AI designed it" is a real claim only up to the plan. The correctness you can rely on comes from the gates, not from the model's confidence.

---

## 2. What it can do today (honest coverage)

The deterministic gates that back a package:

| Gate | What it actually checks |
|------|------------------------|
| **Geometry** | Measures the as-meshed volume of each part and compares it to a theoretical value **with a stated derivation basis**. A theoretical volume with no stated basis is rejected. |
| **Assembly** | Runs the real mate solver (concentric / coincident / …) and requires the residual to converge below tolerance. |
| **DFM (manufacturability)** | Runs the process-specific design-for-manufacture check (e.g. CNC). |
| **Drawing** | Generates the standard 3-view sheet, **measures** each requested dimension off the real topology, and compares to the expected nominal within a tight absolute tolerance. Emits DXF with the measured labels. |

Best-covered part family: **extrude-based prismatic parts** (brackets, plates, blocks, spacers) and **stacked round sections**. Try the [sample briefs](#6-sample-briefs) first — the fixture-backed ones run end to end with no LLM and every gate green, so you can see the whole flow before trusting it on your own part.

---

## 3. Explicit limits (please read before relying on it)

These are current, real limitations — not roadmap teasers:

- **DXF is not associative.** The DXF we emit carries the measured dimension labels, but it is an export artifact, not a live-linked drawing. Editing the DXF does not change the model.
- **Revolve/loft dimensions are not measured.** Round sections are handled as polygon-tessellated extrudes (their cap vertices lie exactly on the true circle, and the measurement engine verifies concyclicity to return the exact diameter). True revolve / loft bodies have no stable topology-name builder yet, so dimensions on genuine revolved geometry are **not** gate-checked. Tessellated-cylinder volumes are approximations, and the deviation vs the analytic `πr²h` is always stated in the package — never hidden.
- **FEA / structural checks are not legally certifying.** Any stress or structural output is engineering guidance, not a stamped calculation. Do not submit it as a code-compliance document.
- **Free-text without a matched fixture requires the real LLM planner.** The deterministic demo planner only knows a fixed set of fixtures; anything else it **refuses** rather than guessing (a guessed plan would be fabrication). Free-text briefs go to the LLM planner, whose plans are then held to the same deterministic gates.
- **Manufacturing-process realism is partial.** Bend/forming limits for sheet-metal parts, for example, are not modelled by the current gates.

When a gate cannot honestly pass, you get a **refusal** stating the stage, the reason, and the failed gate ids — not a lowered bar.

---

## 4. What we measure (autonomy metrics) and why

To ever claim "the AI does most of the work," we have to _measure_ it, not assert it. While you use the design partner, we record a small set of events per run and compute three separate numbers. We report them side by side and never fuse them into one "autonomy score" — choosing weights for a single score would itself be a fabrication before we have data.

**The three axes:**

1. **Zero-touch rate** — the fraction of runs that reached final approval with **zero human interventions**. A run that was abandoned does not count as zero-touch even if nobody intervened (a human giving up is not automation succeeding). Always shown as a fraction, e.g. `50.0% (3/6)`.
2. **Mean interventions per run** — an intervention is a change-request or a human-initiated gate retry. A driver's own automatic retries are **not** counted as human labour (they are tracked separately as an engine-stability signal). One intervention and seven interventions are different, so we keep the depth, not just the yes/no.
3. **Median review time** — over runs that actually had a review session. Runs with no review are excluded (folding a zero into the median would wrongly say "reviews were fast"). Median, not mean, because review time is expected to have a long right tail.

**Sample size is always attached.** Below 5 runs, every number is flagged **low sample** — shown, but explicitly labelled not statistically reliable. We do not invent a target autonomy number before the first real measurement; targets are set per-axis, after data exists.

### What is collected

Per run, timestamped events only:

- run start; final outcome (approved / abandoned / in-progress);
- change-requests (and how many comments each carried);
- gate retries (marked human vs automatic);
- reruns;
- review session start/end pairs (to time reviews).

### Privacy

- We record **event types and timings**, not the content of your brief or your geometry, for the autonomy metrics.
- Timestamps are used only to compute durations (review time). No raw clock is inferred by the metric code — the caller supplies the times.
- Metrics are aggregated with sample sizes; single-run numbers are never presented as a rate.
- Refused/invalid event sequences are excluded from the rate and shown separately with the reason — they are never silently dropped, and never counted as a success or a failure.

---

## 5. A session, end to end

1. **Brief** — write one line, or pick a sample brief. (For the deterministic demo, pick a fixture; for your own part, use free text.)
2. **Verification package** — the driver plans, then runs every gate. You get either:
   - a **package**: per-part measured volume, measured drawing dimensions, gate report (each gate id · pass · measured value), DXF, and a BOM if there is an assembly; plus the approximation/limitation notes; **or**
   - a **refusal**: stage, reason, and the ids of the gates that failed. No package, no fabricated numbers.
3. **Review** — approve, or request changes. **Approval cannot override a failed gate.** A verification failure cannot enter `main` even with human approval — the only path forward is a change request, which becomes the next run's input.
4. **Approve / request changes** — approval merges the run; a change request issues a revision directive that feeds the next run. Each of these is one of the events the autonomy metrics record.

---

## 6. Sample briefs

The onboarding sample set (see `src/lib/ai/design-driver/sampleBriefs.ts`) has two tiers:

- **Fixture tier** — backed by a known fixture; runs end to end deterministically with every gate green. Start here: `L-bracket`, `Stepped shaft`, `Pin + block assembly`.
- **Free-text tier** — real-shaped requests within the gates' coverage (mounting plate, spacer bushing, ribbed bracket) that need the LLM planner. Each carries an explicit statement of what verification _would_ enforce once a plan exists.

Each sample brief ships with its **expected coverage** note so you can see, before running, exactly which gates apply and where the honest limits are.

---

## 7. Measurement consent

> By using the AI design partner, you agree that we record **timestamped process events** for each run — run start and outcome, interventions (change-requests and human gate retries), reruns, and review start/end times — for the sole purpose of measuring design-automation performance (the autonomy metrics above). We record **event types and timings, not the content of your briefs or geometry**, for these metrics. Numbers are always reported with their sample size, and low-sample results are labelled as such. You can request that your run events be excluded from the metrics at any time.

If you do not consent to measurement, you can still use the design driver — the metrics collection is separable from the verification pipeline.
