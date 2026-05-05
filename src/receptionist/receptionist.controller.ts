import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { RoleEnum } from 'src/common/enum/role.enum';
import { JwtAuthGuard } from 'src/common/guards/jws-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { Roles } from 'src/common/guards/roles.decorator';
import { ApplyCoinDto } from './dto/apply-coin.dto';
import { ApplyCreditDto } from './dto/apply-credit.dto';
import { ReceptionistService } from './receptionist.service';

@Controller('receptionist')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(RoleEnum.RECEPTIONIST)
export class ReceptionistController {
	constructor(private readonly receptionistService: ReceptionistService) {}

	@Get('test')
	test() {
		return {
			message: 'Receptionist module working',
		};
	}

	// @Get('visits')
	// async getVisits() {
	// 	return this.receptionistService.getVisits();
	// }

	@Get('billing/:visitId')
	async getBilling(@Param('visitId') visitId: string) {
		return this.receptionistService.getBillingByVisitId(visitId);
	}

	@Post('payment/mock')
	async mockPayment(@Body() body: { visitId?: string; amount?: number }) {
		return this.receptionistService.mockPayment(body);
	}

	@Patch('billings/:billingId/apply-credit')
	async applyCredit(
		@Param('billingId') billingId: string,
		@Body() body: ApplyCreditDto,
	) {
		return this.receptionistService.applyCreditToBilling(billingId, body.creditToUse);
	}

	@Patch('billings/:billingId/apply-coin')
	async applyCoin(
		@Param('billingId') billingId: string,
		@Body() body: ApplyCoinDto,
	) {
		return this.receptionistService.applyCoinToBilling(billingId, body.coinToUse);
	}

	@Post('billings/:billingId/finalize')
	async finalizeBilling(@Param('billingId') billingId: string) {
		return this.receptionistService.finalizeBilling(billingId);
	}

	@Get('payments/:billingId/qr')
	async getQrPayment(@Param('billingId') billingId: string, @Req() req: any) {
		const ipAddr = this.getClientIp(req);
		return this.receptionistService.getQrPaymentForBilling(billingId, ipAddr);
	}

	@Post('payments/:paymentId/mark-paid')
	async markCashPaid(@Param('paymentId') paymentId: string, @Req() req: any) {
		const performedBy = req.user?.accountId ?? req.user?.id ?? req.user?.email ?? 'unknown';
		return this.receptionistService.markCashPaymentPaid(paymentId, performedBy);
	}

	private getClientIp(req: any): string {
		const forwardedFor = req.headers?.['x-forwarded-for'];
		if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
			return forwardedFor.split(',')[0].trim();
		}

		return req.ip ?? req.socket?.remoteAddress ?? '127.0.0.1';
	}
}
