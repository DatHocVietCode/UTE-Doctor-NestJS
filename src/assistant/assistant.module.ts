import { Module } from '@nestjs/common';
import { ChuyenKhoaModule } from 'src/chuyen-khoa/chuyenkhoa.module';
import { DoctorModule } from 'src/doctor/doctor.module';
import { AssistantController } from './assistant.controller';
import { AssistantAvailabilityService } from './assistant-availability.service';
import { AppointmentBookingGuideService } from './appointment-booking-guide.service';
import { AvailabilityIntentParser } from './availability-intent.parser';
import { AvailabilityLookupService } from './availability-lookup.service';

@Module({
  imports: [DoctorModule, ChuyenKhoaModule],
  controllers: [AssistantController],
  providers: [
    AppointmentBookingGuideService,
    AssistantAvailabilityService,
    AvailabilityIntentParser,
    AvailabilityLookupService,
  ],
})
export class AssistantModule {}
