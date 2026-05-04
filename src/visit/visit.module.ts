import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Appointment,
  AppointmentSchema,
} from 'src/appointment/schemas/appointment.schema';
import { Doctor, DoctorSchema } from 'src/doctor/schema/doctor.schema';
import { PatientModule } from 'src/patient/patient.module';
import { Patient, PatientSchema } from 'src/patient/schema/patient.schema';
import { Profile, ProfileSchema } from 'src/profile/schema/profile.schema';
import { TimeSlotLog, TimeSlotLogSchema } from 'src/timeslot/schemas/timeslot-log.schema';
import { VisitBookingListener } from './listenners/visit-booking.listenner';
import { Visit, VisitSchema } from './schemas/visit.schema';
import { VisitReceptionistController } from './visit-receptionist.controller';
import { VisitService } from './visit.service';

@Module({
  imports: [
    PatientModule,
    MongooseModule.forFeature([
      { name: Visit.name, schema: VisitSchema },
      { name: Appointment.name, schema: AppointmentSchema },
      { name: Patient.name, schema: PatientSchema },
      { name: Doctor.name, schema: DoctorSchema },
      { name: Profile.name, schema: ProfileSchema },
      { name: TimeSlotLog.name, schema: TimeSlotLogSchema },
    ]),
  ],
  controllers: [VisitReceptionistController],
  providers: [VisitService, VisitBookingListener],
  exports: [VisitService],
})
export class VisitModule {}
