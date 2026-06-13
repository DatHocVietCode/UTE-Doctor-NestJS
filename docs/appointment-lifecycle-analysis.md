# Appointment Lifecycle Analysis

> End-to-end audit of the appointment lifecycle (normal booking, broad/unassigned booking,
> receptionist assignment, cancel, reschedule) across backend, api-contract, and frontend.
>
> Date: 2026-06-13 · Branch: `task/edge-case-not-select-doctor`

## TL;DR

The backend is **substantially correct and mature**. The most-feared bug — "receptionist
assigns a doctor/slot but the appointment is never set to `CONFIRMED`, so the patient can't
check in" — **does not exist**: status is set explicitly and is covered by tests. Reschedule
is fully implemented, atomic, and preserves deposit state. Normal booking, deposit gating,
visit creation, and the check-in `CONFIRMED` guard are all consistent.

**Two real backend bugs exist, both in cancellation of broad/unassigned appointments**
(B1, B2), plus four frontend gaps (F1–F4). See the [Bugs](#bugs-found) section.

---

## 1. Current lifecycle summary

```
                       ┌─────────────── normal booking ───────────────┐
POST /appointment/book ─┤                                              ├─→ PENDING ─(deposit/BHYT)→ CONFIRMED ─→ (check-in → visit) → COMPLETED
                       └─────────────── broad booking ────────────────┘
                                                                        broad: PENDING + AWAITING_ASSIGNMENT
                                                                          → receptionist assigns doctor/slot
                                                                          → CONFIRMED + ASSIGNED
Cancel:     PENDING|CONFIRMED → CANCELLED   (refund deposit if paid; release slot; cancel visit; close task)
Reschedule: PENDING|CONFIRMED → PENDING|CONFIRMED (status preserved; old slot released, new slot reserved)
```

Key entities:
- **Appointment** (`src/appointment/schemas/appointment.schema.ts`) — `appointmentStatus`,
  `assignmentStatus`, `doctorId?`, `timeSlot?`, deposit fields, schedule snapshot
  (`date`/`scheduledAt`/`startTime`/`endTime`).
- **AppointmentAssignmentTask** (`...schemas/appointment-assignment-task.schema.ts`) — the
  receptionist work item for a broad booking; one active (`PENDING`/`ASSIGNED`) task per
  appointment (partial unique index).
- **Visit** (`src/visit/schemas/visit.schema.ts`) — created on `appointment.booking.success`;
  gates check-in.
- **Payment / Credit wallet** — deposit taken via VNPAY; refunds go to the **credit wallet**.

Relevant enums:
- `AppointmentStatus`: `PENDING, CONFIRMED, FAILED, CANCELLED, COMPLETED, RESCHEDULED`
- `AssignmentStatus`: `NONE, AWAITING_ASSIGNMENT, ASSIGNED`
- `AssignmentTaskStatus`: `PENDING, ASSIGNED, COMPLETED, EXPIRED, ESCALATED, CANCELLED`
- `DepositStatus`: `NOT_REQUIRED, PENDING, PAID, FAILED, REFUNDED, FORFEITED`
- `PaymentCategory`: `BHYT` (no deposit), `DICH_VU` (deposit required)
- `VisitStatus`: `CREATED, CHECKED_IN, IN_PROGRESS, COMPLETED, CANCELLED`

---

## 2. Normal booking flow

`appointment-booking.service.ts → bookAppointment()` (branch when `broadBooking` is falsy).

1. `validateBookingRequest` requires `doctor.id`, `timeSlotId`, date, hospital, service, payment method.
2. Acquire Redis slot lock `slot:{doctorId}:{timeSlotId}` (TTL `BOOKING_PENDING_TTL_SECONDS`).
3. Availability check: no active (`PENDING`/`CONFIRMED`) appointment on the same doctor/date/slot.
4. Create appointment in a transaction: `appointmentStatus = PENDING`, `assignmentStatus = NONE`,
   `doctorId`/`timeSlot` set, deposit fields by category, slot marked `booked`.
5. Payment:
   - **DICH_VU** → create deposit payment, return `PENDING` + `paymentUrl`. On deposit success
     (`payment.service.ts`), `depositStatus = PAID` and, if still `PENDING`, status → `CONFIRMED`
     and `appointment.booking.success` is emitted.
   - **finalAmount 0 / BHYT** → `confirmBooking` immediately → `CONFIRMED` + emit `booking.success`.
6. `appointment.booking.success` → `VisitBookingListener` creates `Visit(CREATED)`.

Backward-compatibility: this path is **unchanged** by the fixes in this document.

---

## 3. Broad / unassigned booking flow

`appointment-booking.service.ts → bookBroadAppointment()` (when `broadBooking === true`).

1. `validateBroadBookingRequest`: requires specialty **or** reason; DICH_VU requires a positive `depositAmount`.
2. Transaction creates **both**:
   - Appointment: `appointmentStatus = PENDING`, `assignmentStatus = AWAITING_ASSIGNMENT`,
     `doctorId`/`timeSlot` **omitted (null)**, `date`/`scheduledAt` set to a **placeholder**
     (`bookingDateEpoch` ≈ now), deposit fields by category.
   - `AppointmentAssignmentTask`: `status = PENDING`, `deadlineAt = now + ASSIGNMENT_DEADLINE_MINUTES`.
3. **DICH_VU** → create deposit payment; on failure → `cancelBroadBookingAfterDepositFailure`
   (appointment → `FAILED`, task → `CANCELLED`).
4. Emit `appointment.assignment.created` (receptionist pipeline). **No Visit is created yet.**
5. Response `PENDING` with `appointmentId`, `assignmentTaskId`, `assignmentStatus`, deposit info.

Note the placeholder `scheduledAt` ≈ now is the root cause of bug **B1** (the 24h cancel guard
wrongly treats every broad appointment as "within 24 hours").

---

## 4. Receptionist assignment flow

`appointment-assignment-task.service.ts`: `accept → (assign|release)`.

`assignDoctorAndSlot()`:
1. Validate task is `ASSIGNED` and owned by this receptionist; appointment is broad and `PENDING`/`CONFIRMED`.
2. **Deposit gate**: DICH_VU requires `depositStatus = PAID` before assignment.
3. Resolve slot, ensure not in the past, ensure it belongs to the doctor (via `Shift.timeSlots`).
4. Acquire Redis slot lock; in a transaction re-check ownership/assignability and conflicts, then:
   - set `doctorId`, `timeSlot`, `date`/`scheduledAt`/`startTime`/`endTime`,
   - `assignmentStatus = ASSIGNED`,
   - **`appointmentStatus = CONFIRMED`** (`:380` — the patient can now check in),
   - mark slot `booked`, task → `COMPLETED`.
5. Emit `appointment.booking.success` (→ Visit created) and `appointment.assignment.completed`.

Concurrency: a 30s Redis task lock plus the transactional re-checks prevent two receptionists
from double-assigning. **No "missing CONFIRMED" bug.**

---

## 5. Cancel flow

`appointment.service.ts → cancelAppointment()`.

Current behavior:
1. Authorization (`assertCanCancelAppointment`): owner patient or staff (ADMIN/RECEPTIONIST).
2. Status must be `PENDING`/`CONFIRMED`.
3. **24h guard** — block if `scheduledAt` is within 24h.
4. In a transaction: re-check status/timing; load deposit payments; **require a Visit to exist**;
   require `Visit = CREATED`; block if encounter/billing/payment exist.
5. Refund: only when `DICH_VU && depositStatus = PAID && depositPaidAmount > 0` → credit wallet
   (`creditService.refundAppointmentCancellation`, idempotent), `depositStatus = REFUNDED`
   (or `FORFEITED` if rate 0). `APPOINTMENT_DEPOSIT_PAYMENT_PENDING` blocks cancel while a VNPAY
   callback is in flight (correct).
6. `appointmentStatus = CANCELLED`; `Visit = CANCELLED`; release slot **only** when
   `timeSlot` exists and is currently `booked` (`modifiedCount === 1`, no blind release).
7. Emit `notify/mail/socket.appointment.cancelled`.

Gaps: steps 3 and 4 make **broad appointments impossible to cancel** (B1); the active
assignment task is **never closed** (B2).

---

## 6. Reschedule flow

`appointment-reschedule.service.ts → rescheduleAppointment()`.

1. Reject when **no `doctorId`** (`APPOINTMENT_DOCTOR_NOT_ASSIGNED`) → broad appointments cannot be rescheduled (correct).
2. Status must be `PENDING`/`CONFIRMED`; Visit must exist and be `CREATED`; block on encounter/billing/payment.
3. Resolve new window; no-op short-circuit if same slot/time; slot must belong to the same doctor (`Shift.timeSlots`); reject past times.
4. Redis slot lock + transaction: conflict check, update schedule snapshot + `timeSlot`,
   release old slot only if changed, mark new slot `booked`. **`appointmentStatus` and all
   deposit/payment fields are left untouched.** Unique index `11000` maps to `SLOT_UNAVAILABLE`.
5. Emit `appointment.rescheduled` (does **not** emit `booking.success`, so no new Visit/wallet ops).

Note: reschedule has **no 24h guard** (cancel does). Acceptable/by-design; documented here for awareness.

---

## 7. Appointment status transition matrix

| Scenario | Initial | After payment/assignment | Notes |
|---|---|---|---|
| Normal BHYT / 0 amount | PENDING | CONFIRMED | confirmed immediately, `booking.success` |
| Normal DICH_VU | PENDING | CONFIRMED on deposit PAID | VNPAY callback drives confirmation |
| Broad (any) | PENDING + AWAITING_ASSIGNMENT | — | stays PENDING until assigned |
| Broad assigned by receptionist | PENDING/CONFIRMED | CONFIRMED + ASSIGNED | `appointment-assignment-task.service.ts:380` |
| Cancel (normal/assigned) | PENDING/CONFIRMED | CANCELLED | 24h + Visit guards apply |
| Cancel (broad) **(after fix)** | PENDING (AWAITING_ASSIGNMENT) | CANCELLED | 24h + Visit guards bypassed; task closed |
| Reschedule | PENDING/CONFIRMED | unchanged | status preserved (not `RESCHEDULED`) |

Check-in is only possible when `appointmentStatus = CONFIRMED` (`visit.service.ts:383`).

---

## 8. Deposit / payment / refund matrix

| Category | Deposit at booking | Confirm condition | Cancel refund |
|---|---|---|---|
| BHYT | `NOT_REQUIRED`, amount 0 | immediate | none |
| DICH_VU (normal) | `PENDING` → `PAID` (VNPAY) | on deposit PAID | `PAID` → refund to credit wallet → `REFUNDED` |
| DICH_VU (broad) | `PENDING` → `PAID` (VNPAY) | on receptionist assign (after PAID) | same as above (after fix, cancellable while awaiting) |
| Deposit pending (callback in flight) | `PENDING` | not confirmed | **blocked** (`APPOINTMENT_DEPOSIT_PAYMENT_PENDING`) |

Refund source of truth is the **verified deposit** (`depositStatus`/`depositPaidAmount`), never the
legacy `amount`/intended amounts. Refund is idempotent per appointment.

---

## 9. Visit create / update / cancel rules

- **Create**: only on `appointment.booking.success` (normal confirm, deposit PAID, or receptionist
  assign). Never before doctor/slot exist; broad appointments have no Visit while `AWAITING_ASSIGNMENT`.
- **Check-in**: `Visit CREATED → CHECKED_IN`, requires `appointmentStatus = CONFIRMED`.
- **Cancel**: `Visit → CANCELLED` together with the appointment (only when a Visit exists).
- **Reschedule**: Visit is **not** recreated; only allowed while `Visit = CREATED`.

---

## 10. Slot reservation / release / reassignment rules

- Normal booking & receptionist assignment: mark slot `booked` (in a transaction, under Redis lock).
- Broad booking: **no slot reserved** until assignment.
- Cancel: release slot only when the appointment owns a currently-`booked` slot
  (`{_id, status:'booked'}`, `modifiedCount === 1`) — **no blind release**.
- Reschedule: release old slot only if it changed; reserve new slot; atomic under Redis lock.
- Locks: `slot:{doctorId}:{timeSlotId}` via `RedisService.acquireSlotLock` (SET NX EX, compare-and-delete release).

---

## 11. FE / BE contract notes

- `broadBooking`, nullable `doctor`/`timeSlotId`, the status/assignment/deposit enums, and the
  broad-booking + assignment-task endpoints are all aligned between FE types and BE.
- FE correctly handles the `AWAITING_ASSIGNMENT` state during the **booking** flow.
- Mismatches are in the **appointment list/detail** surface (see F1–F4): the card view-model omits
  `assignmentStatus`, renders doctor fields unconditionally, and shows reschedule for broad
  appointments the BE rejects.
- api-contract cancel section must be updated to describe broad cancellation (no Visit required,
  no 24h window, deposit refunded, task closed).

---

## Bugs found

| # | Bug | Risk | Location |
|---|-----|------|----------|
| **B1** | Broad/unassigned appointment cannot be cancelled — blocked by the 24h guard (placeholder `scheduledAt` ≈ now) and the missing-Visit guard. Patient who paid a DICH_VU deposit is stuck with no refund path. | **HIGH** | `appointment.service.ts:422`, `:482`, `:516` |
| **B2** | Cancel never closes the active assignment task → orphaned `PENDING`/`ASSIGNED` task in the receptionist queue; a receptionist could pick up a task for a cancelled appointment. | **MED** | `appointment.service.ts:396-645` (omission) |
| **F1** | FE shows Reschedule (and historically Cancel) for broad appointments by status only; BE rejects reschedule (`APPOINTMENT_DOCTOR_NOT_ASSIGNED`). | MED | `AppointmentCard.tsx:55-61` |
| **F2** | FE renders `doctorName`/`specialization` unconditionally → blank for unassigned broad appointments. | MED | `AppointmentCard.tsx:102`, `AppointmentDetailModal` |
| **F3** | After cancel, FE does not surface the refund amount or refetch `depositStatus = REFUNDED`. | LOW | cancel handler / appointment actions hook |
| **F4** | FE never shows an "awaiting assignment" indicator on cards/history. | LOW | `AppointmentCard` / `AppointmentDetailModal` |

Non-bugs (recorded for awareness): reschedule has no 24h guard (acceptable); refunds go to the
credit wallet, not VNPAY (by design).

---

## Recommended fix plan

1. **B1 + B2 (backend)** — in `cancelAppointment`, compute
   `isAwaitingAssignment = assignmentStatus === AWAITING_ASSIGNMENT`. Bypass the 24h guard and the
   missing-Visit guard for broad appointments; run Visit/billing handling only `if (visit)`; keep the
   deposit refund and `APPOINTMENT_DEPOSIT_PAYMENT_PENDING` guard as-is; and, inside the transaction,
   close the active task (`PENDING`/`ASSIGNED` → `CANCELLED` with a `history` entry), reusing the
   pattern from `cancelBroadBookingAfterDepositFailure`. Normal-flow behavior is unchanged.
2. **api-contract** — document broad cancellation in `api-contract/api.md`; push the submodule first.
3. **Frontend** — F1 gate reschedule on `assignmentStatus`/`doctorId`; F2 doctor-field fallback;
   F3 post-cancel refetch + show refund amount; F4 awaiting-assignment badge.
4. **Tests** — broad cancel succeeds (null doctor/slot/visit, bypasses 24h, refunds DICH_VU, closes
   task); pending-callback still blocked; normal cancel regression intact.
