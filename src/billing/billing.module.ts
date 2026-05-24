import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Appointment, AppointmentSchema } from 'src/appointment/schemas/appointment.schema';
import { Medicine, MedicineSchema } from 'src/medicine/schema/medicine.schema';
import { MedicalEncounter, MedicalEncounterSchema } from 'src/patient/schema/medical-record.schema';
import { PaymentModule } from 'src/payment/payment.module';
import { Visit, VisitSchema } from 'src/visit/schemas/visit.schema';
import { WalletModule } from 'src/wallet/wallet.module';
import { BillingController } from './billing.controller';
import { BillingListener } from './billing.listener';
import { Billing, BillingSchema } from './billing.schema';
import { BillingService } from './billing.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Billing.name, schema: BillingSchema },
      { name: MedicalEncounter.name, schema: MedicalEncounterSchema },
      { name: Appointment.name, schema: AppointmentSchema },
      { name: Visit.name, schema: VisitSchema },
      { name: Medicine.name, schema: MedicineSchema },
    ]),
    PaymentModule,
    WalletModule,
  ],
  controllers: [BillingController],
  providers: [BillingService, BillingListener],
  exports: [BillingService],
})
export class BillingModule {}
