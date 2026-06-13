import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import * as appointmentEnriched from 'src/appointment/schemas/appointment-enriched';
import { VisitService } from '../visit.service';

@Injectable()
export class VisitBookingListener {
  private readonly logger = new Logger(VisitBookingListener.name);

  constructor(private readonly visitService: VisitService) {}

  @OnEvent('appointment.booking.success')
  async handleAppointmentBookingSuccess(payload: appointmentEnriched.AppointmentEnriched) {
    // Booking success means appointment is confirmed, so this is the safe point to create Visit.
    const visit = await this.visitService.createVisitFromAppointment(payload);
    this.logger.log(
      `Visit ready for appointmentId=${payload.appointmentId} visitId=${visit._id.toString()}`,
    );
  }
}
