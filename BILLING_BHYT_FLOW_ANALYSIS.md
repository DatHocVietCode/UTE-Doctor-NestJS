# Billing BHYT Flow Analysis

## Appointment Submission Flow Summary

- Patient booking endpoint: `POST /appointment/book`.
- Controller: `AppointmentController.bookAppointment`.
- DTO: `AppointmentBookingRequestDto`.
- The DTO accepts `paymentCategory?: BHYT | DICH_VU` and `depositAmount?: number`.
- `AppointmentBookingService.normalizeVisitWorkflowDefaults` normalizes `visitType`, `paymentCategory`, and `depositAmount`.
- Before the fix, `paymentCategory` and `depositAmount` were accepted by the DTO but were not saved in the appointment creation object.

## Appointment Schema and Persistence Check

- Enum values are defined in `PaymentCategory`:
  - `BHYT`
  - `DICH_VU`
- Before the fix, `Appointment` schema did not declare `paymentCategory` or `depositAmount`.
- Before the fix, `createAppointmentWithTransaction` did not write `paymentCategory` or `depositAmount`.
- That meant `BillingService.createDraftBilling` could resolve the appointment successfully but read `appointment.paymentCategory` as `undefined`.

## Visit Creation and Check-In Flow Summary

- Booking confirmation emits `appointment.booking.success`.
- `VisitBookingListener.handleAppointmentBookingSuccess` calls `VisitService.createVisitFromAppointment`.
- `Visit` stores `appointmentId`, `doctorId`, `patientId`, and status.
- `paymentCategory` is not copied to `Visit`; it remains appointment-owned data.
- This is acceptable because billing resolves the appointment from `MedicalEncounter.appointmentId`, with fallback to `Visit.appointmentId`.

## Doctor Complete Visit Flow Summary

- Endpoint: `POST /doctor/visits/:visitId/complete`.
- `DoctorVisitsController.completeVisit` validates doctor identity, ownership, and `IN_PROGRESS` status.
- `VisitService.completeVisit` creates the `MedicalEncounter`, marks appointment/time slot/visit complete, then emits `domain.visit.completed`.
- `MedicalEncounterService.createVisitEncounter` stores both `visitId` and `appointmentId`.
- Prescription price snapshots are created from `Medicine.unitPrice` into `prescriptions[].unitPriceSnapshot`.

## Draft Billing Creation Flow Summary

- `BillingListener.handleVisitCompleted` receives `domain.visit.completed`.
- It calls `BillingService.createDraftBilling(visitId)`.
- `createDraftBilling` first returns an existing billing by `visitId` if present.
- For a new draft, it resolves appointment id from `MedicalEncounter.appointmentId`, falling back to `Visit.appointmentId`.
- It calculates:
  - `totalAmount = consultationFee + medicationFee`
  - `insuranceAmount = totalAmount * INSURANCE_COVERAGE_RATE` when `paymentCategory === BHYT`
  - `finalPayable = max(0, floor(totalAmount - insuranceAmount - depositUsed))`

## Actual Values Found

- `.env` contains `CONSULTATION_FEE=100000`.
- `.env` contains `INSURANCE_COVERAGE_RATE=0.7`.
- `Number(config.get('INSURANCE_COVERAGE_RATE'))` therefore parses to `0.7`, which matches the expected 70% coverage model.
- The failing response with `insuranceAmount = 0` is explained by missing persisted `appointment.paymentCategory`, not by medication math or frontend rendering.

## Root Cause

Root cause: appointment data missing.

The backend accepted `paymentCategory = BHYT` at the appointment booking boundary but did not persist it into `Appointment`. Later, `createDraftBilling` checked:

```ts
const paymentCategory = appointment?.paymentCategory;
const isBHYT = paymentCategory === 'BHYT';
```

Because `appointment.paymentCategory` was missing, `isBHYT` was false and `insuranceAmount` became `0`.

## Classification

- Appointment data missing: yes.
- Wrong enum/string mismatch: no; the enum value is exactly `BHYT`.
- AppointmentId resolution issue: no issue found; visit and encounter preserve `appointmentId`.
- Config missing/wrong: no; `.env` has `INSURANCE_COVERAGE_RATE=0.7`.
- Stale existing billing: possible for already-created drafts. `createDraftBilling` returns an existing billing by `visitId` and will not recalculate an old `DRAFT`.
- Contract mismatch: billing response did not expose `paymentCategory`; it now does.

## Minimal Fix Applied

- Persist `paymentCategory` and `depositAmount` in `Appointment`.
- Default missing `paymentCategory` to `DICH_VU` for backward compatibility.
- Snapshot `paymentCategory` onto `Billing`.
- Use `PaymentCategory.BHYT` enum comparison in billing instead of a string literal.
- Expose `paymentCategory` in receptionist billing response and API contract.
- Add a diagnostic debug log in draft billing creation with appointment/category/config/calculation values.

## Files Changed

- `src/appointment/schemas/appointment.schema.ts`
- `src/appointment/appointment-booking.service.ts`
- `src/billing/billing.schema.ts`
- `src/billing/billing.service.ts`
- `src/receptionist/receptionist.service.ts`
- `api-contract/api.md`
- `BILLING_BHYT_FLOW_ANALYSIS.md`

## Stale Draft Billing Note

Existing `DRAFT` billings created before this fix may still have `insuranceAmount = 0` because `createDraftBilling` returns the existing billing immediately.

For test data, delete the stale `DRAFT` billing for the affected `visitId` and recreate/fetch billing again, or create a brand-new BHYT appointment flow. Do not recalculate `FINALIZED` or `PAID` billings without an explicit migration/audit decision.

## Manual Verification Steps

1. Create a new appointment as patient with `paymentCategory = BHYT`.
2. Confirm the `Appointment` record stores `paymentCategory: "BHYT"` and `depositAmount: 0`.
3. Check in / create the `Visit` from that appointment.
4. Confirm `Visit.appointmentId` points to the appointment.
5. Doctor completes the visit with prescriptions.
6. Confirm `MedicalEncounter` has the correct `visitId` and `appointmentId`.
7. Confirm draft billing is created.
8. Fetch billing by `visitId`.
9. Confirm medication fields remain correct.
10. Confirm for the example `100000 + 270000` with `0.7` coverage:
    - `totalAmount = 370000`
    - `insuranceAmount = 259000`
    - `finalPayable = 111000`
11. Repeat with `paymentCategory = DICH_VU` and confirm `insuranceAmount = 0`.
