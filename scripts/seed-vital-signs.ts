import 'dotenv/config';
import mongoose, { Schema, Types } from 'mongoose';

/**
 * Seeds ACTIVE patient vital-sign records so the patient health dashboard
 * (GET /patients/me/health-summary) can be tested before the receptionist
 * measurement-entry UI exists on the FE.
 *
 * Usage (pick ONE way to identify the patient):
 *   SEED_PATIENT_EMAIL=patient@test.com  npm run seed:vital-signs
 *   SEED_PATIENT_ID=<Patient _id>        npm run seed:vital-signs
 *   npm run seed:vital-signs -- patient@test.com
 *
 * IMPORTANT: the read endpoint reads patientId straight from the JWT
 * (user.patientId === Patient._id). This script resolves that same Patient._id,
 * so the seeded data lines up with the token of the logged-in patient.
 *
 * Re-running is safe: it first deletes this patient's previously seeded rows
 * (note starts with "[seed]") before inserting a fresh set.
 */

// ---- minimal standalone models (match existing collection names) ----
const AccountModel = mongoose.model(
  'AccountVsSeed',
  new Schema({ email: String, role: String, profileId: Schema.Types.ObjectId }, { collection: 'accounts' }),
);

const PatientModel = mongoose.model(
  'PatientVsSeed',
  new Schema(
    { accountId: Schema.Types.ObjectId, profileId: Schema.Types.ObjectId },
    { collection: 'patients', strict: false },
  ),
);

const vitalSignSchema = new Schema(
  {
    patientId: { type: Schema.Types.ObjectId, required: true, index: true },
    appointmentId: Schema.Types.ObjectId,
    visitId: Schema.Types.ObjectId,
    bloodType: String,
    heightCm: Number,
    weightKg: Number,
    bmi: Number,
    bloodPressureSystolic: Number,
    bloodPressureDiastolic: Number,
    heartRateBpm: Number,
    status: {
      type: new Schema(
        { bmi: String, bloodPressure: String, heartRate: String, weight: String },
        { _id: false },
      ),
      required: false,
    },
    source: { type: String, required: true },
    recordState: { type: String, required: true },
    measuredAt: { type: Number, required: true },
    measuredBy: {
      type: new Schema({ id: String, name: String, role: String }, { _id: false }),
      required: false,
    },
    note: String,
  },
  { collection: 'patientvitalsigns', timestamps: true },
);
const VitalSignModel = mongoose.model('PatientVitalSignSeed', vitalSignSchema);

// ---- classification (mirrors src/patient-health/patient-vital-sign.classification.ts) ----
const isPos = (v: any): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
const isNum = (v: any): v is number => typeof v === 'number' && Number.isFinite(v);

function computeBmi(heightCm?: number, weightKg?: number): number | undefined {
  if (!isPos(heightCm) || !isPos(weightKg)) return undefined;
  const m = heightCm / 100;
  return Math.round((weightKg / (m * m)) * 10) / 10;
}
function classifyBmi(bmi?: number) {
  if (!isNum(bmi)) return undefined;
  if (bmi < 18.5) return 'LOW';
  if (bmi >= 25) return 'HIGH';
  return 'NORMAL';
}
function classifyBp(s?: number, d?: number) {
  if (!isNum(s) || !isNum(d)) return undefined;
  if (s < 90 || d < 60) return 'LOW';
  if (s >= 140 || d >= 90) return 'HIGH';
  return 'NORMAL';
}
function classifyHr(b?: number) {
  if (!isNum(b)) return undefined;
  if (b < 60) return 'LOW';
  if (b > 100) return 'HIGH';
  return 'NORMAL';
}

type Sample = {
  daysAgo: number;
  heightCm?: number;
  weightKg?: number;
  bloodPressureSystolic?: number;
  bloodPressureDiastolic?: number;
  heartRateBpm?: number;
  bloodType?: string;
};

// Oldest -> newest. Demonstrates a NEEDS_ATTENTION history improving to a STABLE latest,
// plus one BP/HR-only record (no height/weight -> no BMI).
const SAMPLES: Sample[] = [
  { daysAgo: 40, heightCm: 170, weightKg: 90, bloodPressureSystolic: 150, bloodPressureDiastolic: 96, heartRateBpm: 88, bloodType: 'O' }, // bmi HIGH, BP HIGH -> NEEDS_ATTENTION
  { daysAgo: 30, heightCm: 170, weightKg: 84, bloodPressureSystolic: 138, bloodPressureDiastolic: 86, heartRateBpm: 80 }, // bmi HIGH -> NEEDS_ATTENTION
  { daysAgo: 14, bloodPressureSystolic: 122, bloodPressureDiastolic: 78, heartRateBpm: 74 }, // BP/HR only, all NORMAL -> STABLE
  { daysAgo: 7, heightCm: 170, weightKg: 74, bloodPressureSystolic: 120, bloodPressureDiastolic: 78, heartRateBpm: 72 }, // bmi 25.6 HIGH -> NEEDS_ATTENTION
  { daysAgo: 1, heightCm: 170, weightKg: 68, bloodPressureSystolic: 116, bloodPressureDiastolic: 74, heartRateBpm: 70, bloodType: 'O' }, // bmi 23.5 NORMAL -> STABLE (latest)
];

const MEASURED_BY = { id: 'seed-receptionist', name: 'Lễ tân (seed)', role: 'RECEPTIONIST' };

async function listPatientCandidates(): Promise<void> {
  const accounts = await AccountModel.find({ role: 'PATIENT' })
    .limit(20)
    .lean<{ _id: Types.ObjectId; email?: string }[]>();
  console.log('[seed-vital-signs] No patient specified. Candidate PATIENT accounts:');
  if (!accounts.length) {
    console.log('  (none found)');
    return;
  }
  for (const acc of accounts) {
    const patient = await PatientModel.findOne({ accountId: acc._id }).lean<{ _id: Types.ObjectId }>();
    console.log(
      `  email=${acc.email ?? '(none)'}  patientId=${patient?._id?.toString() ?? '(no Patient doc)'}`,
    );
  }
  console.log('\nRe-run with one of:');
  console.log('  SEED_PATIENT_EMAIL=<email> npm run seed:vital-signs');
  console.log('  SEED_PATIENT_ID=<patientId> npm run seed:vital-signs');
}

async function resolvePatientId(): Promise<Types.ObjectId | null> {
  const explicitId = process.env.SEED_PATIENT_ID?.trim();
  if (explicitId) {
    if (!Types.ObjectId.isValid(explicitId)) {
      throw new Error(`SEED_PATIENT_ID "${explicitId}" is not a valid ObjectId`);
    }
    return new Types.ObjectId(explicitId);
  }

  const email = (process.env.SEED_PATIENT_EMAIL || process.argv[2])?.trim();
  if (!email) {
    // No identifier: list candidates and let the caller decide.
    await listPatientCandidates();
    return null;
  }

  const account = await AccountModel.findOne({ email }).lean<{ _id: Types.ObjectId; role?: string }>();
  if (!account) throw new Error(`No account found for email "${email}"`);

  const patient = await PatientModel.findOne({ accountId: account._id }).lean<{ _id: Types.ObjectId }>();
  if (!patient) {
    throw new Error(
      `Account "${email}" has no Patient document (accountId=${account._id}). Log in once as this patient or create the patient profile first.`,
    );
  }
  return patient._id;
}

function buildDoc(patientId: Types.ObjectId, s: Sample) {
  const bmi = computeBmi(s.heightCm, s.weightKg);
  const status: Record<string, string> = {};
  const bmiStatus = classifyBmi(bmi);
  if (bmiStatus) status.bmi = bmiStatus;
  const bpStatus = classifyBp(s.bloodPressureSystolic, s.bloodPressureDiastolic);
  if (bpStatus) status.bloodPressure = bpStatus;
  const hrStatus = classifyHr(s.heartRateBpm);
  if (hrStatus) status.heartRate = hrStatus;

  const measuredAt = Date.now() - s.daysAgo * 24 * 60 * 60 * 1000;

  return {
    patientId,
    bloodType: s.bloodType,
    heightCm: s.heightCm,
    weightKg: s.weightKg,
    bmi,
    bloodPressureSystolic: s.bloodPressureSystolic,
    bloodPressureDiastolic: s.bloodPressureDiastolic,
    heartRateBpm: s.heartRateBpm,
    status: Object.keys(status).length ? status : undefined,
    source: 'RECEPTIONIST_CHECK_IN',
    recordState: 'ACTIVE',
    measuredAt,
    measuredBy: MEASURED_BY,
    note: '[seed] demo vital sign',
  };
}

async function main() {
  const mongoUri = process.env.MONGO_DB_URI;
  if (!mongoUri) throw new Error('MONGO_DB_URI is required');

  await mongoose.connect(mongoUri);
  try {
    const patientId = await resolvePatientId();
    if (!patientId) {
      return; // candidates were listed; nothing to seed yet
    }
    console.log(`[seed-vital-signs] Target Patient._id = ${patientId.toString()}`);

    const removed = await VitalSignModel.deleteMany({
      patientId,
      note: { $regex: /^\[seed\]/ },
    });
    if (removed.deletedCount) {
      console.log(`[seed-vital-signs] Removed ${removed.deletedCount} previously seeded record(s).`);
    }

    const docs = SAMPLES.map((s) => buildDoc(patientId, s));
    const inserted = await VitalSignModel.insertMany(docs);
    console.log(`[seed-vital-signs] Inserted ${inserted.length} ACTIVE vital-sign record(s).`);

    const latest = docs[docs.length - 1];
    console.log(
      `[seed-vital-signs] Latest record: bmi=${latest.bmi ?? '-'} status=${JSON.stringify(latest.status)}`,
    );
    console.log('[seed-vital-signs] Done. Test with: GET /api/patients/me/health-summary (patient JWT).');
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error('[seed-vital-signs] Failed:', error?.message || error);
  process.exit(1);
});
