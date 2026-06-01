# Current Appointment -> Visit -> Billing -> Payment Flow

Date reviewed: 2026-05-25

This document describes the current backend behavior verified from code. It intentionally separates current behavior from older intended design notes because parts of `api-contract/` and older README files still describe the previous appointment-based payment flow.

Update after DICH_VU deposit implementation:

- `BHYT` booking confirms immediately with `depositStatus=NOT_REQUIRED`.
- `DICH_VU` booking now requires `depositAmount > 0`, creates `Payment(purpose=APPOINTMENT_DEPOSIT)`, returns a VNPay `paymentUrl`, and stays `PENDING` until deposit payment succeeds.
- `Visit(CREATED)` is created only after appointment confirmation.
- Billing uses `depositPaidAmount` only when `depositStatus=PAID`; `depositAmount` alone is not payment evidence.

## 1. High-level lifecycle summary

Current happy path:

```text
Patient POST /appointment/book
-> Appointment(PENDING) created and TimeSlotLog(booked)
-> BHYT: Appointment(CONFIRMED)
-> DICH_VU: Payment(APPOINTMENT_DEPOSIT/PENDING) + VNPay URL
-> DICH_VU deposit success: Appointment(CONFIRMED), depositStatus(PAID)
-> appointment.booking.success emitted
-> Visit(CREATED) created
-> Receptionist PATCH /receptionist/visits/:visitId/check-in
-> Visit(CHECKED_IN)
-> Doctor PATCH /doctor/visits/:visitId/start
-> Visit(IN_PROGRESS)
-> Doctor POST /doctor/visits/:visitId/complete
-> MedicalEncounter saved
-> Appointment(COMPLETED), Visit(COMPLETED), TimeSlotLog(completed)
-> domain.visit.completed emitted
-> Billing(DRAFT) created
-> Receptionist POST /receptionist/billings/:billingId/finalize
-> Billing(FINALIZED), Payment(PENDING) created
-> QR VNPay callback or cashier mark-paid
-> Payment(SUCCESS), Billing(PAID)
```

Verified status enums:

- Appointment: `PENDING`, `CONFIRMED`, `FAILED`, `CANCELLED`, `COMPLETED`, `RESCHEDULED` in `src/appointment/enums/Appointment-status.enum.ts`.
- Visit: `CREATED`, `CHECKED_IN`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED` in `src/visit/enums/visit-status.enum.ts`.
- Billing: `DRAFT`, `FINALIZED`, `PAID` in `src/billing/billing.schema.ts`.
- Payment: `PENDING`, `SUCCESS` in `src/payment/enums/payment-flow.enum.ts`.

## 2. Stage-by-stage details

### Stage 1: Patient submits booking request

Endpoint: `POST /appointment/book`

Auth: `JwtAuthGuard`; patient identity is derived from `req.user`.

Controller/function:

- `AppointmentController.bookAppointment()` in `src/appointment/appointment.controller.ts`
- `AppointmentBookingService.bookAppointment()` in `src/appointment/appointment-booking.service.ts`

DTO:

- `AppointmentBookingRequestDto` in `src/appointment/dto/appointment-booking.dto.ts`
- Controller enriches it into `AppointmentBookingDto` with `patientEmail` and `patientId`.

Accepted request fields:

```ts
{
  hospitalName: string;
  appointmentDate: string;
  bookingDate?: string;
  date?: string;
  specialty?: string;
  timeSlotId: string;
  doctor?: { id: string; name: string; email: string } | null;
  serviceType: 'KHAM_BHYT' | 'KHAM_DICH_VU' | 'KHAM_ONLINE';
  paymentMethod: 'VNPAY' | 'ONLINE' | 'CREDIT' | 'COIN' | 'OFFLINE' | 'CASH';
  visitType?: 'OFFLINE';
  paymentCategory?: 'BHYT' | 'DICH_VU';
  depositAmount?: number;
  amount?: number;
  reasonForAppointment?: string;
  coinsToUse?: number;
  useCoin?: boolean;
}
```

Validation:

- `appointmentDate` is required and must be ISO 8601 with timezone via `IsIsoWithTimezone`.
- `bookingDate` and deprecated `date` are optional but must also include timezone if provided.
- `timeSlotId` must be a MongoId.
- `serviceType`, `paymentMethod`, `visitType`, and `paymentCategory` are enum validated.
- `depositAmount` must be a number >= 0 if provided.
- `doctor` is optional in DTO, but service requires `doctor.id`.
- Service rejects `paymentMethod=COIN` as a standalone payment method.
- Service requires `amount > 0` for `ONLINE`, `VNPAY`, or `CREDIT`.

Date/time handling:

- `appointmentDate` is parsed through `TimeHelper.parseISOToUTC()`.
- `bookingDate` is parsed through the same helper if present; otherwise the server uses `Date.now()`.
- Service has a fallback from `appointmentDate` to deprecated `date`, but the HTTP DTO currently marks `appointmentDate` required, so normal HTTP clients should still send `appointmentDate`.
- Times are persisted as UTC epoch milliseconds.

Response shape:

```json
{
  "code": "SUCCESS | ERROR | NOT_FOUND",
  "message": "string",
  "data": {
    "appointmentId": "string",
    "originalAmount": 100000,
    "discountAmount": 10000,
    "finalAmount": 90000
  }
}
```

Business meaning:

- The patient requests a scheduled medical visit.
- This is not the medical examination itself.
- Booking may carry billing metadata, but booking does not currently prove money was collected.

Known stale docs:

- Older docs describe `ONLINE/VNPAY` booking as pending until payment callback. Current main path confirms booking immediately and defers payment to billing.
- Older docs describe `CREDIT` as deducted during booking. Current main path does not deduct credit at booking time.

### Stage 2: Slot lock and availability check

Files/functions:

- `AppointmentBookingService.getSlotKey()`
- `AppointmentBookingService.checkSlotAvailability()`
- `AppointmentBookingService.createAppointmentWithTransaction()`
- `AppointmentSchema.index(...)`

Redis lock:

```text
slot:{doctorId}:{timeSlotId}
```

The lock uses `BOOKING_PENDING_TTL_SECONDS`, derived from the VNPay expiry config even though booking payment is now deferred.

DB pre-check:

```ts
{
  doctorId,
  timeSlot,
  appointmentStatus: { $in: [PENDING, CONFIRMED] },
  $or: [
    { scheduledAt: scheduledAtEpoch },
    { date: scheduledAtEpoch },
    { date: appointmentDateEpoch },
  ],
}
```

Note: the helper parameter is named `bookingDateEpoch`, but current callers pass the parsed appointment date epoch. This is a naming mismatch in code, not a real booking-date conflict check.

Unique index:

```ts
{ doctorId: 1, date: 1, timeSlot: 1 }
partialFilterExpression: appointmentStatus in [PENDING, CONFIRMED]
```

Current behavior:

- If Redis lock cannot be acquired, returns `{ code: ERROR, message: "Slot already booked", data: null }`.
- If DB pre-check fails, releases Redis lock and returns `Slot already booked`.
- If duplicate key `11000` occurs during insert, maps to `Slot already booked`.

Business meaning:

- Redis reduces concurrent request contention.
- MongoDB uniqueness and transactional insert remain the final correctness gate.

Risk:

- Unique index still uses legacy `date`, not `scheduledAt`. New writes set `date = scheduledAt`, so current behavior is aligned for new appointments, but this remains a migration artifact.

### Stage 3: Appointment creation

Responsible function:

- `AppointmentBookingService.createAppointmentWithTransaction()`

Mongo transaction:

- Creates `Appointment(PENDING)`.
- Marks `TimeSlotLog.status = "booked"`.
- Re-checks slot availability inside the transaction.

Initial appointment status:

```text
PENDING
```

Field mapping:

| Field | DTO name | Stored field | Persisted? | Meaning | Notes/Risk |
|---|---|---|---:|---|---|
| Hospital | `hospitalName` | `hospitalName` | Yes | Hospital selected/displayed for appointment | Required by service |
| Scheduled visit time | `appointmentDate` | `date`, `scheduledAt`, `startTime`, `endTime` | Yes | Medical visit schedule in UTC epoch ms | `date` is deprecated compatibility field |
| Booking timestamp | `bookingDate` | `bookingDate` | Yes | Request creation time | Defaults to server time |
| Legacy schedule alias | `date` | Used only as fallback input | Indirect | Deprecated alias for `appointmentDate` | HTTP DTO still requires `appointmentDate` |
| Specialty | `specialty` | `specialtyId` | Yes | Specialty reference | Name mismatch |
| Slot | `timeSlotId` | `timeSlot` | Yes | Chosen TimeSlotLog | Also sets slot `booked` |
| Doctor id | `doctor.id` | `doctorId` | Yes | Doctor identity | Nested DTO only validates string |
| Doctor name | `doctor.name` | none | No | Client display snapshot | Dropped |
| Doctor email | `doctor.email` | none | No | Client display snapshot | Dropped |
| Service type | `serviceType` | `serviceType` | Yes | Appointment service category | Separate from billing `paymentCategory` |
| Payment method | `paymentMethod` | `paymentMethod` | Yes | Legacy payment route metadata | No real booking payment now |
| Visit type | `visitType` | none | No | Current rollout defaults to OFFLINE | Accepted but dropped |
| Payment category | `paymentCategory` | `paymentCategory` | Yes | Billing category: BHYT or DICH_VU | Used later by billing |
| Deposit | `depositAmount` | `depositAmount` | Yes | Intended/pre-recorded deposit | Not proof of collection |
| Amount | `amount` | `consultationFee`, derived `paymentAmount` | Yes | Requested original amount | Not proof of collection |
| Reason | `reasonForAppointment` | `reasonForAppointment` | Yes | Patient reason | Optional |
| Coin request | `coinsToUse` | none | No direct field | Requested discount cap | Can affect `coinDiscountAmount` |
| Use coin | `useCoin` | none | No direct field | Enables coin discount | Can trigger coin spend |

Dropped fields:

- `visitType`
- `doctor.name`
- `doctor.email`
- `amount` by name
- `appointmentDate` by name
- `timeSlotId` by name
- `coinsToUse` and `useCoin` by name

Transformed fields:

- `appointmentDate` -> `scheduledAt`, `date`, `startTime`, `endTime`
- `bookingDate` -> epoch milliseconds
- `timeSlotId` -> `timeSlot`
- `specialty` -> `specialtyId`
- `amount` -> `consultationFee`
- calculated final amount -> `paymentAmount`
- calculated coin discount -> `coinDiscountAmount`

### Stage 4: Booking amount, coin, and payment handling

Files/functions:

- `AppointmentBookingService.calculateBookingAmounts()`
- `AppointmentBookingService.confirmBooking()`
- `AppointmentBookingService.handleOnlinePayment()`
- `AppointmentBookingService.handleCreditPayment()`
- `CoinService.calculateDiscount()`
- `CoinService.spendCoins()`

Current amount behavior:

- `originalAmount = floor(max(amount, 0))`.
- If `useCoin=true`, discount is calculated with current policy: 10% cap, max 30,000, bounded by available coin and optional `coinsToUse`.
- `finalAmount = originalAmount - discountAmount`.
- Appointment stores `consultationFee = originalAmount`, `coinDiscountAmount = discountAmount`, and `paymentAmount = finalAmount`.

Current payment behavior:

- `paymentMethod=COIN` is rejected.
- If `discountAmount > 0`, coins are actually spent during booking.
- If `finalAmount === 0`, appointment is confirmed and `paidAt` may be set through zero-payment metadata.
- If `finalAmount > 0`, inline booking payment is deliberately suppressed. The code logs a deprecation warning and confirms the appointment with message `Booking confirmed (payment deferred - use billing flow)`.
- `handleOnlinePayment()` and `handleCreditPayment()` now throw `Payment after booking is deprecated. Use billing flow.` They are not used in the current main booking branch.
- Booking does not create an appointment-based `Payment` record.
- Credit wallet is not deducted at booking time.
- `depositAmount` is stored, but no booking deposit payment transaction is created.

Business meaning:

- `amount`, `paymentAmount`, and `depositAmount` are booking/billing metadata in the current main flow.
- They are not reliable proof that money was collected.
- Actual payment now belongs to finalized billing.

Known risk:

- Coins are still spent at booking time, but billing later has a separate `coinUsed` flow. Booking `coinDiscountAmount` is not currently consumed by billing.

### Stage 5: Appointment confirmed and Visit created

Files/functions:

- `AppointmentBookingService.confirmBooking()`
- `AppointmentBookingService.buildBookingPayload()`
- `BookingListener.handleBookingCompleted()`
- `VisitBookingListener.handleAppointmentBookingSuccess()`
- `VisitService.createVisitFromAppointment()`

When confirmation happens:

- Current main path confirms immediately after appointment creation and any booking coin spend.
- Appointment moves `PENDING -> CONFIRMED`.
- Redis slot lock is released; `TimeSlotLog` remains `booked`.

Events emitted:

- `appointment.booking.success`

Downstream events from `BookingListener`:

- `notify.patient.booking.success`
- `notify.doctor.booking.success`
- `mail.patient.booking.success`
- `mail.doctor.booking.success`
- `socket.appointment.success`
- `doctor.update-schedule`

Visit creation:

- `VisitBookingListener` listens to `appointment.booking.success`.
- `VisitService.createVisitFromAppointment()` re-reads the appointment from MongoDB.
- Creates one `Visit` per appointment using unique `appointmentId`.
- Initial visit status is `CREATED`.

Fields copied into Visit:

- `appointmentId`
- `doctorId`
- `patientId`
- `status = CREATED`

Fields not copied into Visit:

- `paymentCategory`
- `depositAmount`
- `paymentAmount`
- `consultationFee`
- `coinDiscountAmount`
- `paymentMethod`
- `visitType`
- schedule fields

Business meaning:

- Appointment is the scheduled booking.
- Visit is the operational medical visit instance.
- `Visit(CREATED)` means the visit exists but has not started.

### Stage 6: Receptionist check-in

Endpoint:

- `PATCH /receptionist/visits/:visitId/check-in`

Auth:

- `JwtAuthGuard`, `RoleGuard`, role `RECEPTIONIST`

Files/functions:

- `VisitReceptionistController.checkIn()`
- `VisitService.checkInVisit()`

Request body:

```json
{}
```

Required state:

- Visit must exist.
- Visit status must be `CREATED`.
- Linked appointment must exist.
- Appointment status must be `CONFIRMED`.

State updates:

- `Visit.status = CHECKED_IN`
- Appointment is not changed.

Response:

```json
{
  "code": "SUCCESS",
  "message": "Visit checked in successfully",
  "data": {
    "visitId": "string",
    "status": "CHECKED_IN"
  }
}
```

Failure cases:

- Visit missing -> `NotFoundException`
- Visit not `CREATED` -> `ConflictException`
- Appointment missing -> `NotFoundException`
- Appointment not `CONFIRMED` -> `BadRequestException`

Business meaning:

- Patient has arrived.
- The appointment is now entering the operational visit workflow.
- Cancel/reschedule should be restricted after this point.

### Stage 7: Doctor starts visit

Endpoint:

- `PATCH /doctor/visits/:visitId/start`

Auth:

- `JwtAuthGuard`, `RoleGuard`, role `DOCTOR`

Files/functions:

- `DoctorVisitsController.startVisit()`
- `VisitService.updateVisitStatus()`
- `VisitService.assertStatusTransitionValid()`

Required state:

- Doctor identity must exist in JWT.
- Visit must exist and belong to the doctor.
- Visit must be `CHECKED_IN`.
- Linked appointment must be `CONFIRMED` for check-in transitions; start transition validates `CHECKED_IN -> IN_PROGRESS`.

State updates:

- `Visit.status = IN_PROGRESS`
- `Visit.startedAt = Date.now()`
- Appointment is not changed.

Response:

```json
{
  "code": "SUCCESS",
  "message": "Visit started",
  "data": {
    "visitId": "string",
    "status": "IN_PROGRESS"
  }
}
```

Failure cases:

- Missing doctor identity -> `BadRequestException`
- Visit not found -> `NotFoundException`
- Doctor does not own visit -> `ForbiddenException`
- Already completed -> `ConflictException`
- Invalid transition -> `BadRequestException`

Business meaning:

- Clinical work begins.

### Stage 8: Doctor completes visit

Endpoints:

- Primary: `POST /doctor/visits/:visitId/complete`
- Compatibility wrapper: `PATCH /appointment/complete`

Auth:

- `POST /doctor/visits/:visitId/complete` requires doctor JWT and role `DOCTOR`.
- `PATCH /appointment/complete` currently has no guard in `AppointmentController`.

DTO:

- `CompleteVisitDto` in `src/visit/dto/complete-visit.dto.ts`

Request body:

```ts
{
  diagnosis: string;
  note?: string;
  prescriptions: Array<{
    medicineId?: string;
    name: string;
    quantity: number;
    note?: string;
  }>;
}
```

Files/functions:

- `DoctorVisitsController.completeVisit()`
- `AppointmentController.completeAppointment()`
- `AppointmentService.completeAppointment()`
- `VisitService.completeVisit()`
- `VisitService.completeVisitByAppointmentId()`
- `MedicalEncounterService.createVisitEncounter()`

Required state:

- Visit must be `IN_PROGRESS`.
- Doctor must own visit for the doctor endpoint.
- Appointment must exist and have `doctorId`, `patientId`, and optional `timeSlot`.

Mongo transaction:

- Creates `MedicalEncounter`.
- Sets `TimeSlotLog.status = "completed"` if appointment has a slot.
- Sets `Appointment.appointmentStatus = COMPLETED`.
- Sets `Visit.status = COMPLETED`.
- Sets `Visit.completedAt = Date.now()`.

Prescription handling:

- `MedicalEncounterService.mapPrescriptions()` maps doctor input.
- If `medicineId` exists, current medicine `unitPrice` is snapped into `unitPriceSnapshot`.
- `prescribedQty` is normalized from `quantity`, defaulting to 1 if invalid.
- `estimatedLineTotal = prescribedQty * unitPriceSnapshot`.

Event emitted after transaction:

- `domain.visit.completed`

Response:

```json
{
  "code": "SUCCESS",
  "message": "Visit completed",
  "data": {
    "visitId": "string",
    "encounterId": "string"
  }
}
```

Business meaning:

- Clinical encounter is finalized.
- This is the boundary that triggers draft billing creation.

### Stage 9: Draft billing creation

Trigger:

- `BillingListener.handleVisitCompleted()` listens for `domain.visit.completed`.

Files/functions:

- `BillingListener.handleVisitCompleted()`
- `BillingService.createDraftBilling()`
- Also available through `ReceptionistService.getBillingByVisitId()`, which calls `createDraftBilling(visitId)` idempotently.

Billing resolution:

- If billing already exists for `visitId`, returns existing billing.
- Resolves appointment through `MedicalEncounter.appointmentId` first, then through `Visit.appointmentId`.

Consultation fee:

- Uses `CONSULTATION_FEE` env config if finite.
- Falls back to `appointment.consultationFee`.
- Falls back to 0.

Medication population:

- Reads `MedicalEncounter.prescriptions`.
- Defaults `dispensedQty = prescribedQty`.
- Defaults `source = CLINIC`.
- Uses `unitPriceSnapshot` from encounter.
- `lineTotal = prescribedQty * unitPriceSnapshot`.
- `medicationFee = sum(lineTotal)`.

Insurance/category:

- Reads `appointment.paymentCategory`.
- If `BHYT`, `insuranceAmount = totalAmount * INSURANCE_COVERAGE_RATE`.
- If `DICH_VU`, `insuranceAmount = 0`.

Deposit:

- Reads `appointment.depositAmount`.
- Stores it as `Billing.depositUsed`.
- This is consumed as a deduction from payable.
- Current code does not prove the deposit was actually collected.

Not used by billing draft:

- `appointment.paymentAmount`
- `appointment.coinDiscountAmount`
- `appointment.paidAt`
- `appointment.paymentResponseCode`
- `appointment.paymentTransactionStatus`

Created billing:

```ts
{
  visitId,
  consultationFee,
  medicationFee,
  totalAmount,
  insuranceAmount,
  depositUsed,
  creditUsed: 0,
  coinUsed: 0,
  finalPayable,
  paymentCategory,
  medications,
  status: DRAFT,
}
```

Business meaning:

- Draft billing is the first financial snapshot for the completed visit.
- It is editable by receptionist before finalization.

### Stage 10: Receptionist finalizes billing

Endpoint:

- `POST /receptionist/billings/:billingId/finalize`

Auth:

- `JwtAuthGuard`, `RoleGuard`, role `RECEPTIONIST`

Files/functions:

- `ReceptionistController.finalizeBilling()`
- `ReceptionistService.finalizeBilling()`
- `BillingService.finalizeBilling()`
- `PaymentService.createPaymentForBilling()`

DTO:

- `FinalizeBillingDto` in `src/receptionist/dto/finalize-billing.dto.ts`

Request body:

```ts
{
  medications: Array<{
    medicineId?: string;
    dispensedQty: number;
    source: 'CLINIC' | 'OUTSIDE_PURCHASE';
  }>;
}
```

Current behavior:

- Billing must be `DRAFT` or `FINALIZED`.
- If `DRAFT`, optional fulfillment input is applied to billing medications.
- `dispensedQty` is floored to non-negative.
- If `source = OUTSIDE_PURCHASE` or `dispensedQty = 0`, `lineTotal = 0`.
- Otherwise `lineTotal = dispensedQty * unitPrice`.
- `medicationFee`, `totalAmount`, `insuranceAmount`, and `finalPayable` are recomputed.
- Billing moves to `FINALIZED`.
- `PaymentService.createPaymentForBilling()` creates or returns the active billing payment.

Payment creation:

- Payment is created with `billingId`, `amount = billing.finalPayable`, `method = QR` by default, `status = PENDING`, `idempotencyKey = PAYMENT:{billingId}:ACTIVE`, and `expireAt`.
- Payment has a unique `billingId` index.

Response:

```json
{
  "code": "SUCCESS",
  "message": "Billing finalized",
  "data": {
    "billingId": "string",
    "status": "FINALIZED",
    "paymentId": "string",
    "paymentStatus": "PENDING",
    "amount": 85000,
    "method": "QR"
  }
}
```

Business meaning:

- Receptionist confirms the actual financial fulfillment.
- Billing becomes the source of payment truth.

### Stage 11: Payment success

Current payment endpoints:

- `GET /receptionist/payments/:billingId/qr`
- `POST /receptionist/payments/:paymentId/mark-paid`
- `GET /payment/vnpay_return`
- `POST /payments/:paymentId/success`

Deprecated appointment-payment endpoints:

- `GET /payment/create_payment_url` throws `Payment after booking is deprecated. Use billing flow.`
- `GET /payment/:orderId` throws the same error.
- `GET /payments/:orderId` throws the same error in `VnPayPaymentController`.

Files/functions:

- `ReceptionistController.getQrPayment()`
- `ReceptionistController.markCashPaid()`
- `VnPayPaymentController.vnpayReturn()`
- `PaymentController.paymentSuccess()`
- `PaymentService.getQrPaymentByBillingId()`
- `PaymentService.createPaymentUrlForBilling()`
- `PaymentService.markPaymentSuccessByBillingId()`
- `PaymentService.markPaymentSuccess()`

Payment schema relation:

- `Payment.billingId` is required and unique.
- There is no appointmentId field in the current `Payment` schema.

QR/VNPay behavior:

- QR URL generation uses `billingId` as canonical VNPay transaction reference.
- VNPay callback resolves by `billingId`.
- On successful callback, `PaymentService.markPaymentSuccessByBillingId()` is called.

Cash behavior:

- `POST /receptionist/payments/:paymentId/mark-paid` marks the existing payment as success with channel `CASH`.

Payment success transaction:

- Validates payment exists and is not expired.
- Billing must be `FINALIZED` or `PAID`.
- If already completed, it remains idempotent and returns success.
- Deducts `billing.creditUsed` from CreditWallet only at payment success.
- Deducts `billing.coinUsed` from CoinWallet only at payment success.
- Rewards coin based on `billing.finalPayable`.
- Sets `Payment.status = SUCCESS`.
- Clears `Payment.expireAt`.
- Sets `Payment.paidAt`.
- Sets `Billing.status = PAID`.

Events emitted:

- `domain.payment.success`
- `payment.update` with `{ orderId: appointmentId, status: 'COMPLETED' }` if the visit has an appointmentId.

Final successful state:

```text
Appointment(COMPLETED)
Visit(COMPLETED)
MedicalEncounter exists
Billing(PAID)
Payment(SUCCESS)
```

Business meaning:

- Actual patient payment belongs to finalized billing, not initial appointment booking.

## 3. Current business meaning of core entities

Appointment:

- Scheduled booking/intention.
- Holds schedule, slot, doctor/patient references, and billing metadata such as `paymentCategory`, `depositAmount`, and `consultationFee`.
- Current booking confirms appointment before billing payment.

Visit:

- Operational medical visit instance.
- Created immediately after booking success.
- `CREATED` means the visit exists but has not started.
- `CHECKED_IN`, `IN_PROGRESS`, and `COMPLETED` represent operational care lifecycle.

MedicalEncounter:

- Clinical result of doctor completion.
- Holds diagnosis, note, prescriptions, and medication price snapshots for billing reference.

Billing:

- Financial snapshot of a completed visit.
- Draft is created after visit completion.
- Finalized billing creates the actual payment record.

Payment:

- Actual payment for finalized billing.
- Current relation is `Payment -> Billing` through `billingId`.
- Appointment-based payment endpoints are deprecated or throwing.

CreditWallet:

- Credit can be applied to a draft billing as `creditUsed`, but it is deducted only when payment succeeds.
- Appointment booking does not currently deduct credit.

Coin:

- Booking coin discount still spends coin during booking if `useCoin=true`.
- Billing has a separate `coinUsed` flow; billing coin is deducted only on payment success.
- This creates a cleanup need because booking `coinDiscountAmount` is not used by billing.

## 4. Current meaning of financial fields

| Field | Current meaning | Actual money collected? | Used by billing? | Safe for refund? | Notes |
|---|---|---:|---:|---:|---|
| `amount` | Requested original booking amount from FE | No | Indirect, stored as `consultationFee` fallback | No | Booking input only |
| `consultationFee` | Appointment snapshot from `amount` | No | Yes, only as fallback if `CONSULTATION_FEE` env absent | No | Billing may override with config |
| `originalAmount` | Response-only amount breakdown from `amount` | No | No | No | Not persisted by this name |
| `discountAmount` | Response-only coin discount | No money; coin value spent | No | No | Persisted as `coinDiscountAmount` |
| `finalAmount` | Response-only `originalAmount - discountAmount` | No | No | No | Persisted as `paymentAmount` |
| `paymentAmount` | Calculated booking final amount snapshot | No in current main flow | No | No | Not actual paid money |
| `coinDiscountAmount` | Booking coin discount snapshot | Coin is spent if > 0 | No | No | Needs future cleanup/restoration rule |
| `depositAmount` | Intended/pre-recorded deposit metadata | Not proven | Yes, as `depositUsed` | No | Data-model gap |
| `depositUsed` | Billing deduction from appointment deposit | Assumed by billing | Yes | No by itself | Needs deposit evidence model |
| `insuranceAmount` | Billing BHYT coverage deduction | No | Yes | No | Computed from billing total and coverage rate |
| `finalPayable` | Final billing payable after deductions | No until payment success | Yes | No before payment success | Payment amount source |
| `paymentMethod` | Legacy booking payment route metadata | No | No | No | Booking payment deferred |
| `paidAt` | Legacy appointment payment metadata | Usually no | No | No | Set for zero-final or mock/legacy paths |
| `paymentResponseCode` | Legacy appointment callback metadata | No | No | No | Not part of billing payment truth |
| `paymentTransactionStatus` | Legacy appointment callback metadata | No | No | No | Not part of billing payment truth |

Direct answers:

- `depositAmount` is not real paid deposit unless a separate external process collected it; code does not prove collection.
- `paymentAmount` is not actual paid money in the current main booking flow.
- Booking does not create appointment-based `Payment` records.
- Cancel has no safe refundable amount in current appointment fields.
- Cancel should not use `amount`, `consultationFee`, `paymentAmount`, `depositAmount`, `paidAt`, `paymentResponseCode`, or `paymentTransactionStatus` for refund.
- Reschedule should preserve `paymentCategory`, `depositAmount`, `consultationFee`, `coinDiscountAmount`, `paymentAmount`, `paymentMethod`, `paidAt`, payment response metadata, and `bookingDate`.

## 5. Cancel/reschedule implications

Cancel:

- Allowed before visit starts: `Visit.status === CREATED`.
- Should cancel `Appointment` and `Visit(CREATED)` and release `TimeSlotLog`.
- Should not refund deposit, payment, credit, or coin unless a real payment/deposit evidence model exists and a separate business rule is added.
- Should block after check-in, start, completion, encounter creation, billing creation, or payment creation.

Reschedule:

- Means changing schedule/slot of the same appointment before visit starts.
- Should only accept new schedule fields such as `appointmentDate`, `timeSlotId`, and possibly `reason`.
- Should not change `paymentCategory`, `depositAmount`, `paymentMethod`, `coinDiscountAmount`, `paymentAmount`, `consultationFee`, `paidAt`, or payment metadata.
- Should preserve financial metadata unchanged.
- Recommended minimal behavior is to keep appointment status `CONFIRMED` rather than moving to `RESCHEDULED`, because `CONFIRMED` is the status required for check-in.

## 6. Contract/documentation gaps

Compared documents:

- `api-contract/api.md`
- `api-contract/README_APPOINTMENT_BOOKING_CURRENT_FLOW.md`
- `api-contract/BOOK_APPOINTMENT_REFACTOR_SUMMARY.md`

Stale or misleading sections:

- Booking flow in `api-contract/api.md` still says `ONLINE/VNPAY` creates a pending booking and appointment payment URL. Current code confirms booking and defers payment to billing.
- Booking flow in `api-contract/api.md` still says `CREDIT` payment succeeds by deducting wallet credit. Current code does not deduct credit during booking.
- `README_APPOINTMENT_BOOKING_CURRENT_FLOW.md` still describes `handleOnlinePayment`, appointment-based `Payment` records, VNPay callback confirming appointment, and credit deduction during booking. Current methods throw or are not used.
- `BOOK_APPOINTMENT_REFACTOR_SUMMARY.md` still mentions refund flows for appointment cancel crediting `CreditWallet`. Current cancel scope should not do that.
- `BOOK_APPOINTMENT_REFACTOR_SUMMARY.md` mentions unique `Payment.appointmentId`; current `Payment` schema uses unique `billingId`.
- Socket documentation still references `PAYMENT_VNPAY_URL_CREATED` from booking flow. Current booking no longer emits booking payment URL events in the main path.
- Some payment docs still refer to `orderId` as appointment id. Current VNPay callback uses `billingId` as canonical transaction reference.

Current docs that are closer to code:

- Cancel section in `api-contract/api.md` now describes visit-based cancel blocking and no CreditWallet refund.
- Billing/receptionist sections in `api-contract/api.md` mostly align with billing-based payment creation and wallet deduction on payment success.

## 7. Recommended follow-up cleanup list

Cancel:

- Keep cancellation visit-lifecycle based.
- Do not add automatic wallet refunds from appointment cancel.
- Add explicit tests that cancel does not use `depositAmount` or `paymentAmount` for refund.

Reschedule:

- Restrict to pre-start visits.
- Update appointment schedule and slot atomically.
- Preserve all financial fields.
- Avoid `RESCHEDULED` as a terminal status unless check-in logic is updated to allow it.

Deposit/payment evidence:

- If the business wants paid deposits, introduce a separate deposit transaction/payment record.
- Do not treat `depositAmount` as collected money without evidence.
- Decide whether `Billing.depositUsed` should be allowed from appointment metadata or only from verified deposit transactions.

Coin cleanup:

- Decide whether booking-time coin discount should be removed entirely and moved to billing.
- If kept, define explicit restoration behavior for appointment cancel before visit starts.
- Avoid double discount by booking `coinDiscountAmount` plus billing `coinUsed`.

Contract cleanup:

- Update `api-contract/api.md` booking section to say booking payment is deferred.
- Mark appointment payment endpoints as deprecated/throwing.
- Remove stale appointment-based Payment examples.
- Update `README_APPOINTMENT_BOOKING_CURRENT_FLOW.md` or replace it with this current-flow document.
- Update `BOOK_APPOINTMENT_REFACTOR_SUMMARY.md` notes around appointment cancel refund and `Payment.appointmentId`.

FE integration notes:

- FE should treat booking `originalAmount`, `discountAmount`, and `finalAmount` as booking display snapshots only.
- FE should not assume booking `depositAmount` or `paymentAmount` means paid money.
- FE should use visit status for operational lifecycle.
- FE should use billing endpoints for final payable, QR payment, cash mark-paid, credit application, and coin application.
- FE should refresh billing/payment state after doctor completion and billing finalization, not after booking alone.

## 8. Exact files and functions inspected

- `src/appointment/appointment.controller.ts`
  - `bookAppointment()`
  - `completeAppointment()`
  - `cancelAppointment()`
  - `rescheduleAppointment()`
- `src/appointment/appointment-booking.service.ts`
  - `bookAppointment()`
  - `checkSlotAvailability()`
  - `createAppointmentWithTransaction()`
  - `calculateBookingAmounts()`
  - `confirmBooking()`
  - `handleOnlinePayment()`
  - `handleCreditPayment()`
  - `expirePendingBookings()`
- `src/appointment/dto/appointment-booking.dto.ts`
  - `AppointmentBookingRequestDto`
  - `AppointmentBookingDto`
  - `DoctorDto`
  - `CompleteAppointmentDto`
- `src/appointment/schemas/appointment.schema.ts`
  - `Appointment`
  - `AppointmentSchema` indexes
- `src/appointment/listenners/booking.listenner.ts`
  - `handleBookingCompleted()`
  - `handleBookingPending()`
  - `handleBookingFailed()`
- `src/visit/listenners/visit-booking.listenner.ts`
  - `handleAppointmentBookingSuccess()`
- `src/visit/visit-receptionist.controller.ts`
  - `checkIn()`
- `src/doctor/doctor-visits.controller.ts`
  - `getToday()`
  - `startVisit()`
  - `completeVisit()`
- `src/visit/visit.service.ts`
  - `createVisitFromAppointment()`
  - `checkInVisit()`
  - `updateVisitStatus()`
  - `completeVisit()`
  - `completeVisitByAppointmentId()`
  - `assertStatusTransitionValid()`
- `src/visit/schemas/visit.schema.ts`
  - `Visit`
  - `VisitSchema`
- `src/patient/medical-encounter.service.ts`
  - `createVisitEncounter()`
  - `mapPrescriptions()`
- `src/patient/schema/medical-record.schema.ts`
  - `MedicalEncounter`
- `src/billing/billing.listener.ts`
  - `handleVisitCompleted()`
- `src/billing/billing.service.ts`
  - `createDraftBilling()`
  - `applyCredit()`
  - `applyCoin()`
  - `finalizeBilling()`
- `src/billing/billing.schema.ts`
  - `Billing`
  - `BillingStatus`
  - `MedicationSource`
- `src/receptionist/receptionist.controller.ts`
  - `getBilling()`
  - `applyCredit()`
  - `applyCoin()`
  - `finalizeBilling()`
  - `getQrPayment()`
  - `markCashPaid()`
- `src/receptionist/receptionist.service.ts`
  - `getBillingByVisitId()`
  - `finalizeBilling()`
  - `getQrPaymentForBilling()`
  - `markCashPaymentPaid()`
- `src/receptionist/dto/finalize-billing.dto.ts`
  - `FinalizeBillingDto`
  - `MedicationFulfillmentDto`
- `src/payment/payment.service.ts`
  - `createPaymentForBilling()`
  - `createPaymentUrlForBilling()`
  - `markPaymentSuccessByBillingId()`
  - `markPaymentSuccess()`
  - wallet commit helpers
- `src/payment/schemas/payment.schema.ts`
  - `Payment`
  - `PaymentSchema` indexes
- `src/payment/vnpay/vnpay-payment.controller.ts`
  - `createPayment()`
  - `vnpayReturn()`
  - deprecated status endpoints
- `src/payment/payment.controller.ts`
  - `paymentSuccess()`
- `src/appointment/enums/Appointment-status.enum.ts`
- `src/visit/enums/visit-status.enum.ts`
- `src/billing/billing.schema.ts`
- `src/payment/enums/payment-flow.enum.ts`
- `src/payment/enums/payment-method.enum.ts`
- `src/appointment/enums/payment-category.enum.ts`
- `src/appointment/enums/visit-type.enum.ts`
- `api-contract/api.md`
- `api-contract/README_APPOINTMENT_BOOKING_CURRENT_FLOW.md`
- `api-contract/BOOK_APPOINTMENT_REFACTOR_SUMMARY.md`
