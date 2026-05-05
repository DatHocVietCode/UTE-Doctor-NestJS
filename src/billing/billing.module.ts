import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Appointment, AppointmentSchema } from 'src/appointment/schemas/appointment.schema';
import { MedicalEncounter, MedicalEncounterSchema } from 'src/patient/schema/medical-record.schema';
import { PaymentModule } from 'src/payment/payment.module';
import { Visit, VisitSchema } from 'src/visit/schemas/visit.schema';
import { CoinModule } from 'src/wallet/coin/coin.module';
import { CreditModule } from 'src/wallet/credit/credit.module';
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
    ]),
    PaymentModule,
    CreditModule,
    CoinModule,
  ],
  providers: [BillingService, BillingListener],
  exports: [BillingService],
})
export class BillingModule {}
