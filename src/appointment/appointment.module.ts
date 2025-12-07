import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { MongooseModule } from "@nestjs/mongoose";
import { MedicineModule } from "src/medicine/medicine.module";
import { Patient, PatientSchema } from "src/patient/schema/patient.schema";
import { TimeSlotLog, TimeSlotLogSchema } from "src/timeslot/schemas/timeslot-log.schema";
import { WalletModule } from "src/wallet/wallet.module";
import { AppointmentController } from "./appointment.controller";
import { AppointmentService } from "./appointment.service";
import { AppointmentListenner } from "./listenners/appointment.listenner";
import { BookingListener } from "./listenners/booking.listenner";
import { CancelListener } from "./listenners/cancel.listener";
import { RescheduleListener } from "./listenners/reschedule.listener";
import { Appointment, AppointmentSchema } from "./schemas/appointment.schema";


@Module({
    imports: [
        JwtModule.register({
          secret: process.env.JWT_SECRET,
          signOptions: { expiresIn: process.env.JWT_EXPIRES_IN },
        }),
        MongooseModule.forFeature([
          { name: Appointment.name, schema: AppointmentSchema },
          { name: TimeSlotLog.name, schema: TimeSlotLogSchema }, // thêm model để inject vào AppointmentService
          { name: Patient.name, schema: PatientSchema },
        ]),
        MedicineModule,
        WalletModule,
    ],
    controllers: [AppointmentController],
    providers: [AppointmentService, BookingListener, AppointmentListenner, RescheduleListener, CancelListener],
    exports: [AppointmentService]
})
export class AppointmentModule {}