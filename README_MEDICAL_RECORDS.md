# Medical Records Refactor Overview

## Before (Legacy)
- Single embedded `patient.medicalRecord` document containing:
  - `height`, `weight`, `bloodType`
  - `medicalHistory[]` (diagnosis, prescriptions, note, dateRecord, appointmentId)
  - `drugAllergies[]`, `foodAllergies[]` (shared structure)
  - `bloodPressure[]`, `heartRate[]` (legacy vitals)
- No creator/audit tracking, no separation of patient-reported vs doctor-verified data.
- Appointment completion pushed data into the embedded `medicalRecord.medicalHistory` array.

## After (Refactored)
- **Separated collections** with audit fields:
  - `medicalprofiles`: slow-changing profile (height, weight, bloodType, patientId, createdByRole/account)
  - `allergyrecords`: type DRUG/FOOD, substance, reaction, severity, reportedBy, verifiedByDoctor/DoctorId, patientId
  - `medicalhistoryrecords`: longitudinal conditions (conditionName, diagnosisCode, diagnosedAt, status, source, verifiedByDoctor, patientId)
  - `medicalencounters`: per-appointment visit (appointmentId unique, patientId, createdByDoctorId, diagnosis, note, prescriptions[], vitalSigns[], dateRecord)
  - `vitalSigns` stored inside encounters for new data; legacy vitals remain in `medicalRecord` for compatibility
- Patient now stores `medicalProfileId` (ref to `medicalprofiles`).
- Appointment completion now writes a `MedicalEncounter` document instead of mutating embedded medicalRecord.
- DTOs updated to include `medicalProfile`, `encounters`, `allergies`, `medicalHistory` (legacy `medicalRecord` kept as fallback).
- Frontend prioritizes new collections and displays encounters, allergies, history, profile vitals.

## Migration
- Scripts: `migration-medical-records.js` (single patient) and `migration-all-patients.js` (bulk).
- Default DB: `UTE_Doctor`. Run single-patient migration:
  ```bash
  mongosh "mongodb://localhost:27017/UTE_Doctor" --eval "load('migration-medical-records.js')"
  ```
- Verifications included in script (profiles, allergies, history, encounters, patient.medicalProfileId).

## Key Files
- Schemas: `src/patient/schema/medical-record.schema.ts`, `src/patient/schema/patient.schema.ts`
- Service: `src/patient/patient.service.ts` (fetches all new collections)
- Modules: `src/patient/patient.module.ts`, `src/appointment/appointment.service.ts` (creates encounters)
- Frontend: `src/components/medical-record/medical-record-detail.tsx`, `medical-record-display.tsx`, DTO `patient-profile.dto.ts`

## Notes
- Legacy `medicalRecord` remains for backward compatibility; new data flows into separated collections.
- Unique constraint on `medicalencounters.appointmentId` prevents duplicate visit records per appointment.
- Add indexes for performance (recommended):
  ```javascript
  db.allergyrecords.createIndex({ patientId: 1 })
  db.medicalhistoryrecords.createIndex({ patientId: 1 })
  db.medicalencounters.createIndex({ patientId: 1 })
  db.medicalencounters.createIndex({ appointmentId: 1 }, { unique: true })
  ```
