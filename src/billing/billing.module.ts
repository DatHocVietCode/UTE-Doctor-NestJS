import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Billing, BillingSchema } from './billing.schema';
import { BillingService } from './billing.service';
import { BillingListener } from './billing.listener';
import { MedicalEncounter, MedicalEncounterSchema } from 'src/patient/schema/medical-record.schema';
import { Appointment, AppointmentSchema } from 'src/appointment/schemas/appointment.schema';
import { Visit, VisitSchema } from 'src/visit/schemas/visit.schema';
import { CreditModule } from 'src/wallet/credit/credit.module';
import { CoinModule } from 'src/wallet/coin/coin.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Billing.name, schema: BillingSchema },
      { name: MedicalEncounter.name, schema: MedicalEncounterSchema },
      { name: Appointment.name, schema: AppointmentSchema },
      { name: Visit.name, schema: VisitSchema },
    ]),
    CreditModule,
    CoinModule,
  ],
  providers: [BillingService, BillingListener],
  exports: [BillingService],
})
export class BillingModule {}
