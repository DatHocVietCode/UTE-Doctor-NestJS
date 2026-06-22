# Standalone PatientVitalSign collection instead of reusing the embedded VitalSignRecord

**Status:** accepted

## Context & decision

The Patient Health dashboard needs clinical vital-sign data captured at receptionist check-in. A `VitalSignRecord` type already exists in [src/patient/schema/medical-record.schema.ts](../../src/patient/schema/medical-record.schema.ts), embedded as `MedicalEncounter.vitalSigns[]`. We decided **not** to reuse it and instead introduced a new top-level `PatientVitalSign` collection.

## Why

The two models are structurally incompatible:

- **Old `VitalSignRecord`** is *per-metric* (`type: BP|HR|TEMP|SPO2`, one `value`) and *encounter-embedded*. A `MedicalEncounter` only exists **after a visit completes**, but vital signs are taken at/after check-in — before any encounter exists. There is no home for a pre-encounter measurement in that model. It is also currently dead code (the encounter service always writes `vitalSigns: []`).
- **New `PatientVitalSign`** is a *standalone, multi-metric measurement session snapshot* (height, weight, BP, heart rate, derived BMI, per-metric status) with an *append-only audit lifecycle* (`recordState`, correction links, `source`, `measuredBy`). It must be queryable on its own for the dashboard, independent of encounters.

Reshaping the embedded model to fit would have forced churn on `MedicalEncounter` and risked the existing visit-completion flow for no benefit.

## Consequences

- Two "vital sign" concepts coexist. The glossary in [CONTEXT.md](../../CONTEXT.md) distinguishes **Vital Sign** (new) from **Legacy Vital Sign Record** (old, embedded, unused).
- The dead embedded `VitalSignRecord` is left untouched for now; a future refactor may remove it. See [ADR-0002](0002-append-only-vital-signs.md) for the lifecycle rationale.
