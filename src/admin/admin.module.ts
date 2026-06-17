import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Appointment, AppointmentSchema } from 'src/appointment/schemas/appointment.schema';
import { AppointmentAssignmentTask, AppointmentAssignmentTaskSchema } from 'src/appointment/schemas/appointment-assignment-task.schema';
import { Payment, PaymentSchema } from 'src/payment/schemas/payment.schema';
import { Visit, VisitSchema } from 'src/visit/schemas/visit.schema';
import { MedicalEncounter, MedicalEncounterSchema } from 'src/patient/schema/medical-record.schema';
import { Billing, BillingSchema } from 'src/billing/billing.schema';
import { TimeSlotLog, TimeSlotLogSchema } from 'src/timeslot/schemas/timeslot-log.schema';
import { CreditTransaction, CreditTransactionSchema } from 'src/wallet/credit/schemas/credit-transaction.schema';
import { CoinTransaction, CoinTransactionSchema } from 'src/wallet/coin/schemas/coin-transaction.schema';
import { Notification, NotificationSchema } from 'src/notification/schemas/notification.schema';
import { Doctor, DoctorSchema } from 'src/doctor/schema/doctor.schema';
import { Patient, PatientSchema } from 'src/patient/schema/patient.schema';
import { Account, AccountSchema } from 'src/account/schemas/account.schema';
import { AdminAppointmentController } from './admin-appointment.controller';
import { AppointmentLifecycleService } from './services/appointment-lifecycle.service';
import { LifecycleDetailService } from './services/lifecycle-detail.service';

// Read-only admin module. It registers the domain schemas it READS (no writes) and
// owns no schema of its own — the lifecycle tree is reconstructed domain-first.
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Appointment.name, schema: AppointmentSchema },
      { name: AppointmentAssignmentTask.name, schema: AppointmentAssignmentTaskSchema },
      { name: Payment.name, schema: PaymentSchema },
      { name: Visit.name, schema: VisitSchema },
      { name: MedicalEncounter.name, schema: MedicalEncounterSchema },
      { name: Billing.name, schema: BillingSchema },
      { name: TimeSlotLog.name, schema: TimeSlotLogSchema },
      { name: CreditTransaction.name, schema: CreditTransactionSchema },
      { name: CoinTransaction.name, schema: CoinTransactionSchema },
      { name: Notification.name, schema: NotificationSchema },
      { name: Doctor.name, schema: DoctorSchema },
      { name: Patient.name, schema: PatientSchema },
      { name: Account.name, schema: AccountSchema },
    ]),
  ],
  controllers: [AdminAppointmentController],
  providers: [AppointmentLifecycleService, LifecycleDetailService],
})
export class AdminModule {}
