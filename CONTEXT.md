# UTE Doctor — Domain Language

Glossary for the telemedicine platform backend. Defines the project-specific terms so the same word means the same thing across code, contract, and conversation.

## Patient Health & Vital Signs

**Vital Sign (Patient Vital Sign)**:
A single clinical measurement snapshot of a patient taken at or after receptionist check-in — a multi-metric record (height, weight, blood pressure, heart rate, optional blood type) captured at one point in time. Append-only and clinically owned; never patient self-entered.
_Avoid_: reading (when meaning the whole snapshot), measurement (when meaning the whole snapshot)

**Metric**:
One measured quantity inside a Vital Sign — e.g. heart rate, weight, the blood-pressure pair. A Vital Sign holds several metrics; a metric is the unit that gets a clinical status.

**Legacy Vital Sign Record**:
The pre-existing, currently-unused per-metric structure embedded in `MedicalEncounter.vitalSigns[]` (`type: BP|HR|TEMP|SPO2`). Distinct from the new standalone Vital Sign and not used by the health dashboard. Slated for future cleanup, untouched for now.

**Medical Profile**:
Slow-changing, patient self-entered baseline (height/weight/blood type) maintained via `POST /patients/me/medical-profile`. NOT a clinical measurement and NOT a source for the health dashboard.
_Avoid_: health profile, medical record (which is a separate legacy embedded structure)

**Health Summary**:
A read-only, derived view of a patient's health for the dashboard: the latest active Vital Sign, recent active history, and an aggregated overall status. Computed on read; never stored.

**Record State**:
The lifecycle of a Vital Sign: `ACTIVE` (current truth), `SUPERSEDED` (replaced by a correction), or `VOIDED` (invalidated, value preserved). Only `ACTIVE` records feed the Health Summary.

**Metric Status**:
A backend-owned clinical classification of one metric: `NORMAL`, `LOW`, `HIGH`, or `UNKNOWN`. The frontend never computes thresholds.

**Overall Status**:
A summary-level roll-up across a patient's latest active metrics: `STABLE`, `NEEDS_ATTENTION`, or `UNEVALUATED`. Blood type never influences it.

**Correction**:
A new ACTIVE Vital Sign that replaces an earlier one (which becomes SUPERSEDED), carrying `supersedesRecordId` and a required reason. Original values are never destructively edited.

**Source**:
Where a Vital Sign originated. MVP only emits `RECEPTIONIST_CHECK_IN`; the contract reserves `VISIT_INTAKE`, `MIGRATED`, `UNKNOWN` for later.
