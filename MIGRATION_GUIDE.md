# Medical Records Migration Guide

## Overview
This guide explains how to migrate legacy medical records from the old embedded schema to the new separated collections structure.

## New Collections Structure

### 1. **MedicalProfile** Collection
- **Purpose**: Patient's slow-changing profile data (height, weight, blood type)
- **Reference**: `patient.medicalProfileId` → `medicalprofiles._id`
- **Fields**:
  - `patientId` (ObjectId, indexed)
  - `height`, `weight`, `bloodType`
  - `createdByRole`, `createdByAccountId`
  - `createdAt`, `updatedAt`

### 2. **AllergyRecord** Collection
- **Purpose**: Drug and food allergies (patient-reported, doctor-verifiable)
- **Fields**:
  - `patientId` (ObjectId, indexed)
  - `type` (DRUG | FOOD)
  - `substance`, `reaction`, `severity`
  - `reportedBy` (PATIENT | DOCTOR)
  - `verifiedByDoctor` (boolean)
  - `verifiedByDoctorId` (ObjectId, optional)
  - Audit fields: `createdByRole`, `createdByAccountId`, timestamps

### 3. **MedicalHistoryRecord** Collection
- **Purpose**: Longitudinal medical conditions (diabetes, hypertension, etc.)
- **Fields**:
  - `patientId` (ObjectId, indexed)
  - `conditionName`, `diagnosisCode`, `diagnosedAt`
  - `status` (ONGOING | RESOLVED)
  - `source` (PATIENT | DOCTOR)
  - `verifiedByDoctor` (boolean)
  - Audit fields

### 4. **MedicalEncounter** Collection
- **Purpose**: Per-appointment visit records (immutable)
- **Fields**:
  - `appointmentId` (ObjectId, unique)
  - `patientId` (ObjectId, indexed)
  - `createdByDoctorId` (ObjectId)
  - `diagnosis`, `note`
  - `prescriptions` (array of medicine + quantity + note)
  - `vitalSigns` (array of BP/HR/TEMP/SPO2 records)
  - `dateRecord`, timestamps

## Migration Scripts

### Option 1: Single Patient Migration
Use `migration-medical-records.js` to migrate a specific patient:

```bash
# Connect to your MongoDB
mongosh "mongodb://localhost:27017/UTE_Doctor"

# Run the migration script
load("migration-medical-records.js")
```

**Before running**, edit the script to set:
- `patientId` (line 4)
- `profileId` (line 5)
- Sample data for allergies, medical history (lines 28-88)

### Option 2: Bulk Migration (All Patients)
Use `migration-all-patients.js` to migrate ALL patients:

```bash
mongosh "mongodb://localhost:27017/UTE_Doctor"
load("migration-all-patients.js")
```

**⚠️ WARNING**: This processes ALL patients. Test on a backup database first!

## Migration Logic

### Old Structure → New Structure

#### 1. **patient.medicalRecord** → **MedicalProfile**
```javascript
// Old (embedded)
patient.medicalRecord.height = 172
patient.medicalRecord.weight = 68
patient.medicalRecord.bloodType = "O"

// New (separate collection)
medicalprofiles.insertOne({
  patientId: patient._id,
  height: 172,
  weight: 68,
  bloodType: "O",
  createdByRole: "PATIENT"
})
```

#### 2. **medicalRecord.drugAllergies** → **AllergyRecord** (type=DRUG)
```javascript
// Old
medicalRecord.drugAllergies = [
  { diagnosis: "Penicillin", note: "Phát ban" }
]

// New
allergyrecords.insertOne({
  patientId: patient._id,
  type: "DRUG",
  substance: "Penicillin",
  reaction: "Phát ban",
  reportedBy: "PATIENT",
  verifiedByDoctor: false
})
```

#### 3. **medicalRecord.foodAllergies** → **AllergyRecord** (type=FOOD)
Similar to drug allergies, with `type: "FOOD"`

#### 4. **medicalRecord.medicalHistory** → **MedicalEncounter** OR **MedicalHistoryRecord**
```javascript
// If history has appointmentId → MedicalEncounter
if (history.appointmentId) {
  medicalencounters.insertOne({
    appointmentId: history.appointmentId,
    patientId: patient._id,
    diagnosis: history.diagnosis,
    prescriptions: history.prescriptions,
    dateRecord: history.dateRecord
  })
}
// Else → MedicalHistoryRecord
else {
  medicalhistoryrecords.insertOne({
    patientId: patient._id,
    conditionName: history.diagnosis,
    status: "ONGOING",
    source: "PATIENT"
  })
}
```

## Verification Queries

After migration, verify data integrity:

```javascript
// 1. Check if patient has medicalProfileId
db.patients.findOne(
  { _id: ObjectId("69072256c93dc4f67dfbd524") },
  { medicalProfileId: 1, profileId: 1 }
)

// 2. Get patient's medical profile
db.medicalprofiles.findOne({ 
  patientId: ObjectId("69072256c93dc4f67dfbd524") 
})

// 3. Get patient's allergies
db.allergyrecords.find({ 
  patientId: ObjectId("69072256c93dc4f67dfbd524") 
}).toArray()

// 4. Get patient's medical history
db.medicalhistoryrecords.find({ 
  patientId: ObjectId("69072256c93dc4f67dfbd524") 
}).toArray()

// 5. Get patient's encounters
db.medicalencounters.find({ 
  patientId: ObjectId("69072256c93dc4f67dfbd524") 
}).toArray()

// 6. Count documents in new collections
db.medicalprofiles.countDocuments()
db.allergyrecords.countDocuments()
db.medicalhistoryrecords.countDocuments()
db.medicalencounters.countDocuments()
```

## Backend Service Updates

The following services have been updated to fetch from new collections:

### patient.service.ts
```typescript
async handleGetPatientByProfileId(profileId: string) {
  const patient = await this.patientModel
    .findOne({ profileId })
    .populate('medicalProfileId')
    .lean();

  const [medicalProfile, encounters, allergies, medicalHistory] = 
    await Promise.all([
      this.medicalProfileModel.findById(patient.medicalProfileId),
      this.medicalEncounterModel.find({ patientId: patient._id }),
      this.allergyRecordModel.find({ patientId: patient._id }),
      this.medicalHistoryRecordModel.find({ patientId: patient._id })
    ]);

  return {
    ...patient,
    medicalProfile,
    encounters,
    allergies,
    medicalHistory
  };
}
```

### appointment.service.ts
```typescript
async completeAppointment(appointmentId: string, data: any) {
  // Create MedicalEncounter instead of pushing to patient.medicalRecord
  const encounter = await this.medicalEncounterModel.create({
    appointmentId,
    patientId: appointment.patientId,
    createdByDoctorId: appointment.doctorId,
    diagnosis: data.diagnosis,
    prescriptions: data.prescriptions,
    vitalSigns: [],
    dateRecord: new Date(),
    createdByRole: RoleEnum.DOCTOR
  });

  return { encounterId: encounter._id };
}
```

## Frontend Updates

### DTO Extensions (patient-profile.dto.ts)
```typescript
export interface PatientProfileDto {
  // Legacy (backward compatible)
  medicalRecord?: MedicalRecordDto;
  
  // New collections (optional)
  medicalProfile?: MedicalProfile;
  encounters?: MedicalEncounter[];
  allergies?: AllergyRecord[];
  medicalHistory?: MedicalHistoryRecord[];
}
```

### Component Updates
- `medical-record-display.tsx`: Prioritizes `user.medicalProfile` over `user.medicalRecord`
- `medical-record-detail.tsx`: Supports both `user` and `medicalRecord` props
- `user-content.tsx`: Checks all collections for data presence

## Rollback Strategy

If migration fails, legacy `patient.medicalRecord` remains intact:

```javascript
// Rollback: Remove medicalProfileId reference
db.patients.updateMany(
  {},
  { $unset: { medicalProfileId: "" } }
)

// Rollback: Drop new collections (⚠️ DATA LOSS)
db.medicalprofiles.drop()
db.allergyrecords.drop()
db.medicalhistoryrecords.drop()
db.medicalencounters.drop()
```

## Testing Checklist

- [ ] Backup database before migration
- [ ] Run single patient migration on test data
- [ ] Verify all 4 new collections populated
- [ ] Check patient.medicalProfileId reference updated
- [ ] Test BE API: `GET /patients/profile/:profileId` returns extended DTO
- [ ] Test FE: Profile page displays new data (height/weight/bloodType)
- [ ] Test FE: Medical detail page shows allergies/history/encounters
- [ ] Verify legacy medicalRecord still accessible (backward compat)
- [ ] Run bulk migration on production replica
- [ ] Monitor BE logs for "Patient info fetched with new collections"

## Maintenance

### Future Appointments
New appointments automatically create `MedicalEncounter` documents via `appointment.service.ts.completeAppointment()`. No manual migration needed.

### Legacy Data
Keep `patient.medicalRecord` for backward compatibility until all clients updated. Can be removed in v2.0.

### Indexes
Add indexes for performance:
```javascript
db.allergyrecords.createIndex({ patientId: 1 })
db.medicalhistoryrecords.createIndex({ patientId: 1 })
db.medicalencounters.createIndex({ patientId: 1 })
db.medicalencounters.createIndex({ appointmentId: 1 }, { unique: true })
```

## Support

For issues, check:
1. BE logs: "Patient info fetched with new collections"
2. FE console: "Received user profile with new collections"
3. MongoDB logs for duplicate key errors (appointmentId unique constraint)
4. DTO validation errors (missing required fields)
