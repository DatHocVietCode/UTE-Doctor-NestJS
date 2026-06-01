# Phase 3 Cancel Flow Analysis

## Scope

This report analyzes the appointment cancellation flow only. It does not propose changes to reschedule, deposit collection, billing calculation, or unassigned-doctor workflows.

## Executive Summary

The current cancel flow is substantially aligned with the Phase 3 operational model:

- cancellation requires a linked `Visit`;
- only `Visit.status === CREATED` can proceed;
- the transaction changes `Appointment -> CANCELLED`, `Visit -> CANCELLED`, and `TimeSlotLog -> available`;
- appointment cancellation does not emit a wallet-refund event and does not mutate financial fields;
- notification, mail, and socket fanout runs after the transaction commits.

It is not fully Phase 3 compliant yet. The most important gap is payment detection: cancellation checks only payments linked through `Billing.billingId`, but the current payment model also supports appointment-deposit payments linked directly by `Payment.appointmentId`. A confirmed DICH_VU appointment with deposit-payment evidence can therefore be cancelled without an explicit block, refund, or forfeit transition.

There are also focused hardening gaps:

- slot release is unconditional and does not verify the update result;
- several required blocked cases are not covered by unit tests;
- the controller accepts an inline body type instead of a validated DTO and does not enforce ownership or a cancellation role policy;
- contract documentation contains stale refund statements that contradict the current appointment-cancel behavior;
- the service still applies an additional 24-hour restriction. This may be intentional business policy, but it is not stated in the Phase 3 requirements or the main API contract.

## Entry Point

### HTTP endpoint

File: `src/appointment/appointment.controller.ts`

Handler:

```ts
@Patch('/cancel')
@UseGuards(JwtAuthGuard)
async cancelAppointment(
  @Body() dto: { appointmentId: string; reason?: string },
  @Req() req: any,
)
```

Request body:

```ts
{
  appointmentId: string;
  reason?: string;
}
```

Current authentication and authorization behavior:

- JWT authentication is required.
- `req.user` is injected but not used.
- There is no role guard.
- There is no ownership check to ensure that the authenticated patient owns the appointment.
- The request uses an inline TypeScript type, not a class-validator DTO. Runtime validation for `appointmentId` and `reason` is therefore absent.

## End-to-End Current Flow

Primary implementation: `AppointmentService.cancelAppointment` in `src/appointment/appointment.service.ts`.

### 1. Pre-transaction lookup and validation

The service:

1. Loads the appointment by id.
2. Requires `appointmentStatus` to be `PENDING` or `CONFIRMED`.
3. Resolves the scheduled time from `scheduledAt`, with legacy fallback support.
4. Blocks cancellation when the appointment is within 24 hours of its scheduled time.
5. Builds a cancellation payload with patient, doctor, slot, and display metadata.
6. Hardcodes:

```ts
const refundAmount = 0;
const refundReason = 'No automatic refund for appointment cancellation in visit/billing flow';
const shouldRefund = false;
```

### 2. Transactional validation

Inside `session.withTransaction`, the service:

1. Reloads the appointment.
2. Re-checks that appointment status is `PENDING` or `CONFIRMED`.
3. Loads the linked visit with `{ appointmentId: freshAppointment._id }`.
4. Blocks if the visit is missing.
5. Blocks `VisitStatus.COMPLETED` with `VISIT_COMPLETED`.
6. Blocks every visit status other than `VisitStatus.CREATED` with `VISIT_ALREADY_STARTED`.
7. Blocks if a `MedicalEncounter` exists by either `visitId` or `appointmentId`.
8. Loads `Billing` by `visitId`.
9. If billing exists, checks for `Payment` by `billingId`.
10. Blocks payment with `PAYMENT_EXISTS`.
11. Blocks billing with `BILLING_EXISTS`.

### 3. Transactional writes

On success, the service:

```ts
freshAppointment.appointmentStatus = AppointmentStatus.CANCELLED;
visit.status = VisitStatus.CANCELLED;
await timeSlotLogModel.updateOne(
  { _id: freshAppointment.timeSlot },
  { $set: { status: 'available' } },
  { session },
);
```

No appointment financial fields are mutated.

### 4. Post-commit side effects

After the transaction completes, the service emits:

```ts
notify.patient.appointment.cancelled
mail.patient.appointment.cancelled
socket.appointment.cancelled
```

Downstream consumers:

| Event | Consumer | Effect |
|---|---|---|
| `notify.patient.appointment.cancelled` | `AppointmentNotificationListener.handlePatientAppointmentCancelled` | Publishes unified notification jobs for patient and doctor when doctor email exists |
| `mail.patient.appointment.cancelled` | `MailListener.handlePatientAppointmentCancelled` | Sends patient cancellation email |
| `socket.appointment.cancelled` | `AppointmentGateway.handleAppointmentCancelled` | Pushes `APPOINTMENT_CANCELLED` to patient and doctor rooms |

The appointment cancellation path does not emit `wallet.refund.shift.cancelled`. The registered `CancelListener` handles shift-cancellation refunds only.

### 5. Response contract

Success response:

```ts
{
  code: 'SUCCESS',
  message: 'Appointment cancelled',
  data: {
    appointmentId,
    refundAmount: 0,
    refundReason,
    hoursUntilAppointment,
  },
}
```

Blocked response:

```ts
throw new BadRequestException({
  code: ResponseCode.ERROR,
  message,
  data: { blockedReason },
});
```

Current blocked reasons:

- `APPOINTMENT_NOT_CANCELABLE`
- `VISIT_ALREADY_STARTED`
- `VISIT_COMPLETED`
- `MEDICAL_ENCOUNTER_EXISTS`
- `BILLING_EXISTS`
- `PAYMENT_EXISTS`

## Files and Functions Involved

| File | Function or area | Responsibility |
|---|---|---|
| `src/appointment/appointment.controller.ts` | `cancelAppointment` | JWT-protected HTTP entry point |
| `src/appointment/appointment.service.ts` | `cancelAppointment` | Validation, transaction, state transitions, event fanout |
| `src/appointment/appointment.service.ts` | `throwCancelBlocked` | Standard blocked-reason error response |
| `src/visit/enums/visit-status.enum.ts` | `VisitStatus` | Defines `CREATED`, `CHECKED_IN`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED` |
| `src/timeslot/schemas/timeslot-log.schema.ts` | `TimeSlotLog.status` | Slot status includes `available` and `booked` |
| `src/payment/schemas/payment.schema.ts` | `Payment` | Supports billing payments and appointment-deposit payments |
| `src/notification/listenners/appointment.notify.listenner.ts` | `handlePatientAppointmentCancelled` | Notification queue publication |
| `src/mail/mail.listenner.ts` | `handlePatientAppointmentCancelled` | Cancellation email dispatch |
| `src/mail/mail.service.ts` | `sendPatientAppointmentCancellationMail` | Cancellation email rendering |
| `src/socket/namespace/appointment/appointment-result.gateway.ts` | `handleAppointmentCancelled` | Appointment socket fanout |
| `src/appointment/listenners/cancel.listener.ts` | `handleShiftCancelledRefund` | Shift cancellation only; not used by appointment cancel |
| `src/appointment/appointment.service.cancel.spec.ts` | cancel-flow tests | Existing focused unit coverage |

## Phase 3 Compliance Matrix

| Requirement | Current status | Notes |
|---|---|---|
| Allow only when `Visit.status === CREATED` | Compliant | Missing visit and all non-`CREATED` states are blocked |
| Block `CHECKED_IN` | Compliant | Returns `VISIT_ALREADY_STARTED` |
| Block `IN_PROGRESS` | Compliant | Covered by generic non-`CREATED` branch, but not tested |
| Block `COMPLETED` | Compliant | Returns `VISIT_COMPLETED` |
| Block `CANCELLED` | Compliant | Covered by generic non-`CREATED` branch, but not tested |
| `Appointment -> CANCELLED` | Compliant | Written inside Mongo transaction |
| `Visit.CREATED -> CANCELLED` | Compliant | Written inside same Mongo transaction |
| `TimeSlotLog -> available` | Partially compliant | Updated inside transaction, but release is unconditional and result is not checked |
| Send notification/socket/mail if supported | Compliant | All three channels emitted after commit |
| No wallet refund | Compliant | No appointment-cancel wallet event or wallet service call |
| No deposit refund | Compliant | No deposit refund logic |
| No coin restoration | Compliant | No coin service call in cancel method |
| Do not infer refund from appointment amount fields | Compliant | Refund is hardcoded to zero and no amount-like field is read for refund |
| Block when billing exists | Compliant | Returns `BILLING_EXISTS` |
| Block when payment exists | Partially compliant | Detects billing payments only; misses direct appointment-deposit payments |

## Gap Analysis

### High: appointment-deposit payment evidence is not checked

The cancellation transaction checks:

```ts
paymentModel.exists({ billingId: billing._id })
```

only when a billing exists.

However, `Payment` currently supports:

```ts
purpose = APPOINTMENT_DEPOSIT
appointmentId = appointment._id
```

and the appointment schema stores:

```ts
depositStatus
depositPaidAmount
depositPaymentId
depositPaidAt
```

Risk:

- A DICH_VU appointment may have explicit paid-deposit evidence.
- If its visit is still `CREATED` and there is no billing yet, cancellation proceeds.
- Appointment and visit become `CANCELLED`, slot is released, but deposit evidence remains `PAID`.
- No refund or forfeit transition occurs.

Recommended Phase 3 fix:

- Detect direct appointment-deposit payment evidence before cancellation succeeds.
- Block with an explicit reason code until refund/forfeit policy is implemented.
- Do not implement refund logic in Phase 3.

The exact block condition should be decided explicitly. A conservative rule is to block when an appointment-deposit payment exists with successful payment evidence, and optionally block pending deposit payments to prevent slot/payment callback races.

### Medium: slot release is not ownership-aware and update result is ignored

Current release:

```ts
timeSlotLogModel.updateOne(
  { _id: freshAppointment.timeSlot },
  { $set: { status: 'available' } },
  { session },
);
```

Risk:

- The update does not assert the expected current state.
- The result is ignored.
- `TimeSlotLog` does not store an owning `appointmentId`, so the update cannot prove that the cancelling appointment still owns the slot.
- A concurrent booking or inconsistent record could be overwritten to `available`.

Recommended focused hardening:

- Use a conditional release filter such as `{ _id, status: 'booked' }`.
- Check the result and decide whether an already-available slot is an idempotent success or an integrity warning.
- Keep the write in the existing transaction.

### Medium: cancellation policy includes an undocumented 24-hour restriction

The service blocks cancellation when:

```ts
hoursUntilAppointment <= 24
```

This rule is not part of the provided Phase 3 requirements and is not documented in the main `PATCH /appointment/cancel` API contract.

Risk:

- FE may show cancellation as eligible based on visit state while BE rejects it.
- Product expectations may differ from runtime behavior.

Recommended action:

- Confirm whether the 24-hour restriction is intentional.
- If retained, document it and add tests.
- If removed, make that a deliberate product-policy change in the Phase 3 implementation PR.

### Medium: endpoint authorization is authentication-only

The endpoint uses `JwtAuthGuard`, but ignores `req.user`.

Risk:

- Any authenticated account that knows an appointment id may attempt to cancel it.

Recommended action:

- Define allowed actors: owning patient, receptionist, admin, or a subset.
- Pass normalized `AuthUser` into the service and enforce ownership/role policy.
- Keep this change scoped to cancel authorization.

### Low: request DTO is not validated

The controller body type is inline:

```ts
{ appointmentId: string; reason?: string }
```

Risk:

- Invalid ObjectIds may surface as Mongoose cast errors.
- Extra request fields are not described by DTO metadata.
- Reason length and type are not validated.

Recommended action:

- Add a dedicated cancellation DTO with `@IsMongoId()`, `@IsOptional()`, and bounded string validation.

### Low: outer reads can become stale under concurrent mutation

The service reads appointment scheduling metadata and builds the event payload before opening the transaction. It reloads the appointment in the transaction, but does not rebuild the payload or re-check the 24-hour rule from the fresh record.

Risk:

- Concurrent reschedule may cause a stale slot/date in notifications.
- The 24-hour decision may be based on the pre-reschedule schedule.

Recommended action:

- Build payload fields from the fresh appointment after commit or from values captured inside the transaction.
- If the 24-hour rule remains, re-evaluate it against the fresh appointment inside the transaction.

### Documentation: stale cancellation-refund statements remain

`api-contract/api.md` accurately states that appointment cancellation does not issue CreditWallet refunds.

Other contract documentation still contains broad statements such as:

- appointment cancellation refunds are credited to CreditWallet;
- FE should refresh `creditBalance` after cancel/shift-cancel;
- cancellation refund is credited to `creditBalance`.

These statements conflict with current appointment-cancel behavior and should be narrowed to shift cancellation or replaced with the explicit Phase 3 no-refund rule.

Per repository rules, any `api-contract/` edit must be committed and pushed immediately in the contract submodule.

## Current Unit-Test Coverage

Existing file: `src/appointment/appointment.service.cancel.spec.ts`

Current tests:

1. `Visit.CREATED` cancels appointment and visit, releases slot, returns zero refund, and emits socket event.
2. `Visit.CHECKED_IN` blocks with `VISIT_ALREADY_STARTED`.
3. Existing billing blocks with `BILLING_EXISTS`.

Validation executed during analysis:

```bash
npm run test -- --runInBand src/appointment/appointment.service.cancel.spec.ts
```

Result: 3 tests passed.

## Recommended Implementation Plan

Keep the implementation PR focused on appointment cancellation:

1. Add a validated cancellation DTO.
2. Define and enforce cancellation actor policy using `AuthUser`.
3. Add appointment-deposit payment detection linked by `appointmentId`.
4. Block explicit deposit-payment evidence with a dedicated reason code; do not refund, forfeit, or mutate deposit fields in this phase.
5. Harden slot release with an expected-status condition and result handling.
6. Confirm the 24-hour policy. Retain and document it, or remove it as an explicit policy decision.
7. Expand cancel-flow unit tests.
8. Update contradictory `api-contract/` cancellation documentation and push the submodule immediately.

## Suggested Test Cases

### Required Phase 3 behavior

1. `Visit.CREATED` -> success:
   - appointment becomes `CANCELLED`;
   - visit becomes `CANCELLED`;
   - slot becomes `available`;
   - no wallet-refund event emitted;
   - no financial field mutated.
2. `Visit.CHECKED_IN` -> `VISIT_ALREADY_STARTED`.
3. `Visit.IN_PROGRESS` -> `VISIT_ALREADY_STARTED`.
4. `Visit.COMPLETED` -> `VISIT_COMPLETED`.
5. `Visit.CANCELLED` -> blocked.
6. Missing visit -> `APPOINTMENT_NOT_CANCELABLE`.
7. Existing encounter -> `MEDICAL_ENCOUNTER_EXISTS`.
8. Existing billing without payment -> `BILLING_EXISTS`.
9. Existing billing payment -> `PAYMENT_EXISTS`.
10. Existing appointment-deposit payment evidence -> new explicit blocked reason.

### Slot-release hardening

11. Booked slot is released successfully.
12. Missing slot or unexpected slot status follows the chosen integrity policy.
13. Slot update result is checked.

### Policy and validation

14. Cancellation within 24 hours follows the confirmed policy.
15. Invalid appointment id returns a controlled validation error.
16. Unauthorized actor cannot cancel another patient's appointment.

### Side effects

17. Success emits notification, mail, and socket events exactly once after commit.
18. Blocked cancellation emits no notification, mail, socket, wallet, credit, or coin side effect.

## Final Assessment

The current cancel flow is close to Phase 3 but is not fully compliant. Its core visit-based transition and no-refund behavior are already correct. The primary implementation gap is direct appointment-deposit payment detection; the primary operational hardening gap is safe slot release.
