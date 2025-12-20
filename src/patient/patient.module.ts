import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Account, AccountSchema } from 'src/account/schemas/account.schema';
import { Profile, ProfileSchema } from 'src/profile/schema/profile.schema';
import { PatientListener } from './listenners/patient.listenner';
import { PatientController } from './patient.controller';
import { PatientService } from './patient.service';
import {
  AllergyRecord,
  AllergyRecordSchema,
  MedicalEncounter,
  MedicalEncounterSchema,
  MedicalHistoryRecord,
  MedicalHistoryRecordSchema,
  MedicalProfile,
  MedicalProfileSchema
} from './schema/medical-record.schema';
import { Patient, PatientSchema } from './schema/patient.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Patient.name, schema: PatientSchema },
      { name: Profile.name, schema: ProfileSchema },
      { name: Account.name, schema: AccountSchema },
      { name: MedicalProfile.name, schema: MedicalProfileSchema },
      { name: AllergyRecord.name, schema: AllergyRecordSchema },
      { name: MedicalHistoryRecord.name, schema: MedicalHistoryRecordSchema },
      { name: MedicalEncounter.name, schema: MedicalEncounterSchema },
    ]),
  ],
  providers: [PatientService, PatientListener],
  controllers: [PatientController],
  exports: [PatientService],
})
export class PatientModule {}
