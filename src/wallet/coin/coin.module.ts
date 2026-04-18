import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Account, AccountSchema } from 'src/account/schemas/account.schema';
import { RedisService } from 'src/common/redis/redis.service';
import { Patient, PatientSchema } from 'src/patient/schema/patient.schema';
import { Profile, ProfileSchema } from 'src/profile/schema/profile.schema';
import { CoinExpiryReminderQueueConsumer } from './coin-expiry-reminder/coin-expiry-reminder.queue-consumer';
import { CoinExpiryReminderSchedulerService } from './coin-expiry-reminder/coin-expiry-reminder.scheduler.service';
import { CoinExpiryReminderService } from './coin-expiry-reminder/coin-expiry-reminder.service';
import { CoinExpiryReminderRealtimeListener } from './coin-expiry-reminder/listenners/coin-expiry-reminder-realtime.listenner';
import { CoinJobSchedule, CoinJobScheduleSchema } from './coin-expiry-reminder/schemas/coin-job-schedule.schema';
import { CoinService } from './coin.service';
import { CoinSpendAllocation, CoinSpendAllocationSchema } from './schemas/coin-spend-allocation.schema';
import { CoinTransaction, CoinTransactionSchema } from './schemas/coin-transaction.schema';
import { CoinWallet, CoinWalletSchema } from './schemas/coin-wallet.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CoinWallet.name, schema: CoinWalletSchema },
      { name: CoinTransaction.name, schema: CoinTransactionSchema },
      { name: CoinSpendAllocation.name, schema: CoinSpendAllocationSchema },
      { name: CoinJobSchedule.name, schema: CoinJobScheduleSchema },
      { name: Patient.name, schema: PatientSchema },
      { name: Profile.name, schema: ProfileSchema },
      { name: Account.name, schema: AccountSchema },
    ]),
  ],
  providers: [
    CoinService,
    CoinExpiryReminderService,
    CoinExpiryReminderSchedulerService,
    CoinExpiryReminderQueueConsumer,
    CoinExpiryReminderRealtimeListener,
    RedisService,
  ],
  exports: [CoinService, CoinExpiryReminderService],
})
export class CoinModule {}
