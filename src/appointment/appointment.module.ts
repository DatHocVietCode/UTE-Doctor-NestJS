import { forwardRef, Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { Billing, BillingSchema } from "src/billing/billing.schema";
import { RedisService } from "src/common/redis/redis.service";
import { Doctor, DoctorSchema } from "src/doctor/schema/doctor.schema";
import { Shift, ShiftSchema } from "src/shift/schema/shift.schema";
import { MedicineModule } from "src/medicine/medicine.module";
import { MedicalEncounter, MedicalEncounterSchema } from "src/patient/schema/medical-record.schema";
import { Patient, PatientSchema } from "src/patient/schema/patient.schema";
import { PaymentModule } from "src/payment/payment.module";
import { Payment, PaymentSchema } from "src/payment/schemas/payment.schema";
import { Profile, ProfileSchema } from "src/profile/schema/profile.schema";
import { TimeSlotLog, TimeSlotLogSchema } from "src/timeslot/schemas/timeslot-log.schema";
import { Visit, VisitSchema } from "src/visit/schemas/visit.schema";
import { VisitModule } from "src/visit/visit.module";
import { WalletModule } from "src/wallet/wallet.module";
import { AssignmentSlaScheduler } from "./appointment-assignment-sla.scheduler";
import { AppointmentAssignmentTaskController } from "./appointment-assignment-task.controller";
import { AppointmentAssignmentTaskService } from "./appointment-assignment-task.service";
import { AppointmentBookingService } from "./appointment-booking.service";
import { AppointmentRescheduleService } from './appointment-reschedule.service';
import { AppointmentController } from "./appointment.controller";
import { AppointmentService } from "./appointment.service";
import { BookingListener } from "./listenners/booking.listenner";
import { CancelListener } from "./listenners/cancel.listener";
import { RescheduleListener } from "./listenners/reschedule.listener";
import { AppointmentAssignmentTask, AppointmentAssignmentTaskSchema } from "./schemas/appointment-assignment-task.schema";
import { Appointment, AppointmentSchema } from "./schemas/appointment.schema";


@Module({
    imports: [
        MongooseModule.forFeature([
          { name: Appointment.name, schema: AppointmentSchema },
          { name: AppointmentAssignmentTask.name, schema: AppointmentAssignmentTaskSchema },
          { name: TimeSlotLog.name, schema: TimeSlotLogSchema },
          { name: Shift.name, schema: ShiftSchema },
          { name: Patient.name, schema: PatientSchema },
          { name: Doctor.name, schema: DoctorSchema },
          { name: Profile.name, schema: ProfileSchema },
          { name: MedicalEncounter.name, schema: MedicalEncounterSchema },
          { name: Payment.name, schema: PaymentSchema },
          { name: Visit.name, schema: VisitSchema },
          { name: Billing.name, schema: BillingSchema },
        ]),
        MedicineModule,
        VisitModule,
        WalletModule,
        forwardRef(() => PaymentModule),
    ],
    // AppointmentAssignmentTaskController must precede AppointmentController so its
    // static `assignment-tasks` routes are matched before AppointmentController's `:id`.
    controllers: [AppointmentAssignmentTaskController, AppointmentController],
      providers: [AppointmentService, AppointmentBookingService, AppointmentRescheduleService, AppointmentAssignmentTaskService, AssignmentSlaScheduler, RedisService, BookingListener, CancelListener, RescheduleListener],
      exports: [AppointmentService, AppointmentBookingService, AppointmentAssignmentTaskService]
})
export class AppointmentModule {}
