// MongoDB Migration Script: Migrate ALL patients' legacy medical records to new collections
// Run this script using: mongosh <your-database-name> migration-all-patients.js
// WARNING: This will process ALL patients in the database

print("========================================");
print("BULK MIGRATION: Legacy → New Medical Records Schema");
print("========================================\n");

let totalPatients = 0;
let migratedCount = 0;
let errorCount = 0;

// Get all patients with medicalRecord data
const patients = db.patients.find({
  "medicalRecord": { $exists: true }
}).toArray();

totalPatients = patients.length;
print(`Found ${totalPatients} patients to migrate\n`);

patients.forEach((patient, index) => {
  try {
    print(`\n[${index + 1}/${totalPatients}] Processing patient: ${patient._id}`);
    
    const patientId = patient._id;
    const medicalRecord = patient.medicalRecord || {};
    
    // Step 1: Create MedicalProfile if height/weight/bloodType exists
    if (medicalRecord.height || medicalRecord.weight || medicalRecord.bloodType) {
      const existingProfile = db.medicalprofiles.findOne({ patientId: patientId });
      
      if (!existingProfile) {
        const profileData = {
          patientId: patientId,
          height: medicalRecord.height || patient.height || null,
          weight: medicalRecord.weight || patient.weight || null,
          bloodType: medicalRecord.bloodType || patient.bloodType || null,
          createdByRole: "PATIENT",
          createdByAccountId: patient.accountId || null,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        
        const profileResult = db.medicalprofiles.insertOne(profileData);
        print(`  ✓ MedicalProfile created: ${profileResult.insertedId}`);
        
        // Update patient with medicalProfileId
        db.patients.updateOne(
          { _id: patientId },
          { $set: { medicalProfileId: profileResult.insertedId } }
        );
      } else {
        print(`  → MedicalProfile already exists, skipping`);
      }
    }
    
    // Step 2: Migrate drug allergies
    if (medicalRecord.drugAllergies && Array.isArray(medicalRecord.drugAllergies)) {
      medicalRecord.drugAllergies.forEach(allergy => {
        // Check if already migrated (avoid duplicates)
        const exists = db.allergyrecords.findOne({
          patientId: patientId,
          type: "DRUG",
          substance: allergy.diagnosis || allergy.name || "Unknown"
        });
        
        if (!exists) {
          db.allergyrecords.insertOne({
            patientId: patientId,
            type: "DRUG",
            substance: allergy.diagnosis || allergy.name || "Unknown",
            reaction: allergy.note || null,
            severity: null,
            reportedBy: "PATIENT",
            verifiedByDoctor: false,
            createdByRole: "PATIENT",
            createdByAccountId: patient.accountId || null,
            createdAt: allergy.dateRecord ? new Date(allergy.dateRecord) : new Date(),
            updatedAt: new Date()
          });
          print(`  ✓ Drug allergy migrated: ${allergy.diagnosis || allergy.name}`);
        }
      });
    }
    
    // Step 3: Migrate food allergies
    if (medicalRecord.foodAllergies && Array.isArray(medicalRecord.foodAllergies)) {
      medicalRecord.foodAllergies.forEach(allergy => {
        const exists = db.allergyrecords.findOne({
          patientId: patientId,
          type: "FOOD",
          substance: allergy.diagnosis || allergy.name || "Unknown"
        });
        
        if (!exists) {
          db.allergyrecords.insertOne({
            patientId: patientId,
            type: "FOOD",
            substance: allergy.diagnosis || allergy.name || "Unknown",
            reaction: allergy.note || null,
            severity: null,
            reportedBy: "PATIENT",
            verifiedByDoctor: false,
            createdByRole: "PATIENT",
            createdByAccountId: patient.accountId || null,
            createdAt: allergy.dateRecord ? new Date(allergy.dateRecord) : new Date(),
            updatedAt: new Date()
          });
          print(`  ✓ Food allergy migrated: ${allergy.diagnosis || allergy.name}`);
        }
      });
    }
    
    // Step 4: Migrate medical history
    if (medicalRecord.medicalHistory && Array.isArray(medicalRecord.medicalHistory)) {
      medicalRecord.medicalHistory.forEach(history => {
        // If has appointmentId, create MedicalEncounter; else create MedicalHistoryRecord
        if (history.appointmentId) {
          const exists = db.medicalencounters.findOne({ appointmentId: history.appointmentId });
          
          if (!exists) {
            db.medicalencounters.insertOne({
              appointmentId: history.appointmentId,
              patientId: patientId,
              createdByDoctorId: null, // Will be filled by actual appointment data
              diagnosis: history.diagnosis || "Không có chẩn đoán",
              note: history.note || null,
              createdByRole: "DOCTOR",
              createdByAccountId: null,
              prescriptions: history.prescriptions || [],
              vitalSigns: [],
              dateRecord: history.dateRecord ? new Date(history.dateRecord) : new Date(),
              createdAt: history.dateRecord ? new Date(history.dateRecord) : new Date(),
              updatedAt: new Date()
            });
            print(`  ✓ MedicalEncounter created for appointment: ${history.appointmentId}`);
          }
        } else {
          // Create as MedicalHistoryRecord
          const exists = db.medicalhistoryrecords.findOne({
            patientId: patientId,
            conditionName: history.diagnosis || history.name || "Unknown"
          });
          
          if (!exists) {
            db.medicalhistoryrecords.insertOne({
              patientId: patientId,
              conditionName: history.diagnosis || history.name || "Unknown",
              diagnosisCode: null,
              diagnosedAt: history.dateRecord ? new Date(history.dateRecord) : new Date(),
              status: "ONGOING",
              source: "PATIENT",
              verifiedByDoctor: false,
              createdByRole: "PATIENT",
              createdByAccountId: patient.accountId || null,
              createdAt: history.dateRecord ? new Date(history.dateRecord) : new Date(),
              updatedAt: new Date()
            });
            print(`  ✓ MedicalHistoryRecord created: ${history.diagnosis || history.name}`);
          }
        }
      });
    }
    
    migratedCount++;
    print(`  ✓ Patient ${patient._id} migration completed\n`);
    
  } catch (error) {
    errorCount++;
    print(`  ✗ ERROR processing patient ${patient._id}: ${error.message}\n`);
  }
});

print("\n========================================");
print("MIGRATION SUMMARY:");
print("========================================");
print(`Total patients found: ${totalPatients}`);
print(`Successfully migrated: ${migratedCount}`);
print(`Errors: ${errorCount}`);
print("========================================");

// Show collection counts
print("\nNEW COLLECTIONS COUNT:");
print(`- MedicalProfiles: ${db.medicalprofiles.countDocuments()}`);
print(`- AllergyRecords: ${db.allergyrecords.countDocuments()}`);
print(`- MedicalHistoryRecords: ${db.medicalhistoryrecords.countDocuments()}`);
print(`- MedicalEncounters: ${db.medicalencounters.countDocuments()}`);

print("\n✓ Bulk migration completed!");
