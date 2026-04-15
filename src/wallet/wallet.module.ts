import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CoinService } from './coin.service';
import { CreditService } from './credit.service';
import { CoinTransaction, CoinTransactionSchema } from './schemas/coin-transaction.schema';
import { CoinWallet, CoinWalletSchema } from './schemas/coin-wallet.schema';
import { CreditTransaction, CreditTransactionSchema } from './schemas/credit-transaction.schema';
import { CreditWallet, CreditWalletSchema } from './schemas/credit-wallet.schema';
import { WalletTransaction, WalletTransactionSchema } from './schemas/wallet-transaction.schema';
import { Wallet, WalletSchema } from './schemas/wallet.schema';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Wallet.name, schema: WalletSchema },
      { name: WalletTransaction.name, schema: WalletTransactionSchema },
      { name: CoinWallet.name, schema: CoinWalletSchema },
      { name: CoinTransaction.name, schema: CoinTransactionSchema },
      { name: CreditWallet.name, schema: CreditWalletSchema },
      { name: CreditTransaction.name, schema: CreditTransactionSchema },
    ]),
  ],
  controllers: [WalletController],
  providers: [WalletService, CoinService, CreditService],
  exports: [WalletService, CoinService, CreditService],
})
export class WalletModule {}
