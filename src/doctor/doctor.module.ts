import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Doctor, DoctorSchema } from './schema/doctor.schema';
import { DoctorService } from './doctor.service';
import { DoctorController } from './doctor.controller';
import { DoctorVisitsController } from './doctor-visits.controller';
import { VisitModule } from 'src/visit/visit.module';
import { Profile, ProfileSchema } from 'src/profile/schema/profile.schema';
import { DoctorSeeder } from './doctor.seeder';
import { DoctorListener } from './listenners/doctor.listernner';
import { Account, AccountSchema } from 'src/account/schemas/account.schema';
import { MailModule } from 'src/mail/mail.module';
import { CloudinaryModule } from 'src/cloudinary/cloudinary.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Doctor.name, schema: DoctorSchema },
      { name: Profile.name, schema: ProfileSchema },
      { name: Account.name, schema: AccountSchema },
    ]),
    MailModule,
    CloudinaryModule,
    VisitModule,
  ],
  providers: [DoctorService, DoctorSeeder, DoctorListener],
  controllers: [DoctorController, DoctorVisitsController],
  exports: [DoctorService],
})
export class DoctorModule {}
