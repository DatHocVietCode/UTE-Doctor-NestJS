
import { Module } from "@nestjs/common";
import { DoctorModule } from "src/doctor/doctor.module";
import { PatientModule } from "src/patient/patient.module";
import { ProfileModule } from "src/profile/profile.module";
import { UserContextService } from "./user-context.service";
import { MongooseModule } from "@nestjs/mongoose";
import { Patient, PatientSchema } from "src/patient/schema/patient.schema";
import { Doctor, DoctorSchema } from "src/doctor/schema/doctor.schema";
import { Profile, ProfileSchema } from "src/profile/schema/profile.schema";

@Module({
  imports: [
     MongooseModule.forFeature([{ name: Patient.name, schema: PatientSchema }]),
    MongooseModule.forFeature([{ name: Doctor.name, schema: DoctorSchema }]),
    MongooseModule.forFeature([{ name: Profile.name, schema: ProfileSchema }]),
  ],
  providers: [UserContextService],
  exports: [UserContextService],
})
export class UserContextModule {}
