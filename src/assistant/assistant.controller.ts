import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/common/guards/jws-auth.guard';
import { AppointmentBookingGuideService } from './appointment-booking-guide.service';
import { AppointmentBookingGuideResponse } from './appointment-booking-guide.types';
import { AssistantAvailabilityService } from './assistant-availability.service';
import { AssistantAvailabilityResponse } from './availability.types';
import { AskAvailabilityDto } from './dto/ask-availability.dto';
import { AskAppointmentBookingGuideDto } from './dto/ask-appointment-booking-guide.dto';

@Controller('/assistant')
export class AssistantController {
  constructor(
    private readonly appointmentBookingGuideService: AppointmentBookingGuideService,
    private readonly assistantAvailabilityService: AssistantAvailabilityService,
  ) {}

  @Post('/appointment-booking/ask')
  @UseGuards(JwtAuthGuard)
  askAppointmentBookingGuide(
    @Body() body: AskAppointmentBookingGuideDto,
  ): Promise<AppointmentBookingGuideResponse> {
    return this.appointmentBookingGuideService.ask(body);
  }

  @Post('/availability/ask')
  @UseGuards(JwtAuthGuard)
  askAvailability(
    @Body() body: AskAvailabilityDto,
  ): Promise<AssistantAvailabilityResponse> {
    return this.assistantAvailabilityService.ask(body);
  }
}
