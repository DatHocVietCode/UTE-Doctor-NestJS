import { Controller, Get, ParseIntPipe, Query, Req, UseGuards } from '@nestjs/common';
import { DataResponse } from 'src/common/dto/data-respone';
import { ResponseCode as rc } from 'src/common/enum/reponse-code.enum';
import { JwtAuthGuard } from 'src/common/guards/jws-auth.guard';
import { CoinService } from './coin.service';
import { CreditService } from './credit.service';
import { WalletService } from './wallet.service';

@Controller('wallet')
export class WalletController {
  constructor(
    private readonly walletService: WalletService,
    private readonly coinService: CoinService,
    private readonly creditService: CreditService,
  ) {}

  /**
   * Get wallet balance by patient ID
   */
  @Get('balance')
  @UseGuards(JwtAuthGuard)
  async getBalance(@Req() req: any) {
    const [coinBalance, creditBalance] = await Promise.all([
      this.walletService.getWalletBalance(req.user.patientId),
      this.creditService.getCreditBalance(req.user.patientId),
    ]);

    const res: DataResponse = {
      code: rc.SUCCESS,
      message: 'Fetched wallet balance',
      // Keep `balance` for old clients while introducing explicit fields.
      data: { balance: coinBalance, coinBalance, creditBalance },
    };
    return res;
  }

  /**
   * Get wallet details (balance + statistics + transaction history with pagination)
   */
  @Get('details')
  @UseGuards(JwtAuthGuard)
  async getWalletDetails(
    @Req() req: any,
    @Query('page', new ParseIntPipe({ optional: true })) page: number = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit: number = 10,
  ) {
    try {
      const [coinWallet, creditWallet] = await Promise.all([
        this.coinService.getOrCreateCoinWallet(req.user.patientId),
        this.creditService.getOrCreateCreditWallet(req.user.patientId),
      ]);

      if (!coinWallet || !creditWallet) {
        const res: DataResponse = {
          code: rc.ERROR,
          message: 'Wallet not found',
          data: null,
        };
        return res;
      }

      const [coinBalance, coinTransactions, coinTotal, creditTransactions, creditTotal] = await Promise.all([
        this.coinService.getAvailableCoinBalance(req.user.patientId),
        this.coinService.getCoinHistory(req.user.patientId, page, limit),
        this.coinService.getCoinTransactionCount(req.user.patientId),
        this.creditService.getCreditHistory(req.user.patientId, page, limit),
        this.creditService.getCreditTransactionCount(req.user.patientId),
      ]);

      const res: DataResponse = {
        code: rc.SUCCESS,
        message: 'Fetched wallet details successfully',
        data: {
          coinBalance,
          totalCoinEarned: coinWallet.totalCoinEarned,
          totalCoinUsed: coinWallet.totalCoinUsed,
          creditBalance: creditWallet.creditBalance,
          totalCredited: creditWallet.totalCredited,
          totalDebited: creditWallet.totalDebited,
          transactions: coinTransactions,
          creditTransactions,
          pagination: {
            page,
            limit,
            total: coinTotal,
            totalPages: Math.ceil(coinTotal / limit),
          },
          creditPagination: {
            page,
            limit,
            total: creditTotal,
            totalPages: Math.ceil(creditTotal / limit),
          },
        },
      };
      return res;
    } catch (error) {
      const res: DataResponse = {
        code: rc.ERROR,
        message: 'Failed to fetch wallet details',
        data: null,
      };
      return res;
    }
  }

  /**
    * Get expiration-aware coin summary with FEFO consumption breakdown.
   */
  @Get('coin/summary')
  @UseGuards(JwtAuthGuard)
  async getCoinSummary(@Req() req: any) {
    try {
      const summary = await this.coinService.getCoinSummary(req.user.patientId);

      const res: DataResponse = {
        code: rc.SUCCESS,
        message: 'Fetched coin summary successfully',
        data: summary,
      };
      return res;
    } catch (error) {
      const res: DataResponse = {
        code: rc.ERROR,
        message: 'Failed to fetch coin summary',
        data: null,
      };
      return res;
    }
  }
}
