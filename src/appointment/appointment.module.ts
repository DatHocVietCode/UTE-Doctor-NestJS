import { Module } from "@nestjs/common";
import { AppointmentController } from "./appointment.controller";
import { AppointmentService } from "./appointment.service";
import { BookingListener } from "./listenners/booking.listenner";
import { MongooseModule } from "@nestjs/mongoose";
import { MedicineModule } from "src/medicine/medicine.module";
import { Appointment, AppointmentSchema } from "./schemas/appointment.schema";
import { TimeSlotLog, TimeSlotLogSchema } from "src/timeslot/schemas/timeslot-log.schema";
import { AppointmentListenner } from "./listenners/appointment.listenner";
import { Patient, PatientSchema } from "src/patient/schema/patient.schema";
import { Doctor, DoctorSchema } from "src/doctor/schema/doctor.schema";
import { Profile, ProfileSchema } from "src/profile/schema/profile.schema";


@Module({
    imports: [
        MongooseModule.forFeature([
          { name: Appointment.name, schema: AppointmentSchema },
          { name: TimeSlotLog.name, schema: TimeSlotLogSchema }, // thêm model để inject vào AppointmentService
          { name: Patient.name, schema: PatientSchema },
          { name: Doctor.name, schema: DoctorSchema },
          { name: Profile.name, schema: ProfileSchema },
        ]),
        MedicineModule,
    ],
    controllers: [AppointmentController],
    providers: [AppointmentService, BookingListener, AppointmentListenner],
    exports: [AppointmentService]
})
export class AppointmentModule {}