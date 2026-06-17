import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CreditService } from './credit.service';
import { CreditTransaction, CreditTransactionSchema } from './schemas/credit-transaction.schema';
import { CreditWallet, CreditWalletSchema } from './schemas/credit-wallet.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CreditWallet.name, schema: CreditWalletSchema },
      { name: CreditTransaction.name, schema: CreditTransactionSchema },
    ]),
  ],
  providers: [CreditService],
  exports: [CreditService],
})
export class CreditModule {}
