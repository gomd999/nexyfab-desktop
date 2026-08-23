# Robot verified-product release runbook

The robot lane is a separate verified product, not part of the mechanical-core
self-service claim. It uses NexyFab's integrated kernel and does not require a
SolidWorks, Fusion, or Onshape installation.

Current status and completion targets are governed by
`docs/strategy/ai-mechanical-cad-current-status-and-completion-plan-260811.md`.

## Current implementation baseline

As of 2026-08-12, the current source passes 64 robot/UI/API test files and 265
tests plus the repository-wide TypeScript check. The robot product scope also
passes a selective Next.js production build. The implemented pipeline includes
catalog admission and selection, housing checks, reviewed r+1 integration,
post-integration verification, full payload/path engineering coverage,
adaptive continuous motion, cable life, safety/electrical design evidence,
physical receipts, a server-attested Verified Systems audit, final dual review,
and fail-closed operating UI/API checks.

The current canonical production audit predates the latest integration work.
It still describes the 25-part placeholder demonstrator with 22 unresolved
catalog components. It is historical evidence, not proof of the current
29-part target. Do not edit that audit to make it pass. Execute the current
pipeline and generate a new audit bound to the resulting artifacts.

## Fixed release target

- Six controlled joints and 29 exact r+1 parts.
- 68 mates after the four auxiliary components are integrated.
- 18 selected drive occurrences plus four auxiliary occurrences: brake,
  encoder, harness, and tool connector.
- 22 applied catalog occurrences, zero unresolved catalog components.
- 156/156 isolated-axis frames and 49/49 coordinated frames.
- Zero collision frames and zero precise interferences.

The 156 isolated and 49 coordinated frames are the deterministic regression
floor. They are not an exhaustive workspace, payload, speed, cable-life, or
industrial safety proof.

## Evidence sequence

1. Freeze payload, reach, speed, duty cycle, joint ranges, installation pose,
   repeatability target, power, safety boundary, and manufacturing processes.
2. Admit traceable bytes for the 18 drive and four auxiliary selections. CAD
   files from the suppliers are optional; authoritative ratings, dimensions,
   mass, inertia, interfaces, connector and cable conditions are required.
3. Generate and review the integration packet.
4. Apply it into a new r+1 bundle; never mutate the uploaded source or live
   workspace.
5. Confirm 29 parts, 68 mates, 22 catalog occurrences and zero unresolved
   entries in the actual downloaded program and application receipt.
6. Run post-integration verification and retain the passed report. It must
   bind the same target, program, revision, application and receipt hashes.
7. Build the work packet. It must be
   `nexyfab.robot-release-evidence-work-packet.v3` and binds lineage, revision,
   target, application, receipt, precision, catalog, and housing hashes.
8. Produce and Ed25519-sign exact-CAD evidence using
   `docs/process/robot-exact-cad-evidence-v3.schema.json`. The trusted key is
   supplied through `NEXYFAB_ROBOT_EXACT_CAD_SIGNER_KEYS`.
9. Produce and Ed25519-sign manufacturing evidence using
   `docs/process/robot-manufacturing-validation-v3.schema.json`. The trusted
   key is supplied through `NEXYFAB_ROBOT_MANUFACTURING_REVIEWER_KEYS`.
10. Run every frozen payload × governed path engineering packet, adaptive
    continuous-motion coverage, cable-life sweep and safety/electrical design
    evidence gate.
11. Execute joint-rig, wrist, six-axis prototype and endurance/teardown tests.
    The physical receipt must bind all 27 required measurement subjects to raw
    data, calibration, as-built BOM, uncertainty, operator and independent
    reviewer signatures through `NEXYFAB_ROBOT_PHYSICAL_VALIDATION_KEYS`.
12. Run the Verified Systems audit. It recomputes the CAD/manufacturing and
    physical chains, binds all upstream hashes and signs audit v2 with the
    deployment-only `NEXYFAB_ROBOT_VERIFIED_AUDIT_SIGNER` private key.
13. Register the corresponding public key separately in
    `NEXYFAB_ROBOT_VERIFIED_AUDITOR_KEYS`. Final review rejects unsigned,
    legacy, untrusted or modified audit JSON.
14. Obtain one engineering release reviewer and one independent release-role
    signature after audit issuance. The second role may be internal, but must
    use a distinct identity and key and must not be described as an external
    independent certification. Legacy audit receipts are rejected.

## Accuracy completion work

The software path is nearly complete; accuracy now depends on executing it
with authoritative product inputs and physical observations.

1. Recalculate torque, speed, bearing load/life, fastener capacity, structural
   deflection, mass, inertia and center of gravity for the selected parts.
2. Bind shaft, bearing, reducer pilot, housing and fastener tolerance stacks.
3. Re-run 156 isolated and 49 coordinated frames at zero, rated and eccentric
   payload conditions, including near-singularity poses.
4. Verify cable bend radius, twist accumulation, connector access and service
   envelopes through the governed motion range.
5. Build at least one joint rig and one scaled or full six-axis prototype.
   Record assembly fit, backlash, repeatability, temperature and cable motion.
6. Bind the final NFAB, STEP, drawings, BOM, inspection and test report to the
   same r+1 revision and regenerate the production completion audit.

## Required governed artifacts

Every promoted robot build must retain the following artifacts under one
product, lineage, revision, application and receipt target:

1. `robot-system-requirements.v2.json`
2. traceable component catalog and the 22-component selection receipt
3. exact 29-part, 68-mate r+1 NFAB/STEP/drawing/BOM bundle
4. dynamic load-envelope report
5. drive duty/thermal and bearing/reducer life report
6. structural-compliance and TCP error-budget report
7. motion-coverage and continuous-collision report
8. cable-life sweep and service-envelope report
9. hazard register, safety-function matrix and electrical evidence package
10. manufacturing and inspection plan
11. joint-rig and six-axis physical-validation receipts
12. exact-CAD, manufacturing, safety and dual-review release receipts

Missing artifacts remain `not_run`; they are never inferred from a passing
CAD, assembly, or motion report.

## Engineering verification gates

### Dynamic drive gate

For every frozen payload and governed path:

- peak and RMS torque stay inside the selected motor/reducer curves;
- speed, acceleration, jerk, power and regenerative conditions stay inside
  their approved limits;
- brake holding and emergency-stop cases retain positive margin;
- bearing and reducer life meet the frozen life requirement;
- duty-cycle thermal limits pass with authoritative component data.

If a required manufacturer curve, rating, duty rule or life input is absent,
the result is `not_run`, not a conservative pass.

### Accuracy and stiffness gate

The report must propagate reducer lost motion, bearing clearance, shaft/link/
housing compliance, encoder error, manufacturing stack-up, thermal growth and
calibration error to TCP position and orientation. The predicted worst case
must meet the frozen accuracy target. A physical repeatability receipt is
still required.

### Motion and cable gate

In addition to the baseline 156/49 frames, retain the frozen workspace cells,
joint-space samples, singularity refinements, governed production paths,
emergency-stop path, tool/workpiece/fixture/cell geometry and checked coverage.
Unchecked regions remain unknown.

Cable evidence must evaluate dynamic bend, local and accumulated twist,
clearance, service-loop travel, connector/strain-relief displacement and
route-specific flex-life consumption through the same governed motion.

## Safety and electrical design boundary

NexyFab generates a review package; it does not issue industrial safety or
regulatory certification. Use the current official publications as design
and review baselines:

- [ISO 10218-1:2025](https://www.iso.org/standard/73933.html) for the industrial
  robot as partly completed machinery;
- [ISO 10218-2:2025](https://www.iso.org/standard/73934.html) for robot
  applications and cells;
- [ISO 12100:2010](https://www.iso.org/standard/51528.html) for machinery risk
  assessment and risk reduction;
- [ISO 13849-1:2023](https://www.iso.org/standard/73481.html) for safety-related
  control-system design methodology;
- [IEC 60204-1:2016+A1:2021](https://webstore.iec.ch/en/publication/66124) for
  machine electrical equipment;
- [ISO 9283:1998](https://www.iso.org/standard/22244.html) for robot performance
  criteria and test-method alignment.

The governed safety package must include intended use and foreseeable misuse,
hazards and residual risks, each safety function and safe state, trigger and
reset/restart rules, required performance target, verification method,
evidence hash and independent reviewer. Electrical evidence must include the
power architecture, protection, bonding/grounding, motors, brakes, encoders,
controller and I/O mapping, cable/connector derating and applicable stop
functions.

The software can reject missing or contradictory evidence. A qualified human
must determine application-specific safety functions, performance targets,
conformity and regulatory obligations.

The publication list was checked on 2026-08-12. At the start of every product
release review, recheck the official ISO/IEC publication status, revisions and
applicable market law, then bind the selected editions into the safety-review
receipt.

## Physical validation sequence

### Joint rig

Measure rated and peak torque, brake hold, backlash, encoder repeatability,
bearing/motor/reducer temperature and current. Retain raw data and calibrated
instrument references.

### Wrist or partial assembly

Exercise compact multi-axis motion to measure cable twist, connector load,
near-contact clearance and thermal coupling.

### Six-axis prototype

Test zero, rated and eccentric payloads. Measure accuracy, repeatability,
cycle time, temperature, vibration, current/power and cable motion. Align the
performance protocol with ISO 9283 where applicable, but do not describe an
internal test as accredited certification.

### Endurance and teardown

After the frozen cycle count, inspect wear, fastener loosening, cable damage,
lubrication and seals. Correlate predicted and measured values and reopen only
the affected requirements, parts and evidence when a limit fails.

Every physical receipt must include specimen serial, as-built BOM, target
hash, equipment/calibration identity, environment, raw-data hash,
measurement uncertainty, acceptance result, operator and reviewer signature.

## Promotion matrix

| State | Required evidence | Allowed product wording |
|---|---|---|
| Software Candidate | current fail-closed code and 29/68/22/0 contract | internal candidate |
| Engineering Candidate | actual catalog, dynamic/thermal/life/accuracy/cable reports | Robot Engineering Candidate |
| Verified Pilot | exact r+1, joint rig, six-axis prototype and signed inspection | Robot Verified Pilot |
| Product-specific Verified Release | frozen model/specification, safety package and dual review | verified only for that named configuration |

A verified result never transfers automatically to a changed payload, reach,
reducer, controller, tool, installation pose or robot cell.

## Immediate rejection conditions

Reject promotion when any of the following is true:

- catalog selection, r+1, application, receipt or evidence hashes disagree;
- any required evidence status is `not_run`, `failed`, stale or unresolved;
- a required component curve, tolerance, material or load source is invented;
- motion coverage is represented as exhaustive when unchecked regions remain;
- safety certification or rated life is inferred from geometry-only checks;
- physical data lacks specimen, calibration, raw-data or reviewer identity;
- a different robot variant reuses a prior release without delta verification.

## Promotion boundary

- Before physical evidence: market as `Robot Verified Pilot`.
- After exact r+1, signed engineering/manufacturing evidence and prototype
  inspection: eligible for a product-specific verified release review.
- Never infer industrial safety certification, functional safety, rated life,
  or regulatory approval from CAD and motion checks alone.

The final-review decision only establishes eligibility. It never publishes a
release, modifies CAD, creates a quote, or sends an RFQ.

## Implemented engineering analysis packet (2026-08-12)

The current software now provides a non-release engineering chain for one
governed payload/path combination:

1. freeze and verify `nexyfab.robot-system-requirements.v2`;
2. evaluate the 6R dynamic load envelope against authoritative drive curves;
3. evaluate periodic duty thermal state;
4. evaluate bearing and reducer cumulative life and static capacity;
5. evaluate joint/link structural compliance at governed poses and loads;
6. propagate governed angular and Cartesian contributors into a worst-case TCP
   accuracy and repeatability budget;
7. independently recompute dynamics and cross-bind every analysis into
   `nexyfab.robot-engineering-analysis-packet.v1`.

The packet must retain all of these states:

- `scope.onePayloadPathCombination=true`;
- `scope.fullRequirementsCoverageComplete=false`;
- `externalValidationComplete=false`;
- `releaseReady=false`;
- all persistence, CAD mutation, quote and RFQ side effects `false`.

Do not accept an engineering packet when its supplied dynamic report differs
from independent recomputation, its payload/path is absent from the frozen
requirements, duty/life values differ from frozen performance, model hashes
diverge, or the TCP precision budget understates computed structural
deflection.

### Coverage promotion

Create one packet for every required payload/path combination. A future
coverage receipt must list the exact Cartesian product, each application hash,
status and any intentionally excluded combination. Missing combinations remain
`not_run`; they are never inferred from a neighbouring pass.

### Physical promotion

The engineering packet is an input to physical validation, not a replacement
for it. TCP metrology, stiffness correlation, duty thermal measurement and
service-life/endurance evidence must reference the same frozen requirements,
as-built BOM, specimen and application hash before final release review.

The verified implementation baseline is 64 robot/UI/API test files with 265
passing tests, a passing full TypeScript check, 73/73 CAD API controls with zero
issues, 563 route classifications with zero security gaps, and a passing robot
product selective production build. These are software regression facts only,
not physical, manufacturing, regulatory or market evidence.

## Verified Systems operating gates (implemented 2026-08-12)

The product UI exposes six evidence stages in order: full engineering coverage,
adaptive motion coverage, cable-life sweep, safety/electrical design evidence,
physical validation, and the server-attested audit. Replacing any upstream file
invalidates the displayed stage result. Responses that claim release, mutation,
persistence, quote or RFQ side effects are rejected by the client as well as by
the server contract.

The final review accepts only
`nexyfab.robot-verified-systems-release-audit.v2`. The audit must carry a valid
Ed25519 signature from the trusted audit-issuer registry, and both human
signoffs must be later than audit issuance. Changing even a status field after
issuance invalidates the audit signature. Final eligibility still does not
publish a release or modify CAD.
