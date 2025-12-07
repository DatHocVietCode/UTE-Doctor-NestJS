import { Controller, Get, Req, UseGuards } from '@nestjs/common';
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
}
