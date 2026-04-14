// MongoDB Migration Script: Move legacy wallet coin balances to new coin wallet + coin transaction ledger.
// Run with: mongosh <db-name> migration-wallet-coin-credit.js

print('========================================');
print('MIGRATION: Legacy Wallet -> Coin Wallet');
print('========================================\n');

let total = 0;
let migratedWallets = 0;
let skippedWallets = 0;
let failedWallets = 0;

const now = new Date();

const cursor = db.wallets.find({}, {
  patientId: 1,
  coinBalance: 1,
  totalCoinEarned: 1,
  totalCoinUsed: 1,
  createdAt: 1,
  updatedAt: 1,
});

cursor.forEach((legacyWallet) => {
  total += 1;

  try {
    if (!legacyWallet.patientId) {
      failedWallets += 1;
      print(`  FAIL Missing patientId for legacy wallet ${legacyWallet._id}`);
      return;
    }

    const balance = Number(legacyWallet.coinBalance || 0);
    const earned = Number(legacyWallet.totalCoinEarned || 0);
    const used = Number(legacyWallet.totalCoinUsed || 0);

    const existingCoinWallet = db.coinwallets.findOne({ patientId: legacyWallet.patientId });

    if (!existingCoinWallet) {
      db.coinwallets.insertOne({
        patientId: legacyWallet.patientId,
        coinBalance: Math.max(0, Math.floor(balance)),
        totalCoinEarned: Math.max(0, Math.floor(earned)),
        totalCoinUsed: Math.max(0, Math.floor(used)),
        createdAt: legacyWallet.createdAt || now,
        updatedAt: now,
      });
    } else {
      // Keep the larger values to avoid accidental balance decrease if migration is re-run.
      db.coinwallets.updateOne(
        { _id: existingCoinWallet._id },
        {
          $set: {
            coinBalance: Math.max(Number(existingCoinWallet.coinBalance || 0), Math.floor(balance)),
            totalCoinEarned: Math.max(Number(existingCoinWallet.totalCoinEarned || 0), Math.floor(earned)),
            totalCoinUsed: Math.max(Number(existingCoinWallet.totalCoinUsed || 0), Math.floor(used)),
            updatedAt: now,
          },
        },
      );
    }

    // Seed one non-expiring ledger entry so old coin balance can be spent as discount after migration.
    if (balance > 0) {
      const openingTransaction = db.cointransactions.findOne({
        patientId: legacyWallet.patientId,
        reason: 'legacy_wallet_migration',
        type: 'earn',
      });

      if (!openingTransaction) {
        db.cointransactions.insertOne({
          patientId: legacyWallet.patientId,
          type: 'earn',
          amount: Math.floor(balance),
          reason: 'legacy_wallet_migration',
          description: `Migrated from legacy wallets.coinBalance (${Math.floor(balance)})`,
          status: 'completed',
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    migratedWallets += 1;
  } catch (error) {
    failedWallets += 1;
    print(`  FAIL Failed wallet ${legacyWallet._id}: ${error.message}`);
  }
});

print('\n========================================');
print('MIGRATION SUMMARY:');
print('========================================');
print(`Total legacy wallets scanned: ${total}`);
print(`Migrated/updated coin wallets: ${migratedWallets}`);
print(`Skipped: ${skippedWallets}`);
print(`Failed: ${failedWallets}`);
print('========================================');
print('NOTE: Credit wallet is intentionally not auto-funded.');
print('Refunds going forward will populate credit transactions.');
print('========================================');
