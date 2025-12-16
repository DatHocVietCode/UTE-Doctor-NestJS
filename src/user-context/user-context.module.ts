
import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { Doctor, DoctorSchema } from "src/doctor/schema/doctor.schema";
import { Patient, PatientSchema } from "src/patient/schema/patient.schema";
import { Profile, ProfileSchema } from "src/profile/schema/profile.schema";
import { UserContextService } from "./user-context.service";

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
