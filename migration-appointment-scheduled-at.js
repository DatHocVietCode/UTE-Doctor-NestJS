// MongoDB Migration Script: Backfill appointment scheduledAt/startTime/endTime snapshot fields.
// Run this script using: mongosh <your-database-name> migration-appointment-scheduled-at.js

print('========================================');
print('MIGRATION: Appointments scheduledAt snapshot');
print('========================================\n');

const TIMEZONE_OFFSET_MINUTES = 7 * 60;

function pad(value) {
  return String(value).padStart(2, '0');
}

function toEpoch(input) {
  if (typeof input === 'number' && Number.isFinite(input)) {
    return input;
  }

  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime()) ? NaN : parsed.getTime();
}

function toLocalDateKeyFromEpoch(epoch) {
  const shifted = new Date(epoch + TIMEZONE_OFFSET_MINUTES * 60_000);
  return [
    shifted.getUTCFullYear(),
    pad(shifted.getUTCMonth() + 1),
    pad(shifted.getUTCDate()),
  ].join('-');
}

function combineDateKeyAndClockToUtcEpoch(dateKey, clock) {
  const dateMatch = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const clockMatch = clock.match(/^(\d{2}):(\d{2})$/);

  if (!dateMatch || !clockMatch) {
    return NaN;
  }

  const [, year, month, day] = dateMatch;
  const [, hour, minute] = clockMatch;

  return Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    0,
    0,
  ) - TIMEZONE_OFFSET_MINUTES * 60_000;
}

let total = 0;
let updated = 0;
let skipped = 0;
let failed = 0;

const cursor = db.appointments.find({}, { date: 1, scheduledAt: 1, startTime: 1, endTime: 1, timeSlot: 1 });

cursor.forEach((appointment) => {
  total += 1;

  try {
    const timeSlot = db.timeslotslog.findOne(
      { _id: appointment.timeSlot },
      { start: 1, end: 1 },
    );

    if (!timeSlot) {
      failed += 1;
      print(`  FAIL Missing timeslot for appointment ${appointment._id}`);
      return;
    }

    const baseEpoch = toEpoch(appointment.scheduledAt ?? appointment.date);
    if (!Number.isFinite(baseEpoch)) {
      failed += 1;
      print(`  FAIL Invalid base date for appointment ${appointment._id}: ${appointment.date}`);
      return;
    }

    const dateKey = toLocalDateKeyFromEpoch(baseEpoch);
    const scheduledAt = combineDateKeyAndClockToUtcEpoch(dateKey, timeSlot.start);
    const startTime = scheduledAt;
    const endTime = combineDateKeyAndClockToUtcEpoch(dateKey, timeSlot.end);

    const existingScheduledAt = toEpoch(appointment.scheduledAt);
    const existingStartTime = toEpoch(appointment.startTime);
    const existingEndTime = toEpoch(appointment.endTime);

    const alreadyMigrated =
      existingScheduledAt === scheduledAt &&
      existingStartTime === startTime &&
      existingEndTime === endTime &&
      appointment.date === scheduledAt;

    if (alreadyMigrated) {
      skipped += 1;
      return;
    }

    db.appointments.updateOne(
      { _id: appointment._id },
      {
        $set: {
          date: scheduledAt,
          scheduledAt,
          startTime,
          endTime,
          updatedAt: new Date(),
        },
      },
    );

    updated += 1;
  } catch (error) {
    failed += 1;
    print(`  FAIL Failed to migrate appointment ${appointment._id}: ${error.message}`);
  }
});

print('\n========================================');
print('MIGRATION SUMMARY:');
print('========================================');
print(`Total appointments scanned: ${total}`);
print(`Updated snapshot fields: ${updated}`);
print(`Already migrated: ${skipped}`);
print(`Failed: ${failed}`);
print('========================================');
print('Migration completed');
print('========================================');