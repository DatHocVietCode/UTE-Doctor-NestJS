import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PatientController } from './patient.controller';
import { PatientService } from './patient.service';
import { Patient, PatientSchema } from './schema/patient.schema';
import { PatientListener } from './listenners/patient.listenner';
import { Profile, ProfileSchema } from 'src/profile/schema/profile.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Patient.name, schema: PatientSchema },
      { name: Profile.name, schema: ProfileSchema },
    ]),
  ],
  providers: [PatientService, PatientListener],
  controllers: [PatientController],
  exports: [PatientService],
})
export class PatientModule {}
