import { Module } from "@nestjs/common";
import { ShiftModule } from "src/shift/shift.module";
import { BookingAppointmentPostSubmitSaga } from "./sagas/bookingAppointment/booking-appoinement-post-submit";
import { BookingAppointmentSubmitSaga } from "./sagas/bookingAppointment/booking-appointment-submit.saga";
import { RegisterShiftSaga } from "./sagas/register-shift.saga";

@Module({
  imports: [ShiftModule],
  providers: [BookingAppointmentSubmitSaga, RegisterShiftSaga, BookingAppointmentPostSubmitSaga],
})
export class OrchestrationModule {}
