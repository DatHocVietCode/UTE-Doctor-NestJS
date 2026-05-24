# Billing Unit Price Flow Analysis

## Doctor Complete Visit Flow Summary

- Endpoint: `POST /doctor/visits/:visitId/complete` in `src/doctor/doctor-visits.controller.ts`.
- Controller verifies JWT doctor identity, visit ownership, and `IN_PROGRESS` status, then calls `VisitService.completeVisit`.
- `VisitService.completeVisit` creates the medical encounter, marks the appointment/time slot/visit completed in one transaction, then emits `domain.visit.completed`.

## Billing Creation/Retrieval Flow Summary

- `BillingListener.handleVisitCompleted` listens for `domain.visit.completed` and calls `BillingService.createDraftBilling(visitId)`.
- `BillingService.createDraftBilling` is idempotent: if a billing exists for the visit, it returns the existing billing.
- For new drafts, it reads the encounter prescriptions and copies them into `Billing.medications[]`.
- Receptionist retrieval endpoint: `GET /receptionist/billing/:visitId` in `src/receptionist/receptionist.controller.ts`, implemented by `ReceptionistService.getBillingByVisitId`.

## DB Field Confirmation

- Current medicine price is stored in `Medicine.unitPrice` (`src/medicine/schema/medicine.schema.ts`).
- At visit completion, `MedicalEncounterService.mapPrescriptions` reads `Medicine.unitPrice` and stores it as `prescriptions[].unitPriceSnapshot`.
- Draft billing creation reads `prescriptions[].unitPriceSnapshot` and stores it as `Billing.medications[].unitPrice`.
- Billing also stores `prescribedQty`, `dispensedQty`, and `lineTotal`.

## Backend Response Shape

Before the fix, `ReceptionistService.getBillingByVisitId` returned:

```ts
{
  medicineId,
  medicineName,
  dispensedQty,
  source,
}
```

That response dropped `unitPrice`, even though `Billing.medications[].unitPrice` was already persisted and used for billing totals.

After the fix, medicine items include:

```ts
{
  medicineId,
  medicineName,
  prescribedQty,
  dispensedQty,
  unitPrice,
  source,
  lineTotal,
}
```

## API Contract Submodule Shape

Before the fix, `api-contract/api.md` documented `GET /receptionist/billing/:visitId` without `medications[]`, and `BillingResponseDto` had no medication item contract.

After the fix, the contract includes `medications: BillingMedicationDto[]` with `unitPrice: number`.

## Frontend Expected Shape

No frontend repository is present under `E:\D\University\Nam4\TLCN\Project\BE_Nest`; only `ute-doctor-be` exists. Because of that, the receptionist screen/component and generated FE types could not be inspected locally.

The backend and contract now expose the canonical field as `medications[].unitPrice`. If the FE still reads `price`, `medicineUnitPrice`, or a nested prescription field, it should be updated to consume `unitPrice`.

## Root Cause

The persisted data path was correct, but the receptionist API response mapper dropped pricing fields from `billing.medications[]`.

Specific loss point:

- Not schema/model: `Billing.medications[].unitPrice` exists.
- Not DB read: `createDraftBilling` returns a billing containing `unitPrice`.
- Mapper/response contract: `ReceptionistService.getBillingByVisitId` omitted `unitPrice`, and `api-contract/api.md` did not document medication pricing fields.

## Recommended Fix

- Return the billing medication snapshot fields from `GET /receptionist/billing/:visitId`.
- Document the same shape in `api-contract/api.md`.
- FE should display `medications[].unitPrice` and use `lineTotal` for row totals where possible.

## Files Involved

- `src/doctor/doctor-visits.controller.ts`
- `src/visit/visit.service.ts`
- `src/patient/medical-encounter.service.ts`
- `src/patient/schema/medical-record.schema.ts`
- `src/billing/billing.listener.ts`
- `src/billing/billing.service.ts`
- `src/billing/billing.schema.ts`
- `src/receptionist/receptionist.controller.ts`
- `src/receptionist/receptionist.service.ts`
- `src/medicine/schema/medicine.schema.ts`
- `api-contract/api.md`

## Validation Notes

Manual verification:

1. Start the app with `npm run start:dev`.
2. Complete a visit using `POST /api/doctor/visits/:visitId/complete` with a prescription containing a valid `medicineId`.
3. Confirm the encounter stores `prescriptions[].unitPriceSnapshot` equal to `medicines.unitPrice`.
4. Confirm the billing stores `medications[].unitPrice` and `lineTotal`.
5. Open `GET /api/receptionist/billing/:visitId` and verify the response includes `data.medications[].unitPrice`.
6. Open the receptionist billing screen and verify the displayed unit price matches the API response and database value.

Runtime simulation:

- `npm run start:dev` should compile unless unrelated existing workspace changes fail compilation.
- The modified endpoint response remains backward compatible for existing fields and only adds medication snapshot fields.
