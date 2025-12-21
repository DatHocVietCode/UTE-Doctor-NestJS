// MongoDB Migration Script: Migrate legacy medical records to new separated collections
// Run this script using: mongosh <your-database-name> migration-medical-records.js

const patientId = ObjectId("69072256c93dc4f67dfbd524");
const profileId = ObjectId("69071fcb02b2fe0c2f59d7d4");

// Step 1: Create MedicalProfile document
print("Step 1: Creating MedicalProfile...");
const medicalProfileResult = db.medicalprofiles.insertOne({
  patientId: patientId,
  height: 172,
  weight: 68,
  bloodType: "O",
  createdByRole: "PATIENT",
  createdByAccountId: null,
  createdAt: new Date(),
  updatedAt: new Date()
});

const medicalProfileId = medicalProfileResult.insertedId;
print(`✓ MedicalProfile created with ID: ${medicalProfileId}`);

// Step 2: Migrate drug allergies to AllergyRecord collection
print("\nStep 2: Migrating drug allergies...");
const drugAllergiesData = [
  {
    substance: "Penicillin G",
    reaction: "Phát ban nổi mề đay, ngứa nghiêm trọng sau 30 phút dùng thuốc",
    severity: "Nghiêm trọng"
  }
];

drugAllergiesData.forEach(allergy => {
  db.allergyrecords.insertOne({
    patientId: patientId,
    type: "DRUG",
    substance: allergy.substance,
    reaction: allergy.reaction,
    severity: allergy.severity,
    reportedBy: "PATIENT",
    verifiedByDoctor: false,
    createdByRole: "PATIENT",
    createdByAccountId: null,
    createdAt: new Date(),
    updatedAt: new Date()
  });
  print(`✓ Drug allergy added: ${allergy.substance}`);
});

// Step 3: Migrate food allergies to AllergyRecord collection
print("\nStep 3: Migrating food allergies...");
const foodAllergiesData = [
  {
    substance: "Tôm, cua (Shellfish)",
    reaction: "Sưng môi, ngứa họng, khó thở, nổi mẩn đỏ toàn thân",
    severity: "Nghiêm trọng"
  }
];

foodAllergiesData.forEach(allergy => {
  db.allergyrecords.insertOne({
    patientId: patientId,
    type: "FOOD",
    substance: allergy.substance,
    reaction: allergy.reaction,
    severity: allergy.severity,
    reportedBy: "PATIENT",
    verifiedByDoctor: false,
    createdByRole: "PATIENT",
    createdByAccountId: null,
    createdAt: new Date(),
    updatedAt: new Date()
  });
  print(`✓ Food allergy added: ${allergy.substance}`);
});

// Step 4: Migrate medical history to MedicalHistoryRecord collection
print("\nStep 4: Migrating medical history...");
const medicalHistoryData = [
  {
    conditionName: "Đái tháo đường type 2",
    diagnosisCode: "E11.9",
    diagnosedAt: new Date("2021-05-20"),
    status: "ONGOING"
  },
  {
    conditionName: "Cao huyết áp (Tăng huyết áp nguyên phát)",
    diagnosisCode: "I10",
    diagnosedAt: new Date("2020-11-15"),
    status: "ONGOING"
  }
];

medicalHistoryData.forEach(history => {
  db.medicalhistoryrecords.insertOne({
    patientId: patientId,
    conditionName: history.conditionName,
    diagnosisCode: history.diagnosisCode,
    diagnosedAt: history.diagnosedAt,
    status: history.status,
    source: "PATIENT",
    verifiedByDoctor: false,
    createdByRole: "PATIENT",
    createdByAccountId: null,
    createdAt: new Date(),
    updatedAt: new Date()
  });
  print(`✓ Medical history added: ${history.conditionName}`);
});

// Step 5: Create sample MedicalEncounter (if you have appointment data)
print("\nStep 5: Creating sample MedicalEncounter...");
// Note: Replace appointmentId with actual appointment ID if available
const sampleAppointmentId = new ObjectId(); // Or use real appointment ID
const sampleDoctorId = new ObjectId(); // Replace with real doctor ID

db.medicalencounters.insertOne({
  appointmentId: sampleAppointmentId,
  patientId: patientId,
  createdByDoctorId: sampleDoctorId,
  diagnosis: "Kiểm tra sức khỏe định kỳ - Kiểm soát đường huyết và huyết áp. Bệnh nhân có tiền sử đái tháo đường type 2 và cao huyết áp, đang điều trị ổn định.",
  note: "Bệnh nhân cần tiếp tục duy trì chế độ ăn ít đường, ít muối, tăng cường vận động 30 phút/ngày. Kiểm tra đường huyết tại nhà hàng ngày. Tái khám sau 1 tháng để đánh giá lại. Tránh dùng Penicillin và hải sản do dị ứng nghiêm trọng.",
  createdByRole: "DOCTOR",
  createdByAccountId: sampleDoctorId,
  prescriptions: [
    {
      name: "Metformin 500mg",
      quantity: 60,
      note: "Uống 1 viên x 2 lần/ngày (sáng + tối) sau ăn. Không bỏ liều."
    },
    {
      name: "Amlodipine 5mg",
      quantity: 30,
      note: "Uống 1 viên x 1 lần/ngày vào buổi sáng trước ăn, cố định giờ."
    },
    {
      name: "Vitamin B Complex",
      quantity: 30,
      note: "Uống 1 viên x 1 lần/ngày sau bữa chính."
    }
  ],
  vitalSigns: [
    {
      type: "BP",
      bloodPressure: { systolic: 138, diastolic: 88 },
      dateRecord: new Date(),
      patientId: patientId,
      appointmentId: sampleAppointmentId,
      createdByRole: "DOCTOR"
    },
    {
      type: "HR",
      value: 82,
      dateRecord: new Date(),
      patientId: patientId,
      appointmentId: sampleAppointmentId,
      createdByRole: "DOCTOR"
    }
  ],
  dateRecord: new Date(),
  createdAt: new Date(),
  updatedAt: new Date()
});
print(`✓ MedicalEncounter created for appointment: ${sampleAppointmentId}`);

// Step 6: Update Patient document with medicalProfileId reference
print("\nStep 6: Updating Patient document...");
db.patients.updateOne(
  { _id: patientId },
  {
    $set: {
      medicalProfileId: medicalProfileId,
      updatedAt: new Date()
    }
  }
);
print(`✓ Patient updated with medicalProfileId: ${medicalProfileId}`);

// Step 7: Verification queries
print("\n========================================");
print("VERIFICATION QUERIES:");
print("========================================");

print("\n1. Check MedicalProfile:");
printjson(db.medicalprofiles.findOne({ patientId: patientId }));

print("\n2. Check AllergyRecords:");
printjson(db.allergyrecords.find({ patientId: patientId }).toArray());

print("\n3. Check MedicalHistoryRecords:");
printjson(db.medicalhistoryrecords.find({ patientId: patientId }).toArray());

print("\n4. Check MedicalEncounters:");
printjson(db.medicalencounters.find({ patientId: patientId }).toArray());

print("\n5. Check Updated Patient:");
printjson(db.patients.findOne({ _id: patientId }, { medicalProfileId: 1, profileId: 1 }));

print("\n========================================");
print("✓ Migration completed successfully!");
print("========================================");
