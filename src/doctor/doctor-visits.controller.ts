import {
    BadRequestException,
    Body,
    ConflictException,
    Controller,
    ForbiddenException,
    Get,
    Logger,
    NotFoundException,
    Param,
    Patch,
    Post,
    Req,
    UseGuards,
} from '@nestjs/common';
import { RoleEnum } from 'src/common/enum/role.enum';
import { JwtAuthGuard } from 'src/common/guards/jws-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { Roles } from 'src/common/guards/roles.decorator';
import { AuthUser } from 'src/common/interfaces/auth-user';
import { CompleteVisitDto } from 'src/visit/dto/complete-visit.dto';
import { VisitStatus } from 'src/visit/enums/visit-status.enum';
import { VisitService } from 'src/visit/visit.service';

@Controller('doctor/visits')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(RoleEnum.DOCTOR)
export class DoctorVisitsController {
  private readonly logger = new Logger(DoctorVisitsController.name);
  constructor(private readonly visitService: VisitService) {}

  @Get('today')
  async getToday(@Req() req: any) {
    const user = req.user as AuthUser | undefined;
    const doctorId = user?.doctorId;
    if (!doctorId) {
      throw new BadRequestException('Doctor identity missing from token');
    }
    console.log(`Doctor ${doctorId} fetching today visits`);
    const visits = await this.visitService.getTodayVisitsForDoctor(doctorId);
    return {
      code: 'SUCCESS',
      message: 'Fetched today visits for doctor',
      data: visits,
    };
  }

  @Patch(':visitId/start')
  async startVisit(@Param('visitId') visitId: string, @Req() req: any) {
    const user = req.user as AuthUser | undefined;
    const doctorId = user?.doctorId;
    if (!doctorId) {
      throw new BadRequestException('Doctor identity missing from token');
    }

    const visit = await this.visitService.getVisitById(visitId);
    if (!visit) {
      throw new NotFoundException('Visit not found');
    }

    if (visit.doctorId && visit.doctorId.toString() !== doctorId) {
      throw new ForbiddenException('Doctor does not own this visit');
    }

    if (visit.status === VisitStatus.IN_PROGRESS) {
      return {
        code: 'SUCCESS',
        message: 'Visit already in progress',
        data: { visitId, status: visit.status },
      };
    }

    if (visit.status === VisitStatus.COMPLETED) {
      throw new ConflictException('Visit already completed');
    }

    const updated = await this.visitService.updateVisitStatus(visitId, VisitStatus.IN_PROGRESS);
    this.logger.log(`Doctor ${doctorId} started visit ${visitId}`);
    return {
      code: 'SUCCESS',
      message: 'Visit started',
      data: { visitId: updated._id.toString(), status: updated.status },
    };
  }

  @Post(':visitId/complete')
  async completeVisit(@Param('visitId') visitId: string, @Body() body: CompleteVisitDto, @Req() req: any) {
    const user = req.user as AuthUser | undefined;
    const doctorId = user?.doctorId;
    if (!doctorId) {
      throw new BadRequestException('Doctor identity missing from token');
    }

    const visit = await this.visitService.getVisitById(visitId);
    if (!visit) {
      throw new NotFoundException('Visit not found');
    }

    if (visit.doctorId && visit.doctorId.toString() !== doctorId) {
      throw new ForbiddenException('Doctor does not own this visit');
    }

    if (visit.status === VisitStatus.COMPLETED) {
      throw new ConflictException('Visit already completed');
    }

    if (visit.status !== VisitStatus.IN_PROGRESS) {
      throw new BadRequestException('Visit must be IN_PROGRESS to complete');
    }

    const result = await this.visitService.completeVisit(visitId, body);
    this.logger.log(`Doctor ${doctorId} completed visit ${visitId}, encounter ${result.encounterId}`);

    return {
      code: 'SUCCESS',
      message: 'Visit completed',
      data: { visitId: result.visit._id.toString(), encounterId: result.encounterId },
    };
  }
}
