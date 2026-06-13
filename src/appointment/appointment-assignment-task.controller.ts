import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { RoleEnum } from 'src/common/enum/role.enum';
import { JwtAuthGuard } from 'src/common/guards/jws-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { Roles } from 'src/common/guards/roles.decorator';
import { AuthUser } from 'src/common/interfaces/auth-user';
import { AppointmentAssignmentTaskService } from './appointment-assignment-task.service';
import { AssignmentTaskAssignDto } from './dto/assignment-task-assign.dto';
import { AssignmentTaskReleaseDto } from './dto/assignment-task-release.dto';

// NOTE: this controller is registered BEFORE AppointmentController so its static
// `assignment-tasks` routes win over AppointmentController's `@Get(':id')`.
@Controller('appointment/assignment-tasks')
@UseGuards(JwtAuthGuard, RoleGuard)
// Default: receptionists and admins can view the queue. Mutations are narrowed per-handler.
@Roles(RoleEnum.RECEPTIONIST, RoleEnum.ADMIN)
export class AppointmentAssignmentTaskController {
  constructor(private readonly assignmentTaskService: AppointmentAssignmentTaskService) {}

  @Get()
  async listTasks(
    @Query('status') status?: string,
    @Query('specialty') specialty?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.assignmentTaskService.listTasks({
      status,
      specialty,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get(':id')
  async getTask(@Param('id') id: string) {
    return this.assignmentTaskService.getTaskDetail(id);
  }

  @Post(':id/accept')
  @Roles(RoleEnum.RECEPTIONIST)
  async acceptTask(@Param('id') id: string, @Req() req: any) {
    const receptionistId = this.resolveReceptionistId(req.user as AuthUser);
    return this.assignmentTaskService.acceptTask(id, receptionistId);
  }

  @Post(':id/release')
  @Roles(RoleEnum.RECEPTIONIST)
  async releaseTask(
    @Param('id') id: string,
    @Body() dto: AssignmentTaskReleaseDto,
    @Req() req: any,
  ) {
    const receptionistId = this.resolveReceptionistId(req.user as AuthUser);
    return this.assignmentTaskService.releaseTask(id, receptionistId, dto.reason);
  }

  @Post(':id/assign')
  @Roles(RoleEnum.RECEPTIONIST)
  async assignDoctorAndSlot(
    @Param('id') id: string,
    @Body() dto: AssignmentTaskAssignDto,
    @Req() req: any,
  ) {
    const receptionistId = this.resolveReceptionistId(req.user as AuthUser);
    return this.assignmentTaskService.assignDoctorAndSlot(id, receptionistId, dto);
  }

  private resolveReceptionistId(user: AuthUser | undefined): string {
    // Receptionists are accounts; accountId is the stable owner identifier.
    const id = user?.accountId ?? user?.sub;
    if (!id) {
      throw new UnauthorizedException('Unable to identify receptionist from token');
    }
    return id;
  }
}
