# No-Show Lifecycle Reconciliation — Analysis & Plan

> Pre-implementation report. **No code changed yet.** Awaiting approval.
> Date: 2026-06-20 · Branch: `task/patient-dashboard`
> Companion glossary terms added to [CONTEXT.md](../CONTEXT.md) (No-Show, Assignment Timeout, Forfeiture, Actionability, No-Show Reconciliation).

## TL;DR

The original suspicion ("the assignment timeout is just an in-memory timer scheduled at task
creation, lost on restart, doesn't catch old records") is **wrong**. The assignment path is a
real, restart-safe, DB-scanning, Redis-locked reconciler ([appointment-assignment-sla.scheduler.ts](../src/appointment/appointment-assignment-sla.scheduler.ts))
that already auto-cancels via [`cancelForAssignmentTimeout`](../src/appointment/appointment.service.ts#L759).

The **actual gap** is a different lifecycle branch entirely: a **`CONFIRMED` + assigned**
appointment (Visit `CREATED`) whose scheduled time passes with no check-in. Both existing sweeps
(`expirePendingBookings`, `expireOverdue`) only act on `PENDING` records. Nothing transitions a
confirmed-but-missed appointment, there is **no `NO_SHOW` status**, the patient-history query
returns raw status with no derivation, and the cancel 24h guard accidentally *blocks* the patient
from clearing a past appointment (negative `hoursUntilAppointment <= 24` → true). Result: 19/06
records still look active/actionable on 20/06.

**Plan:** add `NO_SHOW` as a first-class terminal state, reconstructable by the admin lifecycle
screen from durable appointment/visit state; transition it via an idempotent reconciler (startup +
daily 06:00 Asia/Ho_Chi_Minh, **not** continuous); forfeit paid deposits; make passed appointments
non-actionable on read immediately; notify patient (in-app + email) and refresh doctor/receptionist
lists, with email gated to business hours.

---

## 1. Files / classes involved

### Enums (new values)
- [`enums/Appointment-status.enum.ts`](../src/appointment/enums/Appointment-status.enum.ts) — add `NO_SHOW`.
- [`visit/enums/visit-status.enum.ts`](../src/visit/enums/visit-status.enum.ts) — add `NO_SHOW`.
- [`admin/enums/lifecycle-event-type.enum.ts`](../src/admin/enums/lifecycle-event-type.enum.ts) — add `APPOINTMENT_NO_SHOW`, `VISIT_NO_SHOW`.
- [`admin/enums/lifecycle-phase.enum.ts`](../src/admin/enums/lifecycle-phase.enum.ts) — add a terminal `NO_SHOW` phase to `PHASE_ORDER` (peer of `CANCELLATION`).
- **Note:** `NO_SHOW` is **not** a `CancellationReasonCode`. It is its own appointment status, not a cancellation.

### Schema (durable markers, so the lifecycle can reconstruct the node + distinguish system vs manual)
- [`appointment/schemas/appointment.schema.ts`](../src/appointment/schemas/appointment.schema.ts) — add `noShowAt?: number`, `noShowActor?: CancellationActor` (`SYSTEM` for the reconciler, `STAFF` for the manual action), `noShowMarkedByAccountId?: ObjectId` (the staff account when manual; null when system), `noShowSource?: 'STARTUP' | 'DAILY_06AM' | 'MANUAL'`. Mirrors the existing `cancelledAt`/`cancellationActor` markers. The lifecycle reconstructor reads these to render SYSTEM vs RECEPTIONIST/ADMIN no-show.
- [`appointment/enums/no-show-reason-code.enum.ts`](../src/appointment/enums/no-show-reason-code.enum.ts) (**new, optional**) — if a `noShowReasonCode` is wanted: `RECONCILED` (system) / `MANUAL` (staff). Otherwise `noShowSource` carries this.

### Reconciler (new)
- `appointment/no-show-reconciler.service.ts` (**new**) — startup + daily-06:00 scheduler, hand-rolled `setTimeout` to the next 06:00 using the existing fixed +7h offset (`AppointmentTimeHelper.DEFAULT_OFFSET_MINUTES`), Redis-locked (`cron:no-show`), idempotent batch transition. Mirrors the `AssignmentSlaScheduler` pattern; **no `@nestjs/schedule` dependency** (Vietnam has no DST, so a fixed offset is exact). Calls the shared `markAppointmentNoShow(...)` core — no duplicated logic.
- `appointment/no-show.config.ts` (**new**) — `NO_SHOW_GRACE_MINUTES` (default 120), `NO_SHOW_DAILY_HOUR` (default 6), business-hours window for email (default 06:00–20:00), batch limit, lock TTL.

### Manual staff action (new, thin)
- [`appointment/appointment.controller.ts`](../src/appointment/appointment.controller.ts) — `PATCH /appointment/:appointmentId/no-show`, `@UseGuards(JwtAuthGuard, RoleGuard)` + `@Roles(RECEPTIONIST, ADMIN)`. **No bulk endpoint.** The controller is thin; it just calls the shared core with `actor = STAFF`, the staff account id, and `source = MANUAL`. All eligibility rules live in the service.

### Service (transition core + guards + read derivation)
- [`appointment/appointment.service.ts`](../src/appointment/appointment.service.ts) — **single shared core** `markAppointmentNoShow({ appointmentId, actor, markedByAccountId?, source })` (idempotent) used by **both** the reconciler and the manual endpoint; update the cancel guard so a past appointment is rejected with a clear `APPOINTMENT_TIME_PASSED` code instead of the misleading "within 24 hours"; derive `actionable` in `getAppointmentsByPatient`. Already `NO_SHOW` → safe no-op success.
- [`appointment/appointment-reschedule.service.ts`](../src/appointment/appointment-reschedule.service.ts) — add a missing **past-origin guard** (today it only rejects a past *target* slot, not a past *current* appointment).

### Visit
- [`visit/visit.service.ts`](../src/visit/visit.service.ts) — allow `CREATED → NO_SHOW`; ensure check-in rejects a `NO_SHOW` appointment (it already requires `CONFIRMED`, so this is covered, but add an explicit test).

### Admin lifecycle (reconstruction)
- [`admin/services/lifecycle-phase-builders.ts`](../src/admin/services/lifecycle-phase-builders.ts) — add `buildNoShowPhase` (reads `appt.noShowAt`, `actor = SYSTEM`); extend `buildVisitPhase` to emit a `VISIT_NO_SHOW` node when `visit.status === 'NO_SHOW'`; extend `buildConfirmationPhase` to treat `NO_SHOW` like `CONFIRMED`/`COMPLETED` (a no-show *was* confirmed first).
- [`admin/services/lifecycle-conflict.util.ts`](../src/admin/services/lifecycle-conflict.util.ts) — review so `NO_SHOW` isn't flagged as a conflict.
- Admin status label/colour/icon maps (FE) and any status filter — add `NO_SHOW` = "Không đến khám".

### Notification / mail / socket
- `notification` payload + listener + template — `APPOINTMENT_NO_SHOW` type; in-app patient row (idempotent).
- `mail` listener + service — `mail.patient.appointment.no_show`, business-hours-gated, idempotency key `no-show-<appointmentId>`.
- `socket` appointment gateway — emit a list-refresh so doctor today-list / receptionist queue drop the no-show.

### Read-model / DTO
- [`appointment/dto/appointment.dto.ts`](../src/appointment/dto/appointment.dto.ts) — additive derived `actionable: boolean` (and/or `isOverdue`). **No breaking contract change.**

### api-contract (submodule — push first, per repo rule)
- `api-contract/api.md` — document `NO_SHOW` status, non-actionability of past appointments, no-show notification payload.

### Module wiring
- [`appointment/appointment.module.ts`](../src/appointment/appointment.module.ts) — register the reconciler; it needs `Visit`, `MedicalEncounter`, `Billing`, `Payment` models (already injected elsewhere in the module).

---

## 2. Current lifecycle gap summary

| Sweep | Triggers on | Touches CONFIRMED-past? |
|---|---|---|
| `expirePendingBookings` ([booking svc:930](../src/appointment/appointment-booking.service.ts#L930)) | `PENDING`, unpaid past TTL, non-broad | No |
| `expireOverdue` ([SLA scheduler:124](../src/appointment/appointment-assignment-sla.scheduler.ts#L124)) | `PENDING` assignment **task** past deadline | No |
| **(none)** | **`CONFIRMED` appointment, time passed, no check-in** | **— this is the hole** |

Consequences observed:
- No `NO_SHOW` value exists in `AppointmentStatus` or `VisitStatus`.
- [`getAppointmentsByPatient`](../src/appointment/appointment.service.ts#L227) returns raw `appointmentStatus`; FE keeps showing `CONFIRMED` + cancel/reschedule/detail.
- Cancel 24h guard ([:434](../src/appointment/appointment.service.ts#L434)): for a past appointment `hoursUntilAppointment` is negative → `<= 24` true → **cancel blocked**; the patient cannot self-clear it.
- Reschedule ([reschedule svc](../src/appointment/appointment-reschedule.service.ts)) rejects a past *target* but not a past *origin*; a missed appointment can still be rescheduled.

---

## 3. State map

| Entity | Existing states | Change |
|---|---|---|
| **Appointment** | `PENDING, CONFIRMED, FAILED, CANCELLED, COMPLETED, RESCHEDULED` | **+ `NO_SHOW`** |
| **Visit** | `CREATED, CHECKED_IN, IN_PROGRESS, COMPLETED, CANCELLED` | **+ `NO_SHOW`** |
| **AssignmentTask** | `PENDING, ASSIGNED, COMPLETED, EXPIRED, ESCALATED, CANCELLED` | none (no-show task is already `COMPLETED`) |
| **Deposit** | `NOT_REQUIRED, PENDING, PAID, FAILED, REFUNDED, FORFEITED` | none; no-show uses **`PAID → FORFEITED`** |
| **Billing / Encounter** | created only on visit completion | none; a no-show has neither — their presence is a **veto** |

Terminal appointment states after this change: `FAILED, CANCELLED, COMPLETED, RESCHEDULED, NO_SHOW`. **Every status-consumer (mappers, filters, badge maps, DTOs) that enumerates terminal states must be updated** — this is the main blast radius.

---

## 4. Stale-state cases (from the prompt) — verdicts

| Case | Status today | Covered by |
|---|---|---|
| Payment pending expired, appt/task remains | handled (non-broad); **broad DICH_VU pending has a known gap** | existing `expirePendingBookings` / assignment plan (separate) |
| Payment success but task never assigned | handled | `cancelForAssignmentTimeout` |
| Task timeout missed due to restart | **not a risk** — scheduler re-scans DB each tick on init | existing |
| Task completed, Visit created, no check-in | **THE GAP** | **No-Show reconciler (this plan)** |
| Appt time passed while `PENDING/CONFIRMED` | partial | `PENDING` via booking sweep; **`CONFIRMED` via this plan** |
| BHYT confirmed, patient no-show | **gap** | this plan (no deposit, just `NO_SHOW`) |
| DICH_VU paid+confirmed, no-show | **gap** | this plan (`NO_SHOW` + deposit `FORFEITED`) |
| Visit `CREATED`, no check-in/encounter/billing after time | **gap** | this plan |
| Past appt still exposes cancel/reschedule | **gap** | this plan (read-model + guards) |
| History shows stale as actionable | **gap** | this plan (`actionable` derivation) |

---

## 5. Exception risks (defensive design)

- **`endTime` missing** on legacy records → fall back to `scheduledAt` (+ a default slot duration) for the overdue boundary; never throw.
- **No Visit** but `CONFIRMED` (shouldn't happen for assigned appts) → reconciler requires `visit.status === CREATED`; skip if no visit (don't no-show something with no Visit).
- **Visit exists but `CHECKED_IN`/`IN_PROGRESS`/`COMPLETED`** → veto (patient came).
- **Encounter or Billing exists** → veto (service happened); reconciler joins `MedicalEncounter`(by `visitId`) and `Billing`(by `visitId`).
- **`timeSlot` empty/invalid ObjectId** → no-show does **not** release the slot (the slot time has already passed; releasing is meaningless and could surface a "released" node oddly). Documented decision.
- **Deposit PAID but payment row TTL-deleted** → forfeiture writes `depositStatus = FORFEITED` with no credit movement, so a missing payment row is harmless (unlike refund, which needs the row).
- **Double processing** → conditional `updateOne({_id, appointmentStatus: CONFIRMED}, {$set:{... NO_SHOW}})`; act only when `modifiedCount === 1`.
- **Notification/email duplicates** → in-app notification idempotency key + mail key `no-show-<appointmentId>`; email additionally gated to business hours.
- **Admin lifecycle** must not throw on the new status — reconstruction is defensive by design (`NodeStatus.PARTIAL/UNKNOWN`), but add explicit handling so `NO_SHOW` renders `OK`, not `CONFLICT`.

---

## 6. Reconciler design

**Scheduling** (`NoShowReconcilerService`, mirrors `AssignmentSlaScheduler`):
- `onModuleInit`: run a **startup catch-up** once (short delay after boot), then schedule the next 06:00.
- **Daily 06:00 Asia/Ho_Chi_Minh**: `setTimeout` to the next 06:00 computed via the fixed +7h offset; reschedule after each run. No `@nestjs/schedule`.
- Each run: acquire Redis lock `cron:no-show` (one instance per tick) + in-process `running` guard.

**Selection query** (a candidate is a no-show when **all** hold):
```
appointmentStatus = CONFIRMED
doctorId set AND timeSlot set            (it was actually assigned)
(endTime ?? scheduledAt+slotDur) + grace < now
visit exists AND visit.status = CREATED  (never checked in)
no MedicalEncounter for the visit
no Billing for the visit
```
Broad/`AWAITING_ASSIGNMENT` appointments are **out of scope** (owned by assignment timeout).

**Shared transition core `markAppointmentNoShow({ appointmentId, actor, markedByAccountId?, source })`** (single transaction, idempotent) — called by the reconciler (`actor=SYSTEM`, `source=STARTUP|DAILY_06AM`) **and** the manual endpoint (`actor=STAFF`, `source=MANUAL`):
1. Re-load; if already `NO_SHOW` → safe no-op success; bail unless still `CONFIRMED` + still overdue + still no check-in/encounter/billing.
2. `appointmentStatus = NO_SHOW`; set `noShowAt`, `noShowActor`, `noShowMarkedByAccountId?`, `noShowSource`.
3. If DICH_VU & `depositStatus = PAID` → `depositStatus = FORFEITED` (no credit movement).
4. `visit.status = NO_SHOW`.
5. Do **not** release the slot. Do **not** create billing.
6. Commit → emit side effects (below).

The manual endpoint enforces the **same eligibility rules** (it cannot no-show a not-yet-passed, checked-in, or terminal appointment) — the rules are in the core, not the controller.

**Idempotency:** the conditional status update is the gate; re-runs find `appointmentStatus ≠ CONFIRMED` and no-op. Notifications/email keyed per appointment.

---

## 7. Audit event design — **adapted to this codebase**

> **Contradiction surfaced:** the prompt's audit spec (stored `APPOINTMENT_MARKED_NO_SHOW` event with `previousStatus`/`reconciledAt`/`reconcilerSource`/`gracePeriodMinutes`) assumes an **event log**. This system has none — `lifecycle-event-type.enum.ts:1`: *"reconstructed from domain state … NOT read from an audit log."* The only append-only log is `AppointmentAssignmentTask.history[]`, which a no-show doesn't use.

**Chosen approach (fits existing architecture):** persist durable markers on the Appointment/Visit and let the lifecycle screen **reconstruct** the node:
- `noShowAt`, `noShowActor`, `noShowMarkedByAccountId` → `buildNoShowPhase` emits an `APPOINTMENT_NO_SHOW` node; actor resolved via the existing `actor-resolver` (SYSTEM when `noShowActor=SYSTEM`; the resolved RECEPTIONIST/ADMIN account when `noShowActor=STAFF`), `statusAfter = NO_SHOW`, strong link. This is how the admin screen distinguishes a system no-show from a manual one.
- `visit.status = NO_SHOW` → `buildVisitPhase` emits `VISIT_NO_SHOW`.
- `depositStatus = FORFEITED` → existing `buildDepositPhase` already renders `DEPOSIT_FORFEITED`. ✅ free.
- `reconcilerSource` / `gracePeriodMinutes` are **operational metadata**, not lifecycle nodes — they go to structured logs (and optionally the diagnostic field), not the timeline.

**Alternative (rejected for now):** introduce the system's first real appointment audit collection. Much larger change, inconsistent with the deliberately log-free lifecycle design. Flag if product truly needs queryable audit events.

---

## 8. Side-effect policy

- **State transition** happens in both reconcilers (startup + daily).
- **In-app patient notification + doctor/receptionist list-refresh**: emitted on every transition (reconciler or manual), idempotent.
- **Patient email**: gated to the business-hours window (default 06:00–20:00) **and** idempotency key `no-show-<appointmentId>`. So a 03:00 restart transitions + records the no-show + writes the in-app notification, but **does not email**; the email is sent by the next in-window run. Because the key is per-appointment, no duplicate is ever sent.
- **Manual staff action**: an intentional in-hours staff click, so it may send the patient email immediately — but through the **same** idempotency key, so it can never double-send with a later reconciler run.
- This satisfies "no midnight/restart emails", "manual is immediate", and "no duplicates" without coupling email to a single code path.

---

## 9. API / UI impact

- **Patient history**: add additive derived `actionable` (false when `end+grace < now` or status terminal). FE hides cancel/reschedule/detail-actions accordingly. `NO_SHOW` renders as "Không đến khám".
- **Cancel guard**: replace the misleading past-appointment "within 24 hours" rejection with `APPOINTMENT_TIME_PASSED`.
- **Reschedule guard**: reject when the current appointment's `end+grace` is in the past.
- **Admin lifecycle**: `NO_SHOW` as a terminal phase/node; status filters and label/colour maps include it.
- **Receptionist/Admin**: list-refresh drops no-shows; a guarded **"Đánh dấu không đến khám"** action (`PATCH /appointment/:id/no-show`, RECEPTIONIST/ADMIN) shown only for eligible past confirmed appointments. Hidden in patient UI. Cancel/reschedule hidden after `NO_SHOW`.
- **api-contract**: additive (new status, new endpoint, no-show notification payload); push submodule first.

---

## 10. Test plan

Reconciler / transition:
- CONFIRMED past, Visit CREATED, no check-in → `NO_SHOW` (+ Visit `NO_SHOW`).
- BHYT no-show → `NO_SHOW`, no deposit movement.
- DICH_VU paid no-show → `NO_SHOW` + deposit `FORFEITED`, **no credit refund**.
- Vetoes: checked-in / in-progress / completed visit; existing encounter; existing billing; already `CANCELLED`/`FAILED`/`COMPLETED`/`NO_SHOW`.
- Broad `AWAITING_ASSIGNMENT` is ignored (still owned by assignment timeout).
- Startup catch-up flips yesterday's stale records; daily-06:00 flips records that lapsed overnight.
- Idempotent: second run is a no-op; single lifecycle node; single notification; email not double-sent.
- Email suppressed outside business hours; sent once inside.
- `endTime` missing → falls back to `scheduledAt`, no throw.
- Deposit PAID with TTL-deleted payment row → forfeiture still succeeds.

Guards / read model:
- Past CONFIRMED appointment → cancel rejected with `APPOINTMENT_TIME_PASSED`; reschedule rejected (past origin).
- `getAppointmentsByPatient` marks past/terminal appointments `actionable = false`.
- Assignment-timeout flow still works unchanged (regression).
- Check-in on a `NO_SHOW` appointment is rejected.

Admin lifecycle:
- `reconstructLifecycle` emits `APPOINTMENT_NO_SHOW` + `VISIT_NO_SHOW` + `DEPOSIT_FORFEITED`; status `OK`, not `CONFLICT`.

Suggested command:
```powershell
npx jest --runInBand no-show-reconciler appointment.service.cancel appointment-reschedule.service appointment-lifecycle
npm run build
```

---

## 11. Resolved decisions

1. **Scheduler** — hand-rolled `setTimeout`-to-06:00 (fixed +7h, no DST, no new dep), matching `AssignmentSlaScheduler`. ✅
2. **Grace period** — `NO_SHOW_GRACE_MINUTES = 120` default (configurable). ✅
3. **Deposit** — paid DICH_VU no-show → `FORFEITED`, no refund. ✅
4. **Timing** — daily 06:00 Asia/Ho_Chi_Minh + startup catch-up; **not** continuous. Read-model/guards make past appointments non-actionable immediately, independent of the transition run. ✅
5. **Manual action** — included now: thin `PATCH /appointment/:id/no-show` (RECEPTIONIST/ADMIN), reusing the shared `markAppointmentNoShow` core. No bulk endpoint. ✅
6. **Audit** — reconstructed from durable `noShow*` markers (system vs staff distinguishable); **no new audit/event collection**. ✅
7. **Notifications** — patient in-app + email (business-hours-gated, idempotent) + doctor/receptionist refresh; manual action may email immediately via the same idempotency key. ✅
8. **ADR** — recorded as [`docs/adr/0003-no-show-as-reconstructed-terminal-state.md`](adr/0003-no-show-as-reconstructed-terminal-state.md). ✅

**Status: awaiting approval to implement.** No application code has been changed.
