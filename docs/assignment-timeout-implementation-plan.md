# Backend Implementation Plan: Overdue Appointment Assignment Tasks

## Scope

This document analyzes and proposes a backend implementation plan for automatically handling overdue broad/unassigned appointment assignment tasks.

No implementation code has been changed as part of this plan.

Business goal:

- When an `AppointmentAssignmentTask` becomes overdue, automatically cancel the related appointment.
- Treat the cancellation as a system auto-cancellation caused by assignment timeout.
- Do not treat it as a patient cancellation.
- Refactor broad `DICH_VU` booking so payment and assignment are strictly sequential.
- Preserve existing refund, Visit, notification, email, realtime, and assignment invariants.

## Likely Touched Files

Before implementation, these are the exact files/classes/functions that will likely be touched:

- `src/appointment/appointment.service.ts`
  - `AppointmentService.cancelAppointment`
  - new internal core such as `cancelAppointmentInternal(...)`
  - new system entry point such as `cancelForAssignmentTimeout(...)`
- `src/appointment/appointment-assignment-sla.scheduler.ts`
  - `AssignmentSlaScheduler.expireOverdue`
- `src/appointment/appointment-assignment-sla.config.ts`
  - only if timeout/grace behavior needs config naming changes
- `src/appointment/appointment-booking.service.ts`
  - `AppointmentBookingService.bookBroadAppointment`
  - `AppointmentBookingService.expirePendingBookings`
  - `AppointmentBookingService.failBooking`
  - `AppointmentBookingService.releaseBookingLock`
  - `AppointmentBookingService.releaseBookingLockAndReleaseSlot`
  - stop creating/exposing broad `DICH_VU` assignment tasks before deposit success
  - add or reuse a broad unpaid-deposit expiry path for forward records
- `src/appointment/appointment-assignment-task.service.ts`
  - `AppointmentAssignmentTaskService.assignDoctorAndSlot`
  - likely new helper for creating exactly one task after broad `DICH_VU` deposit success
  - legacy-safe lookup to avoid duplicate active tasks
- `src/payment/payment.service.ts`
  - `PaymentService.createDepositPaymentForAppointment`
  - `PaymentService.markDepositPaymentSuccess`
  - `PaymentService.markDepositPaymentFailed`
  - may need explicit unpaid deposit expiry handling instead of relying only on Mongo TTL deletion
- `src/appointment/listeners/visit-booking.listener.ts` or current Visit creation listener path
  - guard that broad payment success does not emit or process booking-success/Visit creation
- `src/payment/schemas/payment.schema.ts`
  - `Payment.expireAt` TTL behavior should be documented/reviewed
- `src/payment/vnpay/vnpay-timeout.config.ts`
  - source of `VN_PAY_EXPIRE_MINUTES` and `BOOKING_PENDING_TTL_SECONDS`
- `src/appointment/schemas/appointment.schema.ts`
  - optional audit fields: `cancelledAt`, `cancellationActor`, `cancellationReasonCode`
- `src/appointment/enums/*`
  - likely new cancellation actor/reason enums
- `src/notification/dto/notification-payload.dto.ts`
- `src/notification/listenners/appointment.notify.listenner.ts`
- `src/notification/notification-template.helper.ts`
- `src/mail/mail.listenner.ts`
- `src/mail/mail.service.ts`
- `src/socket/namespace/appointment/appointment-result.gateway.ts`
  - only if appointment-cancel socket payload needs `actor` / `reasonCode`
- `api-contract/api.md`
- possibly `api-contract/README_BROAD_BOOKING_REDIS_FE_INTEGRATION.md`
- tests:
  - `src/appointment/appointment-assignment-sla.scheduler.spec.ts`
  - `src/appointment/appointment.service.cancel.spec.ts`
  - `src/appointment/appointment-assignment-task.assign.spec.ts`
  - `src/notification/notification-audience.spec.ts`
  - `src/notification/listenners/assignment.notify.listenner.spec.ts`
  - mail tests should be added if no mail-specific coverage exists

If implementation reveals stronger local patterns, prefer those over the names proposed here.

## 1. Current Architecture

### Broad Appointment Creation

Broad appointments are created in `AppointmentBookingService.bookAppointment(...)`, which branches into `bookBroadAppointment(...)` when `broadBooking=true`.

That path creates an `Appointment` with:

- `appointmentStatus = PENDING`
- `assignmentStatus = AWAITING_ASSIGNMENT`
- no `doctorId`
- no `timeSlot`
- placeholder `scheduledAt` / `date` based on booking time
- `depositStatus = PENDING` for DICH_VU
- `depositStatus = NOT_REQUIRED` for BHYT / no-deposit cases

It also creates one `AppointmentAssignmentTask` with:

- `status = PENDING`
- `deadlineAt = now + ASSIGNMENT_DEADLINE_MINUTES`
- `specialty`
- `reasonForAppointment`
- `patientEmail`
- `priority = NORMAL`
- history entry noting broad booking creation

After successful creation, the service emits:

- `appointment.assignment.created`

It does not emit:

- `appointment.booking.success`

Therefore a broad appointment does not create a Visit until a doctor/slot is assigned.

### Existing Statuses

Appointment statuses:

- `PENDING`
- `CONFIRMED`
- `FAILED`
- `CANCELLED`
- `COMPLETED`
- `RESCHEDULED`

Appointment assignment statuses:

- `NONE`
- `AWAITING_ASSIGNMENT`
- `ASSIGNED`

Assignment task statuses:

- `PENDING`
- `ASSIGNED`
- `COMPLETED`
- `EXPIRED`
- `ESCALATED`
- `CANCELLED`

Deposit statuses:

- `NOT_REQUIRED`
- `PENDING`
- `PAID`
- `FAILED`
- `REFUNDED`
- `FORFEITED`

### Receptionist Assignment Flow

Receptionist assignment flow lives in `AppointmentAssignmentTaskService`.

`acceptTask(...)`:

- atomically changes `PENDING -> ASSIGNED`
- stores `acceptedByReceptionistId`
- stores `acceptedAt`
- appends a history entry

`releaseTask(...)`:

- requires the caller to be the accepting receptionist
- changes `ASSIGNED -> PENDING`
- clears accepted fields
- appends a history entry

`assignDoctorAndSlot(...)`:

- requires task status `ASSIGNED`
- requires the caller to own the task
- verifies the appointment is still broad/unassigned
- allows appointment status `PENDING` or `CONFIRMED`
- for DICH_VU, requires `depositStatus = PAID`
- validates the target slot and doctor ownership
- uses Redis slot lock
- transactionally:
  - sets appointment `doctorId`
  - sets appointment `timeSlot`
  - sets appointment `scheduledAt`, `startTime`, `endTime`
  - sets `assignmentStatus = ASSIGNED`
  - sets `appointmentStatus = CONFIRMED`
  - marks slot `booked`
  - sets task `status = COMPLETED`
  - sets `completedAt`
  - appends task history
- emits:
  - `appointment.booking.success`
  - `appointment.assignment.completed`

The `appointment.booking.success` event is the centralized Visit creation boundary.

### Visit Creation Assumptions

`VisitBookingListener` listens to `appointment.booking.success` and calls `VisitService.createVisitFromAppointment(...)`.

`VisitService.createVisitFromAppointment(...)`:

- is idempotent by `appointmentId`
- reads the source appointment
- requires `doctorId`
- requires `patientId`
- creates `Visit(CREATED)`

Broad appointments intentionally do not have a Visit until assignment.

`VisitService.checkInVisit(...)` requires:

- Visit exists
- Visit status is `CREATED`
- linked appointment exists
- linked appointment `appointmentStatus === CONFIRMED`

The durable check-in source of truth is the appointment's `appointmentStatus`.

### Cancellation Flow

`AppointmentService.cancelAppointment(...)` currently handles cancellation.

For normal/assigned appointments, it:

- requires appointment status `PENDING` or `CONFIRMED`
- enforces patient/staff authorization
- blocks within 24 hours of scheduled appointment time
- requires linked Visit to exist
- requires Visit status `CREATED`
- blocks if Visit is checked in, in progress, completed, or otherwise not `CREATED`
- blocks if a medical encounter exists
- blocks if billing/payment exists
- validates deposit payment consistency
- refunds paid DICH_VU deposit when applicable
- sets appointment status `CANCELLED`
- sets Visit status `CANCELLED`
- releases booked slot
- closes active broad assignment task if one exists
- emits notification/mail/socket side effects

For broad `AWAITING_ASSIGNMENT` appointments, it special-cases cancellation:

- skips the 24-hour rule
- skips the missing-Visit guard
- does not release a slot when no slot exists
- closes open assignment tasks `PENDING/ASSIGNED -> CANCELLED`
- still applies deposit refund rules
- still blocks pending/ambiguous/inconsistent deposit payment records

### Deposit / Refund Logic

Cancellation refund logic currently uses only verified paid deposit evidence:

- `paymentCategory = DICH_VU`
- `depositStatus = PAID`
- `depositPaidAmount > 0`
- linked deposit payment status is `SUCCESS`

Refund goes to `CreditWallet` via `CreditService.refundAppointmentCancellation(...)`.

Refund idempotency is already based on appointment id:

- `refund-appointment-cancel-${appointmentId}`

BHYT / `NOT_REQUIRED` appointments do not refund.

Coin wallet is not credited/restored.

Pending deposit payment callback guard:

- if deposit payment is `PENDING`, cancellation is blocked with `APPOINTMENT_DEPOSIT_PAYMENT_PENDING`

### Notifications

Notifications use the async notification pipeline:

1. domain event
2. notification listener
3. RabbitMQ notification job
4. handler registry
5. Mongo notification row
6. Redis publish
7. `/notification` socket emits `NOTIFICATION_RECEIVED`

Assignment notification events already exist:

- `appointment.assignment.created`
- `appointment.assignment.reminder`
- `appointment.assignment.expired`
- `appointment.assignment.completed`

Typed notification payloads already include:

- `ASSIGNMENT_TASK_CREATED`
- `ASSIGNMENT_TASK_REMINDER`
- `ASSIGNMENT_TASK_EXPIRED`
- `APPOINTMENT_DOCTOR_ASSIGNED`
- `APPOINTMENT_CANCELLED`

Current cancellation notification content is generic and can imply patient cancellation, especially doctor-facing copy.

### Email

Mail is EventEmitter-based through `MailListener` and `MailService`.

Current patient appointment cancellation email is handled by:

- event: `mail.patient.appointment.cancelled`
- method: `MailService.sendPatientAppointmentCancellationMail(...)`

The current template is generic appointment cancellation copy. It does not distinguish assignment timeout.

### Realtime / Socket Events

Notification center realtime uses:

- namespace: `/notification`
- event: `NOTIFICATION_RECEIVED`

Appointment lifecycle realtime uses:

- namespace: `/appointment`
- `socket.appointment.cancelled`
- socket event enum: `APPOINTMENT_CANCELLED`

Receptionist queue refresh currently relies on assignment notification types plus polling.

### Existing Scheduler / Cron Pattern

The repo uses `setInterval`-based schedulers, not `@nestjs/schedule`.

`AssignmentSlaScheduler`:

- starts on module init
- runs every `SLA_SWEEP_INTERVAL_MS`
- has an in-process `running` guard
- has a Redis global lock `cron:assignment-sla`
- sends reminders
- expires overdue `PENDING` tasks
- reclaims stale accepted `ASSIGNED` tasks

Current `expireOverdue(...)` only:

- finds `PENDING` tasks past `deadlineAt + grace`
- sets task status `EXPIRED`
- appends task history
- emits `appointment.assignment.expired`

It explicitly does not auto-cancel, auto-refund, or touch appointments.

## Payment Pending / TTL / Unpaid Expiration Architecture

### Where Deposit Payment Is Created

Deposit payment creation is centralized in `PaymentService.createDepositPaymentForAppointment(...)`.

It is called by:

- normal doctor-selected DICH_VU booking in `AppointmentBookingService.bookAppointment(...)`
- broad DICH_VU booking in `AppointmentBookingService.bookBroadAppointment(...)`

The payment row is created with:

- `purpose = APPOINTMENT_DEPOSIT`
- `appointmentId = appointment._id`
- `amount = normalized deposit amount`
- `method = QR`
- `status = PENDING`
- `idempotencyKey = APPOINTMENT_DEPOSIT:<appointmentId>`
- `expireAt = now + VN_PAY_EXPIRE_MINUTES`

The appointment stores:

- `depositPaymentId = payment._id`

VNPay URL generation uses the deposit payment id as `vnp_TxnRef`.

### VNPay Callback Success

VNPay return is handled by `VnPayPaymentController.vnpayReturn(...)`.

For success, it calls:

- `PaymentService.handleVnpayPaymentResultByTxnRef(...)`
- `PaymentService.markDepositPaymentSuccess(...)` when the txn ref resolves to a deposit payment

`markDepositPaymentSuccess(...)` transactionally:

- verifies payment exists
- verifies payment is `APPOINTMENT_DEPOSIT`
- rejects success if `payment.expireAt < now`
- loads appointment
- allows appointment status `PENDING` or `CONFIRMED`
- sets payment:
  - `status = SUCCESS`
  - `expireAt = null`
  - `transactionId`
  - `paidAt`
- sets appointment:
  - `depositStatus = PAID`
  - `depositPaidAmount = payment.amount`
  - `depositPaidAt = paidAt.getTime()`
  - `depositPaymentId = payment._id`
  - if appointment was `PENDING`, `appointmentStatus = CONFIRMED`
- emits `payment.update`
- emits `appointment.booking.success` if the appointment changed from pending to confirmed

Important broad-booking concern:

- For a broad DICH_VU appointment, success can set `appointmentStatus = CONFIRMED` before a doctor/slot exists.
- It can also emit `appointment.booking.success`.
- `VisitBookingListener` reacts to `appointment.booking.success` and attempts to create a Visit.
- Visit creation requires `doctorId`, so this path should be reviewed because broad appointments intentionally do not have a doctor until assignment.

### VNPay Callback Failure

For failure, `VnPayPaymentController.vnpayReturn(...)` calls:

- `PaymentService.handleVnpayPaymentFailureByTxnRef(...)`
- `PaymentService.markDepositPaymentFailed(...)` when the txn ref resolves to a deposit payment

`markDepositPaymentFailed(...)` transactionally:

- sets payment:
  - `status = FAILED`
  - `expireAt = null`
  - callback metadata
- sets appointment:
  - `depositStatus = FAILED`
  - if appointment was `PENDING`, `appointmentStatus = FAILED`
- releases `TimeSlotLog` to `available` only if `appointment.timeSlot` exists

Current gap:

- It does not close a related broad `AppointmentAssignmentTask`.
- For normal bookings, no assignment task exists.
- For broad bookings, an unpaid failed deposit can leave an assignment task active unless another path closes it.

### Payment Expiration Mechanisms

There are two different expiration mechanisms today.

#### 1. Mongo Payment TTL Index

`PaymentSchema` defines:

```ts
PaymentSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });
```

This means MongoDB can delete expired payment documents automatically when `expireAt` passes.

Important limitation:

- Mongo TTL deletion has no application side effects.
- It does not update `Appointment.depositStatus`.
- It does not update `Appointment.appointmentStatus`.
- It does not release a `TimeSlotLog`.
- It does not close `AppointmentAssignmentTask`.
- It does not emit notifications.

So `Payment.expireAt` is not by itself a business workflow for failing unpaid appointments.

#### 2. Appointment Pending Booking Sweep

`AppointmentBookingService` starts a `setInterval` on module init and calls:

- `expirePendingBookings()`

The sweep finds:

- `appointmentStatus = PENDING`
- `createdAt <= now - BOOKING_PENDING_TTL_SECONDS`
- `assignmentStatus != AWAITING_ASSIGNMENT`

Then it calls:

- `failBooking(appointmentId, "Appointment expired after <minutes> minutes")`

`failBooking(...)`:

- sets appointment `appointmentStatus = FAILED`
- if `depositStatus = PENDING`, sets `depositStatus = FAILED`
- releases Redis slot lock and TimeSlotLog via `releaseBookingLockAndReleaseSlot(...)`
- emits `appointment.booking.failed`

This sweep explicitly excludes broad appointments:

```ts
assignmentStatus: { $ne: AssignmentStatus.AWAITING_ASSIGNMENT }
```

The code comment says broad appointments are governed by assignment task deadline, not booking-payment TTL.

### Redis Slot Hold / Release Behavior

Normal doctor-selected booking:

- has `doctorId`
- has `timeSlot`
- acquires Redis slot lock:
  - key: `slot:{doctorId}:{timeSlotId}`
  - ttl: `BOOKING_PENDING_TTL_SECONDS`
- creates appointment with concrete slot
- marks `TimeSlotLog.status = booked` inside the appointment transaction
- for DICH_VU, appointment remains `PENDING` until deposit success
- if payment succeeds:
  - appointment becomes `CONFIRMED`
  - Redis slot lock is released
- if payment fails or pending-booking sweep expires it:
  - appointment becomes `FAILED`
  - deposit becomes `FAILED`
  - Redis slot lock is released
  - TimeSlotLog becomes `available`

Broad/unassigned booking:

- has no `doctorId`
- has no `timeSlot`
- does not acquire a doctor slot lock during booking
- does not mark any `TimeSlotLog` booked during booking
- creates an assignment task immediately
- for DICH_VU, creates a pending deposit payment and returns payment URL
- emits `appointment.assignment.created` immediately after deposit payment record creation

Therefore broad bookings do not participate in the initial Redis slot-hold flow. There is no doctor slot to release while unpaid.

Broad assignment later uses Redis slot lock inside `AppointmentAssignmentTaskService.assignDoctorAndSlot(...)`, but that path is blocked until DICH_VU `depositStatus = PAID`.

### What Happens When DICH_VU Payment Stays PENDING Until TTL Expires

Normal doctor-selected appointment:

- the appointment pending sweep eventually calls `failBooking(...)`
- appointment becomes `FAILED`
- deposit becomes `FAILED`
- slot lock is released
- TimeSlotLog becomes `available`
- no assignment task exists

Payment document behavior:

- Mongo TTL may also delete the pending payment document after `expireAt`
- this deletion does not perform state transitions
- the appointment sweep is the business-side cleanup for normal bookings

Broad/unassigned appointment:

- `Payment.expireAt` may delete the pending payment row
- the appointment pending sweep excludes `assignmentStatus = AWAITING_ASSIGNMENT`
- appointment can remain:
  - `appointmentStatus = PENDING`
  - `depositStatus = PENDING`
  - `assignmentStatus = AWAITING_ASSIGNMENT`
- assignment task can remain:
  - `status = PENDING`
  - visible to receptionists
  - deadline ticking from booking creation time
- receptionist assignment is blocked by:
  - `DEPOSIT_NOT_PAID`

This means the current code can create assignment tasks for unpaid broad DICH_VU appointments and make them visible to receptionists even though assignment cannot complete until `depositStatus = PAID`.

If Mongo deletes the payment row before the app updates the appointment, `getDepositStatus(...)` can still return appointment `depositStatus = PENDING` with no payment status. The appointment is not terminal because the appointment fields were never updated.

### Assignment SLA Start Time

Current behavior:

- broad task is created immediately during booking
- `deadlineAt` is set immediately during booking
- `appointment.assignment.created` is emitted immediately
- assignment SLA starts before DICH_VU deposit payment succeeds

This is problematic for DICH_VU:

- receptionist cannot assign until `depositStatus = PAID`
- the deadline can expire while the task is unassignable
- auto-cancelling as assignment timeout would blame assignment failure when payment is actually still unpaid/expired

### Confirmed Sequential Business Rule

Broad `DICH_VU` payment and assignment must be strictly sequential.

Forward behavior:

1. Broad `BHYT` / `NOT_REQUIRED`
   - create `Appointment` immediately
   - create `AppointmentAssignmentTask` immediately
   - start assignment SLA immediately
   - emit assignment-created semantics immediately

2. Broad `DICH_VU`
   - create `Appointment` immediately
   - create deposit `Payment` immediately
   - do not create or expose `AppointmentAssignmentTask` while `depositStatus = PENDING`
   - do not emit `appointment.assignment.created` while payment is pending
   - do not include an actionable `assignmentTaskId` in the booking response before payment success

3. Broad `DICH_VU` deposit success
   - set `depositStatus = PAID`
   - set `depositPaidAmount`
   - set `depositPaidAt`
   - keep `appointmentStatus = PENDING`
   - keep or set `assignmentStatus = AWAITING_ASSIGNMENT`
   - create exactly one active assignment task
   - set `deadlineAt = depositPaidAt + ASSIGNMENT_DEADLINE_MINUTES`
   - emit assignment-created and deposit-paid semantics
   - do not emit `appointment.booking.success`
   - do not create a `Visit`

4. Broad `DICH_VU` deposit failure or payment-window expiration
   - set `appointmentStatus = FAILED`
   - set `depositStatus = FAILED`
   - do not refund
   - do not release a doctor slot because no doctor/slot exists yet
   - emit payment/booking-failure semantics
   - do not emit assignment-timeout semantics

5. Broad assignment timeout
   - apply only to actionable assignment tasks:
     - `BHYT` / `NOT_REQUIRED`
     - `DICH_VU` / `PAID`
   - if overdue, set appointment `CANCELLED`
   - set task `EXPIRED`
   - refund paid `DICH_VU` deposits through the existing safe refund path
   - use `actor = SYSTEM`
   - use `reasonCode = ASSIGNMENT_TIMEOUT`
   - send timeout-specific notification/email content

This design avoids exposing work that receptionists cannot complete and prevents assignment SLA from measuring unpaid payment time.

### Implication For Assignment Timeout Plan

Assignment timeout should be evaluated only when the task is actually assignable:

- BHYT / no-deposit broad appointment:
  - `depositStatus = NOT_REQUIRED`
  - assignment SLA can start at booking
- DICH_VU broad appointment:
  - `depositStatus = PAID`
  - assignment SLA starts after payment success
  - `deadlineAt = depositPaidAt + ASSIGNMENT_DEADLINE_MINUTES`
- DICH_VU pending deposit:
  - no forward assignment task should exist
  - assignment SLA should not mark task `EXPIRED`
  - assignment timeout should not cancel it as `ASSIGNMENT_TIMEOUT`
  - unpaid payment timeout should resolve it as payment failure/unpaid expiration

## Critical Review: Missing / Risky Assumptions Confirmed From Code

The initial timeout plan treated `depositStatus = PENDING` mostly as a cancellation/refund guard. Code and docs show it is a separate lifecycle state with its own timeout behavior.

Confirmed risks:

- `Payment.expireAt` uses a Mongo TTL index, but TTL deletion does not update appointment/task state.
- normal doctor-selected DICH_VU has an application-level pending booking sweep that fails unpaid bookings and releases the slot.
- broad DICH_VU is excluded from that sweep by `assignmentStatus != AWAITING_ASSIGNMENT`.
- broad DICH_VU creates an assignment task immediately, before deposit is paid.
- broad DICH_VU emits `appointment.assignment.created` immediately, so the task can be visible to receptionists while assignment will later fail with `DEPOSIT_NOT_PAID`.
- broad DICH_VU payment success can emit `appointment.booking.success` before doctor/slot assignment, which can conflict with the Visit creation invariant that Visit requires `doctorId`.
- paid broad appointments should not be blindly cancelled just because they are `CONFIRMED`; only broad/unassigned appointments with no doctor/slot are assignment-timeout candidates.
- public patient cancellation is unsafe to reuse directly because it has authorization/API semantics, generic patient-cancel side effects, and closes tasks as `CANCELLED` rather than `EXPIRED`.

Smallest forward correction:

- stop creating broad `DICH_VU` assignment tasks before deposit payment succeeds.
- create the broad `DICH_VU` assignment task from the deposit-success path, with `deadlineAt` based on `depositPaidAt`.
- keep broad `DICH_VU` `appointmentStatus = PENDING` after payment success until `assignDoctorAndSlot(...)` confirms doctor/slot assignment.
- keep assignment timeout cancellation only for actionable broad appointments:
  - BHYT / `NOT_REQUIRED`
  - DICH_VU / `PAID`
- do not process `DICH_VU` / `PENDING` as assignment timeout.
- add or reuse a separate unpaid-deposit expiration path for forward broad `DICH_VU` records:
  - appointment `PENDING -> FAILED`
  - deposit `PENDING -> FAILED`
  - no forward task should exist
  - no refund
  - no doctor slot release
  - payment/booking failure side effects, not assignment-timeout cancellation side effects
- for legacy records only, if an active task already exists while `depositStatus = PENDING`, close it from the explicit payment-failure path if payment failure/expiration is confirmed; do not let the assignment scheduler infer that payment outcome.

## 2. Current Problem

When an assignment task passes `deadlineAt + grace`, the scheduler marks only the task as `EXPIRED`.

The related appointment remains active:

- usually `PENDING`
- sometimes `CONFIRMED` if DICH_VU deposit succeeds before assignment

This can leave a patient appointment stuck without:

- doctor
- slot
- Visit
- clear patient-facing resolution

The patient can manually cancel a broad appointment today because broad cancellation skips the 24-hour and missing-Visit guards. But that relies on user action, not the intended automatic system behavior.

Open issues:

- expired tasks can leave active appointments behind
- active assignment tasks can become orphaned from user perspective
- assignment timeout is not communicated to the patient as a system failure to assign a doctor
- reusing current public cancel flow directly would produce patient-cancel semantics
- current API contract explicitly says expiry does not auto-cancel or auto-refund
- scheduler currently has no appointment/payment/credit dependencies by design
- broad DICH_VU creates a visible assignment task while `depositStatus = PENDING`, even though assignment is blocked until `depositStatus = PAID`
- broad DICH_VU unpaid payment expiry is not resolved by the normal pending-booking sweep because `AWAITING_ASSIGNMENT` appointments are excluded
- Mongo `Payment.expireAt` TTL can delete the payment row without updating appointment/task state

Race risks:

- scheduler runs twice
- two backend instances process the same task
- receptionist assigns while scheduler expires
- refund is attempted twice
- notification/email is sent twice
- appointment is already cancelled/failed/completed

## 3. Proposed Design

Implement the forward lifecycle in two pieces:

1. make broad `DICH_VU` assignment work appear only after deposit payment succeeds
2. handle overdue actionable assignment tasks through the existing assignment SLA scheduler plus a shared internal appointment cancellation core

Expected behavior:

- broad `DICH_VU` booking creates appointment + deposit payment only
- broad `DICH_VU` deposit success creates exactly one assignment task and starts SLA from `depositPaidAt`
- broad `DICH_VU` payment failure/expiration marks appointment/deposit `FAILED` and does not refund
- detect overdue assignment tasks
- only treat a task as assignment-timeout eligible when the appointment is payment-eligible for assignment
- skip legacy DICH_VU tasks while `depositStatus = PENDING`
- atomically mark active overdue task as `EXPIRED`
- cancel the related appointment through shared internal cancellation/refund logic
- do not treat it as patient cancellation
- use `actor = SYSTEM`
- use `reasonCode = ASSIGNMENT_TIMEOUT`
- skip patient-only cancellation policy such as the 24-hour rule
- skip Visit-required guard for broad appointments because no Visit may exist yet
- do not release doctor slot if no doctor/slot was assigned
- refund paid DICH_VU deposit if applicable
- do nothing for BHYT / `NOT_REQUIRED` deposit refund
- avoid double cancellation and double refund
- emit realtime events for receptionist queue and notification center refresh
- send patient notification/email explaining the system could not assign a doctor in time

### Recommended Internal Flow

Add a system-facing method, for example:

```ts
cancelForAssignmentTimeout(taskId: string, now = Date.now())
```

This method should delegate to a shared core cancellation method with system-specific options.

Inside a transaction:

1. Load the assignment task.
2. Require task status to still be active:
   - `PENDING`
   - maybe `ASSIGNED`, if business confirms accepted-but-not-completed tasks should timeout too
3. Require task `deadlineAt <= now - graceMs`.
4. Load linked appointment.
5. If appointment is DICH_VU and `depositStatus = PENDING`, do not expire it as assignment timeout.
   - for forward records, this state should have no active assignment task
   - for legacy records, skip and optionally log if the payment row is missing/expired
   - do not infer payment failure inside the assignment scheduler
6. Require appointment is still broad/unassigned:
   - `assignmentStatus = AWAITING_ASSIGNMENT`
   - no `doctorId`
   - no `timeSlot`
7. Require appointment status is cancellable:
   - `PENDING`
   - `CONFIRMED` only if still broad/unassigned
8. Apply deposit/payment guards.
9. Refund verified paid DICH_VU deposit.
10. Set appointment status `CANCELLED`.
11. Optionally set cancellation audit fields.
12. Set task status `EXPIRED`.
13. Append task history:
   - `by = system`
   - `note = assignment timeout`

After commit:

- emit `appointment.assignment.expired`
- emit patient notification/email/socket cancellation side effects with:
  - `actor = SYSTEM`
  - `reasonCode = ASSIGNMENT_TIMEOUT`
  - `assignmentTaskId`
  - `deadlineAt`

### Pending Deposit Policy

Forward policy:

- do not create/expose a broad `DICH_VU` assignment task before deposit success
- do not let assignment SLA expire `depositStatus = PENDING` DICH_VU records as assignment timeout
- preserve the existing `APPOINTMENT_DEPOSIT_PAYMENT_PENDING` guard for cancellation/refund paths
- add or reuse an explicit unpaid-deposit expiration path for broad appointments whose payment window elapsed
- mark unpaid broad `DICH_VU` as payment failure/unpaid expiration, not assignment timeout

This avoids racing a payment callback.

Legacy policy:

- if a broad `DICH_VU` record already has `depositStatus = PENDING` and an active task, the assignment scheduler skips it
- optionally log a warning if its payment row is missing or expired
- do not let the scheduler guess whether payment failed
- if the payment failure/expiration path confirms the payment outcome, it may close that legacy active task as `CANCELLED`

Smallest code-shape correction:

- normal doctor-selected unpaid DICH_VU can keep using `expirePendingBookings() -> failBooking(...)`
- broad unpaid DICH_VU needs a sibling expiration path that:
  - finds `AWAITING_ASSIGNMENT` appointments with `depositStatus = PENDING` whose payment window elapsed
  - sets `depositStatus = FAILED`
  - sets `appointmentStatus = FAILED` or another explicit unpaid terminal state if introduced later
  - for forward records, expects no assignment task
  - for legacy records, closes any open assignment task as `CANCELLED` with note `deposit payment expired`
  - emits booking/payment failure side effects, not assignment-timeout cancellation/refund side effects

## 4. Architecture Decision

### Approach A: Reuse Public Patient Cancellation Directly

Use `AppointmentService.cancelAppointment(...)` from the scheduler.

Pros:

- minimal code
- reuses current refund logic
- reuses current broad-appointment guard bypass

Cons:

- requires fake user or awkward auth bypass
- public API method is patient/staff-shaped
- emits generic patient cancellation notification/mail/socket content
- closes open assignment task as `CANCELLED`, not `EXPIRED`
- cannot cleanly set `actor = SYSTEM`
- cannot cleanly set `reasonCode = ASSIGNMENT_TIMEOUT`
- risks preserving patient-only policy in a system flow
- return shape is API-oriented, not internal workflow-oriented

### Approach B: Extract / Reuse Internal Cancellation Core

Extract shared logic into an internal method, for example:

```ts
cancelAppointmentInternal(options)
```

Public cancellation calls it with patient/staff options.

Scheduler timeout calls it with system options.

Pros:

- keeps public patient cancellation unchanged
- shares refund/payment consistency logic
- shares Visit/slot consistency logic where applicable
- supports system actor/reason semantics
- allows timeout-specific task terminal status `EXPIRED`
- avoids patient-cancel notification/email wording
- easier to test idempotency and race conditions

Cons:

- larger refactor
- requires careful regression coverage
- must avoid changing public API behavior accidentally

Chosen approach: Approach B.

This is safer because assignment timeout is semantically different from patient cancellation but should still share the low-level state, refund, and consistency protections.

### Email / Notification Semantic Rule

Assignment timeout must not produce content saying the patient cancelled the appointment.

If the current cancel flow sends hard-coded patient-cancel content, choose one of these:

1. Add `suppressDefaultCancelEmail` and emit a dedicated timeout email.
2. Preferably, select templates based on `actor` / `reasonCode`.

Recommended: template selection based on `reasonCode = ASSIGNMENT_TIMEOUT`.

## 5. Data / Status Changes

Already supported:

- assignment task status `EXPIRED`
- assignment task status `CANCELLED`
- appointment status `CANCELLED`
- deposit status `REFUNDED`
- deposit status `FORFEITED`

Recommended additions:

```ts
enum CancellationActor {
  PATIENT = 'PATIENT',
  STAFF = 'STAFF',
  SYSTEM = 'SYSTEM',
}

enum CancellationReasonCode {
  PATIENT_REQUEST = 'PATIENT_REQUEST',
  ASSIGNMENT_TIMEOUT = 'ASSIGNMENT_TIMEOUT',
}
```

Optional appointment audit fields:

- `cancelledAt?: number`
- `cancellationActor?: CancellationActor`
- `cancellationReasonCode?: CancellationReasonCode`
- `cancellationReason?: string`

Notification payload additions:

- `actor?: CancellationActor`
- `reasonCode?: CancellationReasonCode`
- `assignmentTaskId?: string`
- `deadlineAt?: number`

Deposit transitions:

- DICH_VU paid deposit:
  - `PAID -> REFUNDED` if refund amount is greater than zero
  - `PAID -> FORFEITED` if refund rate is configured as zero
- BHYT / `NOT_REQUIRED`:
  - unchanged
- DICH_VU pending deposit:
  - should not be assignment-timeout cancelled
  - should become `FAILED` only through payment failure / unpaid expiration handling
  - should close the related assignment task as payment-failed/cancelled, not assignment-timeout expired

No new assignment task status is required.

No new deposit status is required for the smallest correction. Existing `FAILED` already represents an unpaid/failed deposit. If product wants to distinguish user-visible timeout from failed VNPay return, add a separate reason code/audit field rather than a new deposit status.

## 6. Impact Analysis

### Existing Patient Cancellation API

Should remain unchanged externally.

Internally, `cancelAppointment(...)` should delegate to the shared core with:

- permission enforcement enabled
- 24-hour rule enabled
- task terminal status `CANCELLED`
- default patient/staff cancellation templates

### Receptionist Assignment Screen

Expected impact:

- overdue tasks leave the active queue as `EXPIRED`
- accepted overdue tasks may become `EXPIRED` if business allows
- unpaid broad DICH_VU tasks should not be actionable/expired as assignment timeout while `depositStatus = PENDING`
- if the task remains visible before payment, the UI needs a clear "waiting for deposit" state; better is to hide or defer activation until payment succeeds
- assignment attempts racing with timeout should fail cleanly:
  - `TASK_NOT_ASSIGNED`
  - `APPOINTMENT_NOT_ASSIGNABLE`
  - or similar existing blocked reason
- FE should refresh queue on `ASSIGNMENT_TASK_EXPIRED`

### Receptionist Notification Center

Existing `ASSIGNMENT_TASK_EXPIRED` notification should remain, but copy should change from manual attention to something like:

- the assignment task expired
- the related appointment was automatically cancelled

### Patient Appointment History

Appointment should show as `CANCELLED`.

If audit fields are added, FE can distinguish:

- patient cancellation
- system cancellation due to assignment timeout

### Deposit / Refund Behavior

Paid DICH_VU deposit should refund once to CreditWallet.

BHYT / `NOT_REQUIRED` should not refund.

DICH_VU `PENDING` deposit should not refund and should not be handled by assignment-timeout cancellation. It needs payment failure/unpaid expiration handling that sets the deposit to `FAILED`.

Coin wallet remains untouched.

### Email / Notification Content

Patient should receive timeout-specific content:

- the system could not assign a doctor in time
- appointment was automatically cancelled
- refund information if applicable

Do not use wording that says:

- patient cancelled
- doctor cancelled

### Realtime Events

Expected emissions:

- `/notification`: `NOTIFICATION_RECEIVED`
- `/appointment`: `APPOINTMENT_CANCELLED`
- assignment event: `appointment.assignment.expired`

Payload should include `reasonCode = ASSIGNMENT_TIMEOUT` so FE can render correctly.

### API Contract

`api-contract/api.md` currently says assignment expiry does not auto-refund or auto-cancel.

This must be updated during implementation.

Because `api-contract/` is a submodule, after editing contract docs the submodule must be committed and pushed immediately according to repo rules.

### Existing Database Records

Migration/reconciliation is out of scope for the main implementation.

Forward correctness is the goal:

- new broad `DICH_VU` records follow the sequential lifecycle
- no broad `DICH_VU` task is created/exposed before deposit succeeds
- payment success creates or activates assignment work
- payment timeout/failure resolves the appointment as `FAILED`
- assignment timeout applies only to actionable tasks

Legacy unpaid broad `DICH_VU` records may already exist with:

- appointment `PENDING`
- deposit `PENDING`
- assignment task `PENDING` or `EXPIRED`
- missing/deleted payment row because Mongo TTL removed it

Main rollout policy:

- do not let the assignment scheduler infer payment outcomes for legacy `PENDING`-deposit records
- if broad `DICH_VU` has `depositStatus = PENDING`, skip assignment-timeout processing and optionally log a warning if the payment row is missing/expired
- do not automatically demote old `CONFIRMED` records back to `PENDING`
- if broad `DICH_VU` is `PAID`, has no doctor/slot, and already has an active task, treat it as legacy paid-awaiting-assignment and avoid double-creating tasks
- if broad `DICH_VU` is `PAID`, has no active task, create/repair exactly one assignment task only through a conservative explicit path, not as broad migration behavior
- do not automatically reclassify existing `EXPIRED` / `CANCELLED` legacy tasks during this task

If real data requires cleanup, build a separate manual/admin reconciliation script later with explicit operator review and dry-run output.

### Existing Tests

Current tests include useful anchors:

- scheduler tests currently assert no auto-cancel/refund
- cancellation tests cover broad appointment cancellation
- assignment tests cover assignment confirmation and races
- notification tests cover assignment event fanout

These should be updated, not ignored.

### What Remains Unchanged

- normal doctor-selected booking
- patient cancellation endpoint shape
- patient cancellation 24-hour rule for normal/assigned appointments
- Visit check-in source-of-truth rule
- assignment completion flow
- notification queue architecture
- CreditWallet refund destination
- no coin conversion/refund behavior

## 7. Race Conditions and Idempotency

### Scheduler Running Twice

Keep:

- in-process `running` guard
- Redis global lock `cron:assignment-sla`

Also require DB conditional updates.

### Two Backend Instances

Redis lock reduces duplicate work, but correctness should rely on Mongo conditions:

- task still active
- appointment still cancellable
- appointment still broad/unassigned

### Receptionist Assigning While Scheduler Expires

Whichever transaction commits first should win.

Scheduler transaction should require:

- task still active
- appointment still broad/unassigned
- appointment not terminal

Assignment transaction already requires:

- task still `ASSIGNED`
- task owned by receptionist
- appointment still assignable

If scheduler wins:

- assignment fails with task/appointment no longer assignable

If assignment wins:

- scheduler no-ops because task is `COMPLETED` or appointment has doctor/slot

### Refund Triggered Twice

Use existing credit refund idempotency:

- `refund-appointment-cancel-${appointmentId}`

Also rely on:

- appointment status transition guard
- deposit status transition guard
- payment `refundedAt`

### Notification / Email Sent Twice

Notifications already dedupe by idempotency key.

Email has no durable idempotency today. Reduce risk by emitting mail only after the state transition actually succeeds.

If stronger idempotency is required, add an outbox or mail log. That is likely outside current scope.

### Appointment Already Confirmed

Allow timeout cancellation only if:

- appointment is still broad/unassigned
- `assignmentStatus = AWAITING_ASSIGNMENT`
- no doctor/slot
- payment state is not `PENDING`

This supports DICH_VU broad appointments that were deposit-confirmed before assignment.

### Appointment Already Cancelled / Failed / Completed

No-op.

Do not refund again.

Do not emit new side effects.

### Active Assignment Tasks Becoming Orphaned

Timeout path should always transition active task to `EXPIRED` in the same transaction as appointment cancellation.

Manual patient/staff cancellation should continue to close open tasks as `CANCELLED`.

## 8. Implementation Steps

### Step 1: Refactor Cancellation Core

Extract shared internal cancellation logic from `AppointmentService.cancelAppointment(...)`.

Keep current public method behavior unchanged.

Internal options should cover:

- actor
- reason code
- user/permission enforcement
- patient cancellation window enforcement
- missing Visit allowance
- task terminal status
- side-effect template behavior

### Step 2: Refactor Broad DICH_VU To Sequential Payment -> Assignment

Before enabling assignment auto-cancel, fix the confirmed lifecycle gap for new broad `DICH_VU` records.

Update `AppointmentBookingService.bookBroadAppointment(...)`:

- for `BHYT` / `NOT_REQUIRED`, keep current immediate appointment + assignment task behavior
- for `DICH_VU`, create appointment + deposit payment only
- do not create assignment task while deposit is `PENDING`
- do not emit `appointment.assignment.created` while deposit is `PENDING`
- do not expose an actionable `assignmentTaskId` in the pending-payment response

Update `PaymentService.markDepositPaymentSuccess(...)`:

- detect broad/unassigned `DICH_VU` appointments
- set deposit paid fields
- keep `appointmentStatus = PENDING`
- keep or set `assignmentStatus = AWAITING_ASSIGNMENT`
- create exactly one active `AppointmentAssignmentTask`
- set `deadlineAt = depositPaidAt + ASSIGNMENT_DEADLINE_MINUTES`
- emit assignment-created / deposit-paid semantics
- suppress `appointment.booking.success` for broad payment success

Update `PaymentService.markDepositPaymentFailed(...)` and the pending-payment expiry path:

- broad unpaid `DICH_VU` becomes `appointmentStatus = FAILED`
- `depositStatus = FAILED`
- no refund
- no doctor slot release because no slot exists
- no assignment-timeout side effects
- close only legacy active tasks if they exist and payment failure/expiration is confirmed

Keep normal doctor-selected pending booking expiry unchanged except where shared helpers need naming or idempotency cleanup.

Optional explicit repair helper:

- if broad `DICH_VU` is `PAID`, has no doctor/slot, and has no active task, allow a conservative explicit path to create exactly one task
- do not run this as an automatic broad migration
- avoid reactivating existing `EXPIRED` / `CANCELLED` tasks in the main rollout

### Step 3: Add Assignment Timeout Reason / Actor Support

Add cancellation actor/reason constants or enums.

Recommended values:

- actor: `SYSTEM`
- reasonCode: `ASSIGNMENT_TIMEOUT`

Optionally persist audit fields on `Appointment`.

### Step 4: Add Scheduler Timeout Processing

Update `AssignmentSlaScheduler.expireOverdue(...)`.

Instead of only updating the task model, delegate to the timeout cancellation path.

Recommended query:

- active task status:
  - `PENDING`
  - optionally `ASSIGNED`
- `deadlineAt <= now - graceMs`
- batch limit remains

The timeout path must skip or route away DICH_VU appointments with `depositStatus = PENDING`.

For forward records, broad `DICH_VU` pending payment should not have an assignment task. If the scheduler sees one anyway, treat it as legacy data: skip, log with enough identifiers for operator follow-up, and do not mutate appointment/payment state.

Keep the Redis scheduler lock.

### Step 5: Add Notification / Email Template

Update notification DTO/template to support:

- `actor`
- `reasonCode`
- `assignmentTaskId`
- `deadlineAt`

Branch content for `ASSIGNMENT_TIMEOUT`.

Add/update mail handler/service method so patient email does not imply patient cancellation.

### Step 6: Emit Realtime Events

After successful commit:

- emit `appointment.assignment.expired`
- emit patient notification event
- emit patient mail event
- emit `socket.appointment.cancelled`

Include semantic metadata in payload.

### Step 7: Update API Contract / Docs

Update:

- `api-contract/api.md`
- likely `api-contract/README_BROAD_BOOKING_REDIS_FE_INTEGRATION.md`

Document:

- broad `DICH_VU` booking returns payment-pending semantics, not assignment-ready semantics
- broad `DICH_VU` assignment task is created only after deposit success
- broad `DICH_VU` deposit success keeps `appointmentStatus = PENDING`
- `appointment.booking.success` is emitted only after doctor/slot assignment for broad appointments
- assignment timeout auto-cancels appointment
- task becomes `EXPIRED`
- appointment becomes `CANCELLED`
- actor/reason code
- refund behavior
- notification payload fields
- FE queue refresh behavior
- unpaid broad DICH_VU behavior and legacy scheduler skip behavior

Follow submodule commit/push rule during implementation.

### Step 8: Add Tests

Update current scheduler tests and add focused tests for:

- timeout cancellation
- unpaid broad DICH_VU deposit expiration
- refund idempotency
- notification/email semantics
- assignment race behavior

## 9. Test Plan

Concrete tests:

- broad `DICH_VU` booking creates appointment and deposit payment but no assignment task.
- broad `DICH_VU` booking does not emit `appointment.assignment.created` before payment succeeds.
- broad `DICH_VU` booking response does not expose an actionable `assignmentTaskId` before payment succeeds.
- broad `DICH_VU` deposit success sets `depositStatus = PAID`, `depositPaidAmount`, and `depositPaidAt`.
- broad `DICH_VU` deposit success keeps `appointmentStatus = PENDING`.
- broad `DICH_VU` deposit success keeps/sets `assignmentStatus = AWAITING_ASSIGNMENT`.
- broad `DICH_VU` deposit success creates exactly one active assignment task.
- broad `DICH_VU` deposit success sets `deadlineAt = depositPaidAt + ASSIGNMENT_DEADLINE_MINUTES`.
- broad `DICH_VU` deposit success emits assignment-created / deposit-paid semantics but not `appointment.booking.success`.
- broad `DICH_VU` payment success does not create Visit until doctor/slot assignment.
- repeated broad `DICH_VU` payment-success callback does not create duplicate tasks.
- broad `BHYT` / `NOT_REQUIRED` booking still creates assignment task immediately.
- overdue `PENDING` broad assignment task auto-cancels appointment.
- overdue `ASSIGNED` but not completed task auto-cancels appointment if business allows.
- `CONFIRMED` broad unassigned appointment is auto-cancelled.
- `CONFIRMED` assigned appointment is not auto-cancelled.
- already `CANCELLED` appointment is ignored.
- already `FAILED` appointment is ignored.
- already `COMPLETED` appointment is ignored.
- broad appointment without Visit can still be system-cancelled.
- normal patient cancellation behavior remains unchanged.
- normal patient cancellation still enforces the 24-hour rule.
- DICH_VU paid deposit triggers refund once.
- DICH_VU refund uses verified `depositPaidAmount`, not intended amount fields.
- BHYT / `NOT_REQUIRED` deposit does not refund.
- pending deposit payment behavior follows sequential policy.
- broad DICH_VU with `depositStatus = PENDING` is not cancelled as `ASSIGNMENT_TIMEOUT`.
- forward broad DICH_VU unpaid TTL expiry sets appointment/deposit to `FAILED` and finds no assignment task to close.
- legacy broad DICH_VU unpaid TTL expiry may close an active assignment task only from the explicit payment-failure path.
- legacy broad DICH_VU `depositStatus = PENDING` active task is skipped by assignment scheduler and optionally logged.
- legacy broad DICH_VU `depositStatus = PAID` with active task avoids double-create.
- legacy broad DICH_VU `depositStatus = PAID` with no active task can be repaired only through explicit conservative path, if that path is implemented.
- broad DICH_VU unpaid TTL expiry does not refund.
- broad DICH_VU unpaid TTL expiry does not release a doctor slot because none exists.
- normal doctor-selected DICH_VU unpaid TTL expiry still releases Redis slot lock and TimeSlotLog.
- normal doctor-selected DICH_VU unpaid TTL expiry has no assignment task to close.
- scheduler is idempotent.
- concurrent scheduler runs do not double-process.
- concurrent receptionist assignment vs timeout has one winner.
- timeout does not release a doctor slot when no slot was assigned.
- timeout does not create a Visit.
- email uses assignment-timeout content, not patient-cancel content.
- notification uses assignment-timeout content, not patient-cancel content.
- realtime events refresh receptionist queue / notification center.
- notification idempotency prevents duplicate persisted timeout notifications.
- future manual/admin reconciliation script has dry-run coverage, if built outside this main task.

Suggested focused Jest command:

```powershell
npx jest --runInBand appointment-assignment-sla.scheduler.spec.ts appointment.service.cancel.spec.ts appointment-assignment-task.assign.spec.ts notification-audience.spec.ts assignment.notify.listenner.spec.ts
```

Then run:

```powershell
npm run build
```

## 10. Questions / Risks

Open questions before coding:

- Should overdue `ASSIGNED` tasks auto-cancel immediately after deadline + grace, or should accepted tasks first be reclaimed to `PENDING`?
- Should Mongo TTL deletion of `Payment` rows be supplemented by an explicit application-level payment expiry job?
- Should cancellation audit fields be persisted on `Appointment`, or is notification history enough?
- Should refund reason/idempotency remain `refund-appointment-cancel-${appointmentId}` for all cancellation types, or should timeout get a distinct business reason while preserving idempotency?
- Does FE need a distinct appointment realtime event for timeout, or is `APPOINTMENT_CANCELLED` with `reasonCode=ASSIGNMENT_TIMEOUT` sufficient?

Resolved decisions:

- broad `DICH_VU` creates assignment task only after deposit success
- broad `DICH_VU` `deadlineAt = depositPaidAt + ASSIGNMENT_DEADLINE_MINUTES`
- broad `DICH_VU` payment success keeps `appointmentStatus = PENDING`
- broad `DICH_VU` payment success does not emit `appointment.booking.success`
- broad `DICH_VU` payment failure/expiration uses `appointmentStatus = FAILED` and `depositStatus = FAILED`
- no heavy legacy migration/reconciliation in the main task
- scheduler does not infer payment outcomes for legacy pending-deposit records

## Recommended Implementation Choice

Implement Approach B:

- make broad `DICH_VU` payment and assignment sequential
- create/expose broad `DICH_VU` assignment tasks only after deposit success
- keep broad `DICH_VU` payment success at `appointmentStatus = PENDING`
- reserve `appointment.booking.success` and Visit creation for doctor/slot assignment
- extract a shared internal cancellation core
- keep public patient cancellation unchanged
- add a system timeout cancellation entry point
- add a separate unpaid broad DICH_VU expiration path before assignment timeout auto-cancel
- skip pending-deposit DICH_VU legacy tasks in assignment timeout processing
- update the SLA scheduler to call that entry point
- add semantic actor/reason metadata
- use timeout-specific notification and email content
- preserve existing refund and payment consistency guards

This keeps assignment timeout behavior correct without turning it into a disguised patient cancellation or a disguised payment-expiration/migration job.
