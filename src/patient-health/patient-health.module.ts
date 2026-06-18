import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Appointment, AppointmentSchema } from 'src/appointment/schemas/appointment.schema';
import { Profile, ProfileSchema } from 'src/profile/schema/profile.schema';
import { VisitModule } from 'src/visit/visit.module';
import { PatientHealthController } from './patient-health.controller';
import { PatientVitalSignService } from './patient-vital-sign.service';
import {
  PatientVitalSign,
  PatientVitalSignSchema,
} from './schemas/patient-vital-sign.schema';
import { VitalSignReceptionistController } from './vital-sign-receptionist.controller';

// Dedicated module for the patient health dashboard. Imports VisitModule (VisitService) to
// resolve a visit's patient/appointment at write time; nothing imports this module back, so
// there is no dependency cycle.
@Module({
  imports: [
    VisitModule,
    MongooseModule.forFeature([
      { name: PatientVitalSign.name, schema: PatientVitalSignSchema },
      { name: Appointment.name, schema: AppointmentSchema },
      { name: Profile.name, schema: ProfileSchema },
    ]),
  ],
  controllers: [PatientHealthController, VitalSignReceptionistController],
  providers: [PatientVitalSignService],
  exports: [PatientVitalSignService],
})
export class PatientHealthModule {}
