import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { RoleEnum } from 'src/common/enum/role.enum';
import { JwtAuthGuard } from 'src/common/guards/jws-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { Roles } from 'src/common/guards/roles.decorator';
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
}
