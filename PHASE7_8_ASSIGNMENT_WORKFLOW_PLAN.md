# Phase 7 & 8 — Broad Appointment / Unassigned-Doctor Workflow + Receptionist Routing & SLA

> **Status:** Planning only. No code, schema, or `api-contract` changes have been made.
> This document is a hand-off spec for implementation by Codex/Claude.
> **Scope:** Phase 7 (broad booking + assignment task model) and Phase 8 (routing, notification, SLA/cron).

---

## 1. Executive Summary

### Is the current code ready for unassigned-doctor appointments?
**No — not without changes, but the foundations are close.** Key blockers found:

| Blocker | Location | Why it blocks broad booking |
|---|---|---|
| `validateBookingRequest` requires `doctor.id` and `timeSlotId` | [appointment-booking.service.ts:777-810](src/appointment/appointment-booking.service.ts#L777-L810) | Hard `BadRequestException('Doctor is required')` / `'Time slot is required'`. |
| `timeSlot` is `required: true` on the schema | [appointment.schema.ts:81-82](src/appointment/schemas/appointment.schema.ts#L81-L82) | A broad appointment has no slot yet. |
| Slot lock + availability checks are keyed on `doctorId`+`timeSlotId` | [appointment-booking.service.ts:74-154](src/appointment/appointment-booking.service.ts#L74-L154) | Entire booking transaction assumes a concrete doctor/slot. |
| Unique partial index `{ doctorId, date, timeSlot }` | [appointment.schema.ts:110-118](src/appointment/schemas/appointment.schema.ts#L110-L118) | With all three null, multiple broad PENDING docs would collide on a single null-key (MongoDB indexes nulls). |
| `doctorId` is **not** `required` on schema | [appointment.schema.ts:90-91](src/appointment/schemas/appointment.schema.ts#L90-L91) | ✅ Good — schema already tolerates a missing doctor. |

**Good news:** `doctorId` is already optional at the schema level, reschedule already blocks correctly on missing doctor, and all the heavy infra (Redis locks, EventEmitter2, `@nestjs/schedule` cron with distributed locks, socket presence, notification pipeline) already exists and is reusable.

### Existing infrastructure that can be reused
- **EventEmitter2** event bus (`appointment.booking.success`, `notify.patient.appointment.*`, etc.).
- **Redis distributed locks** via `RedisService.acquireSlotLock` / `releaseSlotLock` (SET NX EX + Lua atomic delete) — [redis.service.ts:31-45](src/common/redis/redis.service.ts#L31-L45).
- **Redis presence** (`online_users` set + `user:{id}:devices`) — [presence.service.ts](src/socket/presence.service.ts).
- **`@nestjs/schedule`** already wired (`ScheduleModule.forRoot()`), with a proven cron + distributed-lock pattern — [coin-expiry-reminder.scheduler.ts](src/wallet/coin/coin-expiry-reminder/coin-expiry-reminder.scheduler.ts).
- **Notification pipeline**: `NotificationJobPublisher` → queue consumer → handler registry → DB write + socket emit; idempotency via `idempotencyKey` + `storeIfNotExists` (catches duplicate-key) — [notification.service.ts:98-110](src/notification/notification.service.ts#L98-L110).
- **Socket gateways** extend `BaseGateway`, email-keyed rooms, `/notification` namespace — [base.gateway.ts](src/socket/base/base.gateway.ts).
- **Receptionist module** already exists with `JwtAuthGuard + RoleGuard + @Roles(RECEPTIONIST)` pattern — [receptionist.controller.ts](src/receptionist/receptionist.controller.ts).

### What must be newly built
1. New collection **`AppointmentAssignmentTask`** (queue + audit + ownership + deadline).
2. **Broad-booking path** in booking service (skip doctor/slot, create task, emit event).
3. **Role-aware presence** (presence currently stores only `userId`, **no role**) so we can find online receptionists.
4. **Receptionist task APIs**: list / accept / release / assign-doctor-slot / history.
5. **Atomic accept** (single-winner) and **atomic assign** (slot conflict-safe, reuses existing booking transaction logic).
6. **SLA cron** (reminder near deadline, escalate/expire past deadline) modeled on coin-expiry scheduler.
7. New **assignment events** + listeners bridging to notification/socket.
8. `api-contract` docs + FE work.

---

## 2. Current Architecture Findings

### 2.1 Appointment booking
- **Controller:** `POST /appointment/book` → `AppointmentBookingService.bookAppointment` ([appointment.controller.ts:76-92](src/appointment/appointment.controller.ts#L76-L92)). `patientId`/`patientEmail` injected from JWT.
- **Service flow** ([appointment-booking.service.ts](src/appointment/appointment-booking.service.ts)):
  1. `normalizeVisitWorkflowDefaults` (defaults `visitType=OFFLINE`, `paymentCategory=DICH_VU`, sanitizes deposit).
  2. `validateBookingRequest` — **requires doctor + slot** (the broad-booking blocker).
  3. Acquire Redis slot lock `slot:{doctorId}:{timeSlotId}`.
  4. Resolve slot snapshot, `checkSlotAvailability`, compute `scheduledAt/startTime/endTime`.
  5. `createAppointmentWithTransaction` (mongo session): re-check availability, create appointment (`PENDING`), `markTimeSlotBooked`.
  6. Branch: `DICH_VU` → create deposit payment, emit `appointment.booking.pending`. Otherwise `confirmBooking` → emit `appointment.booking.success`.
- **Status transitions:** `PENDING → CONFIRMED → COMPLETED`; `PENDING → FAILED` (deposit fail / TTL expiry via `expirePendingBookings` interval); `→ CANCELLED`. Enum at [Appointment-status.enum.ts](src/appointment/enums/Appointment-status.enum.ts).
- **Visit creation listener:** `BookingListener.handleAppointmentBookingSuccess` listens to `appointment.booking.success`, idempotently creates a `Visit` (status `CREATED`) — [booking.listenner.ts:26-42](src/appointment/listenners/booking.listenner.ts#L26-L42). **Downstream cancel/reschedule require a visit to exist.**
- **Schema** ([appointment.schema.ts](src/appointment/schemas/appointment.schema.ts)): `scheduledAt`, `bookingDate` `required: true`; `timeSlot` `required: true`; `patientId` `required: true`; `doctorId` **optional**; deposit lifecycle fields; partial-unique index on `{ doctorId, date, timeSlot }` for active statuses.
- **TimeSlot model:** `TimeSlotLog` with `status: 'available' | 'booked'`; toggled in transactions.

**Can `POST /appointment/book` create an appointment without a doctor?** No — `validateBookingRequest` throws first. Even if bypassed, `timeSlot: required` and the lock/availability logic would fail.

### 2.2 Reschedule separation (must remain)
`AppointmentRescheduleService.rescheduleAppointment` **already** guards missing doctor and returns the canonical reason:

```ts
if (!appointment.doctorId) {
  this.throwBlocked('APPOINTMENT_DOCTOR_NOT_ASSIGNED',
    'Appointment has no assigned doctor; reschedule is not allowed');
}
```
[appointment-reschedule.service.ts:49-54](src/appointment/appointment-reschedule.service.ts#L49-L54).

✅ **Decision:** Keep this exactly as-is. Broad-booking assignment must **not** be routed through reschedule. The assignment endpoint is a *separate* "assign doctor/slot to an unassigned appointment" operation, not a reschedule. This guard at lines 49–54 is the exact place to preserve `APPOINTMENT_DOCTOR_NOT_ASSIGNED`.

### 2.3 Redis presence
- `PresenceService` ([presence.service.ts](src/socket/presence.service.ts)) stores:
  - `online_users` — Set of `userId` (== `accountId`/`sub` from JWT).
  - `user:{userId}:devices` — Set of socketIds, with TTL (`SOCKET_PRESENCE_TTL_SECONDS`, default 60s), heartbeat-refreshed.
- Identity comes from `socket.data.userId = payload.sub || payload.accountId || payload.id` ([socket-auth.middleware.ts:29](src/socket/middleware/socket-auth.middleware.ts#L29)). `authUser` (full JWT payload, includes `role` + `email`) is also attached.
- **Gap:** Presence stores **no role** and **no email index**. We can check "is user X online" but **cannot list online receptionists** today.

**What's needed:** add a role-tagged presence index, e.g. on connect `SADD online_role:RECEPTIONIST {userId}` and store `HSET presence:user:{userId} role <role> email <email>` so the cron/router can resolve online receptionists → emit targets. Must be cleaned up on disconnect / TTL expiry (mirror the existing device-set teardown).

### 2.4 Notification / socket architecture
- **Publish:** `NotificationJobPublisher.publish({ type, recipientEmail, data, idempotencyKey })`.
- **Consume → handle:** handler registry keyed by `NotificationType` ([notification.service.ts:31-37](src/notification/notification.service.ts#L31-L37)); handlers persist `Notification` (with `receiverEmail`, `isBroadcast`, `idempotencyKey`) and emit socket events.
- **Socket emit:** `BaseGateway.emitToRoom(email, event, data)` (rooms are normalized email strings). There is a `/notification` namespace. A Redis pub/sub bridge exists (`NotificationRedisListener`).
- **No role-based room** exists today. Two viable fan-out strategies (see §5/§7):
  - **(A) Role room:** sockets join a `role:RECEPTIONIST` room on connect; emit once to the room. Simpler, real-time only.
  - **(B) Presence fan-out:** resolve online receptionist emails from Redis, loop `emitToRoom(email, …)`. Reuses existing email rooms; needed anyway for cron re-notify.
  - **Recommended:** do **both** — join a `role:RECEPTIONIST` room for instant fan-out, and persist a per-receptionist `Notification` (broadcast to role) so offline receptionists see it on next load.

### 2.5 Cron / scheduler
- `ScheduleModule.forRoot()` in [app.module.ts:114](src/app.module.ts#L114).
- Canonical pattern ([coin-expiry-reminder.scheduler.ts](src/wallet/coin/coin-expiry-reminder/coin-expiry-reminder.scheduler.ts)): `@Cron(CronExpression.EVERY_HOUR)` + Redis lock `acquireSlotLock('cron:...', value, 300)` to prevent duplicate runs across instances, `finally releaseSlotLock`.
- **Plan:** add `AssignmentSlaScheduler` following the same pattern (likely `EVERY_MINUTE` or `EVERY_5_MINUTES` given SLA granularity).

---

## 3. Proposed Workflow

```
Patient (broad booking)                Receptionist(s)                System
─────────────────────────             ─────────────────             ──────────────────────
POST /appointment/book                                              
  (no doctor, no slot,                                              
   broadBooking=true)        ───────► create Appointment            
                                       (PENDING, doctorId=null,      
                                        timeSlot=null,               
                                        assignmentStatus=AWAITING)   
                                       create AppointmentAssignment  
                                        Task (PENDING, deadlineAt)   
                                       emit appointment.assignment.created
                                              │
                                              ▼
                            notify online receptionists ◄── resolve online_role:RECEPTIONIST
                            (socket role room + DB notification)
                                              │
   Receptionist opens queue  ◄── GET /appointment/assignment-tasks?status=PENDING
                                              │
   Receptionist accepts      ──► POST /assignment-tasks/:id/accept
                                  atomic findOneAndUpdate
                                  (status PENDING→ASSIGNED, set acceptedBy)
                                  emit appointment.assignment.accepted
                                              │
   Receptionist assigns       ──► POST /assignment-tasks/:id/assign
   doctor + slot                  { doctorId, timeSlotId, appointmentDate }
                                  ↳ reuse booking slot-lock + tx:
                                     - validate slot belongs to doctor (Shift)
                                     - slot availability + conflict check
                                     - set appointment.doctorId/timeSlot/scheduledAt
                                     - mark slot booked
                                     - task status → COMPLETED
                                     - emit appointment.booking.success  ← creates Visit
                                     - emit appointment.assignment.completed
                                              │
                                              ▼
                            Normal appointment / visit / billing flow continues
```

**Deposit interaction:** see Product Decision D2. Recommended default: for `DICH_VU` broad bookings, take the deposit **up front at broad-booking time** (same as normal booking) so the queue contains only paying patients; the appointment stays `PENDING` with `depositStatus=PENDING/PAID` and the assignment task tracks routing independently.

---

## 4. Proposed Data Model

### 4.1 `AppointmentAssignmentTask` (new collection)

```ts
// src/appointment/schemas/appointment-assignment-task.schema.ts
export enum AssignmentTaskStatus {
  PENDING   = 'PENDING',    // created, awaiting a receptionist to accept
  ASSIGNED  = 'ASSIGNED',   // accepted/locked by one receptionist, doctor/slot not yet set
  COMPLETED = 'COMPLETED',  // doctor + slot assigned, appointment now normal
  EXPIRED   = 'EXPIRED',    // deadline passed with no completion
  ESCALATED = 'ESCALATED',  // deadline passed, escalated to admin/group
  CANCELLED = 'CANCELLED',  // appointment cancelled / booking failed while task open
}

@Schema({ timestamps: true })
export class AppointmentAssignmentTask {
  @Prop({ type: ObjectId, ref: 'Appointment', required: true })
  appointmentId: ObjectId;

  @Prop({ type: String, enum: AssignmentTaskStatus, default: AssignmentTaskStatus.PENDING })
  status: AssignmentTaskStatus;

  @Prop({ type: ObjectId, ref: 'Receptionist' })       // optional pre-routing target
  assignedReceptionistId?: ObjectId;

  @Prop({ type: ObjectId, ref: 'Receptionist' })       // who actually accepted (single winner)
  acceptedByReceptionistId?: ObjectId;

  @Prop({ type: Number, required: true }) deadlineAt: number;   // epoch ms
  @Prop({ type: Number }) acceptedAt?: number;
  @Prop({ type: Number }) completedAt?: number;
  @Prop({ type: Number }) lastNotifiedAt?: number;
  @Prop({ type: Number, default: 0 }) reminderCount: number;

  @Prop({ type: String }) specialty?: string;          // chuyenKhoa id/name for routing
  @Prop({ type: String, default: 'NORMAL' }) priority?: string;
  @Prop({ type: String }) reasonForAppointment?: string;
  @Prop({ type: String }) patientEmail?: string;

  // audit trail of state changes
  @Prop({ type: [Object], default: [] })
  history: { at: number; from: string; to: string; by?: string; note?: string }[];
}
```

### 4.2 Indexes & unique constraints
```ts
// One ACTIVE task per appointment (partial unique on open states):
Schema.index(
  { appointmentId: 1 },
  { unique: true,
    partialFilterExpression: { status: { $in: ['PENDING', 'ASSIGNED'] } } },
);
// Cron scans:
Schema.index({ status: 1, deadlineAt: 1 });
// Receptionist queue listing / filtering:
Schema.index({ status: 1, specialty: 1, createdAt: -1 });
Schema.index({ acceptedByReceptionistId: 1, status: 1 });
```

### 4.3 Appointment schema changes
- Make `timeSlot` **optional** (drop `required: true`) — broad appointment has no slot yet.
- Add `assignmentStatus?: 'AWAITING_ASSIGNMENT' | 'ASSIGNED' | 'NONE'` (or derive from task) to make broad appointments queryable without joining the task collection. Recommended: explicit field for indexability.
- **Unique index fix:** the existing partial-unique `{ doctorId, date, timeSlot }` must additionally require those fields to exist, otherwise many null-keyed broad bookings collide. Change `partialFilterExpression` to also require `doctorId` and `timeSlot` to exist:
  ```ts
  partialFilterExpression: {
    appointmentStatus: { $in: ['PENDING','CONFIRMED'] },
    doctorId: { $exists: true },
    timeSlot: { $exists: true },
  }
  ```
  ⚠️ This index change is the single riskiest migration item — see §10 / §9.

### 4.4 Lifecycle states (task)
```
PENDING ──accept──► ASSIGNED ──assign(doctor,slot)──► COMPLETED
   │                   │
   │ deadline          │ release / receptionist disconnect (optional re-open)
   ▼                   ▼
EXPIRED / ESCALATED   back to PENDING (if release allowed)

PENDING/ASSIGNED ──appointment cancelled / booking failed──► CANCELLED
```
**Idempotency rules:**
- Task creation: guarded by partial-unique on `appointmentId` (active states). Creating a second active task throws 11000 → treat as "already exists".
- Accept: single atomic `findOneAndUpdate({ _id, status: PENDING }, { $set:{status: ASSIGNED, acceptedBy…}})`; null result = lost the race.
- Complete: `findOneAndUpdate({ _id, status: ASSIGNED, acceptedBy: me })`.
- Cron transitions: `updateMany({ status, deadlineAt: { $lt: now } }, …)` are naturally idempotent.

---

## 5. Proposed Events

All via EventEmitter2 (consistent with existing `appointment.*` events). Listeners live in `src/appointment/listenners/` and/or `src/notification/listenners/`.

| Event | Emitted when | Payload (shape) | Listener(s) |
|---|---|---|---|
| `appointment.assignment.created` | Broad appointment + task created | `{ taskId, appointmentId, patientEmail, specialty, priority, deadlineAt, reasonForAppointment }` | Notify online receptionists (socket role room + DB notification); set `lastNotifiedAt`. |
| `appointment.assignment.accepted` | Receptionist wins accept | `{ taskId, appointmentId, acceptedByReceptionistId, acceptedAt }` | Notify other receptionists to remove from their queue; optional patient "being processed" note. |
| `appointment.assignment.completed` | Doctor+slot assigned | `{ taskId, appointmentId, doctorId, timeSlotId, scheduledAt }` | Patient notification ("doctor assigned"); triggers normal `appointment.booking.success` (Visit creation) separately. |
| `appointment.assignment.reminder` | Cron, task near deadline | `{ taskId, appointmentId, deadlineAt, reminderCount }` | Re-notify online receptionists. |
| `appointment.assignment.expired` | Cron, deadline passed, no handler | `{ taskId, appointmentId, deadlineAt }` | Notify admin/receptionist group; mark appointment for manual review. |
| `appointment.assignment.escalated` | Cron, escalate policy fires | `{ taskId, appointmentId, escalatedTo }` | Notify admins. |
| `appointment.assignment.cancelled` | Appointment cancelled/failed while task open | `{ taskId, appointmentId, reason }` | Remove from queues. |

**Notification fan-out helper (new):** a `ReceptionistNotifier` that (1) emits to socket room `role:RECEPTIONIST`, and (2) for each online receptionist email (resolved from Redis) and/or as a role-broadcast `Notification`, persists a DB notification with `idempotencyKey = assignment-<event>:<taskId>:<reminderCount>`.

New `NotificationType` values: `ASSIGNMENT_TASK_CREATED`, `ASSIGNMENT_TASK_REMINDER`, `ASSIGNMENT_TASK_ESCALATED`, plus a patient-facing `APPOINTMENT_DOCTOR_ASSIGNED`.

---

## 6. Proposed APIs

> All under existing guard pattern. Receptionist endpoints: `@UseGuards(JwtAuthGuard, RoleGuard) @Roles(RECEPTIONIST)` (admin may also be allowed for history/oversight). Errors follow the existing blocked-reason envelope: `{ code: ERROR, message, data: { blockedReason } }`.

### 6.1 Patient — broad booking (extend existing endpoint)

| Field | Value |
|---|---|
| Endpoint | `POST /appointment/book` (extended) — alt: `POST /appointment/book-broad` |
| Auth | `JwtAuthGuard`, role `PATIENT` |
| Purpose | Create appointment without doctor/slot; spawn assignment task |
| Request | `{ broadBooking: true, specialty?, reasonForAppointment, serviceType, paymentCategory, depositAmount?, appointmentDate?, hospitalName?, visitType? }` (no `doctor`, no `timeSlotId`) |
| Response | `{ code: PENDING, data: { appointmentId, assignmentTaskId, assignmentStatus: 'AWAITING_ASSIGNMENT', depositStatus?, paymentUrl? } }` |
| Errors | `BROAD_BOOKING_DISABLED`, `SPECIALTY_REQUIRED` (if policy), `DEPOSIT_REQUIRED`, validation 400 |

**Recommendation:** extend the existing endpoint with a `broadBooking` flag and branch *before* `validateBookingRequest` into a new `bookBroadAppointment` path, keeping normal booking untouched.

### 6.2 Receptionist — list pending tasks

| Field | Value |
|---|---|
| Endpoint | `GET /appointment/assignment-tasks?status=&specialty=&page=&limit=` |
| Auth | `RECEPTIONIST` (and `ADMIN`) |
| Purpose | Queue view of tasks |
| Request | query: `status` (default `PENDING`), `specialty`, pagination |
| Response | `{ data: [{ taskId, appointmentId, patient, specialty, priority, deadlineAt, status, acceptedByReceptionistId }], pagination }` |
| Errors | 403 wrong role |

### 6.3 Receptionist — accept task

| Field | Value |
|---|---|
| Endpoint | `POST /appointment/assignment-tasks/:id/accept` |
| Auth | `RECEPTIONIST` |
| Purpose | Atomically lock task to caller |
| Request | `{}` |
| Response | `{ code: SUCCESS, data: { taskId, status: 'ASSIGNED', acceptedByReceptionistId } }` |
| Errors | `TASK_ALREADY_ACCEPTED` (lost race), `TASK_NOT_PENDING`, `TASK_NOT_FOUND`, `TASK_EXPIRED` |

### 6.4 Receptionist — assign doctor + slot

| Field | Value |
|---|---|
| Endpoint | `POST /appointment/assignment-tasks/:id/assign` |
| Auth | `RECEPTIONIST` (must be the acceptor) |
| Purpose | Set doctor/slot, complete task, start normal flow |
| Request | `{ doctorId, timeSlotId, appointmentDate }` |
| Response | `{ code: SUCCESS, data: { appointmentId, doctorId, timeSlotId, scheduledAt, status: 'CONFIRMED'|'PENDING' } }` |
| Errors | `TASK_NOT_OWNED`, `TASK_NOT_ASSIGNED`, `SLOT_UNAVAILABLE`, `SLOT_DOCTOR_MISMATCH`, `SLOT_ALREADY_BOOKED`, `INVALID_SCHEDULE`, `APPOINTMENT_NOT_FOUND` |

### 6.5 Receptionist — release / unaccept task

| Field | Value |
|---|---|
| Endpoint | `POST /appointment/assignment-tasks/:id/release` |
| Auth | `RECEPTIONIST` (acceptor) |
| Purpose | Return task to `PENDING` |
| Request | `{ reason? }` |
| Response | `{ code: SUCCESS, data: { taskId, status: 'PENDING' } }` |
| Errors | `TASK_NOT_OWNED`, `TASK_NOT_ASSIGNED` |

### 6.6 Admin/Receptionist — task history / detail

| Field | Value |
|---|---|
| Endpoint | `GET /appointment/assignment-tasks/:id` and `GET /appointment/assignment-tasks/history?...` |
| Auth | `RECEPTIONIST`, `ADMIN` |
| Purpose | Audit view incl. `history[]` |
| Response | full task doc + appointment summary |
| Errors | `TASK_NOT_FOUND`, 403 |

---

## 7. SLA / Cron Plan

**Scheduler:** `AssignmentSlaScheduler` (new), `@Cron(CronExpression.EVERY_MINUTE)` wrapped in `acquireSlotLock('cron:assignment-sla', value, 50)` to prevent duplicate runs (mirror coin scheduler).

| Rule | Condition | Action |
|---|---|---|
| **Reminder** | `status=PENDING` AND `now >= deadlineAt - REMINDER_WINDOW_MS` AND `(lastNotifiedAt is null OR now - lastNotifiedAt >= REMINDER_INTERVAL_MS)` | Emit `appointment.assignment.reminder`, `$inc reminderCount`, `$set lastNotifiedAt=now`. |
| **Escalation** | `status IN (PENDING, ASSIGNED)` AND `now >= deadlineAt` AND escalation policy enabled | Set `status=ESCALATED`, emit `appointment.assignment.escalated` → notify admins/group. |
| **Expiry** | `status=PENDING` AND `now >= deadlineAt + GRACE_MS` (and not escalation route) | Set `status=EXPIRED`, emit `appointment.assignment.expired`. |
| **Stale-accept reclaim** | `status=ASSIGNED` AND `now - acceptedAt >= ACCEPT_TTL_MS` AND not completed | Return to `PENDING` (acceptor abandoned) — see §9. |

**Duplicate prevention:**
- Cron-level: Redis distributed lock per run.
- Notification-level: `idempotencyKey = assignment-reminder:<taskId>:<reminderCount>` → `storeIfNotExists` dedupes.
- State transitions use conditional `findOneAndUpdate`/`updateMany` filtered on current status, so a concurrent accept and a concurrent escalate cannot both win (whichever matches the status filter first wins; the other no-ops).

**Config (new env vars):**
```
ASSIGNMENT_DEADLINE_MINUTES=30
ASSIGNMENT_REMINDER_WINDOW_MINUTES=10
ASSIGNMENT_REMINDER_INTERVAL_MINUTES=5
ASSIGNMENT_GRACE_MINUTES=5
ASSIGNMENT_ACCEPT_TTL_MINUTES=10
ASSIGNMENT_ESCALATION_TARGET=ADMIN   # ADMIN | RECEPTIONIST_GROUP
BROAD_BOOKING_ENABLED=true
BROAD_BOOKING_DEPOSIT_TIMING=UPFRONT # UPFRONT | AFTER_ASSIGNMENT
```

---

## 8. Race Condition Handling

| Scenario | Handling |
|---|---|
| **Two receptionists accept same task** | Atomic `findOneAndUpdate({ _id, status: PENDING }, { $set: { status: ASSIGNED, acceptedByReceptionistId, acceptedAt } }, { new: true })`. Null result ⇒ `TASK_ALREADY_ACCEPTED`. Single DB-level winner. |
| **Acceptor disconnects / abandons** | `acceptedAt` + cron "stale-accept reclaim" returns task to `PENDING` after `ACCEPT_TTL_MS`. Optional: tie to presence (if acceptor offline > threshold, reclaim sooner). |
| **Assign: doctor/slot already taken** | Reuse the booking transaction's conflict guard: Redis slot lock `slot:{doctorId}:{timeSlotId}` + in-tx `checkSlotAvailability` + partial-unique index → returns `SLOT_UNAVAILABLE`/`SLOT_ALREADY_BOOKED`. Slot must belong to doctor (Shift check, like reschedule line 167-181). |
| **Patient cancels while receptionist assigning** | Cancel sets appointment `CANCELLED` (in tx). Assign uses conditional update `{ appointmentStatus: { $in:[PENDING] }, doctorId: null }`; if cancel won, assign matches nothing → `APPOINTMENT_NOT_ASSIGNABLE`. Cancel also emits `appointment.assignment.cancelled` to close the task. |
| **Cron escalates while receptionist accepts** | Both are conditional updates on `status`. Accept filters `status: PENDING`; escalate filters `status: PENDING` too — only one succeeds. If accept wins, escalate's `updateMany` won't match. Recommend cron only escalates `PENDING` (not freshly `ASSIGNED`) within the same tick. |
| **Server restart** | Tasks live in MongoDB with `deadlineAt`; cron re-scans on next tick. No reliance on in-memory timers. (Note: the existing `expirePendingBookings` uses `setInterval` — acceptable, but assignment SLA should use `@Cron` for restart safety.) |
| **Redis loses online state** | Presence is transient by design. Task in DB survives. On Redis flush, online set rebuilds from reconnect/heartbeat; cron reminder re-notifies whoever is online next tick; DB notification ensures offline receptionists still see it. |
| **Duplicate task creation** | Partial-unique index on `appointmentId` for active states; second create throws 11000 → caught and treated as "task exists, return existing". |
| **Duplicate notifications** | `idempotencyKey` + `storeIfNotExists` (existing dup-key pattern). |

---

## 9. Product Decisions Required (do not guess)

| # | Decision | Options | Recommended default |
|---|---|---|---|
| **D1** | Is broad booking `DICH_VU`-only or also `BHYT`? | DICH_VU only / both | **Both**, but only DICH_VU requires deposit (mirrors `normalizeVisitWorkflowDefaults`). |
| **D2** | Deposit before or after receptionist assignment? | Upfront at booking / after doctor assigned | **Upfront** (`BROAD_BOOKING_DEPOSIT_TIMING=UPFRONT`) — queue holds only paying patients; simpler refund story reuses existing cancel-refund. |
| **D3** | Is a slot reserved before doctor assignment? | No reservation / soft hold | **No reservation** — broad appointment has no slot until assign; slot is locked only during the assign transaction. |
| **D4** | How does specialty affect routing? | Free-for-all / specialty-filtered queue / pre-assigned receptionist | **Specialty stored on task; queue filterable by specialty; any receptionist may accept** (no hard routing in v1). |
| **D5** | Assignment deadline duration | 15 / 30 / 60 min | **30 min** (`ASSIGNMENT_DEADLINE_MINUTES=30`). |
| **D6** | What happens when no receptionist is online? | Hold until cron / escalate to admin immediately / email fallback | **Hold + DB notification + cron reminder; escalate to admin at deadline.** |
| **D7** | Escalation target | Admin / receptionist group / both | **Admin** (`ASSIGNMENT_ESCALATION_TARGET=ADMIN`). |
| **D8** | Does patient choose specialty, reason, or both? | specialty only / reason only / both | **Both optional, at least one required** (need something to route on). |
| **D9** | On EXPIRED, what happens to the appointment & deposit? | Auto-cancel + refund / keep for manual handling | **Keep PENDING for manual handling; admin can cancel→refund via existing flow.** Avoids auto-refund surprises. |
| **D10** | Can a receptionist release an accepted task back to the pool? | Yes / no | **Yes** (`/release`) — supports shift handover. |

---

## 10. Recommended Implementation Phases (small, safe chunks)

> Each chunk is independently shippable and behind `BROAD_BOOKING_ENABLED` where possible.

1. **BE-1 Schema & enums (no behavior change):**
   - Add `AppointmentAssignmentTask` schema + indexes + status enum.
   - Make `Appointment.timeSlot` optional; add `assignmentStatus`.
   - **Fix partial-unique index** to require `doctorId`/`timeSlot` existence (⚠️ requires index drop+rebuild on prod — coordinate, see Test/Migration notes).
2. **BE-2 Broad-booking service path:** new `bookBroadAppointment` + `broadBooking` flag branch in controller/service; create appointment (no doctor/slot) + task; emit `appointment.assignment.created`. Reuse deposit creation if D2=UPFRONT. Do **not** emit `appointment.booking.success` yet (no visit until assigned).
3. **BE-3 Receptionist task APIs:** list / accept (atomic) / release / assign / history + detail. `assign` reuses booking slot-lock + transaction + Shift ownership check; on success emit `appointment.booking.success` (Visit) + `appointment.assignment.completed`.
4. **BE-4 Role-aware presence:** extend `PresenceService` with `online_role:<ROLE>` set + `presence:user:{id}` hash (role/email); update connect/disconnect/TTL teardown; add `getOnlineReceptionists()`.
5. **BE-5 Notification/socket:** `ReceptionistNotifier` (role room `role:RECEPTIONIST` + DB notifications); new `NotificationType`s + handlers; assignment event listeners.
6. **BE-6 SLA cron:** `AssignmentSlaScheduler` (reminder / escalate / expire / stale-accept reclaim) with Redis lock; env config.
7. **api-contract:** add endpoints + payloads + events + error codes; **commit & push submodule first** (per CLAUDE.md), then bump pointer.
8. **FE integration:** patient broad-booking UI, receptionist queue + accept/assign, real-time + polling fallback.
9. **Tests:** unit/integration/e2e (see §11) added alongside each BE chunk.

---

## 11. Test Plan

### Unit
- `validateBroadBookingRequest`: rejects when neither specialty nor reason present (D8); allows missing doctor/slot.
- Task accept: single-winner under simulated concurrent calls (mock `findOneAndUpdate` returning null for loser).
- Deadline calc from config; reminder window logic.
- Presence: `getOnlineReceptionists` returns only RECEPTIONIST userIds; disconnect cleans role set.
- Reschedule still throws `APPOINTMENT_DOCTOR_NOT_ASSIGNED` for null-doctor appointment (regression guard).

### Integration (mongo + redis)
- Broad booking creates appointment(no doctor/slot) + exactly one active task; duplicate create → 11000 handled.
- Accept → assign happy path: appointment gains doctor/slot, slot marked booked, Visit created via `appointment.booking.success`, task `COMPLETED`.
- Assign slot conflict → `SLOT_UNAVAILABLE`; Shift mismatch → `SLOT_DOCTOR_MISMATCH`.
- Cancel-while-pending closes task (`CANCELLED`) and assign afterwards fails `APPOINTMENT_NOT_ASSIGNABLE`.
- Cron: PENDING past deadline → ESCALATED/EXPIRED; near deadline → reminder with idempotent notification (no dup on second tick).
- Stale ASSIGNED reclaimed to PENDING after TTL.

### E2E
- Patient broad books → receptionist socket receives `assignment.created` → accepts → assigns → patient receives `APPOINTMENT_DOCTOR_ASSIGNED` → appointment proceeds to visit/billing.
- Two receptionists race accept → exactly one succeeds, other gets `TASK_ALREADY_ACCEPTED`.
- No receptionist online → DB notification persisted, cron escalates at deadline.

### Migration / index test
- Verify the rewritten partial-unique index allows multiple null-doctor/null-slot PENDING appointments **and** still blocks duplicate concrete `{doctorId,date,timeSlot}`. Test on a copy before prod (drop old index → create new).

---

## 12. api-contract & FE Impact

### api-contract (submodule — commit & push first, then bump pointer)
- New endpoints: broad booking extension, `assignment-tasks` list/accept/assign/release/detail/history.
- New socket events: `appointment.assignment.created|accepted|completed|reminder|expired|escalated|cancelled`.
- New error/blocked-reason codes: `TASK_ALREADY_ACCEPTED`, `TASK_NOT_PENDING`, `TASK_NOT_OWNED`, `TASK_NOT_ASSIGNED`, `TASK_EXPIRED`, `APPOINTMENT_NOT_ASSIGNABLE`, `BROAD_BOOKING_DISABLED`, `SPECIALTY_REQUIRED`, plus reused `SLOT_UNAVAILABLE`, `SLOT_DOCTOR_MISMATCH`, `APPOINTMENT_DOCTOR_NOT_ASSIGNED` (reschedule, unchanged).
- New notification types: `ASSIGNMENT_TASK_CREATED`, `ASSIGNMENT_TASK_REMINDER`, `ASSIGNMENT_TASK_ESCALATED`, `APPOINTMENT_DOCTOR_ASSIGNED`.
- Document `assignmentStatus` field on Appointment and the `AppointmentAssignmentTask` shape.

### FE
- **Patient:** "Book without choosing a doctor" UI (specialty/reason, deposit step if DICH_VU upfront); appointment detail shows `AWAITING_ASSIGNMENT` and updates to assigned via socket.
- **Receptionist:** task queue page (filter by specialty/status); accept button (handle lost-race error); assign-doctor-slot form reusing existing doctor/slot pickers; release button.
- **Real-time:** subscribe to `/notification` namespace, join `role:RECEPTIONIST` room, handle `assignment.*` events to update queue live; show "claimed by other" when `accepted`.
- **Fallback:** poll `GET /assignment-tasks?status=PENDING` on interval / on focus when socket disconnected (presence TTL is 60s).

---

## Appendix: Key file references
- Booking: [appointment-booking.service.ts](src/appointment/appointment-booking.service.ts), [appointment.controller.ts](src/appointment/appointment.controller.ts)
- Reschedule guard: [appointment-reschedule.service.ts:49-54](src/appointment/appointment-reschedule.service.ts#L49-L54)
- Schema: [appointment.schema.ts](src/appointment/schemas/appointment.schema.ts)
- Visit creation: [booking.listenner.ts](src/appointment/listenners/booking.listenner.ts)
- Presence: [presence.service.ts](src/socket/presence.service.ts), [socket-auth.middleware.ts](src/socket/middleware/socket-auth.middleware.ts)
- Notification: [notification.service.ts](src/notification/notification.service.ts), [base.gateway.ts](src/socket/base/base.gateway.ts), [appointment.notify.listenner.ts](src/notification/listenners/appointment.notify.listenner.ts)
- Cron pattern: [coin-expiry-reminder.scheduler.ts](src/wallet/coin/coin-expiry-reminder/coin-expiry-reminder.scheduler.ts)
- Redis: [redis.service.ts](src/common/redis/redis.service.ts)
