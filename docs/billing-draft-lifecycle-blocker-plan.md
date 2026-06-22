# Billing-Draft Lifecycle Blocker — Diagnosis & Plan

> Investigation only. **No code changed.** Awaiting approval.
> Date: 2026-06-20 · Branch: `task/patient-dashboard`
> Related: [no-show-lifecycle-reconciliation-plan.md](no-show-lifecycle-reconciliation-plan.md), [CONTEXT.md](../CONTEXT.md)

## 1. Current architecture summary

**Billing statuses** ([billing.schema.ts:5](../src/billing/billing.schema.ts#L5)): `DRAFT | FINALIZED | PAID`. **No** `CANCELLED`/`VOID`/`REVERSED`. `visitId` is **unique** (one billing per visit).

**Billing is created at exactly one point: visit completion.**
- The only creator is `BillingService.createDraftBilling` ([billing.service.ts:61](../src/billing/billing.service.ts#L61)), status `DRAFT`.
- Its only trigger is the `domain.visit.completed` event ([billing.listener.ts:10](../src/billing/billing.listener.ts#L10)).
- That event is emitted **only** by `VisitService.completeVisit` ([visit.service.ts:459](../src/visit/visit.service.ts#L459)), which in one transaction: requires `visit.status === IN_PROGRESS` (else throws), **creates the MedicalEncounter**, sets `appointmentStatus = COMPLETED`, sets `visit.status = COMPLETED`, marks the slot `completed`.
- It is **not** created at booking, assignment, check-in, or payment. `DRAFT` is **not** an early placeholder — it is a post-completion record awaiting finalize/pay.
- `createDraftBilling` is **idempotent**: if a billing row already exists for the visit it returns it **as-is** ([:64](../src/billing/billing.service.ts#L64)) — it never recreates or reprices.

**Therefore, in the real code path, a `DRAFT` billing can only coexist with: `Visit = COMPLETED`, an existing `MedicalEncounter`, and `Appointment = COMPLETED`.** The lifecycle is `DRAFT → FINALIZED` (`finalizeBilling`, which also creates a billing `Payment`, [billing.service.ts:302-353](../src/billing/billing.service.ts#L302)) `→ PAID` (`payment.service.ts:306/346`).

## 2. How billing currently blocks lifecycle actions

Every lifecycle guard treats **billing existence (any status)** as a hard blocker:

| Flow | Location | Check | Reason code |
|---|---|---|---|
| Cancel | [appointment.service.ts:606-621](../src/appointment/appointment.service.ts#L606) | `billingModel.findOne({visitId})` → if a billing `Payment` exists → block; else if **any** billing exists → block | `PAYMENT_EXISTS`, `BILLING_EXISTS` |
| Reschedule | [appointment-reschedule.service.ts:116-137](../src/appointment/appointment-reschedule.service.ts#L116) | same shape | `PAYMENT_EXISTS`, `BILLING_EXISTS` |
| Manual no-show | [appointment.service.ts:1142](../src/appointment/appointment.service.ts#L1142) (in `markAppointmentNoShow`) | `billingModel.findOne({visitId})` → if any billing → block | `BILLING_EXISTS` |
| Auto no-show (reconciler) | via the same `markAppointmentNoShow` core | same | `BILLING_EXISTS` |
| Complete visit | [visit.service.ts:402](../src/visit/visit.service.ts#L402) | requires `IN_PROGRESS`; billing is a **consequence**, not a precondition | — |
| Check-in | [visit.service.ts:489-498](../src/visit/visit.service.ts#L489) | requires `appointment CONFIRMED` + `visit CREATED`; billing not consulted | — |

> The patient-facing Vietnamese string *"Lượt khám đã phát sinh hóa đơn..."* is **not** in the backend — it is the FE mapping of the `BILLING_EXISTS` reason code. The backend blocker is `BILLING_EXISTS`.

**Crucial observation:** in all of cancel/reschedule/no-show, a *visit-status* guard already runs **before** the billing check — cancel/no-show require `visit.status === CREATED`, reschedule blocks `COMPLETED|CANCELLED`. Since a legitimate billing only exists when the visit is `COMPLETED`, the visit-status guard would already block these actions in the real flow. **The billing-existence check therefore only ever becomes the operative blocker when the data is inconsistent** (a billing row whose visit is not actually completed).

## 3. Root cause

The reported state — `Appointment CONFIRMED, Visit CREATED, no encounter, Billing DRAFT` — **cannot be produced by the current code** (billing requires a completed visit + encounter + completed appointment). It is an **inconsistent / legacy / manual-test record**: a `DRAFT` billing orphaned from a non-completed visit.

The bug is the **blocker semantics**: the guards equate *"a billing row exists"* with *"a real charge happened"*. A `DRAFT` billing with **no billing `Payment`** is financially empty (its `depositUsed`/amounts are display snapshots, not ledger movements). Treating it as a terminal blocker makes the system unable to clean up exactly the inconsistent record that produced it — no-show, cancel, and reschedule all dead-end on it.

Secondary risk: because `createDraftBilling` returns an existing row as-is, a stray `DRAFT` that is *left in place* would be silently reused (with stale pricing) if that visit were ever completed later — so for reschedule (which keeps the visit alive) the stray draft must be **removed**, not merely ignored.

## 4. Affected files / functions

- [src/appointment/appointment.service.ts](../src/appointment/appointment.service.ts) — `cancelAppointment` billing block (606-621); `markAppointmentNoShow` billing check (~1142).
- [src/appointment/appointment-reschedule.service.ts](../src/appointment/appointment-reschedule.service.ts) — billing block (116-137).
- [src/billing/billing.service.ts](../src/billing/billing.service.ts) — add a small shared helper to classify/remove a non-committed draft; document `createDraftBilling` idempotency.
- [src/billing/billing.schema.ts](../src/billing/billing.schema.ts) — only if we choose the `VOID`-status variant (see §5).
- Admin read-model (optional, §7): [lifecycle-conflict.util.ts](../src/admin/services/lifecycle-conflict.util.ts), [lifecycle-phase-builders.ts](../src/admin/services/lifecycle-phase-builders.ts) `buildBillingPhase`, `warning.enums`.
- Tests: cancel/reschedule/no-show specs + a billing-classification unit test.

## 5. Lifecycle decision table

A billing is **"committed"** iff `status ∈ {FINALIZED, PAID}` **or** a billing-purpose `Payment` exists for it. A `DRAFT` with no billing payment is **"placeholder"**.

| Billing state | cancel | reschedule | manual no-show | auto no-show | complete visit | check-in |
|---|---|---|---|---|---|---|
| **None** | allow* | allow* | allow* | allow* | allow (creates draft) | allow |
| **DRAFT, no payment** (placeholder) | **allow + delete draft** | **allow + delete draft** | **allow + delete draft** | **allow + delete draft** | n/a (returns existing) | allow |
| **DRAFT + billing payment** | block `PAYMENT_EXISTS` | block `PAYMENT_EXISTS` | block `PAYMENT_EXISTS` | block `PAYMENT_EXISTS` | n/a | allow |
| **FINALIZED** | block `BILLING_FINALIZED` | block `BILLING_FINALIZED` | block `BILLING_FINALIZED` | block `BILLING_FINALIZED` | n/a | allow |
| **PAID** | block `BILLING_PAID` | block `BILLING_PAID` | block `BILLING_PAID` | block `BILLING_PAID` | n/a | allow |

`*` subject to the other existing guards (status, 24h/past-time, visit existence, encounter). In the real flow a committed billing always implies `Visit COMPLETED`/`Appointment COMPLETED`, so those rows are *also* caught by the existing status guards — the billing-state block is defense-in-depth for inconsistent data. No `CANCELLED`/`VOID` billing status exists today (see §5 cleanup choice).

## 6. Proposed implementation plan (minimal, blocker-semantics fix)

**Step 1 — Centralize billing classification (billing.service.ts).**
Add a pure helper (no new module): `classifyBilling(visitId, session?) → { billing, committed: boolean }` where `committed = status ∈ {FINALIZED, PAID} || (a Payment with purpose=BILLING and this billingId exists)`. Reuse it in all three flows so the rule lives in one place.

**Step 2 — Relax the three guards** (cancel, reschedule, `markAppointmentNoShow`):
- If billing is **committed** → keep blocking with a precise reason (`PAYMENT_EXISTS` / `BILLING_FINALIZED` / `BILLING_PAID`). Preserve the existing `PAYMENT_EXISTS` path.
- If billing is a **placeholder DRAFT (no payment)** → do **not** block. Instead remove it as part of the action's transaction (Step 3).
- If **no billing** → unchanged.

**Step 3 — Clean up the placeholder draft inside the same transaction.**
Recommended: **delete** the orphaned `DRAFT` (it has no payment, so nothing dangles; and `createDraftBilling`'s idempotent reuse means a left-behind row would be reused with stale pricing if the visit ever completed). Do the delete with `billingModel.deleteOne({ _id, status: DRAFT }, { session })` and act only on `deletedCount === 1` (idempotent / race-safe). Log `appointmentId/visitId/billingId` for audit.
- *Alternative (more auditable):* add `BillingStatus.VOID` and set `DRAFT → VOID`. **Caveat:** because of the unique `visitId` index + `createDraftBilling` reuse, a VOIDed row on a still-alive visit (reschedule keeps the visit) would block/skew a future legitimate completion unless `createDraftBilling` is also taught to ignore non-DRAFT rows. Given "don't redesign billing unless needed", **delete is the recommended minimal choice**; choose VOID only if an audit trail of the discarded placeholder is required (then also patch `createDraftBilling` to recreate when the only existing row is VOID).

**Step 4 — No new early-creation changes.** Billing creation timing is correct (visit completion). Do not move it.

## 7. Deposit / payment impact

For a paid `DICH_VU` no-show, the existing core already sets deposit `→ FORFEITED`, no refund, no slot release (see no-show plan). A placeholder `DRAFT` billing's `depositUsed` is a **display snapshot**, not a ledger entry, so deleting it does **not** touch the deposit or any wallet — the forfeiture stays on the appointment. We only ever delete a draft with **no** billing payment, so no payment row is orphaned. Net: no double-handling; "no billing for a no-show" holds, and a pre-existing stray draft is removed.

## 8. Admin lifecycle / read-model impact

- After the fix, terminal no-show/cancel **delete** the stray draft, so the lifecycle simply shows no billing node (consistent with "no billing happened").
- For any *un-cleaned* legacy stray (`DRAFT` while `Visit ≠ COMPLETED` / no encounter), add a **conflict/warning** so the timeline does not imply a real charge:
  - In [lifecycle-conflict.util.ts](../src/admin/services/lifecycle-conflict.util.ts), add a check mirroring the existing "Billing PAID but not COMPLETED" rule: `billing.status === DRAFT && (no encounter || visit.status !== COMPLETED)` → `WARN`, flag the `BILLING_CREATED` node `PARTIAL` with a new `WarningCode` (e.g. `MISLEADING_DRAFT_BILLING` / message "Draft billing placeholder; no completed visit or charge").
  - Optionally relabel the `buildBillingPhase` DRAFT node from "Billing draft created" to "Billing draft (placeholder)" when the visit is not completed.
- This satisfies "distinguish placeholder draft from actual finalized/charged billing".

## 9. Risks & test cases

**Risks**
- Relaxing the guard must **not** let a committed billing slip through → the `committed` predicate must catch `FINALIZED`, `PAID`, **and** any billing `Payment` (the strongest signal). Keep `PAYMENT_EXISTS` first.
- Deleting inside the action transaction must be race-safe (`deletedCount===1`, status-scoped) so a concurrent finalize cannot be lost (a concurrent finalize would flip status to FINALIZED → our status-scoped delete no-ops and the committed-check blocks the action).
- Reschedule keeps the visit alive: deletion (not VOID) is required to avoid stale-draft reuse at a later real completion.

**Test cases**
- Cancel/reschedule/manual-no-show/auto-no-show with a **placeholder DRAFT (no payment)** → action succeeds and the draft is deleted.
- Same flows with a **DRAFT + billing payment** → blocked `PAYMENT_EXISTS`; draft untouched.
- Same flows with **FINALIZED** and with **PAID** → blocked; nothing deleted.
- No-show with paid `DICH_VU` + placeholder draft → `NO_SHOW`, deposit `FORFEITED`, draft deleted, no refund, no slot release, no new billing.
- Reschedule that deletes a placeholder draft, then the (hypothetical) visit completes later → `createDraftBilling` creates a **fresh** correct draft (proves no stale reuse).
- Concurrency: finalize vs cancel race → exactly one wins; no orphaned payment; no lost finalize.
- Regression: a normally COMPLETED appointment (real DRAFT/FINALIZED/PAID) is still un-cancellable/un-reschedulable via the existing status guards.
- Admin lifecycle: legacy stray DRAFT renders with the new placeholder warning, not as a real charge; a deleted draft yields no billing node.

## 10. Recommendation

Adopt the **minimal blocker-semantics fix**: classify billing as committed vs placeholder, block only on committed billing (or any billing payment), and **delete** a placeholder `DRAFT` within the action transaction. Keep billing creation timing unchanged. Add the lifecycle placeholder warning for visibility. Do not introduce a `VOID` status unless an explicit audit trail of discarded placeholders is required (and only with the `createDraftBilling` recreate caveat handled).
