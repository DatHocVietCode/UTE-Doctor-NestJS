import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import mongoose, { Schema, Types } from 'mongoose';

const DOCTOR_ROLE = 'DOCTOR';
const ACTIVE_STATUS = 'ACTIVE';
const DEV_DEFAULT_PASSWORD = 'Doctor@123456';

type Summary = {
  totalDoctorsScanned: number;
  alreadyValid: number;
  profilesCreated: number;
  accountsCreated: number;
  doctorsLinked: number;
  accountsLinked: number;
  accountsActivated: number;
  skippedInvalid: number;
  warnings: string[];
  errors: string[];
};

type DoctorDoc = {
  _id: Types.ObjectId;
  profileId?: Types.ObjectId | null;
  accountId?: Types.ObjectId | null;
  doctorName?: string;
};

type ProfileDoc = {
  _id: Types.ObjectId;
  name?: string;
  email?: string;
  phone?: string;
};

type AccountDoc = {
  _id: Types.ObjectId;
  profileId?: Types.ObjectId | null;
  role?: string;
  email?: string;
  password?: string;
  status?: string;
};

const doctorSchema = new Schema(
  {
    profileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', default: null },
    doctorName: { type: String },
  },
  { collection: 'doctors', timestamps: true, strict: false },
);

const profileSchema = new Schema(
  {
    name: { type: String, default: '' },
    address: { type: String, default: '' },
    phone: { type: String, default: '' },
    email: { type: String, default: '' },
    gender: { type: String, default: '' },
    dob: { type: Date, default: null },
    avatarUrl: { type: String, default: '' },
  },
  { collection: 'profiles', timestamps: true, strict: false },
);

const accountSchema = new Schema(
  {
    profileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    role: { type: String, required: true, default: 'PATIENT' },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    refreshToken: { type: String },
    accessToken: { type: String },
    status: { type: String, default: 'INACTIVE' },
    otp: { type: String, default: null },
    otpCreatedAt: { type: Date, default: null },
    otpExpiredAt: { type: Date, default: null },
  },
  { collection: 'accounts', timestamps: true, strict: false },
);

const DoctorModel = mongoose.model<DoctorDoc>('DoctorSyncDoctor', doctorSchema);
const ProfileModel = mongoose.model<ProfileDoc>('DoctorSyncProfile', profileSchema);
const AccountModel = mongoose.model<AccountDoc>('DoctorSyncAccount', accountSchema);

function hasArg(name: string): boolean {
  return process.argv.includes(name);
}

function envFlag(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return defaultValue;
  return ['1', 'true', 'yes', 'y'].includes(raw.toLowerCase());
}

function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function id(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Types.ObjectId) return value.toString();
  if (typeof value === 'object' && value !== null && '_id' in value) {
    return id((value as { _id?: unknown })._id);
  }
  const raw = String(value);
  return Types.ObjectId.isValid(raw) ? raw : null;
}

function sameId(a: unknown, b: unknown): boolean {
  const left = id(a);
  const right = id(b);
  return !!left && !!right && left === right;
}

function displayId(value: unknown): string {
  return id(value) ?? String(value ?? 'null');
}

function createSummary(): Summary {
  return {
    totalDoctorsScanned: 0,
    alreadyValid: 0,
    profilesCreated: 0,
    accountsCreated: 0,
    doctorsLinked: 0,
    accountsLinked: 0,
    accountsActivated: 0,
    skippedInvalid: 0,
    warnings: [],
    errors: [],
  };
}

function warn(summary: Summary, message: string) {
  summary.warnings.push(message);
  console.warn(`[sync-doctor-accounts] WARN ${message}`);
}

function error(summary: Summary, message: string) {
  summary.errors.push(message);
  console.error(`[sync-doctor-accounts] ERROR ${message}`);
}

function skip(summary: Summary, doctorId: unknown, reason: string) {
  summary.skippedInvalid += 1;
  warn(summary, `doctor=${displayId(doctorId)} skipped: ${reason}`);
}

async function findDoctorUsingProfile(profileId: Types.ObjectId, exceptDoctorId: Types.ObjectId) {
  return DoctorModel.findOne({ profileId, _id: { $ne: exceptDoctorId } }).lean<DoctorDoc>().exec();
}

async function findDoctorUsingAccount(accountId: Types.ObjectId, exceptDoctorId: Types.ObjectId) {
  return DoctorModel.findOne({ accountId, _id: { $ne: exceptDoctorId } }).lean<DoctorDoc>().exec();
}

async function loadById<T>(model: mongoose.Model<T>, value: unknown): Promise<T | null> {
  const objectId = id(value);
  if (!objectId) return null;
  return model.findById(objectId).lean<T>().exec();
}

function assertSafeConfig(apply: boolean): string {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const configuredPassword = process.env.DOCTOR_SYNC_DEFAULT_PASSWORD;
  const allowProduction = envFlag('DOCTOR_SYNC_ALLOW_PRODUCTION', false);

  if (nodeEnv === 'production' && apply && !allowProduction) {
    throw new Error(
      'Refusing to apply in NODE_ENV=production unless DOCTOR_SYNC_ALLOW_PRODUCTION=true is set.',
    );
  }

  if (nodeEnv === 'production' && apply && !configuredPassword) {
    throw new Error(
      'Refusing to create production doctor accounts without DOCTOR_SYNC_DEFAULT_PASSWORD.',
    );
  }

  return configuredPassword || DEV_DEFAULT_PASSWORD;
}

async function syncDoctor(doctor: DoctorDoc, hashedPassword: string, apply: boolean, summary: Summary) {
  const doctorId = doctor._id;
  let profile = await loadById(ProfileModel, doctor.profileId);
  let linkedAccount = await loadById(AccountModel, doctor.accountId);

  const profileEmail = normalizeEmail(profile?.email);
  const linkedAccountEmail = normalizeEmail(linkedAccount?.email);
  const candidateEmail = profileEmail || linkedAccountEmail;

  if (!candidateEmail) {
    skip(summary, doctorId, 'missing profile/account email; cannot create a login identity safely');
    return;
  }

  if (profileEmail && linkedAccountEmail && profileEmail !== linkedAccountEmail) {
    skip(
      summary,
      doctorId,
      `profile email ${profileEmail} does not match linked account email ${linkedAccountEmail}`,
    );
    return;
  }

  let account = await AccountModel.findOne({ email: candidateEmail }).lean<AccountDoc>().exec();

  if (linkedAccount && account && !sameId(linkedAccount._id, account._id)) {
    skip(
      summary,
      doctorId,
      `doctor.accountId=${displayId(linkedAccount._id)} conflicts with account email owner=${displayId(account._id)}`,
    );
    return;
  }

  if (!account && linkedAccount) {
    account = linkedAccount;
  }

  if (account && account.role && account.role !== DOCTOR_ROLE) {
    skip(summary, doctorId, `email ${candidateEmail} belongs to non-doctor role ${account.role}`);
    return;
  }

  if (account) {
    const accountOwner = await findDoctorUsingAccount(account._id, doctorId);
    if (accountOwner) {
      skip(
        summary,
        doctorId,
        `account ${displayId(account._id)} is already linked to doctor ${displayId(accountOwner._id)}`,
      );
      return;
    }
  }

  if (profile) {
    const profileOwner = await findDoctorUsingProfile(profile._id, doctorId);
    if (profileOwner) {
      skip(
        summary,
        doctorId,
        `profile ${displayId(profile._id)} is already linked to doctor ${displayId(profileOwner._id)}`,
      );
      return;
    }
  }

  if (!profile && account?.profileId) {
    const accountProfile = await loadById(ProfileModel, account.profileId);
    if (accountProfile) {
      const accountProfileEmail = normalizeEmail(accountProfile.email);
      if (accountProfileEmail && accountProfileEmail !== candidateEmail) {
        skip(
          summary,
          doctorId,
          `account.profileId email ${accountProfileEmail} conflicts with candidate email ${candidateEmail}`,
        );
        return;
      }
      const profileOwner = await findDoctorUsingProfile(accountProfile._id, doctorId);
      if (profileOwner) {
        skip(
          summary,
          doctorId,
          `account profile ${displayId(accountProfile._id)} is already linked to doctor ${displayId(profileOwner._id)}`,
        );
        return;
      }
      profile = accountProfile;
    }
  }

  if (
    profile &&
    account &&
    sameId(doctor.profileId, profile._id) &&
    sameId(doctor.accountId, account._id) &&
    sameId(account.profileId, profile._id) &&
    account.role === DOCTOR_ROLE &&
    account.status === ACTIVE_STATUS
  ) {
    summary.alreadyValid += 1;
    console.log(`[sync-doctor-accounts] doctor=${displayId(doctorId)} already valid (${candidateEmail})`);
    return;
  }

  if (!apply) {
    console.log(
      `[sync-doctor-accounts] DRY-RUN doctor=${displayId(doctorId)} would sync email=${candidateEmail}`,
    );
    if (!profile) summary.profilesCreated += 1;
    if (!account) summary.accountsCreated += 1;
    if (!account || !profile || !sameId(doctor.profileId, profile._id) || !sameId(doctor.accountId, account._id)) {
      summary.doctorsLinked += 1;
    }
    if (account && profile && !sameId(account.profileId, profile._id)) summary.accountsLinked += 1;
    if (account && account.status !== ACTIVE_STATUS) summary.accountsActivated += 1;
    return;
  }

  if (!profile) {
    profile = await ProfileModel.create({
      name: doctor.doctorName || candidateEmail,
      email: candidateEmail,
    });
    summary.profilesCreated += 1;
    console.log(`[sync-doctor-accounts] doctor=${displayId(doctorId)} created profile=${displayId(profile._id)}`);
  }

  if (!account) {
    account = await AccountModel.create({
      email: candidateEmail,
      password: hashedPassword,
      role: DOCTOR_ROLE,
      profileId: profile._id,
      status: ACTIVE_STATUS,
    });
    summary.accountsCreated += 1;
    console.log(`[sync-doctor-accounts] doctor=${displayId(doctorId)} created account=${displayId(account._id)}`);
  } else {
    const accountUpdates: Record<string, unknown> = {};
    if (!account.role) accountUpdates.role = DOCTOR_ROLE;
    if (!sameId(account.profileId, profile._id)) accountUpdates.profileId = profile._id;
    if (account.status !== ACTIVE_STATUS) accountUpdates.status = ACTIVE_STATUS;

    if (Object.keys(accountUpdates).length > 0) {
      await AccountModel.updateOne({ _id: account._id }, { $set: accountUpdates }).exec();
      if (accountUpdates.profileId) summary.accountsLinked += 1;
      if (accountUpdates.status) summary.accountsActivated += 1;
      console.log(`[sync-doctor-accounts] doctor=${displayId(doctorId)} updated account=${displayId(account._id)}`);
    }
  }

  const doctorUpdates: Record<string, unknown> = {};
  if (!sameId(doctor.profileId, profile._id)) doctorUpdates.profileId = profile._id;
  if (!sameId(doctor.accountId, account._id)) doctorUpdates.accountId = account._id;

  if (Object.keys(doctorUpdates).length > 0) {
    await DoctorModel.updateOne({ _id: doctor._id }, { $set: doctorUpdates }).exec();
    summary.doctorsLinked += 1;
    console.log(`[sync-doctor-accounts] doctor=${displayId(doctorId)} linked profile/account`);
  }
}

async function main() {
  const apply = hasArg('--apply') || envFlag('DOCTOR_SYNC_DRY_RUN', true) === false;
  const password = assertSafeConfig(apply);
  const mongoUri = process.env.MONGO_DB_URI;

  if (!mongoUri) {
    throw new Error('MONGO_DB_URI is required');
  }

  const summary = createSummary();
  console.log(`[sync-doctor-accounts] mode=${apply ? 'apply' : 'dry-run'}`);
  if (!apply) {
    console.log('[sync-doctor-accounts] No writes will be made. Pass --apply or DOCTOR_SYNC_DRY_RUN=false to write.');
  }

  await mongoose.connect(mongoUri);

  try {
    const doctors = await DoctorModel.find({}).lean<DoctorDoc[]>().exec();
    summary.totalDoctorsScanned = doctors.length;
    const hashedPassword = await bcrypt.hash(password, 10);

    for (const doctor of doctors) {
      try {
        await syncDoctor(doctor, hashedPassword, apply, summary);
      } catch (err: any) {
        error(summary, `doctor=${displayId(doctor._id)} failed: ${err?.message || err}`);
      }
    }

    console.log('[sync-doctor-accounts] Summary:');
    console.log(JSON.stringify(summary, null, 2));

    if (summary.errors.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error('[sync-doctor-accounts] Failed:', err?.message || err);
  process.exit(1);
});
