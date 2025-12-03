import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Doctor, DoctorSchema } from './schema/doctor.schema';
import { DoctorService } from './doctor.service';
import { DoctorController } from './doctor.controller';
import { Profile, ProfileSchema } from 'src/profile/schema/profile.schema';
import { DoctorSeeder } from './doctor.seeder';
import { DoctorListener } from './listenners/doctor.listernner';
import { Account, AccountSchema } from 'src/account/schemas/account.schema';
import { MailModule } from 'src/mail/mail.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Doctor.name, schema: DoctorSchema },
      { name: Profile.name, schema: ProfileSchema },
      { name: Account.name, schema: AccountSchema },
    ]),
    MailModule,
  ],
  providers: [DoctorService, DoctorSeeder, DoctorListener],
  controllers: [DoctorController],
  exports: [DoctorService],
})
export class DoctorModule {}
