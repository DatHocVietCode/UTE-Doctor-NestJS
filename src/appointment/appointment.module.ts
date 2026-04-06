import { forwardRef, Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { RedisService } from "src/common/redis/redis.service";
import { Doctor, DoctorSchema } from "src/doctor/schema/doctor.schema";
import { MedicineModule } from "src/medicine/medicine.module";
import { MedicalEncounter, MedicalEncounterSchema } from "src/patient/schema/medical-record.schema";
import { Patient, PatientSchema } from "src/patient/schema/patient.schema";
import { PaymentModule } from "src/payment/payment.module";
import { Profile, ProfileSchema } from "src/profile/schema/profile.schema";
import { TimeSlotLog, TimeSlotLogSchema } from "src/timeslot/schemas/timeslot-log.schema";
import { WalletModule } from "src/wallet/wallet.module";
import { AppointmentBookingService } from "./appointment-booking.service";
import { AppointmentController } from "./appointment.controller";
import { AppointmentService } from "./appointment.service";
import { BookingListener } from "./listenners/booking.listenner";
import { CancelListener } from "./listenners/cancel.listener";
import { RescheduleListener } from "./listenners/reschedule.listener";
import { Appointment, AppointmentSchema } from "./schemas/appointment.schema";


@Module({
    imports: [
        MongooseModule.forFeature([
          { name: Appointment.name, schema: AppointmentSchema },
          { name: TimeSlotLog.name, schema: TimeSlotLogSchema }, // thêm model để inject vào AppointmentService
          { name: Patient.name, schema: PatientSchema },
          { name: Doctor.name, schema: DoctorSchema },
          { name: Profile.name, schema: ProfileSchema },
          { name: MedicalEncounter.name, schema: MedicalEncounterSchema },
        ]),
        MedicineModule,
        WalletModule,
        forwardRef(() => PaymentModule),
    ],
    controllers: [AppointmentController],
      providers: [AppointmentService, AppointmentBookingService, RedisService, BookingListener, RescheduleListener, CancelListener],
      exports: [AppointmentService, AppointmentBookingService]
})
export class AppointmentModule {}