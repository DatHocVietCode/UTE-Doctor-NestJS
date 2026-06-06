# Broad Booking — Redis Notification & Presence: Baseline & Scope Lock (Phase 0)

> **Phase 0 = analysis only. No code fixes in this phase.**
> **Branch:** `task/edge-case-not-select-doctor` · **Date:** 2026-06-06
> **Project type:** Learning / thesis project (NOT production).
> **Companion (deep dive):** [../RECEPTIONIST_PRESENCE_NOTIFICATION_ANALYSIS.md](../RECEPTIONIST_PRESENCE_NOTIFICATION_ANALYSIS.md)

This document locks the baseline behavior and the scope of the upcoming work for the
"broad booking" (doctor-less appointment) edge case: a patient books **without selecting a
doctor** → the system creates an `AppointmentAssignmentTask (PENDING)` and must notify
receptionists so one of them can claim it and assign a doctor + time slot.

The intentional Redis learning goals for this thesis are:
1. **Online user / role-aware presence.**
2. **Horizontal-scale realtime notification via Redis Pub/Sub.**
3. **Atomic locking** so two receptionists cannot handle the same assignment task.

---

## 1. Current Redis Presence Behavior

**Owner:** `PresenceService` ([../src/socket/presence.service.ts](../src/socket/presence.service.ts)), driven by the
socket lifecycle in `BaseGateway` ([../src/socket/base/base.gateway.ts](../src/socket/base/base.gateway.ts)). Every namespace gateway
(`/notification`, `/chat`, `/appointment`, `/auth`, `/patient-profile`, `/payment/vnpay`) extends `BaseGateway`.

| Aspect | Current behavior |
|---|---|
| Store | Redis (ioredis) via `RedisService.getClient()` |
| Keys | `user:{userId}:devices` (SET of socketIds) + `online_users` (SET of userIds). `{userId}` = `accountId`/`sub` from JWT. |
| Value shape | Plain Redis SETs. **No role, no email, no namespace, no timestamp stored.** |
| TTL | `user:{userId}:devices` → `SOCKET_PRESENCE_TTL_SECONDS` (default **60s**), refreshed by heartbeat. `online_users` → **no TTL**. |
| Mark online | `handleConnection` → `addConnection` on authenticated connect ([presence.service.ts:11-23](../src/socket/presence.service.ts#L11-L23)). |
| Mark offline | `handleDisconnect` → `removeConnection`; removed from `online_users` only when device SET `SCARD == 0` ([presence.service.ts:25-43](../src/socket/presence.service.ts#L25-L43)). |
| Heartbeat | `HEARTBEAT` event → `refreshTTL` runs `EXPIRE` on the device key only ([presence.service.ts:45-71](../src/socket/presence.service.ts#L45-L71)). |
| Role-aware? | **No.** Role lives only in `socket.data.authUser.role` (per-socket, in-memory); it is **not** indexed in Redis. |
| Multi-tab/device | Supported — one socketId per SET member; user is online while ≥1 socketId remains. |
| Cross-instance | Presence SETs live on shared Redis, but **Socket.IO has no Redis adapter** ([socket.adapter.ts:16-46](../src/socket/socket.adapter.ts#L16-L46)). |

### 1.1 Key finding: presence is currently NOT consumed
- `isUserOnline()` ([presence.service.ts:73-80](../src/socket/presence.service.ts#L73-L80)) is **never called** anywhere in `src/`.
- `online_users` is **read exactly once** — for diagnostic logging inside `refreshTTL` ([presence.service.ts:58](../src/socket/presence.service.ts#L58)).
- → Presence today is effectively **write-only / diagnostic**. No router or notifier asks "who is online".

### 1.2 Latent presence inconsistencies (harmless today, must fix before consuming presence)
- **Stale `online_users` (no TTL):** on a process crash `handleDisconnect` never runs, so the device key expires (60s) but the userId stays in `online_users` forever. Also, device-key TTL expiry while still connected does not `SREM online_users`. → `online_users` accumulates false positives.
- **Heartbeat does not revive an expired device key:** `refreshTTL` only `EXPIRE`s ([presence.service.ts:54](../src/socket/presence.service.ts#L54)). If the key already expired (missed heartbeats), `EXPIRE` returns `0`, a warning is logged, and the key is **not** re-created → socket stays alive but appears offline until reconnect.
- **Short 60s TTL vs. live connections:** presence reliability depends entirely on the FE heartbeat cadence, which the BE does not enforce.
- **Non-atomic teardown:** `SREM` → `SCARD` → `DEL`/`SREM online_users` is a non-atomic sequence ([presence.service.ts:33-42](../src/socket/presence.service.ts#L33-L42)); concurrent disconnects can interleave.

---

## 2. Current Notification Broadcast Behavior (Assignment)

End-to-end trace for `broadBooking=true`:

```
1. POST /appointment/book (broadBooking=true)
     → AppointmentBookingService.bookBroadAppointment()
       - create Appointment (PENDING, doctorId=null, assignmentStatus=AWAITING_ASSIGNMENT)
       - create AppointmentAssignmentTask (PENDING, deadlineAt)        [transaction]
       - (DICH_VU) create deposit payment
       - emit EventEmitter2 'appointment.assignment.created'           (appointment-booking.service.ts:415-423)

2. AssignmentNotificationListener.handleAssignmentCreated()            (assignment.notify.listenner.ts:43-74)
     - accountModel.find({ role: RECEPTIONIST }).select('email')       ← QUERIES MONGODB, NOT presence
     - for each receptionist: notificationPublisher.publish({ type:'ASSIGNMENT_TASK_CREATED',
         recipientEmail, idempotencyKey:`ASSIGNMENT_TASK_CREATED:{taskId}:{email}` })

3. NotificationJobPublisher.publish() → RabbitMQ NOTIFICATION_JOBS_QUEUE
     (publish failure only logs a warning; no fallback)                (notification-job.publisher.ts:12-23)

4. NotificationQueueConsumer → NotificationService.process() → handler registry  (notification.service.ts:88-102)

5. AssignmentTaskCreatedNotificationHandler.handle()                   (assignment-task-created-notification.handler.ts:17-54)
     - storeIfNotExists(Notification{ receiverEmail:[email], idempotencyKey, ... })  (dup key 11000 ⇒ skip)
     - redisService.publish(NOTIFICATION_REDIS_CHANNEL, payload)       ← Pub/Sub bridge

6. NotificationRedisListener (every instance subscribes)              (notification-redis.listenner.ts:17-33)
     - notificationGateway.emitToRoom(recipientEmail, 'NOTIFICATION_RECEIVED', payload)

7. Receptionist socket on /notification (that has JOIN_ROOM'd its email) receives it realtime.
   Offline receptionist → misses realtime but the Notification is in DB (seen on next load).
```

Observations:
- **"Online receptionist" is never computed.** The listener fans out to **all** `role=RECEPTIONIST` accounts from MongoDB ([assignment.notify.listenner.ts:45-48](../src/notification/listenners/assignment.notify.listenner.ts#L45-L48)). The code comment states this is intentional MVP: *"no role-aware presence: receptionists are resolved from Account by role."*
- **Cross-instance realtime works** despite no Socket.IO Redis adapter, because the handler publishes to `NOTIFICATION_REDIS_CHANNEL` and **every** instance re-emits to its local rooms (Pub/Sub bridge).
- **Idempotency is correct:** unique sparse index on `Notification.idempotencyKey` ([notification.schema.ts:32-33](../src/notification/schemas/notification.schema.ts#L32-L33)); duplicate events hit dup-key 11000 → no double store / no double emit.
- **Offline receptionists are covered** via persisted `Notification` (`receiverEmail:[email]`) surfaced by `getNotificationsByEmail` ([notification.service.ts:147-152](../src/notification/notification.service.ts#L147-L152)).
- **Realtime delivery depends on the FE calling `JOIN_ROOM`** (room = email) ([base.gateway.ts:67-91](../src/socket/base/base.gateway.ts#L67-L91)). Connecting to `/notification` without joining the email room ⇒ no realtime (DB notification still arrives).
- **The authoritative source for receptionists is the queue list**, not the notification: `GET /appointment/assignment-tasks?status=PENDING` reads tasks straight from MongoDB ([appointment-assignment-task.controller.ts:30-43](../src/appointment/appointment-assignment-task.controller.ts#L30-L43)). Even if every notification fails, the PENDING task is still visible. Notifications are a best-effort nudge on top of polling.

---

## 3. Current Reminder / Expired Event Behavior

`AssignmentSlaScheduler` ([../src/appointment/appointment-assignment-sla.scheduler.ts](../src/appointment/appointment-assignment-sla.scheduler.ts)) runs a `setInterval` sweep every
`SLA_SWEEP_INTERVAL_MS` (60s), guarded by a Redis lock `SLA_LOCK_KEY = 'cron:assignment-sla'`
(`acquireSlotLock`, TTL 50s) so only one instance acts per tick. Each sweep:

| Phase | Action | Event emitted | Listener today |
|---|---|---|---|
| Reminder | PENDING task within `reminderWindowMs` of deadline, rate-limited by `lastNotifiedAt`; `$inc reminderCount`, `$set lastNotifiedAt` ([sla.scheduler.ts:89-118](../src/appointment/appointment-assignment-sla.scheduler.ts#L89-L118)) | `appointment.assignment.reminder` ([:110](../src/appointment/appointment-assignment-sla.scheduler.ts#L110)) | ❌ **none** |
| Expiry | PENDING past `deadline + graceMs` → status `EXPIRED` ([sla.scheduler.ts:122-155](../src/appointment/appointment-assignment-sla.scheduler.ts#L122-L155)) | `appointment.assignment.expired` ([:148](../src/appointment/appointment-assignment-sla.scheduler.ts#L148)) | ❌ **none** |
| Reclaim | ASSIGNED task idle past `acceptTtlMs` → back to PENDING ([sla.scheduler.ts:158-183](../src/appointment/appointment-assignment-sla.scheduler.ts#L158-L183)) | (none — direct DB update) | n/a |

**Gap:** the reminder and expired events are emitted but **no `@OnEvent` listener consumes them** (verified by searching the codebase). Consequences:
- A task nearing its deadline is **not re-notified** to receptionists.
- An `EXPIRED` task notifies **no one** (no admin escalation, no "mark for manual review"); the appointment is left PENDING/AWAITING. By design there is **no** auto-cancel and **no** auto-refund.

Timing defaults ([../src/appointment/appointment-assignment-sla.config.ts](../src/appointment/appointment-assignment-sla.config.ts)): reminder window 10m, reminder interval 5m, grace 5m, accept TTL 10m (all env-overridable).

---

## 4. Current Assignment Task Handling & Possible Race Conditions

Service: `AppointmentAssignmentTaskService` ([../src/appointment/appointment-assignment-task.service.ts](../src/appointment/appointment-assignment-task.service.ts)).

| Operation | Concurrency control today | Race-safe? |
|---|---|---|
| `acceptTask` | Single conditional `findOneAndUpdate({_id, status:PENDING} → ASSIGNED)` ([:124-143](../src/appointment/appointment-assignment-task.service.ts#L124-L143)) | ✅ MongoDB atomicity guarantees exactly one winner; loser gets `TASK_ALREADY_ACCEPTED`. |
| `releaseTask` | Conditional update gated on `status:ASSIGNED` + `acceptedByReceptionistId` ([:196-216](../src/appointment/appointment-assignment-task.service.ts#L196-L216)) | ✅ Ownership + state enforced atomically. |
| `assignDoctorAndSlot` | **Redis slot lock** `slot:{doctorId}:{timeSlotId}` ([:304-309](../src/appointment/appointment-assignment-task.service.ts#L304-L309)) + Mongo transaction with re-checks (task ownership, appointment still assignable, slot conflict) ([:311-391](../src/appointment/appointment-assignment-task.service.ts#L311-L391)) | ✅ Double-guarded (Redis lock + transactional conflict check). |
| SLA reclaim | Conditional update gated on `status:ASSIGNED` + `acceptedAt<=cutoff` ([:166-181](../src/appointment/appointment-assignment-sla.scheduler.ts#L166-L181)) | ✅ Atomic. |

**Current posture:** the "two receptionists claim the same task" race is **already prevented** by the atomic Mongo `findOneAndUpdate` on `acceptTask`, and slot double-booking on assign is prevented by the Redis slot lock + transactional conflict check.

**Residual / latent risks (not data-corruption, but worth noting):**
- **Commit-then-emit gap:** if the process dies after the task transaction commits but before `emit('appointment.assignment.created')` ([appointment-booking.service.ts:369-423](../src/appointment/appointment-booking.service.ts#L369-L423)), no notification is ever published. The task still appears in the queue list (polling safety net), but — combined with §3 — there is no reminder to re-surface it.
- **Swallowed listener errors:** `handleAssignmentCreated` runs async via EventEmitter2; if `accountModel.find` throws, the booking already returned success and the error is not retried (queue list still covers it).
- **Accept uses Mongo atomicity, not a Redis lock.** This is correct and sufficient. The thesis goal of demonstrating a **Redis atomic lock for receptionist assignment handling** would therefore be an *explicit, demonstrative* lock layer rather than a fix for an actual data race.

---

## 5. Scope Decisions

### 5.1 In scope
1. **Fix socket room join reliability** — reduce dependence on the FE explicitly calling `JOIN_ROOM` (e.g. auto-join email and/or a `role:RECEPTIONIST` room on connect).
2. **Fix Redis presence stale state** — make `online_users` consistent with the device SET (TTL/teardown), eliminating the false positives in §1.2.
3. **Fix heartbeat recovery when the device key expired** — `refreshTTL` should re-create / re-`SADD` instead of only `EXPIRE`-ing.
4. **Add role-aware Redis presence for receptionist** — e.g. `online_role:RECEPTIONIST` set + `presence:user:{id}` hash (role/email), cleaned up on disconnect/TTL; expose a `getOnlineReceptionists()`.
5. **Use Redis online receptionist state for realtime receptionist notification** — drive the realtime fan-out from presence (demonstrating Redis goal #1 + #2).
6. **Keep assignment task queue/polling as fallback** — the DB queue list remains the authoritative source; presence-driven realtime sits on top.
7. **Add listeners for** `appointment.assignment.reminder` **and** `appointment.assignment.expired` — close the SLA loop (re-notify on reminder; surface/escalate on expiry).
8. **Add Redis atomic lock for receptionist assignment handling** — explicit Redis lock to demonstrate Redis goal #3 (note §4: accept is already atomic via Mongo; this is demonstrative/explicit).

### 5.2 Out of scope
- **Redis down recovery** — documented as a limitation only.
- **RabbitMQ down recovery** — documented as a limitation only (today a publish failure silently drops the notification; queue polling is the safety net).
- **Outbox Pattern** — explicitly excluded.
- **Production-grade distributed retry** — excluded.
- **Large-scale fan-out optimization** — current O(N receptionists) fan-out is acceptable for thesis scale.
- **Full active/disabled account policy** — only if already trivially handled by an existing filter; otherwise out of scope.

### 5.3 Documented limitations (intentional, out of scope to fix)
- If **RabbitMQ** is down/disabled (`RABBITMQ_ENABLED=false`), assignment notifications are dropped (both realtime push and the persisted DB record, since the DB write happens inside the queue consumer). Mitigation in practice: receptionists rely on the **queue list polling**.
- If **Redis** is down, presence and the Pub/Sub realtime bridge are unavailable; the system degrades to queue-list polling.
- Presence reliability depends on the FE heartbeat cadence vs. the 60s device-key TTL.

---

## 6. Thesis Defense Notes

- **Why notify all receptionists (not only online ones) today?** The current MVP fans out to every `role=RECEPTIONIST` account and persists a per-receptionist `Notification`, so **offline staff are not missed** — they see the task on next load. This is arguably *safer* than online-only broadcast. The planned change adds **role-aware presence** so the *realtime* layer is presence-driven, while DB persistence + queue polling remain the correctness backbone.
- **Three Redis capabilities demonstrated:**
  1. *Presence / role-aware online state* — `online_role:RECEPTIONIST` + per-user hash (in scope).
  2. *Horizontal-scale realtime* — Socket.IO has **no** Redis adapter; cross-instance delivery is achieved via **Redis Pub/Sub** (`NOTIFICATION_REDIS_CHANNEL`), already proven by the existing notification bridge.
  3. *Atomic locking* — Redis `SET NX EX` slot locks already guard slot assignment and the SLA cron; an explicit accept lock makes the "single receptionist per task" guarantee demonstrable (Mongo `findOneAndUpdate` already enforces it).
- **Correctness backbone vs. nudge:** the authoritative state is the MongoDB assignment-task queue (`GET /appointment/assignment-tasks`). Notifications/presence are an optimization layer. This separation is why "Redis/RabbitMQ down" can be honestly scoped out as a degradation, not a data-loss, scenario.
- **No data race on claiming a task today:** `acceptTask` is a conditional atomic update; the Redis lock added in scope is *educational/explicit*, not a corrective measure.

---

## 7. Validation (Phase 0)

Ran the safe, available checks (scripts from [../package.json](../package.json)):

- **`npm run test` (jest): ✅ PASS** — `14 passed, 14 total` suites; `115 passed, 115 total` tests. Includes the broad-booking and assignment specs (`appointment-booking.service.broad.spec.ts`, `appointment-assignment-task.service.spec.ts`, `appointment-assignment-sla.scheduler.spec.ts`, `assignment.notify.listenner.spec.ts`).
- **Lint:** the project script is `eslint ... --fix` (mutating). To honor "no fixes in Phase 0", lint was run **without `--fix`**. It reports ~25,000 problems, but **~24,000 are auto-fixable `prettier/prettier` "Delete ␍" (Windows CRLF line-ending) issues** plus pre-existing `@typescript-eslint/no-unsafe-*` warnings in `test/app.e2e-spec.ts`. These are **pre-existing, environment-level (CRLF) noise unrelated to the broad-booking work**; the normal `npm run lint` (`--fix`) would normalize them. `--fix` was intentionally **not** run here because it would rewrite the entire repository (out of scope for Phase 0).

**Conclusion:** test baseline is green; lint noise is pre-existing CRLF formatting and does not block this analysis.

---

## 8. Phase Progress Log

### Phase 1 completed — Socket notification room reliability
- **Backend now auto-joins the authenticated user's email room on connect.** `BaseGateway.handleConnection` reads `socket.data.authUser.email` (populated by `SocketAuthMiddleware` from the JWT) and joins `email.toLowerCase()` via `autoJoinEmailRoom` ([../src/socket/base/base.gateway.ts](../src/socket/base/base.gateway.ts)).
- **Frontend `JOIN_ROOM` is no longer the only dependency for realtime notification.** Realtime `NOTIFICATION_RECEIVED` now reaches receptionists/patients even if the client never emits `JOIN_ROOM`. Existing `JOIN_ROOM` behavior is preserved for backward compatibility.
- **Email normalization** is consistent (trim + lowercase) via the shared `normalizeRoom`, matching how rooms are keyed on emit.
- **Security:** the room is derived from the **JWT email only**, never a client-supplied payload — `JOIN_ROOM` already used the authenticated email, so no arbitrary-room-join surface was added. (Note: the chat namespace's `CHAT_JOIN_CONVERSATION` joins a client-supplied `conv:{id}` room; that is a separate, pre-existing concern, out of scope here and left unchanged.)
- **Logs added** for auto-join success (`[Socket][AutoJoin] Joined ...`) and skip/failure cases.
- **Tests:** new `src/socket/base/base.gateway.spec.ts` (7 cases) covers auto-join, normalization, missing-email, unauthenticated disconnect, `JOIN_ROOM` backward compatibility, and `emitToRoom`. Full suite: **15 suites / 122 tests passing**. Lint was run scoped to the changed files (the repo-wide `eslint --fix` only normalizes pre-existing CRLF noise, so it was not run globally).

### Phase 2 completed — Redis presence stale state & heartbeat recovery
- **Heartbeat can now recover an expired device key.** `PresenceService.refreshTTL` checks `EXISTS user:{userId}:devices`; if the set lapsed (missed heartbeats) while the socket is still alive, it re-adds the live `socketId`, refreshes the TTL, and re-adds the user to the online index ([../src/socket/presence.service.ts](../src/socket/presence.service.ts)). Previously it only ran `EXPIRE`, leaving a live socket stuck "offline" until reconnect.
- **Redis presence stale state reduced/fixed.** `refreshTTL` now reconciles `online_users` against the device set (the source of truth) on every heartbeat: re-add while ≥1 device remains, `SREM` when none remain. `isUserOnline` already derives liveness from device-set `SCARD` (never trusts `online_users` alone), so the index can no longer cause false "online" results for live-but-idle reconciliation.
- **Multi-tab/device preserved.** A user keeps multiple socketIds in the set and stays online while ≥1 remains; `removeConnection` only clears the online index when the last device disconnects.
- **TTL stays configurable** via the existing `SOCKET_PRESENCE_TTL_SECONDS` env (default 60s).
- **Logs added** for add (`[Presence][ADD]`), remove (`[Presence][REMOVE]` with remaining count + online/offline), heartbeat (`[Presence][HEARTBEAT]` with `recovered`/ttl/connections), and recovery (`[Presence][HEARTBEAT][RECOVER]`).
- **Limitation (out of scope):** on a hard process crash with no clean disconnect, a `online_users` entry can remain until the next heartbeat reconciliation or reconnect (no `online_users` per-member TTL). This is acceptable for thesis scope; `isUserOnline` is unaffected because it reads the TTL'd device set.
- **Tests:** new `src/socket/presence.service.spec.ts` (6 cases, in-memory Redis fake) covers add/remove, multi-device, last-device cleanup, TTL refresh, expired-key recovery, and `isUserOnline` transitions. Presence is now safer to use as the source for **role-aware receptionist online detection in Phase 3**. Full suite: **16 suites / 128 tests passing**; Phase 2 files lint clean.

### Phase 3 completed — Role-aware Redis presence for receptionists
- **Redis is now used for role-aware online receptionist detection.** `PresenceService` maintains, in addition to the device set: a per-role index `online_role:{ROLE}` (SET of `userId`, deduped across devices) and a per-user metadata hash `presence:user:{userId}` = `{ userId, email, role }` with TTL ([../src/socket/presence.service.ts](../src/socket/presence.service.ts)).
- **New API:** `getOnlineUsersByRole(role)` and `getOnlineReceptionists()` return `{ userId, email, role }[]`. The device set remains the **liveness source of truth**; any role member without a live device set is pruned lazily on read (self-heals crash leftovers).
- **Identity source:** role + email come from the authenticated socket `socket.data.authUser` (populated by `SocketAuthMiddleware` from the JWT). `BaseGateway` forwards `{ email, role }` to `addConnection` on connect and `refreshTTL` on heartbeat ([../src/socket/base/base.gateway.ts](../src/socket/base/base.gateway.ts)).
- **Normalization:** role is upper-cased, email is lower-cased and trimmed, consistently across index writes and reads.
- **Cleanup & recovery:** the last device disconnect removes the user from the role index + deletes the metadata hash (role read from the hash before deletion); heartbeat recovery re-adds the role index and refreshes the metadata-hash TTL alongside the device key. Multi-device never duplicates a user (SET semantics).
- **Design rule honored:** assignment-task correctness does **not** depend on presence. The `AppointmentAssignmentTask` (DB) stays the source of truth; Redis online receptionists are a realtime-target optimization; polling remains the fallback. DB notification persistence and the DB task queue are untouched.
- **Logs** include role on add/remove and `recovered=` on heartbeat.
- **Tests:** `src/socket/presence.service.spec.ts` extended with 7 role-aware cases (receptionist connect/return, non-receptionist excluded, multi-device once, one-device-still-online, last-device removal, heartbeat role recovery, lazy stale prune) and `base.gateway.spec.ts` adds heartbeat metadata forwarding. Full suite: **16 suites / 136 tests passing**; Phase 3 socket files lint clean. (`base.gateway.ts` retains pre-existing `no-unsafe-member-access` lint notes consistent with the file's existing `client.data` access style — not introduced by this work.)

### Phase 4 completed — Redis online receptionists drive realtime targeting
- **Broad-booking realtime notification now uses Redis role-aware presence to target online receptionists.** `AssignmentNotificationListener.handleAssignmentCreated` calls `PresenceService.getOnlineReceptionists()` and tags each published job with `online: boolean` (true when that receptionist was seen online at emit time) ([../src/notification/listenners/assignment.notify.listenner.ts](../src/notification/listenners/assignment.notify.listenner.ts)).
- **Chosen DB approach (option 6c — smallest/least risky):** keep the DB notification + idempotency fan-out to **all** receptionists (so offline staff still get the bell on next load), while Redis presence drives the *realtime targeting* decision and the `online` flag. This preserves existing persistence, idempotency, and all prior tests, and adds no new delivery path that could regress.
- **Assignment task queue (DB) stays the source of truth; polling remains the fallback.** Booking and task creation are never blocked by presence.
- **No online receptionist:** the flow does **not** fail booking or task creation — it logs a clear message (`No online receptionist for task … relying on the assignment-task polling queue (task stays PENDING)`) and the PENDING task remains visible via `GET /appointment/assignment-tasks`.
- **Resilience (within thesis scope):** a Redis/presence lookup failure is swallowed (`resolveOnlineReceptionistEmails` → empty set) so the already-committed booking never breaks; it degrades to "nobody online" + polling. (This is graceful degradation, **not** the out-of-scope Redis-down recovery / retry.)
- **Wiring:** `PresenceService` is provided in `NotificationModule` (it depends only on `RedisService`, already provided there) — no new module import, no circular dependency. `npm run build` passes.
- **Tests:** `assignment.notify.listenner.spec.ts` extended (9 cases total) — online→`online=true`, no-online→no throw + still persists, non-receptionist not flagged, Redis-failure degrades without throwing, plus the unchanged patient `assignment.completed` path. Full suite: **16 suites / 140 tests passing**; Phase 4 production files lint clean.
