import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Req,
  UseGuards
} from '@nestjs/common';
import { RoleEnum } from 'src/common/enum/role.enum';
import { Roles } from 'src/common/guards/roles.decorator';
import { AuthUser } from 'src/common/interfaces/auth-user';
import { VisitService } from './visit.service';
import { JwtAuthGuard } from 'src/common/guards/jws-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';

@Controller('receptionist/visits')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(RoleEnum.RECEPTIONIST)
export class VisitReceptionistController {
  constructor(private readonly visitService: VisitService) {}

  @Get()
  async getTodayVisits() {
    const visits = await this.visitService.getTodayVisitsForReceptionist();

    return {
      code: 'SUCCESS',
      message: 'Fetched receptionist visits successfully',
      data: visits,
    };
  }

  @Patch(':visitId/check-in')
  async checkIn(
    @Param('visitId') visitId: string,
    @Req() req: any,
    @Body() _body: Record<string, never>,
  ) {
    const user = req.user as AuthUser | undefined;
    const visit = await this.visitService.checkInVisit(visitId);

    // Keep an audit trail for receptionist-driven workflow without changing appointment state.
    console.log(
      `[Visit][ReceptionistCheckIn] visitId=${visitId} receptionistId=${user?.accountId ?? 'unknown'}`,
    );

    return {
      code: 'SUCCESS',
      message: 'Visit checked in successfully',
      data: {
        visitId: visit._id.toString(),
        status: visit.status,
      },
    };
  }
}
