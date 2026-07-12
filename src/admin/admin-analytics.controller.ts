import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { RoleEnum } from 'src/common/enum/role.enum';
import { JwtAuthGuard } from 'src/common/guards/jws-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { Roles } from 'src/common/guards/roles.decorator';
import { AdminAnalyticsQueryDto } from './dto/admin-analytics.dto';
import { AdminAnalyticsService } from './services/admin-analytics.service';

// Read-only admin analytics dashboard endpoints. ADMIN-only, one metric per route.
// (Standard construction of new admin endpoints — not F2 remediation of existing routes.)
@Controller('admin/analytics')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(RoleEnum.ADMIN)
export class AdminAnalyticsController {
  constructor(private readonly analyticsService: AdminAnalyticsService) {}

  // GET /admin/analytics/top-specialties — most-examined specialties (reqs 1).
  @Get('top-specialties')
  topSpecialties(@Query() query: AdminAnalyticsQueryDto) {
    return this.analyticsService.topSpecialties(query);
  }

  // GET /admin/analytics/top-doctors — most-examined doctors by volume (req 2).
  @Get('top-doctors')
  topDoctors(@Query() query: AdminAnalyticsQueryDto) {
    return this.analyticsService.topDoctors(query);
  }

  // GET /admin/analytics/top-rated-doctors — highest average rating (req 3, all-time by default).
  @Get('top-rated-doctors')
  topRatedDoctors(@Query() query: AdminAnalyticsQueryDto) {
    return this.analyticsService.topRatedDoctors(query);
  }

  // GET /admin/analytics/frequent-patients — most-examined patients (req 4, PII-compliant output).
  @Get('frequent-patients')
  frequentPatients(@Query() query: AdminAnalyticsQueryDto) {
    return this.analyticsService.frequentPatients(query);
  }

  // GET /admin/analytics/revenue — consultation + medication revenue, by doctor/specialty,
  // plus top dispensed/externally-purchased medications (req 6). PAID billings only.
  @Get('revenue')
  revenue(@Query() query: AdminAnalyticsQueryDto) {
    return this.analyticsService.revenue(query);
  }
}
