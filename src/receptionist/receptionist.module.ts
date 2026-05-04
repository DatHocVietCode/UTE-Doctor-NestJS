import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Appointment, AppointmentSchema } from 'src/appointment/schemas/appointment.schema';
import { BillingModule } from 'src/billing/billing.module';
import { ReceptionistController } from './receptionist.controller';
import { ReceptionistService } from './receptionist.service';

@Module({
	imports: [
		MongooseModule.forFeature([{ name: Appointment.name, schema: AppointmentSchema }]),
		BillingModule,
	],
	controllers: [ReceptionistController],
	providers: [ReceptionistService],
	exports: [ReceptionistService],
})
export class ReceptionistModule {}
