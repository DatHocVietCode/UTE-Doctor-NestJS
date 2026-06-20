# No-show as a reconstructed terminal state, settled by a daily reconciler

**Status:** accepted

## Context & decision

A `CONFIRMED`, doctor/slot-assigned appointment whose scheduled time passes without the patient
checking in had **no terminal outcome** — it stayed `CONFIRMED` forever, kept showing
cancel/reschedule actions, and never settled its deposit. (The existing assignment-timeout
reconciler only handles broad/unassigned appointments that were never staffed — a different branch.)

We are introducing **No-Show** as a first-class terminal outcome, with three deliberate choices:

1. **A new terminal status, not a reuse of `CANCELLED`.** Add `AppointmentStatus.NO_SHOW` and
   `VisitStatus.NO_SHOW`. A no-show is the patient's failure to attend — clinically and
   financially distinct from a cancellation (a deliberate call-off) and a failure (booking/payment
   never completed).

2. **Reconstructed from durable state, not stored as audit events.** The admin appointment
   lifecycle is *reconstructed* from domain state, timestamps, assignment-task history, and ledgers
   — there is no appointment audit/event log (`lifecycle-event-type.enum.ts`:
   *"reconstructed from domain state … NOT read from an audit log"*). No-show therefore persists
   durable markers on the Appointment (`noShowAt`, `noShowActor`, `noShowMarkedByAccountId`,
   `noShowSource`) and transitions Visit→`NO_SHOW` and paid deposit→`FORFEITED`, and the lifecycle
   builder reconstructs the node from those. We do **not** add an event collection.

3. **Settled by a daily 06:00 (Asia/Ho_Chi_Minh) + startup reconciler, not a realtime sweep.**
   No-show is end-of-day settlement, and its side effects (notification/email) must not fire at
   midnight or at arbitrary restart times. A separate read-model derivation makes a passed
   appointment non-actionable *immediately* (independent of when the transition runs), so users
   never see stale actions while waiting for the next run. A guarded manual
   `PATCH /appointment/:id/no-show` (RECEPTIONIST/ADMIN) shares the same transition core for an
   in-hours staff fallback.

A paid DICH_VU deposit is **forfeited** on no-show (no refund), unlike assignment-timeout (system
fault) which refunds.

## Why

- **No-show is its own concept.** Folding it into `CANCELLED` would lie to reporting, clinical
  review, and the patient ("you cancelled" vs "you didn't show"). The deposit treatment differs
  (forfeit vs refund), which alone justifies a distinct status.
- **Match the existing log-free lifecycle architecture.** Adding a parallel audit-event store just
  for no-show would be inconsistent and a much larger change; reconstruction from durable markers
  is how every other phase already works, and `DEPOSIT_FORFEITED` renders for free.
- **Daily settlement keeps side effects humane and deterministic.** Continuous sweeping would risk
  midnight emails and couples state to notification timing. Decoupling the transition (idempotent,
  any time) from the email (business-hours-gated, per-appointment idempotency key) gives "no
  midnight emails" and "no duplicates" without a single-run dependency. Vietnam has no DST, so a
  fixed +7h `setTimeout` to 06:00 is exact and needs no new scheduling dependency.
- **One core, two callers.** The reconciler and the manual endpoint call the same
  `markAppointmentNoShow` core with the same eligibility rules, so manual and automatic no-shows can
  never diverge.

## Consequences

- `AppointmentStatus`/`VisitStatus` gain a value that **every** status consumer (mappers, filters,
  badge/label maps, terminal-state checks, DTOs) must handle — this is the main blast radius and
  the reason this is hard to reverse.
- New durable fields on Appointment stay empty for non-no-show records; a reader seeing them should
  consult this ADR. `noShowActor`/`noShowMarkedByAccountId` let the admin lifecycle distinguish a
  SYSTEM no-show from a manual RECEPTIONIST/ADMIN one.
- No-show does **not** release the slot (the slot time has already passed) and does **not** create
  billing.
- Eligibility is vetoed by check-in / encounter / completed billing, so a no-show can never mask a
  visit that actually happened.
- A future need for queryable appointment audit events would require revisiting choice (2) and
  introducing the system's first appointment event log.
