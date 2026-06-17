import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Account, AccountSchema } from 'src/account/schemas/account.schema';
import { Patient, PatientSchema } from 'src/patient/schema/patient.schema';
import { Profile, ProfileSchema } from 'src/profile/schema/profile.schema';
import { CoinModule } from './coin/coin.module';
import { CreditModule } from './credit/credit.module';
import { WalletTransaction, WalletTransactionSchema } from './schemas/wallet-transaction.schema';
import { Wallet, WalletSchema } from './schemas/wallet.schema';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';

@Module({
  imports: [
    CoinModule,
    CreditModule,
    MongooseModule.forFeature([
      { name: Wallet.name, schema: WalletSchema },
      { name: WalletTransaction.name, schema: WalletTransactionSchema },
      { name: Patient.name, schema: PatientSchema },
      { name: Profile.name, schema: ProfileSchema },
      { name: Account.name, schema: AccountSchema },
    ]),
  ],
  controllers: [WalletController],
  providers: [WalletService],
  exports: [WalletService, CoinModule, CreditModule],
})
export class WalletModule {}
