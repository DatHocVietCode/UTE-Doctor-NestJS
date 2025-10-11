import { Module } from "@nestjs/common";
import { AuthSaga } from "./sagas/auth.saga";
import { BookingAppointmentSubmitSaga } from "./sagas/bookingAppointment/booking-appointment-submit.saga";
import { RegisterShiftSaga } from "./sagas/register-shift.saga";
import { ShiftModule } from "src/shift/shift.module";

@Module({
  imports: [ShiftModule],
  providers: [AuthSaga, BookingAppointmentSubmitSaga, RegisterShiftSaga],
})
export class OrchestrationModule {}
