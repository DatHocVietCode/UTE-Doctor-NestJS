import { Module } from "@nestjs/common";
import { AppointmentController } from "./appointment.controller";
import { AppointmentService } from "./appointment.service";
import { BookingListener } from "./listenners/booking.listenner";

@Module({
    imports: [],
    controllers: [AppointmentController],
    providers: [AppointmentService, BookingListener],
    exports: [AppointmentService]
})
export class AppointmentModule {}