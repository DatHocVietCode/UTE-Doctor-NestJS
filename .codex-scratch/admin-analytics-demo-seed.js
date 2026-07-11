const fs = require('fs');
const mongoose = require('mongoose');

const SEED_TAG = 'ADMIN_ANALYTICS_DEMO_SEED_20260711';
const CONSULTATION_FEE = 100000;

function readEnv(name) {
  const text = fs.readFileSync('.env', 'utf8');
  const line = text.split(/\r?\n/).find((entry) => entry.startsWith(`${name}=`));
  if (!line) return undefined;
  return line.slice(name.length + 1).trim().replace(/^['"]|['"]$/g, '');
}

function requireLocalDevMongo(uri) {
  if (!uri) throw new Error('MONGO_DB_URI is missing');
  const parsed = new URL(uri);
  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
  const path = parsed.pathname || '';
  if (!isLocal || /prod|production|staging|stage|shared/i.test(path)) {
    throw new Error(`Refusing non-local MongoDB target: ${parsed.protocol}//${parsed.host}${path}`);
  }
  return `${parsed.protocol}//${parsed.hostname}${path}`;
}

const objectId = (value) => new mongoose.Types.ObjectId(value);

const appointmentSchema = new mongoose.Schema(
  {
    date: Number,
    scheduledAt: { type: Number, required: true },
    bookingDate: { type: Number, required: true },
    startTime: Number,
    endTime: Number,
    appointmentStatus: String,
    serviceType: String,
    consultationFee: Number,
    paymentCategory: String,
    depositAmount: Number,
    depositStatus: String,
    depositPaidAmount: Number,
    coinDiscountAmount: Number,
    paymentAmount: Number,
    paidAt: Date,
    paymentResponseCode: String,
    paymentTransactionStatus: String,
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true },
    patientEmail: String,
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor' },
    reasonForAppointment: String,
    specialtyId: { type: mongoose.Schema.Types.ObjectId, ref: 'ChuyenKhoa' },
    paymentMethod: String,
    hospitalName: String,
    assignmentStatus: String,
  },
  { timestamps: true },
);

const visitSchema = new mongoose.Schema(
  {
    appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', required: true, unique: true },
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor', required: true },
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true },
    status: String,
    startedAt: Number,
    completedAt: Number,
  },
  { timestamps: true },
);

const billingSchema = new mongoose.Schema(
  {
    visitId: { type: mongoose.Schema.Types.ObjectId, ref: 'Visit', required: true, unique: true },
    consultationFee: { type: Number, default: 0 },
    medicationFee: { type: Number, default: 0 },
    totalAmount: { type: Number, default: 0 },
    insuranceAmount: { type: Number, default: 0 },
    depositUsed: { type: Number, default: 0 },
    creditUsed: { type: Number, default: 0 },
    coinUsed: { type: Number, default: 0 },
    finalPayable: { type: Number, default: 0 },
    paymentCategory: String,
    medications: [
      {
        medicineId: { type: mongoose.Schema.Types.ObjectId, ref: 'Medicine', required: false },
        medicineName: { type: String, required: true },
        prescribedQty: { type: Number, required: true },
        dispensedQty: { type: Number, required: true },
        unitPrice: { type: Number, required: true },
        source: { type: String, enum: ['CLINIC', 'OUTSIDE_PURCHASE'], default: 'CLINIC' },
        lineTotal: { type: Number, required: true },
        _id: false,
      },
    ],
    status: String,
  },
  { timestamps: true },
);

const reviewSchema = new mongoose.Schema(
  {
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor', required: true },
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true },
    appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', required: true },
    rating: { type: Number, required: true, min: 1, max: 10 },
    comment: String,
  },
  { timestamps: true },
);

const Appointment = mongoose.model('Appointment', appointmentSchema);
const Visit = mongoose.model('Visit', visitSchema);
const Billing = mongoose.model('Billing', billingSchema);
const Review = mongoose.model('Review', reviewSchema);

const doctors = [
  { id: '68ed269b59e0a4da8a1d9bf9', specialtyId: '68dd33fbb95fe8743a3c59b8', weight: 5 },
  { id: '68ed269b59e0a4da8a1d9be5', specialtyId: '68dd33fbb95fe8743a3c59b7', weight: 5 },
  { id: '68ed269b59e0a4da8a1d9bdb', specialtyId: '68dd33fbb95fe8743a3c59bc', weight: 4 },
  { id: '68ed269b59e0a4da8a1d9bfe', specialtyId: '68dd33fbb95fe8743a3c59c0', weight: 4 },
  { id: '690752937155084eb9687457', specialtyId: '68dd33fbb95fe8743a3c59bd', weight: 4 },
  { id: '68ed269b59e0a4da8a1d9bf4', specialtyId: '68dd33fbb95fe8743a3c59be', weight: 3 },
  { id: '68ed269b59e0a4da8a1d9bea', specialtyId: '68dd33fbb95fe8743a3c59bf', weight: 3 },
  { id: '68ed269b59e0a4da8a1d9bef', specialtyId: '68dd33fbb95fe8743a3c59ba', weight: 2 },
  { id: '68ed269b59e0a4da8a1d9be0', specialtyId: '68dd33fbb95fe8743a3c59b9', weight: 2 },
];

const patients = [
  '6a522731defe1ed742ee16ec',
  '6a522731defe1ed742ee16ed',
  '69072256c93dc4f67dfbd524',
  '6a522731defe1ed742ee16ee',
  '6a522731defe1ed742ee16ef',
  '6a522731defe1ed742ee16f0',
];

const medicines = [
  { id: '692172176fbf57696b915b18', name: 'Acemuc 200mg', unitPrice: 9000 },
  { id: '692172176fbf57696b915af8', name: 'Ambroxol 30mg', unitPrice: 5500 },
  { id: '692172176fbf57696b915ada', name: 'Amoxicillin + Clavulanic acid', unitPrice: 14000 },
  { id: '692172176fbf57696b915ae6', name: 'Aspirin 100mg', unitPrice: 6000 },
  { id: '692172176fbf57696b915ac8', name: 'Amlodipine 5mg', unitPrice: 6000 },
  { id: '692172176fbf57696b915acc', name: 'Atorvastatin 10mg', unitPrice: 6500 },
  { id: '692172176fbf57696b915ad8', name: 'Bisoprolol 5mg', unitPrice: 6500 },
  { id: '692172176fbf57696b915b0e', name: 'Artificial Tears', unitPrice: 18000 },
  { id: '692172176fbf57696b915afe', name: 'Enterogermina', unitPrice: 18000 },
  { id: '692172176fbf57696b915b0d', name: 'Eye drop Tobrex', unitPrice: 24000 },
  { id: '692172176fbf57696b915abc', name: 'Diclofenac 50mg', unitPrice: 6000 },
  { id: '692172176fbf57696b915ae2', name: 'Esomeprazole 40mg', unitPrice: 10000 },
];

function makeClinicLine(index, boost = 0) {
  const med = medicines[index % medicines.length];
  const qty = 2 + ((index + boost) % 5);
  return {
    medicineId: objectId(med.id),
    medicineName: med.name,
    prescribedQty: qty,
    dispensedQty: qty,
    unitPrice: med.unitPrice,
    source: 'CLINIC',
    lineTotal: qty * med.unitPrice,
  };
}

function makeExternalLine(index) {
  const med = medicines[(index + 5) % medicines.length];
  const qty = 1 + (index % 4);
  return {
    medicineId: objectId(med.id),
    medicineName: med.name,
    prescribedQty: qty,
    dispensedQty: 0,
    unitPrice: med.unitPrice,
    source: 'OUTSIDE_PURCHASE',
    lineTotal: 0,
  };
}

function daysAgo(days, hour, minute) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  date.setUTCHours(hour, minute, 0, 0);
  return date;
}

function expandDoctorPlan() {
  const plan = [];
  for (const doctor of doctors) {
    for (let i = 0; i < doctor.weight; i += 1) plan.push(doctor);
  }
  return plan;
}

async function assertReferencesExist(db) {
  const doctorIds = doctors.map((doctor) => objectId(doctor.id));
  const patientIds = patients.map(objectId);
  const medicineIds = medicines.map((medicine) => objectId(medicine.id));
  const [doctorCount, patientCount, medicineCount] = await Promise.all([
    db.collection('doctors').countDocuments({ _id: { $in: doctorIds } }),
    db.collection('patients').countDocuments({ _id: { $in: patientIds } }),
    db.collection('medicines').countDocuments({ _id: { $in: medicineIds } }),
  ]);
  if (doctorCount !== doctorIds.length) throw new Error(`Expected ${doctorIds.length} doctors, found ${doctorCount}`);
  if (patientCount !== patientIds.length) throw new Error(`Expected ${patientIds.length} patients, found ${patientCount}`);
  if (medicineCount !== medicineIds.length) throw new Error(`Expected ${medicineIds.length} medicines, found ${medicineCount}`);
}

async function main() {
  const uri = readEnv('MONGO_DB_URI');
  const safeTarget = requireLocalDevMongo(uri);
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  console.log(`Verified local Mongo target: ${safeTarget}`);

  const existingSeeded = await Appointment.countDocuments({ reasonForAppointment: SEED_TAG });
  if (existingSeeded > 0) {
    throw new Error(`${SEED_TAG} already appears on ${existingSeeded} appointments; refusing duplicate one-off seed.`);
  }

  await assertReferencesExist(db);

  const doctorPlan = expandDoctorPlan();
  const appointmentDocs = [];
  const billableIndexes = new Set(Array.from({ length: 32 }, (_, index) => index));
  const oldBillingIndexes = new Set([28, 29, 30, 31]);

  for (let index = 0; index < 36; index += 1) {
    const doctor = doctorPlan[index % doctorPlan.length];
    const patientId = patients[index % patients.length];
    const isOld = oldBillingIndexes.has(index) || index >= 32;
    const date = isOld ? daysAgo(118 + (index % 6), 2 + (index % 7), (index * 7) % 60) : daysAgo(7 + index * 2, 2 + (index % 7), (index * 7) % 60);
    const scheduledAt = date.getTime();
    appointmentDocs.push({
      date: scheduledAt,
      scheduledAt,
      bookingDate: scheduledAt - 3 * 24 * 60 * 60 * 1000,
      startTime: scheduledAt,
      endTime: scheduledAt + 30 * 60 * 1000,
      appointmentStatus: 'COMPLETED',
      serviceType: 'KHAM_DICH_VU',
      consultationFee: CONSULTATION_FEE,
      paymentCategory: 'DICH_VU',
      depositAmount: 0,
      depositStatus: 'NOT_REQUIRED',
      depositPaidAmount: 0,
      coinDiscountAmount: 0,
      paymentAmount: CONSULTATION_FEE,
      paidAt: date,
      paymentResponseCode: '00',
      paymentTransactionStatus: 'SUCCESS',
      patientId: objectId(patientId),
      patientEmail: `admin-analytics-demo-${index + 1}@local.test`,
      doctorId: objectId(doctor.id),
      reasonForAppointment: SEED_TAG,
      specialtyId: objectId(doctor.specialtyId),
      paymentMethod: 'CASH',
      hospitalName: 'UTE Doctor Demo Clinic',
      assignmentStatus: 'NONE',
      createdAt: new Date(scheduledAt - 3 * 24 * 60 * 60 * 1000),
      updatedAt: new Date(scheduledAt + 60 * 60 * 1000),
    });
  }

  const appointments = await Appointment.insertMany(appointmentDocs, { ordered: true });

  const visitDocs = appointments.map((appointment, index) => ({
    appointmentId: appointment._id,
    doctorId: appointment.doctorId,
    patientId: appointment.patientId,
    status: 'COMPLETED',
    startedAt: appointment.scheduledAt,
    completedAt: appointment.scheduledAt + 45 * 60 * 1000,
    createdAt: new Date(appointment.scheduledAt),
    updatedAt: new Date(appointment.scheduledAt + 45 * 60 * 1000),
  }));
  const visits = await Visit.insertMany(visitDocs, { ordered: true });

  const billingDocs = [];
  for (let index = 0; index < visits.length; index += 1) {
    if (!billableIndexes.has(index)) continue;
    const appointment = appointments[index];
    const lines = [makeClinicLine(index, 0), makeClinicLine(index + 3, 2)];
    if (index % 3 === 0 || index % 5 === 0) lines.push(makeExternalLine(index));
    const medicationFee = lines.reduce((sum, line) => sum + line.lineTotal, 0);
    const totalAmount = CONSULTATION_FEE + medicationFee;
    billingDocs.push({
      visitId: visits[index]._id,
      consultationFee: CONSULTATION_FEE,
      medicationFee,
      totalAmount,
      insuranceAmount: 0,
      depositUsed: 0,
      creditUsed: 0,
      coinUsed: 0,
      finalPayable: totalAmount,
      paymentCategory: 'DICH_VU',
      medications: lines,
      status: 'PAID',
      createdAt: new Date(appointment.scheduledAt + 55 * 60 * 1000),
      updatedAt: new Date(appointment.scheduledAt + 65 * 60 * 1000),
    });
  }
  const billings = await Billing.insertMany(billingDocs, { ordered: true });

  const ratings = [9, 8, 7, 10, 6, 8, 9, 5, 7, 10, 8, 6, 9, 7, 8, 4, 10, 6];
  const reviewDocs = ratings.map((rating, index) => ({
    doctorId: appointments[index].doctorId,
    patientId: appointments[index].patientId,
    appointmentId: appointments[index]._id,
    rating,
    comment: `${SEED_TAG}: demo rating ${rating}/10`,
    createdAt: daysAgo(10 + index * 6, 4, 0),
    updatedAt: daysAgo(10 + index * 6, 4, 5),
  }));
  const reviews = await Review.insertMany(reviewDocs, { ordered: true });

  console.log(JSON.stringify({
    inserted: {
      appointments: appointments.length,
      visits: visits.length,
      billings: billings.length,
      reviews: reviews.length,
    },
    billings: {
      paid: billings.length,
      inDefaultWindow: billingDocs.filter((billing) => billing.createdAt >= daysAgo(91, 0, 0)).length,
      olderThanDefaultWindow: billingDocs.filter((billing) => billing.createdAt < daysAgo(91, 0, 0)).length,
      externalMedicationLines: billingDocs.reduce((sum, billing) => sum + billing.medications.filter((line) => line.source === 'OUTSIDE_PURCHASE').length, 0),
    },
  }, null, 2));

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error.stack || error.message);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
