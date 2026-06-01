import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { RoleEnum } from 'src/common/enum/role.enum';
import { JwtAuthGuard } from 'src/common/guards/jws-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { Roles } from 'src/common/guards/roles.decorator';
import { AuthUser } from 'src/common/interfaces/auth-user';
import { BillingService } from './billing.service';

@Controller('billing')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(RoleEnum.RECEPTIONIST, RoleEnum.ADMIN)
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Get(':billingId/wallet-summary')
  async getWalletSummary(@Param('billingId') billingId: string, @Req() req: { user?: AuthUser }) {
    const performedBy = req.user?.accountId ?? req.user?.email ?? 'unknown';
    return this.billingService.getWalletSummaryForBilling(billingId, performedBy);
  }
}