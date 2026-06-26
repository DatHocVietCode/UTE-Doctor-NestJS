import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Appointment, AppointmentSchema } from 'src/appointment/schemas/appointment.schema';
import { Account, AccountSchema } from 'src/account/schemas/account.schema';
import { Profile, ProfileSchema } from 'src/profile/schema/profile.schema';
import { BillingModule } from 'src/billing/billing.module';
import { PaymentModule } from 'src/payment/payment.module';
import { CloudinaryModule } from 'src/cloudinary/cloudinary.module';
import { MailModule } from 'src/mail/mail.module';
import { ReceptionistController } from './receptionist.controller';
import { ReceptionistService } from './receptionist.service';
import { Receptionist, ReceptionistSchema } from './schema/receptionist.schema';

@Module({
	imports: [
		MongooseModule.forFeature([
			{ name: Appointment.name, schema: AppointmentSchema },
			{ name: Account.name, schema: AccountSchema },
			{ name: Profile.name, schema: ProfileSchema },
			{ name: Receptionist.name, schema: ReceptionistSchema },
		]),
		BillingModule,
		PaymentModule,
		MailModule,
		CloudinaryModule,
	],
	controllers: [ReceptionistController],
	providers: [ReceptionistService],
	exports: [ReceptionistService],
})
export class ReceptionistModule {}
