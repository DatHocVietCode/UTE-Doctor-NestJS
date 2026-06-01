import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Appointment,
  AppointmentSchema,
} from 'src/appointment/schemas/appointment.schema';
import { Doctor, DoctorSchema } from 'src/doctor/schema/doctor.schema';
import { Patient, PatientSchema } from 'src/patient/schema/patient.schema';
import { Profile, ProfileSchema } from 'src/profile/schema/profile.schema';
import { VisitBookingListener } from './listenners/visit-booking.listenner';
import { Visit, VisitSchema } from './schemas/visit.schema';
import { VisitReceptionistController } from './visit-receptionist.controller';
import { VisitService } from './visit.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Visit.name, schema: VisitSchema },
      { name: Appointment.name, schema: AppointmentSchema },
      { name: Patient.name, schema: PatientSchema },
      { name: Doctor.name, schema: DoctorSchema },
      { name: Profile.name, schema: ProfileSchema },
    ]),
  ],
  controllers: [VisitReceptionistController],
  providers: [VisitService, VisitBookingListener],
  exports: [VisitService],
})
export class VisitModule {}
