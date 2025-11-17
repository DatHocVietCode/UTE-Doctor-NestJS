import { Module } from "@nestjs/common";
import { AuthSaga } from "./sagas/auth.saga";
import { BookingAppointmentSubmitSaga } from "./sagas/bookingAppointment/booking-appointment-submit.saga";
import { RegisterShiftSaga } from "./sagas/register-shift.saga";
import { ShiftModule } from "src/shift/shift.module";
import { BookingAppointmentPostSubmitSaga } from "./sagas/bookingAppointment/booking-appoinement-post-submit";

@Module({
  imports: [ShiftModule],
  providers: [AuthSaga, BookingAppointmentSubmitSaga, RegisterShiftSaga, BookingAppointmentPostSubmitSaga],
})
export class OrchestrationModule {}
