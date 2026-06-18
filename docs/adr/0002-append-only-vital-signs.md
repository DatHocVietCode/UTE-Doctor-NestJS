# Append-only vital signs with reserved lifecycle fields

**Status:** accepted

## Context & decision

`PatientVitalSign` records are **append-only**. We added `recordState` (`ACTIVE | SUPERSEDED | VOIDED`) plus correction-audit fields (`supersedesRecordId`, `correctionReason`, `correctedBy`) to the schema **now**, even though the correction/void **endpoints are deferred** past this MVP. New records are always written `ACTIVE`; nothing mutates an existing record's measurement values in MVP.

## Why

- **Clinical data must not be destructively overwritten.** A vital sign is a statement about what was measured at a point in time. Correcting it should produce a *new* record and mark the old one `SUPERSEDED`, preserving the original values for audit. A void preserves the value and marks it `VOIDED`.
- **Avoid a painful migration.** If `recordState` and the correction links were added later, every existing record would need backfilling and the read query (which filters to `ACTIVE` only) would need a migration-aware fallback. Reserving the fields up front makes the future correction/void endpoints additive.
- The summary read path already filters `recordState: ACTIVE`, so deferring the write side of corrections costs nothing on read.

## Consequences

- `recordState` defaults to `ACTIVE`; the correction fields stay empty until correction/void endpoints ship. A reader seeing unused fields should consult this ADR rather than assume them dead.
- Recommended future endpoints (not in this MVP): `POST /receptionist/vital-signs/:recordId/corrections`, `PATCH /receptionist/vital-signs/:recordId/void`.
