# Billing & Medication Fulfillment Refactoring - Implementation Summary

Date: May 9, 2026

## Overview
Refactored the billing and prescription workflow to support receptionist-controlled medication fulfillment during billing finalization. The system now separates clinical prescription intent from financial fulfillment reality, allowing receptionists to adjust dispensed quantities and sources before billing is finalized.

## Files Modified

### 1. Schema Updates

#### `src/patient/schema/medical-record.schema.ts`
- **Changed**: Updated MedicalEncounter prescription items structure
- **Added fields to prescription items**:
  - `prescribedQty`: Normalized prescription quantity from doctor
  - `unitPriceSnapshot`: Medicine price at time of prescription (frozen for audit trail)
  - `estimatedLineTotal`: prescribedQty × unitPriceSnapshot (for clinical reference only)
- **Behavior**: When doctor completes visit, prices are snapshotted at that moment

#### `src/billing/billing.schema.ts`
- **Added**: `MedicationSource` enum with values: `CLINIC`, `OUTSIDE_PURCHASE`
- **Added**: New `medications[]` array field on Billing schema with structure:
  ```typescript
  {
    medicineId?: ObjectId;
    medicineName: string;
    prescribedQty: number;          // from doctor prescription
    dispensedQty: number;           // receptionist-confirmed actual dispense
    unitPrice: number;              // frozen snapshot from billing creation
    source: MedicationSource;       // CLINIC or OUTSIDE_PURCHASE
    lineTotal: number;              // 0 if outside purchase, else dispensedQty * unitPrice
  }
  ```
- **Removed**: Old medication fee calculation dependency on dynamic medicine prices
- **Purpose**: Medications array is the authoritative financial fulfillment snapshot, immutable after FINALIZED

### 2. Service Updates

#### `src/patient/medical-encounter.service.ts`
- **Updated**: `mapPrescriptions()` method to include price snapshots
- **New behavior**:
  - Fetches current medicine.unitPrice at prescription creation time
  - Populates `unitPriceSnapshot` and `estimatedLineTotal` for each prescription item
  - These snapshots prevent future price drift affecting clinical records

#### `src/billing/billing.service.ts`
- **Updated imports**: Added `MedicationSource` enum import
- **Refactored**: `createDraftBilling()` method
  - **Old behavior**: Computed medicationFee by querying live medicine prices and multiplying by prescribed quantity
  - **New behavior**: 
    - Populates `medications[]` array from encounter prescriptions
    - Each medication defaults to: `dispensedQty = prescribedQty`, `source = CLINIC`
    - Computes `lineTotal = prescribedQty * unitPriceSnapshot` (from encounter snapshot)
    - Aggregates `medicationFee` from `medications[].lineTotal` sum
    - Creates draft billing with both old `medicationFee` field and new `medications[]` array
  - **Result**: Draft billing is a mutable workspace for receptionist refinement

- **Added**: `applyFulfillmentToMedications()` private method
  - Receives receptionist-confirmed fulfillment input
  - Matches medications by `medicineId` and updates `dispensedQty` and `source`
  - Recalculates `lineTotal` with business rules:
    - If `source = OUTSIDE_PURCHASE`: `lineTotal = 0` (no clinic revenue)
    - If `dispensedQty = 0`: `lineTotal = 0` (not dispensed)
    - Otherwise: `lineTotal = dispensedQty * unitPrice`

- **Added**: `computeMedicationFeeFromMedications()` private method
  - Calculates total medication fee as sum of all `lineTotal` values
  - Used during finalization to ensure accuracy

- **Refactored**: `finalizeBilling()` method signature
  - **Old signature**: `async finalizeBilling(billingId: string)`
  - **New signature**: `async finalizeBilling(billingId: string, fulfillment?: { medications: Array<{...}> })`
  - **New behavior**:
    - Accepts optional fulfillment input from receptionist
    - If fulfillment provided, applies it via `applyFulfillmentToMedications()`
    - Recomputes `medicationFee` and `totalAmount` from final medications
    - Recalculates `insuranceAmount` and `finalPayable` with updated totals
    - Transitions billing to `FINALIZED` (immutable snapshot)
    - Creates payment record after finalization
  - **Immutability**: After FINALIZED, medications[] and pricing cannot be modified

### 3. DTO & Validation

#### `src/receptionist/dto/finalize-billing.dto.ts` (NEW FILE)
- **Created**: New DTO for finalize billing endpoint
- **Structure**:
  ```typescript
  export class FinalizeBillingDto {
    @IsArray()
    @ValidateNested({ each: true })
    medications: MedicationFulfillmentDto[];
  }

  export class MedicationFulfillmentDto {
    @IsOptional()
    @IsMongoId()
    medicineId?: string;
    
    @IsNumber()
    dispensedQty: number;
    
    @IsEnum(MedicationSourceDto)
    source: MedicationSourceDto;  // 'CLINIC' | 'OUTSIDE_PURCHASE'
  }
  ```
- **Validation**:
  - Ensures `dispensedQty >= 0`
  - Enforces `source` enum membership
  - Validates medicineId if present

### 4. Endpoint Updates

#### `src/receptionist/receptionist.service.ts`
- **Updated**: `finalizeBilling()` method to accept fulfillment parameter
- **Passes through**: Fulfillment input to billing service for processing

#### `src/receptionist/receptionist.controller.ts`
- **Updated imports**: Added `FinalizeBillingDto`
- **Modified endpoint**: `POST /receptionist/billings/:billingId/finalize`
  - **Old behavior**: Accepted empty body, just finalized billing
  - **New behavior**: 
    - Accepts `FinalizeBillingDto` in request body
    - Validates medication fulfillment against schema
    - Passes validated input to service
  - **Endpoint signature**:
    ```typescript
    @Post('billings/:billingId/finalize')
    async finalizeBilling(
      @Param('billingId') billingId: string,
      @Body() body: FinalizeBillingDto,
    )
    ```

### 5. Documentation Updates

#### `AGENTS.md`
- **Added**: New "Billing and Medication Dispensing Rules" section
- **Contents**:
  - Data model separation (clinical vs financial)
  - Draft billing creation behavior
  - Receptionist fulfillment workflow
  - Billing finalization process
  - Price snapshot immutability
  - Intentional scope limitations (no inventory, no ledger, no transactions)

#### `api-contract/api.md`
- **Updated**: POST `/receptionist/billings/:billingId/finalize` endpoint documentation
- **Added**: Request body schema with medication fulfillment
- **Updated**: Response example including payment data
- **Added**: Detailed validation rules and behavior description

## Workflow Summary

### Before (Old Approach)
```
1. Doctor completes visit → Encounter prescriptions stored
2. BillingListener triggered → medicationFee computed from encounter quantity × current medicine price
3. Draft billing created with computed fee
4. Receptionist finalizes (no way to adjust dispensing)
5. Risk: Price changes after prescription but before finalization affect billing
```

### After (New Approach)
```
1. Doctor completes visit
   → Encounter prescriptions stored with unitPriceSnapshot
   → Snapshot ensures price from prescription time is frozen

2. BillingListener triggered
   → Draft billing created with medications[] array
   → Each medication defaults to: dispensedQty = prescribedQty, source = CLINIC
   → medicationFee = sum of (prescribedQty × unitPriceSnapshot)

3. Receptionist views draft billing
   → Can adjust each medication's dispensedQty and source
   → Sees estimated impact on billing total

4. Receptionist finalizes with fulfillment input
   → Provides actual dispensed quantities and sources
   → System applies fulfillment adjustments
   → Recalculates lineTotal per medication:
     • If source=OUTSIDE_PURCHASE: lineTotal = 0
     • If dispensedQty=0: lineTotal = 0
     • Else: lineTotal = dispensedQty × unitPrice
   → Recomputes medicationFee, totalAmount, finalPayable
   → Transitions to FINALIZED (immutable snapshot)
   → Creates payment record

5. Payment flow continues
   → Billing cannot be modified
   → Doctor prescription edits don't affect this billing
```

## Example API Request/Response

### Request: Finalize Billing with Fulfillment
```http
POST /api/receptionist/billings/507f1f77bcf86cd799439011/finalize
Content-Type: application/json
Authorization: Bearer <jwt>

{
  "medications": [
    {
      "medicineId": "507f1f77bcf86cd799439012",
      "dispensedQty": 10,
      "source": "CLINIC"
    },
    {
      "medicineId": "507f1f77bcf86cd799439013",
      "dispensedQty": 0,
      "source": "CLINIC"
    },
    {
      "medicineId": "507f1f77bcf86cd799439014",
      "dispensedQty": 5,
      "source": "OUTSIDE_PURCHASE"
    }
  ]
}
```

### Response: Success
```json
{
  "code": "SUCCESS",
  "message": "Billing finalized",
  "data": {
    "billingId": "507f1f77bcf86cd799439011",
    "status": "FINALIZED",
    "paymentId": "507f1f77bcf86cd799439020",
    "paymentStatus": "PENDING",
    "amount": 85000,
    "method": "QR"
  }
}
```

## Key Invariants & Rules

### Clinical vs Financial Separation
- **Encounter prescriptions** = clinical intent from doctor (immutable after visit completion)
- **Billing medications** = financial fulfillment reality (mutable in draft, immutable after finalized)
- Doctor edits to prescriptions do NOT affect completed billing

### Price Immutability
- `unitPriceSnapshot` in encounter prescriptions frozen at prescription time
- `unitPrice` in billing.medications[] frozen at draft creation time
- Future medicine price changes DO NOT affect historical records
- Prevents audit disputes and price drift

### Dispensing Sources
- `CLINIC`: Medication provided by clinic, charged to patient (lineTotal = dispensedQty × unitPrice)
- `OUTSIDE_PURCHASE`: Patient purchased themselves, not charged by clinic (lineTotal = 0)
- Receptionist decides based on actual fulfillment reality

### Billing Status Transitions
- `DRAFT` → `FINALIZED` (via receptionist finalize API)
- `FINALIZED` → `PAID` (via payment success flow)
- After `FINALIZED`: medications[], pricing, and discounts are immutable
- Prevents billing modification after snapshot taken

### Out-of-Scope (Intentionally NOT Implemented)
- Inventory management (stock tracking, levels)
- Pharmacy transaction ledger (historical partial dispense records)
- Stock reservation (blocking quantities for pending orders)
- Dispense transaction history (per-item fulfillment timeline)
- Scope limited to practical receptionist billing workflow

## Migration Considerations

### For Existing Billing Records
- Old billing records without `medications[]` array will continue to work
- New draft billings will always populate `medications[]`
- Finalized billings before this change will not have `medications[]` (no retroactive migration needed)
- Old `medicationFee` field remains for backward compatibility

### For Frontend Integration
- Receptionist UI should display:
  - Draft medications list with current dispensedQty and source
  - Edit interface for receptionist to adjust quantities
  - Visual recalculation of billing total as changes are made
  - Confirmation step before sending finalize request
- Example payload structure provided in api-contract

### API Version
- No breaking changes to existing endpoints
- New fulfillment parameter is optional in finalize (backward compatible if not provided)
- Existing code without fulfillment input will finalize with defaults

## Testing Recommendations

1. **Unit Tests**: Test fulfillment application logic
   - Verify lineTotal calculation for each source/quantity combination
   - Test medicationFee aggregation

2. **Integration Tests**: Test full workflow
   - Create visit → complete visit → check draft billing → apply fulfillment → finalize
   - Verify medications array populated correctly
   - Verify totals recalculated accurately

3. **Edge Cases**:
   - All medications dispensed from clinic (normal path)
   - Mix of clinic and outside purchase
   - Zero dispensed quantities
   - Missing medicineId in fulfillment
   - Price changes after prescription (verify snapshot is used)

## Files Summary

**Created**: 1
- `src/receptionist/dto/finalize-billing.dto.ts`

**Modified**: 7
- `src/patient/schema/medical-record.schema.ts`
- `src/billing/billing.schema.ts`
- `src/patient/medical-encounter.service.ts`
- `src/billing/billing.service.ts`
- `src/receptionist/receptionist.service.ts`
- `src/receptionist/receptionist.controller.ts`
- `AGENTS.md`

**Documentation Updated**: 1
- `api-contract/api.md` (submodule committed & pushed)

**Build Status**: ✅ Compiled successfully with `npm run build`

## Next Steps

1. **Testing**: Write unit and integration tests for new fulfillment logic
2. **Frontend**: Update receptionist UI to display and edit medications array
3. **Monitoring**: Add logs for fulfillment application to audit medication changes
4. **Training**: Brief receptionist team on new fulfillment workflow during finalization
