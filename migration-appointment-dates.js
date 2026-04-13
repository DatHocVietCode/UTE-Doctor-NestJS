// MongoDB Migration Script: Convert appointment.date from Date/string to epoch milliseconds
// Run this script using: mongosh <your-database-name> migration-appointment-dates.js

print('========================================');
print('MIGRATION: Appointments date to epoch');
print('========================================\n');

let total = 0;
let updated = 0;
let skipped = 0;
let failed = 0;

const cursor = db.appointments.find({}, { date: 1 });

cursor.forEach((appointment) => {
  total += 1;

  try {
    if (typeof appointment.date === 'number' && Number.isFinite(appointment.date)) {
      skipped += 1;
      return;
    }

    const normalizedDate = new Date(appointment.date);
    if (Number.isNaN(normalizedDate.getTime())) {
      failed += 1;
      print(`  FAIL Invalid date for appointment ${appointment._id}: ${appointment.date}`);
      return;
    }

    db.appointments.updateOne(
      { _id: appointment._id },
      {
        $set: {
          date: normalizedDate.getTime(),
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
print(`Updated to epoch: ${updated}`);
print(`Already epoch: ${skipped}`);
print(`Failed: ${failed}`);
print('========================================');
print('Migration completed');
print('========================================');
