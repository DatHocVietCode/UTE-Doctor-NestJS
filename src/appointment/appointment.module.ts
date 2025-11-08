import { Module } from "@nestjs/common";
import { AppointmentController } from "./appointment.controller";
import { AppointmentService } from "./appointment.service";
import { BookingListener } from "./listenners/booking.listenner";
import { MongooseModule } from "@nestjs/mongoose";
import { Appointment, AppointmentSchema } from "./schemas/appointment.schema";
import { TimeSlotLog, TimeSlotLogSchema } from "src/timeslot/schemas/timeslot-log.schema";


@Module({
    imports: [
        MongooseModule.forFeature([
          { name: Appointment.name, schema: AppointmentSchema },
          { name: TimeSlotLog.name, schema: TimeSlotLogSchema }, // thêm model để inject vào AppointmentService
        ]),
    ],
    controllers: [AppointmentController],
    providers: [AppointmentService, BookingListener],
    exports: [AppointmentService]
})
export class AppointmentModule {}