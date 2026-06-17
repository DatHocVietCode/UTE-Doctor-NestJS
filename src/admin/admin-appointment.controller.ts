import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/common/guards/jws-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { Roles } from 'src/common/guards/roles.decorator';
import { RoleEnum } from 'src/common/enum/role.enum';
import { AdminAppointmentListQueryDto } from './dto/admin-appointment-list.query.dto';
import { AppointmentLifecycleService } from './services/appointment-lifecycle.service';
import { LifecycleDetailService } from './services/lifecycle-detail.service';

// Read-only admin surface for the appointment lifecycle tree. ADMIN-only.
@Controller('admin/appointments')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(RoleEnum.ADMIN)
export class AdminAppointmentController {
  constructor(
    private readonly lifecycleService: AppointmentLifecycleService,
    private readonly detailService: LifecycleDetailService,
  ) {}

  // GET /admin/appointments — filtered, paginated summary list.
  @Get()
  list(@Query() query: AdminAppointmentListQueryDto) {
    return this.lifecycleService.listAppointments(query);
  }

  // GET /admin/appointments/:id/lifecycle — summarized phase-grouped lifecycle tree.
  @Get(':id/lifecycle')
  getLifecycle(@Param('id') id: string) {
    return this.lifecycleService.getLifecycle(id);
  }

  // GET /admin/appointments/:id/lifecycle/nodes/:nodeId — lazy sanitized node detail.
  @Get(':id/lifecycle/nodes/:nodeId')
  getNodeDetail(@Param('id') id: string, @Param('nodeId') nodeId: string) {
    return this.detailService.getNodeDetail(id, nodeId);
  }
}
