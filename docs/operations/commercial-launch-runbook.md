# NexyFab commercial launch runbook

Status: implementation baseline. Policy wording marked `LEGAL REVIEW` must not be represented as counsel-approved.

## Release gates

A paid production release is allowed only when all gates are green:

- `NEXYFAB_COMMERCIAL_MODE=1` starts successfully.
- CI typecheck, lint, security, migration/restore, robustness, build and E2E jobs pass.
- Real OCCT acceptance passes in Chromium and the scheduled browser matrix has no open blocker.
- Staging completes signup → CAD → quote → payment sandbox → order → refund-request flow.
- The release has a unique commit-based build identifier.
- On-call owner, rollback owner and customer-support owner are named for the release window.
- Database backup is recent and the latest quarterly restore drill passed.

## Service objectives

Initial commercial targets; revise after 30 days of measured traffic.

| Objective | Target | Alert |
|---|---:|---:|
| Public API availability | 99.5% monthly | 5-minute health failure |
| Checkout/payment API availability | 99.9% monthly | any 5xx burst or webhook backlog |
| 3D editor initial shell | p75 ≤ 3s desktop | p75 > 4s |
| OCCT ready after first use | p75 ≤ 8s desktop | p75 > 12s |
| Ordinary solid operation | p95 ≤ 5s | p95 > 8s |
| Heavy solid operation | hard timeout 120s | any timeout-rate > 1% |
| Support first response | business day ≤ 4h | oldest ticket > 4h |
| Payment incident response | ≤ 30m | immediate page |

Mobile is a review/view/light-edit tier until the mobile OCCT matrix and memory telemetry remain green for 30 days. Heavy imports and large assemblies must show a desktop recommendation rather than silently failing.

## CAD limits and recovery

- Simple STEP endpoint: 5 MiB; full B-rep path: 32 MiB.
- Kernel fallback input: 8 MB; kernel vertex ceiling: 400,000.
- OCCT live shape budget: 256 handles; individual worker request timeout: 120 seconds.
- On timeout, show a recoverable error and call the Worker bridge `restart()`. Restart invalidates native handles, so rebuild the model from the persisted feature tree before accepting another edit.
- Autosave/cloud snapshots and document versions are the source of recovery, not native OCCT handles.
- Do not silently convert a failed B-rep operation into synthetic geometry for manufacturing export.

## Backup and disaster recovery

- PostgreSQL provider backup: daily minimum, 30-day retention recommended.
- Application backup export: daily to a private, versioned object-storage prefix.
- RPO target: 24 hours initially; payment/order ledgers target 5 minutes through provider durability and append-only events.
- RTO target: 4 hours for full service, 1 hour for read-only order status.
- Quarterly: restore the latest dump into a database whose name contains `_restore_drill`, run `npm run backup:verify-restore`, record duration and table counts.
- Never run a restore drill against production or a database URL lacking `_restore_drill`.

## Rollback

Railway CLI currently redeploys only the latest deployment; it does not select an arbitrary historical deployment. Use one of these tested paths:

1. Before promotion, retain the previous release commit SHA and deployment ID.
2. For code-only rollback, create a revert commit for the release and deploy that commit through the normal pipeline.
3. For an urgent Railway dashboard rollback, redeploy the previous successful deployment from the deployment history UI.
4. For schema changes, prefer forward-fix migrations. Restore a database only for confirmed destructive corruption and only after incident command approval.
5. Verify `/api/health/live`, `/api/health/ready`, `/api/occt/diagnostic` and the five real-OCCT browser checks after rollback.
6. Target: detection-to-restored-service ≤ 10 minutes for code rollback.

## Data protection

- Production, staging and development use separate databases, object-storage prefixes, Redis instances and credentials.
- CAD downloads require resource authorization and 5-minute signed URLs.
- super-admin is required for job processing, backup triggers, pruning, secret rotation and breaker operations.
- Every privileged mutation writes an append-only audit record with actor, target, timestamp, IP and user agent.
- Secret rotation cadence: 90 days, and immediately after exposure or staff/contractor offboarding.
- Customer CAD retention default: active account lifetime plus 30 days after deletion request, subject to order/tax record obligations. `LEGAL REVIEW` before publication.

## Order operations

- All order, payment, shipment, delay, refund and dispute transitions must append an order event.
- Failed jobs remain visible with attempt count and error; super-admin may retry and the retry is audited.
- Customer support uses the order timeline as the primary chronology; provider consoles are reconciliation evidence.
- Refund completion requires provider reference, amount, actor and reason.
- Production delays require a customer-visible event and revised estimate.

## Cost and abuse controls

- Record per-user AI/CAD job count, provider, latency and estimated cost.
- Enforce plan budgets server-side with Redis; browser counters are informational only.
- Alert at 80% of daily provider budget; trip the existing cost breaker at 100%.
- Track gross order value, payment fees, manufacturing cost, shipping, refund loss and contribution margin per order.
- Review negative-margin orders weekly until automated pricing covers 95% of orders.

## Partner quality

- Track on-time assignment, quote turnaround, on-time delivery, defect rate, remake rate and dispute rate.
- Pause automatic matching for partners with unresolved critical defects or repeated SLA breaches.
- A defective delivery records photos, root cause, disposition, remake/refund owner and closure date.
- No partner receives a customer CAD file without active RFQ/order authorization.

## Policy publication checklist

The existing terms, privacy and refund pages must be reviewed against the actual production flow before enabling paid public access:

- `LEGAL REVIEW`: service terms, privacy notice, refund/cancellation policy.
- `LEGAL REVIEW`: responsibility boundary for customer design errors, DFM advice and manufactured-product liability.
- `LEGAL REVIEW`: CAD ownership, processing license, confidentiality, retention and deletion.
- Enterprise addendum: NDA, sub-processors, region, retention override, export and deletion evidence.
- Publish version/effective date and store user acceptance evidence for material policy revisions.

## Launch decision

- Internal and invite beta: allowed with current green technical gates.
- Paid public launch: allowed only after commercial mode passes, one real payment/refund rehearsal succeeds, restore drill passes, and policy pages receive legal approval.
- Enterprise production orders: additionally require signed data terms, named support owner and partner-quality review.
