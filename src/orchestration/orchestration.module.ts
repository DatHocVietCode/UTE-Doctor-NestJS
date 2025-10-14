import { Module } from "@nestjs/common";
import { AuthSaga } from "./sagas/auth.saga";
import { BookingAppointmentSubmitSaga } from "./sagas/bookingAppointment/booking-appointment-submit.saga";
import { RegisterShiftSaga } from "./sagas/register-shift.saga";
import { ShiftModule } from "src/shift/shift.module";
import { BookingAppointmentFieldSaga } from "./sagas/bookingAppointment/booking-appointment-get-data.saga";

@Module({
  imports: [ShiftModule],
  providers: [AuthSaga, BookingAppointmentSubmitSaga, RegisterShiftSaga, BookingAppointmentFieldSaga],
})
export class OrchestrationModule {}
