import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import mongoose, { Schema } from 'mongoose';

const seedEmail = 'receptionist@test.com';
const seedPassword = '123456';
const seedRole = 'RECEPTIONIST';

const accountSchema = new Schema(
  {
    profileId: { type: Schema.Types.ObjectId, default: null },
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
  {
    collection: 'accounts',
    timestamps: true,
  },
);

const AccountModel = mongoose.model('AccountSeed', accountSchema);

async function main() {
  const mongoUri = process.env.MONGO_DB_URI;
  if (!mongoUri) {
    throw new Error('MONGO_DB_URI is required');
  }

  await mongoose.connect(mongoUri);

  try {
    const existing = await AccountModel.findOne({ email: seedEmail }).exec();

    if (existing) {
      const updates: Record<string, unknown> = {};

      if (existing.role !== seedRole) {
        updates.role = seedRole;
      }

      if (existing.status !== 'ACTIVE') {
        updates.status = 'ACTIVE';
      }

      const isValidPassword = await bcrypt.compare(seedPassword, existing.password);
      if (!isValidPassword) {
        updates.password = await bcrypt.hash(seedPassword, 10);
      }

      if (Object.keys(updates).length > 0) {
        await AccountModel.updateOne({ _id: existing._id }, { $set: updates }).exec();
        console.log('[seed-receptionist] Existing user updated to receptionist baseline.');
      } else {
        console.log('[seed-receptionist] User already exists with expected data.');
      }

      return;
    }

    const hashedPassword = await bcrypt.hash(seedPassword, 10);

    await AccountModel.create({
      email: seedEmail,
      password: hashedPassword,
      role: seedRole,
      status: 'ACTIVE',
      profileId: null,
    });

    console.log('[seed-receptionist] Receptionist user created successfully.');
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error('[seed-receptionist] Failed:', error?.message || error);
  process.exit(1);
});
