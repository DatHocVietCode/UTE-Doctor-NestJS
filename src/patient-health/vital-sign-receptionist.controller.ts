import {
  Body,
  Controller,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { DataResponse } from 'src/common/dto/data-respone';
import { ResponseCode } from 'src/common/enum/reponse-code.enum';
import { RoleEnum } from 'src/common/enum/role.enum';
import { JwtAuthGuard } from 'src/common/guards/jws-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { Roles } from 'src/common/guards/roles.decorator';
import { AuthUser } from 'src/common/interfaces/auth-user';
import { CreatePatientVitalSignDto } from './dto/create-patient-vital-sign.dto';
import { CreatePatientVitalSignResponseDto } from './dto/patient-health-summary.dto';
import { PatientVitalSignService } from './patient-vital-sign.service';

// Append-only vital-sign capture for receptionists. Coexists with VisitReceptionistController
// under the same `receptionist/visits` prefix (distinct sub-paths, no route collision).
@Controller('receptionist/visits')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(RoleEnum.RECEPTIONIST)
export class VitalSignReceptionistController {
  constructor(private readonly vitalSignService: PatientVitalSignService) {}

  @Post(':visitId/vital-signs')
  async createVitalSign(
    @Param('visitId') visitId: string,
    @Body() dto: CreatePatientVitalSignDto,
    @Req() req: any,
  ): Promise<DataResponse<CreatePatientVitalSignResponseDto>> {
    const user = req.user as AuthUser | undefined;
    if (!user) {
      throw new UnauthorizedException('Unable to identify user from token');
    }
    const data = await this.vitalSignService.createForVisit(visitId, dto, user);
    return {
      code: ResponseCode.SUCCESS,
      message: 'Created patient vital sign successfully',
      data,
    };
  }
}
