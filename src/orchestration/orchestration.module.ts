import { Module } from "@nestjs/common";
import { AuthSaga } from "./sagas/auth.saga";
import { BookingAppointmentSubmitSaga } from "./sagas/bookingAppointment/booking-appointment-submit.saga";

@Module({
    providers: [AuthSaga, BookingAppointmentSubmitSaga]
})
export class OrchestrationModule {}
