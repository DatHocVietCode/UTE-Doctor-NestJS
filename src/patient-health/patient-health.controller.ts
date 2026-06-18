import { Controller, Get, Query, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { DataResponse } from 'src/common/dto/data-respone';
import { RoleEnum } from 'src/common/enum/role.enum';
import { JwtAuthGuard } from 'src/common/guards/jws-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { Roles } from 'src/common/guards/roles.decorator';
import { AuthUser } from 'src/common/interfaces/auth-user';
import { PatientHealthSummaryDto } from './dto/patient-health-summary.dto';
import { PatientVitalSignService } from './patient-vital-sign.service';

@Controller('patients')
export class PatientHealthController {
  constructor(private readonly vitalSignService: PatientVitalSignService) {}

  // Read-only health dashboard for the authenticated patient. Identity is resolved from the
  // JWT account; a patient can never read another patient's summary.
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(RoleEnum.PATIENT)
  @Get('me/health-summary')
  async getHealthSummary(
    @Req() req: any,
    @Query('limit') limit?: string,
  ): Promise<DataResponse<PatientHealthSummaryDto>> {
    const user = req.user as AuthUser | undefined;
    if (!user) {
      throw new UnauthorizedException('Unable to identify user from token');
    }
    const parsedLimit = limit !== undefined ? Number(limit) : undefined;
    return this.vitalSignService.getHealthSummaryForAccount(user, parsedLimit);
  }
}
