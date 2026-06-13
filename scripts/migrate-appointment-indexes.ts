import 'dotenv/config';
import mongoose from 'mongoose';

/**
 * One-time migration for Phase 7/8 (broad appointments).
 *
 * The unique partial index on `appointments` ({ doctorId, date, timeSlot }) gained an
 * extra partialFilterExpression requiring `doctorId` and `timeSlot` to exist, so that
 * many broad (unassigned-doctor) PENDING appointments with null doctor/slot no longer
 * collide on a single null key.
 *
 * Because the key spec is unchanged, MongoDB keeps the OLD index and reports an
 * IndexOptionsConflict when the app tries to (re)create it via autoIndex. This script
 * drops the stale index so Mongoose autoIndex can rebuild it with the new options.
 *
 * Safe to run multiple times: it is a no-op if the index is already absent.
 *
 * Usage: npm run migrate:appointment-indexes
 */
const COLLECTION = 'appointments';
const INDEX_NAME = 'doctorId_1_date_1_timeSlot_1';

async function main() {
  const mongoUri = process.env.MONGO_DB_URI;
  if (!mongoUri) {
    throw new Error('MONGO_DB_URI is required');
  }

  await mongoose.connect(mongoUri);

  try {
    const collection = mongoose.connection.collection(COLLECTION);
    const indexes = await collection.indexes();
    const existing = indexes.find((idx) => idx.name === INDEX_NAME);

    if (!existing) {
      console.log(`[migrate-appointment-indexes] Index "${INDEX_NAME}" not found; nothing to drop.`);
      return;
    }

    console.log(
      `[migrate-appointment-indexes] Dropping stale index "${INDEX_NAME}" with options:`,
      JSON.stringify(existing.partialFilterExpression ?? {}),
    );
    await collection.dropIndex(INDEX_NAME);
    console.log(
      `[migrate-appointment-indexes] Dropped. The app will rebuild it with the new ` +
        `partialFilterExpression on next start (autoIndex) or via syncIndexes().`,
    );
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error('[migrate-appointment-indexes] Failed:', error?.message || error);
  process.exit(1);
});
