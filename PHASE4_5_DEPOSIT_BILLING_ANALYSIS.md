# Phase 4/5 Deposit and Billing Analysis

Date reviewed: 2026-05-31

Scope: read-only analysis of the current backend implementation. No source code or `api-contract/` files were modified.

## 1. Executive summary

Overall status: **partially compliant**.

The primary `POST /appointment/book` flow already implements most of Phase 4:

- `BHYT` normalizes `depositAmount=0`, stores `depositStatus=NOT_REQUIRED`, confirms immediately, emits `appointment.booking.success`, and creates `Visit(CREATED)` through the listener.
- `DICH_VU` requires `depositAmount > 0`, stores a pending appointment, creates a separate `Payment(purpose=APPOINTMENT_DEPOSIT, appointmentId=...)`, returns `paymentUrl`, and delays booking success / Visit creation until the signed VNPay success callback.
- Deposit success stores `depositPaidAmount`, `depositPaidAt`, and `depositPaymentId`, confirms the appointment, and emits booking success once under the intended callback path.
- Deposit failure and background expiry mark the appointment deposit failed and release `TimeSlotLog`.

Phase 4 is not fully compliant because alternate endpoints can bypass the evidence boundary:

- Public `PATCH /appointment/:id/confirm` directly changes `PENDING -> CONFIRMED` without checking DICH_VU deposit evidence.
- Receptionist `POST /receptionist/payment/mock` can change `PENDING|FAILED -> CONFIRMED` using legacy fields without setting verified deposit state or creating a Visit.
- VNPay callback processing verifies the signature but does not compare the signed callback amount with stored `Payment.amount`.

Phase 5 is implemented correctly in the main billing flow:

- Draft billing uses `depositPaidAmount` only when `depositStatus === PAID`.
- `depositAmount`, `amount`, and `paymentAmount` are not treated as deposit evidence.
- `BHYT` receives insurance coverage and normally uses `depositUsed=0`.
- `DICH_VU` receives `insuranceAmount=0`.

Phase 5 is still classified as partially compliant at system level because the callback amount validation gap can create false deposit evidence, and an unauthenticated generic billing-payment success endpoint can bypass VNPay verification.

## 2. Current implementation flow

### BHYT booking flow

1. `AppointmentController.bookAppointment()` reads patient identity from `req.user`.
2. `AppointmentBookingService.normalizeVisitWorkflowDefaults()` forces `depositAmount=0` for `BHYT`.
3. Booking creates `Appointment(PENDING)` with `depositStatus=NOT_REQUIRED` and marks `TimeSlotLog` booked inside a Mongo transaction.
4. `confirmBooking()` changes the appointment to `CONFIRMED`, emits `appointment.booking.success`, and releases the Redis booking lock.
5. `VisitBookingListener` creates one `Visit(CREATED)` per appointment.

### DICH_VU booking flow

1. Normalization defaults missing `paymentCategory` to `DICH_VU`.
2. Validation rejects missing or non-positive `depositAmount`.
3. Booking creates `Appointment(PENDING)` with `depositStatus=PENDING`, `depositPaidAmount=0`, and marks the slot booked.
4. `PaymentService.createDepositPaymentForAppointment()` creates one `Payment(APPOINTMENT_DEPOSIT/PENDING)` linked by `appointmentId`, stores `depositPaymentId`, and builds a VNPay URL using `paymentId` as `vnp_TxnRef`.
5. The response returns `PENDING`, `appointmentId`, `depositPaymentId`, and `paymentUrl`.
6. `appointment.booking.pending` is emitted. `appointment.booking.success` is not emitted yet, so no Visit is created.

### Deposit callback success flow

1. `GET /payment/vnpay_return` verifies the VNPay signature and response codes.
2. `PaymentService.handleVnpayPaymentResultByTxnRef()` resolves a direct `Payment` by txn ref and routes appointment deposits to `markDepositPaymentSuccess()`.
3. In a transaction, the payment becomes `SUCCESS`; the appointment receives `depositStatus=PAID`, `depositPaidAmount=payment.amount`, `depositPaidAt`, `depositPaymentId`, and `appointmentStatus=CONFIRMED`.
4. After commit, the service emits `appointment.booking.success` only when the appointment transitioned from `PENDING`.
5. `VisitService.createVisitFromAppointment()` is idempotent and the `Visit` schema has a unique `appointmentId` index.

### Deposit failure and expiry flow

- VNPay failure calls `markDepositPaymentFailed()`, which sets payment `FAILED`, appointment deposit `FAILED`, pending appointment `FAILED`, and `TimeSlotLog.status=available`.
- Booking-payment creation failure calls `AppointmentBookingService.failBooking()`, which also releases the Redis slot lock.
- `AppointmentBookingService.expirePendingBookings()` runs every minute and fails pending appointments older than `BOOKING_PENDING_TTL_SECONDS`.
- Callback failure releases the Mongo slot but does not explicitly release the Redis lock. Retry remains blocked until the aligned Redis TTL expires.
- Pending `Payment` records have a Mongo TTL index on `expireAt`, so Mongo may delete payment evidence near expiry instead of preserving a terminal `FAILED` record.

### Billing deposit usage flow

1. Doctor completion emits `domain.visit.completed`.
2. `BillingListener` creates an idempotent billing draft.
3. `BillingService.createDraftBilling()` resolves the appointment and calculates:

```ts
depositUsed =
  appointment.depositStatus === 'PAID'
    ? appointment.depositPaidAmount
    : 0;
```

4. Insurance is applied only for `BHYT`; `DICH_VU` receives zero insurance.
5. Finalization recomputes medication fee, total, insurance, and final payable from the stored draft snapshot.

## 3. Files and functions involved

| File | Function/class | Responsibility | Notes |
|---|---|---|---|
| `src/appointment/appointment.controller.ts` | `bookAppointment()` | Protected booking endpoint | Uses JWT patient identity |
| `src/appointment/appointment.controller.ts` | `confirmAppointment()` | Manual confirmation endpoint | Public and bypasses deposit checks |
| `src/appointment/dto/appointment-booking.dto.ts` | `AppointmentBookingRequestDto` | Booking validation | Supports `paymentCategory` and `depositAmount` |
| `src/appointment/schemas/appointment.schema.ts` | `Appointment` | Deposit evidence fields | Contains required Phase 4 fields |
| `src/appointment/appointment-booking.service.ts` | `bookAppointment()` | Main booking orchestration | Correct BHYT/DICH_VU branch |
| `src/appointment/appointment-booking.service.ts` | `confirmBooking()` | BHYT confirmation path | Emits booking success |
| `src/appointment/appointment-booking.service.ts` | `failBooking()` / `expirePendingBookings()` | Failure and timeout cleanup | Releases slot; timer uses VNPay TTL |
| `src/payment/schemas/payment.schema.ts` | `Payment` | Billing and deposit payments | Implements Option A with `purpose` |
| `src/payment/payment.service.ts` | `createDepositPaymentForAppointment()` | Deposit record and URL creation | Uses `appointmentId`, not `billingId` |
| `src/payment/payment.service.ts` | `markDepositPaymentSuccess()` | Verified callback transition | Missing callback amount comparison |
| `src/payment/payment.service.ts` | `markDepositPaymentFailed()` | Failure transition | Does not release Redis lock |
| `src/payment/vnpay/vnpay-payment.controller.ts` | `vnpayReturn()` | Public signed callback endpoint | Parses callback amount but does not forward it |
| `src/visit/listenners/visit-booking.listenner.ts` | `handleAppointmentBookingSuccess()` | Visit creation trigger | Correctly tied to booking success |
| `src/visit/visit.service.ts` | `createVisitFromAppointment()` | Idempotent Visit creation | Unique index prevents duplicates |
| `src/billing/billing.listener.ts` | `handleVisitCompleted()` | Draft creation trigger | Runs after visit completion |
| `src/billing/billing.service.ts` | `createDraftBilling()` | Safe deposit deduction | Correct Phase 5 rule |
| `src/billing/billing.service.ts` | `finalizeBilling()` | Recompute final payable | Correct BHYT/DICH_VU insurance split |
| `src/receptionist/receptionist.service.ts` | `mockPayment()` | Temporary legacy simulation | Can create inconsistent confirmation state |
| `src/payment/payment.controller.ts` | `paymentSuccess()` | Generic manual payment success | Public billing-payment bypass |

## 4. Compliance matrix

| Requirement | Status | Evidence from code | Notes |
|---|---|---|---|
| Appointment stores explicit deposit fields | Compliant | `appointment.schema.ts:48-63` | All requested fields exist |
| BHYT normalizes deposit to zero | Compliant | `appointment-booking.service.ts:819-822` | Stored as `NOT_REQUIRED` |
| BHYT confirms immediately | Compliant | `appointment-booking.service.ts:225-233` | Emits success and creates Visit |
| DICH_VU requires positive deposit | Compliant | `appointment-booking.service.ts:803-805` | Defaults category to DICH_VU before validation |
| DICH_VU remains pending before payment | Compliant in main flow | `appointment-booking.service.ts:175-208` | Bypass endpoints remain |
| Deposit uses separate payment purpose | Compliant | `payment-flow.enum.ts:12-15`, `payment.schema.ts:14-18` | Option A implemented |
| Deposit payment uses `appointmentId`; billing uses `billingId` | Compliant in service paths | `payment.service.ts:72-90`, `144-176` | Schema does not conditionally require the matching reference |
| Deposit success stores actual evidence | Partially compliant | `payment.service.ts:432-440` | Stores backend `payment.amount`, but callback amount is not compared |
| Success delays booking success until paid | Compliant in main flow | `payment.service.ts:458-461` | Manual confirm bypasses this rule |
| Visit is created exactly once after success | Compliant in intended path | `visit.service.ts:280-318`, `visit.schema.ts:11-32` | Unique index and duplicate handling exist |
| Failure marks deposit and appointment failed | Compliant | `payment.service.ts:500-511` | Pending appointment becomes failed |
| Expiry marks appointment failed | Compliant | `appointment-booking.service.ts:688-703` | Runs every minute |
| Failure releases slot safely | Partially compliant | `payment.service.ts:513-519` | Mongo slot released; Redis lock waits for TTL |
| TTL derives from VNPay window | Compliant | `vnpay-timeout.config.ts:16-21` | Shared default 15 minutes |
| Billing subtracts only verified deposit | Compliant | `billing.service.ts:140-147` | Uses `depositPaidAmount` only for `PAID` |
| Billing ignores legacy amount as evidence | Compliant | `billing.service.ts:140-147` | No legacy paid evidence |
| BHYT uses insurance and zero deposit | Compliant in main flow | `billing.service.ts:135-147` | Deposit remains zero from booking |
| DICH_VU insurance is zero | Compliant | `billing.service.ts:135-138`, `328-330` | Correct in draft and finalize |
| FE contract distinguishes deposit fields | Mostly compliant | `api-contract/api.md:880-884` | Current `api.md` is clear |
| FE has a supported deposit polling contract | Not compliant | `api-contract/api.md:1705-1709` | Old status endpoints are deprecated; no replacement deposit-status polling endpoint is documented |

## 5. Gap analysis

| Severity | Description | Risk | Recommended fix |
|---|---|---|---|
| High | Public `PATCH /appointment/:id/confirm` bypasses deposit evidence and directly confirms any pending appointment. | A DICH_VU appointment can become confirmed without payment. It also does not emit booking success, leaving appointment and Visit state inconsistent. | Remove the endpoint or guard it with staff authorization and enforce `BHYT` or verified `depositStatus=PAID`. Prefer routing confirmation through one invariant-preserving service method. |
| High | VNPay success callback does not compare signed callback `amount` against stored `Payment.amount`. | A valid lower-amount callback for the same txn ref can confirm a higher deposit and billing later subtracts the stored higher amount. | Pass parsed VNPay amount into payment transition metadata and reject mismatches before marking success. Add the same protection for billing QR payment callbacks. |
| High | Public `POST /payments/:paymentId/success` marks billing payments successful without JWT, role guard, or VNPay proof. | Anyone who obtains a billing payment id can bypass billing payment verification. | Remove from production routing or protect it as an explicit internal/test-only endpoint. Cash payment already has a receptionist-guarded route. |
| Medium | Receptionist `POST /receptionist/payment/mock` mutates pending or failed appointments to confirmed using legacy fields. | Staff can create `CONFIRMED` DICH_VU appointments with failed/pending deposits and no Visit. | Disable outside tests/local development or rewrite it to exercise the real deposit transition invariants. |
| Medium | Deposit callback failure releases `TimeSlotLog` but not the Redis lock. | Failed-payment retry can remain blocked until TTL expiry despite the database slot being available. | Release the Redis slot lock after committed deposit failure using appointment doctor/slot and lock value, with TTL fallback retained. |
| Medium | `Payment.expireAt` TTL deletes pending payment documents. | Expired payment evidence may disappear before or after appointment cleanup, reducing auditability and making late callbacks harder to diagnose. | Preserve terminal payment records: use an application expiry transition to `FAILED`, clear `expireAt`, and reserve TTL deletion for a later retention window if desired. |
| Medium | No supported HTTP polling endpoint is documented for appointment deposit status. | FE cannot reliably recover after popup close, missed socket event, reconnect, or app resume. | Add a protected appointment deposit status endpoint returning `appointmentId`, `depositStatus`, `depositPaidAmount`, `depositPaidAt`, and payment status. Document polling until terminal state. |
| Low | Payment schema does not enforce conditional reference invariants. | Future callers could persist `BILLING` without `billingId` or `APPOINTMENT_DEPOSIT` without `appointmentId`. | Add schema validation for purpose/reference pairing while retaining service checks and indexes. |
| Low | Legacy appointment saga files remain in the repository but are not registered in `OrchestrationModule`. | Future accidental registration could reintroduce older confirmation behavior. | Delete or clearly archive deprecated saga files after confirming they are unused. |

## 6. Suggested implementation plan

1. Close confirmation bypasses: remove or harden manual appointment confirmation, disable or align mock payment, and remove/protect generic public payment success.
2. Harden VNPay callbacks: forward callback amount and reject amount mismatch for both appointment deposit and billing payments.
3. Make failure cleanup consistent: release both Mongo slot state and Redis lock after failed deposit callbacks.
4. Preserve payment audit history on expiry: mark expired deposit payments failed before retention cleanup.
5. Add a protected deposit-status polling endpoint and update FE integration docs.
6. Add conditional Payment schema validation and remove or archive unused legacy saga code.

## 7. Suggested tests

Existing focused coverage:

- `src/appointment/appointment-booking.service.deposit.spec.ts`
  - DICH_VU stays pending and returns payment URL.
  - BHYT confirms immediately with `NOT_REQUIRED`.
  - DICH_VU without positive deposit is rejected.
- `src/billing/billing.service.deposit.spec.ts`
  - Paid deposit uses `depositPaidAmount`.
  - Pending deposit does not use `depositAmount`.
- `src/appointment/appointment.service.cancel.spec.ts`
  - Refund logic uses verified DICH_VU deposit evidence.

Tests to add:

1. Deposit callback success stores `PAID`, paid amount, paid timestamp, payment id, and confirms once.
2. Duplicate successful callback emits `appointment.booking.success` once and produces one Visit.
3. Deposit callback with mismatched signed amount is rejected.
4. Billing callback with mismatched signed amount is rejected.
5. Deposit callback failure marks payment/appointment failed, releases `TimeSlotLog`, releases Redis lock, and creates no Visit.
6. Background expiry marks appointment and payment failed, releases slot/lock, and preserves payment audit record.
7. Manual confirm endpoint cannot confirm unpaid DICH_VU.
8. Mock payment endpoint is unavailable in production or preserves deposit/Visit invariants.
9. Public generic billing-payment success endpoint is unavailable.
10. BHYT billing applies insurance and keeps `depositUsed=0`.
11. DICH_VU billing sets `insuranceAmount=0`.
12. Deposit status polling returns pending, paid, failed, and expired terminal states.

## 8. API contract and documentation gaps

Current contract strengths:

- `api-contract/api.md:854-1004` accurately documents the new BHYT/DICH_VU booking split, deposit evidence fields, pending response, callback timing, and billing rule.
- `api-contract/BOOK_APPOINTMENT_REFACTOR_SUMMARY.md:6-35` documents the deposit evidence migration.

Gaps and stale docs:

- `docs/CURRENT_APPOINTMENT_VISIT_BILLING_FLOW.md` starts with an updated summary, but many later sections still claim no appointment deposit transaction exists and billing deducts raw `depositAmount` (`lines 268-283`, `583-588`, `820-897`). These sections contradict current code.
- `api-contract/README_APPOINTMENT_BOOKING_CURRENT_FLOW.md` is explicitly marked historical, but still contains old payment flow details. Its warning helps, yet the stale body remains easy to misuse.
- `api-contract/api.md` does not provide a supported deposit polling endpoint after deprecating `GET /payment/:orderId` and `GET /payments/:orderId`.
- FE guidance should explicitly say: open the returned VNPay `paymentUrl` for DICH_VU, do not show confirmed while `depositStatus=PENDING`, poll a supported deposit-status endpoint as fallback, and show confirmed only after `depositStatus=PAID` / appointment `CONFIRMED`.
- Contract docs should state that callback success rejects amount mismatches once implemented.

## 9. Validation performed

Commands run:

```bash
npm test -- --runInBand
npm run build
```

Results:

- Jest: 6 suites passed, 53 tests passed.
- Nest build: passed.
- No runtime server was started and no external API calls were executed because the task requested analysis only.

