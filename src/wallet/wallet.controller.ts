import { Controller, Get, ParseIntPipe, Query, Req, UseGuards } from '@nestjs/common';
import { DataResponse } from 'src/common/dto/data-respone';
import { ResponseCode as rc } from 'src/common/enum/reponse-code.enum';
import { JwtAuthGuard } from 'src/common/guards/jws-auth.guard';
import { WalletService } from './wallet.service';

@Controller('wallet')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  /**
   * Get wallet balance by patient ID
   */
  @Get('balance')
  @UseGuards(JwtAuthGuard)
  async getBalance(@Req() req: any) {
    const balance = await this.walletService.getWalletBalance(req.user.patientId);
    const res: DataResponse = {
      code: rc.SUCCESS,
      message: 'Fetched wallet balance',
      data: { balance },
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
      const wallet = await this.walletService.getOrCreateWallet(req.user.patientId);
      if (!wallet) {
        const res: DataResponse = {
          code: rc.ERROR,
          message: 'Wallet not found',
          data: null,
        };
        return res;
      }

      // Get transaction history with pagination
      const transactions = await this.walletService.getWalletHistory(
        req.user.patientId,
        page,
        limit,
      );
      const total = await this.walletService.getWalletTransactionCount(req.user.patientId);

      const res: DataResponse = {
        code: rc.SUCCESS,
        message: 'Fetched wallet details successfully',
        data: {
          coinBalance: wallet.coinBalance,
          totalCoinEarned: wallet.totalCoinEarned,
          totalCoinUsed: wallet.totalCoinUsed,
          transactions,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
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
}
