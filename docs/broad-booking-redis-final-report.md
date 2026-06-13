# Broad Booking (Doctor-less Appointment) — Redis Integration: Final Report

> **Branch:** `task/edge-case-not-select-doctor` · **Date:** 2026-06-06
> **Project type:** Learning / thesis demonstration (NOT production).
> **Companion docs:** [broad-booking-redis-notification-scope.md](broad-booking-redis-notification-scope.md) (baseline + per-phase log) · [../RECEPTIONIST_PRESENCE_NOTIFICATION_ANALYSIS.md](../RECEPTIONIST_PRESENCE_NOTIFICATION_ANALYSIS.md) (deep analysis).

This report integrates Phases 1–7 into one defense-ready document: what the broad-booking
flow does, how Redis is used (presence, Pub/Sub, atomic locking), the runtime flows, the
fixes completed, the scoped-out limitations, the test results, and short thesis-defense notes.

---

## 1. Overview — the doctor-less (broad) booking flow

A patient can book an appointment **without choosing a doctor**. The system parks the
appointment for a receptionist to assign a doctor + time slot.

```
Patient books WITHOUT a doctor (broadBooking=true)
  → Appointment created: PENDING, doctorId=null, timeSlot=null,
                         assignmentStatus = AWAITING_ASSIGNMENT
  → AppointmentAssignmentTask created: PENDING (with deadlineAt)
  → Backend checks Redis online_role:RECEPTIONIST
        → online receptionists receive a realtime notification (NOTIFICATION_RECEIVED)
        → every receptionist also gets a persisted DB notification (offline-safe)
  → A receptionist opens the task queue, ACCEPTS a task (Redis task lock),
    then ASSIGNS a doctor + slot (Redis slot lock + DB transaction)
        → appointment becomes doctor-assigned; patient is notified
  → If realtime is missed / nobody is online: the task stays PENDING in the DB queue
    and is picked up via polling  (GET /appointment/assignment-tasks?status=PENDING)
  → SLA scheduler: reminds near the deadline, and marks EXPIRED past deadline+grace,
    each now raising a receptionist notification.
```

**Design principle (kept throughout):** the `AppointmentAssignmentTask` table in MongoDB is the
**source of truth**; Redis online presence is a **realtime-target optimization**; the polling
queue is the **fallback**. Correctness never depends on a notification being delivered.

---

## 2. Redis usage (thesis-relevant)

### 2.1 Redis presence
- Tracks **online users** per device: `user:{userId}:devices` (SET of socketIds, TTL `SOCKET_PRESENCE_TTL_SECONDS`, default 60s) + an `online_users` index.
- Tracks **role-aware online receptionists**: `online_role:RECEPTIONIST` (SET of userIds) + `presence:user:{userId}` (hash `{userId,email,role}`, TTL-refreshed). Resolved via `getOnlineReceptionists()`.
- **Multi-device:** a user stays online while ≥1 socket remains; the role index is deduped by userId (SET) so a multi-device receptionist appears once.
- **Heartbeat refresh/recovery:** each heartbeat refreshes the device-set TTL; if the device set expired while the socket is still alive, it is recreated from the live socketId and the online/role indexes are restored. The device set is the authoritative liveness signal, so stale role members are pruned lazily on read.
- Code: [../src/socket/presence.service.ts](../src/socket/presence.service.ts), driven by [../src/socket/base/base.gateway.ts](../src/socket/base/base.gateway.ts).

### 2.2 Redis Pub/Sub
- Used as the **realtime notification bridge across backend instances**. Socket.IO has **no** Redis adapter, so a notification handler publishes to the `NOTIFICATION_REDIS_CHANNEL`; **every** instance subscribes and re-emits to the sockets connected locally to it.
- This is what makes realtime delivery **horizontally scalable**: instance A can trigger a notification that reaches a receptionist connected to instance B.
- Code: handlers `redisService.publish(NOTIFICATION_REDIS_CHANNEL, …)` → [../src/socket/listenners/notification-redis.listenner.ts](../src/socket/listenners/notification-redis.listenner.ts).

### 2.3 Redis atomic lock
- Prevents **two receptionists from handling the same assignment task** concurrently. Key `assignment-task:{taskId}:lock`, atomic `SET NX EX` (TTL 30s), value `receptionist:{accountId}`, compare-and-delete release.
- Same lock style as the existing **appointment booking** slot lock (`slot:{doctorId}:{timeSlotId}`). The DB guards (atomic conditional update / transaction) remain as a second layer.
- Code: `withTaskLock(...)` in [../src/appointment/appointment-assignment-task.service.ts](../src/appointment/appointment-assignment-task.service.ts).

---

## 3. Current flows

### 3.1 Broad booking created → online receptionist notified
```
Patient ── POST /appointment/book (broadBooking=true) ──► AppointmentBookingService
  AppointmentBookingService:
    create Appointment(PENDING, doctor=null, slot=null, AWAITING_ASSIGNMENT)   [txn]
    create AppointmentAssignmentTask(PENDING, deadlineAt)                       [txn]
    (DICH_VU) create deposit payment
    emit 'appointment.assignment.created'
        │
        ▼  AssignmentNotificationListener
    onlineEmails = PresenceService.getOnlineReceptionists()   ◄── Redis online_role:RECEPTIONIST
    receptionists = Account.find({ role: RECEPTIONIST })       (DB fan-out, offline-safe)
    for each receptionist: publish ASSIGNMENT_TASK_CREATED { online: onlineEmails.has(email) }
        → DB notification persisted (idempotent) + Redis Pub/Sub → socket NOTIFICATION_RECEIVED
```

### 3.2 No receptionist online
```
emit 'appointment.assignment.created'
  → getOnlineReceptionists() returns []
  → log: "No online receptionist for created task <id>; relying on the polling queue."
  → DB notifications still persisted for all receptionists (online=false)
  → booking is NOT failed; task stays PENDING
  → receptionist sees it later via GET /appointment/assignment-tasks?status=PENDING   (fallback)
```

### 3.3 Reminder event (SLA)
```
AssignmentSlaScheduler (every 60s, Redis-locked single runner)
  PENDING task within reminder window ──► emit 'appointment.assignment.reminder' { reminderCount }
        │
        ▼  AssignmentNotificationListener.handleAssignmentReminder
    target online + all receptionists; publish ASSIGNMENT_TASK_REMINDER
    idempotencyKey = ASSIGNMENT_TASK_REMINDER:{taskId}:{reminderCount}:{recipient}
        (each reminder distinct; a retry of the same reminder dedupes)
```

### 3.4 Expired event (SLA)
```
AssignmentSlaScheduler
  PENDING task past deadline+grace ──► status=EXPIRED, emit 'appointment.assignment.expired'
        │
        ▼  AssignmentNotificationListener.handleAssignmentExpired
    publish ASSIGNMENT_TASK_EXPIRED to receptionists (manual attention needed)
    idempotencyKey = ASSIGNMENT_TASK_EXPIRED:{taskId}:{recipient}   (one-time transition)
    (no auto-cancel / no auto-refund; admin escalation = future improvement)
```

### 3.5 Receptionist assignment with the Redis lock
```
Receptionist A ── POST /assignment-tasks/:id/accept ─► withTaskLock(taskId, A):
    acquireLock(assignment-task:{id}:lock, "receptionist:A", 30s) = OK
      acceptTaskInternal: findOneAndUpdate({status: PENDING} → ASSIGNED)   (DB 2nd-layer guard)
    finally releaseLock (compare-and-delete)

Receptionist B (concurrent) ── accept/assign same task ─► withTaskLock(taskId, B):
    acquireLock(...) = false  → throw TASK_LOCK_HELD
      "This assignment task is currently being handled by another receptionist."

Owner ── POST /assignment-tasks/:id/assign ─► withTaskLock → assignDoctorAndSlotInternal:
    ownership + slot lock(slot:{doctor}:{slot}) + txn(status/conflict re-checks)
    set doctor/slot, book slot, complete task
    emit 'appointment.booking.success' (Visit created by existing listener) + 'appointment.assignment.completed' (patient notified)
```

---

## 4. In-scope fixes completed (per phase)

| Phase | Commit | Summary | Key files |
|---|---|---|---|
| 0 | `8656dd2` | Baseline + scope lock doc | `docs/broad-booking-redis-notification-scope.md` |
| 1 | `a4b8387` | Backend auto-joins the authenticated email room on connect (realtime no longer depends on FE `JOIN_ROOM`) | `src/socket/base/base.gateway.ts` (+spec) |
| 2 | `bae808f` | Presence stale-state cleanup + heartbeat recovery of an expired device key | `src/socket/presence.service.ts` (+spec) |
| 3 | `a619788` | Role-aware Redis presence (`online_role:RECEPTIONIST` + per-user hash) + `getOnlineReceptionists()` | `src/socket/presence.service.ts`, `base.gateway.ts` (+specs) |
| 4 | `e37bc9a` | Broad-booking notification targets online receptionists from Redis (`online` flag); DB fan-out kept offline-safe | `src/notification/listenners/assignment.notify.listenner.ts`, `notification.module.ts`, DTO, handler (+spec) |
| 5 | `60293ea` | Reminder + expired SLA events now have notification listeners + handlers + types | `src/notification/...` (listener, 2 handlers, service registry, module, DTO) (+spec) |
| 6 | `17af8ca` | Redis atomic task lock around accept/assign (`assignment-task:{id}:lock`) | `src/appointment/appointment-assignment-task.service.ts` (+2 specs) |
| 7 | `f5b10d5` | Verified broad booking w/o doctor/slot + deposit; added normal-booking regression-guard tests | `src/appointment/appointment-booking.service.broad.spec.ts` |

---

## 5. Out-of-scope limitations (intentional)

These are **documented, not implemented** — acceptable because this is a learning/thesis
demonstration focused on Redis presence, Pub/Sub, and atomic locking, not a production system.

- **Redis down recovery** — not handled. If Redis is unavailable, presence + the Pub/Sub realtime bridge degrade; the system falls back to the DB queue + polling. (Phase 4 swallows a presence lookup failure so booking never breaks, but this is graceful degradation, not full recovery.)
- **RabbitMQ down recovery** — not handled. Notification jobs flow through RabbitMQ; if it is down, the realtime/DB notification is dropped and receptionists rely on the polling queue.
- **Outbox Pattern** — not implemented (the commit-then-emit gap between task creation and the event is a known, accepted limitation; the reminder listener + polling mitigate it).
- **Production-grade distributed retry / fallback** — not implemented.
- **Large-scale fan-out optimization** — the per-receptionist DB fan-out is O(N receptionists); fine at thesis scale.
- **Admin escalation on expiry** — expiry notifies receptionists; a dedicated admin escalation channel is a future improvement.

---

## 6. Testing summary

Commands run (see [../package.json](../package.json)):

| Command | Result |
|---|---|
| `npm run test` (jest unit) | ✅ **16 suites / 153 tests passing** |
| `npm run build` (nest build / tsc) | ✅ pass (validates DI wiring + types) |
| `npm run test:e2e` | ⚠️ **fails to run — pre-existing, unrelated.** `test/jest-e2e.json` has no `moduleNameMapper` for the `src/*` path alias, so it cannot resolve `src/billing/billing.module` (the first import of `app.module.ts`). This breaks at module resolution **before any of this work loads** and is independent of the broad-booking changes. Not fixed (out of scope). |

Notes:
- New tests added across phases: socket auto-join (7), presence lifecycle + role-aware (13), assignment notification online targeting + reminder/expired (15), assignment task Redis lock (5), broad-booking normal-booking regression guard (2).
- Lint: the repo has no clean lint baseline (~25k pre-existing `prettier/prettier` CRLF + `no-unsafe-*` issues). New production code is clean; lint was run scoped to changed files to avoid a repo-wide `eslint --fix` CRLF rewrite. Pre-existing `no-unsafe-*` notes in `notification.service.ts` / `appointment-assignment-task.service.ts` are unrelated to this work.

---

## 7. Thesis defense notes

**Why Redis?**
Redis is used because online presence and distributed locking require **fast shared state across
backend instances**. A single Node process's in-memory map cannot answer "which receptionists are
online?" once the backend is scaled to multiple instances. Redis also provides **Pub/Sub**, which
lets us deliver realtime notifications even when the socket and the event source live on different
instances. The same Redis primitives (`SET NX EX`) give us atomic locks to serialize
receptionist actions on a task.

**Why does polling still exist?**
Realtime notification is **best-effort**. The `AppointmentAssignmentTask` table is the source of
truth, and receptionist **polling** (`GET /appointment/assignment-tasks`) guarantees a task is
still visible even if the realtime notification is missed (receptionist offline, Redis/RabbitMQ
hiccup, the commit-then-emit gap). Realtime makes the queue *feel* live; polling makes it *correct*.

**Why not the Outbox Pattern?**
Outbox is a production-grade reliability pattern for guaranteeing event delivery after a DB commit.
It is documented as a **future improvement** but excluded here to keep the project focused on the
three Redis capabilities being demonstrated — presence, Pub/Sub, and atomic locking — rather than
on production messaging guarantees. The polling queue is the pragmatic stand-in for the missing
delivery guarantee at this scope.

**How is the "two receptionists, one task" race prevented?**
Two layers: (1) a Redis lock `assignment-task:{taskId}:lock` (`SET NX EX`, owner-scoped
compare-and-delete release) gives a clear `TASK_LOCK_HELD` conflict to the loser; (2) even if the
lock TTL lapses, the DB guards — `acceptTask`'s atomic conditional `findOneAndUpdate({status:
PENDING})` and `assignDoctorAndSlot`'s ownership + transactional re-checks — make a double
assignment impossible.

---

## 8. How to run

```bash
npm install
npm run test          # unit tests (recommended signal)
npm run build         # type-check + compile
npm run start:dev     # hot-reload dev server (needs Mongo/Redis/RabbitMQ env per CLAUDE.md)
```
Broad-booking SLA env (optional, safe defaults — see CLAUDE.md): `ASSIGNMENT_DEADLINE_MINUTES`,
`ASSIGNMENT_REMINDER_WINDOW_MINUTES`, `ASSIGNMENT_REMINDER_INTERVAL_MINUTES`,
`ASSIGNMENT_GRACE_MINUTES`, `ASSIGNMENT_ACCEPT_TTL_MINUTES`; presence TTL: `SOCKET_PRESENCE_TTL_SECONDS`.
